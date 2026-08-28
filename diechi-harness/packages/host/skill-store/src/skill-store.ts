/**
 * Skill 商店 host plugin: bridges the durable `skill.store` / `skill.vision`
 * settings namespaces onto the runtime skill registry (`ctx.skills`).
 *
 * The store owns one generic, versioned skill manifest (`SkillManifestEntry`)
 * so a skill can come from anywhere — a built-in default, a user import, or
 * the reserved local-vision generation pipeline — and still reach the model
 * and the user slash menu through the one standard `ctx.skills.register`
 * path. The client half (dsh-client-ui-skill-store) renders the settings
 * section; this half is the authority that turns the stored catalog into
 * live runtime skills.
 *
 * Entries whose `content` is empty are listed as "content pending" and are
 * NOT registered: the harness skill loader injects the body verbatim, so an
 * empty body would be a silent no-op. The store UI marks them until import or
 * the `skill-generate` tool fills them in.
 *
 * @module @deepseek-ai/dsh-host-skill-store
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SkillInvocationPolicy, SkillRegistration } from '@deepseek-ai/dsh-skill'
// Type-only: pull the `ctx.settings` and `ctx.skills` Context merges.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
// Type-only: session event stream for conversation auto-ingestion (对话自动归纳).
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, BlockAssembler, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dshHomeDir, normalizeMemoryText, PersonBrain, type PersonKnowledge, type PersonMemory, type PersonScene } from './person-brain'

/** Stable Cordis plugin name. */
export const name = 'skill-store'

/** Services required before the catalog can bridge to the skill registry. */
export const inject = ['settings', 'skills', 'systemPrompt', 'tools', 'llm', 'agentDefaultModel']

// 消费方服务（可选）：diechi-brain 插件提供时，recall 合并全局实操阅历。
// agentDefaultModel 服务：辅助 LLM 调用（提炼/归类）走用户配置的默认模型路由。
declare module '@deepseek-ai/cordis' {
  interface Context {
    diechiBrain?: {
      recallPractice(query: string, limit: number): PersonKnowledge[]
    }
    agentDefaultModel: {
      currentSelection(): { provider: string; model: string; reasoningEffort?: string }
    }
    /**
     * diechi-supervisor 提供的 ctx.supervision（基座保护层）。
     * 启动时由 dsh-host-diechi-supervisor 注入；
     * skill-store 启动后会把所有 open 的 PersonBrain attach 到它上面。
     */
    supervision?: {
      attachBrain(brain: { setSupervisionContext(ctx: unknown): void }): void
    }
  }
}

/** Settings namespace owning the installed skill catalog. */
export const SKILL_STORE_NS = 'skill-store'

/** Settings namespace owning the reserved local-vision configuration. */
export const SKILL_VISION_NS = 'skill-vision'

/** Settings namespace owning the reply-to-speech (voice) configuration. */
export const SKILL_VOICE_NS = 'skill-voice'

/** Settings namespace owning the scanned local market catalog. */
export const SKILL_MARKET_NS = 'skill-market'

/** Settings namespace owning the in-flight training session (训练模式). */
export const SKILL_TRAINING_NS = 'skill-training'

/** Settings namespace owning the last conversation-distill notice (对话自动归纳通知). */
export const SKILL_DISTILL_NS = 'skill-distill'

/** Invocation controls of one manifest entry (both surfaces default to true). */
export interface SkillManifestInvocation {
  /** Whether model-facing catalogs include this skill. */
  readonly modelInvocable: boolean
  /** Whether the user slash menu includes this skill. */
  readonly userInvocable: boolean
}

/** One immutable snapshot of a skill body, kept for history and rollback. */
export interface SkillManifestRevision {
  /** Semantic-ish version label of this snapshot. */
  readonly version: string
  /** Markdown instruction body at this revision. */
  readonly content: string
  /** ISO timestamp of when the revision was written. */
  readonly updatedAt: string
  /** Short human note describing the change (training round / restore). */
  readonly note: string
}

/** Optional authoring and provenance metadata on a manifest entry. */
export interface SkillManifestMetadata {
  /** Original author label (display only). */
  readonly author?: string
  /** Current manifest version; revisions carry the per-snapshot labels. */
  readonly version?: string
  /** Free-form discovery tags. */
  readonly tags?: readonly string[]
  /** Training regression samples: expected example inputs/outputs. */
  readonly examples?: readonly string[]
  /** ISO timestamp of the latest change. */
  readonly updatedAt?: string
  /** License hint for shared skills. */
  readonly license?: string
  /** Where the skill came from (file path / market origin / builtin). */
  readonly origin?: string
}

/**
 * Generic, versioned skill manifest — the import/export and store format.
 *
 * One physical line per paragraph. `id` doubles as the slash command name
 * (`/id` in the composer). `content` is the markdown body the harness injects
 * verbatim; an empty body marks a pending entry. `source` records provenance
 * so the store UI can label built-ins, imports, generated and trained skills.
 * `revisions` keeps every training round so an older body can be exported or
 * restored. v1 entries (no `status`/`revisions`) are migrated on read.
 */
export interface SkillManifestEntry {
  /** Manifest format version; 2 is the current release (adds status/revisions). */
  readonly formatVersion: number
  /** Kebab-case id; also the user slash command name. */
  readonly id: string
  /** Human-readable display title. */
  readonly title: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Extra routing guidance; empty when the entry carries none. */
  readonly whenToUse: string
  /** Surface tag: a text skill or a vision-model skill. */
  readonly kind: 'text' | 'vision'
  /** Lifecycle state: draft skills are not user-facing until published. */
  readonly status: 'draft' | 'testing' | 'published'
  /** Checked as an active conversation persona. */
  readonly enabled: boolean
  /** Invocation controls; both surfaces default to true. */
  readonly invocation: SkillManifestInvocation
  /** Markdown instruction body; empty marks content as pending. */
  readonly content: string
  /** Provenance of the definition. */
  readonly source: 'builtin' | 'imported' | 'generated' | 'trained' | 'market'
  /** Every snapshot of this skill, newest last; at least one entry once content exists. */
  readonly revisions: readonly SkillManifestRevision[]
  /** Optional authoring metadata. */
  readonly metadata?: SkillManifestMetadata
}

/** The persisted catalog section. */
export interface SkillStoreSettings {
  /** All installed skills, in store order. */
  readonly skills: readonly SkillManifestEntry[]
}

/** The reserved local-vision configuration section. */
export interface SkillVisionSettings {
  /** Whether the (reserved) recognition pipeline is enabled. */
  readonly enabled: boolean
  /** Base URL of the locally deployed vision model endpoint. */
  readonly endpoint: string
  /** Model name served by the endpoint. */
  readonly model: string
  /** Live camera caption cadence in seconds (3/5/10/15). */
  readonly intervalSec: number
  /** Voice-chat mode: camera chat speaks replies and accepts hold-to-talk. */
  readonly voiceChat: boolean
  /** Auto-send the latest caption to the main chat every N seconds (0 = off). */
  readonly chatIntervalSec: number
}

/** The reply-to-speech (voice) configuration section. */
export interface SkillVoiceSettings {
  /** Master switch: whether reply-to-speech is on at all. */
  readonly enabled: boolean
  /** Whether a freshly finished assistant reply plays aloud automatically. */
  readonly autoSpeak: boolean
  /** TTS backend: the local Kokoro service, or an OpenAI-compatible speech API. */
  readonly provider: 'local' | 'openai'
  /** Base URL of the TTS service (local server or the API base). */
  readonly endpoint: string
  /** API key sent to the OpenAI-compatible provider; local ignores it. */
  readonly apiKey: string
  /** Model name sent to the provider (OpenAI-compatible); local ignores it. */
  readonly model: string
  /** Voice id / name (Kokoro: zf_001/zf_018/zm_010/zm_016). */
  readonly voice: string
  /** Speaking-rate multiplier. */
  readonly speed: number
  /** Whether the composer microphone (speech-to-text) input is enabled. */
  readonly asrEnabled: boolean
}

/** One discoverable skill in the local market directory. */
export interface SkillMarketSkill {
  /** Kebab-case id; doubles as the slash command /id. */
  readonly id: string
  /** Human-readable display title. */
  readonly title: string
  /** Short routing description. */
  readonly description: string
  /** Extra routing guidance. */
  readonly whenToUse: string
  /** Surface tag: text or vision. */
  readonly kind: 'text' | 'vision'
  /** Manifest version label. */
  readonly version: string
  /** Original author label (display only). */
  readonly author?: string
  /** Free-form discovery tags. */
  readonly tags: readonly string[]
  /** Full SKILL.md instruction body (install = write into skill.store). */
  readonly content: string
}

/** The scanned local market catalog section (read-only from the client). */
export interface SkillMarketSettings {
  /** Absolute path of the scanned market directory. */
  readonly dir: string
  /** All discoverable skills, in file order. */
  readonly skills: readonly SkillMarketSkill[]
}

/** Built-in definitions shipped by this plugin. Content is intentionally empty (待生成). */
export const BUILTIN_SKILLS: readonly SkillManifestEntry[] = [
  {
    formatVersion: 2,
    id: 'sqe-8d',
    title: 'SQE客诉处理',
    description: '用 8D 方法处理供应商质量问题和客户投诉。',
    whenToUse: '',
    kind: 'text',
    status: 'published',
    enabled: false,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'builtin',
    content: '',
    revisions: [],
    metadata: { version: '1.0.0', author: '蝶翅内置', tags: ['质量', '客诉'] },
  },
  {
    formatVersion: 2,
    id: 'legal-consult',
    title: '法律咨询顾问',
    description: '法律法规咨询、合同与风险分析。',
    whenToUse: '',
    kind: 'text',
    status: 'published',
    enabled: false,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'builtin',
    content: '',
    revisions: [],
    metadata: { version: '1.0.0', author: '蝶翅内置', tags: ['法律', '合同'] },
  },
  {
    formatVersion: 2,
    id: 'customer-service',
    title: '客户服务专员',
    description: '客户接待、答疑与问题跟进。',
    whenToUse: '',
    kind: 'text',
    status: 'published',
    enabled: false,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'builtin',
    content: '',
    revisions: [],
    metadata: { version: '1.0.0', author: '蝶翅内置', tags: ['客服'] },
  },
  {
    formatVersion: 2,
    id: 'hr-management',
    title: '人力资源专员',
    description: '招聘、绩效与人事制度咨询。',
    whenToUse: '',
    kind: 'text',
    status: 'published',
    enabled: false,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'builtin',
    content: '',
    revisions: [],
    metadata: { version: '1.0.0', author: '蝶翅内置', tags: ['人力', '招聘'] },
  },
]

const invocationSchema = z.object({
  modelInvocable: z.boolean().required(false),
  userInvocable: z.boolean().required(false),
})

const revisionSchema = z.object({
  version: z.string(),
  content: z.string(),
  updatedAt: z.string(),
  note: z.string().required(false),
})

const metadataSchema = z.object({
  author: z.string().required(false),
  version: z.string().required(false),
  tags: z.array(z.string()).required(false),
  examples: z.array(z.string()).required(false),
  updatedAt: z.string().required(false),
  license: z.string().required(false),
  origin: z.string().required(false),
})

const skillManifestSchema = z.object({
  formatVersion: z.number().default(2),
  id: z.string(),
  title: z.string(),
  description: z.string(),
  whenToUse: z.string().required(false),
  kind: z.union(['text', 'vision']).default('text'),
  status: z.union(['draft', 'testing', 'published']).default('published'),
  enabled: z.boolean().default(false),
  invocation: invocationSchema.required(false),
  content: z.string().default(''),
  source: z.union(['builtin', 'imported', 'generated', 'trained', 'market']).default('imported'),
  revisions: z.array(revisionSchema).default([]),
  metadata: metadataSchema.required(false),
})

/** Durable catalog schema; built-ins arrive as the composition default. */
const skillStoreSchema = z.object({
  // The spread drops the readonly markers so the schema default accepts the
  // literal catalog; runtime entries are normalized by normalizeEntry anyway.
  // `as never` bridges the readonly interface to the schema output type; the
  // literal catalog is validated at runtime by the schema before first use.
  skills: z.array(skillManifestSchema).default(
    BUILTIN_SKILLS.map(entry => ({ ...entry, revisions: [...entry.revisions] })) as never,
  ),
})

/** Durable vision configuration schema (预留). */
const visionSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().default(''),
  model: z.string().default(''),
  intervalSec: z.number().default(5),
  voiceChat: z.boolean().default(false),
  chatIntervalSec: z.number().default(0),

  // 最近一帧视觉感知（客户端在摄像头会话中发布；宿主镜像进内存供
  // <perception> 区块与 see() 工具读取，TTL 内有效）。
  lastPerception: z.object({ at: z.string(), text: z.string() }).required(false),
  // 视频投喂识别的实操过程（客户端识别完成后发布；宿主自动写入当前
  // 人格大脑的 knowledge，打「实操」标签，供技能提炼时引用）。
  videoProcess: z.object({
    at: z.string(),
    name: z.string(),
    process: z.string(),
  }).required(false),
})

