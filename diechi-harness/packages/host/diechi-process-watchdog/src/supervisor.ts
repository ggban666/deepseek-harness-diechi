/**
 * 负样本写入端：watchdog 把「DSH 崩过一次」记进 brain.db-supervisor。
 *
 * ## 为什么不复用 SupervisorDb
 *
 * watchdog 是独立进程，只有它一个进程要写这张表。去 import
 * `@deepseek-ai/dsh-host-diechi-supervisor` 会把整个 host 插件（cordis / skill-store
 * 一堆传递依赖）拖进启动路径 —— 而 watchdog 恰恰要在 DSH 已经挂掉、依赖树可能
 * 半损坏的环境下还能起来。所以这里自己开连接，只用 node:sqlite。
 *
 * schema 用 CREATE TABLE IF NOT EXISTS，与 diechi-supervisor/src/db.ts 保持一致。
 * 两处若漂移，以 supervisor 那边的 schema 为准（它是表的所有者）。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog/supervisor
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** 与 SupervisorDb 的 negative_samples 保持一致。 */
const NEGATIVE_SAMPLES_SCHEMA = `
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
`

/** 进程重启类负样本固定用这个 scope —— diechi-evolve 靠它聚成 add-rule 提议。 */
export const PROCESS_RESTART_SCOPE = 'person-brain:process-restart'

/** 负样本写入句柄。 */
export class NegativeSampleWriter {
  private readonly db: DatabaseSync
  private closed = false

  private constructor(private readonly path: string, db: DatabaseSync) {
    this.db = db
  }

  /**
   * 打开（必要时创建）brain.db-supervisor。
   * WAL + busy_timeout 是与 DSH 进程并发写同一个文件的前提。
   */
  static open(dshHome: string, fileName = 'brain.db-supervisor'): NegativeSampleWriter {
    mkdirSync(dshHome, { recursive: true })
    const path = join(dshHome, fileName)
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(NEGATIVE_SAMPLES_SCHEMA)
    return new NegativeSampleWriter(path, db)
  }

  /** 数据库文件路径，供日志排查。 */
  get dbPath(): string {
    return this.path
  }

  /**
   * 记一次进程重启。
   * @returns 写入的自增 id；写失败返回 null（**不抛** —— 见下方说明）。
   *
   * 这里刻意吞掉异常：watchdog 的职责是「把 DSH 拉起来」，
   * 记日志是次要目标。数据库写不进去（磁盘满 / 文件锁死）时，
   * 重启仍然必须发生 —— 为了记一笔账而放弃救活被升级者，是本末倒置。
   */
  recordRestart(reason: string, detail: Record<string, unknown>): number | null {
    if (this.closed) return null
    try {
      const result = this.db
        .prepare(
          'INSERT INTO negative_samples (scope, payload, decision, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          PROCESS_RESTART_SCOPE,
          JSON.stringify(detail),
          'deny',
          reason,
          'watchdog',
          new Date().toISOString(),
        )
      return Number(result.lastInsertRowid)
    } catch {
      return null
    }
  }

  /** 最近 N 条进程重启记录，供自检查看。 */
  listRestarts(limit = 20): readonly { id: number; reason: string; created_at: string }[] {
    if (this.closed) return []
    try {
      return this.db
        .prepare(
          'SELECT id, reason, created_at FROM negative_samples WHERE scope = ? ORDER BY id DESC LIMIT ?',
        )
        .all(PROCESS_RESTART_SCOPE, limit) as unknown as readonly {
        id: number
        reason: string
        created_at: string
      }[]
    } catch {
      return []
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}
