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
