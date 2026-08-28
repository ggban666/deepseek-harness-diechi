/**
 * WorldModelService 接口契约：物理 / 因果 / 时序推演。
 *
 * 三架构中的定位：
 * - **被升级者（PersonBrain）**"使用" world model 跑预测——通过 PersonBrain.predict() 入口
 * - **监督者（diechi-supervisor）**"控制" world model 能不能用——通过 gateWrite('person-brain:predict') 决策
 * - **升级设计者（diechi-evolve）**"提议" world model 行为变更——通过 proposals 表
 *
 * 内部实现不限定：可以是 V-JEPA / 物理引擎 / LLM 推理 / 任意服务。
 * PersonBrain.predict 只通过这个接口拿到结果，不直接 import 任何具体实现。
 *
 * @module @deepseek-ai/dsh-host-skill-store/world-model
 */

/** 一次预测的输入：当前状态 + 推演步数。 */
export interface PredictInput {
  /** 当前世界状态（业务侧序列化）。 */
  readonly state: Readonly<Record<string, unknown>>
  /** 推演步数（lookahead）；1 表示只推下一步。 */
  readonly lookahead: number
  /** 业务上下文（scope / scenario 等元数据）。 */
  readonly context?: Readonly<Record<string, unknown>>
}

/** 一次预测的输出：未来 N 步的状态 + 置信度。 */
export interface PredictOutput {
  /** 未来 N 步的状态序列（长度 === input.lookahead）。 */
  readonly states: readonly Readonly<Record<string, unknown>>[]
  /** 整体置信度 0-1。低于阈值业务应降级使用。 */
  readonly confidence: number
  /** 模型自身标注（如 'physics-engine-v1' / 'v-jepa-2' / 'heuristic'）。 */
  readonly modelTag: string
  /** 预测耗时（毫秒）——用于监督者做"超慢推演"检测。 */
  readonly durationMs: number
}

/** WorldModelService 接口。 */
export interface WorldModelService {
  /** 跑一次预测。 */
  predict(input: PredictInput): Promise<PredictOutput>
  /** 健康检查（可选）——监督者用此决定是否冻结。 */
  health?(): Promise<{ ok: boolean; latencyMs?: number }>
}

/** 默认 no-op 实现——业务调用前必须先注入真实实现。 */
export const NULL_WORLD_MODEL: WorldModelService = {
  async predict() {
    throw new Error('WorldModelService 未注入')
  },
}
