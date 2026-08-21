/**
 * 平权技能中心 full-screen surface (shell.overlay): one page, two tabs — 商店
 * (the local market catalog) and 工坊 (installed-skill management plus
 * creation/import). Rendered as a frame-wide page while open; renders
 * nothing when closed, so the overlay layer stays click-through for the
 * rest of the app.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillStoreKey } from './locales.ts'
import type { SkillManifestEntry, SkillMarketSkill, TrainingState } from './skill-format.ts'
import type { SkillStoreState } from './SkillStoreSection.tsx'
import {
  dateLabel, exportSkillDocument, kindLabel, sourceLabel, statusLabel,
  type ImportResult, type RetrainResult, type SkillDraft,
} from './skill-display.ts'
import css from './SkillCenterOverlay.module.css'

/** One open surface of the skill center. */
export type SkillCenterView = 'closed' | 'market' | 'workshop'

/** Snapshot the center page renders. */
export interface SkillCenterState {
  /** Active surface; 'closed' renders nothing. */
  readonly view: SkillCenterView
  /** Skill id the workshop focuses (retrain target). */
  readonly focusId?: string
  /** Recognition draft that prefills the workshop create form. */
  readonly createDraft?: SkillDraft
}

/** Market catalog snapshot the store page renders. */
export interface MarketState {
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Absolute path of the scanned market directory. */
  readonly dir: string
  /** Discoverable skills in the local market. */
  readonly skills: readonly SkillMarketSkill[]
}

/** One create-skill request from the workshop form. */
export interface CreateSkillInput {
  /** Human-readable skill name. */
  readonly name: string
  /** When/why the skill is used. */
  readonly purpose: string
  /** Optional numbered steps the skill should follow. */
  readonly steps: string
  /** Optional rules and pitfalls to respect. */
  readonly rules: string
  /** Optional supporting material or reference links to feed in. */
  readonly references: string
}

/** One training-round kickoff: opens a conversation and activates the banner. */
export interface TrainingStartInput {
  /** Retrain targets an existing skill; create mints a new one. */
  readonly mode: 'retrain' | 'create'
  /** Retrain target id; absent for create mode. */
  readonly skillId?: string
  /** Human title shown in the training banner. */
  readonly skillTitle: string
  /** Initial requirement / description (optional in retrain mode). */
  readonly description: string
}

/** Registration-side business face shared by the hero cards and the overlay. */
export interface SkillCenterInjected {
  hooks: {
    /** Skill center open state. */
    center: HostObservable<SkillCenterState>
    /** Scanned local market catalog. */
    market: HostObservable<MarketState>
    /** Installed catalog (to mark installed market skills). */
    store: HostObservable<SkillStoreState>
    /** In-flight training session (训练模式). */
    training: HostObservable<TrainingState>
  }
  open(view: 'market' | 'workshop', focusId?: string, createDraft?: SkillDraft): void
  /** Close the center page. */
  close(): void
  /** Re-read the market catalog from the host. */
  refreshMarket(): Promise<void>
  /** Install one market skill into the installed catalog. */
  installMarket(id: string): Promise<ImportResult>
  /** Import one local skill file (workshop tab). */
  importSkill(file: File): Promise<ImportResult>
  /** Remove one installed skill by id (workshop tab). */
  removeSkill(id: string): Promise<void>
  /** Restore an older revision as the active body (workshop tab). */
  restoreRevision(id: string, version: string): Promise<void>
  /** Open the training conversation and activate the training banner. */
  startTraining(input: TrainingStartInput): Promise<RetrainResult>
  /** Ask the agent to finish the round and generate the new skill revision. */
  finishTraining(): Promise<RetrainResult>
  /** Abandon the round without generating (clears the banner). */
  cancelTraining(): void
}

/** Props the renderer binds for the overlay entry. */
export type SkillCenterOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'skill-store'>
  & InjectFace<SkillCenterInjected>

