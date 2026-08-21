/**
 * Shared presentation helpers for the Skill 商店 surfaces: the settings
 * section (persona switches + vision config) and the skill-center workshop
 * (installed-skill management). Pure functions only — no React, no state.
 */
import type { SkillStoreKey } from './locales.ts'
import {
  serializeSkillJson, serializeSkillMarkdown,
  type SkillManifestEntry, type SkillManifestRevision,
} from './skill-format.ts'

/** Outcome of an import/install request. */
export type ImportResult = { readonly ok: true; readonly count: number } | { readonly ok: false; readonly error: string }

/** Frames handed to the vision model, plus a source label. */
export interface RecognitionImage {
  /** `data:` URLs — one for a picked image, several for video key frames. */
  readonly dataUrls: readonly string[]
  /** Source label for the notice (file name or camera label). */
  readonly name: string
  /** Input kind; drives the prompt phrasing. */
  readonly kind: 'image' | 'video'
}

/** Structured skill draft the vision model may return (create-form prefill). */
export interface SkillDraft {
  readonly name: string
  readonly purpose: string
  readonly steps: string
  readonly rules: string
}

/** Outcome of a local-vision recognition request. */
export type RecognitionResult =
  | {
      readonly ok: true
      readonly notice: string
      readonly draft?: SkillDraft
      readonly transcript?: string
      /** 视频识别产出的实操过程详述（按时间顺序的操作步骤）。 */
      readonly process?: string
    }
  | { readonly ok: false; readonly error: string }

/** Outcome of a retrain request sent into the conversation. */
export type RetrainResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

/** Source badge copy per manifest source. */
export function sourceLabel(source: SkillManifestEntry['source'], t: (key: SkillStoreKey) => string): string {
  switch (source) {
    case 'builtin': return t('builtin')
    case 'generated': return t('generated')
    case 'trained': return t('trained')
    case 'market': return t('market')
    default: return t('imported')
  }
}

/** Kind badge copy per manifest kind. */
export function kindLabel(kind: SkillManifestEntry['kind'], t: (key: SkillStoreKey) => string): string {
  return kind === 'vision' ? t('kindVision') : t('kindText')
}

/** Status badge copy per manifest status. */
export function statusLabel(status: SkillManifestEntry['status'], t: (key: SkillStoreKey) => string): string {
  switch (status) {
    case 'draft': return t('draft')
    case 'testing': return t('testing')
    default: return t('published')
  }
}

/** Short date label for a revision timestamp. */
export function dateLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

/** File stem for exports: <id>-v<version>.md / .json */
export function exportStem(entry: SkillManifestEntry, revision?: SkillManifestRevision): string {
  const version = revision?.version ?? entry.metadata?.version ?? '1.0.0'
  return `${entry.id}-v${version}`
}

/** Trigger a browser download of a generated skill document. */
function downloadFile(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Download one skill document (current body or a historical revision). */
export function exportSkillDocument(
  entry: SkillManifestEntry,
  format: 'md' | 'json',
  revision?: SkillManifestRevision,
): string {
  const stem = exportStem(entry, revision)
  const body = format === 'md'
    ? serializeSkillMarkdown(entry, revision)
    : serializeSkillJson(entry, revision)
  downloadFile(`${stem}.${format}`, body, format === 'md' ? 'text/markdown' : 'application/json')
  return stem
}