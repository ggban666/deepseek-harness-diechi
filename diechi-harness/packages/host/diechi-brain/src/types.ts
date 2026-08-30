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
  /** 来源：conversation（对话归纳）/ video（视频实操）/ web（联网）/ user（用户直述）。 */
  readonly source: string
  /** 最近更新的 ISO 时间戳。 */
  readonly updatedAt: string
  /** 待人工确认：低置信度归纳先打标记，确认（confirm RPC）后才参与归位与注入。 */
  readonly needsReview: boolean
  /**
   * 监督者写入决策：'allow' | 'flag-review' | 'deny'。
   * flag-review：行已落库但 needs_review=1，等用户确认；
   * deny：通常不会到这里（已抛 SupervisionDeniedError），但 tool 调试时可能留痕。
   * UI / 阅历控制台读这个字段显示"待审"或"已被监督者标了"标记。
   */
  readonly supervisionDecision: 'allow' | 'flag-review' | 'deny'
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

/** 确认待核对条目请求：内容无误，可参与归位与注入。 */
export interface BrainConfirmInput {
  readonly topic: string
}

/** 归位结果。 */
export interface BrainAssignResult {
  readonly ok: boolean
  readonly error?: string
}

/** 一条视觉记忆场景（场景时间线）。 */
export interface BrainSceneItem {
  /** 自增 id。 */
  readonly id: number
  /** 场景开始时间（ISO）。 */
  readonly startedAt: string
  /** 场景最后活跃时间（ISO）。 */
  readonly endedAt: string
  /** 结构化场景描述（人物/物体/动作/变化）。 */
  readonly content: string
  /** 合并次数。 */
  readonly count: number
}

/** 视觉记忆写入请求。 */
export interface BrainSceneInput {
  /** 结构化场景描述。 */
  readonly content: string
  /** 画面指纹（可选，去重合并用）。 */
  readonly fingerprint?: string
  /** 目标技能 id（可选；缺省写当前勾选技能，无勾选写全局大脑）。 */
  readonly skillId?: string
}

/** 视觉记忆检索请求。 */
export interface BrainSceneQuery {
  /** 检索关键词（可选）。 */
  readonly query?: string
  /** 只看最近 N 分钟（可选，0 不限）。 */
  readonly sinceMinutes?: number
  /** 条数上限。 */
  readonly limit?: number
  /** 目标技能 id（可选）。 */
  readonly skillId?: string
}

/** 知识图谱节点类型。 */
export type GraphNodeType = 'knowledge' | 'memory' | 'scene'

/** 知识图谱中的一个节点。 */
export interface BrainGraphNode {
  /** 唯一标识（topic 或 memory id）。 */
  readonly id: string
  /** 节点类型。 */
  readonly type: GraphNodeType
  /** 显示标题（ topic 去掉前缀，或记忆内容摘要）。 */
  readonly label: string
  /** 节点正文（悬停/点击详情用）。 */
  readonly content: string
  /** 来源（conversation / video / user 等）。 */
  readonly source: string
  /** 更新时间（ISO）。 */
  readonly updatedAt: string
  /** 所属技能 id（空串表示全局）。 */
  readonly skillId: string
  /** 关键词标签（用于构建边）。 */
  readonly keywords: readonly string[]
}

/** 知识图谱中的一条边（两节点共享至少一个关键词）。 */
export interface BrainGraphEdge {
  /** 起点节点 id。 */
  readonly source: string
  /** 终点节点 id。 */
  readonly target: string
  /** 共享关键词数量。 */
  readonly weight: number
}

/** 知识图谱快照。 */
export interface BrainGraphSnapshot {
  /** 节点列表。 */
  readonly nodes: readonly BrainGraphNode[]
  /** 边列表（仅有关联的节点对）。 */
  readonly edges: readonly BrainGraphEdge[]
}

/** 知识图谱查询请求。 */
export interface BrainGraphInput {
  /** 目标技能 id；空串返回全局大脑图谱。 */
  readonly skillId?: string
  /** 节点数上限。 */
  readonly limit?: number
}
/** 技能库现状（阅历总览）：一个平权技能的画像。 */
export interface SkillOverviewEntry {
  /** 技能 id（目录键）。 */
  readonly id: string
  /** 显示名。 */
  readonly title: string
  /** 一句话简介。 */
  readonly description: string
  /** 文本 / 视觉 类型。 */
  readonly kind: 'text' | 'vision'
  /** 是否启用（当前在用）。 */
  readonly enabled: boolean
  /** 该技能大脑的记忆条数。 */
  readonly memoryCount: number
  /** 该技能大脑的场景条数（视觉记忆素材）。 */
  readonly sceneCount: number
  /** 该技能大脑的知识条数。 */
  readonly knowledgeCount: number
  /** 归位到该技能的实操条数。 */
  readonly practiceCount: number
  /** 最近活动（记忆/知识写入）ISO 时间，空串表示从未。 */
  readonly lastActiveAt: string
}

/** 技能库现状快照（overview RPC）。 */
export interface SkillOverviewSnapshot {
  readonly skills: readonly SkillOverviewEntry[]
  /** 全局未归位实操条数。 */
  readonly pendingPracticeCount: number
  /** 反复出现但无归属的新主题（≥2 条未归类知识簇），可一键创建新技能。 */
  readonly newSkillSuggestions: readonly { title: string; count: number; example: string }[]
}

/** 一条待确认记忆（疑似幻觉/低置信度，需用户核对）。 */
export interface BrainPendingMemory {
  /** 记忆 id。 */
  readonly id: number
  /** 所属技能 id。 */
  readonly skillId: string
  /** 技能显示名。 */
  readonly skillTitle: string
  /** 记忆正文。 */
  readonly content: string
  /** 来源（user / conversation 等）。 */
  readonly source: string
  /** 创建时间（ISO）。 */
  readonly createdAt: string
  /** 标记原因（自动除幻觉扫描 / 低置信度写入）。 */
  readonly reason: string
}

/** 待确认记忆列表快照。 */
export interface BrainPendingMemoriesSnapshot {
  readonly items: readonly BrainPendingMemory[]
}

/** 待确认记忆处置请求。 */
export interface BrainMemoryActionInput {
  /** 记忆 id。 */
  readonly id: number
  /** 确认 = 解除待确认；否则删除。 */
  readonly confirm: boolean
}

/** 待确认记忆处置结果。 */
export interface BrainMemoryActionResult {
  readonly ok: boolean
  readonly error?: string
}
