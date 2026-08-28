/**
 * diechi-supervisor 的 WorldModelClient 抽象：
 * 决定"person-brain:predict 授权通过后调哪个世界模型"。
 *
 * P3.7 阶段：实现一个**启发式 no-op 客户端**——返回简单的 state 重复。
 * 真实世界模型（V-JEPA / 物理引擎 / LLM 推演）由业务侧自行实现
 * WorldModelService 接口并通过 setWorldModelContext() 注入。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/world-model
 */

import type {
  PredictInput,
  PredictOutput,
  WorldModelService,
} from '@deepseek-ai/dsh-host-skill-store'

/** 启发式 no-op 实现：返回 state 重复 N 次 + 低置信度——仅占位，让基座保护能跑通。 */
export class HeuristicWorldModel implements WorldModelService {
  private readonly modelTag: string

  constructor(modelTag = 'heuristic-noop') {
    this.modelTag = modelTag
  }

  async predict(input: PredictInput): Promise<PredictOutput> {
    const start = Date.now()
    const states: Readonly<Record<string, unknown>>[] = []
    for (let i = 0; i < Math.max(1, input.lookahead); i += 1) {
      states.push({ ...input.state, _step: i })
    }
    return {
      states,
      confidence: 0.1,  // 极低——业务应降级使用
      modelTag: this.modelTag,
      durationMs: Date.now() - start,
    }
  }
}
