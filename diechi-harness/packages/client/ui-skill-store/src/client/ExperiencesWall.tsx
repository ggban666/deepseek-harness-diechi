/**
 * 阅历视图（skill-center 'experiences'）：上半是「技能库现状」——每个平权技能
 * 的记忆/知识/实操条数与最近活动（overview RPC），点技能卡进入该技能的知识图谱；
 * 下半是实操阅历时间线——视频投喂自动入库的 #实操 相册流，可一键归位到技能、改标签、删除。
 */
import { useState } from 'react'
import type { BrainPendingMemory, BrainPracticeItem, SkillOverviewSnapshot } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import type { SkillManifestEntry } from './skill-format.ts'
import css from './ExperiencesWall.module.css'

/** 实操卡上的处置状态标签。 */
function statusLabel(t: (key: SkillStoreKey) => string, status: string): string {
  if (status === 'assigned') return t('expStatusAssigned')
  if (status === 'archived') return t('expStatusArchived')
  return t('expStatusPending')
}/** 来源徽标：对话归纳 / 视频实操 / 联网信息 / 用户直述。 */
function sourceLabel(t: (key: SkillStoreKey) => string, source: string): string {
  if (source === 'conversation') return t('expSourceConversation')
  if (source === 'web') return t('expSourceWeb')
  if (source === 'user') return t('expSourceUser')
  return t('expSourceVideo')
}

/** Props bound by the overlay. */
export interface ExperiencesWallProps {
  t: (key: SkillStoreKey) => string
  /** 技能库现状（overview RPC）。 */
  overview?: SkillOverviewSnapshot | undefined
  /** 实操收件箱（#实操 阅历）。 */
  practices: readonly BrainPracticeItem[]
  /** 平权技能目录（归位下拉用）。 */
  skills: readonly SkillManifestEntry[]
  /** 一键归位：把实操写入指定技能的大脑。 */
  onAssign(topic: string, skillId: string): Promise<boolean>
  /** 删除一条实操。 */
  onRemove(topic: string): Promise<boolean>
  /** 确认一条待核对知识（低置信度归纳）：内容无误后解除待确认。 */
  onConfirm(topic: string): Promise<boolean>
  /** 待确认记忆（自动除幻觉标记，需用户核对）。 */
  pendingMemories: readonly BrainPendingMemory[]
  /** 处置待确认记忆：confirm=true 解除标记；false 删除。 */
  onMemoryAction(id: number, confirm: boolean): Promise<boolean>
  /** 刷新收件箱。 */
  onRefresh(): Promise<void>
  /** 用发现的新主题创建技能草稿（打开工坊创建表单）。 */
  onCreateSkill(title: string, example: string): void
  /** 打开某技能的知识图谱；skillId 为空串打开全局图谱。 */
  onOpenGraph(skillId: string): void
}

