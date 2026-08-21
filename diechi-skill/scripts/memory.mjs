#!/usr/bin/env node
/**
 * 蝶翅人格大脑 CLI —— 数据库(大脑) 部分。
 *
 * 与蝶翅-app 的人格大脑（PersonBrain）共用同一套 SQLite schema：
 *   memories(id, kind, content, importance, created_at)
 *   knowledge(topic PRIMARY KEY, content, updated_at)
 *
 * 用法：
 *   memory.mjs remember <内容> [--kind episodic|semantic|fact]
 *   memory.mjs recall [关键词] [--limit N]
 *   memory.mjs learn <主题> <内容>
 *   memory.mjs knowledge [主题]
 *   memory.mjs list [--limit N]
 *
 * 数据库默认落在 <skill>/memory/brain.db，可用环境变量 DIECHI_BRAIN 覆盖。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DIECHI_BRAIN || join(here, '..', 'memory', 'brain.db')
mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
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
  updated_at TEXT NOT NULL
);
`)

function usage() {
  console.log(`蝶翅人格大脑 CLI
用法:
  memory.mjs remember <内容> [--kind episodic|semantic|fact]
  memory.mjs recall [关键词] [--limit N]
  memory.mjs learn <主题> <内容>
  memory.mjs knowledge [主题]
  memory.mjs list [--limit N]
数据库: ${dbPath}
`)
  process.exit(0)
}

const args = process.argv.slice(2)
const cmd = args[0] ?? ''
const rest = args.slice(1)

function flag(name, fallback) {
  const i = rest.indexOf(name)
  if (i === -1) return fallback
  return rest[i + 1] ?? fallback
}

switch (cmd) {
  case 'remember': {
    const content = rest.filter(a => !a.startsWith('--'))[0] ?? ''
    if (content === '') usage()
    const kind = flag('--kind', 'episodic')
    const now = new Date().toISOString()
    const existing = db.prepare(
      'SELECT id, kind, content, importance, created_at FROM memories WHERE content = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
    ).get(content, new Date(Date.now() - 10 * 60_000).toISOString())
    let row
    if (existing !== undefined) {
      row = existing
      console.log(`（10 分钟内已有相同记忆，id=${row.id}，未重复写入）`)
    } else {
      const r = db.prepare('INSERT INTO memories (kind, content, importance, created_at) VALUES (?, ?, 1, ?)').run(kind, content, now)
      row = { id: Number(r.lastInsertRowid), kind, content, importance: 1, created_at: now }
    }
    console.log(`已记住 (${row.kind})：${row.content}`)
    break
  }
  case 'recall': {
    const query = rest.filter(a => !a.startsWith('--'))[0] ?? ''
    const limit = Number(flag('--limit', '8'))
    const safe = Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.trunc(limit) : 8))
    const rows = query.trim() === ''
      ? db.prepare('SELECT id, kind, content, importance, created_at FROM memories ORDER BY importance DESC, created_at DESC LIMIT ?').all(safe)
      : db.prepare('SELECT id, kind, content, importance, created_at FROM memories WHERE content LIKE ? ORDER BY importance DESC, created_at DESC LIMIT ?').all(`%${query.replace(/[%_\\]/g, '\\$&')}%`, safe)
    if (rows.length === 0) {
      console.log('大脑记忆中没有相关内容。')
      break
    }
    for (const row of rows) {
      console.log(`- [${row.created_at}] (${row.kind}) ${row.content}`)
    }
    break
  }
  case 'learn': {
    const topic = rest.filter(a => !a.startsWith('--'))[0] ?? ''
    const content = rest.filter(a => !a.startsWith('--'))[1] ?? ''
    if (topic === '' || content === '') usage()
    db.prepare(
      'INSERT INTO knowledge (topic, content, updated_at) VALUES (?, ?, ?) '
      + 'ON CONFLICT(topic) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
    ).run(topic, content, new Date().toISOString())
    console.log(`已学习 ${topic}`)
    break
  }
  case 'knowledge': {
    const topic = rest.filter(a => !a.startsWith('--'))[0] ?? ''
    const rows = topic.trim() === ''
      ? db.prepare('SELECT topic, content, updated_at FROM knowledge ORDER BY updated_at DESC').all()
      : db.prepare('SELECT topic, content, updated_at FROM knowledge WHERE topic = ?').all(topic.trim())
    if (rows.length === 0) { console.log('暂无长期知识。'); break }
    for (const row of rows) console.log(`## ${row.topic}（${row.updated_at}）\n${row.content}`)
    break
  }
  case 'list': {
    const limit = Number(flag('--limit', '20'))
    const safe = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.trunc(limit) : 20))
    const rows = db.prepare('SELECT id, kind, content, importance, created_at FROM memories ORDER BY created_at DESC LIMIT ?').all(safe)
    for (const row of rows) console.log(`- [${row.created_at}] (${row.kind}) ${row.content}`)
    break
  }
  default:
    usage()
}
db.close()
