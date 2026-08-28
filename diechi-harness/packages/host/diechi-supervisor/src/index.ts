/**
 * diechi-supervisor host 插件：cordis 函数式插件。
 *
 * 职责：
 * - 启动时在 $DSH_HOME 创建监督者数据库（4 张表）；
 * - 读取 settings.supervisor.bootstrap 配置预置 frozen_rules / authorizations；
 * - 把 ctx.supervision 提供给 PersonBrain（diechi-supervisor 必须先于
 *   dsh-host-skill-store 之前 mount，且 PersonBrain 必须在 supervisor
 *   提供 ctx.supervision 之后才能 open 业务表——这一约束由 host 顺序保证）。
 *
 * mount 顺序要求：dsh-host-diechi-supervisor 必须在 dsh-host-skill-store
 * 之前被 mount；否则 skill-store 启动时 PersonBrain 会拿不到 ctx.supervision。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { dshHomeDir } from '@deepseek-ai/dsh-host-skill-store'
import type { SupervisionContext } from '@deepseek-ai/dsh-host-skill-store'
import type { AgentRoleService } from '@deepseek-ai/dsh-host-skill-store'
import { SupervisorDb } from './db.ts'
import { SupervisorService } from './service.ts'
import { registerSupervisorTools } from './tools.ts'
import { AgentRoleServiceImpl } from './role.ts'
import { HeuristicWorldModel } from './world-model.ts'
import type { SupervisorBootstrapConfig } from './types.ts'

// 重新导出供其他 host 包（比如 diechi-evolve）使用。
export { SupervisorDb } from './db.ts'
export { SupervisorService } from './service.ts'
export type { SupervisorLike } from './service.ts'
export { AgentRoleServiceImpl, RoleAlreadySwappedError } from './role.ts'
export { HeuristicWorldModel } from './world-model.ts'

/** Cordis 插件名。 */
export const name = 'diechi-supervisor'

/** 必需服务。 */
export const inject = ['settings', 'tools']

/** bootstrap 默认值：P0 阶段只预置最少的授权，保证冷启动可用。 */
const DEFAULT_BOOTSTRAP: SupervisorBootstrapConfig = {
  freeze: [
    { id: 'person-brain:learn.policy.pii-redaction', reason: '基座规则：所有 learn() 必须经过 PII 扫描' },
    { id: 'person-brain:remember.policy.pii-redaction', reason: '基座规则：所有 remember() 必须经过 PII 扫描' },
  ],
  authorize: [
    { scope: 'person-brain:remember', reason: '用户直述记忆默认授权' },
    { scope: 'person-brain:learn', reason: '知识沉淀默认授权' },
    { scope: 'diechi-brain:ingest-conversation', reason: '对话归纳默认授权' },
    // 蝶擎感知层：视频流 / 视觉场景写入授权。
    // 实际授权受 `skill-vision.enabled` 控制——P3.5 简化：默认授权；
    // 视觉流关掉时业务调用方应不再调 seeScene / ingestScene，监督者闸拦截不到的场景属于业务侧责任。
    { scope: 'person-brain:see-scene', reason: '蝶擎感知层：视频流 VQA 描述默认授权（受视觉开关控制）' },
    { scope: 'diechi-brain:ingest-scene', reason: '蝶擎感知层：视频流 ingestScene RPC 默认授权' },
    // P3.7 世界模型：被升级者用世界模型做物理推演——P3 阶段默认授权（基座只是闸，不拒绝推演本身）。
    { scope: 'person-brain:predict', reason: '世界模型：被升级者调用预测（默认授权；精度差会让业务方自然降级使用，监督者只在 frozen 阻断）' },
  ],
}

/**
 * Cordis 函数式插件主体。
 */
