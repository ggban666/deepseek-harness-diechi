/**
 * Hero quick-action cards: two clickable product cards (商店 / 工坊) in the
 * empty-state quick row. Each opens the skill center (shell.overlay) on its
 * tab; the same injected face the overlay uses is bound here, so opening from
 * the hero and from within the center share one open/close state.
 */
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillCenterInjected } from './SkillCenterOverlay.tsx'
import css from './SkillCenterHeroCards.module.css'

/** Props the renderer binds for the hero quick row entry. */
export type SkillCenterHeroCardsProps =
  PropsRuntime<'conversation.hero.quick'>
  & PropsLocale<'skill-store'>
  & InjectFace<SkillCenterInjected>

/** Render the two skill-center hero cards. */
export function SkillCenterHeroCards({
  t, open,
}: SkillCenterHeroCardsProps) {
  return (
    <div className={css.row}>
      <button
        type="button"
        className={css.card}
        onClick={() => open('market')}
      >
        <img className={css.brand} src="/butterfly-icon.png" alt="" />
        <span className={css.cardBody}>
          <span className={css.cardTitle}>{t('heroMarketCard')}</span>
          <span className={css.cardDesc}>{t('heroMarketCardDesc')}</span>
        </span>
      </button>
      <button
        type="button"
        className={css.card}
        onClick={() => open('workshop')}
      >
        <span className={css.monogram}>工</span>
        <span className={css.cardBody}>
          <span className={css.cardTitle}>{t('heroWorkshopCard')}</span>
          <span className={css.cardDesc}>{t('heroWorkshopCardDesc')}</span>
        </span>
      </button>
    </div>
  )
}