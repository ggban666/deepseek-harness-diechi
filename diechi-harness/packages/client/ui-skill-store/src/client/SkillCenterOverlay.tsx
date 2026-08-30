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
import type { SkillManifestEntry, TrainingState } from './skill-format.ts'
import type { BrainPendingMemory, BrainPracticeItem, SkillOverviewSnapshot, BrainGraphSnapshot } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreState } from './SkillStoreSection.tsx'
import {
  dateLabel, exportSkillDocument, kindLabel, sourceLabel, statusLabel,
  type ImportResult, type RetrainResult, type SkillDraft,
} from './skill-display.ts'
import { SkillCardWall } from './SkillCardWall.tsx'
import { ExperiencesWall } from './ExperiencesWall.tsx'
import { KnowledgeGraph } from './KnowledgeGraph.tsx'
import { MarketTab, type MarketState } from './MarketTab.tsx'
import { useAction } from './use-action.ts'
import css from './SkillCenterOverlay.module.css'

/** 市场页状态随 MarketTab 组件住在 MarketTab.tsx；这里 re-export 保住既有导入路径。 */
export type { MarketState }

/** One open surface of the skill center. */
export type SkillCenterView = 'closed' | 'skills' | 'experiences' | 'market' | 'workshop' | 'graph'

/** Snapshot the center page renders. */
export interface SkillCenterState {
  /** Active surface; 'closed' renders nothing. */
  readonly view: SkillCenterView
  /** 侧边工坊面板是否展开（工坊已从全屏页移到侧边栏）。 */
  readonly workshopOpen?: boolean
  /** Skill id the workshop focuses (retrain target). */
  readonly focusId?: string
  /** Recognition draft that prefills the workshop create form. */
  readonly createDraft?: SkillDraft
  /** 当前知识图谱视图对应的 skillId；空串表示全局图谱。 */
  readonly graphSkillId?: string
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
    /** 技能库现状（每技能记忆/知识/实操条数 + 最近活动时间）。 */
    overview: HostObservable<SkillOverviewSnapshot | undefined>
    /** 实操阅历收件箱（#实操 相册流）。 */
    practices: HostObservable<readonly BrainPracticeItem[]>
    /** 知识图谱快照（graph 视图用）。 */
    graphData: HostObservable<BrainGraphSnapshot>
    /** 待确认记忆（自动除幻觉标记，需用户核对）。 */
    pendingMemories: HostObservable<readonly BrainPendingMemory[]>
  }
  open(view: SkillCenterView, focusId?: string, createDraft?: SkillDraft): void
  /** Close the center page. */
  close(): void
  /** 展开/收起侧边工坊面板（工坊现在住在侧边栏）。 */
  toggleWorkshop(): void
  /** 用草稿打开工坊创建表单（阅历新主题一键建技能）。 */
  openCreateDraft(draft: SkillDraft): void
  /** 清空工坊创建草稿（识别预填用完一次即清）。 */
  clearWorkshopDraft(): void
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
  /** 一句话生成：直接在当前对话生成技能草稿，不进训练模式。 */
  createSkill(input: CreateSkillInput): Promise<RetrainResult>
  /** Open the training conversation and activate the training banner. */
  startTraining(input: TrainingStartInput): Promise<RetrainResult>
  /** Ask the agent to finish the round and generate the new skill revision. */
  finishTraining(): Promise<RetrainResult>
  /** Abandon the round without generating (clears the banner). */
  cancelTraining(): void
  /** 持久化勾选（=换人，结构级热重载）。 */
  saveEnabled(updates: readonly { readonly id: string; readonly enabled: boolean }[]): Promise<void>
  /** 刷新技能库现状快照（overview RPC）。 */
  refreshOverview(): Promise<void>
  /** 刷新实操阅历收件箱。 */
  refreshExperiences(): Promise<void>
  /** 一键归位：把实操写入指定技能的大脑。 */
  assignPractice(topic: string, skillId: string): Promise<boolean>
  /** 删除一条实操阅历。 */
  removePractice(topic: string): Promise<boolean>
  /** 确认一条待核对知识（低置信度归纳）：内容无误，可参与归位与注入。 */
  confirmPractice(topic: string): Promise<boolean>
  /** 刷新待确认记忆列表（自动除幻觉标记）。 */
  refreshPendingMemories(): Promise<void>
  /** 处置待确认记忆：confirm=true 解除标记（参与注入）；false 删除。 */
  memoryAction(id: number, confirm: boolean): Promise<boolean>
  /** 打开知识图谱视图（阅历页点技能卡触发；空串为全局图谱）。 */
  openGraph(skillId: string): void
  /** 关闭知识图谱视图。 */
  closeGraph(): void
}

/** Props the renderer binds for the overlay entry. */
export type SkillCenterOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'skill-store'>
  & InjectFace<SkillCenterInjected>

