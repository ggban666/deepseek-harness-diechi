/**
 * diechi-supervisor 核心服务：实现 SupervisionContext 接口
 * （decide / recordDeny / recordFlag），让 PersonBrain 注入。
 *
 * 决策流程 deterministic 查表（不调 LLM），避免奖励黑客。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/service
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  type CapabilitySnapshotRow,
  type NegativeSampleRow,
  type PositiveSignal,
  type PositiveSampleRow,
} from './types.ts'
import { SupervisorDb } from './db.ts'
import { CapabilityGate } from './gate.ts'
import type { GateConfig, GateInput, GateResult } from './gate.ts'
import { CBS_V1, CbsRunner } from './cbs.ts'
import type {
  AgentRoleService,
  SupervisionContext,
  SupervisionDecision,
  SupervisionInput,
  SupervisionResult,
} from '@deepseek-ai/dsh-host-skill-store'

/**
 * 纯决策函数：只看规则表，不写库、不 emit 事件、不依赖 cordis。
 *
 * 抽出来的理由：CBS 基准集必须测**生产跑的那套判定**，
 * 如果基准集自己复刻一份逻辑，测出来的分数就是假的（测的是影子代码）。
 * 监督者服务与基准集共用这一个函数，保证「测的就是跑的」。
 *
 * A3 可判定性在这里落到代码层面：这是一个纯函数，给定同样的规则表与输入，
 * 永远得到同样的结果——不调 LLM，没有随机性。
 *
 * @param db 任意提供规则查询的库（生产库或沙盒副本）
 * @param input 决策输入
 * @param currentRole 当前临时角色；undefined 表示未启用角色机制
 */
export function decidePure(
  db: Pick<SupervisorDb, 'getFrozenRule' | 'getAuthorization'>,
  input: SupervisionInput,
  currentRole?: string,
): { decision: SupervisionDecision; reason?: string } {
  // 1) frozen_rules 优先——临时身份也不豁免
  if (db.getFrozenRule(input.scope) !== undefined) {
    return { decision: 'deny', reason: 'rule-frozen' }
  }

  // 2) 临时身份"批自己"检测：source 形如 '...:role:designer' 且当前正以该角色运行
  if (currentRole !== undefined && input.source !== undefined) {
    const match = /(?:^|:)role:(\w+)$/.exec(input.source)
    if (match !== null) {
      const sourceRole = match[1]
      if (
        sourceRole !== undefined &&
        sourceRole !== 'subject' &&
        sourceRole === currentRole &&
        input.scope === 'evolution:propose'
      ) {
        return { decision: 'deny', reason: 'self-proposal-blocked' }
      }
    }
  }

  // 3) 查 authorizations
  if (db.getAuthorization(input.scope) !== undefined) {
    return { decision: 'allow' }
  }

  // 4) 默认 deny
  return { decision: 'deny', reason: 'no-authorization' }
}

/** 监督者类型（供其他 host 包通过 SupervisorLike 协议注入）。 */
export interface SupervisorLike {
  listNegativeSamples(limit: number): readonly { id: number; scope: string; reason: string }[]
  freezeRule(id: string, reason: string, frozenBy?: string): void
  authorizeScope(scope: string, grantedBy?: string): void
  revokeAuthorization(scope: string): boolean
  listFrozenRules(): readonly { id: string; reason: string; frozen_by: string }[]
}

/** 监督者核心服务。 */
/** 一次决策的事件载荷。 */
export interface SupervisionDecisionEvent {
  readonly scope: string
  readonly decision: 'allow' | 'flag-review' | 'deny'
  readonly reason: string
  readonly source: string | undefined
  readonly sampleId: number | undefined
  readonly at: string
}

export class SupervisorService implements SupervisionContext {
  /** 当前 open 的所有 PersonBrain 句柄——cordis 启动时由 host 注入。 */
  private readonly brains = new Set<{
    setSupervisionContext(ctx: SupervisionContext): void
    setWorldModelContext?(wm: unknown): void
  }>()

  /** 注入世界模型（可选）。setWorldModelContext 存在时自动绑定到所有后续 attachBrain。 */
  private worldModel: unknown = undefined

  bindWorldModel(wm: unknown): void {
    this.worldModel = wm
    // 已经 attach 的 brain 也补注入
    for (const brain of this.brains) {
      brain.setWorldModelContext?.(wm)
    }
  }

