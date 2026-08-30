/**
 * 自进化度量网关：把监督者库里的 C(t) / K(t) / 体感样本 / 提议 暴露成 RPC，
 * 供前端可感知层（P0-P3）实时抓取。
 *
 * 设计约束（三架构公理的直接后果）：
 * - **只读为主**：所有查询方法都不写库。唯一例外是 `runCbs({commit:true})`，
 *   它写 capability_snapshots——这是"人类主动点按钮"的动作，不是系统自发写入。
 * - **A3 可判定性**：本网关不调 LLM，不做模糊判断。每个数字都能追溯到
 *   一条 SQL 或一次确定性算术。
 * - **诚实降级**：evolve 插件没装载时 `evolutionAvailable=false` 且 proposals 为空，
 *   不编造提议来让界面好看。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SupervisorDb } from './db.ts'
import type { SupervisorService } from './service.ts'
import { CapabilityGate } from './gate.ts'
import { CBS_V1, CbsRunner, costOf, type CbsResult } from './cbs.ts'
// ───────────────── 载荷类型 ─────────────────
//
// 定义在 types.ts 而不是这里：typert 生成器要求 Remote 边界类型必须从包的
// 公共非根类型子路径（./types）导出，否则生成 remote-client 时会报
// "Remote boundary type X must be exported from a public non-root type subpath"。
import type {
  EvolutionCbsOutcome, EvolutionCbsView, EvolutionHistoryPoint, EvolutionProposalView,
  EvolutionSignalTally, EvolutionSnapshot, PositiveSignal,
} from './types.ts'

export type {
  EvolutionCbsOutcome, EvolutionCbsView, EvolutionHistoryPoint, EvolutionProposalView,
  EvolutionSignalTally, EvolutionSnapshot,
} from './types.ts'


/**
 * 自进化度量网关。
 *
 * 不写进 `inject` 的服务依赖：db 与 service 由插件主体直接注入——
 * 本网关与监督者同生共死，走 cordis 依赖解析反而会让生命周期更难推理。
 */
export class EvolutionGateway extends TypertRemoteService {
  private readonly ctxRef: Context
  private readonly db: SupervisorDb
  private readonly service: SupervisorService
  private readonly gate: CapabilityGate
  private readonly runner: CbsRunner
  /** 最近一次 CBS 跑分（进程内缓存）。 */
  private lastCbs: EvolutionCbsView | null = null

  constructor(ctx: Context, db: SupervisorDb, service: SupervisorService) {
    super(ctx, 'diechiEvolution')
    this.ctxRef = ctx
    this.db = db
    this.service = service
    // 用监督者同款配置实例化一个门：配置相同 → 前端看到的软带与真实判定用的软带是同一条。
    this.gate = new CapabilityGate(db, service.gateConfig())
    this.runner = new CbsRunner(CBS_V1)
  }

  /** 一次抓全：能力 / 成本 / 信号 / 规则 / 历史 / 提议。 */
  @Remote('overview')
  overview(): EvolutionSnapshot {
    return this.snapshot()
  }

  /**
   * 跑一次 CBS 能力基准集（在库副本上，不污染生产负样本表）。
   * `commit=true` 时把结果写成 capability_snapshots 的一个点——这是唯一会写库的方法，
   * 且只在人类主动点按钮时触发。
   */
  @Remote('runCbs')
  runCbs(input?: { commit?: boolean }): EvolutionCbsOutcome {
    const result = this.runner.run(this.db)
    const committed = input?.commit === true
    if (committed) {
      this.service.recordSnapshot(result.version, result.cScore, result.kScore, result.total)
    }
    this.lastCbs = toCbsView(result, committed)
    return { cbs: this.lastCbs, snapshot: this.snapshot() }
  }

  /** 体感信号计数。 */
  @Remote('signals')
  signals(limit: number): EvolutionSignalTally {
    return tally(this.service.listPositiveSamples(limit))
  }

  /** 提议清单（evolve 未装载时返回空 + available=false）。 */
  @Remote('proposals')
  proposals(limit: number): { readonly available: boolean; readonly items: readonly EvolutionProposalView[] } {
    const evolution = this.readEvolution()
    if (evolution === undefined) return { available: false, items: [] }
    return { available: true, items: evolution.slice(0, limit) }
  }

