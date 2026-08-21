/**
 * 全局大脑插件（diechi-brain）：用户跨人格共享的实操阅历层。
 *
 * 职责：
 *  - 监听 skill-store 提供的 skillVision 作用域，把视频投喂识别出的
 *    #实操 过程自动写入全局大脑（$DSH_HOME/brain.db），不依赖任何
 *    人格勾选；
 *  - 入库时自动归类：对已有平权技能做关键词匹配，给出建议归属技能；
 *  - 提供 BrainGateway RPC（list / ingest / assign / setTags / removeItem），
 *    供「阅历控制台」客户端插件浏览、归位、改标签、删除；
 *  - 提供 recallPractice 服务方法，供 skill-store 的人格 recall 合并
 *    实操阅历（人格聊天时能引用用户真实做过的实操）。
 *
 * 本插件可独立插拔：移除后视频实操不再自动入库，控制台不可用，
 * 人格 recall 仅退回自身记忆。
 *
 * @module @deepseek-ai/dsh-host-diechi-brain
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { join } from 'node:path'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  dshHomeDir, PersonBrain, type PersonKnowledge,
} from '@deepseek-ai/dsh-host-skill-store/person-brain'
import type {
  BrainAssignInput, BrainAssignResult, BrainIngestInput, BrainInboxSnapshot,
  BrainPracticeItem, BrainRemoveInput, BrainTagsInput,
} from './types.ts'

export type * from './types.ts'

/** 平权技能目录条目（消费 skillStore 作用域所需的最小形状）。 */
interface SkillCatalogEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly whenToUse: string
}

/** skill-store 提供的目录作用域（结构类型，避免循环依赖）。 */
interface SkillStoreScopeLike {
  get(): { skills: readonly SkillCatalogEntry[] }
}

/** skill-store 提供的视觉作用域（结构类型）。 */
interface VisionScopeLike {
  watch(callback: (next: VisionStateLike) => void): () => void
}

interface VisionStateLike {
  videoProcess?: { at: string; name: string; process: string } | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** skill-store 插件提供的目录作用域。 */
    skillStore?: SkillStoreScopeLike
    /** skill-store 插件提供的视觉作用域。 */
    skillVision?: VisionScopeLike
  }
}

/** 实操入库去重（按视频识别时间戳）。 */
const PRACTICE_TAG = '实操'

/** 关键词分词：ASCII 词 + 中文二元组，用于技能自动归类。 */
function keywordTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const ascii = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (const word of ascii) tokens.add(word)
  const chunks = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length - 1; i += 1) tokens.add(chunk.slice(i, i + 2))
  }
  return tokens
}

/**
 * 全局大脑网关：收件箱管理 RPC + 实操入库 + recall 合并服务。
 */
export class BrainGateway extends TypertRemoteService {
  /** 依赖 skill-store 提供的目录与视觉作用域。 */
  static inject = ['skillStore', 'skillVision']

