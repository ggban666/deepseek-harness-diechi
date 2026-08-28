/**
 * diechi-evolve 类型契约：提议草案（draft）与数据库行（row）。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/types
 */

/** 提议状态。 */
export type ProposalStatus = 'pending' | 'allowed' | 'denied' | 'superseded'

/** 提议的"修改"目标：当前 P2 仅支持 'add-rule'。 */
export type ProposalChangeKind = 'add-rule' | 'revise-scope' | 'add-bootstrap'

/** 提议的"修改"内容（string format = `<kind>:<id> <details>`）。 */
export interface ProposalChange {
  readonly kind: ProposalChangeKind
  /** 目标 id（如 'person-brain:learn.policy.pii-redaction'）。 */
  readonly id: string
  /** 详情（kind 不同含义不同：add-rule → rule 内容；revise-scope → policy）。 */
  readonly details: string
}

/** 提议草案（model / 升级设计者生成）。 */
export interface ProposalDraft {
  /** 修改目标 scope（如 'person-brain:learn'）。 */
  readonly target: string
  /** 修改内容。 */
  readonly change: ProposalChange
  /** 引用的负样本 id 列表。 */
  readonly evidence: readonly number[]
  /** 为什么这个修改能减少负样本。 */
  readonly rationale: string
  /** 撤回步骤（必填）。 */
  readonly rollbackPlan: string
}

/** 数据库行。 */
export interface ProposalRow {
  readonly id: number
  readonly proposer: string
  readonly target: string
  readonly change: string
  readonly evidence: string
  readonly status: ProposalStatus
  readonly created_at: string
  readonly reviewed_at: string | null
}

/** 提议评审结果。 */
export interface ProposalReview {
  readonly id: number
  readonly status: ProposalStatus
  readonly reviewed_at: string
}

/** 提议被允许后实际应用到监督者数据库的副作用（由 host 在 review 后调）。 */
export interface ProposalApply {
  /** 应用到 frozen_rules 还是 authorizations。 */
  readonly target: 'frozen_rules' | 'authorizations'
  /** 表 id / scope 名。 */
  readonly id: string
  /** 备注（frozen_rules.reason / authorizations 自身无 reason）。 */
  readonly reason?: string
}
