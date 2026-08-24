/**
 * 微信机器人桥接 host plugin（wxautox4 / 微信 4.x）。
 *
 * 架构：
 *   - settings namespace `wechat-bridge`：enabled / status / account / targetSessionId /
 *     contacts / groups / replyAll / logs —— 设置页读它做「连接确认」，写它做配置。
 *   - Python 桥接进程（src/bridge.py，wxautox4）：stdio JSON 行协议，监听微信消息、
 *     按命令发消息。
 *   - 消息链路：微信消息 → 策略过滤 → 注入「目标会话」的 agent（agents.create +
 *     followup + whenIdle，headless 同款模式）→ 回复写回该会话（网页可见）→ 发回微信。
 *   - 免重扫：微信客户端登录（自动登录）即持久化，桥接随宿主启动自动拉起。
 *
 * @module @deepseek-ai/dsh-host-wechat-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Type-only: pulls the ctx.settings and agent/agentDefaultModel Context merges.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** Stable Cordis plugin name. */
export const name = 'wechat-bridge'

/** Services required before the bridge can mount. */
export const inject = ['settings']

/** 一条处理日志（设置页「最近处理」列表）。 */
const bridgeLogSchema = z.object({
  at: z.string().required(),
  direction: z.string().required(), // in | out | info | error
  chat: z.string().default(''),
  sender: z.string().default(''),
  text: z.string().default(''),
})
interface BridgeLog {
  at: string
  direction: string
  chat?: string
  sender?: string
  text?: string
}

/** 微信桥接设置段。 */
const bridgeSchema = z.object({
  /** 桥接总开关。 */
  enabled: z.boolean().default(false),
  /** disconnected | connecting | connected | error（宿主回写）。 */
  status: z.string().default('disconnected'),
  /** 微信登录账号（宿主回写，wxautox4 暂不直接暴露则留空）。 */
  account: z.string().default(''),
  /** 最近错误信息（宿主回写）。 */
  error: z.string().default(''),
  /** 目标会话 id：微信消息注入的会话。 */
  targetSessionId: z.string().default(''),
  /** 目标会话标题（回显）。 */
  targetSessionTitle: z.string().default(''),
  /** 私聊联系人白名单；为空且 replyAll 时全部私聊处理。 */
  contacts: z.array(z.string()).default([]),
  /** 群聊名单（按聊天窗口名匹配）。 */
  groups: z.array(z.string()).default([]),
  /** 白名单为空时是否处理所有消息。 */
  replyAll: z.boolean().default(true),
  /** 最近处理日志（宿主回写，最多 50 条）。 */
  logs: z.array(bridgeLogSchema).default([]),
})
interface BridgeSettings {
  enabled: boolean
  status: string
  account: string
  error: string
  targetSessionId: string
  targetSessionTitle: string
  contacts: string[]
  groups: string[]
  replyAll: boolean
  logs: BridgeLog[]
}

/** 一条来自微信的文本消息。 */
interface WeChatIncoming {
  chat: string
  sender: string
  content: string
}

/** Agent 运行时最小面（headless 同款）。 */
interface BridgeAgent {
  session: Session
  whenIdle(): Promise<void>
  followup(message: ReturnType<typeof createUserMessage>): void
}

/** 汇总一次 turn 的最后一条 assistant 文本（headless 同款）。 */
function lastAssistantText(events: readonly SessionEvent[], firstSeq: number): string {
  let started = false
  let text = ''
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') { started = true; continue }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
  }
  return text
}

/**
 * Mount the bridge plugin body.
 * @param ctx - host context carrying settings + (optional) agents / agentDefaultModel / sessions.
 */
