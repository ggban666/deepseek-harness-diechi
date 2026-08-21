/**
 * Composer mic button (按住说话): a press-and-hold speech-to-text control
 * next to the send button. Speech is recorded with the browser MediaRecorder
 * and transcribed by the local diechi 8080 ASR endpoint; the transcript is
 * appended to the composer draft. Shown only when the 语音 settings enable
 * speech input (voice.enabled && voice.asrEnabled). Works in mobile browsers
 * (standard getUserMedia + MediaRecorder APIs).
 */
import { useEffect, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceState } from './voice.ts'
import css from './MicButton.module.css'

/** Registration-side business face for the mic button. */
export interface MicButtonInjected {
  hooks: {
    /** Voice configuration snapshot bound as useVoice. */
    voice: HostObservable<VoiceState>
  }
  /** Transcribe one recorded speech blob through the configured ASR service. */
  transcribeAudio(blob: Blob): Promise<string | undefined>
}

/** Props the renderer binds for the entry. */
export type MicButtonProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'skill-store'>
  & InjectFace<MicButtonInjected>

/** Discard recordings shorter than this (a tap, not speech). */
const MIN_RECORD_MS = 300

/** Render the press-and-hold mic button for the composer tool row. */
export function MicButton({ t, useVoice, useInput, inputActions, transcribeAudio: transcribe }: MicButtonProps) {
  const voice = useVoice(value => value)
  const draft = useInput(state => state.draft)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream>()
  const recorderRef = useRef<MediaRecorder>()
  const chunksRef = useRef<BlobPart[]>([])
  const startedAtRef = useRef(0)
  const draftRef = useRef(draft)

  useEffect(() => { draftRef.current = draft }, [draft])

  // Release the microphone when the composer unmounts.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => { track.stop() })
    streamRef.current = undefined
  }, [])

  const stopRecording = (): void => {
    const recorder = recorderRef.current
    if (recorder !== undefined && recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* already stopped */ }
    }
  }

  const start = async (): Promise<void> => {
    if (busy || recording) return
    setError('')
    try {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setError(t('voiceInputUnsupported'))
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      chunksRef.current = []
      startedAtRef.current = Date.now()
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => { void finish() }
      recorder.start()
      setRecording(true)
    } catch {
      setError(t('voiceInputDenied'))
    }
  }

  const finish = async (): Promise<void> => {
    setRecording(false)
    const stream = streamRef.current
    streamRef.current = undefined
    const recorder = recorderRef.current
    recorderRef.current = undefined
    stream?.getTracks().forEach(track => { track.stop() })
    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0 || Date.now() - startedAtRef.current < MIN_RECORD_MS) return
    const type = recorder?.mimeType?.includes('mp4') ? 'audio/mp4' : 'audio/webm'
    const blob = new Blob(chunks, { type })
    setBusy(true)
    try {
      const text = await transcribe(blob)
      if (text === undefined || text === '') {
        setError(t('voiceInputEmpty'))
        return
      }
      const current = draftRef.current
      const separator = current === '' || /\s$/.test(current) ? '' : ' '
      inputActions.setDraft(current + separator + text)
    } finally {
      setBusy(false)
    }
  }

  if (voice.enabled !== true || voice.asrEnabled !== true) return null

  return (
    <button
      type="button"
      className={recording ? css.micActive : css.mic}
      disabled={busy}
      title={busy ? t('voiceInputBusy') : t('voiceInputTitle')}
      aria-label={t('voiceInputTitle')}
      onPointerDown={(event) => {
        event.preventDefault()
        void start()
      }}
      onPointerUp={() => { stopRecording() }}
      onPointerLeave={() => { stopRecording() }}
      onPointerCancel={() => { stopRecording() }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M8 10a2 2 0 0 0 2-2V4a2 2 0 1 0-4 0v4a2 2 0 0 0 2 2Zm3-2a3 3 0 1 1-6 0H4a4 4 0 0 0 3 3.87V14H5.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1H9v-2.13A4 4 0 0 0 12 8h-1Z"
        />
      </svg>
      {error !== '' && <span className={css.error}>{error}</span>}
    </button>
  )
}
