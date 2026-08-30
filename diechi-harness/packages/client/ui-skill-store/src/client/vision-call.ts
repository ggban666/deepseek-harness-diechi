/**
 * 视觉端点调用的统一脚手架。
 *
 * 抽取动机：原先 index.ts 里 10 个视觉调用各自复制一套
 * 「取配置 → 判启用 → 规整端点 → AbortController → 超时 → catch 映射 → finally 清理」
 * 的 12 行流程，端点规整重复 10 处、超时预算散落 5 个魔法数字。抽取后这些策略只此一份，
 * 不会在各方法之间悄悄漂移。
 *
 * 边界：本模块**不决定失败时返回什么**。存在两种有意为之的失败约定——
 * - 结果对象约定（识别类）：返回 `{ ok: false, error: 'vision-disabled' | ... }` 给用户看
 * - 静默约定（实时画面类）：返回 `undefined` / `''`，绝不能打断录像循环
 * 哨兵值由调用方给，本模块只负责"是否启用"的判定与资源装配。
 */
import type { VisionState } from './VisionSection.tsx'

/** 本地视觉服务的默认地址（vision-server.py 默认监听 8080）。 */
export const VISION_DEFAULT_ENDPOINT = 'http://127.0.0.1:8080'
/** 默认视觉模型名。 */
export const VISION_DEFAULT_MODEL = 'MiniCPM-V-4.6'

/**
 * 单次视觉调用的超时预算（毫秒）。按调用性质分档，替换原先散落的魔法数字。
 */
export const VISION_TIMEOUT = {
  /** 图片识别：模型要跑完整推理 */
  recognize: 120_000,
  /** 视频识别：服务端解码 + 逐帧推理，最慢 */
  video: 600_000,
  /** 实时画面解说 / 摄像头对话：叠在录像循环里，超时就跳过这一帧 */
  liveFrame: 20_000,
  /** 服务端会话的流式回合 */
  streamTurn: 90_000,
  /** 连续感知推帧：只入缓冲不推理，必须极快返回 */
  observe: 5_000,
} as const

/** 一次已装配好的视觉调用。 */
export interface VisionCall {
  /** 已规整（去掉结尾斜杠）的服务端地址 */
  readonly endpoint: string
  /** 已回落到默认值的模型名 */
  readonly model: string
  /** 超时或外部 abort 触发时会被 abort 的信号 */
  readonly signal: AbortSignal
  /** 必须在 `finally` 里调用：清超时定时器并摘掉外部 abort 监听。 */
  readonly release: () => void
}

/**
 * 只做端点规整，不判启用。
 * 供会话拆除类调用使用——`endVisionSession` / `interruptVision` 必须在
 * 用户中途关掉视觉开关后仍能发出去，否则服务端会话会泄漏。
 * @param config - 当前视觉配置，缺失时回落默认值。
 * @returns 去掉结尾斜杠的服务端地址。
 */
export function visionEndpoint(config: VisionState | undefined): string {
  return (config?.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
}

/**
 * 装配一次受保护（要求已启用）的视觉调用。
 * @param config - 当前视觉配置。
 * @param timeoutMs - 超时预算，取 `VISION_TIMEOUT` 里对应档位。
 * @param outer - 可选的外部中止信号，中止时联动本次调用。
 * @returns 未启用时返回 `undefined`，调用方自行决定哨兵值。
 */
export function beginVisionCall(
  config: VisionState | undefined,
  timeoutMs: number,
  outer?: AbortSignal,
): VisionCall | undefined {
  if (config?.enabled !== true) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  const onOuterAbort = (): void => { controller.abort() }
  outer?.addEventListener('abort', onOuterAbort, { once: true })
  return {
    endpoint: visionEndpoint(config),
    model: config.model || VISION_DEFAULT_MODEL,
    signal: controller.signal,
    release: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    },
  }
}

/**
 * 把传输层异常归一成结果对象约定的错误码。
 * 超时（自己的 AbortError）和网络故障要分开报，用户才知道是该重试还是检查服务。
 * @param error - catch 到的异常。
 * @returns `vision-timeout` 或 `vision-network`。
 */
export function visionFailure(error: unknown): string {
  return error instanceof DOMException && error.name === 'AbortError'
    ? 'vision-timeout'
    : 'vision-network'
}

/**
 * 读取视觉服务的 SSE 流并把 delta 拼成完整文本。
 *
 * 契约（重要）：**流读取失败时不抛异常，返回已拼到的部分文本**。
 * 摄像头对话里半截回复比空串有用——模型已经说出口的字不该因为收尾失败而整段消失。
 * 逐块按空行切事件，跳过畸形行——服务端偶发半包不该炸掉整轮对话。
 *
 * @param body - 响应体流。
 * @param onDelta - 每收到一段增量就回调一次，用于打字机效果。
 * @returns 拼接后的完整文本；流中断时为已收到的部分。
 */
export async function readVisionStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n\n')
      while (idx >= 0) {
        for (const line of buffer.slice(0, idx).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type?: string; delta?: string }
            if (event.type === 'delta' && typeof event.delta === 'string') {
              full += event.delta
              onDelta?.(event.delta)
            }
          } catch { /* 跳过畸形事件，不中断整轮 */ }
        }
        buffer = buffer.slice(idx + 2)
        idx = buffer.indexOf('\n\n')
      }
    }
  } catch {
    return full
  }
  return full
}
