/**
 * Reply-to-speech (voice) shared types and helpers: the config shape the
 * 语音 settings page edits, the TTS client used by the controller, and the
 * tiny assistant-text extractor the chat play button needs. Both surfaces
 * (settings section + assistant-actions entry) read one `skill-voice`
 * namespace through the same controller.
 */
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'

/** Live reply-to-speech configuration shared by the settings section and the chat play button. */
export interface VoiceState {
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

/** Default local voice endpoint: the diechi vision+tts service. */
export const VOICE_DEFAULT_ENDPOINT = 'http://127.0.0.1:8080'
/** Default Kokoro voice id. */
export const VOICE_DEFAULT_VOICE = 'zf_001'
/** Default speaking-rate multiplier. */
export const VOICE_DEFAULT_SPEED = 1

/** The four bundled Kokoro zh voices, in select order. */
export const VOICE_LOCAL_VOICES = [
  { id: 'zf_001', label: 'voiceVoice1' },
  { id: 'zf_018', label: 'voiceVoice2' },
  { id: 'zm_010', label: 'voiceVoice3' },
  { id: 'zm_016', label: 'voiceVoice4' },
] as const

/** Sample sentence used by the 试听 (preview) button. */
export const VOICE_SAMPLE_TEXT = '蝴蝶振翅，一念换天。你好，我是蝶翅。'

/** Collect visible prose from one Assistant lifecycle (mirror of the conversation helper). */
export function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
}

/**
 * Synthesize one line of speech through the configured provider.
 * @param config - effective voice configuration (saved or draft).
 * @param text - the text to speak.
 * @returns the audio blob; throws when the provider fails.
 */
export async function synthesizeVoice(config: VoiceState, text: string): Promise<Blob> {
  const endpoint = (config.endpoint || VOICE_DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const speed = config.speed > 0 ? config.speed : VOICE_DEFAULT_SPEED
  if (config.provider === 'openai') {
    const response = await fetch(`${endpoint}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey.trim() !== '' ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: config.model || 'tts-1',
        voice: config.voice || 'alloy',
        input: text,
        speed,
      }),
    })
    if (!response.ok) throw new Error(`speech http ${response.status}`)
    return await response.blob()
  }
  const response = await fetch(`${endpoint}/api/v1/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: config.voice || VOICE_DEFAULT_VOICE,
      speed,
    }),
  })
  if (!response.ok) throw new Error(`tts http ${response.status}`)
  return await response.blob()
}

/**
 * Speech-to-text: POST one audio blob to the configured local ASR service
 * (the diechi 8080 server: ffmpeg decode -> faster-whisper subprocess).
 * @param endpoint - service base URL (defaults to the local 8080).
 * @param blob - recorded speech (webm/ogg/mp4, any ffmpeg-decodable format).
 * @returns the transcript, or undefined when the service failed.
 */
