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
import { readdirSync } from 'node:fs'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  dshHomeDir, PersonBrain, type PersonKnowledge,
} from '@deepseek-ai/dsh-host-skill-store/person-brain'
import type {
  BrainAssignInput, BrainAssignResult, BrainConfirmInput, BrainGraphInput, BrainGraphSnapshot,
  BrainGraphNode, BrainGraphEdge, BrainIngestInput, BrainInboxSnapshot,
  BrainMemoryActionInput, BrainMemoryActionResult, BrainPendingMemoriesSnapshot, BrainPendingMemory,
  BrainPracticeItem, BrainRemoveInput, BrainSceneInput, BrainSceneItem,
  BrainSceneQuery, BrainTagsInput, GraphNodeType, SkillOverviewSnapshot,
} from './types.ts'

export type * from './types.ts'

/** 平权技能目录条目（消费 skillStore 作用域所需的最小形状）。 */
interface SkillCatalogEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly whenToUse: string
  readonly kind?: 'text' | 'vision'
  readonly enabled?: boolean
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
  /** 保存 ctx 供惰性 open globalBrain 时 attach supervisor（基类不存 ctx 引用）。 */
  private readonly ctxRef: Context

  constructor(ctx: Context) {
    super(ctx, 'diechiBrain')
    this.ctxRef = ctx
    // 卸载/热重载时释放 brain.db 句柄并退订视觉流，避免 watcher 泄漏。
    ctx.effect(() => {
      const dispose = ctx.skillVision?.watch((next) => {
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
      return () => {
        dispose?.()
        this.close()
      }
    }, 'diechi-brain: 退订视觉流并释放全局大脑')
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
      // 三架构基座保护：把全局大脑接入 ctx.supervision（若有），
      // 否则 learn/remember/seeScene 在缺监督者时抛 SupervisionMissingError。
      // 生产由 dsh-host-diechi-supervisor 提供；测试注入 stub。
      const supervision = this.ctxRef.get('supervision') as
        | { attachBrain?(brain: { setSupervisionContext(ctx: unknown): void }): void }
        | undefined
      if (supervision?.attachBrain !== undefined) {
        supervision.attachBrain(this.brain)
      }
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

  /**
   * 主脑聚合快照（阅历界面与图谱的统一数据基础）：
   * - 全局大脑收件箱全部知识（对话归纳/视频实操/提炼的实操经验/联网）；
   * - 各人格大脑中有信息量的记忆与场景，按技能聚合展示（避免与全局知识重复）。
   * 按更新时间倒序。
   */
  private snapshot(): BrainInboxSnapshot {
    const brain = this.globalBrain()
    const items: BrainPracticeItem[] = brain.listInbox('', '', 500).map(toPracticeItem)
    // 人格大脑：记忆（有信息量）+ 有信息量的场景，作为阅历素材补充。
    const personRoot = join(dshHomeDir(), 'persons')
    let personDirs: string[] = []
    try { personDirs = readdirSync(personRoot) } catch { personDirs = [] }
    for (const personId of personDirs) {
      if (personId.startsWith('.')) continue
      let pb: PersonBrain | undefined
      try { pb = PersonBrain.open(join(personRoot, personId)) } catch { continue }
      try {
        for (const m of pb.recall('', 100)) {
          if (m.content.trim() === '' || /测试完成请忽略|忽略此/.test(m.content)) continue
          items.push({
            topic: `记忆:${personId}:${m.id}`,
            content: m.content,
            tags: `记忆, ${personId}`,
            status: 'assigned',
            suggestedSkill: personId,
            source: m.source,
            updatedAt: m.createdAt,
            needsReview: false,
            supervisionDecision: m.supervisionDecision,
          })
        }
        // 场景：只展示有信息量的，且内容高度相似的聚合成一条（代表内容 + 次数），
        // 只展示最近 8 组，其余折叠计数。
        const scenes = pb.recallScenes(0, '', 300)
          .filter(s => s.content.trim() !== '' && pb.isInformativeScene(s.content))
        const sceneGroups: Array<{ content: string; count: number; latest: string; id: number; tokens: Set<string> }> = []
        for (const s of scenes) {
          const tokens = keywordTokens(s.content)
          let placed = false
          for (const group of sceneGroups) {
            if (group.tokens.size === 0 || tokens.size === 0) continue
            let overlap = 0
            for (const token of tokens) if (group.tokens.has(token)) overlap++
            const score = overlap / Math.min(tokens.size, group.tokens.size)
            if (score >= 0.5) {
              group.count += 1
              if (s.endedAt > group.latest) group.latest = s.endedAt
              placed = true
              break
            }
          }
          if (!placed) sceneGroups.push({ content: s.content, count: 1, latest: s.endedAt, id: s.id, tokens })
        }
        sceneGroups.sort((a, b) => (a.latest < b.latest ? 1 : -1))
        const shownScenes = sceneGroups.slice(0, 8)
        const hiddenScenes = sceneGroups.slice(8).reduce((sum, g) => sum + g.count, 0)
        for (const group of shownScenes) {
          items.push({
            topic: `场景:${personId}:${group.id}`,
            content: group.content + (group.count > 1 ? `（同一画面出现 ${group.count} 次）` : ''),
            tags: `视频素材, ${personId}`,
            status: 'assigned',
            suggestedSkill: personId,
            source: 'video',
            updatedAt: group.latest,
            needsReview: false,
            supervisionDecision: 'allow',
          })
        }
        if (hiddenScenes > 0) {
          items.push({
            topic: `场景:${personId}:rest`,
            content: `另有 ${hiddenScenes} 次画面记录已折叠（内容与展示的场景相近）。`,
            tags: `视频素材, ${personId}`,
            status: 'assigned',
            suggestedSkill: personId,
            source: 'video',
            updatedAt: shownScenes[0]?.latest ?? '',
            needsReview: false,
            supervisionDecision: 'allow',
          })
        }
      } finally {
        pb.close()
      }
    }
    // 去重：同 topic 只保留一条（全局优先），按更新时间倒序。
    const seen = new Set<string>()
    const unique = items.filter(item => {
      if (seen.has(item.topic)) return false
      seen.add(item.topic)
      return true
    })
    unique.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    return { items: unique }
  }

  /** 把一条实操写入全局大脑（#实操 标签 + 自动归类建议）。 */
  @Remote('ingest')
  ingest(input: BrainIngestInput): BrainInboxSnapshot {
    const topic = '实操：' + (input.name.trim() || '视频投喂')
    const brain = this.globalBrain()
    brain.learn(topic, input.process.trim(), PRACTICE_TAG, 'video', false, true)
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
      // 三架构基座保护：person brain 写入也走 gateWrite —— attach ctx.supervision
      const supervision = this.ctxRef.get('supervision') as
        | { attachBrain?(brain: { setSupervisionContext(ctx: unknown): void }): void }
        | undefined
      if (supervision?.attachBrain !== undefined) {
        supervision.attachBrain(personBrain)
      }
      personBrain.learn(row.topic, row.content, row.tags || PRACTICE_TAG, row.source || 'video')
      personBrain.close()
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'assign-failed' }
    }
    brain.setPracticeMeta(topic, { status: 'assigned', suggestedSkill: skillId })
    console.log('[diechi-brain] 实操归位 →', skillId, topic)
    return { ok: true }
  }

  /** 更新一条知识的标签。 */
  @Remote('setTags')
  setTags(input: BrainTagsInput): boolean {
    const topic = input.topic.trim()
    if (topic === '') return false
    const rows = this.globalBrain().recallKnowledge(topic)
    const row = rows[0]
    if (row === undefined) return false
    const tags = input.tags.trim()
    // 实操条目保留实操标记；对话/联网条目不强加，避免来源误导。
    const merged = row.tags.includes(PRACTICE_TAG) && !tags.includes(PRACTICE_TAG)
      ? `${PRACTICE_TAG}, ${tags}`.replace(/,\s*$/, '')
      : tags
    return this.globalBrain().setPracticeMeta(topic, { tags: merged })
  }

  /** 删除一条实操。 */
  @Remote('removeItem')
  removeItem(input: BrainRemoveInput): boolean {
    return this.globalBrain().removeKnowledge(input.topic.trim())
  }

  /**
   * 确认一条待核对知识：内容无误后清除待确认标记，并补上自动归类建议
   * （不直接归位——归属仍由用户/后续流程决定，与普通待归位条目一致）。
   * @returns 是否确认成功（条目不存在或本就不待确认返回 false）。
   */
  @Remote('confirm')
  confirm(input: BrainConfirmInput): boolean {
    const topic = input.topic.trim()
    if (topic === '') return false
    const brain = this.globalBrain()
    const rows = brain.recallKnowledge(topic)
    const row = rows[0]
    if (row === undefined || !row.needsReview) return false
    // 重新跑一次自动归类建议（确认时的技能目录可能已变化）。
    const suggested = this.suggestSkill(row.content, row.topic)
    const patch: { needsReview: boolean; suggestedSkill?: string } = { needsReview: false }
    if (suggested !== '') patch.suggestedSkill = suggested
    brain.setPracticeMeta(topic, patch)
    console.log('[diechi-brain] 已确认 →', topic, suggested !== '' ? `建议 ${suggested}` : '（无建议）')
    return true
  }

  /**
   * 待确认记忆列表（自动除幻觉标记 + 低置信度写入），按技能分组，供用户核对。
   * 用户确认后记忆才参与注入；删除则彻底移除。
   */
  @Remote('pendingMemories')
  pendingMemories(): BrainPendingMemoriesSnapshot {
    const skillCatalog = this.ctx.skillStore?.get().skills ?? []
    const titleById = new Map(skillCatalog.map(entry => [entry.id, entry.title ?? entry.id]))
    const items: BrainPendingMemory[] = []
    const collect = (skillId: string, pb: PersonBrain, reason: string): void => {
      for (const m of pb.recallPendingMemories(200)) {
        items.push({
          id: m.id,
          skillId,
          skillTitle: titleById.get(skillId) ?? skillId,
          content: m.content,
          source: m.source,
          createdAt: m.createdAt,
          reason,
        })
      }
    }
    const personRoot = join(dshHomeDir(), 'persons')
    let personDirs: string[] = []
    try { personDirs = readdirSync(personRoot) } catch { personDirs = [] }
    for (const personId of personDirs) {
      if (personId.startsWith('.')) continue
      try {
        const pb = PersonBrain.open(join(personRoot, personId))
        try { collect(personId, pb, '待确认记忆（低置信度/自动除幻觉标记）') } finally { pb.close() }
      } catch { /* 大脑损坏：跳过 */ }
    }
    return { items }
  }

  /** 处置一条待确认记忆：confirm=true 解除标记（参与注入）；否则删除。 */
  @Remote('memoryAction')
  memoryAction(input: BrainMemoryActionInput): BrainMemoryActionResult {
    const id = Math.trunc(input.id)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'invalid-id' }
    const personRoot = join(dshHomeDir(), 'persons')
    let personDirs: string[] = []
    try { personDirs = readdirSync(personRoot) } catch { personDirs = [] }
    for (const personId of personDirs) {
      if (personId.startsWith('.')) continue
      try {
        const pb = PersonBrain.open(join(personRoot, personId))
        try {
          if (input.confirm) {
            if (pb.confirmMemory(id)) {
              console.log('[diechi-brain] 记忆已确认 →', personId, id)
              return { ok: true }
            }
          } else if (pb.removeMemory(id)) {
            console.log('[diechi-brain] 待确认记忆已删除 →', personId, id)
            return { ok: true }
          }
        } finally {
          pb.close()
        }
      } catch { /* 大脑损坏：继续找下一个 */ }
    }
    return { ok: false, error: 'not-found' }
  }

  /**
   * 知识图谱（主脑整理）：返回节点与逻辑关联边。
   * - 节点来源：全局大脑的知识 + 所有人格大脑的记忆/场景/知识（按技能归属），
   *   未归位记忆/场景由主脑按语义归属到最相关技能，归属不到留全局。
   * - 橙色实操节点 = 已确认可行（status=assigned）且 是视频实操 或 内容描述行动方法/步骤；
   *   记忆为绿色，其余知识为蓝色。
   * - 边规则（逻辑关联，非关键词乱连）：
   *   同技能簇内节点互相连接（同一知识体系）；未归位节点需共享 ≥2 个关键词才连（确实相关）；
   *   不同技能簇之间绝不连接（每个技能的阅历是孤立的）。
   */
  @Remote('graph')
  graph(input: BrainGraphInput): BrainGraphSnapshot {
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 80)))
    const skillId = (input.skillId ?? '').trim()
    const brain = this.globalBrain()
    const allKnowledge = brain.listInbox('', '', limit * 2)
    const nodes: BrainGraphNode[] = []
    const seen = new Set<string>()
    const addNode = (node: BrainGraphNode): void => {
      if (seen.has(node.id)) return
      seen.add(node.id)
      nodes.push(node)
    }
    // 橙色判定：只显示「主脑提炼的实操经验」（source=practice，distillPractice 产物）
    // 与「完整视频实操过程」（source=video 的全局入库条目）。
    // 原始画面场景与记忆是素材，不单独染橙。
    const isActionable = (k: { status: string; source: string; tags: string }): boolean => {
      if (k.status !== 'assigned') return false
      if (k.source === 'practice') return true
      if (k.source === 'video') return true
      return /实操/.test(k.tags)
    }
    // 全局大脑的知识（含技能归属）。
    for (const k of allKnowledge) {
      if (skillId !== '' && k.suggestedSkill !== skillId) continue
      const nodeType: GraphNodeType = isActionable(k) ? 'scene' : 'knowledge'
      addNode({
        id: k.topic,
        type: nodeType,
        label: k.topic.replace(/^(对话|实操)：/, '').trim().slice(0, 30),
        content: k.content,
        source: k.source,
        updatedAt: k.updatedAt,
        skillId: k.suggestedSkill,
        keywords: [...keywordTokens(k.content + ' ' + k.topic)],
      })
    }
    // 人格大脑：该人格的知识 + 记忆（绿）+ 场景（橙，视频实操），按技能归属。
    const personRoot = join(dshHomeDir(), 'persons')
    let personDirs: string[] = []
    try { personDirs = readdirSync(personRoot) } catch { personDirs = [] }
    for (const personId of personDirs) {
      if (personId.startsWith('.')) continue
      if (skillId !== '' && personId !== skillId) continue
      let pb: PersonBrain | undefined
      try { pb = PersonBrain.open(join(personRoot, personId)) } catch { continue }
      try {
        // 技能视图：该人格的完整阅历（知识+记忆+场景）；全局视图：只取记忆+场景
        // （知识已在全局大脑体现，避免与全局重复）。
        if (skillId !== '') {
          for (const k of pb.listInbox('', '', limit)) {
            const nodeType: GraphNodeType = isActionable(k) ? 'scene' : 'knowledge'
            addNode({
              id: `person:${personId}:${k.topic}`,
              type: nodeType,
              label: k.topic.replace(/^(对话|实操)：/, '').trim().slice(0, 30),
              content: k.content,
              source: k.source,
              updatedAt: k.updatedAt,
              skillId: personId,
              keywords: [...keywordTokens(k.content + ' ' + k.topic)],
            })
          }
        }
        for (const m of pb.recall('', limit)) {
          if (m.content.trim() === '') continue
          addNode({
            id: `person:${personId}:mem:${m.id}`,
            type: 'memory',
            label: m.content.slice(0, 40),
            content: m.content,
            source: m.source,
            updatedAt: m.createdAt,
            skillId: personId,
            keywords: [...keywordTokens(m.content)],
          })
        }
        // 场景是实操素材：只展示有信息量的（无实质变化的画面噪音不单独成节点），
        // 且按 memory 类型展示（绿），橙色留给主脑提炼的实操经验。
        // 内容高度相似的场景聚合成一条节点（代表内容 + 出现次数）——同一持续
        // 画面的不同描述（张嘴说话/低头/闭眼）按 token 重叠归并，避免几十条
        // 重复画面刷出一堆节点。
        const scenes = pb.recallScenes(0, '', 300)
          .filter(s => s.content.trim() !== '' && pb.isInformativeScene(s.content))
        const sceneGroups: Array<{ content: string; count: number; latest: string; id: number; tokens: Set<string> }> = []
        for (const s of scenes) {
          const tokens = keywordTokens(s.content)
          let placed = false
          for (const group of sceneGroups) {
            if (group.tokens.size === 0 || tokens.size === 0) continue
            let overlap = 0
            for (const token of tokens) if (group.tokens.has(token)) overlap++
            const score = overlap / Math.min(tokens.size, group.tokens.size)
            if (score >= 0.5) {
              group.count += 1
              if (s.endedAt > group.latest) group.latest = s.endedAt
              placed = true
              break
            }
          }
          if (!placed) sceneGroups.push({ content: s.content, count: 1, latest: s.endedAt, id: s.id, tokens })
        }
        // 只展示最近 8 组有代表性的场景（按时间倒序），其余合并计数。
        sceneGroups.sort((a, b) => (a.latest < b.latest ? 1 : -1))
        const shown = sceneGroups.slice(0, 8)
        const hiddenCount = sceneGroups.slice(8).reduce((sum, g) => sum + g.count, 0)
        for (const group of shown) {
          const suffix = group.count > 1 ? ` ×${group.count}` : ''
          addNode({
            id: `person:${personId}:scene:${group.id}`,
            type: 'memory',
            label: (group.content.slice(0, 36) + suffix),
            content: group.content + (group.count > 1 ? `\n（同一画面出现 ${group.count} 次，已合并）` : ''),
            source: 'video',
            updatedAt: group.latest,
            skillId: personId,
            keywords: [...group.tokens],
          })
        }
        if (hiddenCount > 0) {
          addNode({
            id: `person:${personId}:scene:rest`,
            type: 'memory',
            label: `更多画面 ×${hiddenCount}`,
            content: `另有 ${hiddenCount} 次画面记录已折叠（内容与展示的场景相近）。`,
            source: 'video',
            updatedAt: shown[0]?.latest ?? '',
            skillId: personId,
            keywords: [],
          })
        }
      } finally {
        pb.close()
      }
    }
    // 未归位记忆（全局大脑 memories）→ 主脑按语义归属，归属不到留全局。
    const skillCatalog = this.ctx.skillStore?.get().skills ?? []
    const assignSkill = (text: string): string => {
      const textTokens = keywordTokens(text)
      if (textTokens.size === 0) return ''
      let best = ''
      let bestScore = 0
      for (const entry of skillCatalog) {
        const entryTokens = keywordTokens(`${entry.title ?? ''} ${entry.description ?? ''} ${entry.whenToUse ?? ''}`)
        if (entryTokens.size === 0) continue
        let overlap = 0
        for (const token of textTokens) if (entryTokens.has(token)) overlap++
        if (overlap < 2) continue
        const score = overlap / Math.min(textTokens.size, entryTokens.size)
        if (score > bestScore) { bestScore = score; best = entry.id }
      }
      return bestScore >= 0.3 ? best : ''
    }
    for (const m of brain.recall('', limit)) {
      if (m.content.trim() === '') continue
      const home = assignSkill(m.content)
      if (skillId !== '' && home !== skillId) continue
      addNode({
        id: `mem:${m.id}`,
        type: 'memory',
        label: m.content.slice(0, 40),
        content: m.content,
        source: m.source,
        updatedAt: m.createdAt,
        skillId: home,
        keywords: [...keywordTokens(m.content)],
      })
    }
    // 构建边（主脑逻辑关联）：
    // - 同技能簇（skillId 非空且相同）→ 逻辑相关，共享 1 个关键词即连；
    // - 未归位（skillId 为空）→ 共享 ≥2 个关键词才连（确实相关才相连）；
    // - 不同技能簇之间不连（阅历孤立）。
    const edges: BrainGraphEdge[] = []
    for (let i = 0; i < nodes.length; i++) {
      const ni = nodes[i]!
      const niKwSet = new Set(ni.keywords)
      for (let j = i + 1; j < nodes.length; j++) {
        const nj = nodes[j]!
        if (ni.skillId !== '' && nj.skillId !== '' && ni.skillId !== nj.skillId) continue
        let weight = 0
        for (const kw of nj.keywords) {
          if (niKwSet.has(kw)) weight++
        }
        const minWeight = ni.skillId === '' || nj.skillId === '' ? 2 : 1
        if (weight >= minWeight) {
          edges.push({ source: ni.id, target: nj.id, weight })
        }
      }
    }
    return { nodes, edges }
  }

  /**
   * 供 skill-store 的人格 recall 合并：返回实操阅历（按关键词过滤）。
   * 待确认条目不参与注入（未经用户核对，不能进模型上下文）。
   * @param query - 回忆关键词；空串返回最近实操。
   * @param limit - 条数上限。
   */
  recallPractice(query: string, limit: number): PersonKnowledge[] {
    const all = this.globalBrain().listPractice('', limit)
    const usable = all.filter(item => !item.needsReview)
    return query.trim() === ''
      ? usable
      : usable.filter(item => item.topic.includes(query) || item.content.includes(query))
  }

  /** 目标大脑：skillId > 当前勾选技能 > 全局大脑。 */
  private sceneBrain(skillId = ''): { brain: PersonBrain; close: boolean } {
    const target = skillId.trim() !== ''
      ? skillId.trim()
      : (this.ctx.skillStore?.get().skills.find(entry => entry.enabled === true)?.id ?? '')
    if (target !== '') {
      return { brain: PersonBrain.open(join(dshHomeDir(), 'persons', target)), close: true }
    }
    return { brain: this.globalBrain(), close: false }
  }

  /** 写入一条视觉记忆（场景时间线）：同画面自动合并，超上限自动清洗。 */
  @Remote('ingestScene')
  ingestScene(input: BrainSceneInput): BrainSceneItem | undefined {
    const content = (input.content ?? '').trim()
    if (content === '') return undefined
    const { brain, close } = this.sceneBrain(input.skillId)
    try {
      const scene = brain.seeScene(content, input.fingerprint ?? '')
      // 后台顺带做容量清洗（保留最近 2000 条场景）。
      brain.cleanupScenes(2000)
      return {
        id: scene.id,
        startedAt: scene.startedAt,
        endedAt: scene.endedAt,
        content: scene.content,
        count: scene.count,
      }
    } finally {
      if (close) brain.close()
    }
  }

  /** 检索视觉记忆（时间窗 + 关键词）。 */
  @Remote('recallScenes')
  recallScenes(input: BrainSceneQuery): { count: number; scenes: readonly BrainSceneItem[] } {
    const sinceMs = (input.sinceMinutes ?? 0) > 0
      ? Date.now() - (input.sinceMinutes ?? 0) * 60_000
      : 0
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20) || 20))
    const { brain, close } = this.sceneBrain(input.skillId)
    try {
      const scenes = brain.recallScenes(sinceMs, input.query ?? '', limit)
      return {
        count: scenes.length,
        scenes: scenes.map(scene => ({
          id: scene.id,
          startedAt: scene.startedAt,
          endedAt: scene.endedAt,
          content: scene.content,
          count: scene.count,
        })),
      }
    } finally {
      if (close) brain.close()
    }
  }

  /** 技能库现状：每个平权技能的画像 + 全局未归位实操计数。 */
  @Remote('overview')
  overview(): SkillOverviewSnapshot {
    const catalog = this.ctx.skillStore?.get().skills ?? []
    const global = this.globalBrain()
    const practices = global.listPractice('', 500)
    const bySkill = new Map<string, number>()
    for (const item of practices) {
      if (item.status === 'assigned' && item.suggestedSkill !== '') {
        bySkill.set(item.suggestedSkill, (bySkill.get(item.suggestedSkill) ?? 0) + 1)
      }
    }
    const pending = global.listInbox('pending', '', 500).length
    const skills = catalog.map((entry) => {
      let memoryCount = 0
      let sceneCount = 0
      let knowledgeCount = 0
      let lastActiveAt = ''
      try {
        const pb = PersonBrain.open(join(dshHomeDir(), 'persons', entry.id))
        memoryCount = pb.countMemories()
        sceneCount = pb.countScenes()
        knowledgeCount = pb.countKnowledge()
        lastActiveAt = pb.lastActivityAt()
        pb.close()
      } catch {
        // 技能大脑未物化或损坏：按空处理，不影响目录。
      }
      return {
        id: entry.id,
        title: entry.title,
        description: entry.description ?? '',
        kind: entry.kind ?? 'text',
        enabled: entry.enabled === true,
        memoryCount,
        sceneCount,
        knowledgeCount,
        practiceCount: bySkill.get(entry.id) ?? 0,
        lastActiveAt,
      }
    })
    return { skills, pendingPracticeCount: pending, newSkillSuggestions: this.newSkillSuggestions() }
  }

  /**
   * 新主题检测：全局收件箱里「未归位且无建议」的条目按中文二元组聚类，
   * 同一主题出现 ≥2 次视为值得沉淀的新主题，供阅历控制台一键创建技能。
   */
  private newSkillSuggestions(): { title: string; count: number; example: string }[] {
    const pending = this.globalBrain().listInbox('pending', '', 500)
      .filter(item => item.suggestedSkill === '' && !item.needsReview)
    const cluster = new Map<string, { count: number; example: string }>()
    for (const item of pending) {
      const text = item.topic.replace(/^(对话|实操)：/, '')
      const tokens = keywordTokens(text)
      for (const token of tokens) {
        if (!/[\u4e00-\u9fff]/.test(token)) continue
        const cur = cluster.get(token)
        if (cur !== undefined) {
          cur.count += 1
        } else {
          cluster.set(token, { count: 1, example: item.content })
        }
      }
    }
    return [...cluster.entries()]
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([title, v]) => ({ title, count: v.count, example: v.example.slice(0, 80) }))
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
    source: row.source,
    updatedAt: row.updatedAt,
    needsReview: row.needsReview,
    supervisionDecision: row.supervisionDecision,
  }
}

export default BrainGateway