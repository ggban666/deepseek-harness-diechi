/**
 * 平权技能设置 browser half: one `settings.section` page (bottom-left settings
 * → 平权技能设置), the sidebar nav + workshop panel, and the full-screen
 * 平权技能中心 (`shell.overlay`) with 卡片墙 / 阅历 / 商店 tabs. Durable state rides the three
 * namespaces the web bundle's skill-store row owns — `skill.store` (the
 * installed catalog), `skill.vision` (the live local-vision config) and
 * `skill-market` (the scanned local store). The controller mirrors the
 * scopes into snapshot stores and routes user choices back through the
 * settings wire; the host row turns the catalog into live `ctx.skills`
 * registrations, so imported skills appear in the composer slash menu
 * without any further UI. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings scope service (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the shell.overlay slot declaration (ui-layout) and the
// conversation.hero.quick slot declaration (ui-conversation) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the sidebar.nav slot declaration (ui-sidebar) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SkillStoreSection,
  type SkillStoreSectionInjected, type SkillStoreState,
} from './SkillStoreSection.tsx'
import { VisionSection, type VisionSectionInjected, type VisionState } from './VisionSection.tsx'
import { VoiceSection, type VoiceSectionInjected } from './VoiceSection.tsx'
import { VoiceReplyActions, type VoiceReplyInjected } from './VoiceReplyActions.tsx'
import {
  armVoiceAudioWarmup, streamVoice, StreamingVoicePlayer, transcribeAudio as asrTranscribe, VOICE_DEFAULT_ENDPOINT, VOICE_DEFAULT_SPEED,
  VOICE_DEFAULT_VOICE, warmVoiceAudio,
  type VoiceState,
} from './voice.ts'
import type { ImportResult, RecognitionImage, RecognitionResult, RetrainResult, SkillDraft } from './skill-display.ts'
import {
  SkillCenterOverlay, type CreateSkillInput, type MarketState, type SkillCenterInjected, type SkillCenterState,
  type SkillCenterView, type TrainingStartInput,
} from './SkillCenterOverlay.tsx'
import { SkillNav } from './SkillNav.tsx'
import { SkillWorkshopPanel } from './SkillWorkshopPanel.tsx'
import { TrainingDock, type DistillNotice, type TrainingDockInjected } from './TrainingDock.tsx'
import { CameraChatDock, type CameraChatDockInjected, type CameraChatTurn } from './CameraChatDock.tsx'
import { MicButton, type MicButtonInjected } from './MicButton.tsx'
import type { BrainPracticeItem, SkillOverviewSnapshot, BrainGraphSnapshot, BrainPendingMemory } from '@deepseek-ai/dsh-api-remotes/types'
import { en, zh } from './locales.ts'
import {
  marketSkillToEntry, parseSkillImport,
  type SkillManifestEntry, type SkillMarketSettings, type SkillStoreSettings,
  type SkillTrainingSettings, type TrainingState, IDLE_TRAINING,
} from './skill-format.ts'

export type {
  ImportResult, RecognitionResult,
} from './skill-display.ts'
export type {
  SkillStoreSectionInjected, SkillStoreState,
} from './SkillStoreSection.tsx'
export type { VisionSectionInjected, VisionState } from './VisionSection.tsx'
export type { VoiceState } from './voice.ts'
export type { VoiceSectionInjected } from './VoiceSection.tsx'
export type { VoiceReplyInjected } from './VoiceReplyActions.tsx'
export type {
  SkillManifestEntry, SkillMarketSettings, SkillMarketSkill, SkillStoreSettings, SkillManifestRevision,
} from './skill-format.ts'
export type { SkillStoreKey } from './locales.ts'
export type { MarketState, SkillCenterInjected, SkillCenterState, SkillCenterView } from './SkillCenterOverlay.tsx'

/** Bump a three-part version label: 1.0.0 → 1.1.0 → 1.2.0 → 2.0.0 (client twin). */
function bumpVersion(version: string | undefined): string {
  const parts = (version ?? '1.0.0').split('.').map(part => Number.parseInt(part, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[1] = (parts[1] ?? 0) + 1
  if (parts[1] > 9) {
    parts[1] = 0
    parts[0] = (parts[0] ?? 0) + 1
  }
  return parts.slice(0, 3).join('.')
}

/** Extract a structured skill draft from the model's JSON reply. */
function parseSkillDraft(text: string): SkillDraft | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  const candidate = text.slice(start, end + 1)
  const parse = (raw: string): Record<string, unknown> | undefined => {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  const parsed = parse(candidate) ?? parse(candidate.replaceAll(';', ',').replace(/,\s*}/g, '}'))
  if (parsed === undefined) return undefined
  const pick = (key: string): string => {
    const value = parsed[key]
    return typeof value === 'string' ? value.trim() : ''
  }
  const name = pick('name')
  const purpose = pick('purpose')
  if (name === '' || purpose === '') return undefined
  return { name, purpose, steps: pick('steps'), rules: pick('rules') }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'skill-store'

/** Required services: the slot registry, the section copy, and the settings scope. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Default local vision endpoint: the diechi vision+tts service (OpenAI-compatible). */
const VISION_DEFAULT_ENDPOINT = 'http://127.0.0.1:8080'
/** Default model name served by the llama.cpp endpoint. */
const VISION_DEFAULT_MODEL = 'MiniCPM-V-4.6'
/** Abort a recognition request after this long; CPU prompt eval is slow. */
const VISION_TIMEOUT_MS = 120_000
/** Video uploads can be long camera clips; give the server room to decode + transcribe. */
const VIDEO_TIMEOUT_MS = 600_000

/** Default TTS provider: the diechi vision+tts service on 8080. */
const VOICE_DEFAULT_PROVIDER: VoiceState['provider'] = 'local'

/** 全局大脑 RPC 最小面（由 api-remotes 挂载的 remote.diechiBrain）。 */
interface DiechiBrainRemoteLike {
  overview(): Promise<{ ok: true; value: SkillOverviewSnapshot } | { ok: false; error: { code: string; message: string } }>
  list(): Promise<{ ok: true; value: { items: readonly BrainPracticeItem[] } } | { ok: false; error: { code: string; message: string } }>
  assign(input: { topic: string; skillId: string }): Promise<{ ok: true; value: { ok: boolean; error?: string } } | { ok: false; error: { code: string; message: string } }>
  removeItem(input: { topic: string }): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
  confirm(input: { topic: string }): Promise<{ ok: true; value: boolean } | { ok: false; error: { code: string; message: string } }>
  ingestScene(input: { content: string; fingerprint?: string; skillId?: string }): Promise<{ ok: true; value: { id: number; startedAt: string; endedAt: string; content: string; count: number } | undefined } | { ok: false; error: { code: string; message: string } }>
  recallScenes(input: { query?: string; sinceMinutes?: number; limit?: number; skillId?: string }): Promise<{ ok: true; value: { count: number; scenes: readonly { id: number; startedAt: string; endedAt: string; content: string; count: number }[] } } | { ok: false; error: { code: string; message: string } }>
  graph(input: { skillId?: string; limit?: number }): Promise<{ ok: true; value: BrainGraphSnapshot } | { ok: false; error: { code: string; message: string } }>
  pendingMemories(): Promise<{ ok: true; value: { items: readonly BrainPendingMemory[] } } | { ok: false; error: { code: string; message: string } }>
  memoryAction(input: { id: number; confirm: boolean }): Promise<{ ok: true; value: { ok: boolean; error?: string } } | { ok: false; error: { code: string; message: string } }>
}

/**
 * One conversation send outcome. Training flows need the target session id
 * back so the training banner can pin itself to that session; plain sends
 * only care about success. S is the session id type (branded on the runtime).
 */
type SendOutcome<S = string> = { ok: true; sessionId: S } | { ok: false; error: string }

/**
 * Bridges the store namespaces (catalog, vision, market) and the skill-center
 * view state onto snapshot hooks and actions. Reads never block; writes carry
 * the namespace revision and settle before the next user gesture.
 */
class SkillStoreController {
  private readonly store: SnapshotStore<SkillStoreState>
  private readonly vision: SnapshotStore<VisionState>
  private readonly voice: SnapshotStore<VoiceState>
  private readonly market: SnapshotStore<MarketState>
  private visionSessionId: string
  private visionTurnAbort: AbortController | undefined
  private readonly center: SnapshotStore<SkillCenterState>
  private readonly training: SnapshotStore<TrainingState>
  private voicePlayer: StreamingVoicePlayer | undefined = undefined
  private voiceAbort: AbortController | undefined = undefined
  private readonly overviewStore = createSnapshotStore<SkillOverviewSnapshot | undefined>(undefined)
  private readonly practicesStore = createSnapshotStore<readonly BrainPracticeItem[]>([])
  private readonly distillStore = createSnapshotStore<DistillNotice | undefined>(undefined)
  private readonly graphStore = createSnapshotStore<BrainGraphSnapshot>({ nodes: [], edges: [] })
  private readonly pendingMemoriesStore = createSnapshotStore<readonly BrainPendingMemory[]>([])

  /**
   * @param storeScope - bound scope for the `skill.store` catalog.
   * @param visionScope - bound scope for the `skill.vision` configuration.
   * @param marketScope - bound scope for the scanned `skill-market` catalog.
   * @param trainingScope - bound scope for the `skill-training` session state.
   * @param brainRemote - diechi 全局大脑 RPC 远程面（overview/list/assign/removeItem）。
   */
  constructor(
    private readonly storeScope: SettingsScope<SkillStoreSettings>,
    private readonly visionScope: SettingsScope<VisionState>,
    private readonly voiceScope: SettingsScope<VoiceState>,
    private readonly marketScope: SettingsScope<SkillMarketSettings>,
    private readonly trainingScope: SettingsScope<SkillTrainingSettings>,
    private readonly distillScope: SettingsScope<DistillNotice>,
    private readonly sendRetrain: (id: string, description: string) => Promise<RetrainResult>,
    private readonly sendCreate: (input: CreateSkillInput) => Promise<RetrainResult>,
    private readonly sendTrainingGuide: (input: TrainingStartInput) => Promise<SendOutcome>,
    private readonly sendTrainingFinish: (state: TrainingState) => Promise<boolean>,
    private readonly sendCameraObservationPrompt: (context: string) => Promise<RetrainResult>,
    private readonly brainRemote: DiechiBrainRemoteLike,
  ) {
    this.store = createSnapshotStore<SkillStoreState>({ skills: [], writable: false })
    this.vision = createSnapshotStore<VisionState>({ enabled: false, endpoint: VISION_DEFAULT_ENDPOINT, model: VISION_DEFAULT_MODEL, intervalSec: 0, voiceChat: false, chatIntervalSec: 0 })
    this.visionSessionId = ''
    this.visionTurnAbort = undefined
    this.voice = createSnapshotStore<VoiceState>({
      enabled: false,
      autoSpeak: false,
      provider: VOICE_DEFAULT_PROVIDER,
      endpoint: VOICE_DEFAULT_ENDPOINT,
      apiKey: '',
      model: '',
      voice: VOICE_DEFAULT_VOICE,
      speed: VOICE_DEFAULT_SPEED,
      asrEnabled: false,
    })
    this.market = createSnapshotStore<MarketState>({ status: 'loading', dir: '', skills: [] })
    this.center = createSnapshotStore<SkillCenterState>({ view: 'closed' })
    this.training = createSnapshotStore<TrainingState>(IDLE_TRAINING)
    this.refreshStore()
    this.refreshVision()
    this.refreshVoice()
    this.refreshMarket()
    this.refreshTraining()
    this.storeScope.subscribe(() => { this.refreshStore() })
    this.visionScope.subscribe(() => { this.refreshVision() })
    this.voiceScope.subscribe(() => { this.refreshVoice() })
    this.marketScope.subscribe(() => { this.refreshMarket() })
    this.trainingScope.subscribe(() => { this.refreshTraining() })
    this.distillScope.subscribe(() => { this.refreshDistill() })
    armVoiceAudioWarmup()
  }

  private refreshStore(): void {
    const snapshot = this.storeScope.getSnapshot()
    this.store.set({
      skills: snapshot.value?.skills ?? [],
      writable: snapshot.status === 'ready' && snapshot.writable,
    })
  }

  private refreshVision(): void {
    const snapshot = this.visionScope.getSnapshot()
    this.vision.set({
      enabled: snapshot.value?.enabled ?? false,
      endpoint: snapshot.value?.endpoint || VISION_DEFAULT_ENDPOINT,
      model: snapshot.value?.model || VISION_DEFAULT_MODEL,
      intervalSec: snapshot.value?.intervalSec ?? 5,
      voiceChat: snapshot.value?.voiceChat ?? false,
      chatIntervalSec: snapshot.value?.chatIntervalSec ?? 0,
    })
  }

  private refreshVoice(): void {
    const snapshot = this.voiceScope.getSnapshot()
    this.voice.set({
      enabled: snapshot.value?.enabled ?? false,
      autoSpeak: snapshot.value?.autoSpeak ?? false,
      provider: snapshot.value?.provider === 'openai' ? 'openai' : VOICE_DEFAULT_PROVIDER,
      endpoint: snapshot.value?.endpoint || VOICE_DEFAULT_ENDPOINT,
      apiKey: snapshot.value?.apiKey ?? '',
      model: snapshot.value?.model ?? '',
      voice: snapshot.value?.voice || VOICE_DEFAULT_VOICE,
      speed: snapshot.value?.speed ?? VOICE_DEFAULT_SPEED,
      asrEnabled: snapshot.value?.asrEnabled ?? false,
    })
  }

  private refreshMarket(): void {
    const snapshot = this.marketScope.getSnapshot()
    this.market.set({
      status: snapshot.status === 'unavailable'
        ? 'unavailable'
        : snapshot.status === 'ready'
          ? 'ready'
          : 'loading',
      dir: snapshot.value?.dir ?? '',
      skills: snapshot.value?.skills ?? [],
    })
  }

  private refreshTraining(): void {
    const snapshot = this.trainingScope.getSnapshot()
    const value = snapshot.value
    this.training.set({
      active: value?.active === true,
      mode: value?.mode === 'create' ? 'create' : 'retrain',
      skillId: value?.skillId ?? '',
      skillTitle: value?.skillTitle ?? '',
      sessionId: value?.sessionId ?? '',
      startedAt: value?.startedAt ?? 0,
    })
  }

  /** 镜像宿主「已记入大脑」通知（skill-distill namespace，latest-wins）。 */
  private refreshDistill(): void {
    const snapshot = this.distillScope.getSnapshot()
    const value = snapshot.value
    if (value?.at !== undefined && value.sessionId !== undefined) {
      this.distillStore.set({ at: value.at, sessionId: value.sessionId, topic: value.topic ?? '', target: value.target ?? '' })
    }
  }

  /**
   * Start a training round (训练模式): open the training conversation, send
   * the guide prompt (feed corpus / video material or have the agent collect
   * data), then activate the banner so the user can finish with 完成训练.
   * @param input - mode (retrain / create), target, and initial requirement.
   * @returns the send outcome; on success the banner is live.
   */
  async startTraining(input: TrainingStartInput): Promise<RetrainResult> {
    const result = await this.sendTrainingGuide(input)
    if (!result.ok) return { ok: false, error: result.error }
    const snapshot = this.trainingScope.getSnapshot()
    const next: SkillTrainingSettings = {
      active: true,
      mode: input.mode,
      skillId: input.skillId ?? '',
      skillTitle: input.skillTitle,
      sessionId: result.sessionId,
      startedAt: Date.now(),
    }
    if (snapshot.value?.active === true) {
      // Abandon any previous round: the banner would otherwise target a dead
      // conversation. The previous round's agent keeps its pending queue.
      await this.clearTraining()
    }
    await this.trainingScope.set('active', next.active)
    await this.trainingScope.set('mode', next.mode)
    await this.trainingScope.set('skillId', next.skillId)
    await this.trainingScope.set('skillTitle', next.skillTitle)
    await this.trainingScope.set('sessionId', next.sessionId)
    await this.trainingScope.set('startedAt', next.startedAt)
    return { ok: true }
  }

  /**
   * Finish the active training round: ask the agent (in the training session)
   * to run skill-generate with everything gathered, then clear the banner.
   * @returns the send outcome.
   */
  async finishTraining(): Promise<RetrainResult> {
    const state = this.training.getSnapshot()
    if (!state.active || state.sessionId === '') return { ok: false, error: 'no-session' }
    const sent = await this.sendTrainingFinish(state)
    if (!sent) return { ok: false, error: 'no-session' }
    await this.clearTraining()
    return { ok: true }
  }

  /** Abandon the active training round without generating a revision. */
  cancelTraining(): void {
    void this.clearTraining()
  }

  private async clearTraining(): Promise<void> {
    await this.trainingScope.set('active', false)
  }

  /** Open the skill center on a tab; remembers an optional retrain target. */
  open(view: SkillCenterView, focusId?: string, createDraft?: SkillDraft): void {
    this.center.set({
      view,
      ...(focusId === undefined ? {} : { focusId }),
      ...(createDraft === undefined ? {} : { createDraft }),
    })
  }

  /** Open the sidebar workshop panel with a recognition draft prefilled. */
  openCreateDraft(draft: SkillDraft): void {
    this.center.set({ view: 'closed', workshopOpen: true, createDraft: draft })
  }

  /** 展开/收起侧边工坊面板。 */
  toggleWorkshop(): void {
    const state = this.center.getSnapshot()
    this.center.set({ ...state, workshopOpen: !(state.workshopOpen ?? false) })
  }

  /** 清空工坊创建草稿（识别预填用完一次即清）。 */
  clearWorkshopDraft(): void {
    const state = this.center.getSnapshot()
    const { createDraft: _cleared, ...rest } = state
    this.center.set(rest)
  }

  /** Close the skill center page. */
  close(): void {
    this.center.set({ view: 'closed' })
  }

  /**
   * Ask the host to re-scan the local market directory and republish the
   * catalog (the host watches the market namespace for refreshTick changes).
   */
  async refreshMarketRequest(): Promise<void> {
    await this.marketScope.set('refreshTick', Date.now())
  }

  /**
   * Install one market skill into the installed catalog. A reinstall keeps
   * the persona flag and version history of the installed entry.
   * @param id - the market skill id to install.
   * @returns the import outcome.
   */
  async installMarket(id: string): Promise<ImportResult> {
    const market = this.marketScope.getSnapshot().value
    const skill = market?.skills.find(candidate => candidate.id === id)
    if (skill === undefined) return { ok: false, error: `market skill "${id}" not found` }
    const current = this.storeScope.getSnapshot().value?.skills ?? []
    const existing = current.find(entry => entry.id === id)
    const incoming = marketSkillToEntry(skill)
    const next = existing === undefined
      ? [...current, incoming]
      : current.map(entry => entry.id === id
        ? { ...incoming, enabled: entry.enabled, revisions: [...entry.revisions, ...incoming.revisions] }
        : entry)
    await this.storeScope.set('skills', next)
    return { ok: true, count: 1 }
  }

  /**
   * Parse one imported file and merge it into the catalog. The full resolved
   * list is written so the composition defaults (built-ins) survive.
   * @param file - the selected .md or .json file.
   * @returns the import outcome.
   */
  async importSkill(file: File): Promise<ImportResult> {
    let text: string
    try {
      text = await file.text()
    } catch {
      return { ok: false, error: '无法读取所选文件' }
    }
    let entries: SkillManifestEntry[]
    try {
      entries = parseSkillImport(text, file.name)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const current = this.storeScope.getSnapshot().value?.skills ?? []
    const byId = new Map(current.map(entry => [entry.id, entry]))
    for (const entry of entries) {
      byId.set(entry.id, { ...entry, source: 'imported' })
    }
    await this.storeScope.set('skills', [...byId.values()])
    return { ok: true, count: entries.length }
  }

  /**
   * Remove one installed skill by writing the full catalog without it.
   * @param id - skill id to drop.
   */
  async removeSkill(id: string): Promise<void> {
    const current = this.storeScope.getSnapshot().value?.skills ?? []
    await this.storeScope.set('skills', current.filter(entry => entry.id !== id))
  }

  /**
   * Persist the checked persona set by writing the full catalog with the
   * requested `enabled` flags applied. Unknown ids are ignored.
   * @param updates - id/enabled pairs from the section's save button.
   */
  async saveEnabled(updates: readonly { readonly id: string; readonly enabled: boolean }[]): Promise<void> {
    const current = this.storeScope.getSnapshot().value?.skills ?? []
    const byId = new Map(current.map(entry => [entry.id, entry]))
    for (const update of updates) {
      const existing = byId.get(update.id)
      if (existing === undefined) continue
      byId.set(update.id, { ...existing, enabled: update.enabled })
    }
    await this.storeScope.set('skills', [...byId.values()])
  }

  /**
   * Send one retrain prompt into the current conversation. The agent loop
   * turns it into a new revision via the host skill-generate tool; the
   * catalog snapshot refreshes once the store namespace lands the write.
   * @param id - the skill id to retrain.
   * @param description - the user's requested change in plain language.
   * @returns the send outcome; 'no-session' means no conversation is open.
   */
  async retrain(id: string, description: string): Promise<RetrainResult> {
    return this.sendRetrain(id, description)
  }

  /**
   * Send one create-skill prompt into the current conversation. The agent
   * loop turns it into a draft manifest via the host skill-generate tool.
   * @param input - the structured create form fields.
   * @returns the send outcome; 'no-session' means no conversation is open.
   */
  async createSkill(input: CreateSkillInput): Promise<RetrainResult> {
    return this.sendCreate(input)
  }

  /**
   * Restore an older revision as the active body. The restored snapshot is
   * appended as a new revision (so history keeps the rollback event) and the
   * entry is set back to published.
   * @param id - skill id to restore.
   * @param version - revision version to restore.
   */
  async restoreRevision(id: string, version: string): Promise<void> {
    const current = this.storeScope.getSnapshot().value?.skills ?? []
    const existing = current.find(entry => entry.id === id)
    if (existing === undefined) return
    const revision = existing.revisions.find(candidate => candidate.version === version)
    if (revision === undefined) return
    const updatedAt = new Date().toISOString()
    const nextVersion = bumpVersion(existing.metadata?.version ?? revision.version)
    const restored = {
      ...existing,
      content: revision.content,
      status: 'published' as const,
      revisions: [...existing.revisions, {
        version: nextVersion,
        content: revision.content,
        updatedAt,
        note: `恢复自 ${revision.version}`,
      }],
      metadata: { ...(existing.metadata ?? {}), version: nextVersion, updatedAt },
    }
    await this.storeScope.set('skills', current.map(entry => entry.id === id ? restored : entry))
  }

  /**
   * Persist a vision configuration patch. Each changed field is written
   * separately so unknown sections are never clobbered.
   * @param patch - fields to change.
   */
  async setVision(patch: Partial<VisionState>): Promise<void> {
    const current = this.visionScope.getSnapshot().value ?? { enabled: false, endpoint: '', model: '', intervalSec: 5, voiceChat: false, chatIntervalSec: 0 }
    if (patch.enabled !== undefined && patch.enabled !== current.enabled) {
      await this.visionScope.set('enabled', patch.enabled)
    }
    if (patch.endpoint !== undefined && patch.endpoint !== current.endpoint) {
      await this.visionScope.set('endpoint', patch.endpoint)
    }
    if (patch.model !== undefined && patch.model !== current.model) {
      await this.visionScope.set('model', patch.model)
    }
    if (patch.intervalSec !== undefined && patch.intervalSec !== current.intervalSec) {
      await this.visionScope.set('intervalSec', patch.intervalSec)
    }
    if (patch.voiceChat !== undefined && patch.voiceChat !== current.voiceChat) {
      await this.visionScope.set('voiceChat', patch.voiceChat)
    }
    if (patch.chatIntervalSec !== undefined && patch.chatIntervalSec !== current.chatIntervalSec) {
      await this.visionScope.set('chatIntervalSec', patch.chatIntervalSec)
    }
  }

  /**
   * Switch the backend vision model (local MiniCPM / cloud DS). Persisted in
   * deploy-tools/vision-cloud.json so every vision path (camera, video,
   * image) uses the same model immediately.
   * @param model - model name (e.g. `minicpm-v-4.6` or `deepseek-v4-flash-vision-exp`).
   */
  async setVisionModel(model: string): Promise<void> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const response = await fetch(`${endpoint}/api/v1/vision/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    if (!response.ok) throw new Error(`vision-model-http:${response.status}`)
    await response.json().catch(() => undefined)
  }

  /**
   * Persist a voice configuration patch, field by field.
   * @param patch - fields to change.
   */
  async setVoice(patch: Partial<VoiceState>): Promise<void> {
    const current = this.voiceScope.getSnapshot().value
      ?? { enabled: false, autoSpeak: false, provider: 'local', endpoint: '', apiKey: '', model: '', voice: '', speed: 1, asrEnabled: false }
    const keys = ['enabled', 'autoSpeak', 'provider', 'endpoint', 'apiKey', 'model', 'voice', 'speed', 'asrEnabled'] as const
    for (const key of keys) {
      const value = patch[key]
      if (value !== undefined && value !== current[key]) await this.voiceScope.set(key, value)
    }
  }

  /**
   * Transcribe one recorded speech blob through the configured ASR service
   * (the diechi 8080 server by default).
   * @param blob - recorded speech (webm/ogg/mp4).
   * @returns the transcript, or undefined when the service failed.
   */
  async transcribeMic(blob: Blob): Promise<string | undefined> {
    // ASR is provided by the local vision service, independently of the TTS
    // provider URL selected in voice settings.
    return asrTranscribe(VOICE_DEFAULT_ENDPOINT, blob)
  }

  /** Stop the currently playing voice line and release its audio context. */
  stopSpeaking(): void {
    this.voiceAbort?.abort()
    this.voiceAbort = undefined
    this.voicePlayer?.stop()
    this.voicePlayer = undefined
  }

  /**
   * Synthesize and play one line of speech with the configured (or given)
   * voice settings. The master `enabled` flag is only enforced by the UI
   * surfaces; the controller plays whatever it is asked to.
   * @param text - the line to speak.
   * @param config - optional explicit configuration (settings preview uses
   * the unsaved draft); defaults to the persisted `skill-voice` values.
   * @returns true when playback started, false when the line was empty or
   * the provider failed.
   */
  async speak(text: string, config?: VoiceState): Promise<boolean> {
    const trimmed = text.trim()
    if (trimmed === '') return false
    const useConfig: VoiceState = config ?? this.voiceScope.getSnapshot().value ?? this.voice.getSnapshot()
    warmVoiceAudio()
    this.stopSpeaking()
    const player = new StreamingVoicePlayer()
    this.voicePlayer = player
    const abort = new AbortController()
    this.voiceAbort = abort
    try {
      await streamVoice(useConfig, trimmed, (blob) => { void player.pushBlob(blob) }, abort.signal)
      player.finishInput()
      await player.finished()
      return true
    } catch (error) {
      player.finishInput()
      if (abort.signal.aborted) return false
      console.error('[voice] speak failed:', error)
      this.stopSpeaking()
      return false
    }
  }

  /**
   * Recognize an image or sampled video frames through the configured local
   * vision model (OpenAI-compatible chat completions, e.g. llama.cpp at
   * 127.0.0.1:8080). The model describes the input and drafts a skill shape
   * (name, purpose, steps, rules) the workshop form can refine.
   * @param image - one frame (image input) or several key frames (video).
   * @returns the model's description, or an error code for the section copy.
   */
  async runRecognition(image: RecognitionImage): Promise<RecognitionResult> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return { ok: false, error: 'vision-disabled' }
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const model = config.model || VISION_DEFAULT_MODEL
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS)
    try {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: image.kind === 'video'
                  ? '这是用户视频的关键帧画面（按时间顺序）。请综合这些画面描述视频内容，'
                    + '并推断它适合封装成什么技能。只输出一个 JSON 对象，不要任何其他文字：'
                    + '{"name":"技能名称","purpose":"什么时候用它（一句话）","steps":"关键步骤，用分号分隔","rules":"注意事项，用分号分隔"}'
                  : '请仔细观察这张图片，并推断它适合封装成什么技能。只输出一个 JSON 对象，'
                    + '不要任何其他文字：{"name":"技能名称","purpose":"什么时候用它（一句话）","steps":"关键步骤，用分号分隔","rules":"注意事项，用分号分隔"}',
              },
              ...image.dataUrls.map(dataUrl => ({ type: 'image_url', image_url: { url: dataUrl } })),
            ],
          }],
          max_tokens: 1024,
          temperature: 0.2,
        }),
      })
      if (!response.ok) return { ok: false, error: `vision-http:${response.status}` }
      const payload = await response.json() as { choices?: readonly { message?: { content?: string } }[] }
      const content = payload.choices?.[0]?.message?.content?.trim()
      if (!content) return { ok: false, error: 'vision-empty' }
      const draft = parseSkillDraft(content)
      return draft === undefined
        ? { ok: true, notice: content }
        : { ok: true, notice: content, draft }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, error: 'vision-timeout' }
      }
      return { ok: false, error: 'vision-network' }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Upload a real video and let the local vision model understand it directly
   * (server-side decode + the model's native video processor). Returns the
   * same skill-draft shape as image recognition.
   * @param file - the picked or camera-recorded video file.
   * @returns the model's description and optional structured draft.
   */
  async runVideoRecognition(file: File): Promise<RecognitionResult> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return { ok: false, error: 'vision-disabled' }
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VIDEO_TIMEOUT_MS)
    try {
      const form = new FormData()
      form.append('file', file, file.name)
      const response = await fetch(`${endpoint}/api/v1/video/describe`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      if (!response.ok) return { ok: false, error: `vision-http:${response.status}` }
      const payload = await response.json() as {
        content?: string; transcript?: string | null; process?: string; real_duration?: number
      }
      const content = payload.content?.trim()
      if (!content) return { ok: false, error: 'vision-empty' }
      const transcript = payload.transcript?.trim() || undefined
      const process = payload.process?.trim() || undefined
      const draft = parseSkillDraft(content)
      const transcriptExtra = transcript !== undefined ? { transcript } : {}
      // 视频实操过程发布到宿主：宿主先入库全局大脑（#实操 阅历），勾选人格时再同步。
      if (process !== undefined) {
        try {
          await this.visionScope.set('videoProcess', {
            at: new Date().toISOString(),
            name: file.name,
            process,
          })
        } catch (error) {
          console.error('[skill-store] videoProcess set failed', error)
        }
      }
      const processExtra = process !== undefined ? { process } : {}
      return draft === undefined
        ? { ok: true, notice: content, ...transcriptExtra, ...processExtra }
        : { ok: true, notice: content, draft, ...transcriptExtra, ...processExtra }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, error: 'vision-timeout' }
      }
      return { ok: false, error: 'vision-network' }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Live camera narration: describe what the person is doing right now from a
   * single captured frame. Uses the same local vision endpoint with a short,
   * conversational prompt. Returns undefined on any failure (silent for the
   * live overlay so recording is never interrupted).
   * @param frame - one JPEG data URL captured from the live preview.
   * @returns a one-sentence description, or undefined when unavailable.
   */
  async runLiveFrame(frame: string): Promise<string | undefined> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return undefined
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const model = config.model || VISION_DEFAULT_MODEL
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: '你是实时画面解说员。用一句简短的中文（15~25字）描述画面中人物此刻正在做什么，只输出描述本身，不要任何前缀、引号、解释或建议。',
              },
              { type: 'image_url', image_url: { url: frame } },
            ],
          }],
          max_tokens: 256,
          temperature: 0.4,
        }),
      })
      if (!response.ok) return undefined
      const payload = await response.json() as { choices?: readonly { message?: { content?: string } }[] }
      return payload.choices?.[0]?.message?.content?.trim() || undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Camera chat: describe one live frame conversationally (rolling history
   * keeps the caption context-aware). Returns the caption, or undefined on
   * any failure so the live dock never throws.
   * @param frame - one JPEG data URL captured from the camera preview.
   * @param history - recent caption turns for conversational continuity.
   * @returns a short caption, or undefined when unavailable.
   */
  async runLiveChatFrame(frame: string, history: readonly CameraChatTurn[]): Promise<string | undefined> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return undefined
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const model = config.model || VISION_DEFAULT_MODEL
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const historyMessages = history.map(turn => ({
        role: turn.role,
        content: [{ type: 'text', text: turn.content }],
      }))
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: [{
                type: 'text',
                text: '你是蝶翅的实时视频通话助手，正通过摄像头看着用户。对话历史里以「【用户语音】」开头的内容是用户刚刚说话转成的文字，请结合画面简短回应用户；没有用户语音时，用一句简短自然的中文（15~30字）描述画面中人物此刻正在做什么，没有人物就描述场景。回答口语、拟人、简短（不超过30字），直接输出内容，不要前缀、引号或解释。',
              }],
            },
            ...historyMessages,
            {
              role: 'user',
              content: [
                { type: 'text', text: '（画面）' },
                { type: 'image_url', image_url: { url: frame } },
              ],
            },
          ],
          max_tokens: 256,
          temperature: 0.4,
        }),
      })
      if (!response.ok) return undefined
      const payload = await response.json() as { choices?: readonly { message?: { content?: string } }[] }
      return payload.choices?.[0]?.message?.content?.trim() || undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Server-side camera chat session: create, close, and interrupt helpers.
   * The session keeps a frame ring buffer + text history so every turn sees
   * the recent N frames (multi-frame context), not just the current one.
   */
  async startVisionSession(): Promise<string | undefined> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return undefined
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    try {
      const ctx = await this.buildVisionSkillContext()
      const response = await fetch(`${endpoint}/api/v1/vision/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: ctx.persona, memory: ctx.memory }),
      })
      if (!response.ok) return undefined
      const payload = await response.json() as { session_id?: string }
      return payload.session_id
    } catch {
      return undefined
    }
  }

  /**
   * 组装当前平权技能上下文：勾选技能的人格提示词 + 最近视觉记忆时间线。
   * 换技能=换一个人：摄像头会话的 system prompt 由此注入人格与记忆。
   * 未勾选任何技能时返回空串（退化为通用视频通话助手）。
   */
  private async buildVisionSkillContext(): Promise<{ persona: string; memory: string }> {
    const skills = this.storeScope.getSnapshot().value?.skills ?? []
    const enabled = skills.filter(entry => entry.enabled === true && entry.content.trim() !== '')
    const persona = enabled
      .map(entry => `【${entry.title}】\n${entry.content.trim()}`)
      .join('\n\n')
    let memory = ''
    try {
      const scenes = await this.brainRemote.recallScenes({ sinceMinutes: 30, limit: 6 })
      if (scenes.ok && scenes.value.scenes.length > 0) {
        memory = scenes.value.scenes
          .slice(-6)
          .map(scene => `- ${scene.startedAt.slice(11, 19)} ${scene.content}`)
          .join('\n')
      }
    } catch {
      memory = ''
    }
    return { persona, memory }
  }

  async endVisionSession(sid: string): Promise<void> {
    if (!sid) return
    const config = this.visionScope.getSnapshot().value
    const endpoint = (config?.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    try {
      await fetch(`${endpoint}/api/v1/vision/session/${encodeURIComponent(sid)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
  }

  async interruptVision(sid: string): Promise<void> {
    if (!sid) return
    const config = this.visionScope.getSnapshot().value
    const endpoint = (config?.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    try {
      await fetch(`${endpoint}/api/v1/vision/session/${encodeURIComponent(sid)}/interrupt`, { method: 'POST' })
    } catch { /* ignore */ }
  }

  /**
   * One streaming vision turn against the session. Frames accumulate on the
   * server; `text` is stored as a user turn. onDelta fires per token chunk.
   * Returns the full reply (possibly truncated when aborted).
   */
  async visionStreamTurn(args: {
    sid: string
    frame?: string
    text?: string
    reason?: string
    persona?: string
    memory?: string
    signal?: AbortSignal
    onDelta?: (delta: string) => void
  }): Promise<string> {
    const { sid, frame = '', text = '', reason = 'speech', persona, memory, signal, onDelta } = args
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return ''
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const controller = new AbortController()
    const onOuterAbort = (): void => { controller.abort() }
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), 90_000)
    let full = ''
    try {
      const body: Record<string, string | number> = {
        session_id: sid, frame, text, reason, max_tokens: 256, temperature: 0.4,
      }
      if (persona !== undefined && persona !== '') body.persona = persona
      if (memory !== undefined && memory !== '') body.memory = memory
      const response = await fetch(`${endpoint}/api/v1/vision/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      })
      if (!response.ok || response.body === null) return ''
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx = buffer.indexOf('\n\n')
        while (idx >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6)) as { type?: string; delta?: string }
              if (ev.type === 'delta' && typeof ev.delta === 'string') {
                full += ev.delta
                onDelta?.(ev.delta)
              }
            } catch { /* skip malformed event */ }
          }
          idx = buffer.indexOf('\n\n')
        }
      }
    } catch {
      return full
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
    return full
  }

  async runLiveChatFrameStream(frame: string, text: string, onDelta: (delta: string) => void, reason = 'speech'): Promise<string> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return ''
    if (!this.visionSessionId) {
      this.visionSessionId = (await this.startVisionSession()) ?? ''
    }
    const sid = this.visionSessionId
    // 技能热切换：每轮把当前人格+记忆带上，服务端增量更新 system prompt。
    const ctx = await this.buildVisionSkillContext()
    const controller = new AbortController()
    this.visionTurnAbort = controller
    try {
      return await this.visionStreamTurn({
        sid, frame, text, reason, persona: ctx.persona, memory: ctx.memory,
        signal: controller.signal, onDelta,
      })
    } finally {
      if (this.visionTurnAbort === controller) this.visionTurnAbort = undefined
    }
  }

  async interruptVisionChat(): Promise<void> {
    this.visionTurnAbort?.abort()
    this.visionTurnAbort = undefined
    if (this.visionSessionId) await this.interruptVision(this.visionSessionId)
  }

  async resetVisionSession(): Promise<void> {
    this.visionTurnAbort?.abort()
    this.visionTurnAbort = undefined
    const sid = this.visionSessionId
    this.visionSessionId = ''
    if (sid) await this.endVisionSession(sid)
  }

  /**
   * 连续感知推帧：把当前画面送进后端摄像头会话缓冲（只存帧、不推理）。
   * 摄像头开着时前端每 1 秒调用一次；用户说话/提问时模型依据缓冲记忆回答。
   * @param frame - one JPEG data URL captured from the live preview.
   */
  async observeVisionFrame(frame: string, diff = -1): Promise<{ caption?: string }> {
    const config = this.visionScope.getSnapshot().value
    if (config?.enabled !== true) return {}
    if (!this.visionSessionId) {
      this.visionSessionId = (await this.startVisionSession()) ?? ''
    }
    const sid = this.visionSessionId
    if (sid === '') return {}
    const endpoint = (config.endpoint || VISION_DEFAULT_ENDPOINT).replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await fetch(`${endpoint}/api/v1/vision/session/${sid}/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ frame, diff }),
      })
      if (!response.ok) return {}
      const data = await response.json() as { caption?: string }
      return typeof data.caption === 'string' ? { caption: data.caption } : {}
    } catch {
      return {} // 静默：视觉服务未就绪时保持预览可用，下一帧重试。
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Send one camera observation into the current conversation as context so
   * the text model can reply about what the camera sees.
   * @param context - the observation prompt (caption included).
   * @returns true when the turn was queued.
   */
  async sendCameraObservation(context: string): Promise<boolean> {
    const outcome = await this.sendCameraObservationPrompt(context)
    return outcome.ok
  }

  /**
   * 把一帧画面描述发布为宿主侧「视觉感知」：经 skill-vision.lastPerception
   * 镜像到内存，供 <perception> 系统区块与 see() 工具读取（TTL 内有效）。
   * @param text - 画面描述（模型看到的内容）。
   */
  async publishPerception(text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed === '') return
    await this.visionScope.set('lastPerception', { at: new Date().toISOString(), text: trimmed })
    // 视觉记忆：同一画面描述自动写入当前技能大脑的场景时间线（无勾选技能写全局大脑），
    // 去重合并由宿主 seeScene 完成。失败不影响感知发布（视觉记忆是尽力而为的）。
    void this.brainRemote.ingestScene({ content: trimmed }).catch(() => {})
  }

  /**
   * Build the face the section's slot registration injects.
   * @returns the snapshot hooks and the store actions.
   */
  /**
   * Build the face the camera chat dock injects (conversation.input.dock).
   */
  injectCameraChat(): CameraChatDockInjected {
    return {
      hooks: {
        vision: this.vision as HostObservable<VisionState>,
      },
      runLiveChatFrame: (frame, history) => this.runLiveChatFrame(frame, history),
      runLiveChatFrameStream: (frame, text, onDelta, reason) => this.runLiveChatFrameStream(frame, text, onDelta, reason),
      interruptVisionChat: () => this.interruptVisionChat(),
      resetVisionSession: () => this.resetVisionSession(),
      observeVisionFrame: (frame: string, diff?: number) => this.observeVisionFrame(frame, diff ?? -1),
      publishPerception: (text) => this.publishPerception(text),
      sendCameraObservation: (context) => this.sendCameraObservation(context),
      transcribeAudio: (blob) => this.transcribeMic(blob),
      speak: (text) => this.speak(text),
      stopSpeaking: () => this.stopSpeaking(),
    }
  }

  inject(): SkillStoreSectionInjected {
    return {
      hooks: {
        store: this.store as HostObservable<SkillStoreState>,
      },
      saveEnabled: (updates) => this.saveEnabled(updates),
    }
  }

  /**
   * Build the face the 视觉 settings section slot registration injects.
   * @returns the vision snapshot hook plus the persist / recognition verbs.
   */
  injectVision(): VisionSectionInjected {
    return {
      hooks: {
        vision: this.vision as HostObservable<VisionState>,
      },
      writable: this.visionScope.getSnapshot().writable,
      setVision: (patch) => this.setVision(patch),
      setVisionModel: (model: string) => this.setVisionModel(model),
      runRecognition: (image: RecognitionImage) => this.runRecognition(image),
      runVideoRecognition: (file: File) => this.runVideoRecognition(file),
      runLiveFrame: (frame: string) => this.runLiveFrame(frame),
      openCreateDraft: (draft: SkillDraft) => this.openCreateDraft(draft),
    }
  }

  /**
   * Build the face the 语音 settings section slot registration injects.
   * @returns the voice snapshot hook plus the persist / preview verbs.
   */
  injectVoice(): VoiceSectionInjected {
    return {
      hooks: {
        voice: this.voice as HostObservable<VoiceState>,
      },
      writable: this.voiceScope.getSnapshot().writable,
      setVoice: (patch) => this.setVoice(patch),
      speak: (text, config) => this.speak(text, config),
      stopSpeaking: () => this.stopSpeaking(),
    }
  }

  /**
   * Build the face the composer mic button injects: the voice snapshot plus
   * the speech-to-text verb.
   * @returns the mic button business face.
   */
  injectMic(): MicButtonInjected {
    return {
      hooks: {
        voice: this.voice as HostObservable<VoiceState>,
      },
      transcribeAudio: (blob) => this.transcribeMic(blob),
    }
  }

  /**
   * Build the face the conversation per-message read-aloud entry injects.
   * @returns the voice snapshot hook plus the play / stop verbs.
   */
  injectVoiceReply(): VoiceReplyInjected {
    return {
      hooks: {
        voice: this.voice as HostObservable<VoiceState>,
      },
      speak: (text) => this.speak(text),
      stop: () => this.stopSpeaking(),
    }
  }

  /** 刷新技能库现状（overview RPC）。 */
  async refreshOverview(): Promise<void> {
    try {
      const result = await this.brainRemote.overview()
      if (result.ok) this.overviewStore.set(result.value)
    } catch { /* RPC 不可用时保持上次快照 */ }
  }

  /** 刷新实操阅历收件箱（#实操）。 */
  async refreshExperiences(): Promise<void> {
    try {
      const result = await this.brainRemote.list()
      if (result.ok) this.practicesStore.set(result.value.items)
    } catch { /* 同上 */ }
  }

  /** 一键归位：把实操写入指定技能的大脑，随后刷新两个快照。 */
  async assignPractice(topic: string, skillId: string): Promise<boolean> {
    try {
      const result = await this.brainRemote.assign({ topic, skillId })
      if (!result.ok) return false
      await this.refreshExperiences()
      await this.refreshOverview()
      return result.value.ok
    } catch { return false }
  }

  /** 删除一条实操阅历。 */
  async removePractice(topic: string): Promise<boolean> {
    try {
      const result = await this.brainRemote.removeItem({ topic })
      if (result.ok) { await this.refreshExperiences(); return result.value }
      return false
    } catch { return false }
  }

  /** 确认一条待核对知识：内容无误，可参与归位与注入。 */
  async confirmPractice(topic: string): Promise<boolean> {
    try {
      const result = await this.brainRemote.confirm({ topic })
      if (!result.ok) return false
      await this.refreshExperiences()
      await this.refreshOverview()
      return result.value
    } catch { return false }
  }

  /** 刷新待确认记忆列表（自动除幻觉标记的疑似记忆）。 */
  async refreshPendingMemories(): Promise<void> {
    try {
      const result = await this.brainRemote.pendingMemories()
      if (result.ok) this.pendingMemoriesStore.set(result.value.items)
    } catch { /* RPC 不可用时保持上次快照 */ }
  }

  /** 处置一条待确认记忆：confirm=true 解除标记；否则删除。 */
  async memoryAction(id: number, confirm: boolean): Promise<boolean> {
    try {
      const result = await this.brainRemote.memoryAction({ id, confirm })
      if (!result.ok || !result.value.ok) return false
      await this.refreshPendingMemories()
      await this.refreshOverview()
      return true
    } catch { return false }
  }

  /** 刷新知识图谱快照；RPC 失败时置空并打日志（避免白屏误以为没反应）。 */
  async refreshGraph(skillId: string): Promise<void> {
    try {
      const result = await this.brainRemote.graph(skillId ? { skillId } : {})
      if (result.ok) {
        this.graphStore.set(result.value)
        return
      }
      this.graphStore.set({ nodes: [], edges: [] })
      console.error('[ui-skill-store] graph RPC rejected:', result.error.code, result.error.message)
    } catch (error) {
      this.graphStore.set({ nodes: [], edges: [] })
      console.error('[ui-skill-store] graph RPC failed:', error)
    }
  }

  /** 打开知识图谱视图并加载数据。 */
  openGraph(skillId: string): void {
    this.open('graph')
    void this.refreshGraph(skillId)
  }

  /** 关闭知识图谱视图，返回技能卡片墙。 */
  closeGraph(): void {
    this.open('skills')
  }

  /**
   * Build the face the skill-center overlay and hero cards inject: the center
   * view, the scanned market, the installed catalog, and the center actions.
   * @returns the shared skill-center business face.
   */
  injectCenter(): SkillCenterInjected {
    return {
      hooks: {
        center: this.center as HostObservable<SkillCenterState>,
        market: this.market as HostObservable<MarketState>,
        store: this.store as HostObservable<SkillStoreState>,
        training: this.training as HostObservable<TrainingState>,
        overview: this.overviewStore as HostObservable<SkillOverviewSnapshot | undefined>,
        practices: this.practicesStore as HostObservable<readonly BrainPracticeItem[]>,
        graphData: this.graphStore as HostObservable<BrainGraphSnapshot>,
        pendingMemories: this.pendingMemoriesStore as HostObservable<readonly BrainPendingMemory[]>,
      },
      open: (view, focusId, createDraft) => this.open(view, focusId, createDraft),
      openCreateDraft: (draft) => this.openCreateDraft(draft),
      close: () => this.close(),
      toggleWorkshop: () => this.toggleWorkshop(),
      clearWorkshopDraft: () => this.clearWorkshopDraft(),
      refreshMarket: () => this.refreshMarketRequest(),
      installMarket: (id) => this.installMarket(id),
      importSkill: (file) => this.importSkill(file),
      removeSkill: (id) => this.removeSkill(id),
      restoreRevision: (id, version) => this.restoreRevision(id, version),
      createSkill: (input) => this.createSkill(input),
      startTraining: (input) => this.startTraining(input),
      finishTraining: () => this.finishTraining(),
      cancelTraining: () => this.cancelTraining(),
      saveEnabled: (updates) => this.saveEnabled(updates),
      refreshOverview: () => this.refreshOverview(),
      refreshExperiences: () => this.refreshExperiences(),
      assignPractice: (topic, skillId) => this.assignPractice(topic, skillId),
      removePractice: (topic) => this.removePractice(topic),
      confirmPractice: (topic) => this.confirmPractice(topic),
      refreshPendingMemories: () => this.refreshPendingMemories(),
      memoryAction: (id, confirm) => this.memoryAction(id, confirm),
      openGraph: (skillId) => this.openGraph(skillId),
      closeGraph: () => this.closeGraph(),
    }
  }

  /**
   * Build the face the conversation training dock injects (训练模式 banner
   * above the composer on the training session).
   * @returns the training snapshot hook plus the finish / cancel verbs.
   */
  injectTraining(): TrainingDockInjected {
    return {
      hooks: {
        training: this.training as HostObservable<TrainingState>,
        distill: this.distillStore as HostObservable<DistillNotice | undefined>,
      },
      finishTraining: () => this.finishTraining(),
      cancelTraining: () => this.cancelTraining(),
    }
  }
}

/**
 * Client plugin body: register the dictionaries, the 平权技能设置 section, the
 * hero quick-action cards and the full-screen skill center.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-store: dictionaries')
  const t = ctx.locale.bind(NS)

  // Conversation/sessions power the one-click retrain entry: the workshop
  // sends the user's requested change straight into the current conversation
  // and the agent loop turns it into a new revision (skill-generate tool).
  ctx.inject(['slots', 'locale', 'settingsScope', 'remote', 'sessions', 'workspaces', 'remote.diechiBrain'], (scope: ClientContext) => {
    type SessionId = Parameters<typeof scope.sessions.scope>[0]
    const ensureConversation = async (): Promise<SendOutcome<SessionId>> => {
      const sessions = scope.sessions as unknown as {
        create(opts?: unknown): Promise<Parameters<typeof scope.sessions.scope>[0]>,
        open(id: Parameters<typeof scope.sessions.scope>[0]): void,
      }
      let current = scope.sessions.list.getSnapshot().current
      if (current === undefined) {
        // Mirror the New Session flow instead of a bare host create: attach
        // the recent workspace (reusing its blank session when present) so
        // the created session is grouped and the host accepts the prompt RPC.
        try {
          const workspaces = scope.workspaces.list.getSnapshot()
          const workspaceId = workspaces.recentWorkspaceId
          current = workspaceId === undefined
            ? await sessions.create()
            : await scope.workspaces.connectWorkspace(workspaceId)
          sessions.open(current)
        } catch (error) {
          console.error('ui-skill-store retrain: auto-create session failed', error)
          return { ok: false, error: 'no-session' }
        }
      }
      return { ok: true, sessionId: current }
    }
    const sendToSession = async (sessionId: SessionId, prompt: string): Promise<boolean> => {
      // The conversation service is not injected into agent scopes, so reach
      // the session binding directly: the same `session.prompt` RPC the
      // composer's send path uses (queue a turn).
      const binding = scope.sessions.binding(sessionId)
      if (binding === undefined) {
        console.error('ui-skill-store retrain: no session binding for', sessionId)
        return false
      }
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30000))
      const attempt = (async (): Promise<boolean> => {
        try {
          const result = await binding.session.prompt([{ type: 'text', text: prompt }], 'queue')
          if (!result.ok) throw new Error(`session.prompt failed: ${result.error.code}: ${result.error.message}`)
          return true
        } catch (error) {
          console.error('ui-skill-store retrain: session.prompt failed', error)
          return false
        }
      })()
      if (await Promise.race([attempt, timeout])) return true
      console.error('ui-skill-store retrain: session.prompt timed out', prompt.slice(0, 80))
      return false
    }
    const sendToConversation = async (prompt: string): Promise<RetrainResult> => {
      const session = await ensureConversation()
      if (!session.ok) return session
      return (await sendToSession(session.sessionId, prompt))
        ? { ok: true }
        : { ok: false, error: 'no-session' }
    }
    const sendToConversationWithId = async (prompt: string): Promise<SendOutcome<SessionId>> => {
      const session = await ensureConversation()
      if (!session.ok) return session
      return (await sendToSession(session.sessionId, prompt))
        ? { ok: true, sessionId: session.sessionId }
        : { ok: false, error: 'no-session' }
    }
    const createPrompt = (input: CreateSkillInput): string => {
      const lines: string[] = []
      if (input.name.trim() !== '') lines.push(t('createPromptTitle').replace('{name}', input.name.trim()))
      lines.push(t('createPromptPurpose').replace('{text}', input.purpose.trim()))
      if (input.steps.trim() !== '') lines.push(t('createPromptSteps').replace('{text}', input.steps.trim()))
      if (input.rules.trim() !== '') lines.push(t('createPromptRules').replace('{text}', input.rules.trim()))
      if (input.references.trim() !== '') lines.push(t('createPromptReferences').replace('{text}', input.references.trim()))
      lines.push(t('createPromptTail'))
      return lines.join('\n\n')
    }
    // 训练模式 guide prompt: opens the round and tells the user (and the
    // agent) how to feed corpus / video material before 完成训练.
    const buildTrainingGuide = (input: TrainingStartInput): string => {
      const title = t('trainingGuideTitle').replace('{title}', input.skillTitle)
      const mode = input.mode === 'retrain'
        ? t('trainingGuideModeRetrain').replace('{id}', input.skillId ?? '')
        : t('trainingGuideModeCreate')
      const body = t('trainingGuideBody')
      const requirement = input.description.trim() === ''
        ? ''
        : `\n\n${t('trainingGuideRequirement')}\n${input.description.trim()}`
      return [title, mode, body, requirement].join('\n\n').trim()
    }
    const buildTrainingFinish = (state: TrainingState): string =>
      state.mode === 'retrain'
        ? t('trainingFinishPromptRetrain')
          .replace('{id}', state.skillId)
          .replace('{title}', state.skillTitle)
        : t('trainingFinishPromptCreate').replace('{title}', state.skillTitle)
    const controller = new SkillStoreController(
      scope.settingsScope.bind({ namespace: 'skill-store' }),
      scope.settingsScope.bind({ namespace: 'skill-vision' }),
      scope.settingsScope.bind({ namespace: 'skill-voice' }),
      scope.settingsScope.bind({ namespace: 'skill-market' }),
      scope.settingsScope.bind({ namespace: 'skill-training' }),
      scope.settingsScope.bind({ namespace: 'skill-distill' }),
      async (id, description): Promise<RetrainResult> => sendToConversation(
        `${t('workshopConversationCopy').replace('{id}', id)}\n\n${t('retrainPromptSuffix').replace('{text}', description.trim())}`,
      ),
      async (input): Promise<RetrainResult> => sendToConversation(createPrompt(input)),
      async (input): Promise<SendOutcome> => sendToConversationWithId(buildTrainingGuide(input)),
      async (state): Promise<boolean> => sendToSession(state.sessionId as SessionId, buildTrainingFinish(state)),
      async (context): Promise<RetrainResult> => sendToConversation(context),
      scope.remote.diechiBrain as unknown as DiechiBrainRemoteLike,
    )

    // Bottom-left settings: 平权技能设置 (settings stay inside settings; the
    // store and the workshop live outside it in the skill center).

    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section',
      id: 'skill-store',
      order: 25,
      label: () => t('nav'),
      locale: NS,
      inject: () => controller.inject(),
    }, SkillStoreSection))

    // 蝶翅三入口导航：对话 / 平权技能 / 阅历（sidebar 顶部 tab 条）。
    scope.slots.inject('sidebar.nav', () => scope.slots.register({
      name: 'sidebar.nav',
      id: 'skill-nav',
      order: 100,
      locale: NS,
      inject: () => controller.injectCenter(),
    }, SkillNav))

    // 侧边工坊面板（平权技能工坊）：已安装技能管理 + 新建 + 导入，住在侧边栏。
    scope.slots.inject('sidebar.workshop', () => scope.slots.register({
      name: 'sidebar.workshop',
      locale: NS,
      inject: () => controller.injectCenter(),
    }, SkillWorkshopPanel))
    
    // Bottom-left settings: 视觉 — local-vision configuration (enable switch,
    // endpoint, model, camera caption cadence) plus the recognition entry
    // points that turn what the model sees into a skill draft.
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section',
      id: 'vision',
      order: 26,
      label: () => t('visionNav'),
      locale: NS,
      inject: () => controller.injectVision(),
    }, VisionSection))

    // Bottom-left settings: 语音 — reply-to-speech configuration with a
    // provider switch (local Kokoro / OpenAI-compatible API).
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section',
      id: 'voice',
      order: 24,
      label: () => t('voiceNav'),
      locale: NS,
      inject: () => controller.injectVoice(),
    }, VoiceSection))

    // Conversation: per-message read-aloud speaker in the assistant action
    // strip (auto-reads new replies when enabled in the 语音 settings).
    scope.slots.inject('conversation.chat.assistant-actions', () => scope.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'voice-reply',
      order: 20,
      locale: NS,
      inject: () => controller.injectVoiceReply(),
    }, VoiceReplyActions))

    // Training dock (训练模式): the 完成训练 banner above the composer on the
    // session the training round lives in.
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'skill-training',
      order: 100,
      locale: NS,
      inject: () => controller.injectTraining(),
    }, TrainingDock))

    // Camera chat dock (摄像头对话): toggle row + live preview above the composer.
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'skill-camera',
      order: 90,
      locale: NS,
      inject: () => controller.injectCameraChat(),
    }, CameraChatDock))

    // Composer mic button (按住说话): speech-to-text into the draft when the
    // 语音 settings enable speech input.
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'skill-mic',
      order: 200,
      locale: NS,
      inject: () => controller.injectMic(),
    }, MicButton))

    // Full-screen skill center (卡片墙 / 阅历 / 商店), above every column.
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay',
      id: 'skill-center',
      order: 100,
      label: () => t('centerTitle'),
      locale: NS,
      inject: () => controller.injectCenter(),
    }, SkillCenterOverlay))
  })
}