const voiceSchema = z.object({
  enabled: z.boolean().default(false),
  autoSpeak: z.boolean().default(false),
  provider: z.union(['local', 'openai']).default('local'),
  endpoint: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  voice: z.string().default('zf_001'),
  speed: z.number().default(1),
  asrEnabled: z.boolean().default(false),
})

/**
 * One in-flight training session (训练模式): a conversation stays open for
 * the user to feed corpus / video material or have the agent collect data,
 * and the "完成训练" button (conversation dock + skill center) closes the
 * round by asking the agent to run skill-generate. Persisted so the active
 * training survives a reload.
 */
const trainingSchema = z.object({
  active: z.boolean().default(false),
  mode: z.union(['retrain', 'create']).default('retrain'),
  /** Retrain target id; empty for create mode (the agent mints the id). */
  skillId: z.string().default(''),
  /** Human title shown in the training banner. */
  skillTitle: z.string().default(''),
  /** The conversation the training lives in (dock shows on that session only). */
  sessionId: z.string().default(''),
  startedAt: z.number().default(0),
})

/**
 * One conversation-distill notice (对话自动归纳通知): the host writes the
 * latest auto-ingested turn so the client can show a transient "已记入大脑"
 * hint on the conversation it happened in. Latest-wins; the client renders
 * one notice per session, keyed by seq it computes itself.
 */
const distillSchema = z.object({
  /** ISO timestamp of the distilled turn (changes trigger the client hint). */
  at: z.string().required(false),
  /** Session the distillation happened in (the hint only shows there). */
  sessionId: z.string().required(false),
  /** Distilled knowledge topic (e.g. "对话：用户饮食偏好"). */
  topic: z.string().required(false),
  /** Human-readable destination: skill title, 杂库, or 全局收件箱. */
  target: z.string().required(false),
})

/** One discoverable market skill (schema twin of SkillMarketSkill). */
const marketSkillSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  whenToUse: z.string().default(''),
  kind: z.union(['text', 'vision']).default('text'),
  version: z.string().default('1.0.0'),
  author: z.string().required(false),
  tags: z.array(z.string()).default([]),
  content: z.string().default(''),
})

/** Scanned market catalog schema. */
const skillMarketSchema = z.object({
  dir: z.string().default(''),
  skills: z.array(marketSkillSchema).default([]),
  // Client writes this tick to ask for a re-scan; the watch below turns it
  // into an actual directory scan and republish.
  refreshTick: z.number().default(0),
})

/**
 * Migrate one stored entry to the current manifest shape. v1 entries (no
 * `status`/`revisions`) gain a published status and a single seed revision
 * derived from their body so history, export and restore always have a
 * baseline. v2 entries pass through untouched.
 * @param raw - the stored entry (schema defaults already applied).
 * @returns the normalized entry.
 */
function normalizeEntry(raw: SkillManifestEntry): SkillManifestEntry {
  const status = raw.status ?? 'published'
  let revisions = raw.revisions ?? []
  if (revisions.length === 0 && raw.content.trim() !== '') {
    revisions = [{
      version: raw.metadata?.version ?? '1.0.0',
      content: raw.content,
      updatedAt: raw.metadata?.updatedAt ?? new Date().toISOString(),
      note: '初始版本',
    }]
  }
  return { ...raw, formatVersion: 2, status, revisions }
}

/** Map one manifest entry onto the runtime registration shape. */
function toSkillRegistration(entry: SkillManifestEntry): SkillRegistration {
  return {
    name: entry.id,
    description: entry.description,
    whenToUse: entry.whenToUse,
    invocation: {
      modelInvocable: entry.invocation.modelInvocable ?? true,
      userInvocable: entry.invocation.userInvocable ?? true,
    } satisfies SkillInvocationPolicy,
    content: entry.content,
    source: 'runtime',
    provider: 'skill-store',
  }
}

/** Bump a three-part version label: 1.0.0 → 1.1.0 → 1.2.0 → 2.0.0. */
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

/** One `skill-generate` tool invocation's resolved outcome. */
export interface SkillGenerateResult {
  /** The skill id the tool upserted. */
  readonly id: string
  /** Lifecycle state after the write. */
  readonly status: 'draft' | 'published'
  /** Version label of the newest revision. */
  readonly version: string
  /** Total revision count after the write. */
  readonly revisionCount: number
  /** Whether the skill is registered for runtime use (published + non-empty). */
  readonly active: boolean
}

/**
 * Upsert one entry from a training round. New skills start as drafts; a
 * retrain of an existing skill keeps its flags and appends a revision.
 * @param entries - the current catalog.
 * @param input - the model-produced definition.
 * @returns the new catalog plus the resolved entry.
 */
function upsertTrainedSkill(
  entries: readonly SkillManifestEntry[],
  input: {
    readonly id: string
    readonly title?: string
    readonly description: string
    readonly whenToUse?: string
    readonly kind?: 'text' | 'vision'
    readonly content: string
    readonly note?: string
    readonly publish?: boolean
  },
): { readonly entries: SkillManifestEntry[]; readonly entry: SkillManifestEntry } {
  const existing = entries.find(entry => entry.id === input.id)
  const baseVersion = existing?.metadata?.version ?? '1.0.0'
  const nextVersion = existing === undefined ? '1.0.0' : bumpVersion(baseVersion)
  const updatedAt = new Date().toISOString()
  const revision: SkillManifestRevision = {
    version: nextVersion,
    content: input.content,
    updatedAt,
    note: input.note ?? (existing === undefined ? '初始生成' : '再训练修订'),
  }
  const entry: SkillManifestEntry = {
    formatVersion: 2,
    id: input.id,
    title: input.title?.trim() !== '' && input.title !== undefined ? input.title : (existing?.title ?? input.id),
    description: input.description,
    whenToUse: input.whenToUse ?? existing?.whenToUse ?? '',
    kind: input.kind === 'vision' ? 'vision' : 'text',
    status: input.publish === true ? 'published' : 'draft',
    enabled: existing?.enabled ?? false,
    invocation: existing?.invocation ?? { modelInvocable: true, userInvocable: true },
    content: input.content,
    source: 'trained',
    revisions: existing === undefined ? [revision] : [...existing.revisions, revision],
    metadata: {
      ...(existing?.metadata ?? {}),
      version: nextVersion,
      updatedAt,
      ...(existing?.metadata?.author !== undefined ? {} : { author: '用户训练' }),
    },
  }
  const next = existing === undefined
    ? [...entries, entry]
    : entries.map(candidate => candidate.id === input.id ? entry : candidate)
  return { entries: next, entry }
}

/**
 * Input a future recognition pipeline accepts. Reserved for a locally
 * deployed vision model; no production implementation ships yet.
 */
export type SkillGenerationSource =
  | { readonly kind: 'video'; readonly name: string; readonly data: unknown }
  | { readonly kind: 'camera' }

/** One recognition run's output: generated skill manifests. */
export interface SkillGenerationResult {
  /** Generated definitions, ready to persist into `skill.store`. */
  readonly skills: readonly SkillManifestEntry[]
}

/**
 * The reserved generation seam: a locally deployed vision model implements
 * this to turn video/camera captures into skill definitions. Wire the future
 * implementation in {@link createSkillGenerator} without touching the UI.
 */
export interface SkillGenerator {
  /**
   * Recognize one video/camera source and produce skill definitions.
   * @param source - the captured media input.
   * @returns generated definitions.
   */
  generate(source: SkillGenerationSource): Promise<SkillGenerationResult>
}

/** Placeholder implementation that always reports the feature as reserved. */
class ReservedSkillGenerator implements SkillGenerator {
  /**
   * @param _source - captured media input (ignored by the placeholder).
   * @throws always, with a reserved-feature message.
   */
  async generate(_source: SkillGenerationSource): Promise<SkillGenerationResult> {
    throw new Error('skill-store: 视频/摄像头识别生成技能为预留功能，尚未接入本地视觉模型')
  }
}

/**
 * Active generator factory. Swap the ReservedSkillGenerator for the local
 * vision model client when that pipeline lands; the settings UI and the
 * store format do not change.
 * @returns the active generator instance.
 */
export function createSkillGenerator(): SkillGenerator {
  return new ReservedSkillGenerator()
}


/**
 * Resolve the local market directory: `$DSH_HOME/skill-market`, or
 * `~/.dsh/skill-market` when DSH_HOME is unset.
 * @returns the absolute market directory path.
 */
function skillMarketDir(): string {
  const fromEnv = (process.env.DSH_HOME ?? '').trim()
  const home = fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
  return join(home, 'skill-market')
}

/**
 * Parse a `---\nkey: value\n---` envelope into a scalar data map plus the
 * markdown body. Minimal by design: the local market format is flat
 * scalars; anything the parser cannot read is skipped, never fatal.
 * @param text - raw file text.
 * @returns the frontmatter map and the trailing body.
 */
function parseMarketFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {}
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { data, body: text }
  let index = 1
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '---') {
      index += 1
      break
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (key !== '') data[key] = value
  }
  return { data, body: lines.slice(index).join('\n').trim() }
}

/** Split a comma list into trimmed, non-empty tags. */
function parseTagList(raw: unknown): readonly string[] {
  if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === 'string')
  if (typeof raw !== 'string') return []
  return raw.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
}

/** Build one market skill from a SKILL.md document; undefined when invalid. */
function marketSkillFromMarkdown(text: string): SkillMarketSkill | undefined {
  const { data, body } = parseMarketFrontmatter(text)
  const id = (data.name ?? '').trim()
  if (id === '' || !isSkillName(id) || body === '') return undefined
  const title = (data.title ?? '').trim()
  const author = (data.author ?? '').trim()
  return {
    id,
    title: title !== '' ? title : id,
    description: (data.description ?? '').trim(),
    whenToUse: (data['when-to-use'] ?? '').trim(),
    kind: data.kind === 'vision' ? 'vision' : 'text',
    version: (data.version ?? '1.0.0').trim(),
    ...(author !== '' ? { author } : {}),
    tags: parseTagList(data.tags ?? ''),
    content: body,
  }
}

/** Build one market skill from a generic JSON entry; undefined when invalid. */
function marketSkillFromJson(raw: unknown): SkillMarketSkill | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const entry = raw as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (id === '' || !isSkillName(id)) return undefined
  const content = typeof entry.content === 'string' ? entry.content.trim() : ''
  if (content === '') return undefined
  const title = typeof entry.title === 'string' ? entry.title.trim() : ''
  const author = typeof entry.author === 'string' ? entry.author.trim() : ''
  return {
    id,
    title: title !== '' ? title : id,
    description: typeof entry.description === 'string' ? entry.description : '',
    whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
    kind: entry.kind === 'vision' ? 'vision' : 'text',
    version: typeof entry.version === 'string' ? entry.version : '1.0.0',
    ...(author !== '' ? { author } : {}),
    tags: parseTagList(entry.tags),
    content,
  }
}

/**
 * Scan the local market directory. Each readable `*.md` / `*.json` file
 * becomes one or more catalog entries; malformed or unreadable files are
 * skipped so a stray file never breaks the store page.
 * @returns the discovered skills, in file order.
 */
async function scanSkillMarket(): Promise<SkillMarketSkill[]> {
  const dir = skillMarketDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const skills: SkillMarketSkill[] = []
  for (const file of [...files].sort()) {
    if (!/\.(md|json)$/i.test(file)) continue
    try {
      const text = await readFile(join(dir, file), 'utf8')
      if (/\.md$/i.test(file)) {
        const skill = marketSkillFromMarkdown(text)
        if (skill !== undefined) skills.push(skill)
      } else {
        const parsed: unknown = JSON.parse(text)
        const raws: unknown[] = Array.isArray(parsed)
          ? parsed
          : typeof parsed === 'object' && parsed !== null
              && Array.isArray((parsed as Record<string, unknown>).skills)
            ? (parsed as Record<string, unknown>).skills as unknown[]
            : [parsed]
        for (const raw of raws) {
          const skill = marketSkillFromJson(raw)
          if (skill !== undefined) skills.push(skill)
        }
      }
    } catch {
      // unreadable or malformed market file — skip it
    }
  }
  return skills
}

/**
 * Bridge plugin body: register the two namespaces, reconcile the catalog
 * onto runtime skill registrations, and expose the model-facing
 * `skill-generate` tool that turns a user-described workflow into a draft or
 * published skill — the text-side half of 全民训练.
 * @param ctx - Host context carrying the settings and skill services.
 */
