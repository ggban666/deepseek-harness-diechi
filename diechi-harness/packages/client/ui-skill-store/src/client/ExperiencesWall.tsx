/**
 * 阅历视图（skill-center 'experiences'）：上半是「技能库现状」——每个平权技能
 * 的记忆/知识/实操条数与最近活动（overview RPC），点技能卡进入该技能的知识图谱；
 * 下半是实操阅历时间线——视频投喂自动入库的 #实操 相册流，可一键归位到技能、改标签、删除。
 *
 * 2026-08-31 整理：
 * - 四个动作（确认/归位/删除/处置记忆）原先各抄一遍「置忙 → try → 落提示 →
 *   catch → 收忙」，还各自维护一个 busy state（busyTopic / removing /
 *   confirming / memoryBusyId）。统一收进 `useAction`，对外只剩一个互斥标记。
 * - `assignTarget()` 在 render 里对每条阅历做一次 `practices.find()`，而它被
 *   `practices.map()` 内每张卡调用 → O(n²)。预建成 Map 一次查表。
 * - `skillsById` 每次 render 重建，改 useMemo。
 * - 信息层级：卡片上原先 4 个带底色的块（来源/状态/待审/建议）在抢注意力。
 *   现在**只有「待审」保留色块**——它是唯一需要用户行动的信号；来源、状态、
 *   建议归位都是静态事实，降为灰字。技能现状卡的数字同样改为主数字 + 灰字明细。
 */
import { useMemo } from 'react'
import type { BrainPendingMemory, BrainPracticeItem, SkillOverviewSnapshot } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import type { SkillManifestEntry } from './skill-format.ts'
import { useAction, useBusy } from './use-action.ts'
import css from './ExperiencesWall.module.css'

/** 实操卡上的处置状态标签。 */
function statusLabel(t: (key: SkillStoreKey) => string, status: string): string {
  if (status === 'assigned') return t('expStatusAssigned')
  if (status === 'archived') return t('expStatusArchived')
  return t('expStatusPending')
}

/** 来源标签：对话归纳 / 视频实操 / 联网信息 / 用户直述。 */
function sourceLabel(t: (key: SkillStoreKey) => string, source: string): string {
  if (source === 'conversation') return t('expSourceConversation')
  if (source === 'web') return t('expSourceWeb')
  if (source === 'user') return t('expSourceUser')
  return t('expSourceVideo')
}

/** 动作标记：`kind:id`。同一时刻只允许一个写动作在飞（都写同一个 SQLite 大脑）。 */
function actionKey(kind: string, id: string | number): string {
  return `${kind}:${id}`
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
  const { busy, notice, run } = useAction()
  const [refreshing, refresh] = useBusy()

  // 预建查表，替代 render 内的 practices.find() —— 后者在 map 里调用会退化成 O(n²)。
  const suggestedByTopic = useMemo(
    () => new Map(practices.map(item => [item.topic, item.suggestedSkill ?? ''])),
    [practices],
  )
  const skillsById = useMemo(() => new Map(skills.map(skill => [skill.id, skill])), [skills])

  const handleConfirm = (topic: string): void => {
    void run(actionKey('confirm', topic), () => onConfirm(topic), {
      ok: t('expConfirmedOk'),
      fail: t('expConfirmedFail'),
    })
  }

  const handleAssign = (topic: string): void => {
    const skillId = suggestedByTopic.get(topic) ?? ''
    if (skillId === '') return
    void run(actionKey('assign', topic), () => onAssign(topic, skillId), {
      ok: t('expAssignedOk').replace('{topic}', topic),
      fail: t('expAssignedFail'),
    })
  }

  const handleRemove = (topic: string): void => {
    void run(actionKey('remove', topic), () => onRemove(topic), {
      ok: t('expRemovedOk'),
      fail: t('expRemovedFail'),
    })
  }

  const handleMemoryAction = (id: number, confirm: boolean): void => {
    void run(actionKey('memory', id), () => onMemoryAction(id, confirm), {
      ok: confirm ? t('memConfirmedOk') : t('memRemovedOk'),
      fail: t('memActionFail'),
    })
  }

  const pendingCount = overview?.pendingPracticeCount ?? practices.filter(item => item.status === 'pending').length

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
                  {/* 主数字：阅历总量；明细降为灰字一行，与技能卡片墙同一套语言 */}
                  <div className={css.statusStats}>
                    <span className={css.statusHero}>
                      <b>{entry.memoryCount + entry.sceneCount + entry.knowledgeCount + entry.practiceCount}</b>
                      {' '}
                      {t('wallTotal')}
                    </span>
                    <span className={css.statusLine}>
                      {t('wallMemories')} {entry.memoryCount}
                      {' · '}
                      {t('wallScenes')} {entry.sceneCount}
                      {' · '}
                      {t('wallKnowledge')} {entry.knowledgeCount}
                      {' · '}
                      {t('wallPractice')} {entry.practiceCount}
                    </span>
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
                    disabled={busy !== undefined}
                    onClick={() => { handleMemoryAction(item.id, true) }}
                  >
                    {busy === actionKey('memory', item.id) ? t('pending') : t('memConfirm')}
                  </button>
                  <button
                    type="button"
                    className={css.ghost}
                    disabled={busy !== undefined}
                    onClick={() => { handleMemoryAction(item.id, false) }}
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
          <button
            type="button"
            className={css.ghost}
            disabled={refreshing}
            onClick={() => { void refresh(onRefresh) }}
          >
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
              const suggested = skillsById.get(suggestedByTopic.get(item.topic) ?? '')
              return (
                <li key={item.topic} className={css.timelineCard}>
                  <div className={css.timelineHead}>
                    <span className={css.timelineTopic}>{item.topic}</span>
                    <span className={css.timelineMeta}>
                      <span className={css.metaText}>{sourceLabel(t, item.source)}</span>
                      <span className={css.metaText}>{statusLabel(t, item.status)}</span>
                    </span>
                  </div>
                  <p className={css.timelineBody}>{item.content}</p>
                  <div className={css.timelineMeta}>
                    <span className={css.timelineDate}>{item.updatedAt.slice(0, 10)}</span>
                    {/* 待审是唯一需要用户行动的信号，因此是卡上唯一保留色块的标签 */}
                    {item.needsReview && (
                      <span className={css.reviewBadge}>{t('expNeedsReview')}</span>
                    )}
                    {suggested !== undefined && (
                      <span className={css.metaText}>{t('expSuggest').replace('{title}', suggested.title)}</span>
                    )}
                  </div>
                  <div className={css.timelineActions}>
                    {item.needsReview && (
                      <button
                        type="button"
                        className={css.primary}
                        disabled={busy !== undefined}
                        onClick={() => { handleConfirm(item.topic) }}
                      >
                        {busy === actionKey('confirm', item.topic) ? t('pending') : t('expConfirm')}
                      </button>
                    )}
                    {!item.needsReview && item.status !== 'assigned' && (
                      <button
                        type="button"
                        className={css.primary}
                        disabled={(suggestedByTopic.get(item.topic) ?? '') === '' || busy !== undefined}
                        onClick={() => { handleAssign(item.topic) }}
                      >
                        {busy === actionKey('assign', item.topic) ? t('pending') : t('expAssign')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={css.ghost}
                      disabled={busy !== undefined}
                      onClick={() => { handleRemove(item.topic) }}
                    >
                      {busy === actionKey('remove', item.topic) ? t('pending') : t('expRemove')}
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
