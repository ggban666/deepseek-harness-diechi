/**
 * 阅历控制台：全局大脑实操收件箱的可视化管理。
 * 列表卡片：展开正文、状态/建议徽标、归位到技能、改标签、删除。
 */
import { useEffect, useRef, useState } from 'react'
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

type Notice = { readonly kind: 'ok' | 'error'; readonly text: string }

const STATUS_LABEL: Record<string, (t: PropsLocale<'diechiBrain'>['t']) => string> = {
  pending: t => String(t('statusPending')),
  assigned: t => String(t('statusAssigned')),
  archived: t => String(t('statusArchived')),
}

/** 状态徽标。 */
function StatusBadge({ item, t }: { item: BrainPracticeItem; t: PropsLocale<'diechiBrain'>['t'] }) {
  const label = STATUS_LABEL[item.status] ?? (() => item.status)
  return (
    <span
      className={item.status === 'assigned' ? css.badgeAssigned : item.status === 'archived' ? css.badgeArchived : css.badgePending}
    >
      {label(t)}
    </span>
  )
}

/** 一张收件箱卡片。 */
function PracticeCard({
  item, skills, writable, t, onAssign, onSetTags, onRemove,
}: {
  item: BrainPracticeItem
  skills: readonly ConsoleSkillEntry[]
  writable: boolean
  t: PropsLocale<'diechiBrain'>['t']
  onAssign(topic: string, skillId: string): Promise<boolean>
  onSetTags(topic: string, tags: string): Promise<boolean>
  onRemove(topic: string): Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const [skillId, setSkillId] = useState(item.suggestedSkill || '')
  const [tags, setTags] = useState(item.tags)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const run = async (action: () => Promise<boolean>, okText: string): Promise<void> => {
    setBusy(true)
    try {
      const ok = await action()
      setNotice({ kind: ok ? 'ok' : 'error', text: ok ? okText : String(t('errorAction')) })
    } catch {
      setNotice({ kind: 'error', text: String(t('errorAction')) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardTitle}>
          <span className={css.topic}>{item.topic}</span>
          <StatusBadge item={item} t={t} />
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

      {expanded && (
        <pre className={css.body}>{item.content}</pre>
      )}

      <div className={css.actions}>
        <select
          className={css.select}
          value={skillId}
          disabled={!writable || busy}
          aria-label={String(t('assignTitle'))}
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
          disabled={!writable || busy || skillId === ''}
          onClick={() => { void run(() => onAssign(item.topic, skillId), String(t('okAction'))) }}
        >
          {t('assignButton')}
        </button>

        <input
          className={css.input}
          value={tags}
          disabled={!writable || busy}
          aria-label={String(t('tagsLabel'))}
          onChange={(event) => { setTags(event.target.value) }}
        />
        <button
          type="button"
          className={css.secondary}
          disabled={!writable || busy || tags === item.tags}
          onClick={() => { void run(() => onSetTags(item.topic, tags), String(t('okAction'))) }}
        >
          {t('tagsSave')}
        </button>

        <button
          type="button"
          className={css.danger}
          disabled={!writable || busy}
          onClick={() => {
            if (window.confirm(String(t('deleteConfirm')))) {
              void run(() => onRemove(item.topic), String(t('okAction')))
            }
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

/** 渲染收件箱页面。 */
export function BrainConsole({
  t, useInbox, useSkills, useWritable, refresh, assign, setTags, remove,
}: BrainConsoleProps) {
  const inbox = useInbox(value => value)
  const skills = useSkills(value => value)
  const writable = useWritable(value => value)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>()
  const first = useRef(true)

  useEffect(() => {
    if (!first.current) return
    first.current = false
    refresh()
      .then(() => { setLoading(false) })
      .catch(() => {
        setLoading(false)
        setNotice({ kind: 'error', text: String(t('errorLoad')) })
      })
    // 每次进入都刷新一次（页面可能长期驻留）。
    const interval = window.setInterval(() => { void refresh().catch(() => {}) }, 15_000)
    return () => { window.clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doRefresh = async (): Promise<void> => {
    setLoading(true)
    try {
      await refresh()
      setNotice(undefined)
    } catch {
      setNotice({ kind: 'error', text: String(t('errorLoad')) })
    } finally {
      setLoading(false)
    }
  }

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