export function apply(ctx: Context): void {
  const home = dshHomeDir()
  const db = SupervisorDb.open(home)
  // P3 阶段：构造 AgentRoleService 注入到 SupervisorService。
  // 三条护栏在 role.ts + service.ts.decide() 里实现。
  const agentRole = new AgentRoleServiceImpl(ctx, db)
  const service = new SupervisorService(ctx, db, agentRole)

  // 启动时关库（cordis plugin unload 时释放句柄）。
  ctx.effect(() => () => { db.close() }, 'diechi-supervisor: 释放监督者数据库')

  // 读取 bootstrap 配置并预置。
  const bootstrap = readBootstrap(ctx) ?? DEFAULT_BOOTSTRAP
  for (const rule of bootstrap.freeze ?? []) {
    db.insertFrozenRule(rule.id, rule.reason, 'supervisor-bootstrap')
  }
  for (const auth of bootstrap.authorize ?? []) {
    db.insertAuthorization(auth.scope, 'supervisor-bootstrap')
  }

  // 把 ctx.supervision 与 ctx.agentRole 提供给后续插件。
  ctx.provide('supervision', service as unknown as SupervisionContext)
  ctx.provide('agentRole', agentRole as unknown as AgentRoleService)

  // P3.7：注入世界模型（HeuristicWorldModel 占位）+ 提供 ctx.worldModel
  // 业务侧可自己实现 WorldModelService 接口并通过 setWorldModel 替换——本插件只提供默认。
  const worldModel = new HeuristicWorldModel()
  ctx.provide('worldModel', worldModel as unknown as { predict: (input: unknown) => Promise<unknown> })
  // 接管 attachBrain：之后每次 attachBrain 自动注入 worldModel。
  // （PersonBrain 没原生 attachWorldModel 路径——但 setWorldModelContext 已存在，
  //  通过 service 代理——见 SupervisorService.attachBrain 的扩展。）
  service.bindWorldModel(worldModel)

  // P1 阶段：注册 5 个 model-facing 工具到 ctx.tools。
  const unregisterTools = registerSupervisorTools(ctx, service)

  // 2.3 接入 PersonBrain + agentRole 清理
  ctx.effect(() => {
    return () => {
      service.detachAll()
      unregisterTools()
      // plugin unload：active transition 主动 revert
      void agentRole.revert()
    }
  }, 'diechi-supervisor: 清理已挂载 brains + 工具 + active role')

  // P3.12：内置 timer 自动化清理——每 24 小时跑一次 cleanupNegativeSamples(5000)。
  // 24h 是 P3.12 默认——DSH 跑 1+ 周后负样本会增长到几万行；24h 频率 + 5000 保留足以保持查询性能。
  // 配置读 settings（可选）：supervisor.cleanupIntervalSec 默认 86400。
  const cleanupIntervalSec = (() => {
    try {
      const settings = ctx.get('settings') as { get?: (p: string) => unknown } | undefined
      const v = settings?.get?.('supervisor.cleanupIntervalSec')
      if (typeof v === 'number' && v > 0) return v
    } catch { /* ignore */ }
    return 86400
  })()
  const cleanupHandle = setInterval(() => {
    try {
      const removed = service.cleanupNegativeSamples(5000)
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[diechi-supervisor] cleanupNegativeSamples 删了 ${removed} 条`)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[diechi-supervisor] cleanupNegativeSamples 失败', error)
    }
  }, cleanupIntervalSec * 1000)
  // 不阻塞进程退出
  if (typeof cleanupHandle.unref === 'function') cleanupHandle.unref()

  ctx.effect(() => {
    return () => clearInterval(cleanupHandle)
  }, 'diechi-supervisor: 关闭 cleanup timer')
}

/** 读 settings 上的 bootstrap 配置（可选）。 */
function readBootstrap(ctx: Context): SupervisorBootstrapConfig | undefined {
  const settings = ctx.get('settings') as
    | { get(path: string): unknown }
    | undefined
  if (settings === undefined) return undefined
  const value = settings.get('supervisor.bootstrap')
  if (typeof value !== 'object' || value === null) return undefined
  return value as SupervisorBootstrapConfig
}
