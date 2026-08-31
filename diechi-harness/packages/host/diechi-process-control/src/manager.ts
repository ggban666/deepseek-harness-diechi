/**
 * diechi-process-control 进程管理器：真正拉起 / 杀掉两个外部服务进程。
 *
 * - qwen3.8：deploy-tools/evolve/engine.py 的 serve-lazy 模式（8081 反向代理，
 *   内部 18081 懒加载 llama-server，空闲自动卸载显存）。
 * - vision：deploy-tools/vision-server.py（8080，mini 模式懒加载）。
 *
 * 关键约束：
 * 1. 路径全部以项目根（diechi-harness 的上一级 = 蝶翅-app）为基准，
 *    与 start-diechi.cmd / start-evolve-engine.cmd 对齐，保持自包含。
 * 2. 不碰 3090（DSH 主进程）——那是 watchdog 的职责，本管理器只管两个重显存的外部服务。
 * 3. 状态判定以「端口是否 LISTENING」为准，不依赖进程句柄存活（跨重启健壮）。
 *    停止时优先 kill 我们记录的 PID，再按端口兜底清。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-control
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProcessActionInput, ProcessActionResult, ProcessId, ProcessInfo, ProcessListResult, ProcessRunState } from './types.ts'

/** 受控进程的静态定义。 */
interface ProcessDef {
  id: ProcessId
  label: string
  port: number
  gpuHeavy: boolean
  /** 拉起命令（argv，不含可执行文件本身）。 */
  spawn(): { cmd: string; args: string[]; cwd: string }
}

/**
 * 蝶翅-app 根目录（diechi-harness 的上一级）。
 * 本包是 ESM（package.json type=module），编译产物里没有 CJS 的 __dirname，
 * 必须用 fileURLToPath(import.meta.url) 拿当前文件路径，再 dirname 取目录。
 * 编译后本文件 = 蝶翅-app/diechi-harness/packages/host/diechi-process-control/lib/manager.js，
 * 其目录（lib/）往上 5 级正好是 蝶翅-app。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function appHome(): string {
  return join(HERE, '..', '..', '..', '..', '..')
}

/** 定位可执行文件：vendor junction 优先，缺失回退系统 PATH。 */
function resolveExe(which: 'node' | 'python'): string {
  const root = appHome()
  const name = which === 'node' ? 'node.exe' : 'python.exe'
  const vendored = join(root, 'vendor', which, name)
  if (existsSync(vendored)) return vendored
  return which === 'node' ? 'node.exe' : 'python.exe'
}

/** 端口是否 LISTENING（netstat，跨平台 Windows）。 */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve(false); return }
      const needle = `:${port} `
      const lines = String(stdout).split(/\r?\n/)
      for (const line of lines) {
        if (line.includes(needle) && line.toUpperCase().includes('LISTENING')) {
          resolve(true)
          return
        }
      }
      resolve(false)
    })
  })
}

/** 找到占用某端口的 PID（找不到返回 null）。 */
function pidOnPort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve(null); return }
      const needle = `:${port} `
      for (const line of String(stdout).split(/\r?\n/)) {
        if (line.includes(needle) && line.toUpperCase().includes('LISTENING')) {
          const parts = line.trim().split(/\s+/)
          const pid = Number(parts[parts.length - 1])
          if (Number.isFinite(pid) && pid > 0) { resolve(pid); return }
        }
      }
      resolve(null)
    })
  })
}

/** 按 PID 强杀（taskkill /F /T 连子进程一起）。 */
function killPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 8000, windowsHide: true }, () => resolve())
  })
}

/** 受控进程定义表。 */
const DEFS: Record<ProcessId, ProcessDef> = {
  'qwen3.8': {
    id: 'qwen3.8',
    label: 'Qwen3.8 本地模型',
    port: 8081,
    gpuHeavy: true,
    spawn: () => {
      const root = appHome()
      return {
        cmd: resolveExe('python'),
        args: [
          join(root, 'deploy-tools', 'evolve', 'engine.py'), 'serve-lazy',
          '--model', join(root, 'models', 'Qwen3.8-27B-UD-IQ1_S', 'Qwen3.8-27B-UD-IQ1_S.gguf'),
          '--port', '8081', '--internal-port', '18081',
          '--ngl', '99', '--ctx', '32768', '--idle-sec', '600',
        ],
        cwd: join(root, 'deploy-tools', 'evolve'),
      }
    },
  },
  vision: {
    id: 'vision',
    label: '视频模型（视觉/语音）',
    port: 8080,
    gpuHeavy: true,
    spawn: () => {
      const root = appHome()
      return {
        cmd: resolveExe('python'),
        args: [join(root, 'deploy-tools', 'vision-server.py'), '8080'],
        cwd: join(root, 'deploy-tools'),
      }
    },
  },
}

