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
import type { ScopeResolver } from './scope-map.ts'
import type {
  ProposalChange,
  ProposalDraft,
  ProposalReview,
  ProposalStatus,
} from './types.ts'

/** analyzeNegativeSamples / analyzeSamples 触发阈值。 */
const DEFAULT_THRESHOLDS = {
  /** 同一 reason 在最近 7 天内累计 ≥ 10 才考虑 add-rule（最后手段）。 */
  reasonCount: 10,
  /** 时间窗（毫秒）：7 天。 */
  reasonWindowMs: 7 * 24 * 60 * 60_000,
  /** 单次 analyze 输出提议数上限。 */
  maxDraftsPerRun: 5,
  // ---- S2 新增：提议多样化的阈值 ----
  /** 某 scope 至少积累 N 条体感样本才考虑出提议（样本太少算出来的 rate 没有意义）。 */
  minSamplesForProposal: 5,
  /** 一次通过率 ≥ 此值 → 值得固化成技能/案例。 */
  goodRate: 0.9,
  /** 一次通过率 ≤ 此值 → 需要改进（改提示 / 加算力）。 */
  badRate: 0.5,
  /** 固化为技能所需的最少正样本数；不足则退化为 add-case。 */
  skillMaturity: 10,
  /** 排序权重：score = ΔC − costWeight · ΔK。 */
  costWeight: 0.5,
}

/** 监督者类型（仅用到 listNegativeSamples / freezeRule / authorizeScope / revokeAuthorization）。 */
export interface SupervisorLike {
  listNegativeSamples(limit: number): readonly { id: number; scope: string; reason: string }[]
  /** S2 新增：读体感样本。可选——老实现没有这个方法时退化成只分析负样本。 */
  listPositiveSamples?(
    limit: number,
  ): readonly { id: number; scope: string; signal: string; created_at?: string }[]
  /** M3 新增：golden set 回归（CBS 基准集一次通过率 + 归一化成本）。可选——老实现没有时跳过回归门。 */
  runGoldenSet?(): { c: number; passed: number; total: number; k?: number }
  /** S0 新增：把一次回归结果写进 capability_snapshots（C/K 时间序列）。可选。 */
  recordSnapshot?(cbsVersion: string, cScore: number, kScore: number, sampleCount: number, commitId?: string): void
  freezeRule(id: string, reason: string, frozenBy?: string): void
  authorizeScope(scope: string, grantedBy?: string): void
  revokeAuthorization(scope: string): boolean
}

/**
 * L4 固化库的写入口（技能库 / 案例库 / 提示库 / 路由表）。
 *
 * **未注入时，新类型提议（add-skill 等）只会被标记为 allowed，不产生任何实际效果。**
 * 这是刻意的诚实降级——在固化库建好之前，宁可让提议空转，也不假装它生效了。
 * host 接入固化库后注入 sink，提议即可真正落地。
 */
export interface CapabilitySink {
  addSkill(id: string, details: string): void
  addCase(id: string, details: string): void
  addPrompt(id: string, details: string): void
  reRoute(id: string, details: string): void
  pruneCache(id: string, details: string): void
  /** M3：给现有技能（md）追加补丁段落——只改 md，永不改代码。 */
  patchSkill(id: string, patch: string): void
}

/** M3：golden set 回归门地板。allowed 的提议生效前跑 CBS，c 低于此值 → 自动 superseded。 */
export const GOLDEN_SET_FLOOR = 0.5

/** 提议排序分：能力增量减去成本代价。ΔK 为负（省钱）时分数更高。 */
function proposalScore(d: ProposalDraft): number {
  return d.estimatedDc - DEFAULT_THRESHOLDS.costWeight * d.estimatedDk
}

