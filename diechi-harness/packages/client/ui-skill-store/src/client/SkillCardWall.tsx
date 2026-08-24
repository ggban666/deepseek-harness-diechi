/**
 * 平权技能卡片墙（skill-center 'skills' 视图）：每个平权技能一张联系人卡片，
 * 点击卡片 = 勾选/取消 = 换上一个完整的人（数据库+技能+人格热重载）。
 * 卡片展示技能大脑的现状（记忆/知识/实操条数 + 最近活动），来自 overview RPC。
 */
import { useState } from 'react'
import type { SkillOverviewSnapshot } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import type { SkillManifestEntry } from './skill-format.ts'
import { kindLabel } from './skill-display.ts'
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

/** 卡片上的数据徽标。 */
function statBadge(label: string, value: number): React.ReactNode {
  return (
    <span className={css.stat}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
    </span>
  )
}

/** Render the skill contact-card wall. */
export function SkillCardWall({
  t, store, overview, onToggle, onManage, onMarket,
}: SkillCardWallProps) {
  const [busyId, setBusyId] = useState<string>()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>()

  const overviewBySkill = new Map((overview?.skills ?? []).map(entry => [entry.id, entry]))
  const enabledCount = store.skills.filter(skill => skill.enabled).length

  const toggle = async (skill: SkillManifestEntry): Promise<void> => {
    if (!store.writable || skill.content.trim() === '') return
    if (busyId !== undefined) return
    setBusyId(skill.id)
    setNotice(undefined)
    try {
      await onToggle(skill.id, !skill.enabled)
      setNotice({ kind: 'ok', text: skill.enabled ? t('wallDisabled').replace('{title}', skill.title) : t('wallEnabled').replace('{title}', skill.title) })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    } finally {
      setBusyId(undefined)
    }
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
            const overviewEntry = overviewBySkill.get(skill.id)
            const active = skill.enabled
            return (
              <li key={skill.id} className={css.cell}>
                <button
                  type="button"
                  className={active ? css.active : css.card}
                  disabled={!store.writable || pending || busyId !== undefined}
                  aria-pressed={active}
                  onClick={() => { void toggle(skill) }}
                >
                  <div className={css.cardHead}>
                    <span className={active ? css.avatarActive : css.avatar} aria-hidden="true">🦋</span>
                    <div className={css.cardTitleBlock}>
                      <span className={css.cardTitle}>{skill.title}</span>
                      <code className={css.command}>/{skill.id}</code>
                    </div>
                    <span className={css.kind}>{kindLabel(skill.kind, t)}</span>
                  </div>
                  <p className={css.desc}>{skill.description !== '' ? skill.description : t('wallNoDesc')}</p>
                  {skill.whenToUse.trim() !== '' && <p className={css.when}>{t('wallWhen')} {skill.whenToUse.trim()}</p>}
                  <div className={css.stats}>
                    {statBadge(t('wallMemories'), overviewEntry?.memoryCount ?? 0)}
                    {statBadge(t('wallScenes'), overviewEntry?.sceneCount ?? 0)}
                    {statBadge(t('wallKnowledge'), overviewEntry?.knowledgeCount ?? 0)}
                    {statBadge(t('wallPractice'), overviewEntry?.practiceCount ?? 0)}
                  </div>
                  <div className={css.cardFoot}>
                    <span className={css.updated}>
                      {overviewEntry !== undefined && overviewEntry.lastActiveAt !== ''
                        ? t('wallLastActive').replace('{at}', overviewEntry.lastActiveAt.slice(0, 10))
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