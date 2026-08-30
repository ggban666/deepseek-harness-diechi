/**
 * 侧边栏底部的自进化入口（`sidebar.footer.action`）。
 *
 * 设计取舍：这里只放**最紧凑的状态摘要**——C(t) 与 K(t) 两个数。
 * 侧边栏的职责是"让人一眼知道系统还活着并且没失控"，不是让人在这里做分析。
 *
 * 颜色只表达一件事：成本 K(t) 落在哪一档。能力低不报警（那是起点不是故障），
 * 成本爆了才报警——因为成本失控会让整个系统越来越慢，而人察觉不到。
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar.footer.action slot declaration (ui-sidebar) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { EvolutionInjected } from './EvolutionController.ts'
import css from './EvolutionBadge.module.css'

/** Props the badge binds: shared panel state + the open/close action. */
export type EvolutionBadgeProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'self-evolution'>
  & InjectFace<EvolutionInjected>

/** 把 0~1 的能力分渲染成百分数（空则返回 em dash）。 */
function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${Math.round(value * 100)}%`
}

/** 把 K 渲染成 3 位小数。 */
function kfmt(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(3)
}

/** Render the sidebar foot entry: compact C + K status chip. */
export function EvolutionBadge({ t, useState: useEvolutionState, toggle, wide }: EvolutionBadgeProps) {
  const state = useEvolutionState(value => value)
  const snapshot = state.snapshot
  const action = snapshot?.cost.action ?? 'none'
  const tone = action === 'reject' ? css.toneDanger : action === 'throttle' ? css.toneWarn : css.toneOk
  const busy = state.loading || state.runningCbs || state.autoRefresh

  return (
    <button
      type="button"
      className={`${css.badge} ${wide ? '' : css.rail} ${busy ? css.busy : ''}`}
      title={`${t('panelTitle')} · C ${percent(snapshot?.capability.current)} · K ${kfmt(snapshot?.cost.current)}`}
      aria-label={t('badgeLabel')}
      onClick={() => toggle()}
    >
      <span className={`${css.dot} ${tone}`} aria-hidden="true" />
      {wide
        ? (
          <>
            <span className={css.label}>{t('badgeLabel')}</span>
            <span className={css.score}>
              C {percent(snapshot?.capability.current)}
              <span className={css.sep}>·</span>
              K {kfmt(snapshot?.cost.current)}
            </span>
          </>
        )
        : null}
    </button>
  )
}
