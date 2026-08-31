/**
 * 外部服务进程控制 browser half：侧边栏底部的 Qwen3.8 / 视频模型 开关按钮
 * （`sidebar.footer.action`）。
 *
 * 依赖 diechi-process-control host 插件的 ProcessGateway RPC（remote.diechiProcess）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: locale 与插槽的服务面 + 槽位声明。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { en, zh, type ProcessControlLocaleKey } from './locales.ts'
import { ProcessController } from './ProcessController.ts'
import { ProcessControlBadge } from './ProcessControlBadge.tsx'
import type { ProcessRemote } from './types.ts'

export type { ProcessControlLocaleKey } from './locales.ts'
export type { ProcessControlBadgeProps } from './ProcessControlBadge.tsx'
export type {
  ProcessActionInput, ProcessActionResult, ProcessId, ProcessInfo, ProcessListResult, ProcessRunState,
} from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 服务开关 copy。 */
    'process-control': ProcessControlLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'process-control'

/** Services required by the badge. */
export const inject = ['slots', 'locale', 'remote', 'remote.diechiProcess']

/** 注册侧边栏服务开关按钮。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-process-control: dictionaries')

  ctx.inject(['slots', 'locale', 'remote', 'remote.diechiProcess'], (scope: ClientContext) => {
    const remote = scope.remote.diechiProcess as unknown as ProcessRemote
    const controller = new ProcessController(remote)
    // 自动刷新定时器是按钮私有的：插件卸载（热重载/取消勾选）时必须一起停掉。
    ctx.effect(() => () => { controller.dispose() }, 'ui-process-control: 停掉自动刷新定时器')

    // 侧边栏底部：两个服务开关按钮。
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'process-control',
      order: 40,
      locale: NS,
      inject: () => controller.inject(),
    }, ProcessControlBadge))
  })
}
