/**
 * diechi-supervisor 双门（S3）：回归门 + 成本门。
 *
 * 这是公理 A1（能力单调不减）与 A2（成本 ±20% 有界）在代码里的**唯一执行者**。
 * 没有这两扇门，进化就没有方向；有了它们，"改进"才是一个可以被判定的动作，
 * 而不是"出事了就冻一下"。
 *
 * 设计约束（A3）：**全 deterministic 查表/算术，不调 LLM。**
 * 判定本身若交给模型，就打开了奖励黑客的大门——模型可以说自己通过了。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/gate
 */

import type { SupervisorDb } from './db.ts'

/** 双门配置。 */
export interface GateConfig {
  /**
   * 回归门容差 ε：`C' ≥ bestC − ε` 才算过。
   * 默认 0（严格不退化）；基准集有噪声时可放宽到置信下界。
   */
  readonly epsilon: number
  /** 成本软带比例：允许 `K' ≤ K̄ · (1 + bandRatio)`。默认 0.2（±20%）。 */
  readonly bandRatio: number
  /** 成本绝对硬顶。超出即拒绝服务（防棘轮：只做相对约束会让成本缓慢单调爬升）。 */
  readonly kMax: number
  /** K̄ 的 EMA 平滑系数。 */
  readonly emaAlpha: number
  /** 计算 K̄ 时回看的快照条数。 */
  readonly emaWindow: number
}

/** 候选版本的度量结果（由沙盒子进程跑 CBS 得到）。 */
export interface GateInput {
  readonly cbsVersion: string
  /** 候选版本的一次通过率 0..1。 */
  readonly cScore: number
  /** 候选版本的归一化单次成本。 */
  readonly kScore: number
  readonly sampleCount: number
}

/** 单门结果。 */
export interface GateVerdict {
  readonly pass: boolean
  /** 未通过的原因（双门统一口径，直接写进 negative_samples.reason）。 */
  readonly reason?: 'regression-gate' | 'cost-gate'
}

/** 回归门明细。 */
export interface RegressionDetail {
  readonly pass: boolean
  /** 历史最高 C（比较基线）。 */
  readonly baseline: number
  readonly candidate: number
  readonly delta: number
  readonly epsilon: number
}

/** 成本门明细。 */
export interface CostDetail {
  readonly pass: boolean
  /** 滑动基线 K̄（EMA）。 */
  readonly kBar: number
  /** 软带上下界。 */
  readonly bandLo: number
  readonly bandHi: number
  readonly kMax: number
  readonly candidate: number
  /**
   * - none：带内，正常合并
   * - throttle：超软带但在硬顶内——允许合并，但必须降档（降采样数 / 换小模型）
   * - reject：超硬顶，直接拒绝
   */
  readonly action: 'none' | 'throttle' | 'reject'
}

/** 双门评估结果。 */
export interface GateResult extends GateVerdict {
  readonly regression: RegressionDetail
  readonly cost: CostDetail
}

const DEFAULT_CONFIG: GateConfig = {
  epsilon: 0,
  bandRatio: 0.2,
  kMax: 2.0,
  emaAlpha: 0.1,
  emaWindow: 50,
}

/** 无历史数据时的 K̄ 初值。取 1.0 = 归一化成本的 "1 倍基准"。 */
const K_BAR_SEED = 1.0

/**
 * 能力/成本双门。
 *
 * 用法：
 * ```ts
 * const gate = new CapabilityGate(db)
 * const result = gate.evaluate({ cbsVersion: 'CBS-v1', cScore: 0.74, kScore: 1.05, sampleCount: 100 })
 * if (!result.pass) proposal.review(id, 'denied')  // reason = result.reason
 * ```
 */
export class CapabilityGate {
  private readonly cfg: GateConfig

  constructor(
    private readonly db: SupervisorDb,
    config: Partial<GateConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...config }
  }

  /** 当前生效配置（合并后的）。 */
  config(): GateConfig {
    return this.cfg
  }

  /**
   * 滑动基线 K̄（EMA）。
   *
   * 注意顺序：快照是 id 倒序取回的，必须从**旧到新**做 EMA，
   * 否则最近一次的值权重最小，基线会滞后得毫无意义。
   *
   * @param cbsVersion 限定基准集版本；undefined 表示跨版本（版本升级会重置基线，这是预期的）。
   */
  kBar(cbsVersion?: string): number {
    const rows = this.db.listSnapshots(this.cfg.emaWindow)
    const series = (cbsVersion === undefined ? rows : rows.filter((r) => r.cbs_version === cbsVersion))
      .map((r) => Number(r.k_score))
      .filter((v) => Number.isFinite(v))
      .reverse() // 旧 → 新
    if (series.length === 0) return K_BAR_SEED
    const alpha = Math.min(1, Math.max(0, this.cfg.emaAlpha))
    let ema = series[0] ?? K_BAR_SEED
    for (let i = 1; i < series.length; i++) {
      ema = ema * (1 - alpha) + (series[i] ?? ema) * alpha
    }
    return ema
  }

  /** 只跑回归门（A1）。 */
  evaluateRegression(input: GateInput): RegressionDetail {
    // 跟**历史最优**比，而不是跟上一枪比——否则一次抖动会永久拉低基线。
    const baseline = this.db.bestScore(input.cbsVersion) ?? input.cScore
    const delta = input.cScore - baseline
    return {
      pass: input.cScore >= baseline - this.cfg.epsilon,
      baseline,
      candidate: input.cScore,
      delta,
      epsilon: this.cfg.epsilon,
    }
  }

  /** 只跑成本门（A2）。 */
  evaluateCost(input: GateInput): CostDetail {
    const kBar = this.kBar(input.cbsVersion)
    const bandHi = kBar * (1 + this.cfg.bandRatio)
    const bandLo = kBar * (1 - this.cfg.bandRatio)
    const overHardCap = input.kScore > this.cfg.kMax
    const overBand = input.kScore > bandHi
    return {
      // 超硬顶 = 拒绝；超软带 = 允许合并但必须降档（否则成本会一路爬到硬顶）
      pass: !overHardCap,
      kBar,
      bandLo,
      bandHi,
      kMax: this.cfg.kMax,
      candidate: input.kScore,
      action: overHardCap ? 'reject' : overBand ? 'throttle' : 'none',
    }
  }

  /**
   * 双门全评估（deterministic，不调 LLM）。
   *
   * 两条门**都**算完再返回——只算到第一条失败就 return，
   * 会让 UI 拿不到另一条门的数据，用户就没法知道"是能力退了还是成本爆了"。
   */
  evaluate(input: GateInput): GateResult {
    const regression = this.evaluateRegression(input)
    const cost = this.evaluateCost(input)
    const pass = regression.pass && cost.pass
    const reason: GateResult['reason'] = regression.pass
      ? cost.pass
        ? undefined
        : 'cost-gate'
      : 'regression-gate'
    return {
      pass,
      regression,
      cost,
      ...(reason === undefined ? {} : { reason }),
    }
  }
}