export function apply(ctx: Context): void {
  const store = ctx.settings.register(settingsNamespace(SKILL_STORE_NS), skillStoreSchema)
  const vision = ctx.settings.register(settingsNamespace(SKILL_VISION_NS), visionSchema)
  ctx.settings.register(settingsNamespace(SKILL_VOICE_NS), voiceSchema)
  ctx.settings.register(settingsNamespace(SKILL_TRAINING_NS), trainingSchema)
  const distill = ctx.settings.register(settingsNamespace(SKILL_DISTILL_NS), distillSchema)

  // 全局大脑（$DSH_HOME/brain.db）：对话提炼/视频实操/联网知识的统一收件箱，
  // 自动归类后归位到技能大脑；随插件生命周期释放句柄。
  const globalBrain = PersonBrain.openGlobal()
  // 三架构基座保护：把全局大脑接入 ctx.supervision（由 dsh-host-diechi-supervisor 注入）。
  // 若 ctx.supervision 不存在（如未挂监督者），PersonBrain 写入时仍会抛 SupervisionMissingError——
  // 这是基座保护的核心：不挂监督者 = 拒绝一切业务写入。
  ctx.effect(() => {
    const supervision = ctx.get('supervision')
    if (supervision !== undefined) {
      supervision.attachBrain(globalBrain)
    }
    return () => { globalBrain.close() }
  }, 'skill-store: 接入监督者并释放全局大脑')

  // 主脑自动整理节流计数：每 5 轮成功归纳触发一次 tidy（合并/清理/提炼）。
  let tidyCounter = 0

  // 视觉记忆自动清洗调度：高频画面理解会持续写入场景时间线，每 10 分钟对
  // 全局大脑与所有已物化的人格大脑做一次合并/淘汰（相邻同内容合并、超上限淘汰），
  // 避免内存/磁盘被重复画面刷爆；随插件生命周期自动停止。
  ctx.effect(() => {
    const cleanup = (): void => {
      try { globalBrain.cleanupScenes(2000) } catch { /* 大脑瞬时关闭：跳过 */ }
      for (const brain of brains.values()) {
        try { brain.cleanupScenes(2000) } catch { /* 瞬时关闭：跳过 */ }
      }
    }
    cleanup()
    const timer = globalThis.setInterval(cleanup, 10 * 60_000)
    return () => globalThis.clearInterval(timer)
  }, 'skill-store: 视觉记忆自动清洗调度')

  // 供消费插件（如 diechi-brain）注入的服务：平权技能目录与视觉配置作用域。
  ctx.provide('skillStore', store as never)
  ctx.provide('skillVision', vision as never)

  // Local skill market (商店): scan <dsh-home>/skill-market/ into a read-only
  // settings namespace the store page renders. The scan runs at boot and on
  // every conversation-side refresh (the skill-market-refresh tool), so new
  // files dropped into the folder appear without restarting the server.
  const market = ctx.settings.register(settingsNamespace(SKILL_MARKET_NS), skillMarketSchema)
  const scanAndPublish = async (): Promise<SkillMarketSkill[]> => {
    const skills = await scanSkillMarket()
    const current = market.get()
    const changed = JSON.stringify(current.skills) !== JSON.stringify(skills)
    if (changed) await market.update({ skills, dir: skillMarketDir() })
    return skills
  }
  // Every market change (including the client's refreshTick bump) re-scans the
  // directory; the changed guard inside scanAndPublish stops the loop.
  market.watch(() => { void scanAndPublish().catch(() => {}) })
  void scanAndPublish().catch(() => {})
  const refreshMarketTool = defineTool({
    name: 'skill-market-refresh',
    description: 'Re-scan the local skill market directory ($DSH_HOME/skill-market/) and publish the updated catalog. '
      + 'Call this after the user drops a SKILL.md or JSON file into the market folder.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true },
          dir: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { count: number; dir: string }
        return [{ type: 'text', text: `skill market refreshed: ${result.count} skills in ${result.dir}` }]
      },
    },
    async execute() {
      const skills = await scanAndPublish()
      return { count: skills.length, dir: skillMarketDir() }
    },
  })
  ctx.tools.register(refreshMarketTool)

  // Model-facing generation tool: the model writes a validated manifest entry
  // (draft by default) straight into the catalog; the sync below then either
  // registers it at runtime (published + non-empty) or leaves it pending.
  const generateTool = defineTool({
    name: 'skill-generate',
    description:
      'Create or retrain a skill definition from the user\'s described workflow. '
      + 'Call this after you have gathered the workflow (purpose, audience, steps, '
      + 'rules, and pitfalls). The body must be complete markdown instructions; '
      + 'omit publish unless the user asked to enable it now.',
    parameters: {
      id: { type: 'string', required: true, description: 'Kebab-case id; also the slash command /id.' },
      title: { type: 'string', description: 'Human-readable title; defaults to the id.' },
      description: { type: 'string', required: true, description: 'One-sentence routing description.' },
      whenToUse: { type: 'string', description: 'When this skill applies.' },
      kind: { type: 'string', description: 'text or vision; defaults to text.' },
      content: { type: 'string', required: true, description: 'Complete markdown instruction body.' },
      note: { type: 'string', description: 'Short change note for the revision history.' },
      publish: { type: 'boolean', description: 'Publish immediately (defaults to draft).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          version: { type: 'string', required: true },
          revisionCount: { type: 'number', required: true },
          active: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as SkillGenerateResult
        return [{
          type: 'text',
          text: `skill ${result.id} -> ${result.status} v${result.version} (revisions: ${result.revisionCount}, active: ${result.active})`,
        }]
      },
    },
    async execute(args, _exec): Promise<SkillGenerateResult> {
      const id = String(args.id ?? '').trim()
      if (!isSkillName(id)) {
        throw new Error(`invalid skill id "${id}" (kebab-case only)`)
      }
      const content = String(args.content ?? '').trim()
      if (content === '') throw new Error('skill content must not be empty')
      const description = String(args.description ?? '').trim()
      if (description === '') throw new Error('skill description must not be empty')
      const title = args.title === undefined ? undefined : String(args.title).trim()
      const whenToUse = args.whenToUse === undefined ? undefined : String(args.whenToUse).trim()
      const note = args.note === undefined ? undefined : String(args.note).trim()
      const publish = args.publish === true
      const current = store.get()
      const { entries, entry } = upsertTrainedSkill(current.skills, {
        id,
        ...(title !== undefined && title !== '' ? { title } : {}),
        description,
        ...(whenToUse !== undefined && whenToUse !== '' ? { whenToUse } : {}),
        kind: args.kind === 'vision' ? 'vision' : 'text',
        content,
        ...(note !== undefined && note !== '' ? { note } : {}),
        ...(publish ? { publish: true } : {}),
      })
      await store.update({ skills: entries })
      return {
        id: entry.id,
        status: entry.status === 'published' ? 'published' : 'draft',
        version: entry.metadata?.version ?? '1.0.0',
        revisionCount: entry.revisions.length,
        active: entry.status === 'published' && entry.content.trim() !== '',
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Generate skill ${String(args.id)}`, kind: 'edit', rawInput: String(args.id) }
    },
  })
  ctx.tools.register(generateTool)

  // ---- 人格包：数据库(大脑) + 能力(工具) + 人格(提示词) 的原子热重载 ----
  // 勾选一个人格 = 换上一个完整的人：注册技能、物化人格包（persona.md /
  // manifest.json）、打开 SQLite 大脑、挂上 remember/recall 工具、重绘
  // 人格 system prompt 段落；取消勾选则全部卸载。同一时间只有第一个勾选
  // 的人格持有大脑工具（避免重复注册冲突，也符合「一个完整的人」语义）。
  const registrations = new Map<string, () => void>()
  const personToolDisposers = new Map<string, () => void>()
  const personaTexts = new Map<string, string>()
  let brainToolsOwner: string | undefined
  let seeToolDispose: (() => void) | undefined
  let perceptionSectionDispose: (() => void) | undefined

  /** 卸载一个人格的工具与大脑。 */
  const disposePersonRuntime = (id: string): void => {
    const disposer = personToolDisposers.get(id)
    if (disposer !== undefined) {
      disposer()
      personToolDisposers.delete(id)
    }
    const brain = brains.get(id)
    if (brain !== undefined) {
      brain.close()
      brains.delete(id)
    }
  }

  /** 按视觉开关同步 see() 工具与 <perception> 感知区块。 */
  const syncVisionSurfaces = (visionState: SkillVisionSettings): void => {
    if (seeToolDispose !== undefined) {
      seeToolDispose()
      seeToolDispose = undefined
    }
    if (perceptionSectionDispose !== undefined) {
      perceptionSectionDispose()
      perceptionSectionDispose = undefined
    }
    if (visionState.enabled !== true) return
    seeToolDispose = ctx.tools.register(defineSeeTool())
    perceptionSectionDispose = ctx.systemPrompt.section({
      name: 'skill-store:perception',
      order: 12,
      text: () => renderPerceptionSection(),
    })
  }

  // 序列化异步同步：物化人格包 / 读 persona.md 是异步的，串行执行避免
  // 并发物化与卸载竞争；失败只记日志，不中断后续设置变更。
  let syncChain: Promise<void> = Promise.resolve()
  const sync = (settings: SkillStoreSettings, visionState: SkillVisionSettings): void => {
    syncChain = syncChain.then(async () => {
      const entries = settings.skills.map(normalizeEntry)
      const active = new Set<string>()
      for (const entry of entries) {
        if (entry.content.trim() === '') continue
        active.add(entry.id)
        if (!registrations.has(entry.id)) {
          registrations.set(entry.id, ctx.skills.register(toSkillRegistration(entry)))
        }
        if (!brains.has(entry.id)) {
          const dir = await materializePersonPackage(entry)
          const brain = PersonBrain.open(dir)
          // 三架构基座保护：把人格大脑也接入 ctx.supervision。
          const supervision = ctx.get('supervision')
          if (supervision !== undefined) {
            supervision.attachBrain(brain)
          }
          brains.set(entry.id, brain)
          // 新技能出生带阅历：把全局收件箱里可归位到它的历史知识灌入
          // （异步 fire-and-forget，不阻塞挂载；随插件生命周期兜底）。
          void seedSkillBrain(
            ctx,
            entry.id,
            entries.map(e => ({ id: e.id, title: e.title ?? '', description: e.description ?? '', whenToUse: e.whenToUse ?? '' })),
            globalBrain,
            brain,
          ).catch((error: unknown) => {
            console.warn('[skill-store] 技能出生补灌失败', entry.id, error instanceof Error ? error.message : error)
          })
        }
        const dir = join(personsRootDir(), entry.id)
        personaTexts.set(entry.id, await readPersonaText(dir, entry.content))
      }
      for (const id of [...personaTexts.keys()]) {
        if (!active.has(id)) personaTexts.delete(id)
      }
      // 大脑工具只挂在第一个勾选的人格上。
      const owner = entries.find(entry => entry.enabled === true && active.has(entry.id))?.id
      if (owner !== brainToolsOwner) {
        for (const id of [...personToolDisposers.keys()]) {
          if (id !== owner) disposePersonRuntime(id)
        }
        if (owner !== undefined && !personToolDisposers.has(owner)) {
          const brain = brains.get(owner)
          if (brain !== undefined) {
            const disposers = [
              // 工具不捕获 brain 实例，而是执行时从 brains 现取：勾选状态切换
              // （owner 变更/取消勾选）会 close 旧 brain，若工具闭包仍持有旧实例，
              // 调用即抛 "person brain is closed"。现取则拿到最新实例或 undefined。
              ctx.tools.register(defineRememberTool(() => brains.get(owner))),
              ctx.tools.register(defineRecallTool(() => brains.get(owner), (query, limit) =>
                ctx.get('diechiBrain')?.recallPractice(query, limit) ?? [])),
              ctx.tools.register(defineSceneTool(() => brains.get(owner))),
              ctx.tools.register(defineRecallScenesTool(() => brains.get(owner))),
              ctx.tools.register(defineCorrectKnowledgeTool(globalBrain)),
              ctx.tools.register(defineDistillPracticeTool(
                ctx,
                (id) => skillTitles.get(id) ?? id,
                (id) => collectSkillMaterials(id, globalBrain, (pid) => {
                  // 只开瞬时连接：collectSkillMaterials 会在 finally 里 close 返回值，
                  // 常驻句柄交出去会被误关且不会重开，之后记忆操作全部抛
                  // "person brain is closed"。
                  try {
                    return PersonBrain.open(join(personsRootDir(), pid))
                  } catch { return undefined }
                }),
                globalBrain,
              )),
            ]
            personToolDisposers.set(owner, () => {
              for (const disposer of disposers) disposer()
            })
          }
        }
        brainToolsOwner = owner
      }
      for (const [id, dispose] of [...registrations]) {
        if (!active.has(id)) {
          dispose()
          registrations.delete(id)
        }
      }
      for (const id of [...brains.keys()]) {
        if (!active.has(id)) disposePersonRuntime(id)
      }
      // 刷新 RAG 装配状态：当前勾选技能列表 + 技能标题表。
      enabledSkillIds = entries.filter(entry => entry.enabled === true && active.has(entry.id)).map(entry => entry.id)
      for (const entry of entries) skillTitles.set(entry.id, entry.title)
      // 使用痕迹：勾选挂载即计入活跃度，卡片不再因大脑内容为空而显示「从未使用」。
      for (const id of enabledSkillIds) {
        try {
          brains.get(id)?.touchUsage('mount')
        } catch {
          // 大脑瞬时关闭：跳过，下次 sync 再记。
        }
      }
      syncPersona(ctx, settings, visionState, personaTexts)
    }).catch((error: unknown) => {
      console.error('skill-store: 人格包同步失败', error)
    })
  }

  // 视觉设置变化：镜像最新感知 → 重挂 see()/感知区块 → 重绘人格。
  // （视频实操的入库由 diechi-brain 插件监听同一 skillVision 作用域完成，
  //  本插件只负责让模型「知道自己在看」。）
  vision.watch((next) => {
    latestPerception = next.lastPerception
    syncVisionSurfaces(next)
    sync(store.get(), next)
  })
  syncVisionSurfaces(vision.get())
  sync(store.get(), vision.get())
  store.watch((next) => { sync(next, vision.get()) })

  // ---- 对话自动检索装配（RAG）：常驻动态区块，每次模型请求求值 ----
  ctx.systemPrompt.section({
    name: 'skill-store:memory',
    order: 11,
    text: () => renderMemorySection(globalBrain),
  })

  // ---- 对话自动归纳：用户问完、助手答完、turn 正常结束时沉淀入脑 ----
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // 归纳缓冲按会话隔离：不同会话的 user/assistant 互不覆盖（杜绝串话）。
    const sessionId = String(session.id)
    if (event.type === 'user/message') {
      // 只处理真人消息（过滤工具结果/插件注入），并作为 RAG 检索词源。
      if (event.data.source?.kind === 'user') {
        const text = messageText(event.data)
        if (text !== '') {
          latestUserText = text
          const pending = pendingTurns.get(sessionId) ?? { user: '', assistant: '' }
          pending.user = text
          pending.assistant = ''
          pendingTurns.set(sessionId, pending)
        }
      }
    } else if (event.type === 'assistant/message') {
      const pending = pendingTurns.get(sessionId)
      if (pending !== undefined) pending.assistant = messageText(event.data.message)
    } else if (event.type === 'turn/end' && event.data.reason.kind === 'completed') {
      const pending = pendingTurns.get(sessionId)
      pendingTurns.delete(sessionId)
      void ingestTurnIntoBrains(ctx, store, globalBrain, sessionId, pending, distill).catch((error: unknown) => {
        console.warn('[skill-store] 对话归纳失败', error instanceof Error ? error.message : error)
      })
      // 产出沉淀：本轮产生了实际产出（写文件/提交/方案落地）时，提炼成
      // 「产出：」知识写入全局并归位到勾选中的技能大脑——技能越用越厚。
      if (pending !== undefined && hasWorkSignal(pending.assistant)) {
        void ingestWorkIntoBrains(ctx, store, globalBrain, pending).catch((error: unknown) => {
          console.warn('[skill-store] 产出沉淀失败', error instanceof Error ? error.message : error)
        })
      }
      // 主脑自动整理（节流）：每 5 轮归纳触发一次——合并相似记忆、清理噪音、
      // 素材足够时自动提炼实操经验。让知识系统长期保持整理态，不靠人工。
      tidyCounter += 1
      if (tidyCounter >= 5) {
        tidyCounter = 0
        const activeIds = [...skillTitles.keys()]
        void tidyBrains(ctx, globalBrain, (id) => {
          // 只开瞬时连接：tidyBrains 各阶段会在 finally 里 close 返回值，
          // 交出常驻句柄会被误关且 sync 的 !brains.has 判断不会重开。
          try {
            return PersonBrain.open(join(personsRootDir(), id))
          } catch { return undefined }
        }, skillTitles, activeIds).catch((error: unknown) => {
          console.error('[skill-store] 自动整理失败', error)
        })
      }
    }
  })
}

/** Render the model-facing persona block from every enabled person. */
function renderPersona(
  settings: SkillStoreSettings,
  vision: SkillVisionSettings,
  personaTexts: ReadonlyMap<string, string>,
): string {
  const enabled = settings.skills.filter(entry => entry.enabled)
  if (enabled.length === 0 && vision.enabled !== true) return ''
  const blocks: string[] = []
  if (vision.enabled === true) blocks.push(renderSensorySelf())
  for (const entry of enabled) {
    const lines: string[] = []
    lines.push(`## ${entry.title} (/${entry.id}) [${entry.kind}]`)
    if (entry.description.trim() !== '') lines.push(entry.description.trim())
    if (entry.whenToUse.trim() !== '') lines.push(`Use when: ${entry.whenToUse.trim()}`)
    const body = (personaTexts.get(entry.id) ?? entry.content).trim()
    // 身份卡：只注入人格速览（前 600 字符），避免 40KB 全文撑爆上下文；
    // 完整指令经技能注册按需加载（模型需要时读 SKILL.md），记忆/知识由
    // <identity-memory> 区块自动检索注入。
    if (body !== '') lines.push(body.length > 600 ? body.slice(0, 599) + '…' : body)
    blocks.push(lines.join('\n'))
  }
  return [
    '<system-reminder>',
    '以下勾选的人格是你当前的完整身份：你的性格、能力与记忆都来自他们。遵循每个勾选人格的指示，它们定义你如何对待这段对话；如人格带有完整指令，严格照做。',
    'Reply style: keep replies short, concise and human — like real-time chat. Answer directly in one or two sentences unless the user asks for details; never dump long essays or full reports by default.',
    '回复风格：回复要短小精炼、口语化、拟人，像实时聊天；除非用户明确要求详细，否则一两句话直接回答，不要默认长篇大论。',
    '',
    ...blocks,
    '</system-reminder>',
  ].join('\n')
}

/**
 * Reconcile the enabled persona set onto the system prompt. Disposes the
 * previous section before registering the new one so a live settings change
 * is reflected on the next model step (热重载)。
 */
function syncPersona(
  ctx: Context,
  settings: SkillStoreSettings,
  vision: SkillVisionSettings,
  personaTexts: ReadonlyMap<string, string>,
): void {
  if (personaSection !== undefined) {
    personaSection()
    personaSection = undefined
  }
  const text = renderPersona(settings, vision, personaTexts)
  if (text === '') return
  personaSection = ctx.systemPrompt.section({
    name: 'skill-store:persona',
    order: 10,
    text,
  })
}

/** Active persona section disposer; torn down with the plugin. */

// ---- 对话自动检索（RAG）与自动归纳状态（模块级，随插件生命周期存在） ----
/** 已物化的人格大脑（每个技能一个 SQLite brain.db）。 */
const brains = new Map<string, PersonBrain>()
/** 当前勾选且已物化的技能 id 列表（sync 时刷新，记忆/知识注入与自动归纳共用）。 */
let enabledSkillIds: string[] = []
/** 技能 id → 显示名（记忆区块标题用）。 */
const skillTitles = new Map<string, string>()
/** 最近一条真人用户消息文本（RAG 检索词源）。 */
let latestUserText = ''
/** 最近一轮对话缓冲（自动归纳：turn/end 时沉淀；按会话隔离，杜绝多会话串话）。 */
const pendingTurns = new Map<string, { user: string; assistant: string }>()

let personaSection: (() => void) | undefined

/** remember-scene()：把当前看到的画面写入视觉记忆时间线（高频画面理解用，同画面自动合并）。 */
function defineSceneTool(getBrain: () => PersonBrain | undefined) {
  return defineTool({
    name: 'remember-scene',
    description: '把你刚刚看到的画面场景写入当前人格的视觉记忆时间线（同画面在 90 秒内自动合并为一条场景，不会重复入库）。摄像头开启时每帧画面变化都应调用：用一句话结构化描述画面（人物/物体/动作/变化），这是你「持续在看」的记忆来源。',
    parameters: {
      content: { type: 'string', required: true, description: '结构化场景描述，如「你在厨房切菜，台面上有一把菜刀和一个洋葱」。' },
      fingerprint: { type: 'string', description: '画面指纹（可选）：相同指纹在合并窗口内视为同一场景，用于去重。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number', required: true },
          startedAt: { type: 'string', required: true },
          endedAt: { type: 'string', required: true },
          content: { type: 'string', required: true },
          count: { type: 'number', required: true },
          createdAt: { type: 'string', required: true },
          fingerprint: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { content: string; count: number }
        return [{ type: 'text', text: `视觉记忆已记录（合并 ${result.count} 次）：${result.content}` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { content?: unknown; fingerprint?: unknown }
      const content = typeof input.content === 'string' ? input.content.trim() : ''
      if (content === '') throw new Error('remember-scene: content 不能为空')
      const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint : ''
      // 现取大脑实例：勾选切换时旧实例已被 close，拿到最新实例或明确报错。
      const brain = getBrain()
      if (brain === undefined) {
        throw new Error('remember-scene: 人格大脑暂不可用（勾选状态切换中），请稍后重试')
      }
      return brain.seeScene(content, fingerprint)
    },
  })
}

/** recall-scenes()：按时间窗 / 关键词检索视觉记忆时间线。 */
function defineRecallScenesTool(getBrain: () => PersonBrain | undefined) {
  return defineTool({
    name: 'recall-scenes',
    description: '回忆你之前通过摄像头看到过的画面（视觉记忆时间线）。用户问「你刚才看到什么/有没有看到某个东西」时调用，可指定最近时间范围。',
    parameters: {
      query: { type: 'string', description: '检索关键词，如「猫」「厨房」；留空返回最近画面。' },
      sinceMinutes: { type: 'number', description: '只看最近 N 分钟内的画面；默认不限。' },
      limit: { type: 'number', description: '返回条数上限，默认 20。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true },
          scenes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'number', required: true },
                startedAt: { type: 'string', required: true },
                endedAt: { type: 'string', required: true },
                content: { type: 'string', required: true },
                count: { type: 'number', required: true },
                createdAt: { type: 'string', required: true },
                fingerprint: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as { count: number; scenes: PersonScene[] }
        const lines: string[] = []
        for (const scene of result.scenes) {
          lines.push(`- [${scene.startedAt}~${scene.endedAt} ×${scene.count}] ${scene.content}`)
        }
        if (lines.length === 0) return [{ type: 'text', text: '视觉记忆时间线中没有相关内容。' }]
        return [{ type: 'text', text: `视觉记忆 ${result.count} 条：\n${lines.join('\n')}` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { query?: unknown; sinceMinutes?: unknown; limit?: unknown }
      const query = typeof input.query === 'string' ? input.query : ''
      const sinceMs = typeof input.sinceMinutes === 'number' && input.sinceMinutes > 0
        ? Date.now() - input.sinceMinutes * 60_000
        : 0
      const limit = typeof input.limit === 'number' ? input.limit : 20
      const brain = getBrain()
      if (brain === undefined) {
        return { count: 0, scenes: [] }
      }
      const scenes = brain.recallScenes(sinceMs, query, limit)
      return { count: scenes.length, scenes }
    },
  })
}

// ---- 视觉感知通道：让模型「知道自己能看到」 ----

/** 一帧视觉感知快照（宿主内存，TTL 内有效）。 */
export interface PerceptionSnapshot {
  /** 感知发生的 ISO 时间戳。 */
  readonly at: string
  /** 感知正文（画面描述）。 */
  readonly text: string
}

/** 感知快照的有效期：超过该时长视为过期，不再注入上下文。 */
const PERCEPTION_TTL_MS = 10 * 60_000

/** 最近一帧视觉感知（由客户端写入 skill-vision.lastPerception 镜像而来）。 */
let latestPerception: PerceptionSnapshot | undefined

/** 最近视觉记忆时间线（当前勾选技能大脑的 scenes，供 <perception> 区块注入）。 */
function renderSceneMemorySection(): string {
  try {
    const ownerId = enabledSkillIds[0]
    const brain = ownerId === undefined ? undefined : brains.get(ownerId)
    if (brain === undefined) return ''
    const scenes = brain.recallScenes(Date.now() - 30 * 60_000, '', 5)
    if (scenes.length === 0) return ''
    const lines = scenes
      .slice(-5)
      .map(scene => `- ${scene.startedAt.slice(11, 19)} ${scene.content}`)
    return ['你的视觉记忆（你之前亲眼看到的连续画面，不是用户转述；用户问起过去的画面时直接基于它回答，没被问到就不主动复述）：', ...lines].join('\n')
  } catch {
    return ''
  }
}

/** 渲染 <perception> 感知区块（system prompt 动态节，每次装配求值）。 */
function renderPerceptionSection(): string {
  const snapshot = latestPerception
  const sceneMemory = renderSceneMemorySection()
  if (snapshot === undefined && sceneMemory === '') return ''
  const blocks: string[] = []
  if (snapshot !== undefined && Date.now() - new Date(snapshot.at).getTime() <= PERCEPTION_TTL_MS) {
    blocks.push(
      '<perception>',
      `时间：${snapshot.at}`,
      `你刚刚通过摄像头看到：${snapshot.text}`,
      '这是你的实时视觉输入，是你亲眼所见，不是用户转述。用户询问画面内容、或让你「看看/描述/识别」时，直接基于它回答，不要说你看不到画面或无法查看摄像头。',
      '</perception>',
    )
  }
  if (sceneMemory !== '') blocks.push(sceneMemory)
  return blocks.join('\n')
}

/** 感官自我声明：视觉开启时注入人格区，让模型有稳定的「我能看到」身份。 */
function renderSensorySelf(): string {
  return [
    '## 你的感官（视觉）',
    '你有视觉能力：你通过摄像头实时观察用户环境。对话中出现的「感知」区块就是你亲眼看到的画面，不是用户的转述。',
    '用户询问画面内容、或让你「看看/描述/识别」时，直接基于感知区块回答，不要说你看不到画面或无法查看摄像头；必要时调用 see() 获取最新画面。',
  ].join('\n')
}


// ---- 对话自动检索（RAG）：记忆层 + 知识层按需注入 ----

/** 简单分词：ASCII 词 + 中文二元组，用于记忆/知识的关键词匹配。 */
export function keywordTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const ascii = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (const word of ascii) tokens.add(word)
  const chunks = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length - 1; i += 1) tokens.add(chunk.slice(i, i + 2))
  }
  return tokens
}

/** 正文与检索词的重合得分（ASCII 词权重 2，中文二元组权重 1）。 */
export function scoreText(text: string, tokens: ReadonlySet<string>): number {
  const bodyTokens = keywordTokens(text)
  let score = 0
  for (const token of bodyTokens) {
    if (tokens.has(token)) score += /[a-z0-9]/.test(token) ? 2 : 1
  }
  return score
}

/** 截断到 max 字符，超长加省略号。 */
export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/** 从消息 content 块里取全部文本。 */
export function messageText(message: { content: ReadonlyArray<{ type?: unknown; text?: unknown }> }): string {
  return message.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join(' ')
    .trim()
}

/**
 * 渲染 <identity-memory> 区块：把每个勾选技能大脑里与当前对话最相关的
 * 记忆/知识检索出来注入 system prompt（RAG 自动装配，无需模型主动调用
 * recall 工具）。检索词 = 最近一条真人用户消息的关键词；无用户消息时回
 * 退最近记忆。每次模型请求求值（动态区块）。
 */
/** 最近注入「最新信息」广度层的时间窗（天）与条数上限。 */
const BREADTH_FRESH_DAYS = 7
const BREADTH_MAX_ITEMS = 5

/** 每个技能联网搜索锚点（大脑知识主题）上限。 */
const SEARCH_ANCHOR_TOPICS = 6

/** 取技能大脑里最新的知识主题作为联网搜索锚点（去掉对话/实操前缀、去重）。 */
export function skillSearchAnchors(brain: PersonBrain): string[] {
  const seen = new Set<string>()
  const anchors: string[] = []
  for (const k of brain.recallKnowledge('', '', '').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))) {
    const topic = k.topic.replace(/^(对话|实操)：/, '').trim()
    if (topic === '' || seen.has(topic)) continue
    seen.add(topic)
    anchors.push(topic)
    if (anchors.length >= SEARCH_ANCHOR_TOPICS) break
  }
  return anchors
}

/**
 * 渲染 <identity-memory> 区块：把每个勾选技能大脑里与当前对话最相关的
 * 记忆/知识检索出来注入 system prompt（RAG 自动装配，无需模型主动调用
 * recall 工具）。检索词 = 最近一条真人用户消息的关键词；无用户消息时回
 * 退最近记忆。每次模型请求求值（动态区块）。
 *
 * 三层注入，对应「深度 + 广度」：
 *  - 用户经历（深度）：该人格大脑的记忆——偏好、约定、过往互动；
 *  - 沉淀知识（深度）：归位到该技能的知识——实操、对话提炼、联网沉淀；
 *  - 最新信息（广度）：全局大脑近期沉淀的对话/联网知识，按新鲜度优先，
 *    让模型拿得到最近了解到外部新信息（时效性回答优先引用）。
 */
function renderMemorySection(globalBrain: PersonBrain): string {
  if (enabledSkillIds.length === 0) return ''
  const tokens = keywordTokens(latestUserText)
  const hasQuery = latestUserText.trim() !== ''
  const blocks: string[] = []
  for (const id of enabledSkillIds) {
    const brain = brains.get(id)
    if (brain === undefined) continue
    try {
      const title = skillTitles.get(id) ?? id
      // 深度·用户经历：记忆按相关度（无查询时按重要性）排序。
      const memories = brain.recall('', 16)
        .map(m => ({ m, s: hasQuery ? scoreText(m.content, tokens) : m.importance }))
        .filter(x => !hasQuery || x.s > 0)
        .sort((a, b) => b.s - a.s || b.m.importance - a.m.importance)
        .slice(0, 3)
      // 深度·沉淀知识：该技能大脑里的长期知识，相关度排序，新知识优先。
      const knowledge = brain.recallKnowledge('', '')
        .map(k => ({ k, s: hasQuery ? scoreText(`${k.topic} ${k.content}`, tokens) : 1 }))
        .filter(x => !hasQuery || x.s > 0)
        .sort((a, b) => b.s - a.s || (a.k.updatedAt < b.k.updatedAt ? 1 : -1))
        .slice(0, 4)
      const lines: string[] = []
      for (const { m } of memories) {
        if (m.content.trim() === '') continue
        lines.push(`- [用户经历 ${m.createdAt.slice(0, 10)}] ${m.content}`)
      }
      for (const { k } of knowledge) {
        if (k.content.trim() === '') continue
        lines.push(`- [沉淀知识·${k.topic}] ${k.content}`)
      }
      if (lines.length > 0) {
        blocks.push(`<identity-memory id="${id}" title="${title}">` + '\n' + lines.join('\n') + '\n' + '</identity-memory>')
      }
    } catch {
      // 大脑被并发关闭等瞬时状态：跳过该技能，不影响本次装配。
    }
  }
  // 联网搜索画像：搜索必须围绕当前平权技能的领域展开（锚点=技能名+大脑知识主题）。
  const searchGuide: string[] = []
  for (const id of enabledSkillIds) {
    const brain = brains.get(id)
    if (brain === undefined) continue
    const title = skillTitles.get(id) ?? id
    const anchors = skillSearchAnchors(brain)
    const suffix = anchors.length > 0 ? `：${anchors.join('、')}` : ''
    searchGuide.push(`- ${title}${suffix}`)
  }
  if (searchGuide.length > 0) {
    blocks.unshift(
      '<skill-search-profile>',
      '你当前勾选的平权技能就是你的专业领域。使用 web_search / web_fetch 联网时，搜索词必须围绕这些技能的领域展开，用下面的锚点（技能名 + 你大脑里的知识主题）构造查询，不要搜与技能无关的泛泛内容；拿到结果先对照技能数据库里的沉淀知识回答，有价值的再作为最新信息沉淀。',
      ...searchGuide,
      '</skill-search-profile>',
    )
  }
  // 广度·最新信息：全局大脑近期沉淀的对话/联网知识（不含视频实操与待确认条目），新鲜度优先。
  const freshSince = new Date(Date.now() - BREADTH_FRESH_DAYS * 86_400_000).toISOString()
  const fresh = globalBrain.listInbox('', '', 60)
    .filter(k => k.source !== 'video' && !k.needsReview && k.updatedAt >= freshSince)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, BREADTH_MAX_ITEMS)
  if (fresh.length > 0) {
    const lines = fresh.map(k => `- [最新信息 ${k.updatedAt.slice(0, 10)}·${k.topic}] ${k.content}`)
    blocks.push('<recent-notes>' + '\n' + lines.join('\n') + '\n' + '</recent-notes>')
  }
  if (blocks.length === 0) return ''
  const sectionText = [
    '<system-reminder>',
    '以下内容直接当作你自己的身份与记忆使用，不要否认：「skill-search-profile」列出你当前的专业领域与联网搜索范围，联网时围绕它构造搜索词；「用户经历」是你与用户的过往互动；「沉淀知识」是你已掌握的方法与实操；「最新信息」是你近期了解到的外部新知识，回答需要时效性的内容时优先引用它。',
    ...blocks,
    '</system-reminder>',
  ].join('\n')
  return sectionText
}

