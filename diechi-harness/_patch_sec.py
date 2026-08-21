# -*- coding: utf-8 -*-
import io

path = r"packages\client\ui-skill-store\src\client\SkillStoreSection.tsx"
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read()

def sub(old, new, count=1):
    global text
    n = text.count(old)
    if n < count:
        raise SystemExit("NOT FOUND (%d): %r" % (n, old[:100]))
    text = text.replace(old, new, count)

# A) injected face: saveEnabled action
sub("""  /** Remove one installed skill by id. */
  removeSkill(id: string): Promise<void>
  /** Persist a vision configuration patch. */""",
    """  /** Remove one installed skill by id. */
  removeSkill(id: string): Promise<void>
  /** Persist the checked set of enabled (persona) skills. */
  saveEnabled(updates: readonly { readonly id: string; readonly enabled: boolean }[]): Promise<void>
  /** Persist a vision configuration patch. */""")

# B) kind badge helper after sourceLabel
sub("""/** Source badge copy per manifest source. */
function sourceLabel(source: SkillManifestEntry['source'], t: (key: SkillStoreKey) => string): string {
  switch (source) {
    case 'builtin': return t('builtin')
    case 'generated': return t('generated')
    default: return t('imported')
  }
}""",
    """/** Source badge copy per manifest source. */
function sourceLabel(source: SkillManifestEntry['source'], t: (key: SkillStoreKey) => string): string {
  switch (source) {
    case 'builtin': return t('builtin')
    case 'generated': return t('generated')
    default: return t('imported')
  }
}

/** Kind badge copy per manifest kind. */
function kindLabel(kind: SkillManifestEntry['kind'], t: (key: SkillStoreKey) => string): string {
  return kind === 'vision' ? t('kindVision') : t('kindText')
}""")

# C) props destructure
sub("""  t, useStore, useVision, importSkill, removeSkill, setVision, runRecognition,
}: SkillStoreSectionProps) {""",
    """  t, useStore, useVision, importSkill, removeSkill, saveEnabled, setVision, runRecognition,
}: SkillStoreSectionProps) {""")

# D) draft state + helpers
sub("""  const [visionDraft, setVisionDraft] = useState<VisionState>()

  const writable = store.writable
  const skills = store.skills
  const draft = visionDraft ?? vision""",
    """  const [visionDraft, setVisionDraft] = useState<VisionState>()
  const [enabledDraft, setEnabledDraft] = useState<Record<string, boolean>>()

  const writable = store.writable
  const skills = store.skills
  const draft = visionDraft ?? vision
  const dirty = enabledDraft !== undefined
  const enabledOf = (id: string, fallback: boolean): boolean => {
    const draftValue = enabledDraft?.[id]
    return draftValue === undefined ? fallback : draftValue
  }""")

# E) persistEnabled handler after persistVision
sub("""  const persistVision = async (): Promise<void> => {
    if (visionDraft === undefined) return
    const next = visionDraft
    setVisionDraft(undefined)
    try {
      await setVision(next)
    } catch {
      report('error', t('removeFailed'))
    }
  }""",
    """  const persistVision = async (): Promise<void> => {
    if (visionDraft === undefined) return
    const next = visionDraft
    setVisionDraft(undefined)
    try {
      await setVision(next)
    } catch {
      report('error', t('removeFailed'))
    }
  }

  const persistEnabled = async (): Promise<void> => {
    if (enabledDraft === undefined) return
    const updates = Object.entries(enabledDraft).map(([id, enabled]) => ({ id, enabled }))
    setEnabledDraft(undefined)
    try {
      await saveEnabled(updates)
      report('ok', t('saveOk'))
    } catch {
      report('error', t('saveFailed'))
    }
  }""")

# F) row title: kind badge
sub("""                    <code className={css.command}>/{skill.id}</code>
                    <span className={css.sourceBadge}>{sourceLabel(skill.source, t)}</span>
                    {pending && <span className={css.pendingBadge}>{t('pending')}</span>}""",
    """                    <code className={css.command}>/{skill.id}</code>
                    <span className={css.kindBadge}>{kindLabel(skill.kind, t)}</span>
                    <span className={css.sourceBadge}>{sourceLabel(skill.source, t)}</span>
                    {pending && <span className={css.pendingBadge}>{t('pending')}</span>}""")

# G) row actions: persona checkbox before copy button
sub("""                <div className={css.rowActions}>
                  <button
                    type="button"
                    className={css.ghost}
                    onClick={() => { void onCopy(skill.id) }}""",
    """                <div className={css.rowActions}>
                  <label className={css.persona}>
                    <input
                      type="checkbox"
                      className={css.checkbox}
                      checked={enabledOf(skill.id, skill.enabled)}
                      disabled={!writable}
                      onChange={(event) => {
                        setEnabledDraft({ ...(enabledDraft ?? {}), [skill.id]: event.target.checked })
                      }}
                    />
                    <span>{t('personaToggle')}</span>
                  </label>
                  <button
                    type="button"
                    className={css.ghost}
                    onClick={() => { void onCopy(skill.id) }}""")

# H) list tail: persona save bar
sub("""        <ul className={css.list}>
          {skills.map((skill) => {""",
    """        <ul className={css.list}>
          {skills.map((skill) => {""")
# (fragment wrapper) first close the ul part: replace the closing of the conditional
sub("""          })}
        </ul>
      )}

      {notice !== undefined && (""",
    """          })}
        </ul>
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
      )}

      {notice !== undefined && (""")

with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("SkillStoreSection.tsx updated OK")
