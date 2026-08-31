/**
 * diechi-supervisor 暴露给 model / client 的工具。
 *
 * 6 个 tool：
 * 1. supervisor_list_negative_samples — 只读，列出最近负样本
 * 2. supervisor_freeze_rule — 写（caller 必须是 human）
 * 3. supervisor_authorize_scope — 写（caller 必须是 human）
 * 4. supervisor_revoke_authorization — 写（caller 必须是 human）
 * 5. supervisor_review_proposal — 写（P2 阶段 proposals 接入后启用）
 * 6. supervisor_signal_update_ready — 写（caller 必须是 human）
 *    向独立 watchdog 进程写升级信号，由后者执行「杀 → 换补丁 → 拉起」。
 * 7. supervisor_record_signal — 写（M3）
 *    记录用户价值信号，user-undo / explicit-bad 同时写 reason=user-rework 负样本。
 *
 * @module @deepseek-ai/dsh-host-diechi-supervisor/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { SupervisorService } from './service.ts'
import type { PositiveSignal } from './types.ts'

/** 一条负样本 RPC 载荷（与 db 行的精简版）。 */
export interface NegativeSampleRpc {
  id: number
  scope: string
  payload: string
  decision: string
  reason: string
  source: string
  createdAt: string
}

/** 通用 OK / error 形状。 */
export interface OkError {
  ok: boolean
  error?: string
}

