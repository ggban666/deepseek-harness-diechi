/**
 * diechi-supervisor 数据层：管理 4 张新表（frozen_rules / authorizations
 * / negative_samples / proposals）。数据库文件 = diechi-home/brain.db
 * （与 PersonBrain 共享同一 SQLite，通过表名前缀避免冲突）。
 *
 * 当前阶段 P0：仅实现 frozen_rules / authorizations 读写；negative_samples
 * / proposals 留给 P1 / P2。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/db
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { CapabilitySnapshotRow, PositiveSampleRow, PositiveSignal } from './types.ts'

/** schema 列表——每个新表都要在这里登记，CREATE IF NOT EXISTS。 */
const SUPERVISOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS frozen_rules (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS authorizations (
  scope TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS negative_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  payload TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_negative_samples_scope ON negative_samples (scope, created_at DESC);
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
CREATE TABLE IF NOT EXISTS positive_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  payload TEXT NOT NULL,
  signal TEXT NOT NULL,
  latency_ms INTEGER,
  cost_units REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positive_samples_scope ON positive_samples (scope, created_at DESC);
CREATE TABLE IF NOT EXISTS capability_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  cbs_version TEXT NOT NULL,
  c_score REAL NOT NULL,
  k_score REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  commit_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_capability_snapshots_at ON capability_snapshots (at DESC);
`

/** 监督者数据层句柄。 */
export class SupervisorDb {
  readonly path: string
  private readonly db: DatabaseSync
  private closed = false

  /**
   * 构造函数保留可见性以避免直接 `new` 绕过 `open()` 的目录创建；
   * 但 host 插件需要直接构造（不在它自己控制的目录下），所以是 public。
   */
  constructor(path: string, db: DatabaseSync) {
    this.path = path
    this.db = db
  }

  /**
   * 打开（必要时创建）监督者数据库。
   * @param dir - 数据库所在目录（一般是 $DSH_HOME）。
   * @param fileName - 文件名（默认 'brain.db-supervisor'，与 PersonBrain 错开）。
   */
  static open(dir: string, fileName = 'brain.db-supervisor'): SupervisorDb {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, fileName)
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(SUPERVISOR_SCHEMA)
    return new SupervisorDb(path, db)
  }

  // ---- frozen_rules ----

  /** 写入一条冻结规则（仅 human 调用入口；本方法本身不鉴权）。 */
  insertFrozenRule(id: string, reason: string, frozenBy: string): void {
    this.assertOpen()
    this.db.prepare(
      'INSERT OR REPLACE INTO frozen_rules (id, reason, frozen_by, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, reason, frozenBy, new Date().toISOString())
  }

  /** 按 id 查一条冻结规则。 */
  getFrozenRule(id: string): { reason: string; frozen_by: string } | undefined {
    this.assertOpen()
    return this.db.prepare('SELECT reason, frozen_by FROM frozen_rules WHERE id = ?').get(id) as
      | { reason: string; frozen_by: string }
      | undefined
  }

  /** 列出所有冻结规则。 */
  listFrozenRules(): readonly { id: string; reason: string; frozen_by: string }[] {
    this.assertOpen()
    return this.db.prepare('SELECT id, reason, frozen_by FROM frozen_rules ORDER BY id').all() as unknown as readonly {
      id: string
      reason: string
      frozen_by: string
    }[]
  }

  // ---- authorizations ----

  /** 写入一条授权（granted_by='system-bootstrap' 走 bootstrap；其他由 human 调）。 */
  insertAuthorization(scope: string, grantedBy: string): void {
    this.assertOpen()
    this.db.prepare(
      'INSERT OR REPLACE INTO authorizations (scope, granted_by, granted_at, revoked_at) VALUES (?, ?, ?, NULL)',
    ).run(scope, grantedBy, new Date().toISOString())
  }

  /** 查一条授权（未撤销）。 */
  getAuthorization(scope: string): { granted_by: string; granted_at: string } | undefined {
    this.assertOpen()
    return this.db.prepare(
      'SELECT granted_by, granted_at FROM authorizations WHERE scope = ? AND revoked_at IS NULL',
    ).get(scope) as { granted_by: string; granted_at: string } | undefined
  }

  /**
   * 列出全部未撤销的授权。
   *
   * 存在的理由：CBS 沙盒要把当前规则集复制到副本库上跑基准，
   * 必须能把生产库的授权整表读出来。此前只有按 scope 的单条查询，
   * 沙盒无法还原完整规则状态。
   */
  listAuthorizations(): readonly { scope: string; granted_by: string; granted_at: string }[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT scope, granted_by, granted_at FROM authorizations WHERE revoked_at IS NULL ORDER BY scope',
    ).all() as unknown as readonly { scope: string; granted_by: string; granted_at: string }[]
  }

  /** 撤销授权（要求 caller='human'；本方法本身不鉴权）。 */
  revokeAuthorization(scope: string): boolean {
    this.assertOpen()
    const result = this.db.prepare(
      'UPDATE authorizations SET revoked_at = ? WHERE scope = ? AND revoked_at IS NULL',
    ).run(new Date().toISOString(), scope)
    return Number(result.changes) > 0
  }

  // ---- negative_samples ----

  /**
   * 写入一条负样本。decision='deny' / 'flag-review' 时调用。
   * payload 必须已 JSON.stringify 过。
   * @returns 写入后的自增 id。
   */
  insertNegativeSample(
    scope: string,
    payload: string,
    decision: 'deny' | 'flag-review',
    reason: string,
    source: string,
  ): number {
    this.assertOpen()
    const result = this.db.prepare(
      'INSERT INTO negative_samples (scope, payload, decision, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(scope, payload, decision, reason, source, new Date().toISOString())
    return Number(result.lastInsertRowid)
  }

  /**
   * 负样本总数。
   *
   * 走 COUNT(*) 而不是 list().length：度量面板每几秒抓一次，
   * 把整表拉进内存只为数个数是不可接受的。
   */
  countNegativeSamples(): number {
    this.assertOpen()
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM negative_samples').get() as { c: number } | undefined
    return row?.c ?? 0
  }

  /** 列出最近 N 条负样本。 */
  listNegativeSamples(limit = 100): readonly {
    id: number
    scope: string
    payload: string
    decision: string
    reason: string
    source: string
    created_at: string
  }[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT id, scope, payload, decision, reason, source, created_at FROM negative_samples ORDER BY id DESC LIMIT ?',
    ).all(limit) as unknown as readonly {
      id: number
      scope: string
      payload: string
      decision: string
      reason: string
      source: string
      created_at: string
    }[]
  }

  // ---- positive_samples ----
  // S1（成功路径采集）：没有正样本就没有"什么是对的"，固化通道无从谈起。
  // signal 取值：'accepted' | 'no-rework' | 'user-undo' | 'explicit-bad'
  // 前两个是正样本，后两个是负样本（记在这里而非 negative_samples，因为它们来自用户体感而非闸拦截）。

  /**
   * 写入一条用户体感样本。payload 必须已 JSON.stringify 过。
   * @returns 写入后的自增 id。
   */
  insertPositiveSample(
    scope: string,
    payload: string,
    signal: PositiveSignal,
    latencyMs?: number,
    costUnits?: number,
  ): number {
    this.assertOpen()
    const result = this.db.prepare(
      'INSERT INTO positive_samples (scope, payload, signal, latency_ms, cost_units, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      scope,
      payload,
      signal,
      latencyMs === undefined ? null : latencyMs,
      costUnits === undefined ? null : costUnits,
      new Date().toISOString(),
    )
    return Number(result.lastInsertRowid)
  }

  /** 列出最近 N 条体感样本。 */
  listPositiveSamples(limit = 100): readonly PositiveSampleRow[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT id, scope, payload, signal, latency_ms, cost_units, created_at FROM positive_samples ORDER BY id DESC LIMIT ?',
    ).all(limit) as unknown as readonly PositiveSampleRow[]
  }

  /**
   * 统计某段时间内各信号的数量——C(t) 的分子分母从这里出。
   * @param sinceMs 起始毫秒时间戳；undefined 表示不限。
   */
  countSignalsByKind(sinceMs?: number): Readonly<Record<PositiveSignal, number>> {
    this.assertOpen()
    const rows = (
      sinceMs === undefined
        ? this.db.prepare('SELECT signal, COUNT(*) AS n FROM positive_samples GROUP BY signal').all()
        : this.db
            .prepare('SELECT signal, COUNT(*) AS n FROM positive_samples WHERE created_at >= ? GROUP BY signal')
            .all(new Date(sinceMs).toISOString())
    ) as unknown as readonly { signal: string; n: number }[]
    const out: Record<PositiveSignal, number> = { accepted: 0, 'no-rework': 0, 'user-undo': 0, 'explicit-bad': 0 }
    for (const row of rows) {
      if (row.signal in out) out[row.signal as PositiveSignal] = Number(row.n)
    }
    return out
  }

  /** 清理过期体感样本（保留最近 keepCount 条）。返回清理条数。 */
  cleanupPositiveSamples(keepCount = 20000): number {
    this.assertOpen()
    const keep = Math.max(0, Math.trunc(keepCount))
    const result = this.db
      .prepare(
        'DELETE FROM positive_samples WHERE id NOT IN (SELECT id FROM positive_samples ORDER BY id DESC LIMIT ?)',
      )
      .run(keep)
    return Number(result.changes)
  }

  // ---- capability_snapshots ----
  // S0（度量层）：C(t) 一次通过率 / K(t) 归一化成本 的时间序列。
  // 没有这两列，A1 单调性与 A2 有界性在工程上无法表达，更无法验证。

  /**
   * 写一次基准回归的结果。
   * @param cbsVersion 冻结基准集版本（如 'CBS-v1'）——基准集只增不改，换版要发新号。
   * @param cScore 一次通过率 0..1（A1 守卫对象）。
   * @param kScore 归一化单次成本（A2 守卫对象）。
   */
  insertSnapshot(
    cbsVersion: string,
    cScore: number,
    kScore: number,
    sampleCount: number,
    commitId?: string,
  ): number {
    this.assertOpen()
    const result = this.db.prepare(
      'INSERT INTO capability_snapshots (at, cbs_version, c_score, k_score, sample_count, commit_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      new Date().toISOString(),
      cbsVersion,
      cScore,
      kScore,
      Math.max(0, Math.trunc(sampleCount)),
      commitId ?? null,
    )
    return Number(result.lastInsertRowid)
  }

  /** 列出最近 N 条快照（按时间倒序）。 */
  listSnapshots(limit = 200): readonly CapabilitySnapshotRow[] {
    this.assertOpen()
    return this.db.prepare(
      'SELECT id, at, cbs_version, c_score, k_score, sample_count, commit_id FROM capability_snapshots ORDER BY id DESC LIMIT ?',
    ).all(limit) as unknown as readonly CapabilitySnapshotRow[]
  }

  /** 取最新一条快照（用于回归门比较基线）。 */
  latestSnapshot(cbsVersion?: string): CapabilitySnapshotRow | undefined {
    this.assertOpen()
    const row =
      cbsVersion === undefined
        ? this.db
            .prepare(
              'SELECT id, at, cbs_version, c_score, k_score, sample_count, commit_id FROM capability_snapshots ORDER BY id DESC LIMIT 1',
            )
            .get()
        : this.db
            .prepare(
              'SELECT id, at, cbs_version, c_score, k_score, sample_count, commit_id FROM capability_snapshots WHERE cbs_version = ? ORDER BY id DESC LIMIT 1',
            )
            .get(cbsVersion)
    return row as CapabilitySnapshotRow | undefined
  }

  /**
   * 历史最高 C(t)——单调性守卫要跟历史最优比，而不是跟上一次比。
   * 只比最新值会让一次抖动永久拉低基线（棘轮反向版）。
   */
  bestScore(cbsVersion?: string): number | undefined {
    this.assertOpen()
    const row =
      cbsVersion === undefined
        ? this.db.prepare('SELECT MAX(c_score) AS m FROM capability_snapshots').get()
        : this.db.prepare('SELECT MAX(c_score) AS m FROM capability_snapshots WHERE cbs_version = ?').get(cbsVersion)
    const m = (row as { m: number | null } | undefined)?.m
    return m === null || m === undefined ? undefined : Number(m)
  }

  // ---- 生命周期 ----

  // ---- role_transitions ----

  /** 写入一条角色互换（不参与 cleanup——审计底账）。 */
  insertRoleTransition(
    fromRole: string,
    toRole: string,
    evidence: string,
    grantedBy: string,
    grantedAt: string,
    expiresAt: string,
  ): number {
    this.assertOpen()
    const result = this.db.prepare(
      "INSERT INTO role_transitions (from_role, to_role, evidence, granted_by, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(fromRole, toRole, evidence, grantedBy, grantedAt, expiresAt)
    return Number(result.lastInsertRowid)
  }

  /** 把一条 transition 标为已 revert。 */
  markRoleTransitionReverted(id: number, reason: string, revertedAt: string): boolean {
    this.assertOpen()
    if (!Number.isInteger(id) || id <= 0) return false
    const result = this.db.prepare(
      "UPDATE role_transitions SET reverted_at = ?, reverted_reason = ? WHERE id = ? AND reverted_at IS NULL",
    ).run(revertedAt, reason, id)
    return Number(result.changes) > 0
  }

  /** 按 id 查一条 transition。 */
  getRoleTransition(id: number): {
    id: number
    from_role: string
    to_role: string
    evidence: string
    granted_by: string
    granted_at: string
    expires_at: string
    reverted_at: string | null
    reverted_reason: string | null
  } | undefined {
    this.assertOpen()
    if (!Number.isInteger(id) || id <= 0) return undefined
    return this.db.prepare(
      "SELECT id, from_role, to_role, evidence, granted_by, granted_at, expires_at, reverted_at, reverted_reason FROM role_transitions WHERE id = ?",
    ).get(id) as
      | {
        id: number
        from_role: string
        to_role: string
        evidence: string
        granted_by: string
        granted_at: string
        expires_at: string
        reverted_at: string | null
        reverted_reason: string | null
      }
      | undefined
  }

  /** 列出最近 N 条 transition（不参与 cleanup）。 */
  listRoleTransitions(limit: number): readonly {
    id: number
    from_role: string
    to_role: string
    evidence: string
    granted_by: string
    granted_at: string
    expires_at: string
    reverted_at: string | null
    reverted_reason: string | null
  }[] {
    this.assertOpen()
    return this.db.prepare(
      "SELECT id, from_role, to_role, evidence, granted_by, granted_at, expires_at, reverted_at, reverted_reason FROM role_transitions ORDER BY id DESC LIMIT ?",
    ).all(limit) as unknown as readonly {
      id: number
      from_role: string
      to_role: string
      evidence: string
      granted_by: string
      granted_at: string
      expires_at: string
      reverted_at: string | null
      reverted_reason: string | null
    }[]
  }

  // ---- 清理：negative_samples ----
  // 保留最近 N 条 + 永久保留被 proposals.evidence 引用的（P3.11 加 evidence 引用保护）。
  // 实现：先查所有 proposals.evidence 字符串，在程序里 parse 出 id set，
  // 再 DELETE WHERE id NOT IN (最近 N) AND id NOT IN (引用集)。
  // SQLite 跨表 LIKE JOIN 性能差 + evidence 是字符串不是外键——程序 parse 更直观。
  cleanupNegativeSamples(keepCount = 5000): number {
    this.assertOpen()
    const keepCountSafe = Math.max(0, Math.trunc(keepCount))

    // 1) 收集 proposals.evidence 字符串里所有引用的 negative_sample id
    const referencedIds = new Set<number>()
    const proposalRows = this.db.prepare('SELECT evidence FROM proposals').all() as unknown as readonly { evidence: string }[]
    for (const row of proposalRows) {
      const parts = row.evidence.split(',')
      for (const part of parts) {
        const n = Number.parseInt(part.trim(), 10)
        if (Number.isInteger(n) && n > 0) referencedIds.add(n)
      }
    }

    // 2) 找最近 N 条的 id
    const recentIds = new Set<number>(
      (this.db.prepare(
        'SELECT id FROM negative_samples ORDER BY id DESC LIMIT ?',
      ).all(keepCountSafe) as unknown as readonly { id: number }[]).map((r) => r.id),
    )

    // 3) 保护集 = 最近 N ∪ 引用集；删其他
    const protectedIds = new Set<number>([...recentIds, ...referencedIds])
    const allRows = this.db.prepare('SELECT id FROM negative_samples').all() as unknown as readonly { id: number }[]
    const toDelete: number[] = []
    for (const row of allRows) {
      if (!protectedIds.has(row.id)) toDelete.push(row.id)
    }
    if (toDelete.length === 0) return 0

    // 分批 DELETE（避免 IN 子句过长）
    const BATCH = 500
    let removed = 0
    const stmt = this.db.prepare('DELETE FROM negative_samples WHERE id = ?')
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const chunk = toDelete.slice(i, i + BATCH)
      const tx = this.db.prepare('BEGIN').run()
      void tx
      for (const id of chunk) {
        stmt.run(id)
        removed += 1
      }
      this.db.prepare('COMMIT').run()
    }
    return removed
  }

  // ---- 生命周期 ----

  /** 执行任意 SQL（用于建表 / 迁移）。 */
  exec(sql: string): void {
    this.assertOpen()
    this.db.exec(sql)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('supervisor db is closed')
    }
  }
}
