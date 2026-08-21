/**
 * Generic skill manifest, browser half.
 *
 * This is the client-side copy of the shared import/export format owned by
 * the dsh-web-app skill-store row. The two copies must stay in sync: the
 * browser half parses and validates what the user imports, the host half
 * re-validates the same JSON when it bridges the catalog onto `ctx.skills`.
 *
 * The current manifest format is version 2: v1 entries (no `status` /
 * `revisions`) are migrated on import into a published status with a single
 * seed revision so history, export and restore always have a baseline.
 */

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
 * Versioned skill manifest entry. `id` doubles as the slash command name
 * (`/id` in the composer); `content` is the markdown body the harness
 * injects verbatim. An empty body marks content as pending.
 */
export interface SkillManifestEntry {
  /** Manifest format version; 2 is the current release. */
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

/** The persisted catalog section (shape owned by the host skill-store row). */
export interface SkillStoreSettings {
  /** All installed skills, in store order. */
  readonly skills: readonly SkillManifestEntry[]
}

/** One discoverable skill in the local market catalog (host-scanned). */
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
  /** Full SKILL.md instruction body. */
  readonly content: string
}

/** The scanned local market catalog section (read-only from the client). */
export interface SkillMarketSettings {
  /** Absolute path of the scanned market directory. */
  readonly dir: string
  /** All discoverable skills, in file order. */
  readonly skills: readonly SkillMarketSkill[]
}

/**
 * One in-flight training session (训练模式): the retrain / create flow opens
 * a conversation where the user feeds corpus or video material (or asks the
 * agent to collect data), and the "完成训练" button closes the round so the
 * agent runs skill-generate. Persisted under the `skill-training` namespace.
 */
export interface SkillTrainingSettings {
  /** Whether a training round is active. */
  readonly active: boolean
  /** Retrain targets an existing skill; create mints a new one. */
  readonly mode: 'retrain' | 'create'
  /** Retrain target id; empty for create mode. */
  readonly skillId: string
  /** Human title shown in the training banner. */
  readonly skillTitle: string
  /** The conversation the training lives in (dock shows on that session only). */
  readonly sessionId: string
  /** Epoch ms when the round started. */
  readonly startedAt: number
}

/** The client-side training state snapshot (mirrors SkillTrainingSettings). */
export interface TrainingState {
  readonly active: boolean
  readonly mode: 'retrain' | 'create'
  readonly skillId: string
  readonly skillTitle: string
  readonly sessionId: string
  readonly startedAt: number
}

/** Idle training state used before the first snapshot lands. */
export const IDLE_TRAINING: TrainingState = {
  active: false,
  mode: 'retrain',
  skillId: '',
  skillTitle: '',
  sessionId: '',
  startedAt: 0,
}

/**
 * Convert one market entry into an installable manifest entry. Installed
 * skills are published and user-invocable by default; the persona flag stays
 * off until the user checks it in Skill settings.
 * @param skill - the scanned market skill.
 * @returns the manifest entry, marked as coming from the market.
 */
export function marketSkillToEntry(skill: SkillMarketSkill): SkillManifestEntry {
  const updatedAt = new Date().toISOString()
  const version = skill.version !== '' ? skill.version : '1.0.0'
  return {
    formatVersion: 2,
    id: skill.id,
    title: skill.title !== '' ? skill.title : skill.id,
    description: skill.description,
    whenToUse: skill.whenToUse ?? '',
    kind: skill.kind,
    status: 'published',
    enabled: false,
    invocation: { modelInvocable: true, userInvocable: true },
    content: skill.content,
    source: 'market',
    revisions: skill.content.trim() !== ''
      ? [{ version, content: skill.content, updatedAt, note: '\u6765\u81ea\u672c\u5730\u5546\u5e97' }]
      : [],
    metadata: {
      version,
      ...(skill.author !== undefined && skill.author !== '' ? { author: skill.author } : {}),
      tags: skill.tags,
      origin: 'skill-market',
    },
  }
}

/** Whether a parsed value is a well-formed manifest entry. */
export function isSkillManifestEntry(value: unknown): value is SkillManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return entry.formatVersion === 1 || entry.formatVersion === 2
    && typeof entry.id === 'string' && entry.id.length > 0
    && typeof entry.title === 'string'
    && typeof entry.description === 'string'
    && typeof entry.content === 'string'
    && (entry.kind === undefined || entry.kind === 'text' || entry.kind === 'vision')
    && (entry.status === undefined || entry.status === 'draft' || entry.status === 'testing' || entry.status === 'published')
    && (entry.enabled === undefined || typeof entry.enabled === 'boolean')
    && (entry.source === undefined
      || entry.source === 'builtin' || entry.source === 'imported' || entry.source === 'generated'
      || entry.source === 'trained' || entry.source === 'market')
}

function parseInvocation(value: unknown): SkillManifestInvocation {
  if (typeof value !== 'object' || value === null) return { modelInvocable: true, userInvocable: true }
  const raw = value as Record<string, unknown>
  const modelInvocable = typeof raw.modelInvocable === 'boolean' ? raw.modelInvocable : true
  const userInvocable = typeof raw.userInvocable === 'boolean' ? raw.userInvocable : true
  return { modelInvocable, userInvocable }
}