type Notice = { readonly kind: 'ok' | 'error' | 'info'; readonly text: string }

/** Render one store tab over the scanned market catalog. */
function MarketTab({
  t, market, installedIds, onRefresh, onInstall,
}: {
  t: (key: SkillStoreKey) => string
  market: MarketState
  installedIds: ReadonlySet<string>
  onRefresh: () => Promise<void>
  onInstall: (id: string) => Promise<ImportResult>
}) {
  const [busy, setBusy] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<Notice>()

  const handleInstall = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      const result = await onInstall(id)
      setNotice(result.ok
        ? { kind: 'ok', text: t('installOk').replace('{id}', id) }
        : { kind: 'error', text: `${t('installFailed')} ${result.error}` })
    } catch {
      setNotice({ kind: 'error', text: t('installFailed') })
    } finally {
      setBusy(undefined)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefresh()
      setNotice({ kind: 'ok', text: t('marketRefreshed') })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={css.tab}>
      <p className={css.intro}>{t('marketIntro')}</p>
      <div className={css.dirRow}>
        <span className={css.dirLabel}>{t('marketDir')}:</span>
        <code className={css.dir}>{market.dir !== '' ? market.dir : '\u2014'}</code>
        <button type="button" className={css.ghost} disabled={refreshing} onClick={() => void handleRefresh()}>
          {t('marketRefresh')}
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
                    disabled={busy === skill.id}
                    title={isInstalled ? t('reinstallHint') : undefined}
                    onClick={() => void handleInstall(skill.id)}
                  >
                    {busy === skill.id ? t('pending') : t('install')}
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

/** Render one installed-skill management row inside the workshop. */
function InstalledSkillRow({
  t, skill, writable, onExport, onRestore, onRemove, onStartTraining, onCopy, copiedId,
}: {
  t: (key: SkillStoreKey) => string
  skill: SkillManifestEntry
  writable: boolean
  onExport: (entry: SkillManifestEntry, format: 'md' | 'json', revision?: SkillManifestEntry['revisions'][number]) => void
  onRestore: (entry: SkillManifestEntry, version: string) => void
  onRemove: (entry: SkillManifestEntry) => void
  onStartTraining: (input: TrainingStartInput) => Promise<RetrainResult>
  onCopy: (id: string) => void
  copiedId: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [retraining, setRetraining] = useState(false)
  const [retrainText, setRetrainText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const pending = skill.content.trim() === ''
  const revisions = [...skill.revisions].reverse()

  const submitRetrain = async (): Promise<void> => {
    if (busy) return
    const text = retrainText.trim()
    setBusy(true)
    try {
      const result = await onStartTraining({
        mode: 'retrain',
        skillId: skill.id,
        skillTitle: skill.title,
        description: text,
      })
      if (result.ok) {
        setNotice({ kind: 'ok', text: t('trainingStarted') })
        setRetrainText('')
        setRetraining(false)
      } else if (result.error === 'no-session') {
        setNotice({ kind: 'error', text: t('retrainNoSession') })
      } else {
        setNotice({ kind: 'error', text: t('trainingStartFailed') })
      }
    } catch {
      setNotice({ kind: 'error', text: t('trainingStartFailed') })
    } finally {
      setBusy(false)
    }
  }

  const closeRetrain = (): void => {
    setRetraining(false)
    setRetrainText('')
    setNotice(undefined)
  }

  return (
    <li className={css.wsRow}>
      <div className={css.wsRowMain}>
        <div className={css.wsRowTitle}>
          <span className={css.wsName}>{skill.title}</span>
          <code className={css.wsCommand}>/{skill.id}</code>
          <span className={css.wsKindBadge}>{kindLabel(skill.kind, t)}</span>
          <span className={css.wsSourceBadge}>{sourceLabel(skill.source, t)}</span>
          <span className={css.wsStatusBadge}>{statusLabel(skill.status, t)}</span>
          {pending && <span className={css.wsPendingBadge}>{t('pending')}</span>}
        </div>
        {skill.description.trim() !== '' && <p className={css.wsDescription}>{skill.description}</p>}
        <p className={css.wsUseHint}>{t('useHint').replace('{id}', skill.id)}</p>
        <div className={css.wsActions}>
          <button type="button" className={css.ghost} onClick={() => onCopy(skill.id)}>
            {copiedId === skill.id ? t('copied') : t('copyCommand').replace('{id}', skill.id)}
          </button>
          <button type="button" className={css.ghost} onClick={() => onExport(skill, 'md')}>
            {t('exportMd')}
          </button>
          <button type="button" className={css.ghost} onClick={() => onExport(skill, 'json')}>
            {t('exportJson')}
          </button>
          <button type="button" className={css.ghost} onClick={() => setOpen(!open)}>
            {t('history')}
          </button>
          <button type="button" className={css.ghost} onClick={() => setRetraining(!retraining)}>
            {t('retrain')}
          </button>
          {writable && (
            <button type="button" className={css.ghost} onClick={() => onRemove(skill)}>
              {t('remove')}
            </button>
          )}
        </div>
      </div>
      {retraining && (
        <div className={css.wsRetrainPanel}>
          <p className={css.wsRetrainTitle}>{t('retrainTitle').replace('{title}', skill.title)}</p>
          <p className={css.hint}>{t('retrainHint')}</p>
          <textarea
            className={css.wsTextarea}
            rows={3}
            value={retrainText}
            placeholder={t('retrainPlaceholder')}
            disabled={busy}
            onChange={(event) => setRetrainText(event.target.value)}
          />
          <div className={css.wsActions}>
            <button
              type="button"
              className={css.primary}
              disabled={busy}
              onClick={() => { void submitRetrain() }}
            >
              {busy ? t('pending') : t('retrainGenerate')}
            </button>
            <button type="button" className={css.ghost} disabled={busy} onClick={closeRetrain}>
              {t('cancel')}
            </button>
          </div>
          {notice !== undefined && (
            <p className={notice.kind === 'ok' ? css.ok : notice.kind === 'error' ? css.error : css.info} role="status">
              {notice.text}
            </p>
          )}
        </div>
      )}
      {open && (
        <div className={css.wsHistoryPanel}>
          <p className={css.hint}>{t('historyHint')}</p>
          {revisions.length === 0 ? (
            <p className={css.empty}>{t('noHistory')}</p>
          ) : (
            <ul className={css.wsHistoryList}>
              {revisions.map((revision) => (
                <li key={revision.version} className={css.wsHistoryRow}>
                  <div className={css.wsHistoryMeta}>
                    <span className={css.wsVersionBadge}>{t('version')} {revision.version}</span>
                    <span className={css.wsHistoryDate}>{dateLabel(revision.updatedAt)}</span>
                    {revision.note !== '' && <span className={css.wsHistoryNote}>{revision.note}</span>}
                  </div>
                  <div className={css.wsActions}>
                    <button type="button" className={css.ghost} onClick={() => onExport(skill, 'md', revision)}>
                      {t('exportMd')}
                    </button>
                    <button type="button" className={css.ghost} onClick={() => onExport(skill, 'json', revision)}>
                      {t('exportJson')}
                    </button>
                    {writable && (
                      <button type="button" className={css.ghost} onClick={() => onRestore(skill, revision.version)}>
                        {t('restore')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** Render one workshop tab over the installed catalog and creation entries. */
function WorkshopTab({
  t, store, createDraft, onDraftConsumed, onImport, onCopy, onRemove, onRestore, onStartTraining,
}: {
  t: (key: SkillStoreKey) => string
  store: SkillStoreState
  /** Recognition draft that prefills the create form, if any. */
  createDraft?: SkillDraft
  /** Tells the host the draft has been consumed (clears the prefill). */
  onDraftConsumed: () => void
  onImport: (file: File) => Promise<ImportResult>
  onCopy: (text: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onRestore: (id: string, version: string) => Promise<void>
  onStartTraining: (input: TrainingStartInput) => Promise<RetrainResult>
}) {
  const fileInputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<Notice>()
  const [copiedId, setCopiedId] = useState<string>()
  const [createName, setCreateName] = useState('')
  const [createPurpose, setCreatePurpose] = useState('')
  const [createSteps, setCreateSteps] = useState('')
  const [createRules, setCreateRules] = useState('')
  const [createReferences, setCreateReferences] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createNotice, setCreateNotice] = useState<Notice>()

  // Prefill the create form from a recognition draft (Settings → 一键带到工坊).
  useEffect(() => {
    if (createDraft === undefined) return
    setCreateName(createDraft.name)
    setCreatePurpose(createDraft.purpose)
    setCreateSteps(createDraft.steps)
    setCreateRules(createDraft.rules)
    onDraftConsumed()
  }, [createDraft, onDraftConsumed])

  const report = (kind: Notice['kind'], text: string): void => { setNotice({ kind, text }) }

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    try {
      const result = await onImport(file)
      if (result.ok) report('ok', t('importOk').replace('{count}', String(result.count)))
      else report('error', `${t('importFailed')} ${result.error}`)
    } catch {
      report('error', t('parseFailed'))
    }
    if (fileInput.current !== null) fileInput.current.value = ''
  }

  const handleCopy = async (id: string): Promise<void> => {
    try {
      await onCopy(`/${id}`)
      setCopiedId(id)
    } catch {
      report('error', t('copyCommand'))
    }
  }

  const handleExport = (
    entry: SkillManifestEntry,
    format: 'md' | 'json',
    revision?: SkillManifestEntry['revisions'][number],
  ): void => {
    const stem = exportSkillDocument(entry, format, revision)
    report('ok', t('exported').replace('{name}', stem))
  }

  const handleRestore = async (entry: SkillManifestEntry, version: string): Promise<void> => {
    try {
      await onRestore(entry.id, version)
      report('ok', t('restored').replace('{version}', version))
    } catch {
      report('error', t('restoreFailed'))
    }
  }

  const handleRemove = async (entry: SkillManifestEntry): Promise<void> => {
    try {
      await onRemove(entry.id)
    } catch {
      report('error', t('removeFailed'))
    }
  }

  const submitCreate = async (): Promise<void> => {
    if (createBusy || createName.trim() === '' || createPurpose.trim() === '') return
    setCreateBusy(true)
    try {
      const references = createReferences.trim()
      const result = await onStartTraining({
        mode: 'create',
        skillTitle: createName.trim(),
        description: [
          createPurpose.trim(),
          ...(createSteps.trim() === '' ? [] : [t('createPromptSteps').replace('{text}', createSteps.trim())]),
          ...(createRules.trim() === '' ? [] : [t('createPromptRules').replace('{text}', createRules.trim())]),
          ...(references === '' ? [] : [t('createPromptReferences').replace('{text}', references)]),
        ].join('\n'),
      })
      if (result.ok) {
        setCreateNotice({ kind: 'ok', text: t('trainingStarted') })
        setCreateName('')
        setCreatePurpose('')
        setCreateSteps('')
        setCreateRules('')
        setCreateReferences('')
      } else if (result.error === 'no-session') {
        setCreateNotice({ kind: 'error', text: t('retrainNoSession') })
      } else {
        setCreateNotice({ kind: 'error', text: t('createFailed') })
      }
    } catch {
      setCreateNotice({ kind: 'error', text: t('createFailed') })
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className={css.tab}>
      <p className={css.intro}>{t('workshopIntro')}</p>
      <section className={css.workshopCard}>
        <h3 className={css.workshopTitle}>{t('installed')}</h3>
        <p className={css.hint}>{t('workshopInstalledHint')}</p>
        {store.skills.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
          <ul className={css.wsList}>
            {store.skills.map(skill => (
              <InstalledSkillRow
                key={skill.id}
                t={t}
                skill={skill}
                writable={store.writable}
                copiedId={copiedId}
                onCopy={(id) => { void handleCopy(id) }}
                onExport={handleExport}
                onRestore={(entry, version) => { void handleRestore(entry, version) }}
                onRemove={(entry) => { void handleRemove(entry) }}
                onStartTraining={(input) => onStartTraining(input)}
              />
            ))}
          </ul>
        )}
      </section>
      <section className={css.workshopCard}>
        <h3 className={css.workshopTitle}>{t('createTitle')}</h3>
        <p className={css.hint}>{t('createHint')}</p>
        <label className={css.wsField}>
          <span className={css.wsFieldLabel}>{t('createName')}</span>
          <input
            type="text"
            className={css.wsInput}
            value={createName}
            placeholder={t('createNamePlaceholder')}
            disabled={createBusy}
            onChange={(event) => setCreateName(event.target.value)}
          />
        </label>
        <label className={css.wsField}>
          <span className={css.wsFieldLabel}>{t('createPurpose')}</span>
          <textarea
            className={css.wsTextarea}
            rows={2}
            value={createPurpose}
            placeholder={t('createPurposePlaceholder')}
            disabled={createBusy}
            onChange={(event) => setCreatePurpose(event.target.value)}
          />
        </label>
        <label className={css.wsField}>
          <span className={css.wsFieldLabel}>{t('createSteps')}</span>
          <textarea
            className={css.wsTextarea}
            rows={3}
            value={createSteps}
            placeholder={t('createStepsPlaceholder')}
            disabled={createBusy}
            onChange={(event) => setCreateSteps(event.target.value)}
          />
        </label>
        <label className={css.wsField}>
          <span className={css.wsFieldLabel}>{t('createRules')}</span>
          <textarea
            className={css.wsTextarea}
            rows={2}
            value={createRules}
            placeholder={t('createRulesPlaceholder')}
            disabled={createBusy}
            onChange={(event) => setCreateRules(event.target.value)}
          />
        </label>
        <label className={css.wsField}>
          <span className={css.wsFieldLabel}>{t('createReferences')}</span>
          <textarea
            className={css.wsTextarea}
            rows={3}
            value={createReferences}
            placeholder={t('createReferencesPlaceholder')}
            disabled={createBusy}
            onChange={(event) => setCreateReferences(event.target.value)}
          />
        </label>
        <div className={css.wsActions}>
          <button
            type="button"
            className={css.primary}
            disabled={createBusy || createName.trim() === '' || createPurpose.trim() === ''}
            onClick={() => { void submitCreate() }}
          >
            {createBusy ? t('pending') : t('createGenerate')}
          </button>
        </div>
        {createNotice !== undefined && (
          <p className={createNotice.kind === 'ok' ? css.ok : createNotice.kind === 'error' ? css.error : css.info} role="status">
            {createNotice.text}
          </p>
        )}
      </section>
      <section className={css.workshopCard}>
        <h3 className={css.workshopTitle}>{t('workshopImportTitle')}</h3>
        <p className={css.hint}>{t('workshopImportHint')}</p>
        <input
          ref={fileInput}
          id={fileInputId}
          type="file"
          accept=".md,.json"
          hidden
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <button type="button" className={css.ghost} onClick={() => fileInput.current?.click()}>
          {t('importLabel')}
        </button>
      </section>
      <section className={css.workshopCard}>
        <h3 className={css.workshopTitle}>{t('workshopVisionTitle')}</h3>
        <p className={css.hint}>{t('workshopVisionHint')}</p>
        <p className={css.reserved}>{t('workshopVisionReserved')}</p>
      </section>
      <p className={css.footnote}>{t('workshopSettingsHint')}</p>
      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : notice.kind === 'error' ? css.error : css.info} role="status">
          {notice.text}
        </p>
      )}
    </div>
  )
}

/** Render the skill-center full-screen page. */
export function SkillCenterOverlay({
  t, useCenter, useMarket, useStore, useTraining, open, close, refreshMarket, installMarket, importSkill,
  removeSkill, restoreRevision, startTraining, finishTraining, cancelTraining,
}: SkillCenterOverlayProps) {
  const center = useCenter(value => value)
  const market = useMarket(value => value)
  const store = useStore(value => value)
  const training = useTraining(value => value)
  const [finishing, setFinishing] = useState(false)
  const [trainingNotice, setTrainingNotice] = useState<Notice>()
  if (center.view === 'closed') return null

  const handleFinishTraining = async (): Promise<void> => {
    if (finishing) return
    setFinishing(true)
    try {
      const result = await finishTraining()
      setTrainingNotice(result.ok
        ? { kind: 'ok', text: t('trainingFinishSent') }
        : { kind: 'error', text: result.error === 'no-session' ? t('retrainNoSession') : t('trainingFinishFailed') })
    } catch {
      setTrainingNotice({ kind: 'error', text: t('trainingFinishFailed') })
    } finally {
      setFinishing(false)
    }
  }

  const installedIds = new Set(store.skills.map(skill => skill.id))
  const copyToClipboard = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
  }

  return (
    <div className={css.root} role="dialog" aria-modal="true" aria-label={t('centerTitle')}>
      <div className={css.backdrop} onClick={close} />
      <div className={css.panel}>
        <header className={css.header}>
          <img className={css.brand} src="/butterfly-icon.png" alt="" />
          <span className={css.title}>{t('centerTitle')}</span>
          <nav className={css.tabs}>
            <button
              type="button"
              className={center.view === 'market' ? css.tabActive : css.tab}
              onClick={() => open('market')}
            >
              {t('tabMarket')}
            </button>
            <button
              type="button"
              className={center.view === 'workshop' ? css.tabActive : css.tab}
              onClick={() => open('workshop')}
            >
              {t('tabWorkshop')}
            </button>
          </nav>
          <button type="button" className={css.close} onClick={close} aria-label={t('close')}>
            ✕
          </button>
        </header>
        {training.active && (
          <div className={css.trainingBanner} role="status">
            <span className={css.trainingBannerText}>
              {training.mode === 'retrain'
                ? t('trainingBannerRetrain').replace('{title}', training.skillTitle)
                : t('trainingBannerCreate').replace('{title}', training.skillTitle)}
            </span>
            <span className={css.trainingBannerHint}>{t('trainingBannerHint')}</span>
            <button
              type="button"
              className={css.primary}
              disabled={finishing}
              onClick={() => { void handleFinishTraining() }}
            >
              {finishing ? t('pending') : t('trainingFinish')}
            </button>
            <button type="button" className={css.ghost} disabled={finishing} onClick={cancelTraining}>
              {t('cancel')}
            </button>
            {trainingNotice !== undefined && (
              <span className={trainingNotice.kind === 'ok' ? css.ok : css.error}>{trainingNotice.text}</span>
            )}
          </div>
        )}
        <div className={css.body}>
          {center.view === 'market'
            ? (
              <MarketTab
                t={t}
                market={market}
                installedIds={installedIds}
                onRefresh={refreshMarket}
                onInstall={installMarket}
              />
            )
            : (
              <WorkshopTab
                t={t}
                store={store}
                {...(center.createDraft === undefined ? {} : { createDraft: center.createDraft })}
                onDraftConsumed={() => open('workshop')}
                onImport={importSkill}
                onCopy={copyToClipboard}
                onRemove={removeSkill}
                onRestore={restoreRevision}
                onStartTraining={startTraining}
              />
            )}
        </div>
      </div>
    </div>
  )
}