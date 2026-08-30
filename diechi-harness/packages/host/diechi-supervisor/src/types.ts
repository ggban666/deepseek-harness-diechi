/**
 * diechi-supervisor 类型契约：4 张新表的行类型 + bootstrap 配置。
 *
 * 不包含运行时代码（按 packages/AGENTS.md 规矩）。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/types
 */

/** 监督者决策原因枚举。 */
export type SupervisionReason =
  | 'no-authorization'
  | 'policy-violation'
  | 'rule-frozen'
  | 'low-trust'
  | 'bootstrap'

/** 决策枚举字符串（与 person-brain 侧 SupervisionDecision 保持一致）。 */
export type Decision = 'allow' | 'flag-review' | 'deny'

/** 一条负样本（写于 deny / flag-review 时）。 */
export interface NegativeSampleRow {
  readonly id: number
  readonly scope: string
  readonly payload: string
  readonly decision: Decision
  readonly reason: SupervisionReason | string
  readonly source: string
  readonly created_at: string
}

/**
 * 用户体感信号（S1 成功路径采集）。
 * 前两个是正样本，后两个是负样本——之所以不记进 negative_samples，
 * 是因为它们来自用户体感而非监督者闸拦截，两者语义不同、也不该混在一个池子里聚类。
 */
export type PositiveSignal = 'accepted' | 'no-rework' | 'user-undo' | 'explicit-bad'

/** 一条用户体感样本。 */
export interface PositiveSampleRow {
  readonly id: number
  readonly scope: string
  readonly payload: string
  readonly signal: PositiveSignal
  readonly latency_ms: number | null
  readonly cost_units: number | null
  readonly created_at: string
}

/** 一次基准回归的能力/成本快照（S0 度量层，A1/A2 的唯一度量来源）。 */
export interface CapabilitySnapshotRow {
  readonly id: number
  readonly at: string
  /** 冻结基准集版本——基准集只增不改，换版发新号，旧版作为回归项保留。 */
  readonly cbs_version: string
  /** 一次通过率 0..1，A1 单调性守卫对象。 */
  readonly c_score: number
  /** 归一化单次成本，A2 有界性守卫对象。 */
  readonly k_score: number
  readonly sample_count: number
  readonly commit_id: string | null
}

/** 一条提议（升级设计者写、监督者批）。 */
export interface ProposalRow {
  readonly id: number
  readonly proposer: string
  readonly target: string
  readonly change: string
  readonly evidence: string
  readonly status: 'pending' | 'allowed' | 'denied' | 'superseded'
  readonly created_at: string
  readonly reviewed_at: string | null
}

/** 一条冻结规则（监督者不能改自己的规则——物理上只接受 human 写入）。 */
export interface FrozenRuleRow {
  readonly id: string
  readonly reason: string
  readonly frozen_by: string
  readonly created_at: string
}

/** 一条授权（守门员查这张表）。 */
export interface AuthorizationRow {
  readonly scope: string
  readonly granted_by: string
  readonly granted_at: string
  readonly revoked_at: string | null
}

/** 启动时 bootstrap 预置的冻结规则。 */
export interface BootstrapFrozenRule {
  /** 点号路径（如 'person-brain:learn.policy.pii-redaction'）。 */
  readonly id: string
  readonly reason: string
}

/** 启动时 bootstrap 预置的授权。 */
export interface BootstrapAuthorization {
  readonly scope: string
  readonly reason: string
}

/** diechi-supervisor 启动配置。 */
export interface SupervisorBootstrapConfig {
  readonly freeze?: readonly BootstrapFrozenRule[]
  readonly authorize?: readonly BootstrapAuthorization[]
}

// ───────────────── S4 可感知层：度量网关载荷 ─────────────────
//
// 这些类型刻意定义在 types.ts（而不是 gateway.ts）：typert 生成器要求
// Remote 边界类型必须从包的**公共非根类型子路径**（即 ./types）导出，
// 否则生成的 remote-client 无法引用它们。

/** 体感信号计数（四条：赞 / 没返工 / 用户返工 / 明确说不对）。 */
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

/** 提议卡片视图（读自 evolve 插件，字段做扁平化处理）。 */
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

/** 最近一次 CBS 跑分（内存缓存，进程重启即清空）。 */
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
  /** 能力维：C(t) —— 一次通过率。只升不降是 A1 的目标而非保证。 */
  readonly capability: {
    readonly current: number
    readonly best: number
    readonly positive: number
    readonly total: number
  }
  /** 成本维：K(t) —— 每次决策要扫多少规则。 */
  readonly cost: {
    readonly current: number
    readonly ema: number
    readonly bandLo: number
    readonly bandHi: number
    readonly hardMax: number
    /** 当前成本落在哪一档：none / throttle / reject。 */
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

/** runCbs 的返回值：跑分 + 刷新后的快照（省一次往返）。 */
export interface EvolutionCbsOutcome {
  readonly cbs: EvolutionCbsView
  readonly snapshot: EvolutionSnapshot
}
