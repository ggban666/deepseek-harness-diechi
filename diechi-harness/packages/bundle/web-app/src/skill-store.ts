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
 * @module @deepseek-ai/dsh-web-app/skill-store
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
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { PersonBrain, type PersonMemory } from './person-brain'

/** Stable Cordis plugin name. */
export const name = 'skill-store'

/** Services required before the catalog can bridge to the skill registry. */
export const inject = ['settings', 'skills', 'systemPrompt', 'tools']

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
  const brains = new Map<string, PersonBrain>()
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
          brains.set(entry.id, PersonBrain.open(dir))
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
              ctx.tools.register(defineRememberTool(brain)),
              ctx.tools.register(defineRecallTool(brain)),
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
      syncPersona(ctx, settings, visionState, personaTexts)
    }).catch((error: unknown) => {
      console.error('skill-store: 人格包同步失败', error)
    })
  }

  // 视觉设置变化：镜像最新感知 → 重挂 see()/感知区块 → 重绘人格。
  vision.watch((next) => {
    latestPerception = next.lastPerception
    syncVisionSurfaces(next)
    sync(store.get(), next)
  })
  syncVisionSurfaces(vision.get())
  sync(store.get(), vision.get())
  store.watch((next) => { sync(next, vision.get()) })
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
    const body = personaTexts.get(entry.id) ?? entry.content
    if (body.trim() !== '') lines.push(body.trim())
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
let personaSection: (() => void) | undefined

// ---- 视觉感知通道：让模型「知道自己能看到」 ----

/** 一帧视觉感知快照（宿主内存，TTL 内有效）。 */
export interface PerceptionSnapshot {
  /** 感知发生的 ISO 时间戳。 */
  readonly at: string
  /** 感知正文（画面描述）。 */
  readonly text: string
}

/** 感知快照的有效期：超过该时长视为过期，不再注入上下文。 */
const PERCEPTION_TTL_MS = 120_000

/** 最近一帧视觉感知（由客户端写入 skill-vision.lastPerception 镜像而来）。 */
let latestPerception: PerceptionSnapshot | undefined

/** 渲染 <perception> 感知区块（system prompt 动态节，每次装配求值）。 */
function renderPerceptionSection(): string {
  const snapshot = latestPerception
  if (snapshot === undefined) return ''
  if (Date.now() - new Date(snapshot.at).getTime() > PERCEPTION_TTL_MS) return ''
  return [
    '<perception>',
    `时间：${snapshot.at}`,
    `你刚刚通过摄像头看到：${snapshot.text}`,
    '这是你的实时视觉输入，是你亲眼所见，不是用户转述。用户询问画面内容、或让你「看看/描述/识别」时，直接基于它回答，不要说你看不到画面或无法查看摄像头。',
    '</perception>',
  ].join('\n')
}

/** 感官自我声明：视觉开启时注入人格区，让模型有稳定的「我能看到」身份。 */
function renderSensorySelf(): string {
  return [
    '## 你的感官（视觉）',
    '你有视觉能力：你通过摄像头实时观察用户环境。对话中出现的「感知」区块就是你亲眼看到的画面，不是用户的转述。',
    '用户询问画面内容、或让你「看看/描述/识别」时，直接基于感知区块回答，不要说你看不到画面或无法查看摄像头；必要时调用 see() 获取最新画面。',
  ].join('\n')
}

// ---- 人格包：磁盘目录形态（persona.md + manifest.json + brain.db） ----

/**
 * 人格包根目录：`$DSH_HOME/persons`，未设置 DSH_HOME 时回退
 * `~/.dsh/persons`。
 * @returns 人格包根目录的绝对路径。
 */
function personsRootDir(): string {
  const fromEnv = (process.env.DSH_HOME ?? '').trim()
  const home = fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
  return join(home, 'persons')
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
      tools: ['remember', 'recall'],
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
function defineRememberTool(brain: PersonBrain) {
  return defineTool({
    name: 'remember',
    description: '把你刚刚得知的、需要跨对话记住的信息（用户偏好、事实、约定、重要经历）写入当前人格的大脑记忆。',
    parameters: {
      content: { type: 'string', required: true, description: '要记住的内容，一句话为宜。' },
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
          createdAt: { type: 'string', required: true },
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
      return brain.remember(content, kind, 1)
    },
  })
}

/** recall()：从当前人格的大脑记忆中回忆相关内容。 */
function defineRecallTool(brain: PersonBrain) {
  return defineTool({
    name: 'recall',
    description: '从当前人格的大脑记忆中回忆与查询相关的内容（或最近记忆）。回答涉及用户偏好、过往约定、历史事件前，先调用它回忆。',
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
                createdAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as { count: number; memories: PersonMemory[] }
        if (result.count === 0) return [{ type: 'text', text: '大脑记忆中没有相关内容。' }]
        const lines = result.memories.map(memory =>
          `- [${memory.createdAt}] (${memory.kind}) ${memory.content}`)
        return [{ type: 'text', text: `回忆起 ${result.count} 条记忆：\n${lines.join('\n')}` }]
      },
    },
    async execute(args: unknown) {
      const input = args as { query?: unknown; limit?: unknown }
      const query = typeof input.query === 'string' ? input.query : ''
      const limit = typeof input.limit === 'number' ? input.limit : 8
      const memories = brain.recall(query, limit)
      return { count: memories.length, memories }
    },
  })
}