/** diechi-evolve 核心服务。 */
export class EvolutionService {
  constructor(
    // @ts-expect-error P2 早期未使用：未来订阅 supervision/decision 事件时使用。
    private readonly ctx: Context,
    private readonly db: EvolveDb,
    private readonly supervisor: SupervisorLike,
    private readonly proposer: string = 'diechi-evolve',
    /** L4 固化库写入口（可选；缺它则新类型提议只记录不落地）。 */
    private readonly sink?: CapabilitySink,
    /** M5：scope → 真实技能 的确定性解析器（可选；缺它则 target 保持原始 scope）。 */
    private readonly resolver?: ScopeResolver,
    /** 自动 apply 模式（来自 settings.yaml `evolution.autoApply`）：
     *  - 'off'       关闭，纯人工审阅；
     *  - 'safe-only' 只自动落地建设性、零/负成本的固化类提议（add-skill/add-case/add-prompt/patch-skill）；
     *  - 'all'       在 safe-only 基础上额外放行 re-route / prune-cache。
     *  红线类（add-rule / revise-scope / add-bootstrap，动 frozen_rules 或授权策略）无论哪种模式
     *  都不自动 apply，永远留给人工终审——这就是「保留人工终审开关」的工程含义。 */
    private readonly autoApplyMode: 'off' | 'safe-only' | 'all' = 'off',
    /** 事件触发防抖窗口（ms）：监督者每产生一次决策就（防抖后）重跑一次通过率分析，
     *  让闭环"一有反馈就学"，不必等周期定时器。高频决策下用防抖合并，避免雪崩。 */
    private readonly feedbackDebounceMs: number = 30_000,
  ) {}