  private brain: PersonBrain | undefined
  /** 本会话已入库的视频（按 at 时间戳去重）。 */
  private readonly ingested = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'diechiBrain')
    // 卸载/热重载时释放 brain.db 句柄。
    ctx.effect(() => () => { this.close() }, 'diechi-brain: 释放全局大脑')
    ctx.skillVision?.watch((next) => {
      const pending = next.videoProcess
      if (pending === undefined) return
      const key = 'video:' + pending.at
      if (this.ingested.has(key)) return
      const content = pending.process.trim()
      if (content === '') return
      this.ingested.add(key)
      try {
        this.ingest({ at: pending.at, name: pending.name, process: content })
        console.log('[diechi-brain] 视频实操已入库 → 全局大脑', pending.name)
      } catch (error) {
        console.error('[diechi-brain] 视频实操入库失败', error)
      }
    })
  }

  /** 关闭全局大脑（释放句柄；下次访问会重新打开）。 */
  close(): void {
    this.brain?.close()
    this.brain = undefined
  }

  /** 惰性打开全局大脑（$DSH_HOME/brain.db）。 */
  private globalBrain(): PersonBrain {
    if (this.brain === undefined) {
      this.brain = PersonBrain.openGlobal()
      console.log('[diechi-brain] 全局大脑已打开 →', this.brain.path)
    }
    return this.brain
  }

  /** 自动归类：对过程正文 + 技能草稿名做关键词匹配，返回建议技能 id。 */
  private suggestSkill(text: string, suggestName?: string): string {
    const combined = `${text}\n${suggestName ?? ''}`
    const textTokens = keywordTokens(combined)
    if (textTokens.size === 0) return ''
    const entries = this.ctx.skillStore?.get().skills ?? []
    let best = ''
    let bestScore = 0
    for (const entry of entries) {
      const title = entry.title.trim() || entry.id
      const bodyTokens = keywordTokens(`${title} ${entry.description ?? ''} ${entry.whenToUse ?? ''}`)
      let score = 0
      for (const token of bodyTokens) {
        if (textTokens.has(token)) score += /[a-z0-9]/.test(token) ? 2 : 1
      }
      const titleTokens = keywordTokens(title)
      for (const token of titleTokens) {
        if (textTokens.has(token)) score += 3
      }
      if (score > bestScore) {
        bestScore = score
        best = entry.id
      }
    }
    // 至少 3 分才算有把握的建议（避免把无关联技能硬拉进来）。
    return bestScore >= 3 ? best : ''
  }

  /** 收件箱快照。 */
  private snapshot(): BrainInboxSnapshot {
    const items = this.globalBrain().listPractice().map(toPracticeItem)
    return { items }
  }

  /** 把一条实操写入全局大脑（#实操 标签 + 自动归类建议）。 */
  @Remote('ingest')
  ingest(input: BrainIngestInput): BrainInboxSnapshot {
    const topic = '实操：' + (input.name.trim() || '视频投喂')
    const brain = this.globalBrain()
    brain.learn(topic, input.process.trim(), PRACTICE_TAG)
    const suggested = this.suggestSkill(input.process, input.suggestName)
    if (suggested !== '') brain.setPracticeMeta(topic, { suggestedSkill: suggested })
    return this.snapshot()
  }

  /** 列出全部实操阅历（按更新时间倒序）。 */
  @Remote('list')
  list(): BrainInboxSnapshot {
    return this.snapshot()
  }

  /** 归位：把一条实操正式写入指定平权技能的大脑，并标记已归位。 */
  @Remote('assign')
  assign(input: BrainAssignInput): BrainAssignResult {
    const topic = input.topic.trim()
    const skillId = input.skillId.trim()
    if (topic === '' || skillId === '') return { ok: false, error: 'empty-input' }
    const brain = this.globalBrain()
    const rows = brain.recallKnowledge(topic)
    const row = rows[0]
    if (row === undefined) return { ok: false, error: 'not-found' }
    try {
      const personBrain = PersonBrain.open(join(dshHomeDir(), 'persons', skillId))
      personBrain.learn(row.topic, row.content, row.tags || PRACTICE_TAG)
      personBrain.close()
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'assign-failed' }
    }
    brain.setPracticeMeta(topic, { status: 'assigned', suggestedSkill: skillId })
    console.log('[diechi-brain] 实操归位 →', skillId, topic)
    return { ok: true }
  }

  /** 更新一条实操的标签。 */
  @Remote('setTags')
  setTags(input: BrainTagsInput): boolean {
    const topic = input.topic.trim()
    if (topic === '') return false
    // 实操标记必须保留，否则条目会从收件箱列表消失。
    const tags = input.tags.trim()
    const merged = tags.includes(PRACTICE_TAG) ? tags : (tags === '' ? PRACTICE_TAG : `${PRACTICE_TAG}, ${tags}`)
    return this.globalBrain().setPracticeMeta(topic, { tags: merged })
  }

  /** 删除一条实操。 */
  @Remote('removeItem')
  removeItem(input: BrainRemoveInput): boolean {
    return this.globalBrain().removeKnowledge(input.topic.trim())
  }

  /**
   * 供 skill-store 的人格 recall 合并：返回实操阅历（按关键词过滤）。
   * @param query - 回忆关键词；空串返回最近实操。
   * @param limit - 条数上限。
   */
  recallPractice(query: string, limit: number): PersonKnowledge[] {
    const all = this.globalBrain().listPractice('', limit)
    return query.trim() === ''
      ? all
      : all.filter(item => item.topic.includes(query) || item.content.includes(query))
  }
}

/** PersonKnowledge → RPC 载荷。 */
function toPracticeItem(row: PersonKnowledge): BrainPracticeItem {
  return {
    topic: row.topic,
    content: row.content,
    tags: row.tags,
    status: row.status,
    suggestedSkill: row.suggestedSkill,
    updatedAt: row.updatedAt,
  }
}

export default BrainGateway