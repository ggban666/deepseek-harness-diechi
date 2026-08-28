/**
 * AgentRoleService 实现：角色可互换的运行时 + 审计。
 *
 * 三条护栏（来自设计文档）：
 * 1) 临时身份不能批自己的提议——PersonBrain.authorize 在 propose scope 检测
 *    "写提议的角色与监督者角色同实例"时强制 deny
 * 2) 临时身份不豁免 frozen_rules——frozen_rules 命中即 deny，与当前角色无关
 * 3) 临时身份 TTL 不可续期——swapTo 在已临时身份上调用抛 RoleAlreadySwappedError
 *
 * 数据落 $DSH_HOME/brain.db-supervisor 的 role_transitions 表（审计底账，不参与 cleanup）。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/role
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  type AgentRoleId,
  type AgentRoleService,
  type SwapToInput,
  type SwapToResult,
} from '@deepseek-ai/dsh-host-skill-store'
import { SupervisorDb } from './db.ts'

/** 角色互换触发阈值（按设计文档"运维工具"口径，不预设高门槛——记录语义为前提）。 */
const DEFAULT_TTL_SEC = 1800
const MAX_TTL_SEC = 3600
const REASON_TTL_EXPIRED = 'ttl-expired'
const REASON_MANUAL = 'manual-revert'

/** AgentRoleService 实现。 */
export class AgentRoleServiceImpl implements AgentRoleService {
  private currentRole: AgentRoleId = 'subject'
  /** 当前活跃的 transition id（决定能否再 swap）。 */
  private activeTransitionId: number | null = null
  /** TTL 计时句柄。 */
  private ttlHandle: ReturnType<typeof setTimeout> | null = null

  constructor(
    // @ts-expect-error P3 早期未使用：未来订阅 supervision/decision 事件时使用。
    private readonly ctx: Context,
    private readonly db: SupervisorDb,
  ) {
    // 建表（与 diechi-supervisor 共享同一 db）
    this.db.exec(ROLE_TRANSITIONS_SCHEMA)
  }

  current(): AgentRoleId {
    return this.currentRole
  }

  async swapTo(input: SwapToInput): Promise<SwapToResult> {
    if (this.activeTransitionId !== null) {
      // 护栏 3：TTL 不可续期
      throw new RoleAlreadySwappedError(
        `已在 ${this.currentRole} 角色（transition #${this.activeTransitionId}），不可续期；先 revert()`,
      )
    }
    if (this.currentRole !== 'subject') {
      throw new RoleAlreadySwappedError(`current role is ${this.currentRole}，先 revert()`)
    }

    const ttl = clampTtl(input.ttlSec)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttl * 1000)
    const evidenceStr = input.evidence.join(',')
    const id = this.db.insertRoleTransition(
      this.currentRole,
      input.target,
      evidenceStr,
      'diechi-supervisor', // P3 阶段：自动 granted_by；未来由 ctx.evolution 触发
      now.toISOString(),
      expiresAt.toISOString(),
    )

    this.currentRole = input.target
    this.activeTransitionId = id
    this.armTtl(id, ttl)

    const row = this.db.getRoleTransition(id)
    if (row === undefined) {
      throw new Error('swapTo: 写入后查不到 row（不可能）')
    }
    return { transitionId: id, previous: 'subject', expiresAt: row.expires_at }
  }

  async revert(): Promise<void> {
    if (this.activeTransitionId === null) {
      return // 已经是 subject，无操作
    }
    const id = this.activeTransitionId
    this.db.markRoleTransitionReverted(id, REASON_MANUAL, new Date().toISOString())
    this.clearTtl()
    this.currentRole = 'subject'
    this.activeTransitionId = null
  }

  history(limit = 100): ReturnType<AgentRoleService['history']> {
    return this.db.listRoleTransitions(limit) as unknown as ReturnType<AgentRoleService['history']>
  }

  // ---- 内部 ----

  /** 启动 TTL 计时器——到期自动 revert。 */
  private armTtl(transitionId: number, ttlSec: number): void {
    this.clearTtl()
    this.ttlHandle = setTimeout(() => {
      // TTL 到期：自动 revert
      if (this.activeTransitionId === transitionId) {
        this.db.markRoleTransitionReverted(
          transitionId,
          REASON_TTL_EXPIRED,
          new Date().toISOString(),
        )
        this.currentRole = 'subject'
        this.activeTransitionId = null
      }
    }, ttlSec * 1000)
    // setTimeout 在 Node.js 里不阻塞 event loop；unref 让进程退出不被它卡住。
    if (typeof this.ttlHandle.unref === 'function') {
      this.ttlHandle.unref()
    }
  }

  private clearTtl(): void {
    if (this.ttlHandle !== null) {
      clearTimeout(this.ttlHandle)
      this.ttlHandle = null
    }
  }
}

/** 校验 TTL：默认 1800，最大 3600。 */
function clampTtl(input: number | undefined): number {
  if (input === undefined) return DEFAULT_TTL_SEC
  if (!Number.isFinite(input) || input <= 0) return DEFAULT_TTL_SEC
  return Math.min(MAX_TTL_SEC, Math.max(60, Math.trunc(input)))
}

/** 临时身份已在 — TTL 不可续期。 */
export class RoleAlreadySwappedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleAlreadySwappedError'
  }
}

/** role_transitions 表 schema。 */
export const ROLE_TRANSITIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS role_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  evidence TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reverted_at TEXT,
  reverted_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_role_transitions_at ON role_transitions (granted_at DESC);
`