  /** 永远留给人工终审的红线类提议（写 frozen_rules / 改授权策略）。 */
  private static readonly HUMAN_CONFIRM_KINDS = new Set<ProposalChange['kind']>([
    'add-rule', 'revise-scope', 'add-bootstrap',
  ])
  /** safe-only 模式自动 apply 的「建设性、零/负成本」固化类提议。 */
  private static readonly SAFE_KINDS = new Set<ProposalChange['kind']>([
    'add-skill', 'add-case', 'add-prompt', 'patch-skill',
  ])

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
        // 冻结**不提升能力**，只防错——ΔC=0 让它在新排序里自然排到固化类提议后面。
        estimatedDc: 0,
        estimatedDk: -0.01,
        needsHumanConfirm: true,
      })
    }

    // 4) 写入 proposals 表
    const ids: number[] = []
    for (const draft of drafts) {
      const id = this.propose(draft)
      if (id > 0) ids.push(id)
    }
    return ids
  }

  /**
   * **S2 主入口**：同时读正样本与负样本，按预估 `ΔC − 0.5·ΔK` 排名产出提议。
   *
   * 与旧 `analyzeNegativeSamples()` 的本质区别：
   * - 旧方法只产出 `add-rule`——系统唯一的"学习"是把自己越勒越紧，跑久了必瘫；
   * - 新方法**正样本也能触发提议**，且提议类型以"增加能力"为主（add-skill / add-case /
   *   add-prompt / re-route），`add-rule` 降级为最后手段且需 human 二次确认。
   *
   * @returns 写入的提议 id 列表（按预估收益降序）。
   */
  analyzeSamples(): readonly number[] {
    const drafts: ProposalDraft[] = []
    const now = Date.now()
    const since = now - DEFAULT_THRESHOLDS.reasonWindowMs

    // 1) 体感样本按 scope 聚合出一次通过率——C(t) 的分母从这里来
    const positives = this.supervisor.listPositiveSamples?.(1000) ?? []
    const byScope = new Map<string, { good: number; bad: number; ids: number[] }>()
    for (const p of positives) {
      const t = Date.parse(p.created_at ?? '')
      if (!Number.isNaN(t) && t < since) continue
      const bucket = byScope.get(p.scope) ?? { good: 0, bad: 0, ids: [] }
      if (p.signal === 'accepted' || p.signal === 'no-rework') bucket.good += 1
      else bucket.bad += 1
      if (bucket.ids.length < 10) bucket.ids.push(p.id)
      byScope.set(p.scope, bucket)
    }
    const scopesWithFeedback = new Set(byScope.keys())

    // 2) 做得好的 → 固化；做得差的 → 改进
    for (const [scope, b] of byScope) {
      const total = b.good + b.bad
      if (total < DEFAULT_THRESHOLDS.minSamplesForProposal) continue
      const rate = b.good / total

      if (rate >= DEFAULT_THRESHOLDS.goodRate && b.good >= DEFAULT_THRESHOLDS.minSamplesForProposal) {
        const matured = b.good >= DEFAULT_THRESHOLDS.skillMaturity
        drafts.push({
          target: scope,
          change: {
            kind: matured ? 'add-skill' : 'add-case',
            id: matured ? `skill:${scope}` : `case:${scope}:${now}`,
            details: matured
              ? `把 ${scope} 的成功套路固化为可复用技能（基于 ${b.good} 次一次通过）`
              : `把 ${scope} 的成功案例存进案例库供 RAG 检索（${b.ids.length} 条）`,
          },
          evidence: b.ids,
          rationale: `${scope} 一次通过率 ${rate.toFixed(2)}（${b.good}/${total}）≥ ${DEFAULT_THRESHOLDS.goodRate}。固化后同类请求免采样——采样的收益一次性，固化的收益永久性。`,
          rollbackPlan: '标记为 superseded 即可回滚，不物理删除（A1 只增不减）。',
          estimatedDc: (matured ? 0.04 : 0.02) * Math.min(1, b.good / 10),
          estimatedDk: matured ? -0.05 : -0.03,
        })
      } else if (rate <= DEFAULT_THRESHOLDS.badRate && b.bad >= DEFAULT_THRESHOLDS.minSamplesForProposal) {
        // 先改提示（ΔK=0，最便宜）；返工够多再考虑加算力（ΔK 为正，会去撞成本门，由门判生死）
        drafts.push({
          target: scope,
          change: {
            kind: 'add-prompt',
            id: `prompt:${scope}:${now}`,
            details: `为 ${scope} 补充一段针对性 system prompt 片段（基于 ${b.bad} 次返工）`,
          },
          evidence: b.ids,
          rationale: `${scope} 一次通过率 ${rate.toFixed(2)}（${b.good}/${total}）≤ ${DEFAULT_THRESHOLDS.badRate}，返工 ${b.bad} 次。改提示是最便宜的改进，不增加任何单次成本。`,
          rollbackPlan: '提示片段版本化，回退指针即可，旧版本保留。',
          estimatedDc: 0.05 * Math.min(1, b.bad / 10),
          estimatedDk: 0,
        })
        // M3：返工样本同时出 patch-skill 提议——「这么做更好」而不是「别再做了」。
        // 只改对应技能 md（persona/知识/流程），永不改代码；target 指向固化库技能 id。
        drafts.push({
          target: scope,
          change: {
            kind: 'patch-skill',
            id: `skill:${scope}`,
            details: `根据 ${b.bad} 次用户返工，修补技能 skill:${scope} 的方法论/边界段落：`
              + '把返工场景的正确做法写进 ## B — 边界（易错点）与 ## E — 可执行步骤（判停条件）。'
              + '补丁由人工 review 后生效，原文永不覆盖（只追加版本化补丁段落）',
          },
          evidence: b.ids,
          rationale: `${scope} 返工率 ${(1 - rate).toFixed(2)}：同类失败重复出现说明知识库缺一块。patch-skill 是唯一不触碰代码、不冻结行为的建设性改进——失败变成知识。`,
          rollbackPlan: '补丁段落带 proposal id 标记，删除该段落即回退；原技能正文永不修改。',
          estimatedDc: 0.04 * Math.min(1, b.bad / 10),
          estimatedDk: -0.02,
        })
        if (b.bad >= DEFAULT_THRESHOLDS.skillMaturity) {
          drafts.push({
            target: scope,
            change: {
              kind: 're-route',
              id: `route:${scope}`,
              details: `把 ${scope} 的算力档位上调（更大 N 或更强模型），${b.bad} 次返工说明当前档位不够`,
            },
            evidence: b.ids,
            rationale: `改提示可能不够：${scope} 返工 ${b.bad} 次 ≥ ${DEFAULT_THRESHOLDS.skillMaturity}。按 C=1−(1−p)^N 加大 N 能直接抬高一次通过率；代价是成本上升，能否合并交给成本门判定。`,
            rollbackPlan: '路由表回退到上一档即可。',
            estimatedDc: 0.03 * Math.min(1, b.bad / 10),
            estimatedDk: 0.15,
          })
        }
      }
    }

    // 3) 闸拦截的负样本：仅当该 scope **完全没有正样本**且失败极高频，才动用 add-rule
    const samples = this.supervisor.listNegativeSamples(1000).filter((s) => {
      const t = Date.parse((s as unknown as { created_at?: string }).created_at ?? '')
      if (Number.isNaN(t)) return true
      return t >= since
    })
    const byReason = new Map<string, Array<{ id: number; scope: string; reason: string }>>()
    for (const s of samples) {
      const list = byReason.get(s.reason) ?? []
      list.push(s)
      byReason.set(s.reason, list)
    }
    for (const [reason, list] of byReason) {
      if (list.length < DEFAULT_THRESHOLDS.reasonCount) continue
      const scopeCount = new Map<string, number>()
      for (const s of list) scopeCount.set(s.scope, (scopeCount.get(s.scope) ?? 0) + 1)
      const topScope = [...scopeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      if (topScope === undefined) continue
      // 该 scope 有正样本 → 它整体是有用的，冻结反而是自残，跳过
      if (scopesWithFeedback.has(topScope)) continue
      drafts.push({
        target: topScope,
        change: {
          kind: 'add-rule',
          id: topScope,
          details: `${reason} 累计 ${list.length} 次且 ${topScope} 从未产生过正样本——冻结是最后手段，需 human 确认。`,
        },
        evidence: list.slice(0, 10).map((s) => s.id),
        rationale: `${reason} 在 ${topScope} 上累计 ${list.length} ≥ ${DEFAULT_THRESHOLDS.reasonCount}，且该 scope 零正样本——冻结不会损失任何已验证的能力。`,
        rollbackPlan: '人工 reviewProposal 判 denied 或 revokeAuthorization 即可解冻。',
        estimatedDc: 0,
        estimatedDk: -0.01,
        needsHumanConfirm: true,
      })
    }

    // 4) 按收益排序取 top N——进化要有方向，不能"出事了就冻一下"
    const ranked = [...drafts].sort((a, b) => proposalScore(b) - proposalScore(a))
    const ids: number[] = []
    for (const draft of ranked.slice(0, DEFAULT_THRESHOLDS.maxDraftsPerRun)) {
      const id = this.propose(draft)
      if (id > 0) ids.push(id)
    }
    return ids
  }

  /**
   * 事件触发入口：监督者每次决策（allow→正样本 / deny→负样本）后由 host 调一次。
   * 防抖合并高频决策，窗口内末次触发才真正跑一次通过率分析（analyzeSamples）。
   * 周期定时器仍保留作兜底（覆盖不走 decide() 的纯用户返工信号）。
   */
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null
  notifyFeedback(): void {
    if (this.feedbackTimer !== null) clearTimeout(this.feedbackTimer)
    this.feedbackTimer = setTimeout(() => {
      this.feedbackTimer = null
      try {
        const ids = this.analyzeSamples()
        if (ids.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`[diechi-evolve] analyzeSamples 产出 ${ids.length} 条（一次通过率驱动·事件触发）`)
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[diechi-evolve] analyzeSamples 失败', e)
      }
    }, this.feedbackDebounceMs)
  }

  /**
   * 写一条提议到 proposals 表。
   * 去重：同 target+kind 的 pending 提议若内容高度相似（视为同一改进），
   * 不再重复插入，直接复用已有 id——避免静态负样本下定时器每轮刷出近重复提议。
   * M5：落库前统一把 target 确定性解析到真实技能 id（覆盖引擎 / analyzeSamples /
   * analyzeNegativeSamples 所有路径），让 patch-skill 落到真实技能 md。
   * @returns 写入后的自增 id；命中重复时返回已有提议的 id。
   */
  propose(draft: ProposalDraft): number {
    // M5：所有路径的 target 都是原始 scope（如 e2e-engine-drill），落库前确定性改写。
    let d = draft
    if (this.resolver) {
      const r = this.resolver(draft.target)
      if (r) {
        d = { ...draft, target: r, change: { ...draft.change, id: `skill:${r}` } }
      }
    }
    const kind = d.change.kind
    for (const e of this.db.listPendingByTarget(d.target)) {
      const c = parseChange(e.change)
      if (c && c.kind === kind && similarDetails(c.details, d.change.details)) {
        // 命中重复：复用已有提议，返回 -1 表示"未新增"（诚实，不假装产出）
        return -1
      }
    }
    return this.db.insertProposal(
      this.proposer,
      d.target,
      serializeChange(d.change, d),
      d.evidence.join(','),
    )
  }

  /**
   * 审阅一条提议：allowed 时先过 golden set 回归门，再由 host 调
   * supervisor.freezeRule / authorizeScope / 固化库 sink 把副作用落库；
   * denied / superseded 不落。
   *
   * M3 双门：①golden set（CBS 一次通过率 ≥ GOLDEN_SET_FLOOR，未过自动降级
   * superseded 并附 rejectedReason）②add-rule 类的 needsHumanConfirm 由 UI 层保证。
   *
   * @returns 审阅结果（含 id / status / reviewed_at / goldenSet）。
   */
  reviewProposal(
    id: number,
    decision: 'allowed' | 'denied' | 'superseded',
    opts?: { auto?: boolean; skipGoldenGate?: boolean },
  ): ProposalReview {
    // golden set 门：只对 allowed 生效。跑分是确定性查表测试，不调 LLM（A3）。
    let golden: { c: number; passed: number; total: number } | undefined
    if (decision === 'allowed' && !opts?.skipGoldenGate && typeof this.supervisor.runGoldenSet === 'function') {
      try {
        golden = this.supervisor.runGoldenSet()
      } catch {
        golden = undefined // 跑不了基准就不拦——诚实降级，与「无 sink 不落地」同一原则
      }
      if (golden !== undefined && golden.total > 0 && golden.c < GOLDEN_SET_FLOOR) {
        this.db.reviewProposal(id, 'superseded')
        return {
          id,
          status: 'superseded',
          reviewed_at: new Date().toISOString(),
          goldenSet: golden,
          rejectedReason: `golden set 一次通过率 ${golden.c.toFixed(2)} 低于地板 ${GOLDEN_SET_FLOOR}——当前基座不可靠，任何改动先修基座（A1 回归门）`,
        }
      }
    }
    const ok = this.db.reviewProposal(id, decision)
    if (!ok) {
      throw new Error(`reviewProposal 失败：id=${id} 不存在或已审阅`)
    }
    if (decision === 'allowed') {
      this.applyProposal(id, opts)
    }
    const review: ProposalReview = {
      id,
      status: decision as ProposalStatus,
      reviewed_at: new Date().toISOString(),
    }
    if (golden !== undefined) {
      return { ...review, goldenSet: golden }
    }
    return review
  }

  /**
   * **自动 apply 定时器入口**：周期性扫描 pending 提议，对安全类别自动走
   * `reviewProposal('allowed')`，让三架构闭环从"会学"走到"会改自己"。
   *
   * 安全边界（与 A1/A2/A3 同源，刻意保守）：
   * - `autoApplyMode==='off'` 时直接返回 0——不开就纯人工；
   * - 红线类（`HUMAN_CONFIRM_KINDS`：add-rule / revise-scope / add-bootstrap，动 frozen_rules
   *   或授权策略）任何模式都不自动 apply，永远留给人工终审；
   * - `safe-only` 只放行 `SAFE_KINDS`（add-skill / add-case / add-prompt / patch-skill，
   *   建设性、ΔK≤0），re-route（加算力）与 prune-cache 留给人工；
   * - `all` 在以上基础上额外放行 re-route / prune-cache；
   * - **每条自动 apply 都必须先过 golden set 回归门**（runGoldenSet 一次通过率
   *   ≥ GOLDEN_SET_FLOOR）。跑不了基准 / 低于地板 → 整轮跳过，绝不裸放行
   *   （防奖励黑客：改动只有"不降低已验证能力"才被允许）。
   *
   * golden set 每个 tick 只跑一次，所有候选共用同一基线（避免逐条重复跑分）。
   *
   * @returns 本次自动落地的提议条数。
   */
  async autoApplyPending(): Promise<number> {
    if (this.autoApplyMode === 'off') return 0

    // golden set 回归门：每个 tick 只跑一次，作为整个 tick 的放行前提。
    // 跑不了基准 → 整轮跳过（留给人工），绝不裸放行。
    if (typeof this.supervisor.runGoldenSet !== 'function') {
      // eslint-disable-next-line no-console
      console.log('[diechi-evolve] autoApply 跳过本轮（无 golden set 能力，留给人工）')
      return 0
    }
    let golden: { c: number; passed: number; total: number } | undefined
    try {
      golden = this.supervisor.runGoldenSet()
    } catch {
      // eslint-disable-next-line no-console
      console.log('[diechi-evolve] autoApply 跳过本轮（golden set 异常，留给人工）')
      return 0
    }
    if (golden.total > 0 && golden.c < GOLDEN_SET_FLOOR) {
      // eslint-disable-next-line no-console
      console.log(`[diechi-evolve] autoApply 跳过本轮（golden set ${golden.c.toFixed(2)} < ${GOLDEN_SET_FLOOR}）`)
      return 0
    }

    const pending = this.listPending(200)
    let applied = 0
    for (const p of pending) {
      const change = parseChange(p.change)
      if (change === null) continue
      // 红线类：任何模式都留给人工终审
      if (EvolutionService.HUMAN_CONFIRM_KINDS.has(change.kind)) continue
      // safe-only：只放行建设性固化类；re-route / prune-cache 留给人工
      if (this.autoApplyMode === 'safe-only' && !EvolutionService.SAFE_KINDS.has(change.kind)) continue

      try {
        this.reviewProposal(p.id, 'allowed', { auto: true, skipGoldenGate: true })
        applied++
        // eslint-disable-next-line no-console
        console.log(`[diechi-evolve] autoApply 已落地 #${p.id} kind=${change.kind}`)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[diechi-evolve] autoApply 落 #${p.id} 失败`, e)
      }
    }
    return applied
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

  /**
   * 提议 allowed 后落地副作用。
   *
   * add-rule 写 frozen_rules（已有能力）；其余新类型（add-skill / add-case /
   * add-prompt / re-route / prune-cache）走 L4 固化库 sink——**没有 sink 就不落地**。
   */
  private applyProposal(id: number, opts?: { auto?: boolean }): void {
    const row = this.db.getProposal(id)
    if (row === undefined) return
    if (row.status !== 'allowed') return
    const change = parseChange(row.change)
    if (change === null) return

    // ---- 新类型：走 L4 固化库（未注入 sink 则只标记 allowed，不假装生效）----
    if (change.kind === 'add-skill' || change.kind === 'add-case' || change.kind === 'add-prompt'
      || change.kind === 're-route' || change.kind === 'prune-cache' || change.kind === 'patch-skill') {
      const sink = this.sink
      if (sink === undefined) {
        // 诚实降级：不写任何东西，也不抛错。审计靠 proposals 行本身（status='allowed' + change.details）。
        return
      }
      const detail = `${opts?.auto ? '[AUTO-APPLIED] ' : ''}由 proposal #${id} 落库：${change.details}`
      if (change.kind === 'add-skill') sink.addSkill(change.id, detail)
      else if (change.kind === 'add-case') sink.addCase(change.id, detail)
      else if (change.kind === 'add-prompt') sink.addPrompt(change.id, detail)
      else if (change.kind === 're-route') sink.reRoute(change.id, detail)
      else if (change.kind === 'patch-skill') sink.patchSkill(change.id, detail)
      else sink.pruneCache(change.id, detail)
      return
    }

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

/** 带预估收益的提议变更（UI 卡片要显示 ΔC/ΔK，故一并存进 change 字段）。 */
type StoredChange = ProposalChange & {
  readonly dc: number
  readonly dk: number
  readonly humanConfirm: boolean
}

/** 把 ProposalChange 序列化为 JSON 字符串（P3.11）。
 * 旧版是 `kind:id details` 字符串（不再用），新版是 `{"kind":..,"id":..,"details":..}`。
 * S2 起额外带 `dc` / `dk` / `humanConfirm`——预估收益，供 P2 提议卡片展示与排序复核。
 * DB schema 不变（change TEXT 字段装 JSON 字符串）— 旧数据兼容由 parseChange 兜底。
 */
function serializeChange(
  change: ProposalChange,
  estimate?: { estimatedDc?: number; estimatedDk?: number; needsHumanConfirm?: boolean },
): string {
  return JSON.stringify({
    kind: change.kind,
    id: change.id,
    details: change.details,
    dc: estimate?.estimatedDc ?? 0,
    dk: estimate?.estimatedDk ?? 0,
    humanConfirm: estimate?.needsHumanConfirm === true,
  })
}

/** 从字符串反序列化 ProposalChange。
 * 1) 先尝试 JSON 解析（P3.11 新格式）
 * 2) 失败时 fallback 字符串解析（兼容 P3.8 及之前的旧 proposals 行）
 * 3) 两条都失败 → null
 *
 * 缺失 dc/dk 的旧数据一律补 0——旧提议没有预估收益，UI 显示为 "—" 即可。
 */
function parseChange(raw: string): StoredChange | null {
  // 1) JSON 路径（P3.11+ 新格式）
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as {
        kind?: string
        id?: string
        details?: string
        dc?: number
        dk?: number
        humanConfirm?: boolean
      }
      if (typeof obj.kind === 'string' && typeof obj.id === 'string' && typeof obj.details === 'string') {
        return {
          kind: obj.kind as ProposalChange['kind'],
          id: obj.id,
          details: obj.details,
          dc: typeof obj.dc === 'number' && Number.isFinite(obj.dc) ? obj.dc : 0,
          dk: typeof obj.dk === 'number' && Number.isFinite(obj.dk) ? obj.dk : 0,
          humanConfirm: obj.humanConfirm === true,
        }
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
    dc: 0,
    dk: 0,
    humanConfirm: false,
  }
}

/**
 * 两条改进细节是否高度相似（视为同一提议）。
 * 模型每次输出措辞略不同，故用：精确相等 / 包含关系 / token Jaccard ≥ 0.5 任一即判重。
 */
function similarDetails(a: string, b: string): boolean {
  const na = a.trim()
  const nb = b.trim()
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  const split = (s: string): Set<string> =>
    new Set(s.split(/[\s，。、；：,.;:！!？?]+/).filter(t => t.length > 0))
  const ta = split(na)
  const tb = split(nb)
  if (ta.size === 0 || tb.size === 0) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union > 0 && inter / union >= 0.5
}
