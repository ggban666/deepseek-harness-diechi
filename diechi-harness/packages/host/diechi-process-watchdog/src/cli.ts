/**
 * watchdog 独立进程入口。
 *
 * 用法：
 *   node --import tsx packages/host/diechi-process-watchdog/src/cli.ts
 * 或（构建后）
 *   node packages/host/diechi-process-watchdog/lib/cli.js
 *
 * 环境变量：
 *   DSH_HOME                 必需。数据目录。
 *   DIECHI_HARNESS_PATH      可选。默认由 DSH_HOME 同级推导 diechi-harness。
 *   WATCHDOG_PORT            默认 3090。
 *   WATCHDOG_INTERVAL_SEC    默认 30。
 *   WATCHDOG_PROBE_MODE      port（默认）| command。
 *   WATCHDOG_SIGNAL_ONLY     设为 1 时只等信号、不探活（调试用）。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog/cli
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWatchdogService } from './index.ts'
import { NegativeSampleWriter } from './supervisor.ts'
import { killProcess, probeCommand, probePort, spawnDetached } from './process.ts'
import { DEFAULT_WATCHDOG_CONFIG, startWatchdog } from './watchdog.ts'
import { assertDirExists, assertPort, WatchdogConfigError } from './invariant.ts'
import type { RestartReason, UpdateSignal, WatchdogConfig, WatchdogDeps } from './types.ts'

const execFileAsync = promisify(execFile)

/** 读配置。缺失的必需项直接抛 —— 静默用错配置比启动失败更难排查。 */
function readConfig(): WatchdogConfig {
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined || dshHome.length === 0) {
    throw new WatchdogConfigError('DSH_HOME 未设置 —— watchdog 不知道该守哪个数据目录')
  }
  assertDirExists(dshHome, 'DSH_HOME')

  const harnessPath =
    process.env.DIECHI_HARNESS_PATH ?? resolve(dshHome, '..', 'diechi-harness')

  const port = assertPort(
    Number.parseInt(process.env.WATCHDOG_PORT ?? '', 10) || DEFAULT_WATCHDOG_CONFIG.port,
    'WATCHDOG_PORT',
  )
  const probeIntervalSec =
    Number.parseInt(process.env.WATCHDOG_INTERVAL_SEC ?? '', 10) ||
    DEFAULT_WATCHDOG_CONFIG.probeIntervalSec

  const probeModeRaw = process.env.WATCHDOG_PROBE_MODE ?? DEFAULT_WATCHDOG_CONFIG.probeMode
  if (probeModeRaw !== 'port' && probeModeRaw !== 'command') {
    throw new WatchdogConfigError(`WATCHDOG_PROBE_MODE 只能是 port 或 command，收到 ${probeModeRaw}`)
  }

  return {
    dshHome,
    harnessPath,
    port,
    probeIntervalSec,
    probeTimeoutMs: DEFAULT_WATCHDOG_CONFIG.probeTimeoutMs,
    gracefulExitMs: DEFAULT_WATCHDOG_CONFIG.gracefulExitMs,
    probeMode: probeModeRaw,
  }
}

/**
 * 找占用某端口的进程 PID。
 * 拿不到就返回 null —— 这时 watchdog 只是拉起新进程，新进程若真被占端口会自己报错。
 */
