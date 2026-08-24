/**
 * Type face of the forwarded-Host-event allowlist: the consumer key projection
 * and the selection seat it fills. The allowlist VALUE lives in
 * `./remote-events.ts`, keeping this module type-only per the package
 * convention; both compiler faces list both files, so the Host forwarding loop
 * and the consumer `ctx.remote.$on` key face read one declaration instead of
 * two copies that could drift.
 *
 * @module @deepseek-ai/dsh-api-remotes/types
 */

import type { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

/** Type projection of the allowlist; the consumer and the Host read this one. */
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]

/** Host type faces the client bundle legitimately consumes (diechi 全局大脑 RPC). */
export type {
  BrainAssignInput, BrainAssignResult, BrainIngestInput, BrainInboxSnapshot,
  BrainPracticeItem, BrainRemoveInput, BrainTagsInput, SkillOverviewEntry, SkillOverviewSnapshot,
  BrainGraphInput, BrainGraphSnapshot, BrainGraphNode, BrainGraphEdge,
  BrainPendingMemory, BrainPendingMemoriesSnapshot, BrainMemoryActionInput, BrainMemoryActionResult,
} from '@deepseek-ai/dsh-host-diechi-brain/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
