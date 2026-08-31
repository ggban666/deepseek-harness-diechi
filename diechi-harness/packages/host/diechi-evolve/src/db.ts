/**
 * diechi-evolve 数据层：管理 proposals 表。
 *
 * 与 diechi-supervisor 共享同一 $DSH_HOME 目录；通过文件名错开。
 * proposals 表 schema 已在 diechi-supervisor 启动时建好（frozen_rules /
 * authorizations / negative_samples / proposals 同处一库）。
 * 这里 P2 阶段直接读 / 写 proposals 表。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/db
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** proposals 表 CREATE（与 diechi-supervisor 的 schema 一致）。 */
const PROPOSALS_SCHEMA = `
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposer TEXT NOT NULL,
  target TEXT NOT NULL,
  change TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals (status, created_at DESC);
`

/** diechi-evolve 数据层（proposals 表 + 读 negative_samples）。 */
export class EvolveDb {
  readonly path: string
  private readonly db: DatabaseSync
  private closed = false

  private constructor(path: string, db: DatabaseSync) {
    this.path = path
    this.db = db
  }

  /**
   * 打开（必要时创建）共享的监督者数据库（proposals + negative_samples 都在这里）。
   * @param dir - 数据库所在目录（一般是 $DSH_HOME）。
   * @param fileName - 文件名（默认 'brain.db-supervisor'，与 diechi-supervisor 共享）。
   */
  static open(dir: string, fileName = 'brain.db-supervisor'): EvolveDb {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, fileName)
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    // proposals 表可能已被 diechi-supervisor 建好；CREATE IF NOT EXISTS 幂等。
    db.exec(PROPOSALS_SCHEMA)
    return new EvolveDb(path, db)
  }

  // ---- proposals 写 ----

  /**
   * 插入一条新提议。change / evidence 字段已由 caller 序列化为字符串。
   * @returns 写入后的自增 id。
   */
  insertProposal(proposer: string, target: string, change: string, evidence: string): number {
    this.assertOpen()
    const result = this.db.prepare(
      "INSERT INTO proposals (proposer, target, change, evidence, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    ).run(proposer, target, change, evidence, new Date().toISOString())
    return Number(result.lastInsertRowid)
  }

  /**
   * 审阅一条提议：allowed / denied / superseded。reviews_at 自动写当下时间。
   * @returns 是否更新成功（id 不存在返回 false）。
   */
  reviewProposal(id: number, status: 'allowed' | 'denied' | 'superseded'): boolean {
    this.assertOpen()
    if (!Number.isInteger(id) || id <= 0) return false
    const result = this.db.prepare(
      "UPDATE proposals SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
    ).run(status, new Date().toISOString(), id)
    return Number(result.changes) > 0
  }

  // ---- proposals 读 ----

  /** 列出待审提议。 */
  listPending(limit = 50): readonly {
    id: number
    proposer: string
    target: string
    change: string
    evidence: string
    status: string
    created_at: string
    reviewed_at: string | null
  }[] {
    this.assertOpen()
    return this.db.prepare(
      "SELECT id, proposer, target, change, evidence, status, created_at, reviewed_at FROM proposals WHERE status = 'pending' ORDER BY id DESC LIMIT ?",
    ).all(limit) as unknown as readonly {
      id: number
      proposer: string
      target: string
      change: string
      evidence: string
      status: string
      created_at: string
      reviewed_at: string | null
    }[]
  }

  /** 查某 target 下所有 pending 提议（含 change），供去重比对。 */
  listPendingByTarget(target: string): readonly { id: number; change: string }[] {
    this.assertOpen()
    return this.db.prepare(
      "SELECT id, change FROM proposals WHERE target = ? AND status = 'pending'",
    ).all(target) as unknown as readonly { id: number; change: string }[]
  }

  /** 列出所有提议（按时间倒序）。 */
  listAll(limit = 200): readonly {
    id: number
    proposer: string
    target: string
    change: string
    evidence: string
    status: string
    created_at: string
    reviewed_at: string | null
  }[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT id, proposer, target, change, evidence, status, created_at, reviewed_at FROM proposals ORDER BY id DESC LIMIT ?',
    ).all(limit) as unknown as readonly {
      id: number
      proposer: string
      target: string
      change: string
      evidence: string
      status: string
      created_at: string
      reviewed_at: string | null
    }[]
  }

  /** 按 id 查一条提议。 */
  getProposal(id: number): {
    id: number
    proposer: string
    target: string
    change: string
    evidence: string
    status: string
    created_at: string
    reviewed_at: string | null
  } | undefined {
    this.assertOpen()
    if (!Number.isInteger(id) || id <= 0) return undefined
    return this.db.prepare(
      'SELECT id, proposer, target, change, evidence, status, created_at, reviewed_at FROM proposals WHERE id = ?',
    ).get(id) as
      | {
        id: number
        proposer: string
        target: string
        change: string
        evidence: string
        status: string
        created_at: string
        reviewed_at: string | null
      }
      | undefined
  }

  // ---- 读负样本（用监督者表） ----

  /** 读负样本（含 payload），供引擎聚类摘要使用——payload 里是真实失败描述，必须喂给引擎才有料可提。 */
  listNegativeSamplesDetailed(limit = 1000): readonly { id: number; scope: string; reason: string; payload: string }[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT id, scope, reason, payload FROM negative_samples ORDER BY id DESC LIMIT ?',
    ).all(limit) as unknown as readonly { id: number; scope: string; reason: string; payload: string }[]
  }

  /** 按 reason 统计最近 N 天的负样本数。 */
  countNegativeByReason(reason: string, sinceMs: number): number {
    this.assertOpen()
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM negative_samples WHERE reason = ? AND created_at >= ?',
    ).get(reason, new Date(sinceMs).toISOString()) as { n: number }
    return Number(row.n)
  }

  /** 按 reason + scope 列最近 N 条负样本。 */
  listNegativeByReasonAndScope(reason: string, scope: string, limit: number): readonly {
    id: number
    scope: string
    payload: string
    reason: string
    source: string
    created_at: string
  }[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT id, scope, payload, reason, source, created_at FROM negative_samples WHERE reason = ? AND scope = ? ORDER BY id DESC LIMIT ?',
    ).all(reason, scope, limit) as unknown as readonly {
      id: number
      scope: string
      payload: string
      reason: string
      source: string
      created_at: string
    }[]
  }

  // ---- 清理（与 diechi-supervisor 文档一致：proposals 超过 1000 触发清理） ----

  /** 保留 pending + 最近 allowed/denied 各 250 条，删多余。 */
  cleanupProposals(keepPending = 250, keepDecided = 250): number {
    this.assertOpen()
    let removed = 0
    // 1) pending 保留最近 keepPending
    const pending = this.db.prepare(
      "SELECT id FROM proposals WHERE status = 'pending' ORDER BY id DESC LIMIT -1 OFFSET ?",
    ).all(keepPending) as unknown as readonly { id: number }[]
    for (const row of pending) {
      this.db.prepare('DELETE FROM proposals WHERE id = ?').run(row.id)
      removed += 1
    }
    // 2) allowed 保留最近 keepDecided
    const allowed = this.db.prepare(
      "SELECT id FROM proposals WHERE status = 'allowed' ORDER BY id DESC LIMIT -1 OFFSET ?",
    ).all(keepDecided) as unknown as readonly { id: number }[]
    for (const row of allowed) {
      this.db.prepare('DELETE FROM proposals WHERE id = ?').run(row.id)
      removed += 1
    }
    // 3) denied 保留最近 keepDecided
    const denied = this.db.prepare(
      "SELECT id FROM proposals WHERE status = 'denied' ORDER BY id DESC LIMIT -1 OFFSET ?",
    ).all(keepDecided) as unknown as readonly { id: number }[]
    for (const row of denied) {
      this.db.prepare('DELETE FROM proposals WHERE id = ?').run(row.id)
      removed += 1
    }
    return removed
  }

  // ---- 生命周期 ----

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('evolve db is closed')
    }
  }
}