  /** 决策观察者集合（diechi-evolve 订阅实时累计）。 */
  private readonly decisionObservers = new Set<(e: SupervisionDecisionEvent) => void>()

  /** 双门（A1 单调性 + A2 有界性的执行者）。deterministic，不调 LLM。 */
  private readonly gate: CapabilityGate

  constructor(
    // @ts-expect-error P3.6 早期未使用：未来 supervision/decision 事件走 cordis event bus 时使用。
    private readonly ctx: Context,
    private readonly db: SupervisorDb,
    private readonly agentRole?: AgentRoleService,
    gateConfig: Partial<GateConfig> = {},
  ) {
    this.gate = new CapabilityGate(db, gateConfig)
  }

  // ---- 注入管理：cordis 启动时由 host 把已 open 的 PersonBrain 注入 ----

  /** 把一个 PersonBrain 接入监督者。 */
  attachBrain(brain: {
    setSupervisionContext(ctx: SupervisionContext): void
    setWorldModelContext?(wm: unknown): void
  }): void {
    brain.setSupervisionContext(this)
    if (this.worldModel !== undefined) {
      brain.setWorldModelContext?.(this.worldModel)
    }
    this.brains.add(brain)
  }

  /** 解除一个 PersonBrain 的监督者注入（plugin unload 时调用）。 */
  detachBrain(brain: { setSupervisionContext(ctx: SupervisionContext): void }): void {
    this.brains.delete(brain)
  }

  /** 解除所有（plugin unload 时调用）。 */
  detachAll(): void {
    this.brains.clear()
  }

  // ---- 决策核心（deterministic 查表） ----

  /**
   * 决策流程：
   * 1) 查 frozen_rules：命中即 deny（与当前角色无关——临时身份不豁免）
   * 2) 临时身份检测：如果 source 字段是 'role:<role>' 且提议审批类的写入，
   *    且临时身份角色与本 service 持有的 AgentRoleService.current() 相同 → deny
   *    （护栏 1：临时身份不能批自己）
   * 3) 查 authorizations：未撤销即 allow
   * 4) 默认 deny + 写 negative_samples
   */
  decide(input: SupervisionInput): SupervisionResult {
    const result = this.decideCore(input)
    // P3.6 事件总线：emit supervision/decision 给订阅者（diechi-evolve 实时累计）
    // 用 try-catch 防止观察者抛错影响主决策
    for (const observer of this.decisionObservers) {
      try {
        observer({
          scope: input.scope,
          decision: result.decision,
          reason: result.reason ?? 'unspecified',
          source: input.source,
          sampleId: result.sampleId,
          at: new Date().toISOString(),
        })
      } catch {
        // 观察者抛错吞掉——基座决策不应被订阅者影响
      }
    }
    return result
  }

  /**
   * 内部决策：纯查表，无事件 emit。
   * 拆出来便于测试 + 让 decide() 的"emit 事件"逻辑可独立观察。
   */
  private decideCore(input: SupervisionInput): SupervisionResult {
    // 判定本身委托给 decidePure——与 CBS 基准集共用同一份逻辑，
    // 「测的就是跑的」。记账（写样本）留在这里，基准集跑的时候不该记账。
    const verdict = decidePure(this.db, input, this.agentRole?.current())

    if (verdict.decision === 'allow') {
      // S1：成功路径不再静默。此前 allow 直接 return，系统只记录"哪里错了"、
      // 从不记录"什么是对的"——只从失败学习的系统，最优解是"什么都不做"。
      // 这里记一条乐观体感样本（no-rework），用户若点"这不对/我返工了"，
      // 前端再补记 explicit-bad / user-undo，C(t) 自然被拉低。
      this.recordAllow(input)
      return { decision: 'allow' }
    }

    const reason = verdict.reason ?? 'no-authorization'
    const sampleId = this.writeSample(input, verdict.decision as 'deny' | 'flag-review', reason)
    return { decision: verdict.decision, reason, sampleId }
  }

  /** 注册决策观察者（diechi-evolve 用）。返回 disposer。 */
  onDecision(observer: (e: SupervisionDecisionEvent) => void): () => void {
    this.decisionObservers.add(observer)
    return () => { this.decisionObservers.delete(observer) }
  }

  recordDeny(input: SupervisionInput, reason: string): number {
    return this.writeSample(input, 'deny', reason)
  }

  recordFlag(input: SupervisionInput, reason: string): number {
    return this.writeSample(input, 'flag-review', reason)
  }

