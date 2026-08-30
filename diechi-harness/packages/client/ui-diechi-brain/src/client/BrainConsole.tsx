/**
 * 阅历控制台：全局大脑实操收件箱的可视化管理。
 * 列表卡片：展开正文、状态/监督者徽标、归位到技能、改标签、删除。
 *
 * 2026-08-30 整理（UI 与行为不变，只清结构）：
 * - 去掉 8 处 `String(t(...))`。`Translate` 的返回类型就是 `string`，
 *   这层转换是纯噪音，还会盖掉字典漏 key 这类本该报错的问题。
 * - 两张徽标查找表合并进统一的 `Badge` 组件，配色仍按语义分开。
 * - 卡片里重复的「busy + notice + try/catch」抽成 `useRowAction`。
 * - 修一个 StrictMode 下静默失效的坑：原先用 `first` ref 守卫整个 effect，
 *   开发模式下 effect 会跑两遍——第二遍直接 return，**轮询定时器不会重建**。
 *   改成守卫只管首次加载，定时器每次挂载都建。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { BrainPracticeItem } from './types.ts'
import type { BrainConsoleInjected, ConsoleSkillEntry } from './index.ts'
import css from './BrainConsole.module.css'

/** Props the renderer binds for the section. */
export type BrainConsoleProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'diechiBrain'>
  & InjectFace<BrainConsoleInjected>

type T = PropsLocale<'diechiBrain'>['t']

type Notice = { readonly kind: 'ok' | 'error'; readonly text: string }

// ---------------------------------------------------------------------------
// 徽标
// ---------------------------------------------------------------------------

/** 语义配色类；CSS module 取值可能是 undefined（noUncheckedIndexedAccess），故允许空。 */
function Badge({ tone, label, title }: {
  tone: string | undefined
  label: string
  title?: string
}) {
  return <span className={tone ?? ''} title={title}>{label}</span>
}

/** 业务状态 → 文案 key + 配色。 */
const STATUS_BADGE: Record<string, { key: 'statusPending' | 'statusAssigned' | 'statusArchived'; tone: string | undefined }> = {
  pending: { key: 'statusPending', tone: css.badgePending },
  assigned: { key: 'statusAssigned', tone: css.badgeAssigned },
  archived: { key: 'statusArchived', tone: css.badgeArchived },
}

/** 监督者决策 → 文案 key + 配色。仅非 allow 时显示。 */
const SUPERVISION_BADGE: Record<'flag-review' | 'deny', { key: 'supervisionFlagged' | 'supervisionDenied'; tone: string | undefined }> = {
  'flag-review': { key: 'supervisionFlagged', tone: css.badgeSupervisionFlagged },
  deny: { key: 'supervisionDenied', tone: css.badgeSupervisionDeny },
}

function StatusBadge({ item, t }: { item: BrainPracticeItem; t: T }) {
  const badge = STATUS_BADGE[item.status]
  if (badge === undefined) return <Badge tone={css.badgePending} label={item.status} />
  return <Badge tone={badge.tone} label={t(badge.key)} />
}

function SupervisionBadge({ item, t }: { item: BrainPracticeItem; t: T }) {
  if (item.supervisionDecision === 'allow') return null
  const badge = SUPERVISION_BADGE[item.supervisionDecision]
  return (
    <Badge tone={badge.tone} label={t(badge.key)} title={t('supervisionTooltip')} />
  )
}

// ---------------------------------------------------------------------------
// 异步动作：busy + 成功/失败提示
// ---------------------------------------------------------------------------

/** 把「置忙 → 跑动作 → 落提示 → 收忙」这套样板收在一处。 */
function useRowAction(t: T) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const run = useCallback(async (action: () => Promise<boolean>): Promise<void> => {
    setBusy(true)
    try {
      const ok = await action()
      setNotice({ kind: ok ? 'ok' : 'error', text: ok ? t('okAction') : t('errorAction') })
    } catch {
      setNotice({ kind: 'error', text: t('errorAction') })
    } finally {
      setBusy(false)
    }
  }, [t])
  return { busy, notice, run }
}

// ---------------------------------------------------------------------------
// 卡片
// ---------------------------------------------------------------------------

