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
    // 迁移：旧库 knowledge 表没有 tags 列时补列。
    try {
      db.exec('ALTER TABLE knowledge ADD COLUMN tags TEXT NOT NULL DEFAULT \'\'')
    } catch {
      // 已存在（新库 CREATE 已含 tags），忽略。
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
    updatedAt: String(row.updated_at),
  }
}
