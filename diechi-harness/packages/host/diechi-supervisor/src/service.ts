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
  type NegativeSampleRow,
} from './types.ts'
import { SupervisorDb } from './db.ts'
import type {
  AgentRoleService,
  SupervisionContext,
  SupervisionInput,
  SupervisionResult,
} from '@deepseek-ai/dsh-host-skill-store'

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

  constructor(
    // @ts-expect-error P3.6 早期未使用：未来 supervision/decision 事件走 cordis event bus 时使用。
    private readonly ctx: Context,
    private readonly db: SupervisorDb,
    private readonly agentRole?: AgentRoleService,
  ) {}

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
    // 1) frozen_rules 优先——临时身份也不豁免
    const frozen = this.db.getFrozenRule(input.scope)
    if (frozen !== undefined) {
      const sampleId = this.writeSample(input, 'deny', 'rule-frozen')
      return { decision: 'deny', reason: 'rule-frozen', sampleId }
    }

    // 2) 临时身份"批自己"检测——source 字段含 'role:designer' 且本 service 持有 AgentRoleService
    //    且 AgentRoleService.current() === 'designer' → 不能批自己写的提议
    //    （PersonBrain 不直接拿 ctx——这里靠 source 字段携带角色信息）
    if (this.agentRole !== undefined && input.source !== undefined) {
      const match = /(?:^|:)role:(\w+)$/.exec(input.source)
      if (match !== null) {
        const sourceRole = match[1]
        if (
          sourceRole !== undefined &&
          sourceRole !== 'subject' &&
          sourceRole === this.agentRole.current() &&
          input.scope === 'evolution:propose'
        ) {
          const sampleId = this.writeSample(input, 'deny', 'self-proposal-blocked')
          return { decision: 'deny', reason: 'self-proposal-blocked', sampleId }
        }
      }
    }

    // 3) 查 authorizations
    const auth = this.db.getAuthorization(input.scope)
    if (auth !== undefined) {
      return { decision: 'allow' }
    }

    // 4) 默认 deny + 写负样本
    const sampleId = this.writeSample(input, 'deny', 'no-authorization')
    return { decision: 'deny', reason: 'no-authorization', sampleId }
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