/** Parse a list of comma-separated tags from a string value. */
function parseTags(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
}

/** Build the seed revision for v1 entries (and imports without a revision). */
function seedRevision(entry: {
  readonly content: string
  readonly metadata: SkillManifestMetadata | undefined
}): SkillManifestRevision {
  return {
    version: entry.metadata?.version ?? '1.0.0',
    content: entry.content,
    updatedAt: entry.metadata?.updatedAt ?? new Date().toISOString(),
    note: '初始版本',
  }
}

/** Normalize one raw JSON skill into a v2 manifest entry. */
function normalizeJsonEntry(raw: unknown, index: number): SkillManifestEntry {
  if (typeof raw !== 'object' || raw === null) throw new Error(`第 ${index + 1} 个技能不是有效对象`)
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || entry.id.trim() === '') throw new Error(`第 ${index + 1} 个技能缺少 id`)
  if (typeof entry.description !== 'string') throw new Error(`技能 ${entry.id} 缺少 description`)
  if (typeof entry.content !== 'string') throw new Error(`技能 ${entry.id} 缺少 content`)
  const id = entry.id.trim()
  const metadataObj = typeof entry.metadata === 'object' && entry.metadata !== null
    ? entry.metadata as Record<string, unknown>
    : undefined
  const metadata: SkillManifestMetadata | undefined = metadataObj === undefined
    ? undefined
    : {
        ...(typeof metadataObj.author === 'string' ? { author: metadataObj.author } : {}),
        ...(typeof metadataObj.version === 'string' ? { version: metadataObj.version } : {}),
        ...(typeof metadataObj.license === 'string' ? { license: metadataObj.license } : {}),
        ...(typeof metadataObj.updatedAt === 'string' ? { updatedAt: metadataObj.updatedAt } : {}),
        ...(typeof metadataObj.origin === 'string' ? { origin: metadataObj.origin } : {}),
        ...(Array.isArray(metadataObj.tags) ? { tags: metadataObj.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
        ...(Array.isArray(metadataObj.examples) ? { examples: metadataObj.examples.filter((example): example is string => typeof example === 'string') } : {}),
      }
  const content = entry.content
  const status: SkillManifestEntry['status'] = entry.status === 'draft' || entry.status === 'testing' ? entry.status : 'published'
  const revisionsRaw = Array.isArray(entry.revisions) ? entry.revisions : []
  const revisions = revisionsRaw.length > 0
    ? revisionsRaw.map((revision): SkillManifestRevision | undefined => {
        if (typeof revision !== 'object' || revision === null) return undefined
        const rawRevision = revision as Record<string, unknown>
        if (typeof rawRevision.version !== 'string' || typeof rawRevision.content !== 'string') return undefined
        return {
          version: rawRevision.version,
          content: rawRevision.content,
          updatedAt: typeof rawRevision.updatedAt === 'string' ? rawRevision.updatedAt : new Date().toISOString(),
          note: typeof rawRevision.note === 'string' ? rawRevision.note : '',
        }
      }).filter((revision): revision is SkillManifestRevision => revision !== undefined)
    : (content.trim() !== '' ? [seedRevision({ content, metadata })] : [])
  return {
    formatVersion: 2,
    id,
    title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title : id,
    description: entry.description,
    whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
    kind: entry.kind === 'vision' ? 'vision' : 'text',
    status,
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : false,
    invocation: parseInvocation(entry.invocation),
    content,
    source: entry.source === 'builtin' || entry.source === 'generated' || entry.source === 'trained' || entry.source === 'market'
      ? entry.source
      : 'imported',
    revisions,
    ...(metadata !== undefined && Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

/** Split YAML frontmatter from a markdown body; returns undefined when absent. */
function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return undefined
  const dataText = match[1]
  const bodyText = match[2]
  if (dataText === undefined || bodyText === undefined) return undefined
  const data: Record<string, unknown> = {}
  for (const line of dataText.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (pair === null) continue
    const key = pair[1]
    const rawValue = pair[2]
    if (key === undefined || rawValue === undefined) continue
    let value: string | boolean = rawValue.trim().replace(/^['"]|['"]$/g, '')
    if (value === 'true') value = true
    if (value === 'false') value = false
    data[key] = value
  }
  return { data, body: bodyText.trim() }
}

/** Parse one SKILL.md document (frontmatter + markdown body). */
export function parseSkillMarkdown(text: string): SkillManifestEntry {
  const split = splitFrontmatter(text)
  if (split === undefined) throw new Error('缺少 YAML frontmatter（--- 分隔的 name/description 头）')
  const { data, body } = split
  const name = data.name
  if (typeof name !== 'string' || name.trim() === '') throw new Error('frontmatter 缺少 name')
  if (typeof data.description !== 'string' || data.description.trim() === '') {
    throw new Error(`技能 ${name} 缺少 description`)
  }
  const id = name.trim()
  const content = body
  const tags = parseTags(data.tags)
  const version = typeof data.version === 'string' && data.version.trim() !== '' ? data.version.trim() : undefined
  const metadata: SkillManifestMetadata | undefined = (version !== undefined || tags !== undefined)
    ? {
        ...(version !== undefined ? { version } : {}),
        ...(tags !== undefined ? { tags } : {}),
      }
    : undefined
  return {
    formatVersion: 2,
    id,
    title: typeof data.title === 'string' && data.title.trim() !== '' ? data.title : id,
    description: data.description.trim(),
    whenToUse: typeof data['when-to-use'] === 'string' ? data['when-to-use'] : '',
    kind: data.kind === 'vision' ? 'vision' : 'text',
    status: 'published',
    enabled: data.enabled === true,
    invocation: {
      modelInvocable: data['disable-model-invocation'] !== true,
      userInvocable: data['user-invocable'] !== false,
    },
    content,
    source: 'imported',
    revisions: content.trim() !== '' ? [seedRevision({ content, metadata })] : [],
    ...(metadata !== undefined ? { metadata } : {}),
  }
}

/**
 * Parse an imported file into manifest entries. Accepts a .json manifest
 * (one entry, an array, or `{ skills: [...] }`) or a .md SKILL.md document.
 * @param text - raw file text.
 * @param fileName - file name used to pick the parser.
 * @returns parsed entries, each marked as imported.
 */
export function parseSkillImport(text: string, fileName: string): SkillManifestEntry[] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('JSON 解析失败，请检查文件内容')
    }
    let rawEntries: unknown[]
    if (Array.isArray(parsed)) rawEntries = parsed
    else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).skills)) {
      rawEntries = (parsed as Record<string, unknown>).skills as unknown[]
    } else rawEntries = [parsed]
    if (rawEntries.length === 0) throw new Error('导入文件里没有任何技能')
    return rawEntries.map((raw, index) => normalizeJsonEntry(raw, index))
  }
  if (lower.endsWith('.md')) return [parseSkillMarkdown(text)]
  throw new Error('仅支持 .md（SKILL.md 格式）或 .json（通用清单）文件')
}

