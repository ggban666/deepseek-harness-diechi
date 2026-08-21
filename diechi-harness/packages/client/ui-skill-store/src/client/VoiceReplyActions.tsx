/**
 * Per-message read-aloud entry: one speaker button in the assistant message
 * action strip. Clicking synthesizes that reply through the configured TTS
 * provider; with 自动朗读新回复 enabled, each newly finished reply plays by
 * itself (never replays history: the gate starts at the transcript's newest
 * turn, then speaks strictly newer turns — a fresh first reply is detected
 * by recency so a brand-new conversation still speaks).
 */
import { useEffect, useRef, useState } from 'react'
import {
  IconPlayOutline16, IconStopFill16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailChatData } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assistantText, type VoiceState } from './voice.ts'
import css from './VoiceReplyActions.module.css'

/** Registration-side business face for the chat play button. */
export interface VoiceReplyInjected {
  hooks: {
    /** Voice configuration snapshot bound as useVoice. */
    voice: HostObservable<VoiceState>
  }
  /** Synthesize and play one reply with the saved voice configuration. */
  speak(text: string): Promise<boolean>
  /** Stop the currently playing line. */
  stop(): void
}

/** Props the renderer binds for one per-message play entry. */
export type VoiceReplyActionsProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & PropsLocale<'skill-store'>
  & InjectFace<VoiceReplyInjected>

/** A reply this fresh is a live completion, not history being mounted. */
const FRESH_REPLY_MS = 10 * 60_000

/** Per-session auto-read gate: newest turn seen, initialized on first mount. */
const knownTurns = new Map<string, number>()

/** Render the play/stop speaker button for one finalized assistant message. */
export function VoiceReplyActions({ messageId, useVoice, speak, stop, t, sessionId, useSession }: VoiceReplyActionsProps) {
  const enabled = useVoice(view => view.enabled)
  const autoSpeak = useVoice(view => view.autoSpeak)
  const [playing, setPlaying] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const tail = useSession(snapshot => {
    let found: { turn: number; time: number; text: string } | undefined
    let latest = -1
    let count = 0
    for (const node of snapshot.chat.nodes.values()) {
      if (node.kind !== 'turn-tail') continue
      const data = node.data as TurnTailChatData
      count += 1
      if (data.turn > latest) latest = data.turn
      const closing = data.closing
      if (closing === null || closing.finalNode.messageId !== messageId) continue
      found = { turn: data.turn, time: closing.time, text: assistantText(closing.blocks) }
    }
    return { tail: found, latest, count }
  })

  // Whether this message already existed as a closed turn when it mounted.
  // A message mounted while still streaming is a live completion: it must be
  // spoken when it finalizes, even if the session already has history.
  const mountedWhileStreaming = useRef(tail === undefined || tail.tail === undefined)
  // Speak each finalized reply at most once per mounted instance.
  const spokeRef = useRef(false)

  // Auto-read gate: reacts to the reply finalizing (streaming mounts included);
  // history never replays, and each new reply speaks exactly once.
  useEffect(() => {
    if (!enabled || !autoSpeak) return
    if (tail === undefined || tail.tail === undefined) return
    if (spokeRef.current) return
    const { turn, time, text } = tail.tail
    if (text.trim() === '') return
    const known = knownTurns.get(sessionId)
    if (known === undefined) {
      // First time this session is seen in this page lifetime: adopt the
      // current newest turn as the baseline. History only speaks when it is a
      // brand-new conversation's first reply that completed moments ago; a
      // reply we watched stream in is new by definition.
      knownTurns.set(sessionId, tail.latest)
      if (!mountedWhileStreaming.current) {
        const fresh = tail.count === 1 && Date.now() - time < FRESH_REPLY_MS
        if (!fresh) return
      }
    } else if (turn <= known) {
      return
    } else {
      knownTurns.set(sessionId, turn)
    }
    spokeRef.current = true
    setPlaying(true)
    void speak(text).then(() => {
      if (!alive.current) return
      setPlaying(false)
    })
  }, [enabled, autoSpeak, tail, sessionId, speak])

  if (!enabled || tail === undefined || tail.tail === undefined) return null
  const text = tail.tail.text
  if (text.trim() === '') return null

  const onToggle = (): void => {
    if (playing) {
      stop()
      setPlaying(false)
      return
    }
    setPlaying(true)
    void speak(text).then(() => {
      if (!alive.current) return
      setPlaying(false)
    })
  }

  return (
    <Tooltip label={playing ? t('voiceStop') : t('voicePlay')} side="bottom">
      <button
        type="button"
        className={css.action}
        data-playing={playing || undefined}
        aria-label={playing ? t('voiceStop') : t('voicePlay')}
        onClick={onToggle}
      >
        {playing ? <IconStopFill16 /> : <IconPlayOutline16 />}
      </button>
    </Tooltip>
  )
}
