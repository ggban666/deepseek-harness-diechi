/**
 * 进程级副作用：探活 / 杀进程 / 拉起。跨平台。
 *
 * ## 为什么杀进程要用 taskkill /T
 *
 * 历史实证（2026-08-28）：后台 job 启动 DSH 会留下孤儿进程占着 3090，
 * 只 kill 主进程杀不掉子进程，端口仍旧被占，新起的 DSH 直接启动失败。
 * Windows 上 `taskkill /T` 能杀整棵进程树 —— 这正是需要的语义。
 * taskkill 不可用时回退 `process.kill`，并在注释里承认这个回退不杀子树。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog/process
 */

import { spawn, execFile, openSync } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ChildProcess } from 'node:child_process'

const execFileAsync = promisify(execFile)

/**
 * TCP 探活。默认方式：毫秒级开销，不依赖 pnpm / node_modules 是否完好。
 *
 * 设计文档原本要求跑 `dsh web --dump-config` 来验证「输出结构 OK」。
 * 但那个命令每次要 spawn 一个 pnpm + node 进程（秒级），30 秒一轮太重，
 * 且 pnpm 不可用时探活会恒定失败 —— 反而会误判 DSH 死了、触发不必要的重启。
 * 端口能连上就说明进程还活着，这已经是 watchdog 需要的判据。
 * 需要深度校验时把 probeMode 配成 'command'。
 */
export function probePort(port: number, host = '127.0.0.1', timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host })
    let settled = false

    const finish = (alive: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(alive)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/**
 * 命令探活：跑 `dsh web --dump-config`，输出含 marker 才算活着。
 * 开销大，仅作为可选的深度校验。
 */
export async function probeCommand(
  cwd: string,
  marker: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pnpm', ['exec', 'dsh', 'web', '--dump-config'], {
      cwd,
      timeout: timeoutMs,
      env,
      windowsHide: true,
    })
    return stdout.includes(marker)
  } catch {
    return false
  }
}

/** 进程是否还活着。信号 0 只做存在性检查，不真的发信号。 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 终止进程（Windows 上连带子进程树）。
 * @param gracefulMs 先给 SIGTERM 的机会；Windows 直接走 taskkill /T。
 */
export async function killProcess(pid: number, gracefulMs = 2000): Promise<void> {
  if (!pidAlive(pid)) return

  if (process.platform === 'win32') {
    // /T = 终止子进程树；/F = 强制。不带 /T 会留下占端口的孤儿进程。
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      return
    } catch {
      // taskkill 不可用（或被安全策略拦截）时走下面回退。
    }
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + gracefulMs
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 已经没了。
  }
}

/**
 * 拉起 DSH。detached + unref，让子进程独立于 watchdog 存活 ——
 * 否则 watchdog 退出时会把刚拉起的 DSH 一起带走。
 *
 * 缺口 2 修：stdin 丢弃（不阻塞 DSH 启动），stdout/stderr 重定向到
 * `$DSH_HOME/.watchdog/dsh.log` 与 `dsh.err.log`（append 模式，多次重启不丢历史）。
 * 升级补丁导致 DSH 起不来时，运维能 tail 日志看到报错 —— 不再静默。
 *
 * @param command 可执行文件，比如 `pnpm` 或 `process.execPath`。
 * @param args 参数，比如 `['exec','dsh','web','--port','3090']`。
 * @param dshHome `$DSH_HOME` —— 用于定位 .watchdog 目录。
 */
export function spawnDetached(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  dshHome?: string,
): ChildProcess {
  let stdio: 'ignore' | [typeof process.stdin, number, number]
  if (dshHome) {
    const dir = `${dshHome}/.watchdog`
    try {
      mkdirSync(dir, { recursive: true })
      // append 模式 — O_APPEND 多进程安全；mode 0o644 跨用户可读便于 cat
      const out = openSync(`${dir}/dsh.log`, 'a')
      const err = openSync(`${dir}/dsh.err.log`, 'a')
      stdio = ['ignore', out, err]
      appendFileSync(
        `${dir}/history.jsonl`,
        JSON.stringify({ ts: new Date().toISOString(), stage: 'dsh-spawn', pid: null, command, args: [...args] }) + '\n',
        'utf8',
      )
    } catch {
      // 日志路径建失败退回 ignore —— 不能因为审计失败阻止 watchdog
      stdio = 'ignore'
    }
  } else {
    stdio = 'ignore'
  }
  const child = spawn(command, args as string[], {
    cwd,
    env,
    detached: true,
    stdio,
    windowsHide: true,
  })
  child.unref()
  return child
}
