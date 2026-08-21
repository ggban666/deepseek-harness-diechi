/**
 * 阅历控制台浏览器半：设置「阅历控制台」页面的注册 + 收件箱控制器。
 * 依赖 diechi-brain host 插件的 BrainGateway RPC（remote.diechiBrain）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: locale 与 settings section 的服务面。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrainConsole } from './BrainConsole.tsx'
import { en, zh, type BrainConsoleLocaleKey } from './locales.ts'

export type { BrainConsoleProps } from './BrainConsole.tsx'
export type { BrainConsoleLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 阅历控制台 copy。 */
    'diechiBrain': BrainConsoleLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'diechiBrain'

/** Services required by the settings section and the Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.diechiBrain', 'settingsScope']

/** 注册设置里的「阅历控制台」页面。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-diechi-brain: dictionaries')

  const t = ctx.locale.bind(NS)
  ctx.inject(['slots', 'locale', 'remote', 'remote.diechiBrain', 'settingsScope'], (scope: ClientContext) => {
    const brainRemote = scope.remote.diechiBrain as unknown as BrainRemote
    const skillScope = scope.settingsScope.bind({ namespace: 'skill-store' })
    const controller = new BrainConsoleController(brainRemote, skillScope as BrainConsoleSkillScope)
    // 平权技能目录 / 文档可写状态变化（新增、改名、勾选、权限切换）时同步控制台。
    skillScope.subscribe(() => { controller.refreshSkills(); controller.refreshWritable() })

    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section',
      id: 'diechi-brain',
      order: 27,
      label: () => t('nav'),
      locale: NS,
      inject: (): BrainConsoleInjected => controller.inject(),
    }, BrainConsole))
  })
}
/** 阅历控制台控制器：收件箱 RPC + 平权技能目录快照。 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrainAssignResult, BrainInboxSnapshot, BrainPracticeItem } from './types.ts'

/** RPC 面（由 api-remotes 挂载的 remote.diechiBrain）。 */
export interface BrainRemote {
  list(): Promise<{ ok: true; value: BrainInboxSnapshot } | { ok: false; error: { code: string; message: string } }>
  ingest(input: { at: string; name: string; process: string; suggestName?: string }): Promise<{ ok: true; value: BrainInboxSnapshot } | { ok: false; error: { code: string; message: string } }>
  assign(input: { topic: string; skillId: string }): Promise<{ ok: true; value: BrainAssignResult } | { ok: false; error: { code: string; message: string } }>
  setTags(input: { topic: string; tags: string }): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
  removeItem(input: { topic: string }): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
}

/** 平权技能目录条目（设置作用域快照）。 */
export interface ConsoleSkillEntry {
  readonly id: string
  readonly title: string
  readonly enabled: boolean
}

/** 控制台读取的设置作用域最小面（目录 + 可写状态）。 */
export interface BrainConsoleSkillScope {
  getSnapshot(): {
    readonly status: 'loading' | 'ready' | 'unavailable'
    readonly writable: boolean
    readonly value?: { skills?: readonly ConsoleSkillEntry[] } | undefined
  }
  subscribe(fn: () => void): () => void
}

/** 目录作用域快照。 */
export interface BrainConsoleSkillState {
  readonly skills: readonly ConsoleSkillEntry[]
}

/** 注册侧业务面。 */
export interface BrainConsoleInjected {
  hooks: {
    /** 收件箱快照（刷新后更新）。 */
    inbox: HostObservable<readonly BrainPracticeItem[]>
    /** 平权技能目录快照（归位下拉用）。 */
    skills: HostObservable<BrainConsoleSkillState>
    /** 宿主文档是否可写（settings 作用域实时快照）。 */
    writable: HostObservable<boolean>
  }
  refresh(): Promise<void>
  assign(topic: string, skillId: string): Promise<boolean>
  setTags(topic: string, tags: string): Promise<boolean>
  remove(topic: string): Promise<boolean>
}

/** 控制器：把 RPC 与设置作用域变成控制台 UI 可用的快照 + 动作。 */
export class BrainConsoleController {
  private readonly inbox = createSnapshotStore<readonly BrainPracticeItem[]>([])
  private readonly skills = createSnapshotStore<BrainConsoleSkillState>({ skills: [] })
  private readonly writable = createSnapshotStore<boolean>(false)

  constructor(
    private readonly remote: BrainRemote,
    private readonly skillScope: BrainConsoleSkillScope,
  ) {
    this.refreshSkills()
    this.refreshWritable()
  }

  get hooks(): BrainConsoleInjected['hooks'] {
    return {
      inbox: this.inbox as HostObservable<readonly BrainPracticeItem[]>,
      skills: this.skills as HostObservable<BrainConsoleSkillState>,
      writable: this.writable as HostObservable<boolean>,
    }
  }

  /** 从 settings 作用域实时读取目录快照。 */
  refreshSkills(): void {
    const snapshot = this.skillScope.getSnapshot()
    this.skills.set({ skills: snapshot.value?.skills ?? [] })
  }

  /** 从 settings 作用域实时读取文档可写状态（scope 首次就绪前为只读）。 */
  refreshWritable(): void {
    const snapshot = this.skillScope.getSnapshot()
    this.writable.set(snapshot.status === 'ready' && snapshot.writable)
  }

  async refresh(): Promise<void> {
    const result = await this.remote.list()
    if (!result.ok) throw new Error(`diechiBrain.list failed: ${result.error.code}: ${result.error.message}`)
    this.inbox.set([...result.value.items])
  }

  async assign(topic: string, skillId: string): Promise<boolean> {
    if (skillId === '') return false
    const result = await this.remote.assign({ topic, skillId })
    if (!result.ok) return false
    await this.refresh()
    return result.value.ok
  }

  async setTags(topic: string, tags: string): Promise<boolean> {
    const result = await this.remote.setTags({ topic, tags })
    if (!result.ok) return false
    await this.refresh()
    return result.value
  }

  async remove(topic: string): Promise<boolean> {
    const result = await this.remote.removeItem({ topic })
    if (!result.ok) return false
    await this.refresh()
    return result.value
  }

  /** 注册侧业务面：钩子 + 动作 + 只读标记。 */
  inject(): BrainConsoleInjected {
    return {
      hooks: this.hooks,
      refresh: () => this.refresh(),
      assign: (topic, skillId) => this.assign(topic, skillId),
      setTags: (topic, tags) => this.setTags(topic, tags),
      remove: (topic) => this.remove(topic),
    }
  }
}
