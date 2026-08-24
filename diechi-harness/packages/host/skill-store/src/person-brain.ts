/**
 * 人格大脑（PersonBrain）—— 每个人格包的持久化记忆层。
 *
 * 「人格 = 数据库(大脑) + 能力(skill) + 人格(提示词)」中的数据库部分：
 * 每个启用的人格在 $DSH_HOME/persons/<id>/ 下拥有自己的 SQLite 大脑
 * （brain.db），随人格热装载/热卸载，与人格提示词、工具一起构成一个
 * 完整的「人」。记忆分两类：
 *  - memories：情节/事实记忆（episodic / semantic / fact），模型通过
 *    remember/recall 工具读写，供人格跨对话回忆；
 *  - knowledge：长期知识（按主题幂等 upsert），供人格学习沉淀。
 *
 * 实现用 Node 22+ 内置 node:sqlite（DatabaseSync），零额外依赖。
 *
 * @module @deepseek-ai/dsh-web-app/person-brain
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** 一条人格记忆（recall 的返回单元）。 */
export interface PersonMemory {
  /** 自增 id，用于后续删除/引用。 */
  readonly id: number
  /** 记忆类型：episodic（经历）/ semantic（语义）/ fact（事实）等。 */
  readonly kind: string
  /** 记忆正文（一句话为宜，便于检索与上下文注入）。 */
  readonly content: string
  /** 重要性 1-5，recall 排序权重。 */
  readonly importance: number
  /** 来源：user（用户直述）/ conversation（对话归纳）/ video（视频实操）/ web（联网）。 */
  readonly source: string
  /** 主题键（可空），用于归并与归类。 */
  readonly topic: string
  /** ISO 时间戳。 */
  readonly createdAt: string
  /** 待人工确认标记（自动除幻觉：低置信度/疑似推断的记忆不参与注入，确认后才生效）。 */
  readonly needsReview: boolean
}

/** 一条人格长期知识。 */
export interface PersonKnowledge {
  /** 主题键，upsert 幂等。 */
  readonly topic: string
  /** 知识正文。 */
  readonly content: string
  /** 标签（逗号分隔，如 "实操,8D"），用于区分实操/理论等来源。 */
  readonly tags: string
  /** 阅历处置状态：pending（待归位）/ assigned（已归位）/ archived（已归档）。 */
  readonly status: string
  /** 自动归类的建议技能 id（空串表示无建议）。 */
  readonly suggestedSkill: string
  /** 知识来源：conversation（对话归纳）/ video（视频实操）/ web（联网）/ user（用户直述）。 */
  readonly source: string
  /** 最近更新的 ISO 时间戳。 */
  readonly updatedAt: string
  /** 待人工确认：低置信度归纳先打标记，用户确认后才参与归位/注入。 */
  readonly needsReview: boolean
}

/** 一条视觉记忆（场景时间线：同一画面持续期间合并为一条）。 */
export interface PersonScene {
  /** 自增 id。 */
  readonly id: number
  /** 场景开始时间（ISO）。 */
  readonly startedAt: string
  /** 场景最后活跃时间（ISO），同场景合并时刷新。 */
  readonly endedAt: string
  /** 场景内容（结构化描述：人物/物体/动作/变化）。 */
  readonly content: string
  /** 合并次数（画面持续刷新了多少帧/次）。 */
  readonly count: number
  /** 首次写入时间（ISO）。 */
  readonly createdAt: string
  /** 画面指纹（客户端帧 hash）；空串表示写入时未提供。 */
  readonly fingerprint: string
}