  // ---- S0/S1 度量与体感采集 ----
  // 死结 2 的解药：此前 allow 分支直接 return，系统从不记录"什么是对的"。
  // 只从失败中学习的系统，最优解是"什么都不做"——因为什么都不做就不会失败。

  /**
   * 体感采集节流：allow 是高频路径，同一 scope 在节流窗内只记一条。
   *
   * 这两个字段刻意不是 private：度量网关要把"当前节流窗口是多少"显示给前端。
   * 一个看不见自己采集策略的可观测系统，等于让人对着黑箱调参。
   */
  private readonly telemetryThrottle = new Map<string, number>()
  telemetryThrottleMs = 1000
  telemetryEnabled = true

  /** 配置体感采集（host 从 settings 读后注入）。 */
  configureTelemetry(opts: { enabled?: boolean; throttleMs?: number }): void {
    if (opts.enabled !== undefined) this.telemetryEnabled = opts.enabled
    if (opts.throttleMs !== undefined && opts.throttleMs >= 0) this.telemetryThrottleMs = opts.throttleMs
  }

  /** allow 时记一条乐观正样本。异常一律吞掉——埋点绝不能影响主决策（A3）。 */
  private recordAllow(input: SupervisionInput): void {
    if (!this.telemetryEnabled) return
    const now = Date.now()
    const last = this.telemetryThrottle.get(input.scope) ?? 0
    if (now - last < this.telemetryThrottleMs) return
    this.telemetryThrottle.set(input.scope, now)
    try {
      this.db.insertPositiveSample(
        input.scope,
        JSON.stringify({ payload: input.payload ?? {}, source: input.source ?? 'unknown' }),
        'no-rework',
      )
    } catch {
      // 埋点失败静默：监督者的主职责是判定，不是采集
    }
  }

  /**
   * 上报一条用户体感信号（P3 返工按钮 / 采纳按钮 / no-rework 检测）。
   * 这是 C(t) 的**主体**来源——闸只知道自己放行了，只有用户知道做得对不对。
   */
  recordSignal(
    scope: string,
    signal: PositiveSignal,
    detail?: { payload?: unknown; latencyMs?: number; costUnits?: number },
  ): number {
    return this.db.insertPositiveSample(
      scope,
      JSON.stringify(detail?.payload ?? {}),
      signal,
      detail?.latencyMs,
      detail?.costUnits,
    )
  }

  /** 列出最近体感样本。 */
  listPositiveSamples(limit = 100): readonly PositiveSampleRow[] {
    return this.db.listPositiveSamples(limit)
  }

  /**
   * M3：对话路径的价值信号写入点（负样本重定义的一半）。
   *
   * 此前 negative_samples 的唯一写入点是闸拦截（watchdog 崩溃路径）——系统越崩越瘫。
   * 现在「用户返工」成为一等公民：user-undo / explicit-bad 在写正样本表（C(t) 分母）
   * 的同时，写一条 reason='user-rework' 的负样本，让 evolve 能聚类出 patch-skill。
   * 崩溃路径照旧写入但进化侧降权（analyzeSamples 只在 scope 零正样本时才考虑冻结）。
   */
  recordUserSignal(
    scope: string,
    signal: PositiveSignal,
    detail?: { payload?: unknown; latencyMs?: number; costUnits?: number; source?: string },
  ): { positiveId: number; negativeId: number | null } {
    const positiveId = this.recordSignal(scope, signal, detail)
    if (signal !== 'user-undo' && signal !== 'explicit-bad') {
      return { positiveId, negativeId: null }
    }
    let negativeId: number | null = null
    try {
      negativeId = this.db.insertNegativeSample(
        scope,
        JSON.stringify(detail?.payload ?? {}),
        'flag-review',
        'user-rework',
        detail?.source ?? 'dialogue',
      )
    } catch {
      // 负样本写失败不影响正样本（C(t) 分母优先保住）
    }
    return { positiveId, negativeId }
  }

  /**
   * M3：golden set 回归——提议生效前后的判据。
   * 跑 CBS_V1 基准集（liveness/safety/pii 三族，确定性查表测试），返回一次通过率。
   * evolve 的 reviewProposal 用它做双门之一：提议 allowed 后 C 若跌破地板，
   * 提议自动降级为 superseded（A1 回归门 C′≥C−ε 的工程落地）。
   */
  runGoldenSet(): { c: number; passed: number; total: number; k?: number } {
    const result = new CbsRunner(CBS_V1).run(this.db)
    return { c: result.cScore, passed: result.passed, total: result.total, k: result.kScore }
  }

