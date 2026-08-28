/**
 * diechi-evolve 核心服务：实现升级设计者的"读负样本 → 写提议 → 等审阅"循环。
 *
 * P2 阶段：analyzeNegativeSamples 按 reason 聚类 + 阈值触发；propose 写 proposals 表；
 * reviewProposal 改 status。
 * "提议被允许后真正改 frozen_rules / authorizations"留给 host 在 review 后调
 * supervisor.freezeRule / authorizeScope。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { EvolveDb } from './db.ts'
import type {
  ProposalChange,
  ProposalDraft,
  ProposalReview,
  ProposalStatus,
} from './types.ts'

/** analyzeNegativeSamples 触发阈值。 */
const DEFAULT_THRESHOLDS = {
  /** 同一 reason 在最近 7 天内累计 ≥ 10 触发提议。 */
  reasonCount: 10,
  /** 时间窗（毫秒）：7 天。 */
  reasonWindowMs: 7 * 24 * 60 * 60_000,
  /** 单次 analyze 输出提议数上限。 */
  maxDraftsPerRun: 5,
}

/** 监督者类型（仅用到 listNegativeSamples / freezeRule / authorizeScope / revokeAuthorization）。 */
export interface SupervisorLike {
  listNegativeSamples(limit: number): readonly { id: number; scope: string; reason: string }[]
  freezeRule(id: string, reason: string, frozenBy?: string): void
  authorizeScope(scope: string, grantedBy?: string): void
  revokeAuthorization(scope: string): boolean
}

/** diechi-evolve 核心服务。 */
export class EvolutionService {
  constructor(
    // @ts-expect-error P2 早期未使用：未来订阅 supervision/decision 事件时使用。
    private readonly ctx: Context,
    private readonly db: EvolveDb,
    private readonly supervisor: SupervisorLike,
    private readonly proposer: string = 'diechi-evolve',
  ) {}

  /**
   * 处理单次 supervision/decision 事件：累计 deny / flag-review 计数。
   * 同一 (scope, reason) 累计 ≥ DEFAULT_THRESHOLDS.reasonCount 触发 analyze。
   * P3.6 之前：analyzeNegativeSamples 仅在启动时跑；现在实时累计。
   */
  handleDecision(event: { scope: string; decision: string; reason: string }): readonly number[] {
    if (event.decision === 'allow') return []  // allow 不累计
    // 累计 key = "<scope>|<reason>"——不同 scope 不同 reason 互不干扰
    const key = `${event.scope}|${event.reason}`
    const current = this.reasonCounter.get(key) ?? 0
    const next = current + 1
    this.reasonCounter.set(key, next)
    // 阈值到达 → 触发 analyze（生成提议）
    if (next === DEFAULT_THRESHOLDS.reasonCount) {
      return this.analyzeNegativeSamples()
    }
    return []
  }

  /** 内部累计器：key = "<scope>|<reason>" → 同类失败次数。P3.6 实时累计用。 */
  private readonly reasonCounter = new Map<string, number>()

  /**
   * 读负样本，按 reason 聚类，触发提议草案生成。
   * 当前实现：单次扫描最近 7 天，按 reason 计数 ≥ 10 时为该 reason 涉及的最常见 scope 生成一条 add-rule 提议。
   *
   * @returns 写入的提议 id 列表（可能为空）。
   */
  analyzeNegativeSamples(): readonly number[] {
    const drafts: ProposalDraft[] = []
    const now = Date.now()
    const since = now - DEFAULT_THRESHOLDS.reasonWindowMs

    // 1) 拉取所有负样本（最近 7 天）
    const samples = this.supervisor.listNegativeSamples(1000).filter((s) => {
      // created_at 是 ISO 字符串，比较毫秒数
      const t = Date.parse((s as unknown as { created_at?: string }).created_at ?? '')
      if (Number.isNaN(t)) return true // 拿不到时间就保留
      return t >= since
    })

    // 2) 按 reason 分组
    const byReason = new Map<string, Array<{ id: number; scope: string; reason: string }>>()
    for (const s of samples) {
      const list = byReason.get(s.reason) ?? []
      list.push(s)
      byReason.set(s.reason, list)
    }

    // 3) 每个超过阈值的 reason：找最高频 scope，生成 add-rule 提议
    for (const [reason, list] of byReason) {
      if (list.length < DEFAULT_THRESHOLDS.reasonCount) continue
      if (drafts.length >= DEFAULT_THRESHOLDS.maxDraftsPerRun) break

      // 按 scope 频次排序
      const scopeCount = new Map<string, number>()
      for (const s of list) {
        scopeCount.set(s.scope, (scopeCount.get(s.scope) ?? 0) + 1)
      }
      const topScope = [...scopeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      if (topScope === undefined) continue

      // 选最近 N 条作为 evidence
      const evidence = list.slice(0, 10).map((s) => s.id)

      drafts.push({
        target: topScope,
        change: {
          kind: 'add-rule',
          // change.id 等于 target：frozen_rules.id 精确匹配 scope，applyProposal 后
          // 同一 scope 的所有写入立即 deny。details 描述为什么冻结，便于审计。
          id: topScope,
          details: `基于 ${list.length} 条 ${reason} 负样本（most common scope=${topScope}）。applyProposal 会把本条规则写入 frozen_rules，使后续同 scope 写入 deny。`,
        },
        evidence,
        rationale: `${list.length} 次同一 reason（${reason}）发生在同一 scope（${topScope}），频次 ${list.length} ≥ 阈值 ${DEFAULT_THRESHOLDS.reasonCount}。建议在监督者侧冻结此 scope 直到 rate 下降。`,
        rollbackPlan: `人工 reviewProposal(id, 'denied') 或 supervisor_revoke_authorization(scope) 后由 ${reason} 触发的新失败仍会写 negative_samples，可继续观察。`,
      })
    }

    // 4) 写入 proposals 表
    const ids: number[] = []
    for (const draft of drafts) {
      const id = this.propose(draft)
      ids.push(id)
    }
    return ids
  }

  /**
   * 写一条提议到 proposals 表。
   * @returns 写入后的自增 id。
   */
  propose(draft: ProposalDraft): number {
    return this.db.insertProposal(
      this.proposer,
      draft.target,
      serializeChange(draft.change),
      draft.evidence.join(','),
    )
  }

  /**
   * 审阅一条提议：allowed 时由 host 调 supervisor.freezeRule / authorizeScope 把副作用落库；
   * denied / superseded 不落。
   * P2 阶段：allowed 的副作用由 host 在 reviewProposal 后调 applyProposal() 完成。
   *
   * @returns 审阅结果（含 id / status / reviewed_at）。
   */
  reviewProposal(id: number, decision: 'allowed' | 'denied' | 'superseded'): ProposalReview {
    const ok = this.db.reviewProposal(id, decision)
    if (!ok) {
      throw new Error(`reviewProposal 失败：id=${id} 不存在或已审阅`)
    }
    if (decision === 'allowed') {
      this.applyProposal(id)
    }
    return {
      id,
      status: decision as ProposalStatus,
      reviewed_at: new Date().toISOString(),
    }
  }

  // ---- 列表 API ----

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
    return this.db.listPending(limit)
  }