/** 注册 5 个 supervisor 工具到 ctx.tools。 */
export function registerSupervisorTools(ctx: Context, service: SupervisorService): () => void {
  const disposers: Array<() => void> = []

  // ---- 1. 列出负样本 ----

  const listTool = defineTool({
    name: 'supervisor_list_negative_samples',
    description: '列出最近 N 条监督者负样本（deny / flag-review 决策的历史记录）。',
    parameters: {
      limit: { type: 'number', description: '条数上限，1-500，默认 50' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          samples: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'number', required: true },
                scope: { type: 'string', required: true },
                payload: { type: 'string', required: true },
                decision: { type: 'string', required: true },
                reason: { type: 'string', required: true },
                source: { type: 'string', required: true },
                createdAt: { type: 'string', required: true },
              },
            },
            required: true,
          },
          count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as { count: number; samples: readonly NegativeSampleRpc[] }
        return [{ type: 'text', text: `负样本 ${v.count} 条` }]
      },
    },
    async execute(args) {
      const limit = Math.max(1, Math.min(500, Math.trunc((args.limit as number) || 50) || 50))
      const samples = service.listNegativeSamples(limit) as unknown as NegativeSampleRpc[]
      return { samples, count: samples.length }
    },
    presentCall() {
      return { card: 'terminal', title: 'List negative samples', kind: 'read', rawInput: 'list_negative_samples' }
    },
  })
  disposers.push(ctx.tools.register(listTool))

  // ---- 2. 冻结规则 ----

  const freezeTool = defineTool({
    name: 'supervisor_freeze_rule',
    description: '冻结一条监督者规则。命中后所有对应 scope 的写入会被 deny。'
      + 'caller 必须是 human；其他调用方直接抛错。',
    parameters: {
      id: { type: 'string', required: true, description: '点号路径，如 "person-brain:learn.policy.pii-redaction"' },
      reason: { type: 'string', required: true, description: '为什么冻结' },
      callerToken: { type: 'string', required: true, description: '人类签名 token（当前 MVP 写 "human" 即可）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as OkError
        return [{
          type: 'text',
          text: v.ok ? '规则已冻结' : `冻结失败：${v.error ?? 'unknown'}`,
        }]
      },
    },
    async execute(args) {
      const caller = String(args.callerToken ?? '')
      if (caller !== 'human') {
        return { ok: false, error: 'callerToken 必须为 "human"' }
      }
      const id = String(args.id ?? '').trim()
      const reason = String(args.reason ?? '').trim()
      if (id === '' || reason === '') {
        return { ok: false, error: 'id 和 reason 不能为空' }
      }
      service.freezeRule(id, reason, 'human')
      return { ok: true }
    },
    presentCall(args) {
      // card: 'generic'——DSH 的 DiffCallView 要求 diffs 字段；我们没有 diff 概念
      // （改的是基座规则，不是文件）——所以走 generic edit 卡片，UI 友好。
      return { card: 'generic', title: `Freeze rule ${String(args.id)}`, kind: 'edit', rawInput: String(args.id) }
    },
  })
  disposers.push(ctx.tools.register(freezeTool))

  // ---- 3. 授权 scope ----

  const authTool = defineTool({
    name: 'supervisor_authorize_scope',
    description: '授权一个 scope，让对应业务写入能通过监督者。'
      + 'caller 必须是 human。',
    parameters: {
      scope: { type: 'string', required: true, description: 'scope 路径，如 "person-brain:learn"' },
      callerToken: { type: 'string', required: true, description: '人类签名 token' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as OkError
        return [{
          type: 'text',
          text: v.ok ? '已授权' : `授权失败：${v.error ?? 'unknown'}`,
        }]
      },
    },
    async execute(args) {
      const caller = String(args.callerToken ?? '')
      if (caller !== 'human') {
        return { ok: false, error: 'callerToken 必须为 "human"' }
      }
      const scope = String(args.scope ?? '').trim()
      if (scope === '') return { ok: false, error: 'scope 不能为空' }
      service.authorizeScope(scope, 'human')
      return { ok: true }
    },
    presentCall(args) {
      return { card: 'generic', title: `Authorize ${String(args.scope)}`, kind: 'edit', rawInput: String(args.scope) }
    },
  })
  disposers.push(ctx.tools.register(authTool))

  // ---- 4. 撤销授权 ----

  const revokeTool = defineTool({
    name: 'supervisor_revoke_authorization',
    description: '撤销一个 scope 的授权。撤销后新写入降级为 flag-review。caller 必须是 human。',
    parameters: {
      scope: { type: 'string', required: true },
      callerToken: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as OkError
        return [{
          type: 'text',
          text: v.ok ? '已撤销授权' : `撤销失败：${v.error ?? 'unknown'}`,
        }]
      },
    },
    async execute(args) {
      const caller = String(args.callerToken ?? '')
      if (caller !== 'human') {
        return { ok: false, error: 'callerToken 必须为 "human"' }
      }
      const scope = String(args.scope ?? '').trim()
      if (scope === '') return { ok: false, error: 'scope 不能为空' }
      const ok = service.revokeAuthorization(scope)
      return ok ? { ok: true } : { ok: false, error: '授权不存在或已撤销' }
    },
    presentCall(args) {
      return { card: 'generic', title: `Revoke ${String(args.scope)}`, kind: 'edit', rawInput: String(args.scope) }
    },
  })
  disposers.push(ctx.tools.register(revokeTool))

  // ---- 5. 审阅提议 ----

  const reviewTool = defineTool({
    name: 'supervisor_review_proposal',
    description: '审阅一条升级设计者提议（P2 阶段启用）。当前 P1 阶段：仅 stub，返回 ok=false。'
      + 'caller 必须是 human。',
    parameters: {
      proposalId: { type: 'number', required: true },
      decision: { type: 'string', required: true, description: '"allowed" 或 "denied"' },
      callerToken: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as OkError
        return [{ type: 'text', text: v.ok ? '已记录审阅' : `审阅失败：${v.error ?? 'unknown'}` }]
      },
    },
    async execute(args) {
      const caller = String(args.callerToken ?? '')
      if (caller !== 'human') {
        return { ok: false, error: 'callerToken 必须为 "human"' }
      }
      // P1 阶段：proposals 表已建但 P2 升级设计者未实现，审阅逻辑暂不接入。
      return { ok: false, error: 'proposal review 暂未启用（P2 阶段）' }
    },
    presentCall(args) {
      return { card: 'terminal', title: `Review proposal ${String(args.proposalId)}`, kind: 'edit', rawInput: String(args.proposalId) }
    },
  })
  disposers.push(ctx.tools.register(reviewTool))

  // ---- 6. 写升级信号（给独立 watchdog 进程消费）----

  const signalTool = defineTool({
    name: 'supervisor_signal_update_ready',
    description: '向 watchdog 写升级信号，通知它杀掉当前 DSH、替换补丁、拉起新版本。'
      + 'DSH 不能升级自己 —— 补丁文件正被自己锁着，必须先被进程外的 watchdog 杀掉，'
      + '文件锁释放后才能换。所以监督者只写信号，不执行重启。caller 必须是 human。',
    parameters: {
      version: { type: 'string', required: true, description: '目标版本号' },
      reason: { type: 'string', required: true, description: '升级原因，进审计记录' },
      patchPath: { type: 'string', description: '补丁目录；不给则只重启、不换文件' },
      callerToken: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          signalPath: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as OkError & { signalPath?: string }
        return [{
          type: 'text',
          text: v.ok ? `升级信号已写入 ${v.signalPath ?? ''}` : `写信号失败：${v.error ?? 'unknown'}`,
        }]
      },
    },
    async execute(args) {
      const caller = String(args.callerToken ?? '')
      if (caller !== 'human') return { ok: false, error: 'callerToken 必须为 "human"' }

      const version = String(args.version ?? '').trim()
      if (version === '') return { ok: false, error: 'version 不能为空' }
      const reason = String(args.reason ?? '').trim()
      if (reason === '') return { ok: false, error: 'reason 不能为空' }
      const patchPath = String(args.patchPath ?? '').trim()

      // 信号写到 $DSH_HOME —— watchdog 独立进程也认这个环境变量，两边才对得上。
      const dshHome = process.env.DSH_HOME ?? ''
      if (dshHome === '') {
        return { ok: false, error: 'DSH_HOME 未设置，不知道信号该写到哪' }
      }

      const signal = {
        version,
        action: 'restart' as const,
        requestedBy: 'diechi-supervisor',
        requestedAt: new Date().toISOString(),
        reason,
        ...(patchPath === '' ? {} : { patchPath }),
      }

      // 路径约定与 diechi-process-watchdog 包一致：$DSH_HOME/.watchdog/update.signal。
      // 这里刻意**不** import 那个包 —— supervisor 在它之前 mount，
      // 反向依赖会把 mount 顺序的硬约束变成循环依赖。两边各自实现，
      // 靠这条注释 + 同名路径保持契约。
      const file = join(dshHome, '.watchdog', 'update.signal')
      try {
        await mkdir(join(dshHome, '.watchdog'), { recursive: true })
        // 先写 tmp 再 rename：避免 watchdog 正好读到写了一半的 JSON。
        const tmp = `${file}.tmp`
        await writeFile(tmp, `${JSON.stringify(signal, null, 2)}\n`, 'utf8')
        await rename(tmp, file)
        return { ok: true, signalPath: file }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    presentCall(args) {
      return {
        card: 'terminal',
        title: `Signal update ${String(args.version)}`,
        kind: 'edit',
        rawInput: String(args.version),
      }
    },
  })
  disposers.push(ctx.tools.register(signalTool))

  // ---- 7. M3：记录用户价值信号（对话路径负样本写入点）----

  const recordSignalTool = defineTool({
    name: 'supervisor_record_signal',
    description: '记录一条用户价值信号（采纳 accepted / 无返工 no-rework / 用户撤销 user-undo / 明确差评 explicit-bad）。'
      + '这是 C(t) 一次通过率的分母来源；user-undo / explicit-bad 会同时写一条 reason=user-rework 的负样本，'
      + '供升级设计者聚类出 patch-skill 提议。埋点绝不影响主决策（A3）。',
    parameters: {
      scope: { type: 'string', required: true, description: '信号发生的 scope（如任务/技能名）' },
      signal: { type: 'string', required: true, description: 'accepted | no-rework | user-undo | explicit-bad' },
      payload: { type: 'string', description: '可选补充信息（原问题摘要等）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          positiveId: { type: 'number' },
          negativeId: { type: 'number' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value
        return [{
          type: 'text',
          text: v.ok
            ? `信号已记录（positive #${v.positiveId ?? '-'}${v.negativeId !== undefined ? `，负样本 #${v.negativeId}` : ''}）`
            : `记录失败：${v.error ?? 'unknown'}`,
        }]
      },
    },
    // 同步实现但签名要求返回 Promise：这里没有 await 可写，async 只为满足工具契约。
    // eslint-disable-next-line typescript/require-await
    async execute(args) {
      const scope = args.scope.trim()
      if (scope === '') return { ok: false, error: 'scope 不能为空' }
      const signal = args.signal.trim()
      const allowed: readonly PositiveSignal[] = ['accepted', 'no-rework', 'user-undo', 'explicit-bad']
      if (!allowed.includes(signal as PositiveSignal)) {
        return { ok: false, error: `signal 必须是 ${allowed.join(' / ')}` }
      }
      try {
        const r = service.recordUserSignal(scope, signal as PositiveSignal, {
          payload: args.payload ?? '',
          source: 'tool',
        })
        return r.negativeId !== null
          ? { ok: true, positiveId: r.positiveId, negativeId: r.negativeId }
          : { ok: true, positiveId: r.positiveId }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    presentCall(args) {
      return {
        card: 'terminal',
        title: `Record signal ${args.signal}`,
        kind: 'edit',
        rawInput: args.scope,
      }
    },
  })
  disposers.push(ctx.tools.register(recordSignalTool))

  // 全部 disposers 一次性释放。
  return () => {
    for (const d of disposers) d()
  }
}
