/**
 * diechi-evolve 类型契约：提议草案（draft）与数据库行（row）。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/types
 */

/** 提议状态。 */
export type ProposalStatus = 'pending' | 'allowed' | 'denied' | 'superseded'

/**
 * 提议的"修改"目标。
 *
 * 历史死结：P2 阶段**只**产出 `add-rule`（把 scope 写进 frozen_rules 永久 deny）。
 * 那意味着系统唯一的"学习"动作是把自己越勒越紧——跑一万次后所有写入全部 deny，
 * 系统彻底瘫死。这是**学久必瘫**，不是学久变强，公理 A1 在这里是**反向**的。
 *
 * 现在扩到 8 种，其中 5 种是"增加能力"而非"禁止动作"。
 */
export type ProposalChangeKind =
  /** 冻结某 scope——**最后手段**，仅当无任何正样本且失败极高频时使用。 */
  | 'add-rule'
  /** 把成功套路固化成一个可复用技能（平权技能）。 */
  | 'add-skill'
  /** 把成功案例存进案例库，供 RAG 检索复用。 */
  | 'add-case'
  /** 新增/修正一段 system prompt 片段。 */
  | 'add-prompt'
  /** 调整路由表：哪类任务用哪个模型 / 采样数 N。 */
  | 're-route'
  /** 放宽或收紧某 scope 的授权。 */
  | 'revise-scope'
  /**
   * 清理无效固化——**唯一允许删的类型**，且必须过双门证明不劣。
   * A1 要求能力只增不减；删只在"删掉的是负债"时成立，故门槛最高。
   */
  | 'prune-cache'
  /**
   * M3：给现有技能打补丁——只改 persona / 知识 / 流程（md 文件），**永不改代码**。
   * 这是打破「只有一个动作=禁止」架构死结的关键一环：返工聚类的产出不再是
   * 「别再做了」，而是「这么做更好」。rollbackPlan 必须说明如何回退补丁段落。
   */
  | 'patch-skill'
  /** 历史类型：启动时把已知该冻结的基线化。新逻辑不再生成，保留仅为兼容旧数据。 */
  | 'add-bootstrap'

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
  /** 为什么这个修改能减少负样本（或增加正样本）。 */
  readonly rationale: string
  /** 撤回步骤（必填）。 */
  readonly rollbackPlan: string
  /**
   * 预估能力增量 ΔC（一次通过率，0..1 尺度）。
   * 排序用；真实值由沙盒跑 CBS 后回填，这里的估算只决定"先试哪个"。
   */
  readonly estimatedDc: number
  /**
   * 预估成本增量 ΔK（归一化成本倍率）。负数表示省钱。
   * 固化类提议天然为负——采样的收益一次性，固化的收益永久性。
   */
  readonly estimatedDk: number
  /** add-rule 专用：冻结会永久 deny 写入，必须 human 二次确认。 */
  readonly needsHumanConfirm?: boolean
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
  /** M3：golden set 回归结果（allowed 时跑；c 低于地板时提议自动降级 superseded）。 */
  readonly goldenSet?: { readonly c: number; readonly passed: number; readonly total: number }
  /** 降级原因（golden set 未过时填写）。 */
  readonly rejectedReason?: string
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