  /**
   * 当前一次通过率 C(t)——A1 单调性的度量对象。
   * C = 正信号 / 总信号。用户每补记一次返工，分子分母同时 +1，C 自然被拉低。
   */
  currentScore(sinceMs?: number): { c: number; positive: number; total: number } {
    const stats = this.db.countSignalsByKind(sinceMs)
    const positive = stats.accepted + stats['no-rework']
    const negative = stats['user-undo'] + stats['explicit-bad']
    const total = positive + negative
    return { c: total === 0 ? 0 : positive / total, positive, total }
  }

  /** 写一次基准回归快照（S0）。cbsVersion 如 'CBS-v1'——基准集只增不改，换版发新号。 */
  recordSnapshot(
    cbsVersion: string,
    cScore: number,
    kScore: number,
    sampleCount: number,
    commitId?: string,
  ): number {
    return this.db.insertSnapshot(cbsVersion, cScore, kScore, sampleCount, commitId)
  }

  /** 最近 N 次回归快照。 */
  listSnapshots(limit = 200): readonly CapabilitySnapshotRow[] {
    return this.db.listSnapshots(limit)
  }

  /** 最新一次快照（回归门的比较基线）。 */
  latestSnapshot(cbsVersion?: string): CapabilitySnapshotRow | undefined {
    return this.db.latestSnapshot(cbsVersion)
  }

  /** 历史最高 C——单调守卫跟历史最优比，不跟上一枪比（否则一次抖动永久拉低基线）。 */
  bestScore(cbsVersion?: string): number | undefined {
    return this.db.bestScore(cbsVersion)
  }

  /** 清理过期体感样本。 */
  cleanupPositiveSamples(keepCount = 20000): number {
    return this.db.cleanupPositiveSamples(keepCount)
  }

  // ---- S3 双门 ----

  /**
   * 对一个候选版本跑双门（deterministic，不调 LLM）。
   * 沙盒跑完 CBS 得到 cScore / kScore 后调用；不过门的提议应自动 denied，
   * 并把 `result.reason` 写进 negative_samples。
   */
  evaluateProposal(input: GateInput): GateResult {
    return this.gate.evaluate(input)
  }

  /** 当前双门配置（回归容差 / 成本软带 / 硬顶）。 */
  gateConfig(): GateConfig {
    return this.gate.config()
  }

  /** 当前滑动成本基线 K̄（EMA）。 */
  costBaseline(cbsVersion?: string): number {
    return this.gate.kBar(cbsVersion)
  }

  // ---- 监督者自身不能改规则——这些是 human-only RPC，由 ctx 暴露 ----

  /** 人类冻结一条规则（caller 由 host 鉴权）。 */
  freezeRule(id: string, reason: string, frozenBy = 'human'): void {
    this.db.insertFrozenRule(id, reason, frozenBy)
  }

  /** 人类授权一个 scope（caller 由 host 鉴权）。 */
  authorizeScope(scope: string, grantedBy = 'human'): void {
    this.db.insertAuthorization(scope, grantedBy)
  }

  /** 人类撤销授权（caller 由 host 鉴权）。 */
  revokeAuthorization(scope: string): boolean {
    return this.db.revokeAuthorization(scope)
  }

  /** 测试用：暴露内部 db 让测试走同一 handle。 */
  getDb(): SupervisorDb {
    return this.db
  }

  /** 只读：列出最近 N 条负样本。 */
  listNegativeSamples(limit = 100): readonly NegativeSampleRow[] {
    return this.db.listNegativeSamples(limit) as unknown as readonly NegativeSampleRow[]
  }

  /** 清理过期负样本（保留最近 keepCount 条）。返回清理条数。 */
  cleanupNegativeSamples(keepCount = 5000): number {
    return this.db.cleanupNegativeSamples(keepCount)
  }

  /** 只读：列出所有冻结规则。 */
  listFrozenRules(): readonly { id: string; reason: string; frozen_by: string }[] {
    return this.db.listFrozenRules()
  }

  // ---- 内部 ----

  private writeSample(input: SupervisionInput, decision: 'deny' | 'flag-review', reason: string): number {
    return this.db.insertNegativeSample(
      input.scope,
      JSON.stringify(input.payload ?? {}),
      decision,
      reason,
      input.source ?? 'unknown',
    )
  }
}
