/**
 * 商店页（skill-center 'market'）：本地市场目录扫出来的可安装技能，一键安装。
 *
 * 2026-08-31 从 SkillCenterOverlay.tsx 拆出。原先一个 845 行的文件里塞了
 * 4 个页面加两个子组件，改任何一页都要在长文件里翻找。这里只管商店这一页。
 */
import type { SkillMarketSkill } from './skill-format.ts'
import type { SkillStoreKey } from './locales.ts'
import type { ImportResult } from './skill-display.ts'
import { useAction } from './use-action.ts'
import css from './SkillCenterOverlay.module.css'

/** Market catalog snapshot the store page renders. */
export interface MarketState {
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Absolute path of the scanned market directory. */
  readonly dir: string
  /** Discoverable skills in the local market. */
  readonly skills: readonly SkillMarketSkill[]
}

/** 刷新动作的固定标记：条目 id 是技能名，不会撞上。 */
const REFRESH_KEY = '\u0000refresh'

/** Props bound by the overlay. */
export interface MarketTabProps {
  t: (key: SkillStoreKey) => string
  market: MarketState
  installedIds: ReadonlySet<string>
  onRefresh: () => Promise<void>
  onInstall: (id: string) => Promise<ImportResult>
}

/** Render one store tab over the scanned market catalog. */
export function MarketTab({ t, market, installedIds, onRefresh, onInstall }: MarketTabProps) {
  const { notice, run, isBusy } = useAction()

  const handleInstall = (id: string): void => {
    void run(id, async () => {
      const result = await onInstall(id)
      if (result.ok) return true
      // throw 的原因会拼到失败文案后面：安装失败总得告诉用户是为什么
      throw new Error(result.error)
    }, {
      ok: t('installOk').replace('{id}', id),
      fail: t('installFailed'),
    })
  }

  return (
    <div className={css.tab}>
      <p className={css.intro}>{t('marketIntro')}</p>
      <div className={css.dirRow}>
        <span className={css.dirLabel}>{t('marketDir')}:</span>
        <code className={css.dir}>{market.dir !== '' ? market.dir : '\u2014'}</code>
        <button
          type="button"
          className={css.ghost}
          disabled={isBusy(REFRESH_KEY)}
          onClick={() => {
            void run(REFRESH_KEY, async () => {
              await onRefresh()
              return true
            }, { ok: t('marketRefreshed'), fail: t('marketRefreshFailed') })
          }}
        >
          {isBusy(REFRESH_KEY) ? t('pending') : t('marketRefresh')}
        </button>
      </div>
      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
      )}
      {market.status === 'loading' ? (
        <p className={css.empty}>{t('pending')}</p>
      ) : market.skills.length === 0 ? (
        <p className={css.empty}>{t('marketEmpty')}</p>
      ) : (
        <ul className={css.grid}>
          {market.skills.map(skill => {
            const isInstalled = installedIds.has(skill.id)
            return (
              <li key={skill.id} className={css.marketCard}>
                <div className={css.marketCardHead}>
                  <span className={css.marketTitle}>{skill.title}</span>
                  <span className={css.badge}>{skill.kind === 'vision' ? t('kindVision') : t('kindText')}</span>
                  <span className={css.badge}>{t('version')} {skill.version}</span>
                </div>
                <p className={css.marketDesc}>{skill.description}</p>
                <div className={css.marketMeta}>
                  {skill.tags.map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
                  {skill.author !== undefined && skill.author !== '' && (
                    <span className={css.author}>{skill.author}</span>
                  )}
                </div>
                <div className={css.marketFoot}>
                  {isInstalled && <span className={css.installedBadge}>{t('installedBadge')}</span>}
                  <button
                    type="button"
                    className={isInstalled ? css.ghost : css.primary}
                    disabled={isBusy(skill.id)}
                    title={isInstalled ? t('reinstallHint') : undefined}
                    onClick={() => { handleInstall(skill.id) }}
                  >
                    {isBusy(skill.id) ? t('pending') : t('install')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