/** Render the experiences wall: skill-library status + practice timeline. */
export function ExperiencesWall({
  t, overview, practices, skills, pendingMemories, onAssign, onRemove, onConfirm, onMemoryAction, onRefresh, onCreateSkill, onOpenGraph,
}: ExperiencesWallProps) {
  const [busyTopic, setBusyTopic] = useState<string>()
  const [removing, setRemoving] = useState<string>()
  const [confirming, setConfirming] = useState<string>()
  const [memoryBusyId, setMemoryBusyId] = useState<number>()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>()
  const [refreshing, setRefreshing] = useState(false)

  const assignTarget = (topic: string): string => {
    const item = practices.find(practice => practice.topic === topic)
    return item?.suggestedSkill ?? ''
  }

  const handleConfirm = async (topic: string): Promise<void> => {
    if (confirming !== undefined) return
    setConfirming(topic)
    setNotice(undefined)
    try {
      const ok = await onConfirm(topic)
      setNotice(ok
        ? { kind: 'ok', text: t('expConfirmedOk') }
        : { kind: 'error', text: t('expConfirmedFail') })
    } catch {
      setNotice({ kind: 'error', text: t('expConfirmedFail') })
    } finally {
      setConfirming(undefined)
    }
  }

  const handleAssign = async (topic: string): Promise<void> => {
    const skillId = assignTarget(topic)
    if (skillId === '' || busyTopic !== undefined) return
    setBusyTopic(topic)
    setNotice(undefined)
    try {
      const ok = await onAssign(topic, skillId)
      setNotice(ok
        ? { kind: 'ok', text: t('expAssignedOk').replace('{topic}', topic) }
        : { kind: 'error', text: t('expAssignedFail') })
    } catch {
      setNotice({ kind: 'error', text: t('expAssignedFail') })
    } finally {
      setBusyTopic(undefined)
    }
  }

  const handleRemove = async (topic: string): Promise<void> => {
    if (removing !== undefined) return
    setRemoving(topic)
    setNotice(undefined)
    try {
      const ok = await onRemove(topic)
      setNotice(ok
        ? { kind: 'ok', text: t('expRemovedOk') }
        : { kind: 'error', text: t('expRemovedFail') })
    } catch {
      setNotice({ kind: 'error', text: t('expRemovedFail') })
    } finally {
      setRemoving(undefined)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const handleMemoryAction = async (id: number, confirm: boolean): Promise<void> => {
    if (memoryBusyId !== undefined) return
    setMemoryBusyId(id)
    setNotice(undefined)
    try {
      const ok = await onMemoryAction(id, confirm)
      setNotice(ok
        ? { kind: 'ok', text: confirm ? t('memConfirmedOk') : t('memRemovedOk') }
        : { kind: 'error', text: t('memActionFail') })
    } catch {
      setNotice({ kind: 'error', text: t('memActionFail') })
    } finally {
      setMemoryBusyId(undefined)
    }
  }

  const pendingCount = overview?.pendingPracticeCount ?? practices.filter(item => item.status === 'pending').length
  const skillsById = new Map(skills.map(skill => [skill.id, skill]))

  return (
    <div className={css.wall}>
      {/* 技能库现状 */}
      <section className={css.statusSection}>
        <header className={css.sectionHead}>
          <h3 className={css.sectionTitle}>{t('expStatusTitle')}</h3>
          <div className={css.sectionActions}>
            <span className={css.pendingBadge}>
              {t('expPendingCount').replace('{n}', String(pendingCount))}
            </span>
            <button
              type="button"
              className={css.graphGlobalBtn}
              onClick={() => onOpenGraph('')}
              title={t('expGraphGlobal')}
            >
              ⬡ {t('expGraphGlobal')}
            </button>
          </div>
        </header>
        {overview === undefined || overview.skills.length === 0 ? (
          <p className={css.emptyLine}>{t('expStatusEmpty')}</p>
        ) : (
          <ul className={css.statusGrid}>
            {overview.skills.map(entry => (
              <li key={entry.id} className={css.statusCell}>
                <button
                  type="button"
                  className={entry.enabled ? css.statusCardActive : css.statusCard}
                  title={t('expGraph')}
                  onClick={() => onOpenGraph(entry.id)}
                >
                  <div className={css.statusHead}>
                    <span className={css.statusTitle}>{entry.title}</span>
                    {entry.enabled && <span className={css.onBadge}>{t('wallIdentityOn')}</span>}
                  </div>
                  <div className={css.statusStats}>
                    <span className={css.statusStat}>{t('wallMemories')} <b>{entry.memoryCount}</b></span>
                    <span className={css.statusStat}>{t('wallScenes')} <b>{entry.sceneCount}</b></span>
                    <span className={css.statusStat}>{t('wallKnowledge')} <b>{entry.knowledgeCount}</b></span>
                    <span className={css.statusStat}>{t('wallPractice')} <b>{entry.practiceCount}</b></span>
                  </div>
                  <span className={css.statusUpdated}>
                    {entry.lastActiveAt !== ''
                      ? t('wallLastActive').replace('{at}', entry.lastActiveAt.slice(0, 10))
                      : t('wallNeverActive')}
                  </span>
                  <span className={css.statusGraphHint}>⬡ {t('expGraph')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 发现的新主题：反复出现但无归属 → 一键创建新技能 */}
      {overview !== undefined && overview.newSkillSuggestions.length > 0 && (
        <section className={css.newSkillSection}>
          <header className={css.sectionHead}>
            <h3 className={css.sectionTitle}>{t('expNewSkillTitle')}</h3>
            <span className={css.newSkillHint}>{t('expNewSkillHint')}</span>
          </header>
          <ul className={css.newSkillList}>
            {overview.newSkillSuggestions.map(suggestion => (
              <li key={suggestion.title} className={css.newSkillItem}>
                <span className={css.newSkillName}>{suggestion.title}</span>
                <span className={css.newSkillCount}>{t('expNewSkillCount').replace('{n}', String(suggestion.count))}</span>
                <button
                  type="button"
                  className={css.primary}
                  onClick={() => onCreateSkill(suggestion.title, suggestion.example)}
                >
                  {t('expNewSkillCreate').replace('{title}', suggestion.title)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 待确认记忆：自动除幻觉标记，需用户核对后才参与注入 */}
      {pendingMemories.length > 0 && (
        <section className={css.pendingMemSection}>
          <header className={css.sectionHead}>
            <h3 className={css.sectionTitle}>{t('memPendingTitle')}</h3>
            <span className={css.pendingBadge}>{t('memPendingCount').replace('{n}', String(pendingMemories.length))}</span>
          </header>
          <p className={css.emptyLine}>{t('memPendingHint')}</p>
          <ul className={css.pendingMemList}>
            {pendingMemories.map(item => (
              <li key={item.id} className={css.pendingMemItem}>
                <div className={css.pendingMemHead}>
                  <span className={css.pendingMemSkill}>#{item.skillTitle}</span>
                  <span className={css.reviewBadge}>{t('memPendingReason')}</span>
                </div>
                <p className={css.pendingMemContent}>{item.content}</p>
                <div className={css.pendingMemActions}>
                  <button
                    type="button"
                    className={css.primary}
                    disabled={memoryBusyId !== undefined}
                    onClick={() => { void handleMemoryAction(item.id, true) }}
                  >
                    {memoryBusyId === item.id ? t('pending') : t('memConfirm')}
                  </button>
                  <button
                    type="button"
                    className={css.ghost}
                    disabled={memoryBusyId !== undefined}
                    onClick={() => { void handleMemoryAction(item.id, false) }}
                  >
                    {t('memDelete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 实操阅历时间线 */}
      <section className={css.timelineSection}>
        <header className={css.sectionHead}>
          <h3 className={css.sectionTitle}>{t('expTimelineTitle')}</h3>
          <button type="button" className={css.ghost} disabled={refreshing} onClick={() => { void handleRefresh() }}>
            {refreshing ? t('pending') : t('expRefresh')}
          </button>
        </header>
        {notice !== undefined && (
          <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
        )}
        {practices.length === 0 ? (
          <p className={css.emptyLine}>{t('expTimelineEmpty')}</p>
        ) : (
          <ul className={css.timeline}>
            {practices.map(item => {
              const suggested = skillsById.get(assignTarget(item.topic))
              return (
                <li key={item.topic} className={css.timelineCard}>
                  <div className={css.timelineHead}>
                    <span className={css.timelineTopic}>{item.topic}</span>
                    <span className={css.timelineMeta}>
                      <span className={css.sourceBadge}>{sourceLabel(t, item.source)}</span>
                      <span className={css.timelineStatus}>{statusLabel(t, item.status)}</span>
                    </span>
                  </div>
                  <p className={css.timelineBody}>{item.content}</p>
                  <div className={css.timelineMeta}>
                    <span className={css.timelineDate}>{item.updatedAt.slice(0, 10)}</span>
                    {item.needsReview && (
                      <span className={css.reviewBadge}>{t('expNeedsReview')}</span>
                    )}
                    {suggested !== undefined && (
                      <span className={css.suggest}>{t('expSuggest').replace('{title}', suggested.title)}</span>
                    )}
                  </div>
                  <div className={css.timelineActions}>
                    {item.needsReview && (
                      <button
                        type="button"
                        className={css.primary}
                        disabled={confirming !== undefined}
                        onClick={() => { void handleConfirm(item.topic) }}
                      >
                        {confirming === item.topic ? t('pending') : t('expConfirm')}
                      </button>
                    )}
                    {!item.needsReview && item.status !== 'assigned' && (
                      <button
                        type="button"
                        className={css.primary}
                        disabled={assignTarget(item.topic) === '' || busyTopic !== undefined}
                        onClick={() => { void handleAssign(item.topic) }}
                      >
                        {busyTopic === item.topic ? t('pending') : t('expAssign')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={css.ghost}
                      disabled={removing !== undefined}
                      onClick={() => { void handleRemove(item.topic) }}
                    >
                      {t('expRemove')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}