  /** 历史曲线（时间正序）。 */
  @Remote('history')
  history(limit: number): readonly EvolutionHistoryPoint[] {
    return this.service
      .listSnapshots(limit)
      .map((row) => ({ at: row.at, c: row.c_score, k: row.k_score, sampleCount: row.sample_count }))
      .reverse()
  }

  // ───────────────────────── 内部 ─────────────────────────

  private snapshot(): EvolutionSnapshot {
    const score = this.service.currentScore()
    const best = this.service.bestScore()
    const frozen = this.db.listFrozenRules().length
    const authorized = this.db.listAuthorizations().length
    const kNow = costOf(frozen, authorized)
    const ema = this.gate.kBar()
    const cfg = this.gate.config()
    const positives = this.service.listPositiveSamples(500)

    // 成本档位：直接问门"这个成本算超了吗"，而不是在前端复刻一遍阈值。
    const verdict = this.gate.evaluate({
      cbsVersion: this.runner.version,
      cScore: score.c,
      kScore: kNow,
      sampleCount: score.total,
    })

    return {
      at: new Date().toISOString(),
      cbsVersion: this.runner.version,
      capability: {
        current: score.c,
        best: best ?? score.c,
        positive: score.positive,
        total: score.total,
      },
      cost: {
        current: kNow,
        ema,
        bandLo: ema * (1 - cfg.bandRatio),
        bandHi: ema * (1 + cfg.bandRatio),
        hardMax: cfg.kMax,
        action: verdict.cost.action,
      },
      signals: tally(positives),
      rules: { frozen, authorized },
      negatives: this.db.countNegativeSamples(),
      history: this.history(200),
      proposals: this.readEvolution() ?? [],
      evolutionAvailable: this.readEvolution() !== undefined,
      latestCbs: this.lastCbs,
      telemetry: {
        enabled: true,
        throttleMs: this.service.telemetryThrottleMs,
      },
    }
  }

  /**
   * 软依赖读 evolve 的提议。
   *
   * 用 ctx.get 而不是 import：supervisor 不能反向依赖 evolve（evolve 依赖 supervisor，
   * 反向 import 会成环）。拿不到就返回 undefined，前端显示"进化设计者未装载"。
   */
  private readEvolution(): readonly EvolutionProposalView[] | undefined {
    let raw: unknown
    try {
      raw = this.ctxRef.get('evolution')
    } catch {
      return undefined
    }
    if (raw === null || typeof raw !== 'object') return undefined
    const listAll = (raw as { listAll?: unknown }).listAll
    if (typeof listAll !== 'function') return undefined
    let rows: unknown
    try {
      rows = (listAll as (limit?: number) => unknown).call(raw, 20)
    } catch {
      return undefined
    }
    if (!Array.isArray(rows)) return undefined
    return rows.map(toProposalView)
  }
}

/** 把 CBS 结果压成前端视图（failures 只留 id，避免几十条大对象过线）。 */
function toCbsView(result: CbsResult, committed: boolean): EvolutionCbsView {
  const byFamily: Record<string, { total: number; passed: number; rate: number }> = {}
  for (const [key, stat] of Object.entries(result.byFamily)) byFamily[key] = { ...stat }
  return {
    version: result.version,
    cScore: result.cScore,
    kScore: result.kScore,
    total: result.total,
    passed: result.passed,
    byFamily,
    failureIds: result.failures.map((f) => f.id),
    ruleCount: { ...result.ruleCount },
    ranAt: new Date().toISOString(),
    committed,
  }
}

/** 体感样本按信号类型计数。 */
function tally(rows: readonly { signal: string }[]): EvolutionSignalTally {
  let accepted = 0
  let noRework = 0
  let userUndo = 0
  let explicitBad = 0
  for (const row of rows) {
    const signal = row.signal as PositiveSignal
    if (signal === 'accepted') accepted += 1
    else if (signal === 'no-rework') noRework += 1
    else if (signal === 'user-undo') userUndo += 1
    else if (signal === 'explicit-bad') explicitBad += 1
  }
  return { accepted, noRework, userUndo, explicitBad, total: rows.length }
}

/** 把 evolve 的行（字段形状可能演化）投影成稳定视图。 */
function toProposalView(row: unknown): EvolutionProposalView {
  const r = (row ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    id: num(r['id']),
    kind: str(r['kind']),
    scope: str(r['scope']),
    summary: str(r['summary']),
    estimatedDc: num(r['estimatedDc']),
    estimatedDk: num(r['estimatedDk']),
    status: str(r['status']),
    createdAt: str(r['createdAt']),
  }
}
