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

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { dshHomeDir } from '@deepseek-ai/dsh-host-skill-store'
import { EvolveDb } from './db.ts'
import { EvolutionService, type SupervisorLike } from './service.ts'
import { FileSkillSink } from './sink.ts'
import { buildClusterSummary, runEngineAndPropose, isEngineReady } from './engine.ts'
import { listSkillIds, loadScopeMap, resolveScope, type ScopeMap, type ScopeResolver } from './scope-map.ts'
import type { ProposalReview } from './types.ts'

/** 监督者 Service 扩展（带 onDecision 订阅 API）。 */
type SupervisorWithEvents = SupervisorLike & {
  onDecision(observer: (e: { scope: string; decision: string; reason: string }) => void): () => void
}

// 重新导出供测试和其他包使用。
export { EvolveDb } from './db.ts'
export { EvolutionService, type SupervisorLike, type CapabilitySink, GOLDEN_SET_FLOOR } from './service.ts'
export { FileSkillSink } from './sink.ts'
export {
  validateProposals,
  buildEnginePrompt,
  generateDrafts,
  runEngineAndPropose,
  isEngineReady,
  buildClusterSummary,
  applyScopeResolution,
  type NegativeSampleLike,
  type ScopeResolver,
} from './engine.ts'
export { listSkillIds, loadScopeMap, resolveScope, type ScopeMap } from './scope-map.ts'
export type * from './types.ts'

/** Cordis 插件名。 */
export const name = 'diechi-evolve'

/**
 * 必需服务。
 *
 * `supervision` 必须声明：evolve 的职责就是消费监督者的负样本，
 * 不声明的话 cordis 不保证 provide 已完成，即便挂载顺序在 supervisor 之后，
 * apply 里 `ctx.get('supervision')` 仍可能拿到 undefined
 * （2026-08-29 端到端验证实测：漏声明时启动就报「未发现 ctx.supervision」）。
 */