/** Quote a frontmatter scalar when it carries characters that would break the line. */
function frontmatterScalar(value: string): string {
  const trimmed = value.trim()
  if (/[:#\[\]{}"'\r\n]/.test(trimmed) || trimmed === '') {
    return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`
  }
  return trimmed
}

/** Pick the body a serialization should emit (an explicit revision, else current). */
export function revisionBody(entry: SkillManifestEntry, revision?: SkillManifestRevision): string {
  return (revision ?? entry.revisions[entry.revisions.length - 1] ?? { content: entry.content, version: '1.0.0' }).content
}

/**
 * Serialize one skill into the standard SKILL.md document (frontmatter +
 * markdown body). Pass a revision to export an older snapshot; the exported
 * frontmatter records that snapshot's version.
 * @param entry - the manifest entry.
 * @param revision - optional revision snapshot to export instead of the current body.
 * @returns the serialized markdown document.
 */
export function serializeSkillMarkdown(entry: SkillManifestEntry, revision?: SkillManifestRevision): string {
  const body = revisionBody(entry, revision)
  const version = revision?.version ?? entry.metadata?.version ?? '1.0.0'
  const tags = (entry.metadata?.tags ?? []).join(', ')
  const lines = [
    '---',
    `name: ${entry.id}`,
    `title: ${frontmatterScalar(entry.title)}`,
    `description: ${frontmatterScalar(entry.description)}`,
    ...(entry.whenToUse.trim() !== '' ? [`when-to-use: ${frontmatterScalar(entry.whenToUse)}`] : []),
    `kind: ${entry.kind}`,
    `version: ${version}`,
    ...(tags !== '' ? [`tags: ${frontmatterScalar(tags)}`] : []),
    `user-invocable: ${entry.invocation.userInvocable ? 'true' : 'false'}`,
    `disable-model-invocation: ${entry.invocation.modelInvocable ? 'false' : 'true'}`,
    '---',
    '',
    body,
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Serialize one skill into the generic JSON manifest (the import format
 * mirrors this shape, plus export-only provenance fields). Pass a revision to
 * export an older snapshot.
 * @param entry - the manifest entry.
 * @param revision - optional revision snapshot to export.
 * @returns the serialized JSON document.
 */
export function serializeSkillJson(entry: SkillManifestEntry, revision?: SkillManifestRevision): string {
  const body = revisionBody(entry, revision)
  const version = revision?.version ?? entry.metadata?.version ?? '1.0.0'
  const exported: Record<string, unknown> = {
    formatVersion: 2,
    id: entry.id,
    title: entry.title,
    description: entry.description,
    ...(entry.whenToUse !== '' ? { whenToUse: entry.whenToUse } : {}),
    kind: entry.kind,
    status: entry.status,
    enabled: entry.enabled,
    invocation: entry.invocation,
    content: body,
    source: 'imported',
    metadata: {
      ...(entry.metadata ?? {}),
      version,
      ...(revision !== undefined ? { note: revision.note, exportedAt: new Date().toISOString() } : {}),
    },
  }
  return `${JSON.stringify(exported, null, 2)}\n`
}