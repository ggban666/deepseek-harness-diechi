/**
 * diechi-process-control 类型契约：外部服务进程的手动启停载荷。
 *
 * 不包含运行时代码（按 packages/AGENTS.md 规矩）。
 * 这些类型必须从包的 `./types` 子路径导出——typert 生成器要求
 * Remote 边界类型从公共非根类型子路径导出。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-control/types
 */

/** 可被手动控制的进程 ID。 */
export type ProcessId = 'qwen3.8' | 'vision'

/** 单个受控进程的运行状态。 */
export type ProcessRunState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

/** 单个受控进程的完整状态视图。 */
export interface ProcessInfo {
  /** 进程 ID（qwen3.8 / vision）。 */
  readonly id: ProcessId
  /** 展示名。 */
  readonly label: string
  /** 端口。 */
  readonly port: number
  /** 当前运行状态。 */
  readonly state: ProcessRunState
  /** 是否正在占显存（running 时为 true；vision 懒加载时可能 running 但未占显存）。 */
  readonly gpuHeavy: boolean
  /** 最近一次错误信息（无则为空串）。 */
  readonly error: string
  /** 上次状态变化时间（ISO 8601）。 */
  readonly changedAt: string
}

/** list() 返回：全部受控进程状态 + 显存提示。 */
export interface ProcessListResult {
  readonly items: readonly ProcessInfo[]
  /**
   * 显存提示：qwen3.8 与 vision 同时 running 时给出提示（不强制互斥）。
   * RTX 4070 仅 8GB 显存，两者常驻会 OOM——这里只提示，由用户自行决定。
   */
  readonly gpuWarning: string | null
}

/** start / stop 的入参。 */
export interface ProcessActionInput {
  /** 要操作的进程 ID。 */
  readonly id: ProcessId
}

/** start / stop 的返回。 */
export interface ProcessActionResult {
  readonly ok: boolean
  readonly info: ProcessInfo | null
  readonly gpuWarning: string | null
  readonly error?: string
}