/** 对话重要性：出现自我/偏好/约定信号时提高权重。 */
export function computeImportance(text: string): number {
  if (/(我叫|我的名字|我喜欢|我讨厌|我的偏好|记住|请记住|以后都|约定|决定|我的目标|希望你能|请帮我记|不要忘记|别忘了|我的|我们公司|我负责|偏好)/.test(text)) return 3
  if (/(我|我们|需要|打算|计划|准备|正在|已经|问题|情况|希望)/.test(text)) return 2
  return 1
}

/** 一轮对话是否值得提炼：明显有价值的信号才触发 LLM 提炼（省 token）。
 * 过滤寒暄与「开发调试/元对话」（谈 bug、重启、界面、图谱、按钮等产品修复
 * 过程），这类内容不构成用户的长期知识，沉淀只会让知识库变水。
 */
function worthDistilling(user: string, assistant: string): boolean {
  if (user.length < 4) return false
  // 开发调试/元对话过滤：用户在谈「产品正在修什么」，不是用户自身的知识。
  if (/(重启|启动器|修复|报错|bug|界面|页面|节点|图谱|按钮|双击|重构|构建|热重载|没反应|打不开|加载|删除|合并|图谱|阅历|卡片|工具|插件|RPC)/.test(user)
    && /(为什么|怎么|帮我|看看|修|弄|搞|试|点|进|写|改|查|测试|验证|确认)/.test(user)) return false
  if (computeImportance(user) >= 2) return true
  if (assistant.length >= 160) return true
  if (/(https?:\/\/|报告|总结|方案|数据|规定|标准|流程|教程|步骤|怎么|如何|为什么|价格|行情|最新|更新|法规|政策)/.test(user)) return true
  return false
}