  /** 列出全部提议。 */
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
    return this.db.listAll(limit)
  }

  /** 触发清理。 */
  cleanup(): number {
    return this.db.cleanupProposals(250, 250)
  }

  // ---- 私有 ----

  /** 提议 allowed 后把"add-rule"应用到 frozen_rules。 */
  private applyProposal(id: number): void {
    const row = this.db.getProposal(id)
    if (row === undefined) return
    if (row.status !== 'allowed') return
    const change = parseChange(row.change)
    if (change === null) return
    if (change.kind === 'add-rule') {
      this.supervisor.freezeRule(change.id, `由 proposal #${id} 落库：${change.details}`)
      return
    }
    if (change.kind === 'revise-scope') {
      // 改授权策略：details 形如 "<action>:<scope>"——'grant:<scope>' / 'revoke:<scope>'
      // 实际效果：grant 等价于 authorizeScope（插 authorizations）；revoke 等价于 revokeAuthorization
      const parsed = parseReviseScope(change.id, change.details)
      if (parsed === null) return
      if (parsed.action === 'grant') {
        this.supervisor.authorizeScope(parsed.scope, 'human')
      } else {
        this.supervisor.revokeAuthorization(parsed.scope)
      }
      return
    }
    if (change.kind === 'add-bootstrap') {
      // 启动时新增一条 frozen rule（P3 阶段简化：与 add-rule 行为一致——都是 freezeRule）
      // 区别：add-rule 是运行时冻结某 scope；add-bootstrap 是把"已知该冻结的"基线化
      this.supervisor.freezeRule(change.id, `由 proposal #${id} 落库（bootstrap）：${change.details}`)
      return
    }
  }
}

/** 解析 'revise-scope:<id> <details>' 中的 details。 */
function parseReviseScope(id: string, details: string): { action: 'grant' | 'revoke'; scope: string } | null {
  // id 形如 'grant:<scope>' 或 'revoke:<scope>'
  const colon = id.indexOf(':')
  if (colon <= 0) return null
  const action = id.slice(0, colon)
  const scope = id.slice(colon + 1)
  if (action !== 'grant' && action !== 'revoke') return null
  if (scope === '') return null
  // details 当前未用——预留做"为什么这样改"
  void details
  return { action, scope }
}

/** 把 ProposalChange 序列化为 JSON 字符串（P3.11）。
 * 旧版是 `kind:id details` 字符串（不再用），新版是 `{"kind":..,"id":..,"details":..}`。
 * DB schema 不变（change TEXT 字段装 JSON 字符串）— 旧数据兼容由 parseChange 兜底。
 */
function serializeChange(change: ProposalChange): string {
  return JSON.stringify({
    kind: change.kind,
    id: change.id,
    details: change.details,
  })
}

/** 从字符串反序列化 ProposalChange。
 * 1) 先尝试 JSON 解析（P3.11 新格式）
 * 2) 失败时 fallback 字符串解析（兼容 P3.8 及之前的旧 proposals 行）
 * 3) 两条都失败 → null
 */
function parseChange(raw: string): ProposalChange | null {
  // 1) JSON 路径（P3.11+ 新格式）
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as { kind?: string; id?: string; details?: string }
      if (typeof obj.kind === 'string' && typeof obj.id === 'string' && typeof obj.details === 'string') {
        return { kind: obj.kind as ProposalChange['kind'], id: obj.id, details: obj.details }
      }
    } catch {
      // fallthrough
    }
    return null
  }
  // 2) 旧字符串路径：`<kind>:<id> <details>`（P3.8 之前格式，兼容用）
  const colon = raw.indexOf(':')
  if (colon <= 0) return null
  const kind = raw.slice(0, colon)
  const rest = raw.slice(colon + 1)
  const space = rest.indexOf(' ')
  if (space <= 0) return null
  return {
    kind: kind as ProposalChange['kind'],
    id: rest.slice(0, space),
    details: rest.slice(space + 1),
  }
}
