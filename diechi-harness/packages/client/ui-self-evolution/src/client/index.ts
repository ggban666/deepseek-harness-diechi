/**
 * 自进化可感知层 browser half：侧边栏底部的实时指标按钮（`sidebar.footer.action`）
 * + 全屏自进化面板（`shell.overlay`）。两个注册点共享同一个控制器实例，
 * 所以按钮上的数字与面板里的曲线永远来自同一次抓取。
 *
 * 依赖 diechi-supervisor host 插件的 EvolutionGateway RPC（remote.diechiEvolution）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: locale 与插槽的服务面 + 两个槽位的 SlotMap 声明。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { en, zh, type EvolutionLocaleKey } from './locales.ts'
import { EvolutionController } from './EvolutionController.ts'
import { EvolutionBadge } from './EvolutionBadge.tsx'
import { EvolutionPanel } from './EvolutionPanel.tsx'
import type { EvolutionRemote } from './types.ts'

export type { EvolutionLocaleKey } from './locales.ts'
export type { EvolutionBadgeProps } from './EvolutionBadge.tsx'
export type { EvolutionPanelProps } from './EvolutionPanel.tsx'
export type {
  EvolutionCbsOutcome, EvolutionCbsView, EvolutionHistoryPoint, EvolutionProposalView,
  EvolutionSignalTally, EvolutionSnapshot,
} from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 自进化面板 copy。 */
    'self-evolution': EvolutionLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'self-evolution'

/** Services required by the badge, the panel, and the Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.diechiEvolution']

/** 注册侧边栏指标按钮 + 全屏自进化面板。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-self-evolution: dictionaries')

  ctx.inject(['slots', 'locale', 'remote', 'remote.diechiEvolution'], (scope: ClientContext) => {
    const remote = scope.remote.diechiEvolution as unknown as EvolutionRemote
    const controller = new EvolutionController(remote)
    // 自动刷新定时器是面板私有的：插件卸载（热重载/取消勾选）时必须一起停掉，
    // 否则会在后台每 3s 打一次 RPC，而界面上已经没有任何东西在读它。
    ctx.effect(() => () => { controller.dispose() }, 'ui-self-evolution: 停掉自动刷新定时器')

    // 侧边栏底部：一个数字 + 一颗状态点。点它开面板。
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'self-evolution',
      order: 50,
      locale: NS,
      inject: () => controller.inject(),
    }, EvolutionBadge))

    // 全屏浮层：曲线 / 信号 / 跑分 / 提议。关闭时不渲染（返回 null）。
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay',
      id: 'self-evolution',
      order: 50,
      locale: NS,
      inject: () => controller.inject(),
    }, EvolutionPanel))
  })
}
