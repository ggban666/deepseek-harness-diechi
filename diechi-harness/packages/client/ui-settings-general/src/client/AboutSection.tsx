/**
 * The About section: the product statement page — DSH as the base, the
 * integrated capabilities (MiniCPM-V vision, Kokoro voice, egalitarian
 * skills, global brain, agent presets, skill market), the one-click launch
 * story, and the open-source declaration. Static copy only: everything reads
 * the standard locale seat, so no store or inject face is needed.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsKey } from './locales.ts'
import css from './AboutSection.module.css'

/** Full component props: section owner share plus the standard locale seat. */
export type AboutSectionComponentProps = PropsRuntime<'settings.section'> & PropsLocale<'settings'>

/** Feature card entries, title + body key pairs into the settings dictionary. */
const FEATURES: readonly { title: SettingsKey; body: SettingsKey }[] = [
  { title: 'about.feature.vision', body: 'about.feature.vision.body' },
  { title: 'about.feature.voice', body: 'about.feature.voice.body' },
  { title: 'about.feature.skills', body: 'about.feature.skills.body' },
  { title: 'about.feature.brain', body: 'about.feature.brain.body' },
  { title: 'about.feature.agents', body: 'about.feature.agents.body' },
  { title: 'about.feature.market', body: 'about.feature.market.body' },
]

/** Public open-source repository of this integrated edition. */
const GITHUB_REPO_URL = 'https://github.com/ggban666/deepseek-harness-diechi'

/**
 * Render the About section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AboutSection({ t }: AboutSectionComponentProps) {
  return (
    <div className={css.section}>
      <header className={css.hero}>
        <h2 className={css.title}>{t('about.title')}</h2>
        <p className={css.tagline}>{t('about.tagline')}</p>
      </header>
      <p className={css.intro}>{t('about.intro')}</p>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('about.base.title')}</h3>
        <p className={css.blockBody}>{t('about.base.body')}</p>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('about.features.title')}</h3>
        <ul className={css.cards}>
          {FEATURES.map(feature => (
            <li key={feature.title} className={css.card}>
              <h4 className={css.cardTitle}>{t(feature.title)}</h4>
              <p className={css.cardBody}>{t(feature.body)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('about.launch.title')}</h3>
        <p className={css.blockBody}>{t('about.launch.body')}</p>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('about.open.title')}</h3>
        <p className={css.blockBody}>
          {t('about.open.body')}{' '}
          <a className={css.link} href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            {t('about.open.link')}
          </a>
        </p>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('about.contact.title')}</h3>
        <p className={css.blockBody}>
          {t('about.contact.wechat')}：{t('about.contact.wechat.value')}
        </p>
      </section>
    </div>
  )
}