export function apply(ctx: Context): void {
  const scope = ctx.settings.register(settingsNamespace('wechat-bridge'), bridgeSchema)
  // 脚本固定在 src/bridge.py：开发（tsx 直接跑 src）与构建（lib）两种布局下
  // 都从包根的 src/ 解析，避免构建产物缺少 .py。
  const bridgeScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'bridge.py')

  let child: ChildProcessWithoutNullStreams | undefined
  let stopping = false
  let agent: BridgeAgent | undefined
  const queue: WeChatIncoming[] = []
  let draining = false

  /** 写一条处理日志（保留最近 50 条）。 */
  const pushLog = (entry: BridgeLog): void => {
    try {
      const current = scope.get()
      const normalized: BridgeLog = {
        at: entry.at,
        direction: entry.direction,
        chat: entry.chat ?? '',
        sender: entry.sender ?? '',
        text: entry.text ?? '',
      }
      void scope.update({ logs: [normalized, ...(current.logs ?? [])].slice(0, 50) })
    } catch {
      // 设置瞬时不可写：忽略，不影响消息链路。
    }
  }

  /** 向微信发送一条消息（经 Python 桥接进程）。 */
  const sendToWeChat = (who: string, text: string): void => {
    if (child === undefined || text.trim() === '') return
    child.stdin.write(`${JSON.stringify({ cmd: 'send', who, text: text.slice(0, 3000) })}\n`)
  }

  /** 策略过滤：群消息只在名单（或 replyAll 全收）内处理；私聊同理。 */
  const shouldReply = (msg: WeChatIncoming, cfg: BridgeSettings): boolean => {
    if (cfg.replyAll === true) return true
    const name = msg.chat.trim()
    if (name === '') return true // 无法判定的兜底处理
    if (msg.sender !== '' && cfg.contacts.includes(msg.sender)) return true
    return cfg.groups.includes(name)
  }

  /** 把一条微信消息注入目标会话，跑一轮，返回 assistant 回复（空串=无回复）。 */
  const runTurn = async (msg: WeChatIncoming): Promise<string> => {
    const cfg = scope.get()
    if (cfg.targetSessionId === '') return ''
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) {
      throw new Error('agents / agentDefaultModel 服务不可用')
    }
    if (agent === undefined) {
      const selection = defaultModel.currentSelection()
      const created = await agents.create({
        sessionId: SessionId(cfg.targetSessionId),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: (agentCtx) => {
          const selected: ModelSelectionRef = { current: selection, assembled: undefined }
          installModelSelection(agentCtx, selected)
        },
      })
      agent = created.agent as BridgeAgent
      await agent.whenIdle()
    }
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `【微信】${msg.sender}（${msg.chat}）：${msg.content}` }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    const reply = lastAssistantText(agent.session.events, firstSeq)
    await ctx.get('sessions')?.flush(agent.session)
    return reply
  }

  /** 串行处理消息队列：一次只跑一轮，避免同一会话并发 turn。 */
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0) {
        const msg = queue.shift()!
        const cfg = scope.get()
        if (!shouldReply(msg, cfg)) {
          pushLog({ at: new Date().toISOString(), direction: 'info', chat: msg.chat, sender: msg.sender, text: '策略过滤跳过' })
          continue
        }
        try {
          pushLog({ at: new Date().toISOString(), direction: 'in', chat: msg.chat, sender: msg.sender, text: msg.content.slice(0, 120) })
          const reply = await runTurn(msg)
          if (reply.trim() !== '') {
            sendToWeChat(msg.chat, reply)
            pushLog({ at: new Date().toISOString(), direction: 'out', chat: msg.chat, text: reply.slice(0, 120) })
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          pushLog({ at: new Date().toISOString(), direction: 'error', chat: msg.chat, sender: msg.sender, text: text.slice(0, 200) })
          sendToWeChat(msg.chat, `（处理失败，请查看设置页日志：${text.slice(0, 80)}）`)
        }
      }
    } finally {
      draining = false
    }
  }

  /** 处理桥接进程 stdout 的一行 JSON 事件。 */
  const handleLine = (event: Record<string, unknown>): void => {
    if (event.type === 'status') {
      const status = typeof event.status === 'string' ? event.status : 'error'
      const error = typeof event.error === 'string' ? event.error : ''
      void scope.update({ status, error })
      if (status === 'connected') {
        const account = typeof event.account === 'string' ? event.account : ''
        void scope.update({ account })
      }
      return
    }
    if (event.type === 'message') {
      const chat = typeof event.chat === 'string' ? event.chat : ''
      const sender = typeof event.sender === 'string' ? event.sender : ''
      const content = typeof event.content === 'string' ? event.content : ''
      if (chat !== '' && content !== '') {
        queue.push({ chat, sender, content })
        void drain()
      }
      return
    }
    if (event.type === 'error') {
      pushLog({ at: new Date().toISOString(), direction: 'error', text: (typeof event.text === 'string' ? event.text : '未知错误').slice(0, 200) })
    }
  }

  /** 启动 Python 桥接进程。 */
  const start = async (): Promise<void> => {
    if (child !== undefined) return
    const cfg = scope.get()
    if (cfg.targetSessionId === '') {
      await scope.update({ status: 'error', error: '请先在设置中选择目标会话' })
      return
    }
    await scope.update({ status: 'connecting', error: '' })
    try {
      const proc = spawn('python', [bridgeScript], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      child = proc
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        try {
          handleLine(JSON.parse(line) as Record<string, unknown>)
        } catch {
          // 忽略坏行。
        }
      })
      proc.stderr.on('data', (data: Buffer) => {
        pushLog({ at: new Date().toISOString(), direction: 'error', text: `python: ${String(data).slice(0, 200)}` })
      })
      proc.on('error', (error) => {
        child = undefined
        if (!stopping) void scope.update({ status: 'error', error: `无法启动 python 桥接：${error.message}` })
      })
      proc.on('exit', (code) => {
        child = undefined
        if (!stopping) void scope.update({ status: 'disconnected', error: `桥接进程退出（code=${code ?? 'unknown'}）` })
      })
    } catch (error) {
      child = undefined
      await scope.update({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 停止桥接进程。 */
  const stop = async (): Promise<void> => {
    stopping = true
    if (child !== undefined) {
      try { child.kill() } catch { /* 已退出 */ }
      child = undefined
    }
    await scope.update({ status: 'disconnected', error: '' })
    stopping = false
  }

  // 监听设置变化：开关切换即启停。
  const unwatch = scope.watch((next) => {
    if (next.enabled === true && child === undefined) void start()
    if (next.enabled !== true && child !== undefined) void stop()
  })
  // 初始状态：已启用则直接拉起。
  if (scope.get().enabled === true) void start()

  // 生命周期：插件卸载时停止进程、释放监听。
  ctx.effect(() => {
    unwatch()
    if (child !== undefined) {
      try { child.kill() } catch { /* 已退出 */ }
      child = undefined
    }
    return () => {}
  }, 'wechat-bridge: 释放桥接')
}

/** 兼容 import.meta.url 的 dirname。 */
function dirname(url: string): string {
  const path = fileURLToPath(url)
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
}
