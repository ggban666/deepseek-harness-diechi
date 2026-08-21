/** 阅历控制台本地载荷类型（与 diechi-brain RPC 对齐的结构形状）。 */

export interface BrainPracticeItem {
  readonly topic: string
  readonly content: string
  readonly tags: string
  readonly status: string
  readonly suggestedSkill: string
  readonly updatedAt: string
}

export interface BrainInboxSnapshot {
  readonly items: readonly BrainPracticeItem[]
}

export interface BrainAssignResult {
  readonly ok: boolean
  readonly error?: string
}