async function findPidOnPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'], {
        windowsHide: true,
        timeout: 5000,
      })
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue
        const match = /:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line.trim())
        if (match !== null && Number(match[1]) === port) return Number(match[2])
      }
      return null
    }
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`], { timeout: 5000 })
    const pid = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * 把补丁目录覆盖到 harness。
 * 必须在 DSH 进程**死后**调用 —— 文件锁只有进程没了才释放。
 */
async function applyPatch(patchPath: string, harnessPath: string): Promise<void> {
  await cp(patchPath, harnessPath, {
    recursive: true,
    force: true,
    // node_modules 不覆盖：补丁只该带源码与构建产物，动 node_modules 等于重装依赖。
    filter: (source) => !source.split(/[\\/]/).includes('node_modules'),
  })
}

/** 组装真实的副作用集合。 */
function createRealDeps(config: WatchdogConfig): WatchdogDeps & { dispose(): void } {
  const service = createWatchdogService(config.dshHome)
  const writer = NegativeSampleWriter.open(config.dshHome)

  const log = (message: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] [watchdog] ${message}`)
  }

  return {
    probe: async () => {
      if (config.probeMode === 'command') {
        return await probeCommand(config.harnessPath, 'dsh-base', config.probeTimeoutMs, {
          ...process.env,
          DSH_HOME: config.dshHome,
        })
      }
      return await probePort(config.port, '127.0.0.1', config.probeTimeoutMs)
    },

    readSignal: () => service.readSignal(),
    clearSignal: () => service.clearSignal(),

    recordRestart: (reason: RestartReason, detail) => {
      const id = writer.recordRestart(reason, detail)
      log(id === null ? `负样本写入失败（${reason}）—— 重启仍会继续` : `负样本已记录 #${id}（${reason}）`)
    },

    restart: async (signal: UpdateSignal | null, reason: RestartReason) => {
      // 1) 杀：先按端口找，避免孤儿进程继续占着 3090。
      const pid = await findPidOnPort(config.port)
      if (pid !== null) {
        log(`终止占用端口 ${config.port} 的进程 PID ${pid}（${reason}）`)
        await killProcess(pid, config.gracefulExitMs)
      } else {
        log(`端口 ${config.port} 无占用进程，跳过终止步骤`)
      }

      // 2) 换：文件锁此时已释放。
      if (signal?.patchPath !== undefined && signal.patchPath.length > 0) {
        try {
          await access(signal.patchPath)
          log(`应用补丁 ${signal.patchPath} → ${config.harnessPath}`)
          await applyPatch(signal.patchPath, config.harnessPath)
        } catch {
          // 补丁目录不存在就跳过 —— 已经把进程杀了，不拉起来更糟。
          log(`补丁目录不可读，跳过：${signal.patchPath}`)
        }
      }

      // 3) 拉：直接 node 跑 CLI 入口，不经过 pnpm。
      //
      // 执行说明里用的是 `pnpm exec dsh web --port 3090`。这里换成直接跑
      // apps/cli/lib/bin.js，原因：pnpm 启动时要读写 store 临时文件，
      // 在某些受限环境（安全策略拦截删除操作）下会直接失败；
      // 而 watchdog 的存在意义就是「在环境已经不太对劲的时候还能把 DSH 拉起来」，
      // 它的启动路径上不应该挂着一个可有可无的包管理器。
      const binPath = join(config.harnessPath, 'apps', 'cli', 'lib', 'bin.js')
      try {
        await access(binPath)
      } catch {
        throw new Error(`DSH CLI 入口不存在：${binPath}（检查 DIECHI_HARNESS_PATH 是否指向 diechi-harness）`)
      }
      const child = spawnDetached(process.execPath, [binPath, 'web', '--port', String(config.port)], config.harnessPath, {
        ...process.env,
        DSH_HOME: config.dshHome,
      })
      log(`已拉起新 DSH（PID ${child.pid ?? 'unknown'}，端口 ${config.port}）`)
    },

    sleep: async (ms: number) => {
      await new Promise((done) => setTimeout(done, ms))
    },

    log,

    dispose: () => {
      writer.close()
    },
  }
}

/** 入口。 */
export async function main(): Promise<void> {
  const config = readConfig()
  const deps = createRealDeps(config)

  deps.log(
    `启动：DSH_HOME=${config.dshHome} 端口=${config.port} ` +
      `间隔=${config.probeIntervalSec}s 探测=${config.probeMode}`,
  )
  deps.log(`信号文件：${createWatchdogService(config.dshHome).signalPath}`)

  const handle = startWatchdog(config, deps)

  let shuttingDown = false
  const shutdown = (signalName: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    deps.log(`收到 ${signalName}，停止守护（已拉起的 DSH 不受影响）`)
    handle.stop()
    void handle.done.finally(() => {
      deps.dispose()
      process.exit(0)
    })
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  await handle.done
  deps.dispose()
}

// 只有「被当作入口直接执行」时才自动跑 main；被 import 时不跑，否则测试一 import 就守护起来了。
// 判据是 import.meta.url 与 process.argv[1] 指向同一个文件 —— 不能只凭文件名结尾判断，
// 那样任何 import 都会触发。
const isDirectRun = ((): boolean => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  // 两处都必须处理，否则进程会静默退出（用户以为有人守着，其实没有）：
  // 1. argv[1] 可能是相对路径 —— `node --import tsx packages/.../cli.ts` 给的就是相对路径。
  // 2. import.meta.url 是 percent-encoded 的 file: URL（中文路径会变成 %E6%A1%8C...），
  //    手工拼 `file:///...` 永远比不上。必须用 pathToFileURL 生成，它会做同样的编码。
  return import.meta.url === pathToFileURL(resolve(entry)).href
})()

if (isDirectRun) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[watchdog] 启动失败：', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
