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
  /** ISO 时间戳。 */
  readonly createdAt: string
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
  /** 最近更新的 ISO 时间戳。 */
  readonly updatedAt: string
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories (created_at DESC);
CREATE TABLE IF NOT EXISTS knowledge (
  topic TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  suggested_skill TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
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
    db.exec(BRAIN_SCHEMA)
    // WAL：多连接并发（人格大脑与全局大脑同文件）时读写互不阻塞。
    try {
      db.exec('PRAGMA journal_mode = WAL')
    } catch {
      // 只读文件系统等场景忽略，退回默认 journal。
    }
    // 迁移：旧库 knowledge 表补列（tags / status / suggested_skill）。
    for (const column of ['tags TEXT NOT NULL DEFAULT \'\'', 'status TEXT NOT NULL DEFAULT \'pending\'', 'suggested_skill TEXT NOT NULL DEFAULT \'\'']) {
      try {
        db.exec(`ALTER TABLE knowledge ADD COLUMN ${column}`)
      } catch {
        // 已存在（新库 CREATE 已含），忽略。
      }
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
   * @returns 写入后的记忆行。
   */
  remember(content: string, kind = 'episodic', importance = 1): PersonMemory {
    this.assertOpen()
    const createdAt = new Date().toISOString()
    const safeImportance = Math.max(1, Math.min(5, Math.trunc(importance) || 1))
    // 去重：最近 10 分钟内已存在完全相同的记忆时直接返回既有行，避免
    // 模型重试/重复强调把同一条记忆刷成多条。
    const existing = this.db.prepare(
      'SELECT id, kind, content, importance, created_at FROM memories '
      + 'WHERE content = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
    ).get(content, new Date(Date.now() - 10 * 60_000).toISOString())
    if (existing !== undefined) {
      return toMemory(existing)
    }
    const result = this.db.prepare(
      'INSERT INTO memories (kind, content, importance, created_at) VALUES (?, ?, ?, ?)',
    ).run(kind, content, safeImportance, createdAt)
    return {
      id: Number(result.lastInsertRowid),
      kind,
      content,
      importance: safeImportance,
      createdAt,
    }
  }

  /**
   * 回忆记忆。query 为空时返回最近记忆；否则按正文子串匹配。
   * @param query - 可选检索词。
   * @param limit - 返回条数上限，默认 8。
   * @returns 按重要性+时间倒序的记忆行。
   */
  recall(query = '', limit = 8): PersonMemory[] {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 8))
    const sql = query.trim() === ''
      ? 'SELECT id, kind, content, importance, created_at FROM memories ORDER BY importance DESC, created_at DESC LIMIT ?'
      : 'SELECT id, kind, content, importance, created_at FROM memories WHERE content LIKE ? ORDER BY importance DESC, created_at DESC LIMIT ?'
    const rows = query.trim() === ''
      ? this.db.prepare(sql).all(safeLimit)
      : this.db.prepare(sql).all(`%${escapeLike(query)}%`, safeLimit)
    return rows.map(toMemory)
  }

  /**
   * 沉淀一条长期知识（按主题幂等 upsert）。
   * @param topic - 主题键。
   * @param content - 知识正文。
   */
  learn(topic: string, content: string, tags = ''): void {
    this.assertOpen()
    const updatedAt = new Date().toISOString()
    const cleanTags = tags.trim()
    this.db.prepare(
      'INSERT INTO knowledge (topic, content, tags, updated_at) VALUES (?, ?, ?, ?) '
      + 'ON CONFLICT(topic) DO UPDATE SET content = excluded.content, tags = excluded.tags, updated_at = excluded.updated_at',
    ).run(topic.trim(), content, cleanTags, updatedAt)
  }

  /**
   * 读取长期知识；topic 为空时列出全部。
   * @param topic - 可选主题键（精确匹配）。
   * @returns 知识行列表。
   */
  recallKnowledge(topic = '', tagFilter = ''): PersonKnowledge[] {
    this.assertOpen()
    const cleanFilter = tagFilter.trim()
    const rows = topic.trim() === ''
      ? (cleanFilter === ''
        ? this.db.prepare('SELECT topic, content, tags, updated_at FROM knowledge ORDER BY updated_at DESC').all()
        : this.db.prepare('SELECT topic, content, tags, updated_at FROM knowledge WHERE tags LIKE ? ORDER BY updated_at DESC').all('%' + cleanFilter + '%'))
      : this.db.prepare('SELECT topic, content, tags, updated_at FROM knowledge WHERE topic = ?').all(topic.trim())
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
        'SELECT topic, content, tags, status, suggested_skill, updated_at FROM knowledge '
        + 'WHERE tags LIKE ? ORDER BY updated_at DESC LIMIT ?',
      ).all('%实操%', safeLimit)
      : this.db.prepare(
        'SELECT topic, content, tags, status, suggested_skill, updated_at FROM knowledge '
        + 'WHERE tags LIKE ? AND status = ? ORDER BY updated_at DESC LIMIT ?',
      ).all('%实操%', status.trim(), safeLimit)
    return rows.map(toKnowledge)
  }

  /**
   * 更新一条实操的处置元数据（状态 / 建议技能 / 标签），并刷新 updated_at。
   * @param topic - 知识主题键（精确匹配）。
   * @param patch - 需要更新的字段。
   * @returns 是否更新成功（主题不存在返回 false）。
   */
  setPracticeMeta(topic: string, patch: { status?: string; suggestedSkill?: string; tags?: string }): boolean {
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

/** LIKE 通配符转义。 */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&')
}

/** node:sqlite 行 → PersonMemory。 */
function toMemory(row: Record<string, unknown>): PersonMemory {
  return {
    id: Number(row.id),
    kind: String(row.kind),
    content: String(row.content),
    importance: Number(row.importance),
    createdAt: String(row.created_at),
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
    updatedAt: String(row.updated_at),
  }
}