/** 蝶翅数据根目录：`$DSH_HOME`，未设置时回退 `~/.dsh`。 */
export function dshHomeDir(): string {
  const fromEnv = (process.env.DSH_HOME ?? '').trim()
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** 默认的 schema；CREATE IF NOT EXISTS，可安全重复执行。 */
const BRAIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'episodic',
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  topic TEXT NOT NULL DEFAULT '',
  needs_review INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories (created_at DESC);
CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  content TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_scenes_started ON scenes (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenes_fingerprint ON scenes (fingerprint, started_at DESC);
CREATE TABLE IF NOT EXISTS knowledge (
  topic TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  suggested_skill TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'video',
  updated_at TEXT NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 0
);
`

/**
 * 一个人格包的 SQLite 大脑。打开即建库建表；close() 后不可再使用。
 */
export class PersonBrain {
  /** 大脑目录（含 brain.db）。 */
  readonly dir: string

  private readonly db: DatabaseSync
  private closed = false

  private constructor(dir: string, db: DatabaseSync) {
    this.dir = dir
    this.db = db
  }

  /**
   * 打开（必要时创建）一个人格的大脑。
   * @param dir - 人格包目录，brain.db 落在其下。
   * @returns 打开好的大脑句柄。
   */
  static open(dir: string): PersonBrain {
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'brain.db'))
    // 迁移必须先于 BRAIN_SCHEMA：旧库缺列时 CREATE INDEX（fingerprint）会先失败。
    for (const column of ['tags TEXT NOT NULL DEFAULT \'\'', 'status TEXT NOT NULL DEFAULT \'pending\'', 'suggested_skill TEXT NOT NULL DEFAULT \'\'', 'source TEXT NOT NULL DEFAULT \'video\'', 'needs_review INTEGER NOT NULL DEFAULT 0']) {
      try {
        db.exec(`ALTER TABLE knowledge ADD COLUMN ${column}`)
      } catch {
        // 已存在（新库 CREATE 已含），忽略。
      }
    }
    for (const column of ['source TEXT NOT NULL DEFAULT \'user\'', 'topic TEXT NOT NULL DEFAULT \'\'', 'needs_review INTEGER NOT NULL DEFAULT 0']) {
      try {
        db.exec(`ALTER TABLE memories ADD COLUMN ${column}`)
      } catch {
        // 已存在（新库 CREATE 已含），忽略。
      }
    }
    try {
      db.exec('ALTER TABLE scenes ADD COLUMN fingerprint TEXT NOT NULL DEFAULT \'\'')
    } catch {
      // 已存在（新库 CREATE 已含），忽略。
    }
    db.exec(BRAIN_SCHEMA)
    // WAL：多连接并发（人格大脑与全局大脑同文件）时读写互不阻塞。
    try {
      db.exec('PRAGMA journal_mode = WAL')
    } catch {
      // 只读文件系统等场景忽略，退回默认 journal。
    }
    return new PersonBrain(dir, db)
  }
  /**
   * 打开全局大脑：蝶翅数据根目录（$DSH_HOME）下的 brain.db。
   * 全局大脑承载用户跨人格共享的阅历（如视频实操 #实操），任何人格
   * 勾选与否都能写入，勾选后可通过 recall 引用。
   */
  static openGlobal(): PersonBrain {
    const home = dshHomeDir()
    mkdirSync(home, { recursive: true })
    return PersonBrain.open(home)
  }

  /** brain.db 的绝对路径（供展示/备份）。 */
  get path(): string {
    return join(this.dir, 'brain.db')
  }

  /**
   * 记一条记忆。
   * @param content - 记忆正文。
   * @param kind - 记忆类型，默认 episodic。
   * @param importance - 1-5，默认 1。
   * @param needsReview - 待人工确认：低置信度/疑似推断的记忆打标记，确认前不参与注入。
   * @returns 写入后的记忆行。
   */
  remember(content: string, kind = 'episodic', importance = 1, source = 'user', topic = '', needsReview = false): PersonMemory {
    this.assertOpen()
    const createdAt = new Date().toISOString()
    const safeImportance = Math.max(1, Math.min(5, Math.trunc(importance) || 1))
    // 永久去重：完全相同的记忆只保留一条（重要性取 max，刷新时间）。
    const existing = this.db.prepare(
      'SELECT id, kind, content, importance, created_at, needs_review FROM memories WHERE content = ? ORDER BY id DESC LIMIT 1',
    ).get(content)
    if (existing !== undefined) {
      const row = existing as { id: number; kind: string; content: string; importance: number; created_at: string; needs_review: number }
      if (safeImportance > row.importance || source !== 'user' || needsReview) {
        this.db.prepare('UPDATE memories SET importance = ?, source = ?, topic = ?, created_at = ?, needs_review = ? WHERE id = ?')
          .run(Math.max(row.importance, safeImportance), source, topic, createdAt, needsReview ? 1 : row.needs_review, row.id)
        return toMemory({ ...row, importance: Math.max(row.importance, safeImportance), source, topic, created_at: createdAt, needs_review: needsReview ? 1 : row.needs_review })
      }
      return toMemory(row)
    }
    // 相似合并：内容高度相似（去掉口语差异后相同）的记忆并入既有行，
    // 保留信息量更全的一条，避免「名字叫小蝶」「名字是小蝶」刷成多条。
    const similar = this.findSimilarMemory(content)
    if (similar !== undefined) {
      const keep = similar.content.length >= content.length ? similar.content : content
      const mergedImportance = Math.max(similar.importance, safeImportance)
      this.db.prepare('UPDATE memories SET content = ?, importance = ?, source = ?, topic = ?, created_at = ?, needs_review = ? WHERE id = ?')
        .run(keep, mergedImportance, source, topic, createdAt, needsReview ? 1 : similar.needsReview ? 1 : 0, similar.id)
      return toMemory({ id: similar.id, kind, content: keep, importance: mergedImportance, source, topic, createdAt, needs_review: needsReview ? 1 : similar.needsReview ? 1 : 0 })
    }
    const result = this.db.prepare(
      'INSERT INTO memories (kind, content, importance, created_at, source, topic, needs_review) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(kind, content, safeImportance, createdAt, source, topic, needsReview ? 1 : 0)
    return {
      id: Number(result.lastInsertRowid),
      kind,
      content,
      importance: safeImportance,
      source,
      topic,
      createdAt,
      needsReview,
    }
  }

  /**
   * 找内容高度相似的已有记忆（口语化差异容忍）：去标点/语气词/系动词后相同，
   * 或短文本（归一化后 ≤14 字、无数字差异）编辑距离 ≤ 1，
   * 或长文本（>14 字）token 重叠 ≥ 0.7（如重复沉淀的猫娘行为知识）。
   * 避免同一事实的不同说法刷成多条，同时不误合并语义不同的记忆。
   * @param content - 新记忆正文。
   * @returns 相似记忆行；无则 undefined。
   */
  private findSimilarMemory(content: string): { id: number; content: string; importance: number; needsReview: boolean } | undefined {
    const clean = normalizeMemoryText(content)
    if (clean === '') return undefined
    const cleanTokens = topicTokens(clean)
    const rows = this.db.prepare(
      'SELECT id, content, importance, needs_review FROM memories ORDER BY importance DESC, id ASC LIMIT 200',
    ).all() as Array<{ id: number; content: string; importance: number; needs_review: number }>
    for (const row of rows) {
      const other = normalizeMemoryText(row.content)
      if (other === '') continue
      const candidate = { id: row.id, content: row.content, importance: row.importance, needsReview: row.needs_review !== 0 }
      if (clean === other) return candidate
      // 短事实记忆且无数字差异：编辑距离 ≤ 1 视为同一说法
      // （如「名字叫小蝶」vs「名字是小蝶」；数字/编号不同的序列记忆不合并）。
      if (clean.length <= 14 && other.length <= 14
        && Math.abs(clean.length - other.length) <= 1
        && !/\d/.test(clean + other)
        && editDistance(clean, other) <= 1) return candidate
      // 长文本：中文二元组 token 重叠 ≥ 0.7 → 同一段重复沉淀的知识/描述。
      // 数字/编号不同的内容不合并（如「记忆条目 0」vs「记忆条目 1」）。
      if (cleanTokens.size > 0 && !/\d/.test(clean + other)) {
        const otherTokens = topicTokens(other)
        if (otherTokens.size === 0) continue
        let overlap = 0
        for (const token of cleanTokens) if (otherTokens.has(token)) overlap++
        const score = overlap / Math.min(cleanTokens.size, otherTokens.size)
        if (score >= 0.7) return candidate
      }
    }
    return undefined
  }

  /**
   * 回忆记忆（待人工确认的记忆不参与注入，确认后才生效——自动除幻觉防线）。
   * query 为空时返回最近记忆；否则按正文子串匹配。
   * @param query - 可选检索词。
   * @param limit - 返回条数上限，默认 8。
   * @returns 按重要性+时间倒序的已确认记忆行。
   */
  recall(query = '', limit = 8): PersonMemory[] {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 8))
    const sql = query.trim() === ''
      ? 'SELECT id, kind, content, importance, source, topic, created_at, needs_review FROM memories WHERE needs_review = 0 ORDER BY importance DESC, created_at DESC LIMIT ?'
      : 'SELECT id, kind, content, importance, source, topic, created_at, needs_review FROM memories WHERE needs_review = 0 AND content LIKE ? ORDER BY importance DESC, created_at DESC LIMIT ?'
    const rows = query.trim() === ''
      ? this.db.prepare(sql).all(safeLimit)
      : this.db.prepare(sql).all(`%${escapeLike(query)}%`, safeLimit)
    return rows.map(toMemory)
  }

  /**
   * 列出待人工确认的记忆（疑似幻觉/低置信度，供主脑除幻觉扫描与用户核对）。
   * @param limit - 返回条数上限，默认 200。
   */
  recallPendingMemories(limit = 200): PersonMemory[] {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 200))
    const rows = this.db.prepare(
      'SELECT id, kind, content, importance, source, topic, created_at, needs_review FROM memories WHERE needs_review = 1 ORDER BY created_at DESC LIMIT ?',
    ).all(safeLimit) as Array<Record<string, unknown>>
    return rows.map(toMemory)
  }

  /**
   * 自动除幻觉扫描：检测并处理疑似幻觉记忆。
   * - 模式化假数据（测试手机号/车牌/编造的敏感信息）→ 直接删除；
   * - 猜测式内容（「用户可能/大概…」等推断句式）→ 删除；
   * - 其余低置信度（来源非 user/conversation、内容含具体数字但无上下文）→ 标记待确认。
   * @returns 删除与标记的条数。
   */
  scanAndRemoveHallucinations(): { removed: number; flagged: number } {
    this.assertOpen()
    let removed = 0
    let flagged = 0
    const rows = this.db.prepare(
      'SELECT id, content, source, needs_review FROM memories',
    ).all() as Array<{ id: number; content: string; source: string; needs_review: number }>
    for (const row of rows) {
      const content = row.content.trim()
      if (content === '') {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(row.id)
        removed += 1
        continue
      }
      // 1) 模式化假数据：测试手机号/车牌/身份证号（重复数字或全 0 模式）。
      const fakePatterns = [
        /(手机号|电话|号码)[^0-9]*1\s*3\s*8\s*0{4,}\s*1{4,}/,
        /(车牌|车牌号)[^0-9]*[A-Z0-9]*88888/,
        /(身份证|证件号)[^0-9]*(\d)\1{5,}/,
        /1\s*3\s*8\s*0{4,}\s*1{4,}/,
      ]
      if (row.source !== 'conversation' && fakePatterns.some(p => p.test(content))) {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(row.id)
        removed += 1
        continue
      }
      // 2) 猜测式推断（模型脑补而非用户陈述）。
      if (/^(用户(应该|可能|大概|似乎|估计|好像|或许|也许)|我猜|推测|可能是)/.test(content)) {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(row.id)
        removed += 1
        continue
      }
      // 3) 低置信度：非 user/conversation 来源，或来源是 user 但含具体敏感数字，
      //    标记待确认（保留供用户核对，不自动删）。
      if (row.needs_review === 0 && (
        (row.source !== 'user' && row.source !== 'conversation')
        || (/身份证|手机号|银行卡|车牌/.test(content) && /\d{6,}/.test(content))
      )) {
        this.db.prepare('UPDATE memories SET needs_review = 1 WHERE id = ?').run(row.id)
        flagged += 1
      }
    }
    return { removed, flagged }
  }

  /**
   * 确认一条待核对记忆：内容无误，解除待确认标记，参与注入。
   * @param id - 记忆 id。
   * @returns 是否确认成功（不存在或本就不待确认返回 false）。
   */
  confirmMemory(id: number): boolean {
    this.assertOpen()
    if (!Number.isInteger(id) || id <= 0) return false
    const result = this.db.prepare('UPDATE memories SET needs_review = 0 WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  /**
   * 按 id 删除一条记忆（垃圾/误入清理）。
   * @param id - 记忆自增 id。
   * @returns 是否删除成功。
   */
  removeMemory(id: number): boolean {
    this.assertOpen()
    if (!Number.isInteger(id) || id <= 0) return false
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  /**
   * 沉淀一条长期知识（按主题幂等 upsert；主题高度相似时自动合并到已有条目）。
   * @param topic - 主题键。
   * @param content - 知识正文。
   * @param tags - 标签（逗号分隔）。
   * @param source - 来源（conversation / video / web / user）。
   * @param needsReview - 待人工确认标记：低置信度归纳先打标记，确认前不参与归位/注入。
   * @param merge - 是否执行相似合并；仅主脑（全局大脑）自动归纳开启，
   *   人格大脑归位写入保持 false（主脑已合并，人格只精确落盘）。
   */
  learn(topic: string, content: string, tags = '', source = 'video', needsReview = false, merge = false): void {
    this.assertOpen()
    const updatedAt = new Date().toISOString()
    const cleanTopic = topic.trim()
    const cleanTags = tags.trim()
    if (merge) {
      const exact = this.db.prepare('SELECT topic FROM knowledge WHERE topic = ?').get(cleanTopic)
      if (exact === undefined) {
        // 新主题：与已有条目高度相似 → 合并更新旧条目，避免重复沉淀。
        const similar = this.findSimilarTopic(cleanTopic, content)
        if (similar !== '') {
          this.mergeKnowledge(similar, content, cleanTags, updatedAt, needsReview)
          return
        }
      }
    }
    this.db.prepare(
      'INSERT INTO knowledge (topic, content, tags, source, updated_at, needs_review) VALUES (?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(topic) DO UPDATE SET content = excluded.content, tags = excluded.tags, source = excluded.source, updated_at = excluded.updated_at, needs_review = excluded.needs_review',
    ).run(cleanTopic, content, cleanTags, source, updatedAt, needsReview ? 1 : 0)
  }

  /**
   * 找与给定主题/正文高度相似的已有知识主题；无则返回空串。
   * 相似判定：交集 token ≥ 2 且交集占较小集合比例 ≥ 0.5（主题去「对话：/实操：」前缀后比较）。
   */
  findSimilarTopic(topic: string, content: string): string {
    const clean = topic.trim()
    if (clean === '') return ''
    const candTokens = topicTokens(normalizeTopic(clean) + ' ' + content)
    if (candTokens.size === 0) return ''
    const rows = this.db.prepare('SELECT topic FROM knowledge').all() as Array<{ topic: string }>
    let best = ''
    let bestScore = 0
    for (const row of rows) {
      if (row.topic === clean) continue
      const existingTokens = topicTokens(normalizeTopic(row.topic))
      if (existingTokens.size === 0) continue
      let overlap = 0
      for (const token of candTokens) if (existingTokens.has(token)) overlap++
      if (overlap < 2) continue
      const score = overlap / Math.min(candTokens.size, existingTokens.size)
      if (score > bestScore) { bestScore = score; best = row.topic }
    }
    return bestScore >= 0.5 ? best : ''
  }

  /** 把新内容合并进已有知识条目（保留 topic/status/suggested_skill，去重追加正文与标签）。 */
  private mergeKnowledge(topic: string, content: string, tags: string, updatedAt: string, needsReview: boolean): void {
    const row = this.db.prepare('SELECT topic, content, tags, needs_review FROM knowledge WHERE topic = ?').get(topic) as
      { topic: string; content: string; tags: string; needs_review: number } | undefined
    if (row === undefined) return
    const oldContent = row.content.trim()
    const newContent = content.trim()
    let merged: string
    if (newContent === '' || oldContent.includes(newContent) || newContent.includes(oldContent)) {
      merged = newContent.length >= oldContent.length ? newContent : oldContent
    } else {
      merged = oldContent + '\n' + newContent
    }
    const mergedTags = mergeTags(row.tags, tags)
    this.db.prepare(
      'UPDATE knowledge SET content = ?, tags = ?, updated_at = ?, needs_review = ? WHERE topic = ?',
    ).run(merged, mergedTags, updatedAt, needsReview ? 1 : 0, topic)
  }

  /**
   * 读取长期知识；topic 为空时列出全部。
   * @param topic - 可选主题键（精确匹配）。
   * @returns 知识行列表。
   */
  recallKnowledge(topic = '', tagFilter = '', sourceFilter = ''): PersonKnowledge[] {
    this.assertOpen()
    const cleanFilter = tagFilter.trim()
    const cleanSource = sourceFilter.trim()
    let rows: Array<Record<string, unknown>>
    const baseSelect = 'SELECT topic, content, tags, status, suggested_skill, source, updated_at, needs_review FROM knowledge'
    if (topic.trim() !== '') {
      rows = this.db.prepare(baseSelect + ' WHERE topic = ?').all(topic.trim())
    } else if (cleanFilter !== '') {
      rows = cleanSource !== ''
        ? this.db.prepare(baseSelect + ' WHERE tags LIKE ? AND source = ? ORDER BY updated_at DESC').all('%' + cleanFilter + '%', cleanSource)
        : this.db.prepare(baseSelect + ' WHERE tags LIKE ? ORDER BY updated_at DESC').all('%' + cleanFilter + '%')
    } else {
      rows = cleanSource !== ''
        ? this.db.prepare(baseSelect + ' WHERE source = ? ORDER BY updated_at DESC').all(cleanSource)
        : this.db.prepare(baseSelect + ' ORDER BY updated_at DESC').all()
    }
    return rows.map(toKnowledge)
  }

  /**
   * 列出全局实操阅历（带 #实操 标签的知识），可按处置状态过滤。
   * @param status - 可选过滤：pending / assigned / archived；空串不过滤。
   * @param limit - 返回条数上限，默认 100。
   * @returns 按更新时间倒序的实操行。
   */
  listPractice(status = '', limit = 100): PersonKnowledge[] {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100))
    const rows = status.trim() === ''
      ? this.db.prepare(
        'SELECT topic, content, tags, status, suggested_skill, source, updated_at, needs_review FROM knowledge '
        + 'WHERE tags LIKE ? ORDER BY updated_at DESC LIMIT ?',
      ).all('%实操%', safeLimit)
      : this.db.prepare(
        'SELECT topic, content, tags, status, suggested_skill, source, updated_at, needs_review FROM knowledge '
        + 'WHERE tags LIKE ? AND status = ? ORDER BY updated_at DESC LIMIT ?',
      ).all('%实操%', status.trim(), safeLimit)
    return rows.map(toKnowledge)
  }

  /**
   * 通用收件箱：列出全部知识（对话归纳 / 视频实操 / 联网等），可按处置状态
   * 与来源过滤。阅历控制台与自动归类的统一数据源。
   * @param status - pending / assigned / archived；空串不过滤。
   * @param source - conversation / video / web / user；空串不过滤。
   * @param limit - 条数上限，默认 300。
   */
  listInbox(status = '', source = '', limit = 300): PersonKnowledge[] {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit) || 300))
    const cleanStatus = status.trim()
    const cleanSource = source.trim()
    let sql = 'SELECT topic, content, tags, status, suggested_skill, source, updated_at, needs_review FROM knowledge'
    const conds: string[] = []
    const values: Array<string | number> = []
    if (cleanStatus !== '') { conds.push('status = ?'); values.push(cleanStatus) }
    if (cleanSource !== '') { conds.push('source = ?'); values.push(cleanSource) }
    if (conds.length > 0) sql += ' WHERE ' + conds.join(' AND ')
    sql += ' ORDER BY updated_at DESC LIMIT ?'
    values.push(safeLimit)
    const rows = this.db.prepare(sql).all(...values) as Array<Record<string, unknown>>
    return rows.map(toKnowledge)
  }

  /**
   * 更新一条实操的处置元数据（状态 / 建议技能 / 标签 / 待确认标记），并刷新 updated_at。
   * @param topic - 知识主题键（精确匹配）。
   * @param patch - 需要更新的字段。
   * @returns 是否更新成功（主题不存在返回 false）。
   */
  setPracticeMeta(topic: string, patch: { status?: string; suggestedSkill?: string; tags?: string; needsReview?: boolean }): boolean {
    this.assertOpen()
    const clean = topic.trim()
    if (clean === '') return false
    const current = this.db.prepare('SELECT topic FROM knowledge WHERE topic = ?').get(clean)
    if (current === undefined) return false
    const fields: string[] = []
    const values: Array<string | number> = []
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status.trim() || 'pending') }
    if (patch.suggestedSkill !== undefined) { fields.push('suggested_skill = ?'); values.push(patch.suggestedSkill.trim()) }
    if (patch.tags !== undefined) { fields.push('tags = ?'); values.push(patch.tags.trim()) }
    if (patch.needsReview !== undefined) { fields.push('needs_review = ?'); values.push(patch.needsReview ? 1 : 0) }
    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    this.db.prepare(`UPDATE knowledge SET ${fields.join(', ')} WHERE topic = ?`).run(...values, clean)
    return true
  }

  /**
   * 删除一条知识（收件箱移除 / 误入清理）。
   * @param topic - 知识主题键（精确匹配）。
   * @returns 是否删除成功。
   */
  removeKnowledge(topic: string): boolean {
    this.assertOpen()
    const clean = topic.trim()
    if (clean === '') return false
    const result = this.db.prepare('DELETE FROM knowledge WHERE topic = ?').run(clean)
    return Number(result.changes) > 0
  }

  /**
   * 写入一条视觉记忆（场景时间线）。
   * 合并窗口（90 秒）内：同指纹的画面视为同一场景，只刷新 ended_at 并累加
   * count，不重复入库；未提供指纹时退回「内容完全相同」匹配。
   * @param content - 结构化场景描述（人物/物体/动作/变化）。
   * @param fingerprint - 画面指纹（客户端帧 hash 或场景摘要 hash），用于去重合并。
   * @returns 写入/更新后的场景行。
   */
  seeScene(content: string, fingerprint = ''): PersonScene {
    this.assertOpen()
    const now = new Date()
    const createdAt = now.toISOString()
    const clean = content.trim()
    if (clean === '') throw new Error('seeScene: content 不能为空')
    const cleanFp = fingerprint.trim()
    // 指纹匹配：相同指纹在窗口内视为同一画面，即使内容描述有细微差异也合并。
    // 无指纹时退回内容匹配，保证旧调用方行为不变。
    const windowStart = new Date(now.getTime() - SCENE_MERGE_WINDOW_MS).toISOString()
    const base = 'SELECT id, started_at, ended_at, content, count, created_at, fingerprint FROM scenes '
    const existing = cleanFp !== ''
      ? this.db.prepare(base + 'WHERE fingerprint = ? AND started_at >= ? ORDER BY id DESC LIMIT 1').get(cleanFp, windowStart)
      : this.db.prepare(base + 'WHERE content = ? AND started_at >= ? ORDER BY id DESC LIMIT 1').get(clean, windowStart)
    if (existing !== undefined) {
      const next = Number((existing as { count: number }).count) + 1
      this.db.prepare('UPDATE scenes SET ended_at = ?, count = ? WHERE id = ?')
        .run(createdAt, next, (existing as { id: number }).id)
      return toScene({ ...(existing as Record<string, unknown>), ended_at: createdAt, count: next })
    }
    const result = this.db.prepare(
      'INSERT INTO scenes (started_at, ended_at, content, count, created_at, fingerprint) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(createdAt, createdAt, clean, createdAt, cleanFp)
    return {
      id: Number(result.lastInsertRowid),
      startedAt: createdAt,
      endedAt: createdAt,
      content: clean,
      count: 1,
      createdAt,
      fingerprint: cleanFp,
    }
  }

  /**
   * 回忆视觉记忆：按时间窗 + 关键词检索场景时间线。
   * @param sinceMs - 只看此时间点（毫秒时间戳）之后的场景；0 表示不限。
   * @param query - 可选检索词（正文子串匹配）。
   * @param limit - 返回条数上限，默认 20。
   * @returns 按开始时间倒序的场景行。
   */
  recallScenes(sinceMs = 0, query = '', limit = 20): PersonScene[] {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 20))
    const conds: string[] = []
    const values: Array<string | number> = []
    if (sinceMs > 0) {
      conds.push('started_at >= ?')
      values.push(new Date(sinceMs).toISOString())
    }
    if (query.trim() !== '') {
      conds.push('content LIKE ?')
      values.push(`%${escapeLike(query.trim())}%`)
    }
    const sql = 'SELECT id, started_at, ended_at, content, count, created_at, fingerprint FROM scenes'
      + (conds.length > 0 ? ' WHERE ' + conds.join(' AND ') : '')
      + ' ORDER BY started_at DESC LIMIT ?'
    values.push(safeLimit)
    const rows = this.db.prepare(sql).all(...values) as Array<Record<string, unknown>>
    return rows.map(toScene)
  }

  /**
   * 场景是否有信息量：过滤「无实质变化」的重复画面噪音。
   * 图谱/阅历只展示有信息量的场景，低信息量场景仅参与计数不单独成节点。
   * @param content - 场景描述。
   * @returns true 表示值得单独展示。
   */
  isInformativeScene(content: string): boolean {
    const clean = content.trim()
    if (clean === '') return false
    if (/(没有|无)(明显|显著)?(变化|变化。)/.test(clean) && !/(出现|新增|变成|开始|说话|写字|操作|点击|打开|切换)/.test(clean)) return false
    if (/(环境稳定|状态稳定|没有显著变化|没有明显变化|无明显变化)/.test(clean)) return false
    return true
  }

  /**
   * 视觉记忆自动清洗：低信息量重复场景合并计数；相同内容且时间相邻的旧场景
   * 先合并再淘汰；超出上限时删除最早的场景。
   * @param keepCount - 保留条数上限，默认 2000。
   * @returns 本次清理删除的条数。
   */
  cleanupScenes(keepCount = 2000): number {
    this.assertOpen()
    const safeKeep = Math.max(50, Math.trunc(keepCount) || 2000)
    let removed = 0
    // 1) 低信息量场景（无实质变化/无内容变化）合并进时间最近的同内容行，
    //    避免「人物低头、昏暗室内」这类画面刷出几十行。
    const lowInfo = this.db.prepare(
      'SELECT id, started_at, ended_at, content, count FROM scenes '
      + 'WHERE content LIKE ? OR content LIKE ? OR content LIKE ? OR content LIKE ? OR content LIKE ? '
      + 'ORDER BY started_at ASC',
    ).all('%没有明显变化%', '%无明显变化%', '%环境稳定%', '%状态稳定%', '%没有显著变化%') as Array<Record<string, unknown>>
    const lowByContent = new Map<string, Record<string, unknown>>()
    for (const row of lowInfo) {
      const key = String(row.content)
      const holder = lowByContent.get(key)
      if (holder !== undefined) {
        this.db.prepare('DELETE FROM scenes WHERE id = ?').run(Number(row.id))
        removed += 1
      } else {
        lowByContent.set(key, row)
      }
    }
    // 2) 相同内容、且前一场景结束与后一场景开始相隔 < 5 分钟的旧行合并计数。
    const rows = this.db.prepare(
      'SELECT id, started_at, ended_at, content, count FROM scenes ORDER BY started_at ASC',
    ).all() as Array<Record<string, unknown>>
    let prev: Record<string, unknown> | undefined
    for (const row of rows) {
      if (prev !== undefined
        && prev.content === row.content
        && new Date(row.started_at as string).getTime() - new Date(prev.ended_at as string).getTime() < 5 * 60_000) {
        const mergedCount = Number(prev.count) + Number(row.count)
        this.db.prepare('UPDATE scenes SET ended_at = ?, count = ? WHERE id = ?')
          .run(String(row.ended_at), mergedCount, Number(prev.id))
        this.db.prepare('DELETE FROM scenes WHERE id = ?').run(Number(row.id))
        removed += 1
        prev = { ...prev, ended_at: String(row.ended_at), count: mergedCount }
        continue
      }
      prev = row
    }
    // 3) 超上限：删除最早的多余行（保留最近 keepCount 条）。
    const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM scenes').get() as { n: number }
    const total = Number(countRow.n)
    if (total > safeKeep) {
      const excess = total - safeKeep
      const oldest = this.db.prepare(
        'SELECT id FROM scenes ORDER BY started_at ASC LIMIT ?',
      ).all(excess) as Array<{ id: number }>
      for (const row of oldest) {
        this.db.prepare('DELETE FROM scenes WHERE id = ?').run(Number(row.id))
        removed += 1
      }
    }
    return removed
  }

  /** 场景条数（阅历控制台总览用）。 */
  countScenes(): number {
    this.assertOpen()
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM scenes').get() as { n: number }
    return Number(row.n)
  }

  /** 最近活动时间：记忆或知识最近写入的 ISO 时间戳。 */
  lastActivityAt(): string {
    this.assertOpen()
    const row = this.db.prepare('SELECT MAX(ts) AS at FROM (SELECT created_at AS ts FROM memories UNION ALL SELECT updated_at AS ts FROM knowledge UNION ALL SELECT ended_at AS ts FROM scenes)').get() as { at: string | null }
    return typeof row.at === 'string' && row.at !== '' ? row.at : ''
  }

  /** 记忆条数（阅历控制台总览用）。 */
  countMemories(): number {
    this.assertOpen()
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }
    return Number(row.n)
  }

  /** 知识条数（含实操归位，阅历控制台总览用）。 */
  countKnowledge(): number {
    this.assertOpen()
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM knowledge').get() as { n: number }
    return Number(row.n)
  }

  /** 关闭数据库；关闭后任何读写都会抛错。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('person brain is closed')
    }
  }
}

/** 视觉记忆同指纹合并窗口（毫秒）：窗口内相同画面合并为一条场景。 */
const SCENE_MERGE_WINDOW_MS = 90_000

/** LIKE 通配符转义。 */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&')
}

/** node:sqlite 行 → PersonScene。 */
function toScene(row: Record<string, unknown>): PersonScene {
  return {
    id: Number(row.id),
    startedAt: String(row.started_at ?? ''),
    endedAt: String(row.ended_at ?? ''),
    content: String(row.content ?? ''),
    count: Number(row.count ?? 1),
    createdAt: String(row.created_at ?? ''),
    fingerprint: String(row.fingerprint ?? ''),
  }
}

/** node:sqlite 行 → PersonMemory。 */
function toMemory(row: Record<string, unknown>): PersonMemory {
  return {
    id: Number(row.id),
    kind: String(row.kind),
    content: String(row.content),
    importance: Number(row.importance),
    source: String(row.source ?? 'user'),
    topic: String(row.topic ?? ''),
    createdAt: String(row.created_at),
    needsReview: Number(row.needs_review ?? 0) !== 0,
  }
}

/** node:sqlite 行 → PersonKnowledge。 */
function toKnowledge(row: Record<string, unknown>): PersonKnowledge {
  return {
    topic: String(row.topic),
    content: String(row.content),
    tags: String(row.tags ?? ''),
    status: String(row.status ?? 'pending'),
    suggestedSkill: String(row.suggested_skill ?? ''),
    source: String(row.source ?? 'video'),
    updatedAt: String(row.updated_at),
    needsReview: Number(row.needs_review ?? 0) !== 0,
  }
}

/** 主题归一化：去掉「对话：/实操：/知识：」等前缀，仅用于相似度比较。 */
function normalizeTopic(topic: string): string {
  return topic.replace(/^(对话|实操|知识)：/, '').trim()
}

/** 记忆归一化：去标点/空格/口语助词，并把「名字叫/名叫/名字是/叫/是」等
 * 表述差异归一到同一形式，用于相似记忆合并比较。 */
export function normalizeMemoryText(text: string): string {
  return text
    .replace(/[，。！？、；：""''（）\s]/g, '')
    .replace(/^(用户|名字|叫|是)/, '')
    .replace(/名字?是|名叫|名字叫|叫|是|了|的|呢|啊|呀|哦|吧/g, '')
    .trim()
}

/** 编辑距离（Levenshtein）：短文本相似度判定用。 */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1)
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = curr
  }
  return prev[n]!
}

/** 中文二元组 + ASCII 词 token 化（与 diechi-brain keywordTokens 同思路，本地独立实现）。 */
function topicTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const ascii = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (const word of ascii) tokens.add(word)
  const chunks = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length - 1; i++) tokens.add(chunk.slice(i, i + 2))
  }
  return tokens
}

/** 合并逗号分隔标签：去重、去空、保序。 */
function mergeTags(...tagLists: string[]): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const list of tagLists) {
    for (const raw of list.split(',')) {
      const tag = raw.trim()
      if (tag !== '' && !seen.has(tag)) { seen.add(tag); merged.push(tag) }
    }
  }
  return merged.join(', ')
}