type Notice = { readonly kind: 'ok' | 'error'; readonly text: string }

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
  const { notice, setNotice, run, isBusy } = useAction()
  const pending = skill.content.trim() === ''
  const revisions = [...skill.revisions].reverse()

  const submitRetrain = (): void => {
    void run('retrain', async () => {
      const result = await onStartTraining({
        mode: 'retrain',
        skillId: skill.id,
        skillTitle: skill.title,
        description: retrainText.trim(),
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
    }, { fail: t('trainingStartFailed') })
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
            disabled={isBusy('retrain')}
            onChange={(event) => setRetrainText(event.target.value)}
          />
          <div className={css.wsActions}>
            <button
              type="button"
              className={css.primary}
              disabled={isBusy('retrain')}
              onClick={() => { submitRetrain() }}
            >
              {isBusy('retrain') ? t('pending') : t('retrainGenerate')}
            </button>
            <button type="button" className={css.ghost} disabled={isBusy('retrain')} onClick={closeRetrain}>
              {t('cancel')}
            </button>
          </div>
          {notice !== undefined && (
            <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">
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

/** Workshop tab props, shared by the sidebar panel and the settings shortcut. */
export interface WorkshopTabProps {
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
  onCreateSkill: (input: CreateSkillInput) => Promise<RetrainResult>
  onStartTraining: (input: TrainingStartInput) => Promise<RetrainResult>
}

/** Render one workshop tab over the installed catalog and creation entries. */
export function WorkshopTab({
  t, store, createDraft, onDraftConsumed, onImport, onCopy, onRemove, onRestore, onCreateSkill, onStartTraining,
}: WorkshopTabProps) {
  const fileInputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<Notice>()
  const [copiedId, setCopiedId] = useState<string>()
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createSteps, setCreateSteps] = useState('')
  const [createRules, setCreateRules] = useState('')
  const [createReferences, setCreateReferences] = useState('')
  const [installedOpen, setInstalledOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const { busy: createBusy, notice: createNotice, setNotice: setCreateNotice, run: runCreate } = useAction()

  // Prefill the create form from a recognition draft (Settings → 一键带到工坊).
  useEffect(() => {
    if (createDraft === undefined) return
    setCreateName(createDraft.name)
    setCreateDescription(createDraft.purpose)
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

  const submitCreate = (): void => {
    if (createDescription.trim() === '') return
    void runCreate('create', async () => {
      const result = await onCreateSkill({
        name: createName.trim(),
        purpose: createDescription.trim(),
        steps: createSteps.trim(),
        rules: createRules.trim(),
        references: createReferences.trim(),
      })
      if (result.ok) {
        setCreateNotice({ kind: 'ok', text: t('createSent') })
        setCreateName('')
        setCreateDescription('')
        setCreateSteps('')
        setCreateRules('')
        setCreateReferences('')
        setAdvancedOpen(false)
      } else if (result.error === 'no-session') {
        setCreateNotice({ kind: 'error', text: t('retrainNoSession') })
      } else {
        setCreateNotice({ kind: 'error', text: t('createFailed') })
      }
    }, { fail: t('createFailed') })
  }

  return (
    <div className={css.tab}>
      <p className={css.intro}>{t('workshopIntro')}</p>
      <section className={css.workshopCard}>
        <button
          type="button"
          className={css.wsHead}
          aria-expanded={installedOpen}
          onClick={() => setInstalledOpen((open) => !open)}
        >
          <span className={css.workshopTitle}>{t('installed')}</span>
          <span className={installedOpen ? css.wsChevronOpen : css.wsChevron} aria-hidden="true">▾</span>
        </button>
        {installedOpen && (
          <>
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
          </>
        )}
      </section>
      <section className={css.workshopCard}>
        <h3 className={css.workshopTitle}>{t('createTitle')}</h3>
        <p className={css.hint}>{t('createHint')}</p>
        <label className={css.wsField}>
          <span className={css.wsFieldLabel}>{t('createDescription')}</span>
          <textarea
            className={css.wsTextarea}
            rows={2}
            value={createDescription}
            placeholder={t('createDescriptionPlaceholder')}
            disabled={createBusy !== undefined}
            onChange={(event) => setCreateDescription(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={css.ghost}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? '▴' : '▾'} {t('createAdvanced')}
        </button>
        {advancedOpen && (
          <>
            <label className={css.wsField}>
              <span className={css.wsFieldLabel}>{t('createName')}</span>
              <input
                type="text"
                className={css.wsInput}
                value={createName}
                placeholder={t('createNamePlaceholder')}
                disabled={createBusy !== undefined}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <label className={css.wsField}>
              <span className={css.wsFieldLabel}>{t('createSteps')}</span>
              <textarea
                className={css.wsTextarea}
                rows={3}
                value={createSteps}
                placeholder={t('createStepsPlaceholder')}
                disabled={createBusy !== undefined}
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
                disabled={createBusy !== undefined}
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
                disabled={createBusy !== undefined}
                onChange={(event) => setCreateReferences(event.target.value)}
              />
            </label>
          </>
        )}
        <div className={css.wsActions}>
          <button
            type="button"
            className={css.primary}
            disabled={createBusy !== undefined || createDescription.trim() === ''}
            onClick={() => { submitCreate() }}
          >
            {createBusy !== undefined ? t('pending') : t('createGenerate')}
          </button>
        </div>
        {createNotice !== undefined && (
          <p className={createNotice.kind === 'ok' ? css.ok : css.error} role="status">
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
        <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">
          {notice.text}
        </p>
      )}
    </div>
  )
}

/** Render the skill-center full-screen page. */
export function SkillCenterOverlay({
  t, useCenter, useMarket, useStore, useTraining, useOverview, usePractices, useGraphData, usePendingMemories,
  open, close, toggleWorkshop, openCreateDraft, refreshMarket, installMarket, finishTraining,
  cancelTraining, saveEnabled, refreshOverview, refreshExperiences, assignPractice,
  removePractice, confirmPractice, refreshPendingMemories, memoryAction, openGraph, closeGraph,
}: SkillCenterOverlayProps) {
  const center = useCenter(value => value)
  const market = useMarket(value => value)
  const store = useStore(value => value)
  const training = useTraining(value => value)
  const overview = useOverview(value => value)
  const practices = usePractices(value => value)
  const graphData = useGraphData(value => value)
  const pendingMemories = usePendingMemories(value => value)
  const { busy: finishing, notice: trainingNotice, setNotice: setTrainingNotice, run: runFinish } = useAction()
  useEffect(() => {
    if (center.view === 'closed') return
    if (center.view === 'skills') void refreshOverview()
    if (center.view === 'experiences') {
      void refreshOverview()
      void refreshExperiences()
      void refreshPendingMemories()
    }
  }, [center.view])
  // 阅历视图打开期间自动轮询：对话归纳/视频实操落库后无需手动刷新即可看到。
  useEffect(() => {
    if (center.view !== 'experiences') return
    const timer = globalThis.setInterval(() => {
      void refreshOverview()
      void refreshExperiences()
      void refreshPendingMemories()
    }, 15_000)
    return () => globalThis.clearInterval(timer)
  }, [center.view, refreshOverview, refreshExperiences, refreshPendingMemories])
  if (center.view === 'closed') return null

  const handleFinishTraining = (): void => {
    void runFinish('finish', async () => {
      const result = await finishTraining()
      setTrainingNotice(result.ok
        ? { kind: 'ok', text: t('trainingFinishSent') }
        : { kind: 'error', text: result.error === 'no-session' ? t('retrainNoSession') : t('trainingFinishFailed') })
    }, { fail: t('trainingFinishFailed') })
  }

  const installedIds = new Set(store.skills.map(skill => skill.id))
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
              className={center.view === 'skills' ? css.tabActive : css.tab}
              onClick={() => open('skills')}
            >
              {t('wallTitle')}
            </button>
            <button
              type="button"
              className={center.view === 'experiences' ? css.tabActive : css.tab}
              onClick={() => open('experiences')}
            >
              {t('navExperiences')}
            </button>
            <button
              type="button"
              className={center.view === 'market' ? css.tabActive : css.tab}
              onClick={() => open('market')}
            >
              {t('tabMarket')}
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
              disabled={finishing !== undefined}
              onClick={() => { handleFinishTraining() }}
            >
              {finishing !== undefined ? t('pending') : t('trainingFinish')}
            </button>
            <button type="button" className={css.ghost} disabled={finishing !== undefined} onClick={cancelTraining}>
              {t('cancel')}
            </button>
            {trainingNotice !== undefined && (
              <span className={trainingNotice.kind === 'ok' ? css.ok : css.error}>{trainingNotice.text}</span>
            )}
          </div>
        )}
        <div className={css.body}>
          {center.view === 'skills' && (
            <SkillCardWall
              t={t}
              store={store}
              overview={overview}
              onToggle={async (id, enabled) => { await saveEnabled([{ id, enabled }]) }}
              onManage={() => { close(); toggleWorkshop() }}
              onMarket={() => open('market')}
            />
          )}
          {center.view === 'graph' && (
            <KnowledgeGraph
              t={t}
              snapshot={graphData}
              skillId={center.graphSkillId ?? ''}
              onClose={() => closeGraph()}
            />
          )}
          {center.view === 'experiences' && (
            <ExperiencesWall
              t={t}
              overview={overview}
              practices={practices}
              skills={store.skills}
              pendingMemories={pendingMemories}
              onAssign={assignPractice}
              onRemove={removePractice}
              onConfirm={confirmPractice}
              onMemoryAction={memoryAction}
              onRefresh={refreshExperiences}
              onCreateSkill={(title, example) => openCreateDraft({ name: title, purpose: example, steps: '', rules: '' })}
              onOpenGraph={(skillId) => openGraph(skillId)}
            />
          )}
          {center.view === 'market' && (
            <MarketTab
              t={t}
              market={market}
              installedIds={installedIds}
              onRefresh={refreshMarket}
              onInstall={installMarket}
            />
          )}
        </div>
      </div>
    </div>
  )
}
