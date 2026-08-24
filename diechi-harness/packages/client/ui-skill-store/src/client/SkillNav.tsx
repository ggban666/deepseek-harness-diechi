/**
 * 蝶翅三入口导航（sidebar.nav）：对话 / 平权技能 / 阅历。
 * 对话 = 关闭全屏视图回到聊天；平权技能 = 卡片墙；阅历 = 技能库现状+实操时间线。
 * 收起为 rail 时只显示图标，展开时带文字标签。
 */
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar.nav slot declaration (ui-sidebar) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SkillStoreKey } from './locales.ts'
import type { SkillCenterInjected } from './SkillCenterOverlay.tsx'
import css from './SkillNav.module.css'

/** Props the nav binds: the shared center view + open/close actions. */
export type SkillNavProps =
  PropsRuntime<'sidebar.nav'>
  & PropsLocale<'skill-store'>
  & InjectFace<SkillCenterInjected>

/** One nav entry. */
interface NavEntry {
  readonly id: 'chat' | 'skills' | 'experiences' | 'market'
  readonly labelKey: SkillStoreKey
  readonly icon: string
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { id: 'chat', labelKey: 'navChat', icon: '💬' },
  { id: 'skills', labelKey: 'navSkills', icon: '🦋' },
  { id: 'experiences', labelKey: 'navExperiences', icon: '📖' },
  { id: 'market', labelKey: 'tabMarket', icon: '🛒' },
]

/** Render the three-entry app navigation bar. */
export function SkillNav({
  t, useCenter, open, close, wide,
}: SkillNavProps) {
  const state = useCenter(value => value)
  const current: 'chat' | 'skills' | 'experiences' | 'market' = state.view === 'closed'
    ? 'chat'
    : state.view === 'experiences'
      ? 'experiences'
      : state.view === 'market'
        ? 'market'
        : 'skills'
  return (
    <nav className={`${css.nav} ${!wide ? css.rail : ''}`} aria-label={t('navLabel')}>
      {NAV_ENTRIES.map((entry) => {
        const active = current === entry.id
        return (
          <button
            key={entry.id}
            type="button"
            className={`${css.tab} ${active ? css.active : ''}`}
            aria-current={active ? 'page' : undefined}
            title={t(entry.labelKey)}
            onClick={() => {
              if (entry.id === 'chat') close()
              else open(entry.id)
            }}
          >
            <span className={css.icon} aria-hidden="true">{entry.icon}</span>
            {wide && <span className={css.label}>{t(entry.labelKey)}</span>}
          </button>
        )
      })}
    </nav>
  )
}
