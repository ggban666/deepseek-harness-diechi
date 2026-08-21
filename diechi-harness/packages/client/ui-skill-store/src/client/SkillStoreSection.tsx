/**
 * Skill 设置 settings section: the persona switches (checked skills become
 * the active conversation persona). Vision configuration and recognition
 * live in the separate 视觉 settings section; installed-skill management
 * (retrain, export, version history, remove) lives in the skill-center
 * workshop, not here.
 */
import { useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillManifestEntry } from './skill-format.ts'
import { kindLabel, sourceLabel, statusLabel } from './skill-display.ts'
import css from './SkillStoreSection.module.css'

/** One catalog snapshot the section renders. */
export interface SkillStoreState {
  /** Installed skills in store order. */
  readonly skills: readonly SkillManifestEntry[]
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
}

/** Registration-side business face for the section. */
export interface SkillStoreSectionInjected {
  hooks: {
    /** Catalog snapshot bound as useStore. */
    store: HostObservable<SkillStoreState>
  }
  /** Persist the checked set of enabled (persona) skills. */
  saveEnabled(updates: readonly { readonly id: string; readonly enabled: boolean }[]): Promise<void>
}

/** Props the renderer binds for the section. */
export type SkillStoreSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skill-store'>
  & InjectFace<SkillStoreSectionInjected>

type Notice = { readonly kind: 'ok' | 'error' | 'info'; readonly text: string }

/** Render one Skill 设置 page over the injected catalog and persona actions. */
export function SkillStoreSection({
  t, useStore, saveEnabled,
}: SkillStoreSectionProps) {
  const store = useStore(value => value)
  const [notice, setNotice] = useState<Notice>()
  const [enabledDraft, setEnabledDraft] = useState<Record<string, boolean>>()

  const writable = store.writable
  const skills = store.skills
  const dirty = enabledDraft !== undefined
  const enabledOf = (id: string, fallback: boolean): boolean => {
    const draftValue = enabledDraft?.[id]
    return draftValue === undefined ? fallback : draftValue
  }

  const persistEnabled = async (): Promise<void> => {
    if (enabledDraft === undefined) return
    const updates = Object.entries(enabledDraft).map(([id, enabled]) => ({ id, enabled }))
    setEnabledDraft(undefined)
    try {
      await saveEnabled(updates)
      setNotice({ kind: 'ok', text: t('saveOk') })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    }
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>

      <h3 className={css.listTitle}>{t('installed')}</h3>
      {skills.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <ul className={css.list}>
          {skills.map((skill) => {
            const pending = skill.content.trim() === ''
            return (
              <li key={skill.id} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowTitle}>
                    <span className={css.name}>{skill.title}</span>
                    <code className={css.command}>/{skill.id}</code>
                    <span className={css.kindBadge}>{kindLabel(skill.kind, t)}</span>
                    <span className={css.sourceBadge}>{sourceLabel(skill.source, t)}</span>
                    <span className={css.statusBadge}>{statusLabel(skill.status, t)}</span>
                    {pending && <span className={css.pendingBadge}>{t('pending')}</span>}
                  </div>
                </div>
                <label className={css.persona}>
                  <input
                    type="checkbox"
                    className={css.checkbox}
                    checked={enabledOf(skill.id, skill.enabled)}
                    disabled={!writable || pending}
                    onChange={(event) => {
                      setEnabledDraft({ ...(enabledDraft ?? {}), [skill.id]: event.target.checked })
                    }}
                  />
                  <span>{t('personaToggle')}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <div className={css.personaBar}>
        <p className={css.hint}>{t('personaHint')}</p>
        <div className={css.actions}>
          {dirty && <span className={css.dirtyBadge}>{t('unsaved')}</span>}
          <button
            type="button"
            className={css.primary}
            disabled={!writable || !dirty}
            onClick={() => { void persistEnabled() }}
          >
            {t('saveSettings')}
          </button>
        </div>
      </div>

      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : notice.kind === 'error' ? css.error : css.info} role="status">
          {notice.text}
        </p>
      )}
      {!writable && <p className={css.hint}>{t('readOnly')}</p>}
    </div>
  )
}