/** 一张收件箱卡片。 */
function PracticeCard({
  item, skills, writable, t, onAssign, onSetTags, onRemove,
}: {
  item: BrainPracticeItem
  skills: readonly ConsoleSkillEntry[]
  writable: boolean
  t: T
  // 函数型 prop 标 `this: void`：解构后与宿主对象解绑，标了才能满足 unbound-method。
  onAssign(this: void, topic: string, skillId: string): Promise<boolean>
  onSetTags(this: void, topic: string, tags: string): Promise<boolean>
  onRemove(this: void, topic: string): Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const [skillId, setSkillId] = useState(item.suggestedSkill || '')
  const [tags, setTags] = useState(item.tags)
  const { busy, notice, run } = useRowAction(t)
  const locked = !writable || busy

  return (
    <li className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardTitle}>
          <span className={css.topic}>{item.topic}</span>
          <StatusBadge item={item} t={t} />
          <SupervisionBadge item={item} t={t} />
          <span className={css.updated}>{item.updatedAt.slice(0, 16).replace('T', ' ')}</span>
        </div>
        <button type="button" className={css.ghost} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? t('collapse') : t('expand')}
        </button>
      </div>

      <div className={css.meta}>
        <span className={css.suggestion}>
          {item.suggestedSkill === ''
            ? t('suggestionNone')
            : `${t('suggestionPrefix')} ${item.suggestedSkill}`}
        </span>
        <span className={css.tagsText}>{item.tags || '—'}</span>
      </div>

      {expanded && <pre className={css.body}>{item.content}</pre>}

      <div className={css.actions}>
        <select
          className={css.select}
          value={skillId}
          disabled={locked}
          aria-label={t('assignTitle')}
          onChange={(event) => { setSkillId(event.target.value) }}
        >
          <option value="">{t('assignPlaceholder')}</option>
          {skills.map(skill => (
            <option key={skill.id} value={skill.id}>{skill.title}</option>
          ))}
        </select>
        <button
          type="button"
          className={css.primary}
          disabled={locked || skillId === ''}
          onClick={() => { void run(() => onAssign(item.topic, skillId)) }}
        >
          {t('assignButton')}
        </button>

        <input
          className={css.input}
          value={tags}
          disabled={locked}
          aria-label={t('tagsLabel')}
          onChange={(event) => { setTags(event.target.value) }}
        />
        <button
          type="button"
          className={css.secondary}
          disabled={locked || tags === item.tags}
          onClick={() => { void run(() => onSetTags(item.topic, tags)) }}
        >
          {t('tagsSave')}
        </button>

        <button
          type="button"
          className={css.danger}
          disabled={locked}
          onClick={() => {
            if (window.confirm(t('deleteConfirm'))) void run(() => onRemove(item.topic))
          }}
        >
          {t('deleteButton')}
        </button>
      </div>

      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

/** 渲染收件箱页面。 */
export function BrainConsole({
  t, useInbox, useSkills, useWritable, refresh, assign, setTags, remove,
}: BrainConsoleProps) {
  const inbox = useInbox(value => value)
  const skills = useSkills(value => value)
  const writable = useWritable(value => value)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>()

  /** 定时器里要拿最新的 refresh，但不想因为它而重建定时器，故用 ref 镜像。 */
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const doRefresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      await refreshRef.current()
      setNotice(undefined)
    } catch {
      setNotice({ kind: 'error', text: t('errorLoad') })
    } finally {
      setLoading(false)
    }
  }, [t])

  // 首次进入拉一次；页面可能长期驻留，所以再挂 15s 轮询。
  // 注意不要用一个 ref 去守卫整个 effect —— StrictMode 下 effect 会跑两遍，
  // 第二遍被守卫挡掉后定时器就不会重建，页面从此不再自动刷新。
  useEffect(() => {
    void doRefresh()
    const interval = window.setInterval(() => { void refreshRef.current().catch(() => {}) }, 15_000)
    return () => { window.clearInterval(interval) }
  }, [doRefresh])

  return (
    <div className={css.section}>
      <div className={css.headRow}>
        <div>
          <h2 className={css.heading}>{t('title')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <button type="button" className={css.secondary} onClick={() => { void doRefresh() }} disabled={loading}>
          {loading ? t('loading') : t('refresh')}
        </button>
      </div>

      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
      )}

      {inbox.length === 0
        ? <p className={css.empty}>{loading ? t('loading') : t('empty')}</p>
        : (
          <ul className={css.list}>
            {inbox.map(item => (
              <PracticeCard
                key={item.topic}
                item={item}
                skills={skills.skills}
                writable={writable}
                t={t}
                onAssign={assign}
                onSetTags={setTags}
                onRemove={remove}
              />
            ))}
          </ul>
        )}

      {!writable && <p className={css.hint}>{t('readOnly')}</p>}
    </div>
  )
}