/** 已拉起子进程的句柄（只用于主动 stop 时精确 kill，状态判定仍以端口为准）。 */
const children = new Map<ProcessId, ChildProcess | null>()

/**
 * 进程管理器：list / start / stop。
 * 刻意不实现持久化（重启 DSH 后由 start-diechi.cmd 的 lazy proxy 兜底拉起）。
 */
export class ProcessManager {
  /** 列出全部受控进程状态。 */
  async list(): Promise<ProcessListResult> {
    const items: ProcessInfo[] = []
    for (const def of Object.values(DEFS)) {
      items.push(await this.infoOf(def))
    }
    return { items, gpuWarning: this.gpuWarning(items) }
  }

  /** 启动一个进程。 */
  async start(input: ProcessActionInput): Promise<ProcessActionResult> {
    const def = DEFS[input.id]
    if (def === undefined) return { ok: false, info: null, gpuWarning: null, error: `unknown process: ${input.id}` }

    const running = await isPortListening(def.port)
    if (running) {
      const info = await this.infoOf(def)
      return { ok: true, info, gpuWarning: this.gpuWarning([info]) }
    }

    const { cmd, args, cwd } = def.spawn()
    try {
      const child = spawn(cmd, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      children.set(def.id, child)
      // 不等待退出码——detached 后句柄只管 kill，状态以端口为准。
      child.on('error', () => { children.set(def.id, null) })
      child.unref()
    } catch (err) {
      return { ok: false, info: null, gpuWarning: null, error: String(err) }
    }

    // 等待端口就绪（qwen3.8 懒加载代理秒起；vision 起服务也要几秒）。
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (await isPortListening(def.port)) {
        const info = await this.infoOf(def)
        return { ok: true, info, gpuWarning: this.gpuWarning([info]) }
      }
      await sleep(500)
    }
    const info: ProcessInfo = { id: def.id, label: def.label, port: def.port, state: 'error', gpuHeavy: def.gpuHeavy, error: '30s 内未就绪', changedAt: new Date().toISOString() }
    return { ok: false, info, gpuWarning: null, error: 'timeout: process did not listen in 30s' }
  }

  /** 停止一个进程。 */
  async stop(input: ProcessActionInput): Promise<ProcessActionResult> {
    const def = DEFS[input.id]
    if (def === undefined) return { ok: false, info: null, gpuWarning: null, error: `unknown process: ${input.id}` }

    // 先 kill 我们记录的句柄（若还活着）。
    const child = children.get(def.id)
    if (child !== null && child !== undefined && child.pid !== undefined) {
      await killPid(child.pid)
      children.set(def.id, null)
    }

    // 再按端口兜底清（可能有非本管理器拉起的实例，比如 start-diechi.cmd 的 lazy proxy）。
    const pid = await pidOnPort(def.port)
    if (pid !== null) await killPid(pid)

    // 等它真正释放端口。
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (!(await isPortListening(def.port))) {
        const info = await this.infoOf(def)
        return { ok: true, info, gpuWarning: this.gpuWarning([info]) }
      }
      await sleep(400)
    }
    // 端口仍在——可能杀错或进程顽固，如实上报。
    const info: ProcessInfo = { id: def.id, label: def.label, port: def.port, state: 'error', gpuHeavy: def.gpuHeavy, error: '停止后端口仍未释放', changedAt: new Date().toISOString() }
    return { ok: false, info, gpuWarning: null, error: 'port still listening after stop' }
  }

  /** 关闭所有已拉起子进程（插件卸载时调用）。 */
  async shutdown(): Promise<void> {
    for (const def of Object.values(DEFS)) {
      const child = children.get(def.id)
      if (child !== null && child !== undefined && child.pid !== undefined) {
        await killPid(child.pid)
      }
      children.set(def.id, null)
    }
  }

  // ───────────────────────── 内部 ─────────────────────────

  private async infoOf(def: ProcessDef): Promise<ProcessInfo> {
    const listening = await isPortListening(def.port)
    const prev = prevState.get(def.id)
    const state: ProcessRunState = listening ? 'running' : 'stopped'
    const changedAt = prev !== state ? new Date().toISOString() : (prevAt.get(def.id) ?? new Date().toISOString())
    prevState.set(def.id, state)
    prevAt.set(def.id, changedAt)
    return {
      id: def.id,
      label: def.label,
      port: def.port,
      state,
      gpuHeavy: def.gpuHeavy,
      error: '',
      changedAt,
    }
  }

  private gpuWarning(items: readonly ProcessInfo[]): string | null {
    const heavyRunning = items.filter((i) => i.gpuHeavy && i.state === 'running')
    if (heavyRunning.length >= 2) {
      return 'Qwen3.8 与视频模型同时常驻可能超出 8GB 显存，导致加载失败。建议只开其中一个。'
    }
    return null
  }
}

const prevState = new Map<ProcessId, ProcessRunState>()
const prevAt = new Map<ProcessId, string>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
