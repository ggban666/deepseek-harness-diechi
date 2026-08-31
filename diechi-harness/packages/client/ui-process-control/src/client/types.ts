/**
 * 外部服务进程控制载荷类型（浏览器侧）。
 *
 * ⚠️ 这些类型是 host 侧 `diechi-process-control/src/types.ts` 同名接口的**镜像**，
 * 不是 import——client bundle 纯度闸门禁止跨插件值导入，host 包不在白名单里。
 *
 * @module ui-process-control/client
 */

/** 可被手动控制的进程 ID。 */
export type ProcessId = 'qwen3.8' | 'vision'

/** 单个受控进程的运行状态。 */
export type ProcessRunState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

/** 单个受控进程的完整状态视图。 */
export interface ProcessInfo {
  readonly id: ProcessId
  readonly label: string
  readonly port: number
  readonly state: ProcessRunState
  readonly gpuHeavy: boolean
  readonly error: string
  readonly changedAt: string
}

/** list() 返回。 */
export interface ProcessListResult {
  readonly items: readonly ProcessInfo[]
  readonly gpuWarning: string | null
}

/** start / stop 入参。 */
export interface ProcessActionInput {
  readonly id: ProcessId
}

/** start / stop 返回。 */
export interface ProcessActionResult {
  readonly ok: boolean
  readonly info: ProcessInfo | null
  readonly gpuWarning: string | null
  readonly error?: string
}

/** RPC 统一包装（与框架 Remote 调用约定一致）。 */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** RPC 面（由 api-remotes 挂载的 remote.diechiProcess）。 */
export interface ProcessRemote {
  list(): Promise<RemoteResult<ProcessListResult>>
  start(input: ProcessActionInput): Promise<RemoteResult<ProcessActionResult>>
  stop(input: ProcessActionInput): Promise<RemoteResult<ProcessActionResult>>
}
