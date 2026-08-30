/**
 * 全屏自进化面板（`shell.overlay`）：C(t)/K(t) 双曲线 + 体感信号 + CBS 跑分 + 提议卡片。
 *
 * 面板的每一块都对应三架构的一个可证伪承诺：
 * - 数字卡 → A1 单调性（当前 vs 历史最优，退步一眼可见）
 * - 曲线 + 软带 → A2 有界性（成本超没超带，画出来而不是算出来）
 * - CBS 跑分 → A3 可判定性（同一套基准集，同一套判定，分数可复现）
 * - 提议卡片 → 进化闭环到底有没有在转（这是此前唯一从未运转的一环）
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the shell.overlay slot declaration (ui-layout) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { EvolutionLocaleKey } from './locales.ts'
import type { EvolutionInjected } from './EvolutionController.ts'
import type { EvolutionCbsView, EvolutionSnapshot } from './types.ts'
import { CapabilityCurve } from './CapabilityCurve.tsx'
import css from './EvolutionPanel.module.css'

/** Props the panel binds: shared panel state + refresh/run actions. */
export type EvolutionPanelProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'self-evolution'>
  & InjectFace<EvolutionInjected>

/** 跑分族展示顺序（对应 CBS 的三个族）。 */
const FAMILIES: readonly { id: string; key: EvolutionLocaleKey }[] = [
  { id: 'liveness', key: 'famLiveness' },
  { id: 'safety', key: 'famSafety' },
  { id: 'pii', key: 'famPii' },
]

/** 把 0~1 渲染成百分数（整数）。 */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** 保留 3 位小数，成本数量级在 1 附近，2 位会看不出变化。 */
function num3(value: number): string {
  return value.toFixed(3)
}

/** 简单模板替换：{key} → value */
function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