export const inject = ['settings', 'supervision']

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

  // 注册 evolution 配置命名空间（dsh-settings 必须先 register 才能 get）。
  // schema 是普通函数 (merged) => resolved；框架会把它套在 settings.yaml 的 `evolution:` 段上。
  const settingsSvc = ctx.get('settings') as unknown as {
    get(ns: string): unknown
    register(ns: string, schema: (v?: Record<string, unknown>) => Record<string, unknown>): unknown
  }
  const evolutionSchema = (v: Record<string, unknown> = {}) => ({
    engineIntervalSec: typeof v.engineIntervalSec === 'number' && v.engineIntervalSec > 0 ? v.engineIntervalSec : 3600,
    cleanupIntervalSec: typeof v.cleanupIntervalSec === 'number' && v.cleanupIntervalSec > 0 ? v.cleanupIntervalSec : 86400,
    // 自动 apply 开关：off / safe-only / all（非法值回落 off）。
    autoApply: (v.autoApply === 'safe-only' || v.autoApply === 'all') ? v.autoApply : 'off',
    autoApplyIntervalSec: typeof v.autoApplyIntervalSec === 'number' && v.autoApplyIntervalSec > 0 ? v.autoApplyIntervalSec : 120,
  })
  if (settingsSvc.get('evolution') === undefined) {
    try { settingsSvc.register('evolution', evolutionSchema) } catch { /* 重复 mount 时忽略 */ }
  }
  // 构造 EvolutionService 前先解析自动 apply 模式，传给它。
  const rawEvo = (settingsSvc.get('evolution') as Record<string, unknown> | undefined) ?? {}
  const autoApplyMode: 'off' | 'safe-only' | 'all' =
    rawEvo.autoApply === 'safe-only' || rawEvo.autoApply === 'all' ? rawEvo.autoApply : 'off'
  const autoApplyIntervalSec =
    typeof rawEvo.autoApplyIntervalSec === 'number' && (rawEvo.autoApplyIntervalSec as number) > 0
      ? (rawEvo.autoApplyIntervalSec as number)
      : 120

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
  // M3：文件型固化库 sink——patch-skill / add-skill 提议 allowed 后真正落到
  // $DSH_HOME/skills/*.md（只改 md 永不改代码）。注入后「诚实降级」路径不再触发。
  const sink = new FileSkillSink(join(home, 'skills'))
  // M5：构建 scope → 真实技能 的确定性解析器，注入 EvolutionService，
  // 让所有提议路径（引擎 / analyzeSamples / analyzeNegativeSamples）落库前统一改写 target。
  const sm: ScopeMap = {
    skillIds: listSkillIds(join(home, 'skills')),
    explicit: loadScopeMap(home),
  }
  const scopeResolver: ScopeResolver = (scope) => resolveScope(scope, sm)
  const service = new EvolutionService(ctx, db, supervisor, 'diechi-evolve', sink, scopeResolver, autoApplyMode)

  // 把 ctx.evolution 提供给后续插件。
  ctx.provide('evolution', service as unknown as EvolutionServiceInterface)

  // P3.6 事件总线订阅：每次 supervisor 决策 → handleDecision 实时累计
  // 同一 (scope, reason) 累计达阈值 → 立即 analyze → 写 proposals（不再等启动）。
  // 同时触发 notifyFeedback()：决策=新样本（allow→正样本 / deny→负样本），
  // 防抖后重跑一次通过率分析，让闭环"一有反馈就学"，不必等周期定时器。
  const unsubscribe = supervisor.onDecision((event) => {
    try {
      const ids = service.handleDecision(event)
      if (ids.length > 0) {
        console.log(`[diechi-evolve] 实时累计触发，写入 ${ids.length} 条提议（scope=${event.scope} reason=${event.reason}）`)
      }
    } catch (error) {
      console.error('[diechi-evolve] handleDecision 失败', error)
    }
    try {
      service.notifyFeedback()
    } catch (error) {
      console.error('[diechi-evolve] notifyFeedback 失败', error)
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

  // P3.12：内置 timer 自动化清理 proposals——默认每 24 小时跑一次。
  // cleanup() 保留 pending + 最近 allowed/denied 各 250；P3.10 已实现。
  const cleanupIntervalSec = (settingsSvc.get('evolution') as { cleanupIntervalSec?: number } | undefined)?.cleanupIntervalSec ?? 86400
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

  // M4 + 目标函数重设计：进化闭环周期驱动，每轮跑三件事：
  // ① 引擎路径（失败驱动 patch-skill）：负样本聚类 → llama.cpp 引擎 → 提议。
  // ② 一次通过率路径（目标函数：最大化一次通过率）：读正/负样本算每 scope 一次通过率，
  //    好则固化、差则 patch-skill/add-prompt/re-route——让循环"往变强走"而非"只防错"。
  //    这是 redesign 的核心；两路都经 propose() 去重，不会刷重。
  // ③ 周期性 golden set 回归快照（C/K 时间序列），支撑"返工率是否随时间单调下降"判据。
  // 引擎不可用 / 无监督者 时静默跳过对应分支，绝不阻塞主流程。
  const engineIntervalSec = (settingsSvc.get('evolution') as { engineIntervalSec?: number } | undefined)?.engineIntervalSec ?? 3600
  const SNAPSHOT_COOLDOWN_MS = 60 * 60 * 1000 // 每小时一次回归快照，时间序列轻量
  let lastSnapshotAt = 0
  // 进化闭环「静默」：仅当负样本数量「新增」时才调引擎，避免 2 条陈旧负样本
  // 每轮刷提议、把 8081(本地 Qwen3.8) 常驻占满显存。初始 -1 让首轮先处理一次既有样本。
  let lastNegCount = -1
  // 抽取成可复用 tick：启动时立即跑一次（不空等一小时），之后按 interval 周期跑。
  const runEngineTick = async () => {
    try {
      // ① 引擎路径（失败驱动）：仅「新增负样本」才调引擎，否则静默跳过
      // （陈旧负样本每轮刷提议会常驻占满 8081 显存，且产出近重复噪音）。
      const samples = db.listNegativeSamplesDetailed(1000)
      const negCount = samples.length
      if (negCount > lastNegCount) {
        const summary = buildClusterSummary(samples)
        const ready = await isEngineReady()
        if (rawSupervisor !== undefined && summary && ready) {
          const n = await runEngineAndPropose(service, summary, 3, sm.skillIds)
          if (n > 0) {
            // eslint-disable-next-line no-console
            console.log(`[diechi-evolve] 引擎产出 ${n} 条提议（基于 ${samples.length} 条负样本聚类）`)
          }
        }
        lastNegCount = negCount
      }
      // ② 一次通过率路径（目标函数重设计：最大化一次通过率）
      try {
        const ids = service.analyzeSamples()
        if (ids.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`[diechi-evolve] analyzeSamples 产出 ${ids.length} 条（一次通过率驱动）`)
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[diechi-evolve] analyzeSamples 失败', e)
      }
      // ③ 周期性 golden set 回归快照（C/K 时间序列）
      const now = Date.now()
      if (now - lastSnapshotAt >= SNAPSHOT_COOLDOWN_MS && typeof supervisor.runGoldenSet === 'function') {
        try {
          const gs = supervisor.runGoldenSet()
          supervisor.recordSnapshot?.('CBS-v1', gs.c, gs.k ?? 0, gs.total)
          lastSnapshotAt = now
          // eslint-disable-next-line no-console
          console.log(`[diechi-evolve] golden set 快照 C=${gs.c.toFixed(2)} K=${gs.k ?? 0} (${gs.passed}/${gs.total})`)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[diechi-evolve] golden set 快照失败', e)
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[diechi-evolve] 引擎周期驱动失败', error)
    }
  }
  // 立即跑一次（首 tick 不延迟），再挂周期计时器。
  void runEngineTick()
  const engineHandle = setInterval(() => { void runEngineTick() }, engineIntervalSec * 1000)
  if (typeof engineHandle.unref === 'function') engineHandle.unref()
  ctx.effect(() => () => { clearInterval(engineHandle) }, 'diechi-evolve: 关闭进化引擎 timer')

  // 自动 apply 定时器：周期性把"安全类别"的 pending 提议自动 reviewProposal('allowed')，
  // 让三架构闭环从"会学"走到"会改自己"。红线类（add-rule 等）与 safe-only 下的算力调档/
  // 缓存清理永远留给人工终审——见 EvolutionService.autoApplyPending()。
  if (autoApplyMode !== 'off') {
    // eslint-disable-next-line no-console
    console.log(`[diechi-evolve] 自动 apply 已启用（模式=${autoApplyMode}，间隔=${autoApplyIntervalSec}s；红线类与算力调档始终留人工终审）`)
    const autoApplyHandle = setInterval(async () => {
      try {
        const n = await service.autoApplyPending()
        if (n > 0) {
          // eslint-disable-next-line no-console
          console.log(`[diechi-evolve] 自动 apply 了 ${n} 条提议（模式=${autoApplyMode}）`)
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[diechi-evolve] autoApply 定时任务失败', e)
      }
    }, autoApplyIntervalSec * 1000)
    if (typeof autoApplyHandle.unref === 'function') autoApplyHandle.unref()
    ctx.effect(() => () => { clearInterval(autoApplyHandle) }, 'diechi-evolve: 关闭 autoApply timer')
  }
}
