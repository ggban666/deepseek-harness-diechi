/**
 * 平权技能卡片墙（skill-center 'skills' 视图）：每个平权技能一张联系人卡片，
 * 点击卡片 = 勾选/取消 = 换上一个完整的人（数据库+技能+人格热重载）。
 * 卡片展示技能大脑的现状（记忆/知识/实操条数 + 最近活动），来自 overview RPC。
 *
 * 2026-08-31 信息层级重构：原先卡上是 4 个带底色的数字方块 + 类型徽章 +
 * 身份徽章——6 个块状元素在抢注意力，主次全平。现在：
 * - 4 项之和作为唯一主数字（大号），回答「这个技能有多少阅历」这一个首要问题；
 * - 4 项明细降为一行灰色小字，去掉底色与边框，需要时才细看；
 * - 类型徽章去掉圆角底块，降为灰字。
 * 信息一条没少，视觉噪音降一个量级。
 */
import { useMemo } from 'react'
import type { SkillOverviewSnapshot } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import type { SkillManifestEntry } from './skill-format.ts'
import { kindLabel } from './skill-display.ts'
import { useAction } from './use-action.ts'
import css from './SkillCardWall.module.css'

/** One catalog snapshot the wall renders. */
export interface SkillCardWallState {
  readonly skills: readonly SkillManifestEntry[]
  readonly writable: boolean
}

/** Props bound by the overlay. */
export interface SkillCardWallProps {
  t: (key: SkillStoreKey) => string
  store: SkillCardWallState
  /** 技能库现状（overview RPC）；未就绪时为 undefined。 */
  overview?: SkillOverviewSnapshot | undefined
  /** 勾选 = 换人；持久化后 host 热重载。 */
  onToggle(id: string, enabled: boolean): Promise<void>
  /** 打开新建/管理（工坊）。 */
  onManage(): void
  /** 打开商店。 */
  onMarket(): void
}

/** Render the skill contact-card wall. */
export function SkillCardWall({
  t, store, overview, onToggle, onManage, onMarket,
}: SkillCardWallProps) {
  const { busy, notice, run } = useAction()

  const overviewBySkill = useMemo(
    () => new Map((overview?.skills ?? []).map(entry => [entry.id, entry])),
    [overview],
  )
  const enabledCount = store.skills.filter(skill => skill.enabled).length

  const toggle = (skill: SkillManifestEntry): void => {
    void run(
      skill.id,
      () => onToggle(skill.id, !skill.enabled),
      {
        ok: skill.enabled
          ? t('wallDisabled').replace('{title}', skill.title)
          : t('wallEnabled').replace('{title}', skill.title),
        fail: t('saveFailed'),
      },
    )
  }

  return (
    <div className={css.wall}>
      <header className={css.head}>
        <div className={css.headText}>
          <h2 className={css.title}>{t('wallTitle')}</h2>
          <p className={css.subtitle}>
            {t('wallSubtitle')}
            <span className={css.count}>
              {t('wallEnabledCount').replace('{n}', String(enabledCount)).replace('{m}', String(store.skills.length))}
            </span>
          </p>
        </div>
        <div className={css.headActions}>
          <button type="button" className={css.ghost} onClick={onMarket}>{t('tabMarket')}</button>
          <button type="button" className={css.primary} onClick={onManage}>{t('wallManage')}</button>
        </div>
      </header>

      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
      )}

      {store.skills.length === 0 ? (
        <p className={css.empty}>{t('empty')}</p>
      ) : (
        <ul className={css.grid}>
          {store.skills.map((skill) => {
            const pending = skill.content.trim() === ''
            const entry = overviewBySkill.get(skill.id)
            const active = skill.enabled
            const memories = entry?.memoryCount ?? 0
            const scenes = entry?.sceneCount ?? 0
            const knowledge = entry?.knowledgeCount ?? 0
            const practices = entry?.practiceCount ?? 0
            return (
              <li key={skill.id} className={css.cell}>
                <button
                  type="button"
                  className={active ? css.active : css.card}
                  disabled={!store.writable || pending || busy !== undefined}
                  aria-pressed={active}
                  onClick={() => { toggle(skill) }}
                >
                  <div className={css.cardHead}>
                    <span className={active ? css.avatarActive : css.avatar} aria-hidden="true">🦋</span>
                    <div className={css.cardTitleBlock}>
                      <span className={css.cardTitle}>{skill.title}</span>
                      <code className={css.command}>/{skill.id}</code>
                    </div>
                    <span className={css.kind}>{kindLabel(skill.kind, t)}</span>
                  </div>

                  <div className={css.heroStat}>
                    <span className={css.heroValue}>
                      {entry === undefined ? '\u2014' : memories + scenes + knowledge + practices}
                    </span>
                    <span className={css.heroLabel}>{t('wallTotal')}</span>
                    {entry !== undefined && (
                      <span className={css.statLine}>
                        {t('wallMemories')} {memories}
                        {' · '}
                        {t('wallScenes')} {scenes}
                        {' · '}
                        {t('wallKnowledge')} {knowledge}
                        {' · '}
                        {t('wallPractice')} {practices}
                      </span>
                    )}
                  </div>

                  <p className={css.desc}>{skill.description !== '' ? skill.description : t('wallNoDesc')}</p>
                  {skill.whenToUse.trim() !== '' && <p className={css.when}>{t('wallWhen')} {skill.whenToUse.trim()}</p>}

                  <div className={css.cardFoot}>
                    <span className={css.updated}>
                      {entry !== undefined && entry.lastActiveAt !== ''
                        ? t('wallLastActive').replace('{at}', entry.lastActiveAt.slice(0, 10))
                        : t('wallNeverActive')}
                    </span>
                    <span className={active ? css.identityActive : css.identity}>
                      {active ? t('wallIdentityOn') : t('wallIdentityOff')}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