/** Render the full-screen self-evolution panel (null while closed). */
export function EvolutionPanel({
  t, useState: useEvolutionState, refresh, close, setAutoRefresh, runCbs,
}: EvolutionPanelProps): JSX.Element | null {
  const state = useEvolutionState(value => value)
  if (!state.open) return null
  const snapshot = state.snapshot

  return (
    <div className={css.mask} onClick={() => close()} role="presentation">
      <div
        className={css.panel}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t('panelTitle')}
      >
        <header className={css.header}>
          <div className={css.headings}>
            <h2 className={css.title}>{t('panelTitle')}</h2>
            {snapshot === null
              ? <p className={css.subtitle}>{t('panelSubtitle')}</p>
              : (
                <p className={css.statusLine}>
                  <StatusDot action={snapshot.cost.action} />
                  {fmt(t('statusLine'), {
                    frozen: snapshot.rules.frozen,
                    authorized: snapshot.rules.authorized,
                    negatives: snapshot.negatives,
                  })}
                </p>
              )}
          </div>
          <button type="button" className={css.close} onClick={() => close()}>{t('close')}</button>
        </header>

        <div className={css.body}>
          {state.error !== ''
            ? <p className={css.error}>{t('errorLabel')}：{state.error}</p>
            : null}

          {snapshot === null
            ? (
              <div className={css.empty}>
                <p className={css.emptyTitle}>{state.loading ? t('refreshing') : t('noData')}</p>
                <p className={css.emptyHint}>{t('noDataHint')}</p>
              </div>
            )
            : <SnapshotBody t={t} snapshot={snapshot} runCbs={runCbs} busy={state.runningCbs} />}
        </div>

        <footer className={css.footer}>
          <div className={css.footerActions}>
            {snapshot !== null
              ? (
                <>
                  <button
                    type="button"
                    className={css.primary}
                    onClick={() => { void runCbs(true) }}
                    disabled={state.runningCbs}
                  >
                    {state.runningCbs ? t('cbsRunning') : t('cbsRunCommit')}
                  </button>
                  <button
                    type="button"
                    className={css.ghost}
                    onClick={() => { void runCbs(false) }}
                    disabled={state.runningCbs}
                  >
                    {t('cbsRun')}
                  </button>
                </>
              )
              : null}
          </div>
          <div className={css.footerActions}>
            <label className={css.toggle}>
              <input
                type="checkbox"
                checked={state.autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span>{t('autoRefresh')}</span>
            </label>
            <button
              type="button"
              className={css.ghost}
              onClick={() => { void refresh() }}
              disabled={state.loading}
            >
              {state.loading ? t('refreshing') : t('refresh')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** 状态小圆点（放在标题下方 status line 开头）。 */
function StatusDot({ action }: { action: 'none' | 'throttle' | 'reject' }): JSX.Element {
  const tone = action === 'reject' ? css.dotDanger : action === 'throttle' ? css.dotWarn : css.dotOk
  return <span className={`${css.statusDot} ${tone}`} aria-hidden="true" />
}

/** 快照内容（拿到数据后才渲染）。 */
function SnapshotBody(
  { t, snapshot, runCbs, busy }:
  { t: (key: EvolutionLocaleKey) => string; snapshot: EvolutionSnapshot; runCbs: (commit: boolean) => Promise<void>; busy: boolean },
): JSX.Element {
  const { capability, cost, signals, rules } = snapshot
  return (
    <>
      <section className={css.cards}>
        <article className={css.card}>
          <span className={css.cardLabel}>{t('capabilityTitle')}</span>
          <strong className={css.cardValue}>{pct(capability.current)}</strong>
          <span className={css.cardMeta}>
            {t('capabilityBest')} {pct(capability.best)} · {t('capabilitySamples')} {capability.total}
          </span>
        </article>

        <article className={`${css.card} ${costTone(cost.action, css)}`}>
          <div className={css.cardHeader}>
            <span className={css.cardLabel}>{t('costTitle')}</span>
            <span className={css.cardTag}>
              {cost.action === 'none'
                ? t('costActionNone')
                : cost.action === 'throttle'
                  ? t('costActionThrottle')
                  : t('costActionReject')}
            </span>
          </div>
          <strong className={css.cardValue}>{num3(cost.current)}</strong>
          <span className={css.cardMeta}>
            {t('costBand')} {num3(cost.bandLo)}~{num3(cost.bandHi)} · {t('costHardMax')} {num3(cost.hardMax)}
          </span>
        </article>

        <article className={css.card}>
          <span className={css.cardLabel}>{t('rulesTitle')}</span>
          <strong className={css.cardValue}>{rules.frozen}</strong>
          <span className={css.cardMeta}>
            {t('rulesAuthorized')} {rules.authorized} · {t('rulesNegatives')} {snapshot.negatives}
          </span>
        </article>
      </section>

      <div className={css.split}>
        <section className={css.block}>
          <h3 className={css.blockTitle}>{t('curveTitle')}</h3>
          <div className={css.chartBox}>
            <CapabilityCurve
              history={snapshot.history}
              bandLo={cost.bandLo}
              bandHi={cost.bandHi}
              hardMax={cost.hardMax}
            />
            {snapshot.history.length === 0
              ? (
                <div className={css.chartEmpty}>
                  <p>{t('curveEmpty')}</p>
                  <button
                    type="button"
                    className={css.linkBtn}
                    onClick={() => { void runCbs(true) }}
                    disabled={busy}
                  >
                    {t('curveEmptyAction')}
                  </button>
                </div>
              )
              : null}
          </div>
          <div className={css.legend}>
            <span className={css.legendItem}>
              <i className={css.swatchC} aria-hidden="true" />
              {t('curveLegendC')} {pct(capability.current)}
            </span>
            <span className={css.legendItem}>
              <i className={css.swatchK} aria-hidden="true" />
              {t('curveLegendK')} {num3(cost.current)}
            </span>
          </div>
        </section>

        <aside className={css.feed}>
          <h3 className={css.blockTitle}>{t('feedTitle')}</h3>
          <Feed t={t} snapshot={snapshot} />
        </aside>
      </div>
    </>
  )
}

/** 右侧「最新状态」摘要列表。 */
function Feed(
  { t, snapshot }: { t: (key: EvolutionLocaleKey) => string; snapshot: EvolutionSnapshot },
): JSX.Element {
  const items: JSX.Element[] = []

  if (snapshot.latestCbs === null) {
    items.push(
      <li key="cbs-none" className={css.feedItem}>
        <span className={css.feedBullet} style={{ background: '#5d7186' }} />
        <span className={css.feedText}>{t('feedCbsNone')}</span>
      </li>,
    )
  } else {
    items.push(
      <li key="cbs" className={css.feedItem}>
        <span className={css.feedBullet} style={{ background: '#4a9eff' }} />
        <span className={css.feedText}>
          {fmt(t('feedCbs'), { score: pct(snapshot.latestCbs.cScore), passed: snapshot.latestCbs.passed, total: snapshot.latestCbs.total })}
        </span>
      </li>,
    )
    for (const family of FAMILIES) {
      const stat = snapshot.latestCbs.byFamily[family.id]
      if (stat === undefined) continue
      items.push(
        <li key={`cbs-${family.id}`} className={css.feedSub}>
          <span className={css.feedText}>
            {t(family.key)} {stat.passed}/{stat.total}（{pct(stat.rate)}）
          </span>
        </li>,
      )
    }
  }

  if (snapshot.signals.total > 0) {
    items.push(
      <li key="signals" className={css.feedItem}>
        <span className={css.feedBullet} style={{ background: '#22c55e' }} />
        <span className={css.feedText}>{fmt(t('feedSignals'), { total: snapshot.signals.total })}</span>
      </li>,
    )
  }

  if (snapshot.evolutionAvailable) {
    items.push(
      <li key="proposals" className={css.feedItem}>
        <span className={css.feedBullet} style={{ background: '#a78bfa' }} />
        <span className={css.feedText}>{fmt(t('feedProposals'), { count: snapshot.proposals.length })}</span>
      </li>,
    )
  }

  if (items.length === 0) {
    return (
      <div className={css.emptySmall}>
        <p className={css.emptyTitle}>{t('feedEmpty')}</p>
      </div>
    )
  }

  return <ul className={css.feedList}>{items}</ul>
}

/** 成本档位 → 卡片配色。 */
function costTone(action: 'none' | 'throttle' | 'reject', styles: typeof css): string {
  if (action === 'reject') return styles.toneDanger ?? ''
  if (action === 'throttle') return styles.toneWarn ?? ''
  return styles.toneOk ?? ''
}