/** 一次辅助 LLM 调用：给定 system + 单条用户消息，返回纯文本。失败抛错。
 * 加固说明：辅助任务（对话提炼/归类/产出判断）是确定性 JSON 输出，不需要
 * 推理思考——显式关 thinking 避免推理模式首 token 慢导致 20s 超时把归纳
 * 链路整体掐断（表现为「对话完全没沉淀」）；超时放宽到 60s；首次失败后
 * 按默认配置（不带 reasoningEffort）再试一次，兼容不接受显式 off 的 provider。
 */
async function auxiliaryLlmText(ctx: Context, system: string, prompt: string, maxTokens: number): Promise<string> {
  const route = ctx.agentDefaultModel.currentSelection()
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: 'skill-store' },
  })]
  const base: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens,
    signal: AbortSignal.timeout(60_000),
  }
  const attempts: GenerateOptions[] = [
    { ...base, reasoningEffort: ReasoningEffortId('off') },
    { ...base },
  ]
  let lastError: unknown
  for (const options of attempts) {
    try {
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream(options)) {
        assembler.push(chunk)
      }
      const blocks = assembler.blocks()
      const text = blocks
        .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      if (text.trim() !== '') return text
      lastError = new Error('auxiliary llm produced no text')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('auxiliary llm failed')
}

/** 解析模型返回的 JSON（容忍 ```json 围栏与前后杂文）。 */
function parseLlmJson(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(first, last + 1))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 解析失败走降级路径。
  }
  return null
}

