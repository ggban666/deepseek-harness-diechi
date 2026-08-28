/**
 * PersonBrain 监督者契约：diechi-supervisor 插件通过 setSupervisionContext
 * 注入到 PersonBrain 实例。PersonBrain.learn / remember / seeScene 在缺
 * 监督者时抛 SupervisionMissingError，在监督者就位时调 decide() 拿到决策。
 *
 * @module @deepseek-ai/dsh-host-skill-store/supervision
 */

/** 监督者对单次写入的决策结果。 */
export type SupervisionDecision = 'allow' | 'flag-review' | 'deny'

/** 业务写入的 scope 命名空间：'<brain>:<method>'。 */
export type SupervisionScope =
  | 'person-brain:remember'
  | 'person-brain:learn'
  | 'person-brain:see-scene'
  | 'diechi-brain:ingest-video'
  | 'diechi-brain:ingest-conversation'
  | 'diechi-brain:suggest-skill'
  | 'evolution:propose'

/** 监督者决策入参。 */
export interface SupervisionInput {
  /** 写入操作的 scope（如 'person-brain:learn'）。 */
  readonly scope: SupervisionScope | string
  /** 写入载荷的 JSON 序列化（用于模式匹配与负样本去重）。 */
  readonly payload: Readonly<Record<string, unknown>>
  /** 调用方标识（插件名 / personId），便于审计。 */
  readonly source?: string
}

/** 监督者决策结果。 */
export interface SupervisionResult {
  readonly decision: SupervisionDecision
  /** 当 decision !== 'allow' 时的具体原因。 */
  readonly reason?: string
  /** 写到的 negative_samples 行 id（deny / flag-review 时）。 */
  readonly sampleId?: number
}

/** 注入到 PersonBrain 的监督者上下文接口。 */
export interface SupervisionContext {
  /** 同步决策入口——MVP 不调 LLM，纯查表。 */
  decide(input: SupervisionInput): SupervisionResult
  /** 记录一次失败（PersonBrain 内部 deny 时调用）。 */
  recordDeny(input: SupervisionInput, reason: string): number
  /** 记录一次 flag-review。 */
  recordFlag(input: SupervisionInput, reason: string): number
}

/** 监督者未挂载时抛——基座保护的核心。 */
export class SupervisionMissingError extends Error {
  constructor(message = 'PersonBrain: 缺少 ctx.supervision。基座未挂 dsh-host-diechi-supervisor。') {
    super(message)
    this.name = 'SupervisionMissingError'
  }
}

/** 监督者拒绝写入时抛。 */
export class SupervisionDeniedError extends Error {
  constructor(reason: string) {
    super(`PersonBrain: 监督者拒绝写入。reason=${reason}`)
    this.name = 'SupervisionDeniedError'
  }
}
