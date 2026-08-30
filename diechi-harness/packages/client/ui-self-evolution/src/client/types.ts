/**
 * 自进化面板载荷类型（浏览器侧）。
 *
 * ⚠️ 这些类型是 host 侧 `diechi-supervisor/src/gateway.ts` 同名接口的**镜像**，
 * 不是 import。原因：client bundle 的纯度闸门禁止跨插件值导入，而 host 包
 * 不在 `INLINE_SAFE` 白名单里，只有 type-only 能过——但本文件还要导出
 * `EVOLUTION_SNAPSHOT_KEYS` 这个**运行时常量**，一旦走 import 就会把 host 代码
 * 拖进浏览器包。
 *
 * 镜像会漂移，所以用两道锁：
 * 1. `EVOLUTION_SNAPSHOT_KEYS` —— 字段清单，与 host 侧实际产出的 key 集合比对；
 * 2. `scripts/verify-self-evolution.mts` 里的结构一致性用例（跑真实 RPC 产物比对）。
 *
 * 改 host 侧字段时必须同步改这里，否则测试会红。
 */

/** 体感信号计数。 */
export interface EvolutionSignalTally {
  readonly accepted: number
  readonly noRework: number
  readonly userUndo: number
  readonly explicitBad: number
  readonly total: number
}

/** 历史曲线上的一个点。 */
export interface EvolutionHistoryPoint {
  readonly at: string
  readonly c: number
  readonly k: number
  readonly sampleCount: number
}

/** 提议卡片视图。 */
export interface EvolutionProposalView {
  readonly id: number
  readonly kind: string
  readonly scope: string
  readonly summary: string
  readonly estimatedDc: number
  readonly estimatedDk: number
  readonly status: string
  readonly createdAt: string
}

/** 最近一次 CBS 跑分。 */
export interface EvolutionCbsView {
  readonly version: string
  readonly cScore: number
  readonly kScore: number
  readonly total: number
  readonly passed: number
  readonly byFamily: Readonly<Record<string, { readonly total: number; readonly passed: number; readonly rate: number }>>
  readonly failureIds: readonly string[]
  readonly ruleCount: { readonly frozen: number; readonly authorizations: number }
  readonly ranAt: string
  readonly committed: boolean
}

/** 前端一次抓取到的全部自进化状态。 */
export interface EvolutionSnapshot {
  readonly at: string
  readonly cbsVersion: string
  readonly capability: {
    readonly current: number
    readonly best: number
    readonly positive: number
    readonly total: number
  }
  readonly cost: {
    readonly current: number
    readonly ema: number
    readonly bandLo: number
    readonly bandHi: number
    readonly hardMax: number
    readonly action: 'none' | 'throttle' | 'reject'
  }
  readonly signals: EvolutionSignalTally
  readonly rules: { readonly frozen: number; readonly authorized: number }
  readonly negatives: number
  readonly history: readonly EvolutionHistoryPoint[]
  readonly proposals: readonly EvolutionProposalView[]
  readonly evolutionAvailable: boolean
  readonly latestCbs: EvolutionCbsView | null
  readonly telemetry: { readonly enabled: boolean; readonly throttleMs: number }
}

/** runCbs 的返回值。 */
export interface EvolutionCbsOutcome {
  readonly cbs: EvolutionCbsView
  readonly snapshot: EvolutionSnapshot
}

/**
 * EvolutionSnapshot 的顶层字段清单。
 *
 * host 侧改了字段而前端忘了跟，下面的结构一致性测试会失败——
 * 这比让面板静悄悄显示 undefined 要好。
 */
export const EVOLUTION_SNAPSHOT_KEYS: readonly string[] = [
  'at', 'cbsVersion', 'capability', 'cost', 'signals', 'rules',
  'negatives', 'history', 'proposals', 'evolutionAvailable', 'latestCbs', 'telemetry',
]

/** RPC 统一包装（与框架 Remote 调用约定一致）。 */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** RPC 面（由 api-remotes 挂载的 remote.diechiEvolution）。 */
export interface EvolutionRemote {
  overview(): Promise<RemoteResult<EvolutionSnapshot>>
  runCbs(input?: { commit?: boolean }): Promise<RemoteResult<EvolutionCbsOutcome>>
  signals(limit?: number): Promise<RemoteResult<EvolutionSignalTally>>
  proposals(limit?: number): Promise<RemoteResult<{ available: boolean; items: readonly EvolutionProposalView[] }>>
  history(limit?: number): Promise<RemoteResult<readonly EvolutionHistoryPoint[]>>
}
