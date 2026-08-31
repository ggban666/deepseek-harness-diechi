/**
 * 外部服务进程控制器：把 remote.diechiProcess 的 RPC 变成 UI 可用的状态 + 启停动作。
 *
 * 刻意保持"薄"：所有判定（端口是否在监听、显存是否冲突）都在 host 侧做完，
 * 这里只负责展示和触发。按钮状态以 host 返回的 state 字段为准。
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProcessId, ProcessInfo, ProcessListResult, ProcessRemote } from './types.ts'

/** 自动刷新间隔（ms）。进程状态是慢变化，5s 足够。 */
export const AUTO_REFRESH_MS = 5000

/** 控制器状态。 */
export interface ProcessControlState {
  /** 两个进程的实时状态（null = 还没抓到过，RPC 未就绪）。 */
  readonly items: readonly ProcessInfo[] | null
  readonly loading: boolean
  /** 正在启停中的进程 id（用于按钮转圈）。 */
  readonly busy: ProcessId | null
  readonly error: string
  readonly gpuWarning: string | null
  /** RPC 是否可达（false 说明 host 插件未装载）。 */
  readonly available: boolean
}

/** 注册侧业务面。 */
export interface ProcessControlInjected {
  hooks: {
    state: HostObservable<ProcessControlState>
  }
  refresh(): Promise<void>
  toggle(id: ProcessId): Promise<void>
}

const INITIAL: ProcessControlState = {
  items: null,
  loading: false,
  busy: null,
  error: '',
  gpuWarning: null,
  available: true,
}

/** 控制器：RPC + 定时轮询 → 状态 + 启停动作。 */
export class ProcessController {
  private readonly state = createSnapshotStore<ProcessControlState>(INITIAL)
  private timer: ReturnType<typeof setInterval> | undefined = undefined
  private inflight: Promise<void> | undefined = undefined

  constructor(private readonly remote: ProcessRemote) {
    // 侧边栏按钮常驻，需持续刷新状态——构造即启动轮询。
    this.startTimer()
  }

  get hooks(): ProcessControlInjected['hooks'] {
    return { state: this.state as HostObservable<ProcessControlState> }
  }

  /** 抓一次全量状态。 */
  async refresh(): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    const task = this.doRefresh()
    this.inflight = task
    try {
      await task
    } finally {
      this.inflight = undefined
    }
  }

  /** 切换启停：running → stop，否则 → start。 */
  async toggle(id: ProcessId): Promise<void> {
    const current = this.state.getSnapshot()
    const info = current.items?.find((i) => i.id === id)
    if (info === undefined) return
    if (current.busy !== null) return

    const action = info.state === 'running' ? 'stop' : 'start'
    this.state.set({ ...this.state.getSnapshot(), busy: id, error: '' })
    try {
      const result = action === 'start' ? await this.remote.start({ id }) : await this.remote.stop({ id })
      if (!result.ok) {
        this.state.set({ ...this.state.getSnapshot(), busy: null, error: `${result.error.code}: ${result.error.message}` })
        return
      }
      // 用返回的最新状态替换本地项，并带上显存提示。
      const value = result.value
      const nextItems = mergeItems(this.state.getSnapshot().items, value.info)
      this.state.set({ ...this.state.getSnapshot(), busy: null, items: nextItems, gpuWarning: value.gpuWarning })
    } catch (error) {
      this.state.set({ ...this.state.getSnapshot(), busy: null, error: errorMessage(error) })
    } finally {
      // 无论成败都刷新一次，确保端口探测到的真实状态落盘。
      void this.refresh()
    }
  }

  /** 停止定时器（插件卸载时调用）。 */
  dispose(): void {
    this.stopTimer()
  }

  /** 注册侧业务面。 */
  inject(): ProcessControlInjected {
    return {
      hooks: this.hooks,
      refresh: () => this.refresh(),
      toggle: (id) => this.toggle(id),
    }
  }

  // ───────────────────────── 内部 ─────────────────────────

  private async doRefresh(): Promise<void> {
    this.state.set({ ...this.state.getSnapshot(), loading: true, error: '' })
    try {
      const result = await this.remote.list()
      if (!result.ok) {
        this.state.set({
          ...this.state.getSnapshot(),
          loading: false,
          available: false,
          error: `${result.error.code}: ${result.error.message}`,
        })
        return
      }
      const value: ProcessListResult = result.value
      this.state.set({
        ...this.state.getSnapshot(),
        loading: false,
        available: true,
        items: value.items,
        gpuWarning: value.gpuWarning,
      })
    } catch (error) {
      this.state.set({ ...this.state.getSnapshot(), loading: false, available: false, error: errorMessage(error) })
    }
  }

  private startTimer(): void {
    this.stopTimer()
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, AUTO_REFRESH_MS)
  }

  private stopTimer(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }
}

/** 把单条更新合并进列表（保持顺序、按 id 替换）。 */
function mergeItems(items: readonly ProcessInfo[] | null, patch: ProcessInfo | null): readonly ProcessInfo[] | null {
  if (items === null) return patch === null ? null : [patch]
  if (patch === null) return items
  let found = false
  const next = items.map((i) => {
    if (i.id === patch.id) { found = true; return patch }
    return i
  })
  if (!found) next.push(patch)
  return next
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
