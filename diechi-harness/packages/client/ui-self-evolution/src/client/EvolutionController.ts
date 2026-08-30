/**
 * 自进化面板控制器：把 remote.diechiEvolution 的 RPC 变成 UI 可用的快照 + 动作。
 *
 * 刻意保持"薄"：所有判定（能力有没有退步、成本有没有超带、提议排不排序）
 * 都在 host 侧做完，这里只负责画。一个会自己算分的前端，迟早会和后端算出
 * 两个不一样的分数——而用户只会相信他看到的那个。
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { EvolutionRemote, EvolutionSnapshot } from './types.ts'

/** 自动刷新间隔（ms）。3s 足够"看着数字动"，又不至于把 RPC 打满。 */
export const AUTO_REFRESH_MS = 3000

/** 面板状态。 */
export interface EvolutionState {
  /** 最近一次成功抓取的快照；null = 还没抓到过。 */
  readonly snapshot: EvolutionSnapshot | null
  readonly loading: boolean
  /** 正在跑 CBS 基准集（重活，按钮要转圈）。 */
  readonly runningCbs: boolean
  readonly error: string
  /** 面板开合（侧边栏按钮与浮层共享）。 */
  readonly open: boolean
  readonly autoRefresh: boolean
}

/** 注册侧业务面。 */
export interface EvolutionInjected {
  hooks: {
    /** 面板状态（刷新后更新）。 */
    state: HostObservable<EvolutionState>
  }
  refresh(): Promise<void>
  toggle(): void
  close(): void
  setAutoRefresh(on: boolean): void
  runCbs(commit: boolean): Promise<void>
}

const INITIAL: EvolutionState = {
  snapshot: null,
  loading: false,
  runningCbs: false,
  error: '',
  open: false,
  autoRefresh: false,
}

/** 控制器：RPC + 定时轮询 → 快照 + 动作。 */
export class EvolutionController {
  private readonly state = createSnapshotStore<EvolutionState>(INITIAL)
  private timer: ReturnType<typeof setInterval> | undefined = undefined
  /** 并发保护：上一轮没回来就不要再发一轮。 */
  private inflight: Promise<void> | undefined = undefined

  constructor(private readonly remote: EvolutionRemote) {}

  get hooks(): EvolutionInjected['hooks'] {
    return { state: this.state as HostObservable<EvolutionState> }
  }

  /** 抓一次全量快照。并发调用会复用同一个 in-flight Promise。 */
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

  /** 开合面板（点侧边栏按钮）。 */
  toggle(): void {
    const next = !this.state.getSnapshot().open
    this.state.set({ ...this.state.getSnapshot(), open: next })
    // 打开即抓一次——面板开着却显示上次的数据，等于让人对着旧数字做判断。
    if (next) void this.refresh()
  }

  close(): void {
    this.state.set({ ...this.state.getSnapshot(), open: false })
  }

  /** 自动刷新开关。 */
  setAutoRefresh(on: boolean): void {
    this.state.set({ ...this.state.getSnapshot(), autoRefresh: on })
    if (on) this.startTimer()
    else this.stopTimer()
  }

  /**
   * 跑一次 CBS 能力基准集。
   * @param commit - true 时把结果写成历史快照（C(t) 曲线上多一个点）。
   */
  async runCbs(commit: boolean): Promise<void> {
    const current = this.state.getSnapshot()
    if (current.runningCbs) return
    this.state.set({ ...current, runningCbs: true, error: '' })
    try {
      const result = await this.remote.runCbs({ commit })
      if (!result.ok) {
        this.state.set({ ...this.state.getSnapshot(), error: `${result.error.code}: ${result.error.message}` })
        return
      }
      this.state.set({ ...this.state.getSnapshot(), snapshot: result.value.snapshot })
    } catch (error) {
      this.state.set({ ...this.state.getSnapshot(), error: errorMessage(error) })
    } finally {
      this.state.set({ ...this.state.getSnapshot(), runningCbs: false })
    }
  }

  /** 停止定时器（插件卸载时由 apply 调用）。 */
  dispose(): void {
    this.stopTimer()
  }

  /** 注册侧业务面：钩子 + 动作。 */
  inject(): EvolutionInjected {
    return {
      hooks: this.hooks,
      refresh: () => this.refresh(),
      toggle: () => this.toggle(),
      close: () => this.close(),
      setAutoRefresh: (on) => this.setAutoRefresh(on),
      runCbs: (commit) => this.runCbs(commit),
    }
  }

  // ───────────────────────── 内部 ─────────────────────────

  private async doRefresh(): Promise<void> {
    this.state.set({ ...this.state.getSnapshot(), loading: true, error: '' })
    try {
      const result = await this.remote.overview()
      if (!result.ok) {
        this.state.set({
          ...this.state.getSnapshot(),
          loading: false,
          error: `${result.error.code}: ${result.error.message}`,
        })
        return
      }
      this.state.set({ ...this.state.getSnapshot(), loading: false, snapshot: result.value })
    } catch (error) {
      this.state.set({ ...this.state.getSnapshot(), loading: false, error: errorMessage(error) })
    }
  }

  private startTimer(): void {
    this.stopTimer()
    // 打开面板时立刻抓一次，然后按间隔轮询。
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, AUTO_REFRESH_MS)
  }

  private stopTimer(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }
}

/** 把 unknown 错误压成一行字符串（UI 只显示，不处理）。 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
