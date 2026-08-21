/** 全局大脑（diechi-brain）RPC 载荷词汇：收件箱条目与操作请求。 */

/** 一条实操阅历（收件箱条目）。 */
export interface BrainPracticeItem {
  /** 知识主题键（如 "实操：手机贴膜"）。 */
  readonly topic: string
  /** 实操过程正文。 */
  readonly content: string
  /** 标签（逗号分隔，实操条目必然含 "实操"）。 */
  readonly tags: string
  /** 处置状态：pending（待归位）/ assigned（已归位）/ archived（已归档）。 */
  readonly status: string
  /** 自动归类的建议技能 id（空串表示无建议）。 */
  readonly suggestedSkill: string
  /** 最近更新的 ISO 时间戳。 */
  readonly updatedAt: string
}

/** 收件箱快照。 */
export interface BrainInboxSnapshot {
  readonly items: readonly BrainPracticeItem[]
}

/** 视频识别完成后客户端投递的实操输入。 */
export interface BrainIngestInput {
  /** 视频识别完成时间（ISO），用于去重。 */
  readonly at: string
  /** 视频文件名。 */
  readonly name: string
  /** 两阶段提炼出的实操过程正文。 */
  readonly process: string
  /** 视觉模型给出的技能草稿名称（自动归类建议用）。 */
  readonly suggestName?: string
}

/** 归位请求：把一条实操正式写入指定平权技能的大脑。 */
export interface BrainAssignInput {
  readonly topic: string
  readonly skillId: string
}

/** 标签更新请求。 */
export interface BrainTagsInput {
  readonly topic: string
  readonly tags: string
}

/** 删除请求。 */
export interface BrainRemoveInput {
  readonly topic: string
}

/** 归位结果。 */
export interface BrainAssignResult {
  readonly ok: boolean
  readonly error?: string
}