/**
 * 微信机器人设置 browser half: one `settings.section` page (左下设置 →
 * 微信机器人)。状态（连接状态/账号/错误/日志）由宿主回写到 `wechat-bridge`
 * settings namespace，本 half 订阅渲染；用户的连接/会话/策略配置写回同段。
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings scope service (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { WeChatBridgeSection, type BridgeLogEntry, type BridgeState, type WeChatBridgeInjected } from './WeChatBridgeSection.tsx'
import { en, zh } from './locales.ts'

export type { BridgeLogEntry, BridgeState, WeChatBridgeInjected } from './WeChatBridgeSection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'wechat-bridge'

/** Required services: the slot registry, the section copy, and the settings scope. */
export const inject = ['slots', 'locale', 'settingsScope']

/** 宿主回写/持久化的设置段形状（与 host 插件 schema 对齐）。 */
interface BridgeSettings {
  enabled?: boolean
  status?: string
  account?: string
  error?: string
  targetSessionId?: string
  targetSessionTitle?: string
  contacts?: string[]
  groups?: string[]
  replyAll?: boolean
  logs?: BridgeLogEntry[]
}

/** 空状态兜底。 */
const IDLE_BRIDGE: BridgeState = {
  enabled: false,
  status: 'disconnected',
  account: '',
  error: '',
  targetSessionId: '',
  targetSessionTitle: '',
  contacts: [],
  groups: [],
  replyAll: true,
  logs: [],
  writable: false,
}

/** 桥接控制器：镜像 wechat-bridge 段到快照，把用户操作写回设置。 */
class WeChatBridgeController {
  private readonly store: SnapshotStore<BridgeState>

  constructor(
    private readonly scope: SettingsScope<BridgeSettings>,
    private readonly sessions: {
      list: { getSnapshot(): { current?: string } }
      create(opts?: unknown): Promise<string>
    },
  ) {
    this.store = createSnapshotStore<BridgeState>(IDLE_BRIDGE)
    this.refresh()
    this.scope.subscribe(() => this.refresh())
  }

  private refresh(): void {
    const snapshot = this.scope.getSnapshot()
    const value = snapshot.value
    this.store.set({
      enabled: value?.enabled === true,
      status: value?.status ?? 'disconnected',
      account: value?.account ?? '',
      error: value?.error ?? '',
      targetSessionId: value?.targetSessionId ?? '',
      targetSessionTitle: value?.targetSessionTitle ?? '',
      contacts: value?.contacts ?? [],
      groups: value?.groups ?? [],
      replyAll: value?.replyAll ?? true,
      logs: value?.logs ?? [],
      writable: snapshot.status === 'ready' && snapshot.writable,
    })
  }

  async setEnabled(value: boolean): Promise<void> {
    await this.scope.set('enabled', value)
  }

  async setTargetSession(id: string, title: string): Promise<void> {
    await this.scope.set('targetSessionId', id.trim())
    await this.scope.set('targetSessionTitle', title.trim())
  }

  async setContacts(list: string[]): Promise<void> {
    await this.scope.set('contacts', list)
  }

  async setGroups(list: string[]): Promise<void> {
    await this.scope.set('groups', list)
  }

  async setReplyAll(value: boolean): Promise<void> {
    await this.scope.set('replyAll', value)
  }

  async clearLogs(): Promise<void> {
    await this.scope.set('logs', [])
  }

  /** 把当前打开的会话设为目标会话。 */
  async useCurrentSession(): Promise<void> {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined) return
    await this.setTargetSession(current, '当前会话')
  }

  /** 新建一个专用会话「微信助手」并设为目标。 */
  async createDedicatedSession(): Promise<void> {
    try {
      const id = await this.sessions.create()
      if (id !== undefined && id !== '') {
        await this.setTargetSession(id, '微信助手')
      }
    } catch (error) {
      console.error('[ui-wechat-bridge] create session failed', error)
    }
  }

  /** 设置页可写面。 */
  inject(): WeChatBridgeInjected {
    return {
      hooks: {
        bridge: this.store as HostObservable<BridgeState>,
      },
      setEnabled: (value) => this.setEnabled(value),
      setTargetSession: (id, title) => this.setTargetSession(id, title),
      setContacts: (list) => this.setContacts(list),
      setGroups: (list) => this.setGroups(list),
      setReplyAll: (value) => this.setReplyAll(value),
      clearLogs: () => this.clearLogs(),
      useCurrentSession: () => this.useCurrentSession(),
      createDedicatedSession: () => this.createDedicatedSession(),
    }
  }
}

/**
 * Client plugin body: register dictionaries and the 微信机器人 settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-wechat-bridge: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.inject(['slots', 'locale', 'settingsScope', 'sessions'], (scope: ClientContext) => {
    const sessions = scope.sessions as unknown as {
      list: { getSnapshot(): { current?: string } }
      create(opts?: unknown): Promise<string>
    }
    const controller = new WeChatBridgeController(scope.settingsScope.bind({ namespace: 'wechat-bridge' }), sessions)

    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section',
      id: 'wechat-bridge',
      order: 23,
      label: () => t('nav'),
      locale: NS,
      inject: () => controller.inject(),
    }, WeChatBridgeSection))
  })
}