export async function transcribeAudio(endpoint: string, blob: Blob): Promise<string | undefined> {
  const base = (endpoint || VOICE_DEFAULT_ENDPOINT).replace(/\/+$/, '')
  try {
    const form = new FormData()
    form.append('file', blob, 'speech.webm')
    const response = await fetch(base + '/api/v1/asr', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return undefined
    const payload = await response.json() as { text?: string }
    const text = (payload.text ?? '').trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

/** Shared, gesture-warmed AudioContext so the autoplay policy cannot stall speech. */
let sharedVoiceCtx: AudioContext | undefined

/** Create or revive the shared audio context. Call it inside a user gesture when possible. */
export function warmVoiceAudio(): void {
  try {
    if (sharedVoiceCtx === undefined || sharedVoiceCtx.state === 'closed') {
      sharedVoiceCtx = new AudioContext()
    }
    if (sharedVoiceCtx.state === 'suspended') {
      void sharedVoiceCtx.resume().catch(() => {})
    }
  } catch {
    sharedVoiceCtx = undefined
  }
}

/** Warm the shared context on the page first interaction so auto-read works later. */
export function armVoiceAudioWarmup(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('pointerdown', () => warmVoiceAudio(), { once: true })
  window.addEventListener('keydown', () => warmVoiceAudio(), { once: true })
}

/** How long the player keeps trying to revive a blocked AudioContext before giving up. */
const CONTEXT_RESUME_TIMEOUT_MS = 8000

/**
 * Web Audio sequential player for streamed TTS chunks.
 *
 * Playback runs strictly in chunk order. `finished()` resolves once every
 * pushed chunk has been decoded and played (or the player was stopped), so
 * callers can keep the UI in the "playing" state for the whole line.
 */
export class StreamingVoicePlayer {
  private pending = new Map<number, Promise<AudioBuffer | undefined>>()
  private playSeq = 0
  private pushSeq = 0
  private draining = false
  private stopped = false
  private currentSource: { stop(): void } | undefined = undefined
  private doneResolvers: Array<() => void> = []
  private finishedInternal = false

  /** Kick off async decode; playback runs strictly in chunk order. */
  pushBlob(blob: Blob): void {
    if (this.stopped) return
    const seq = this.pushSeq++
    const context = this.ensureContext()
    if (context === undefined) return
    const decoded = blob.arrayBuffer()
      .then((buf) => context.decodeAudioData(buf))
      .catch((error) => {
        console.warn('[voice] chunk decode failed:', error)
        return undefined
      })
    this.pending.set(seq, decoded)
    void decoded.then(() => { void this.drain(context) })
    void this.drain(context)
  }

  /** Resolve when every pushed chunk has finished playing (or playback was stopped). */
  finished(): Promise<void> {
    if (this.finishedInternal) return Promise.resolve()
    return new Promise<void>((resolve) => { this.doneResolvers.push(resolve) })
  }

  /** Stop playback immediately and drop any pending chunks. */
  stop(): void {
    this.stopped = true
    this.pending.clear()
    if (this.currentSource !== undefined) {
      try { this.currentSource.stop() } catch { }
      this.currentSource = undefined
    }
    this.resolveFinished()
  }

  private ensureContext(): AudioContext | undefined {
    warmVoiceAudio()
    return sharedVoiceCtx
  }

  private resolveFinished(): void {
    if (this.finishedInternal) return
    this.finishedInternal = true
    for (const resolve of this.doneResolvers) resolve()
    this.doneResolvers = []
  }

  private maybeFinish(): void {
    if (this.finishedInternal) return
    if (this.pending.size !== 0 || this.draining || this.playSeq < this.pushSeq) return
    this.resolveFinished()
  }

  private async drain(context: AudioContext): Promise<void> {
    if (this.draining) return
    this.draining = true
    let resumeSince: number | undefined
    try {
      while (!this.stopped) {
        const next = this.pending.get(this.playSeq)
        if (next === undefined) break
        let state = context.state
        if (state !== 'running') {
          try { await context.resume() } catch { }
          state = context.state
          if (state !== 'running') {
            if (resumeSince === undefined) resumeSince = Date.now()
            if (Date.now() - resumeSince > CONTEXT_RESUME_TIMEOUT_MS) {
              console.error(
                '[voice] AudioContext could not start (autoplay blocked?). state=' + state,
              )
              this.stopped = true
              break
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 250))
            continue
          }
          resumeSince = undefined
        }
        const buffer = await next
        this.pending.delete(this.playSeq)
        this.playSeq += 1
        if (buffer === undefined || this.stopped) continue
        await new Promise<void>((resolve) => {
          const source = context.createBufferSource()
          this.currentSource = source
          source.buffer = buffer
          source.connect(context.destination)
          source.onended = (): void => {
            if (this.currentSource === source) this.currentSource = undefined
            source.disconnect()
            resolve()
          }
          source.start()
        })
      }
    } finally {
      this.draining = false
      this.maybeFinish()
    }
  }
}

export async function streamVoice(
  config: VoiceState,
  text: string,
  onChunk: (blob: Blob) => void,
): Promise<void> {
  if (config.provider === "openai") {
    onChunk(await synthesizeVoice(config, text))
    return
  }
  const endpoint = (config.endpoint || VOICE_DEFAULT_ENDPOINT).replace(/\/+$/, "")
  const speed = config.speed > 0 ? config.speed : VOICE_DEFAULT_SPEED
  let response: Response
  try {
    response = await fetch(`${endpoint}/api/v1/tts/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: config.voice || VOICE_DEFAULT_VOICE,
        speed,
      }),
    })
  } catch {
    onChunk(await synthesizeVoice(config, text))
    return
  }
  if (!response.ok || response.body === null) {
    onChunk(await synthesizeVoice(config, text))
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    let nl = pending.indexOf("\n")
    while (nl !== -1) {
      const line = pending.slice(0, nl).trim()
      pending = pending.slice(nl + 1)
      if (line !== "") {
        try {
          const item = JSON.parse(line) as { audio?: string; error?: string }
          if (item.error !== undefined) throw new Error(item.error)
          if (item.audio !== undefined) {
            const bytes = Uint8Array.from(atob(item.audio), (c) => c.charCodeAt(0))
            onChunk(new Blob([bytes], { type: "audio/wav" }))
          }
        } catch (error) {
          throw error instanceof Error ? error : new Error("tts stream decode failure")
        }
      }
      nl = pending.indexOf("\n")
    }
  }
}