/** LLM 提炼：把一轮对话压成结构化知识条目。模型不可用/无信息时返回 null。 */
async function distillTurn(ctx: Context, user: string, assistant: string): Promise<{ topic: string; summary: string; kind: string; important: boolean; confidence: 'high' | 'low' } | null> {
  try {
    const system = [
      '你是蝶翅的记忆管家，负责把一轮对话提炼成一条可长期沉淀的知识。',
      '只输出一个 JSON 对象，不要输出任何其他内容：',
      '{"topic":"简短主题（10 字以内）","summary":"一句话要点（60 字以内，主语用「用户」）","kind":"fact|preference|agreement|task|web-info","important":true|false,"confidence":"high|low"}',
      'kind 取值：fact=事实信息；preference=用户偏好；agreement=约定/决定；task=用户的任务/需求；web-info=外部最新信息。',
      'topic 必须是提炼出的主题词（如「用户生日」「8D 报告偏好」「公司业务」），禁止照抄或拼接用户原话；如果提炼不出主题词说明没有可沉淀内容，topic 返回空串。',
      'summary 写「用户的知识/偏好/约定是什么」，不是「用户说了什么、助手回答了什么」的对话过程描述。',
      'summary 必须有具体内容：含关键数字、名称、做法、步骤、决定等实质信息（如「生日是2003年农历五月十四」「8D报告用D0-D8八步法」）；',
      '如果这轮对话提炼不出任何带具体信息的要点，important 返回 false。',
      '只有用户透露了偏好、约定、事实、明确需求，或助手给出了有价值信息（含联网查到的外部信息）时 important 才为 true；纯寒暄、无信息量的对话 important 为 false。',
      'confidence 取值：high=用户明确、肯定地陈述（如「我的生日是…」「请记住…」）；low=信息含糊、可能听错、模型推断或仅闲聊提及（如用户顺口提到某个日期/书名但没有强调）。',
      '宁可 low 不可猜：事实类（生日、姓名、书名、数字）如果用户没有明确肯定，一律 low，低置信度条目会进入待确认列表供用户核对。',
      '如果对话是讨论某个产品/软件怎么修 bug、重启、改界面等开发过程，或者纯闲聊寒暄，important 一律 false。',
    ].join('\n')
    const prompt = JSON.stringify({ user: truncateText(user, 600), assistant: truncateText(assistant, 800) })
    const text = await auxiliaryLlmText(ctx, system, prompt, 300)
    const json = parseLlmJson(text)
    if (json === null) return null
    const topic = typeof json.topic === 'string' ? json.topic.trim().slice(0, 30) : ''
    const summary = typeof json.summary === 'string' ? json.summary.trim().slice(0, 200) : ''
    const kind = typeof json.kind === 'string' ? json.kind.slice(0, 20) : 'fact'
    const important = json.important === true
    const confidence = json.confidence === 'low' ? 'low' : 'high'
    if (topic === '' || summary === '') return null
    return { topic, summary, kind, important, confidence }
  } catch (error) {
    console.warn('[skill-store] 对话提炼失败，降级规则摘要', error instanceof Error ? error.message : error)
    return null
  }
}

