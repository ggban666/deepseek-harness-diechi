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
import { readdir, readFile } from 'node:fs/promises'

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
  ctx.settings.register(settingsNamespace(SKILL_VISION_NS), visionSchema)
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

  // The reserved generation seam (SkillGenerator) is intentionally not wired
  // yet: a future local-vision backend replaces createSkillGenerator without
  // changing the settings UI or the store format.
  const registrations = new Map<string, () => void>()
  const sync = (settings: SkillStoreSettings): void => {
    const active = new Set<string>()
    for (const raw of settings.skills) {
      const entry = normalizeEntry(raw)
      if (entry.content.trim() === '') continue
      active.add(entry.id)
      if (!registrations.has(entry.id)) {
        registrations.set(entry.id, ctx.skills.register(toSkillRegistration(entry)))
      }
    }
    for (const [id, dispose] of [...registrations]) {
      if (!active.has(id)) {
        dispose()
        registrations.delete(id)
      }
    }
    syncPersona(ctx, settings)
  }

  sync(store.get())
  store.watch((next) => { sync(next) })
}

/** Render the model-facing persona block from every enabled skill. */
function renderPersona(settings: SkillStoreSettings): string {
  const enabled = settings.skills.filter(entry => entry.enabled)
  if (enabled.length === 0) return ''
  const blocks = enabled.map((entry) => {
    const lines: string[] = []
    lines.push(`## ${entry.title} (/${entry.id}) [${entry.kind}]`)
    if (entry.description.trim() !== '') lines.push(entry.description.trim())
    if (entry.whenToUse.trim() !== '') lines.push(`Use when: ${entry.whenToUse.trim()}`)
    if (entry.content.trim() !== '') lines.push(entry.content.trim())
    return lines.join('\n')
  })
  return [
    '<system-reminder>',
    'The following skills are checked as your active persona. Follow them in every reply; they define how you approach this conversation. If a checked skill carries full instructions, follow them exactly.',
    'Reply style: keep replies short, concise and human — like real-time chat. Answer directly in one or two sentences unless the user asks for details; never dump long essays or full reports by default.',
    '回复风格：回复要短小精炼、口语化、拟人，像实时聊天；除非用户明确要求详细，否则一两句话直接回答，不要默认长篇大论。',
    '',
    ...blocks,
    '</system-reminder>',
  ].join('\n')
}

/**
 * Reconcile the enabled skill set onto the system prompt as a scoped persona
 * section. Disposes the previous section before registering the new one so a
 * live settings change is reflected on the next model step.
 */
function syncPersona(ctx: Context, settings: SkillStoreSettings): void {
  if (personaSection !== undefined) {
    personaSection()
    personaSection = undefined
  }
  const text = renderPersona(settings)
  if (text === '') return
  personaSection = ctx.systemPrompt.section({
    name: 'skill-store:persona',
    order: 10,
    text,
  })
}

/** Active persona section disposer; torn down with the plugin. */
let personaSection: (() => void) | undefined