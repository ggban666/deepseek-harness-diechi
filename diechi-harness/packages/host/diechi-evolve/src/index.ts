/**
 * diechi-evolve host 插件：cordis 函数式插件。
 *
 * 职责：
 * - 打开共享的监督者数据库（proposals + negative_samples）；
 * - 构造 EvolutionService：读 ctx.supervision 的负样本，写 proposals 表；
 * - 把 ctx.evolution 提供给后续插件（diechi-supervisor 的 P3 reviewProposal 工具
 *   未来会通过 ctx.evolution 调 reviewProposal / analyzeNegativeSamples）。
 *
 * mount 顺序要求：diechi-evolve 必须在 dsh-host-diechi-supervisor 之后 mount
 * （依赖 ctx.supervision）。不要求比 skill-store 早。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { dshHomeDir } from '@deepseek-ai/dsh-host-skill-store'
import { EvolveDb } from './db.ts'
import { EvolutionService, type SupervisorLike } from './service.ts'
import type { ProposalReview } from './types.ts'

/** 监督者 Service 扩展（带 onDecision 订阅 API）。 */
type SupervisorWithEvents = SupervisorLike & {
  onDecision(observer: (e: { scope: string; decision: string; reason: string }) => void): () => void
}

// 重新导出供测试和其他包使用。
export { EvolveDb } from './db.ts'
export { EvolutionService, type SupervisorLike } from './service.ts'
export type * from './types.ts'

/** Cordis 插件名。 */
export const name = 'diechi-evolve'

/** 必需服务。 */
export const inject = ['settings']

/** ctx.evolution Service 接口（暴露给 host 与 diechi-supervisor 的 P3 reviewProposal 工具）。 */
export interface EvolutionServiceInterface {
  analyzeNegativeSamples(): readonly number[]
  propose(draft: import('./types.ts').ProposalDraft): number
  reviewProposal(id: number, decision: 'allowed' | 'denied' | 'superseded'): ProposalReview
  listPending(limit?: number): readonly {
    id: number
    proposer: string
    target: string
    change: string
    evidence: string
    status: string
    created_at: string
    reviewed_at: string | null
  }[]
  listAll(limit?: number): readonly {
    id: number
    proposer: string
    target: string
    change: string
    evidence: string
    status: string
    created_at: string
    reviewed_at: string | null
  }[]
  cleanup(): number
}

/**
 * Cordis 函数式插件主体。
 */
export function apply(ctx: Context): void {
  const home = dshHomeDir()
  const db = EvolveDb.open(home)

  // 启动时关库（cordis plugin unload 时释放句柄）。
  ctx.effect(() => () => { db.close() }, 'diechi-evolve: 释放监督者数据库')

  // 监督者：从 ctx 取。如果没挂监督者（不正常的部署），EvolutionService
  // 还是能构造，但 analyzeNegativeSamples 拉到空数据。
  const rawSupervisor = ctx.get('supervision') as (SupervisorWithEvents | SupervisorLike | undefined)
  if (rawSupervisor === undefined) {
    console.warn('[diechi-evolve] 未发现 ctx.supervision — analyzeNegativeSamples 不会产出提议。')
  }
  const supervisor: SupervisorWithEvents = (rawSupervisor as SupervisorWithEvents) ?? {
    listNegativeSamples: () => [],
    freezeRule: () => undefined,
    authorizeScope: () => undefined,
    onDecision: () => () => undefined,
  }
  const service = new EvolutionService(ctx, db, supervisor)

  // 把 ctx.evolution 提供给后续插件。
  ctx.provide('evolution', service as unknown as EvolutionServiceInterface)

  // P3.6 事件总线订阅：每次 supervisor 决策 → handleDecision 实时累计
  // 同一 (scope, reason) 累计达阈值 → 立即 analyze → 写 proposals（不再等启动）
  const unsubscribe = supervisor.onDecision((event) => {
    try {
      const ids = service.handleDecision(event)
      if (ids.length > 0) {
        console.log(`[diechi-evolve] 实时累计触发，写入 ${ids.length} 条提议（scope=${event.scope} reason=${event.reason}）`)
      }
    } catch (error) {
      console.error('[diechi-evolve] handleDecision 失败', error)
    }
  })

  // 启动时跑一次 analyzeNegativeSamples（轻量级 scan）。
  // 不阻塞：fire-and-forget，错误只记日志。
  if (rawSupervisor !== undefined) {
    try {
      const ids = service.analyzeNegativeSamples()
      if (ids.length > 0) {
        console.log(`[diechi-evolve] 启动时写入 ${ids.length} 条提议`)
      }
    } catch (error) {
      console.error('[diechi-evolve] 启动时 analyzeNegativeSamples 失败', error)
    }
  }

  // 卸载时取消订阅
  ctx.effect(() => () => { unsubscribe() }, 'diechi-evolve: 取消 supervision/decision 订阅')

  // P3.12：内置 timer 自动化清理 proposals——每 24 小时跑一次。
  // cleanup() 保留 pending + 最近 allowed/denied 各 250；P3.10 已实现。
  const cleanupIntervalSec = (() => {
    try {
      const settings = ctx.get('settings') as { get?: (p: string) => unknown } | undefined
      const v = settings?.get?.('evolution.cleanupIntervalSec')
      if (typeof v === 'number' && v > 0) return v
    } catch { /* ignore */ }
    return 86400
  })()
  const cleanupHandle = setInterval(() => {
    try {
      const removed = service.cleanup()
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[diechi-evolve] cleanup 删了 ${removed} 条 proposals`)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[diechi-evolve] cleanup 失败', error)
    }
  }, cleanupIntervalSec * 1000)
  if (typeof cleanupHandle.unref === 'function') cleanupHandle.unref()
  ctx.effect(() => () => clearInterval(cleanupHandle), 'diechi-evolve: 关闭 cleanup timer')
}