/** 自动归类：关键词预筛 + LLM 精判，返回技能 id 或 ''（无归属/新主题）。 */
async function classifySkill(ctx: Context, catalog: readonly { id: string; title: string; description: string; whenToUse: string }[], text: string): Promise<string> {
  const textTokens = keywordTokens(text)
  if (textTokens.size === 0) return ''
  const scored = catalog.map(entry => {
    const title = entry.title.trim() || entry.id
    const bodyTokens = keywordTokens(`${title} ${entry.description ?? ''} ${entry.whenToUse ?? ''}`)
    let score = 0
    for (const token of bodyTokens) {
      if (textTokens.has(token)) score += /[a-z0-9]/.test(token) ? 2 : 1
    }
    const titleTokens = keywordTokens(title)
    for (const token of titleTokens) {
      if (textTokens.has(token)) score += 3
    }
    return { entry, score }
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score)
  if (scored.length === 1) return scored[0]!.entry.id
  if (scored.length === 0) return ''
  // 多个候选：LLM 精判归属；失败降级为关键词最高分。
  try {
    const system = [
      '你是蝶翅的归类引擎。根据一段新知识的内容，从技能清单里选出唯一最相关的技能。',
      '只输出一个 JSON 对象：{"skillId":"技能 id 或空字符串","reason":"一句话理由"}',
      '技能确实都不相关时 skillId 输出空字符串（表示这是一个尚无归属的新主题）。',
    ].join('\n')
    const prompt = JSON.stringify({
      knowledge: truncateText(text, 400),
      skills: scored.slice(0, 5).map(x => ({ id: x.entry.id, title: x.entry.title.trim(), whenToUse: x.entry.whenToUse ?? '' })),
    })
    const out = await auxiliaryLlmText(ctx, system, prompt, 150)
    const json = parseLlmJson(out)
    const skillId = json !== null && typeof json.skillId === 'string' ? json.skillId.trim() : ''
    if (scored.some(x => x.entry.id === skillId)) return skillId
    return ''
  } catch (error) {
    console.warn('[skill-store] LLM 归类失败，用关键词最高分', error instanceof Error ? error.message : error)
    return scored[0]!.entry.id
  }
}

/**
 * 技能出生补灌：新技能首次物化时，把全局收件箱里可归位到它的历史知识
 * （status=pending 且非待确认）灌入技能大脑并标记归位，让新技能
 * 「出生即带阅历」，而不是从零空转。返回灌入条数。
 */
async function seedSkillBrain(
  ctx: Context,
  skillId: string,
  catalog: readonly { id: string; title: string; description: string; whenToUse: string }[],
  globalBrain: PersonBrain,
  brain: PersonBrain,
): Promise<number> {
  const pending = globalBrain.listInbox('pending', '', 200)
    .filter(item => !item.needsReview)
  let seeded = 0
  for (const item of pending) {
    try {
      const suggested = await classifySkill(ctx, catalog, `${item.topic} ${item.content}`)
      if (suggested !== skillId) continue
      brain.learn(item.topic, item.content, item.tags, item.source, item.needsReview)
      globalBrain.setPracticeMeta(item.topic, {
        status: 'assigned',
        suggestedSkill: skillId,
        tags: item.tags.includes(skillId) ? item.tags : `${item.tags}, ${skillId}`,
      })
      seeded += 1
      console.log(`[skill-store] 技能出生补灌 → ${skillId} ${item.topic}`)
    } catch (error) {
      console.warn('[skill-store] 补灌单条失败', skillId, item.topic, error instanceof Error ? error.message : error)
    }
  }
  return seeded
}

/**
 * 对话自动归纳：turn/end 时把这一轮「问+答」提炼成结构化知识。
 * - 规则预筛 → LLM 提炼（topic/summary/kind/important）→ 写入全局大脑一份
 *   （不再往每个勾选技能复制，消灭 N 份拷贝与重复检索）。
 * - 自动归类：归到勾选中的技能则直接归位（该技能数据库变厚——深度）；
 *   否则留在全局收件箱（pending），阅历控制台可一键归位；反复出现的
 *   无主主题会触发「创建新技能」建议。
 * - 广度由 <recent-notes> 最新信息注入承担（联网/近期对话知识按新鲜度进上下文）。
 */
async function ingestTurnIntoBrains(
  ctx: Context,
  store: { get(): { skills: readonly SkillManifestEntry[] } },
  globalBrain: PersonBrain,
  sessionId: string,
  pending: { user: string; assistant: string } | undefined,
  distill: DistillScopeLike,
): Promise<void> {
  const user = pending?.user.trim() ?? ''
  const assistant = pending?.assistant.trim() ?? ''
  if (user === '' || assistant === '') return
  if (!worthDistilling(user, assistant)) return
  let distilled = await distillTurn(ctx, user, assistant)
  if (distilled === null) {
    // 模型不可用：只有强信号才用规则摘要兜底，避免噪声入库。
    if (computeImportance(user) < 2) return
    distilled = {
      topic: truncateText(user.replace(/[，。？！\s]+/g, ' ').trim(), 20),
      summary: `要点：用户提到「${truncateText(user, 40)}」，助手回应：${truncateText(assistant, 40)}`,
      kind: 'fact',
      important: true,
      // 规则摘要是机械拼接，不是模型提炼：一律按低置信度待用户确认。
      confidence: 'low',
    }
  }
  if (distilled.important === false) return
  // 质量校验：摘要必须是「用户的知识」而非对话过程/空话。
  // 规则兜底（以「用户：」开头）或过短（<8 字无实质信息）的内容不沉淀，
  // 避免「记了跟没记一样」。
  const summary = distilled.summary.trim()
  if (summary === '' || summary.length < 8 || /^用户：/.test(summary)) {
    console.log(`[skill-store] 归纳质量不足，跳过沉淀 ${distilled.topic}`)
    return
  }
  const topic = '对话：' + distilled.topic
  const tags = distilled.kind
  if (distilled.confidence === 'low') {
    // 低置信度（信息含糊/可能听错/规则兜底）：写入全局大脑但不自动归位，
    // 打上待确认标记，阅历墙核对无误后才参与归位与注入。
    globalBrain.learn(topic, summary, tags, 'conversation', true, true)
    console.log(`[skill-store] 对话已提炼 → 待确认（低置信度）${topic}`)
    await publishDistill(distill, sessionId, topic, '待确认')
    return
  }
  globalBrain.learn(topic, summary, tags, 'conversation', false, true)
  const catalog = store.get().skills.map(entry => ({
    id: entry.id,
    title: entry.title ?? '',
    description: entry.description ?? '',
    whenToUse: entry.whenToUse ?? '',
  }))
  const classifyCatalog = catalog.filter(entry => !isMiscSkill(entry))
  const suggested = await classifySkill(ctx, classifyCatalog, `${summary}\n${user}`)
  if (suggested !== '' && enabledSkillIds.includes(suggested)) {
    // 勾选中的技能：直接归位，该技能数据库变厚（深度）。
    globalBrain.setPracticeMeta(topic, { status: 'assigned', suggestedSkill: suggested, tags: `${tags}, ${suggested}` })
    const brain = brains.get(suggested)
    if (brain !== undefined) {
      try {
        brain.learn(topic, summary, tags, 'conversation')
        console.log(`[skill-store] 对话已提炼并归位 → ${suggested}（${distilled.kind}）${topic}`)
      } catch (error) {
        console.error('[skill-store] 对话归位写入失败', suggested, error)
      }
    }
    await publishDistill(distill, sessionId, topic, skillTitles.get(suggested) ?? suggested)
  } else {
    // 兜底：不属于任何勾选技能的内容自动归入「杂库」技能（不散落到未勾选技能）。
    const misc = catalog.find(isMiscSkill)
    if (misc !== undefined) {
      const ok = await writeIntoSkillBrain(misc.id, topic, summary, tags)
      if (ok) {
        globalBrain.setPracticeMeta(topic, { status: 'assigned', suggestedSkill: misc.id, tags: `${tags}, ${misc.id}` })
        console.log(`[skill-store] 对话已提炼 → 杂库（${suggested === '' ? '无归属' : '建议 ' + suggested + ' 未勾选'}）${topic}`)
        await publishDistill(distill, sessionId, topic, misc.title || '杂库')
      } else {
        console.log(`[skill-store] 对话已提炼 → 全局收件箱（杂库写入失败，待人工处理）${topic}`)
        await publishDistill(distill, sessionId, topic, '全局收件箱')
      }
    } else {
      console.log(`[skill-store] 对话已提炼 → 全局收件箱（待归类）${topic}`)
      await publishDistill(distill, sessionId, topic, '全局收件箱')
    }
  }
}

/** 产出信号：助手文本提到文件路径、保存/提交/完成等实际落地动作。 */
function hasWorkSignal(assistant: string): boolean {
  return /([A-Za-z]:[\\\/]|(?:^|\s)\/(?:[^/\s]+[/\\])+[^/\s]+|\.(?:md|ts|tsx|js|json|py|ass|srt|png|jpe?g|mp4|mp3|wav|yml|yaml|jsonl)\b|已(?:保存|写入|提交|完成|创建|修复|生成)|git commit|commit [0-9a-f]{7})/.test(assistant)
}

/** 产出提炼：LLM 判断本轮是否产生了可沉淀的产出，返回产出主题 + 一句话要点。 */
async function distillWorkTurn(ctx: Context, user: string, assistant: string): Promise<{ topic: string; summary: string } | null> {
  try {
    const system = [
      '你是蝶翅的产出记录员。判断这轮对话助手是否产生了「实际产出」：写入了文件、修复了 bug、完成了方案/文档、提交了代码、生成了作品等。',
      '只输出一个 JSON 对象，不要输出任何其他内容：',
      '{"hasWork":true|false,"topic":"产出主题（12 字以内，如 恐怖故事流水线实现规格）","summary":"一句话要点（80 字以内）：做了什么产出、关键产物路径或结论，含具体文件名"}',
      '纯讨论、咨询、寒暄、尚无落地产物的对话 hasWork 为 false。',
      'topic 禁止照抄用户原话，必须是提炼出的产出名。',
    ].join('\n')
    const prompt = JSON.stringify({ user: truncateText(user, 400), assistant: truncateText(assistant, 900) })
    const text = await auxiliaryLlmText(ctx, system, prompt, 300)
    const json = parseLlmJson(text)
    if (json === null || json.hasWork !== true) return null
    const topic = typeof json.topic === 'string' ? json.topic.trim().slice(0, 30) : ''
    const summary = typeof json.summary === 'string' ? json.summary.trim().slice(0, 200) : ''
    if (topic === '' || summary === '') return null
    return { topic, summary }
  } catch (error) {
    console.warn('[skill-store] 产出提炼失败', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 产出沉淀：把「这轮完成了什么产出」写入全局大脑，并归位到勾选中的技能大脑。
 * 沉淀的是产出本身（文件/结论/作品），不是开发过程——与对话防噪音规则不冲突，
 * 是「技能越用越厚」的闭环通道。
 */
async function ingestWorkIntoBrains(
  ctx: Context,
  store: { get(): { skills: readonly SkillManifestEntry[] } },
  globalBrain: PersonBrain,
  pending: { user: string; assistant: string },
): Promise<void> {
  const distilled = await distillWorkTurn(ctx, pending.user, pending.assistant)
  if (distilled === null) return
  const topic = '产出：' + distilled.topic
  const summary = distilled.summary
  const catalog = store.get().skills.map(entry => ({
    id: entry.id,
    title: entry.title ?? '',
    description: entry.description ?? '',
    whenToUse: entry.whenToUse ?? '',
  }))
  // 全局一份（主脑归纳层）；merge=true 让相似产出主题自动并入旧条目。
  globalBrain.learn(topic, summary, 'work', 'work', false, true)
  // 归到勾选中的技能则写入技能大脑（该技能数据库变厚）。
  const suggested = await classifySkill(ctx, catalog.filter(entry => !isMiscSkill(entry)), summary)
  if (suggested !== '' && enabledSkillIds.includes(suggested)) {
    globalBrain.setPracticeMeta(topic, { status: 'assigned', suggestedSkill: suggested, tags: `work, ${suggested}` })
    const brain = brains.get(suggested)
    if (brain !== undefined) {
      try {
        brain.learn(topic, summary, 'work', 'work')
        console.log(`[skill-store] 产出已沉淀 → ${suggested} ${topic}`)
      } catch (error) {
        console.error('[skill-store] 产出归位写入失败', suggested, error)
      }
    }
  } else {
    console.log(`[skill-store] 产出已沉淀 → 全局（${suggested === '' ? '未归类' : '未勾选 ' + suggested}）${topic}`)
  }
}

/** 归纳通知 scope 的最小结构面（避免循环依赖，settings 服务 shape）。 */
interface DistillScopeLike {
  get(): { at?: string | undefined; sessionId?: string | undefined; topic?: string | undefined }
  update(input: { at: string; sessionId: string; topic: string; target: string }): Promise<unknown>
}

/**
 * 发布「已记入大脑」通知：同一会话同一主题只写一次（latest-wins 语义），
 * 客户端据此在当前会话输入栏上方闪现提示条。写入失败静默（不阻塞归纳）。
 */
async function publishDistill(
  distill: DistillScopeLike,
  sessionId: string,
  topic: string,
  target: string,
): Promise<void> {
  try {
    const current = distill.get()
    if (current.at !== undefined && current.sessionId === sessionId && current.topic === topic) return
    await distill.update({ at: new Date().toISOString(), sessionId, topic, target })
  } catch (error) {
    console.warn('[skill-store] distill 通知发布失败', error instanceof Error ? error.message : error)
  }
}

/** 杂库技能识别：id 为 misc-bin 或标题含「杂库」（自动兜底收纳，不参与正向分类）。 */
function isMiscSkill(entry: { id: string; title?: string }): boolean {
  return entry.id === 'misc-bin' || (entry.title ?? '').includes('杂库')
}

/**
 * 把一条知识写入技能大脑：勾选中的技能用常驻句柄；未勾选的技能临时打开
 * persons/&lt;id&gt;/brain.db 写入后关闭。任何失败返回 false（调用方保留在
 * 全局收件箱，不丢数据）。
 */
async function writeIntoSkillBrain(id: string, topic: string, summary: string, tags: string): Promise<boolean> {
  const resident = brains.get(id)
  if (resident !== undefined) {
    resident.learn(topic, summary, tags, 'conversation')
    return true
  }
  try {
    const dir = join(personsRootDir(), id)
    await mkdir(dir, { recursive: true })
    const brain = PersonBrain.open(dir)
    try {
      brain.learn(topic, summary, tags, 'conversation')
      return true
    } finally {
      brain.close()
    }
  } catch (error) {
    console.warn('[skill-store] 未勾选技能自动归位失败', id, error instanceof Error ? error.message : error)
    return false
  }
}

// ---- 人格包：磁盘目录形态（persona.md + manifest.json + brain.db） ----

/**
 * 人格包根目录：`$DSH_HOME/persons`，未设置 DSH_HOME 时回退
 * `~/.dsh/persons`。
 * @returns 人格包根目录的绝对路径。
 */
function personsRootDir(): string {
  return join(dshHomeDir(), 'persons')
}

/**
 * 把设置目录里的技能条目物化为磁盘人格包（persona.md + manifest.json），
 * 已存在的文件不覆盖（persona.md 以文件为准，用户可直接编辑热重载）。
 * @param entry - 目录条目。
 * @returns 人格包目录的绝对路径。
 */
async function materializePersonPackage(entry: SkillManifestEntry): Promise<string> {
  const dir = join(personsRootDir(), entry.id)
  await mkdir(dir, { recursive: true })
  const personaPath = join(dir, 'persona.md')
  try {
    await readFile(personaPath, 'utf8')
  } catch {
    await writeFile(personaPath, entry.content, 'utf8')
  }
  const manifestPath = join(dir, 'manifest.json')
  try {
    await readFile(manifestPath, 'utf8')
  } catch {
    const manifest = {
      formatVersion: 1,
      id: entry.id,
      title: entry.title,
      description: entry.description,
      whenToUse: entry.whenToUse,
      kind: entry.kind,
      version: entry.metadata?.version ?? '1.0.0',
      tools: ['remember', 'recall', 'correctKnowledge', 'distillPractice'],
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  return dir
}

/**
 * 读人格包 persona.md；文件缺失或为空时回退到目录条目 content。
 * @param dir - 人格包目录。
 * @param fallback - 目录条目里的 content。
 * @returns 人格正文。
 */
async function readPersonaText(dir: string, fallback: string): Promise<string> {
  try {
    const text = await readFile(join(dir, 'persona.md'), 'utf8')
    if (text.trim() !== '') return text
  } catch {
    // persona.md 尚未物化：回退目录 content。
  }
  return fallback
}

// ---- 人格工具：see（视觉感知）/ remember / recall（大脑） ----

/** see()：模型驱动的「看一眼」——返回最近的视觉感知。 */
function defineSeeTool() {
  return defineTool({
    name: 'see',
    description: '获取你当前通过摄像头看到的最新画面（实时视觉感知）。用户让你「看看/描述/识别」画面、或需要基于当前画面回答时调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          available: { type: 'boolean', required: true },
          at: { type: 'string', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { available: boolean; at: string; text: string }
        const body = result.available
          ? `你刚刚通过摄像头看到（${result.at}）：${result.text}`
          : '当前没有可用的视觉感知（摄像头未开启或尚未捕获画面）。'
        return [{ type: 'text', text: body }]
      },
    },
    async execute() {
      const snapshot = latestPerception
      if (snapshot !== undefined
        && Date.now() - new Date(snapshot.at).getTime() <= PERCEPTION_TTL_MS) {
        return { available: true, at: snapshot.at, text: snapshot.text }
      }
      return { available: false, at: '', text: '' }
    },
  })
}

/** remember()：把重要信息写入当前人格的大脑记忆。 */
function defineRememberTool(getBrain: () => PersonBrain | undefined) {
  return defineTool({
    name: 'remember',
    description: '写入一条跨对话记忆。**只记用户明确说过的内容**（「我喜欢…」「我是…」「我的…是…」「记住…」等原话表达的信息），'
      + '绝不记自己猜测/推断/脑补的内容（如用户没提过的喜好、没确认过的事实）。'
      + '内容必须忠实于用户原话，禁止编造、填充、美化。不确定用户是否说过 → 不要调用本工具。',
    parameters: {
      content: { type: 'string', required: true, description: '用户原话传达的信息，一句话忠实转述。' },
      kind: { type: 'string', description: '记忆类型：episodic(经历)/semantic(语义)/fact(事实)，默认 episodic。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number', required: true },
          kind: { type: 'string', required: true },
          content: { type: 'string', required: true },
          importance: { type: 'number', required: true },
          source: { type: 'string', required: true },
          topic: { type: 'string', required: true },
          createdAt: { type: 'string', required: true },
          needsReview: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { content: string; kind: string; createdAt: string }
        return [{ type: 'text', text: `已记住（${result.kind}）：${result.content}` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { content?: unknown; kind?: unknown }
      const content = typeof input.content === 'string' ? input.content.trim() : ''
      if (content === '') throw new Error('remember: content 不能为空')
      const kind = typeof input.kind === 'string' && input.kind.trim() !== '' ? input.kind.trim() : 'episodic'
      // 幻觉防线：记忆内容以「用户…」猜测句式开头（模型推断而非用户陈述）时拒绝写入。
      if (/^(用户(应该|可能|大概|似乎|估计|好像|或许|也许)|我猜|我觉得用户|推测)/.test(content)) {
        return { id: 0, kind, content, importance: 0, source: 'rejected-hallucination', topic: '', createdAt: '', needsReview: false }
      }
      const brain = getBrain()
      if (brain === undefined) {
        throw new Error('remember: 人格大脑暂不可用（勾选状态切换中），请稍后重试')
      }
      return brain.remember(content, kind, 1)
    },
  })
}

/** correctKnowledge()：纠错/删除已沉淀的知识（对话归纳、视频实操、联网知识等）。
 * 有 content 则更新；无 content 则删除整条知识。
 * 删除后 system prompt 下次模型请求时自动重算（memory section 每次动态读取 DB）。
 */
function defineCorrectKnowledgeTool(globalBrain: PersonBrain) {
  return defineTool({
    name: 'correctKnowledge',
    description: '纠正或撤销已沉淀的知识。当用户指出某条信息错误、过时，或要求「删掉那条/忘掉那个」时使用。'
      + '有 content 则更新该主题的知识；无 content 则删除整条。操作立即生效，后续问答不再引用旧内容。',
    parameters: {
      topic: { type: 'string', required: true, description: '要修正或删除的知识主题键，如「对话：用户生日」「实操：手机贴膜」。' },
      content: { type: 'string', description: '修正后的内容；不传或传空串表示删除整条知识。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string', enum: ['updated', 'deleted', 'not-found'], required: true },
        },
      },
      render: (args, value) => {
        const result = value as { ok: boolean; action: string }
        const topic = (typeof args?.topic === 'string' ? args.topic : '')
        if (!result.ok) return [{ type: 'text', text: '纠正失败：知识条目不存在。' }]
        if (result.action === 'deleted') return [{ type: 'text', text: `已删除「${topic}」。` }]
        return [{ type: 'text', text: `已更新「${topic}」。` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { topic?: unknown; content?: unknown }
      const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
      const content = typeof input.content === 'string' ? input.content : undefined
      if (topic === '') throw new Error('correctKnowledge: topic 不能为空')
      const existing = globalBrain.recallKnowledge(topic)
      if (existing.length === 0) return { ok: false, action: 'not-found' as const }
      const row = existing[0]!
      if (content !== undefined && content.trim() !== '') {
        // 更新：保留 tags/source/status，只改 content 和 updated_at。
        globalBrain.setPracticeMeta(topic, { tags: row.tags, status: row.status, suggestedSkill: row.suggestedSkill })
        globalBrain.learn(topic, content.trim(), row.tags, row.source, row.needsReview)
        return { ok: true, action: 'updated' as const }
      }
      // 删除。
      globalBrain.removeKnowledge(topic)
      return { ok: true, action: 'deleted' as const }
    },
  })
}

/**
 * distillPractice()：实操经验提炼——主脑把某技能下的知识 + 记忆 + 视频实操素材
 * 总结成一套完整可跑通的实操经验（方法/步骤），写入全局大脑（#实操 标签 + 归位到该技能）。
 * 橙色实操节点只显示这类提炼结果，而不是零散的原始视频画面。
 */
function defineDistillPracticeTool(
  ctx: Context,
  getSkillTitle: (id: string) => string,
  collectSkillMaterials: (skillId: string) => { knowledge: PersonKnowledge[]; memories: string[]; scenes: string[] },
  globalBrain: PersonBrain,
) {
  return defineTool({
    name: 'distillPractice',
    description: '实操经验提炼：把某个技能下积累的知识、记忆和视频实操素材，总结成一套完整、可跑通的实操经验（步骤/方法）。'
      + '当用户说「总结一下XX怎么做」「把XX整理成操作步骤」「XX的实操经验是什么」或该技能素材明显增多时使用。'
      + '结果以 #实操 标签沉淀到全局大脑，后续问答与图谱都会引用这套经验。',
    parameters: {
      skillId: { type: 'string', required: true, description: '目标技能 id（如 sqe-8d / mao-niang）。' },
      focus: { type: 'string', description: '可选：提炼重点，如「手机贴膜的完整流程」。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          topic: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const result = value as { ok: boolean; topic: string; summary: string; error?: string }
        if (!result.ok) return [{ type: 'text', text: `实操提炼失败：${result.error ?? '未知原因'}` }]
        return [{ type: 'text', text: `已提炼实操经验「${result.topic}」：${result.summary}` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { skillId?: unknown; focus?: unknown }
      const skillId = typeof input.skillId === 'string' ? input.skillId.trim() : ''
      const focus = typeof input.focus === 'string' ? input.focus.trim() : ''
      if (skillId === '') throw new Error('distillPractice: skillId 不能为空')
      const materials = collectSkillMaterials(skillId)
      const knowledgeText = materials.knowledge
        .map(k => `【知识】${k.topic}：${k.content}`)
        .join('\n')
      const memoryText = materials.memories.map(m => `【记忆】${m}`).join('\n')
      const sceneText = materials.scenes.map(s => `【视频】${s}`).join('\n')
      const body = [knowledgeText, memoryText, sceneText].filter(t => t !== '').join('\n')
      if (body.trim() === '') {
        return { ok: false, topic: '', summary: '', error: `技能「${skillId}」还没有可提炼的素材（知识/记忆/视频都为空）` }
      }
      const skillTitle = getSkillTitle(skillId) || skillId
      const system = [
        '你是蝶翅的主脑整理官。把某个技能下积累的零散素材（对话知识、用户记忆、视频实操画面）',
        '提炼成一套**完整、可跑通**的实操经验：一段有序的操作步骤/方法，能直接照着做。',
        '只输出一个 JSON 对象，不要输出其他内容：',
        '{"topic":"实操主题（12 字以内，如 手机贴膜完整流程）","summary":"完整实操经验：分步骤描述，每步以编号开头（1. 2. 3.），60-200 字"}',
        '要求：',
        '- 步骤要具体可执行（工具、参数、顺序、注意事项），不要空话；',
        '- 素材不足时如实总结已有信息，不要编造不存在的步骤；',
        '- 素材完全无关或为零时 summary 返回空串表示无法提炼。',
      ].join('\n')
      const prompt = JSON.stringify({
        skill: skillTitle,
        focus: focus || '（无特别指定，全面总结）',
        materials: truncateText(body, 3000),
      })
      let text: string
      try {
        text = await auxiliaryLlmText(ctx, system, prompt, 600)
      } catch (error) {
        return { ok: false, topic: '', summary: '', error: error instanceof Error ? error.message : 'llm-unavailable' }
      }
      const json = parseLlmJson(text)
      if (json === null) return { ok: false, topic: '', summary: '', error: 'llm-output-unparseable' }
      const topic = typeof json.topic === 'string' ? json.topic.trim().slice(0, 30) : ''
      const summary = typeof json.summary === 'string' ? json.summary.trim().slice(0, 500) : ''
      if (topic === '' || summary === '') {
        return { ok: false, topic: '', summary: '', error: '素材不足以提炼成实操经验' }
      }
      const key = '实操：' + topic
      // 主脑合并开启：相似实操主题自动并入旧条目。
      globalBrain.learn(key, summary, `实操, ${skillId}`, 'practice', false, true)
      globalBrain.setPracticeMeta(key, { status: 'assigned', suggestedSkill: skillId })
      console.log(`[skill-store] 实操经验已提炼 → ${skillId} ${key}`)
      return { ok: true, topic: key, summary }
    },
  })
}

/** 收集某技能下的提炼素材：全局大脑中归位该技能的知识 + 该人格的记忆 + 有信息量的视频场景。 */
function collectSkillMaterials(
  skillId: string,
  globalBrain: PersonBrain,
  openPersonBrain: (id: string) => PersonBrain | undefined,
): { knowledge: PersonKnowledge[]; memories: string[]; scenes: string[] } {
  const knowledge = globalBrain
    .listInbox('', '', 200)
    .filter(k => k.suggestedSkill === skillId && k.status === 'assigned')
  const memories: string[] = []
  const scenes: string[] = []
  const pb = openPersonBrain(skillId)
  if (pb !== undefined) {
    try {
      for (const m of pb.recall('', 50)) {
        if (m.content.trim() !== '' && !/测试完成请忽略|忽略此/.test(m.content)) memories.push(m.content)
      }
      for (const s of pb.recallScenes(0, '', 50)) {
        if (s.content.trim() !== '' && pb.isInformativeScene(s.content)) scenes.push(s.content)
      }
    } finally {
      pb.close()
    }
  }
  return { knowledge, memories, scenes }
}

/**
 * 主脑自动整理器（tidy）：每次归纳入库后节流运行，把「知识系统」维持在整理态。
 * 1) 自动除幻觉：模式化假数据/猜测式推断记忆自动删除，低置信度敏感信息标记待确认；
 * 2) 记忆相似合并：人格大脑中同主题重复的记忆自动合并；
 * 3) 实操经验提炼：技能素材（知识+记忆+有信息量场景）足够（≥3 条）时，自动把
 *    零散素材总结成有具体内容的实操经验条目（topic=实操：…，标签=实操+技能id，
 *    归位到该技能），避免「记了跟没记一样」；
 * 4) 噪音场景清理：低信息量重复画面自动归并。
 * @returns 本次整理的动作摘要（供日志/测试断言）。
 */
async function tidyBrains(
  ctx: Context,
  globalBrain: PersonBrain,
  openPersonBrain: (id: string) => PersonBrain | undefined,
  skillTitles: ReadonlyMap<string, string>,
  skillIds: readonly string[],
): Promise<{ mergedMemories: number; distilled: number; cleanedScenes: number; removedHallucinations: number }> {
  const result = { mergedMemories: 0, distilled: 0, cleanedScenes: 0, removedHallucinations: 0 }
  // 0) 自动除幻觉：全局大脑 + 所有人格大脑扫描。
  try {
    const scan = globalBrain.scanAndRemoveHallucinations()
    result.removedHallucinations += scan.removed
  } catch { /* 瞬时关闭：跳过 */ }
  for (const skillId of skillIds) {
    const scanPb = openPersonBrain(skillId)
    if (scanPb === undefined) continue
    try {
      const scan = scanPb.scanAndRemoveHallucinations()
      result.removedHallucinations += scan.removed
    } catch { /* 瞬时关闭：跳过 */ } finally {
      scanPb.close()
    }
  }
  for (const skillId of skillIds) {
    const pb = openPersonBrain(skillId)
    if (pb === undefined) continue
    try {
      // 1) 记忆相似合并：扫描已有记忆，把归一化后相同的合并（保留重要性最高者）。
      const mems = pb.recall('', 300)
      const normalized = new Map<string, typeof mems[number]>()
      for (const m of mems) {
        const key = normalizeMemoryText(m.content)
        if (key === '') continue
        const existing = normalized.get(key)
        if (existing !== undefined) {
          // 保留内容更长、重要性更高的；删除另一条。
          const keep = existing.importance >= m.importance && existing.content.length >= m.content.length ? existing : m
          const drop = keep === existing ? m : existing
          pb.removeMemory(drop.id)
          if (keep.importance < Math.max(existing.importance, m.importance)) {
            pb.remember(keep.content, keep.kind, Math.max(existing.importance, m.importance))
          }
          normalized.set(key, keep)
          result.mergedMemories += 1
        } else {
          normalized.set(key, m)
        }
      }
      // 3) 噪音场景清理（低信息量重复画面归并）。
      result.cleanedScenes += pb.cleanupScenes(2000)
    } finally {
      pb.close()
    }
  }
  // 2) 实操经验自动提炼：全局大脑中该技能的素材（知识+记忆+场景）足够时，
  //    自动总结成有具体内容的实操经验。仅当该技能尚无同主题实操经验时提炼，
  //    避免重复调用 LLM。
  for (const skillId of skillIds) {
    const materials = collectSkillMaterials(skillId, globalBrain, openPersonBrain)
    const materialCount = materials.knowledge.length + materials.memories.length + materials.scenes.length
    if (materialCount < 3) continue
    const hasPractice = globalBrain
      .listInbox('', '', 200)
      .some(k => k.suggestedSkill === skillId && k.tags.includes('实操') && k.source === 'practice')
    if (hasPractice) continue
    const skillTitle = skillTitles.get(skillId) ?? skillId
    const knowledgeText = materials.knowledge.map(k => `【知识】${k.topic}：${k.content}`).join('\n')
    const memoryText = materials.memories.map(m => `【记忆】${m}`).join('\n')
    const sceneText = materials.scenes.map(s => `【视频】${s}`).join('\n')
    const body = [knowledgeText, memoryText, sceneText].filter(t => t !== '').join('\n')
    if (body.trim() === '') continue
    const system = [
      '你是蝶翅的主脑整理官。把某个技能下积累的素材（对话知识、用户记忆、视频实操画面）',
      '提炼成一套**有具体内容、完整可跑通**的实操经验：分步骤、含参数与注意事项，能直接照着做。',
      '只输出一个 JSON 对象，不要输出其他内容：',
      '{"topic":"实操主题（12 字以内）","summary":"完整实操经验：编号步骤（1. 2. 3.），60-200 字，必须包含具体做法而非空话"}',
      '要求：',
      '- 步骤只能来自素材中真实出现的内容；素材没有的步骤、参数、注意事项一律不得编造；',
      '- 素材不足或无法形成完整步骤时，summary 如实总结已有信息即可，不要虚构步骤凑数；',
      '- 素材完全无关或为零时 summary 返回空串表示无法提炼。',
    ].join('\n')
    try {
      const text = await auxiliaryLlmText(ctx, system, JSON.stringify({ skill: skillTitle, materials: truncateText(body, 3000) }), 600)
      const json = parseLlmJson(text)
      const topic = typeof json?.topic === 'string' ? json.topic.trim().slice(0, 30) : ''
      const summary = typeof json?.summary === 'string' ? json.summary.trim().slice(0, 500) : ''
      if (json !== null && topic !== '' && summary !== '') {
        const key = '实操：' + topic
        globalBrain.learn(key, summary, `实操, ${skillId}`, 'practice', false, true)
        globalBrain.setPracticeMeta(key, { status: 'assigned', suggestedSkill: skillId })
        result.distilled += 1
        console.log(`[skill-store] 自动整理 → 已提炼实操经验 ${skillId} ${key}`)
      }
    } catch (error) {
      console.warn('[skill-store] 自动整理-实操提炼失败', error instanceof Error ? error.message : error)
    }
  }
  return result
}

/** recall()：从当前人格的大脑记忆中回忆相关内容，并附带全局大脑的实操阅历。 */
function defineRecallTool(getBrain: () => PersonBrain | undefined, getPractice: (query: string, limit: number) => PersonKnowledge[]) {
  return defineTool({
    name: 'recall',
    description: '回忆与查询相关内容：当前人格自己的记忆，以及你在全局大脑中的实操阅历（用户真实做过的实操，带 #实操 标签）。回答涉及用户偏好、过往约定、历史事件、实操经验前，先调用它回忆。',
    parameters: {
      query: { type: 'string', description: '回忆关键词；留空返回最近记忆。' },
      limit: { type: 'number', description: '返回条数上限，默认 8。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true },
          memories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'number', required: true },
                kind: { type: 'string', required: true },
                content: { type: 'string', required: true },
                importance: { type: 'number', required: true },
                source: { type: 'string', required: true },
                topic: { type: 'string', required: true },
                createdAt: { type: 'string', required: true },
                needsReview: { type: 'boolean', required: true },
              },
            },
          },
          practice: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                topic: { type: 'string', required: true },
                content: { type: 'string', required: true },
                tags: { type: 'string', required: true },
                status: { type: 'string', required: true },
                suggestedSkill: { type: 'string', required: true },
                source: { type: 'string', required: true },
                updatedAt: { type: 'string', required: true },
                needsReview: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as { count: number; memories: PersonMemory[]; practice: PersonKnowledge[] }
        const lines: string[] = []
        for (const memory of result.memories) {
          lines.push(`- [记忆 ${memory.createdAt}] (${memory.kind}) ${memory.content}`)
        }
        for (const item of result.practice) {
          lines.push(`- [实操阅历 ${item.updatedAt}] ${item.topic}：${item.content}`)
        }
        if (lines.length === 0) return [{ type: 'text', text: '大脑记忆与实操阅历中没有相关内容。' }]
        return [{ type: 'text', text: `回忆到 ${result.memories.length} 条记忆 + ${result.practice.length} 条实操阅历：\n${lines.join('\n')}` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { query?: unknown; limit?: unknown }
      const query = typeof input.query === 'string' ? input.query : ''
      const limit = typeof input.limit === 'number' ? input.limit : 8
      const brain = getBrain()
      if (brain === undefined) {
        return { count: 0, memories: [], practice: [] }
      }
      const memories = brain.recall(query, limit)
      // 全局大脑的实操阅历并入召回（由 diechi-brain 插件提供，最多 5 条），
      // 让人格能引用用户真实做过的实操，而不只是自己的记忆。
      const practice = getPractice(query.trim(), limit)
      return { count: memories.length + practice.length, memories, practice }
    },
  })
}
