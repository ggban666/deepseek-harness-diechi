/**
 * diechi-process-control host 插件：cordis 函数式插件。
 *
 * 职责：
 * - 构造 ProcessGateway，把 Qwen3.8 / 视频模型 两个外部服务进程的
 *   手动启停暴露成 remote.diechiProcess RPC（list / start / stop）。
 *
 * 只管理重显存的外部服务（8081 / 8080），不碰 3090 主进程（watchdog 的职责）。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-control
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { ProcessGateway } from './gateway.ts'

export { ProcessGateway } from './gateway.ts'
export { ProcessManager } from './manager.ts'
export type * from './types.ts'

/** Cordis 插件名。 */
export const name = 'diechi-process-control'

/** 无必需服务——进程管理不依赖 supervisor / evolve / settings。 */
export const inject = [] as const

/**
 * Cordis 函数式插件主体。
 */
export function apply(ctx: Context): void {
  // 构造即向 Typert 网关注册，前端通过 ctx.remote.diechiProcess 调用。
  const gateway = new ProcessGateway(ctx)

  // 卸载时关闭所有本管理器拉起过的子进程。
  ctx.effect(() => () => { void gateway.shutdown() }, 'diechi-process-control: 关闭受控子进程')
}
