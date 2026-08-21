/**
 * Camera chat dock (摄像头对话): a slim toggle row above the composer plus,
 * once active, a live preview with rolling real-time captions from the local
 * vision model. When the 视觉 settings enable it:
 *  - 持续语音对话 (voiceChat): the AI keeps watching and listening. Speech is
 *    detected with a live RMS gate, each spoken sentence is transcribed,
 *    combined with the live frame, answered by the local vision model and
 *    spoken aloud — a WeChat-video-call-like loop that never waits for the
 *    main model. Captions are also voiced on their cadence.
 *  - 按住说话 (voiceChat off): a hold-to-talk mic appears instead.
 *  - 自动对话 (chatIntervalSec > 0): the latest caption is sent into the main
 *    conversation automatically on that cadence.
 * User speech is always prefixed with 「【用户语音】」 so the model knows it is
 * voice input, distinct from the frame caption.
 */
import { useEffect, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { VisionState } from './VisionSection.tsx'
import css from './CameraChatDock.module.css'

/** One rolling caption-exchange for conversational continuity. */
export interface CameraChatTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** Registration-side business face for the camera chat dock. */
export interface CameraChatDockInjected {
  hooks: {
    /** Vision configuration snapshot bound as useVision. */
    vision: HostObservable<VisionState>
  }
  /** Describe one frame conversationally; returns a short caption. */
  runLiveChatFrame(frame: string, history: readonly CameraChatTurn[]): Promise<string | undefined>
  /** Describe one live frame through a streaming server session. */
  runLiveChatFrameStream(frame: string, text: string, onDelta: (delta: string) => void): Promise<string>
  /** Cancel the in-flight vision turn (and the TTS voice line). */
  interruptVisionChat(): Promise<void>
  /** Close the server-side camera chat session. */
  resetVisionSession(): Promise<void>
  /** Publish one frame description as the host-side vision perception. */
  publishPerception(text: string): Promise<void>
  /** Send a light cue into the current conversation to trigger a model turn. */
  sendCameraObservation(context: string): Promise<boolean>
  /** Transcribe one recorded speech blob through the configured ASR service. */
  transcribeAudio(blob: Blob): Promise<string | undefined>
  /** Stop the currently playing voice line. */
  stopSpeaking(): void
}

/** Props the renderer binds for the dock entry. */
export type CameraChatDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'skill-store'>
  & InjectFace<CameraChatDockInjected>

/** Default frame capture cadence (seconds) while the camera is live. */
const DEFAULT_INTERVAL_SEC = 5
/** Keep at most this many history turns in the vision context. */
const MAX_HISTORY = 6
/** Discard recordings shorter than this (a tap, not speech). */
const MIN_RECORD_MS = 300
/** RMS threshold that counts as speech (0..1). */
const SPEECH_RMS = 0.06
/** Consecutive loud frames before a segment starts (200ms debounce). */
const SPEECH_DEBOUNCE_FRAMES = 2
/** Force-finish a spoken segment after this long even if never silent. */
const MAX_SEGMENT_MS = 15_000
/** Silence (ms) that ends one spoken sentence. */
const SILENCE_MS = 900
/** 感知发布的最小间隔：周期性画面描述限流写入，避免频繁刷设置。 */
const PERCEPTION_PUBLISH_MIN_MS = 30_000
/** Render the camera chat toggle row, then the live preview + caption panel. */
export function CameraChatDock({
  t, useVision, runLiveChatFrameStream, interruptVisionChat, resetVisionSession,
  publishPerception, sendCameraObservation, transcribeAudio, stopSpeaking, useInput, inputActions,
}: CameraChatDockProps) {
  const vision = useVision(value => value)
  const draft = useInput(state => state.draft)
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [sending, setSending] = useState(false)
  const [caption, setCaption] = useState('')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream>()
  const historyRef = useRef<CameraChatTurn[]>([])
  const lastPerceptionPublishRef = useRef(0)
  const captionRef = useRef('')
  const timerRef = useRef<number | undefined>(undefined)
  const autoTimerRef = useRef<number | undefined>(undefined)
  const aliveRef = useRef(false)
  const sendingRef = useRef(false)
  const micStreamRef = useRef<MediaStream>()
  const recorderRef = useRef<MediaRecorder>()
  const chunksRef = useRef<BlobPart[]>([])
  const micStartedAtRef = useRef(0)
  // continuous-listen (VAD) state
  const vadStreamRef = useRef<MediaStream>()
  const vadCtxRef = useRef<AudioContext>()
  const vadAnalyserRef = useRef<AnalyserNode>()
  const vadTimerRef = useRef<number | undefined>(undefined)
  const vadTalkingRef = useRef(false)
  const vadSilentRef = useRef(0)
  const vadLoudStreakRef = useRef(0)
  const vadBusyRef = useRef(false)
  const segmentRecorderRef = useRef<MediaRecorder>()
  const segmentChunksRef = useRef<BlobPart[]>([])
  const segmentMimeRef = useRef('audio/webm')
  const segmentStartedAtRef = useRef(0)
  const lastSpeakAtRef = useRef(0)
  /** Segment waiting while the previous one is still busy. */
  const pendingSegmentRef = useRef<{ chunks: BlobPart[]; mime: string } | undefined>(undefined)
  /** True while the TTS reply is speaking (suppresses VAD echo). */
  const speakingRef = useRef(false)
  /** True while a streaming vision turn is in flight (serializes turns). */
  const streamBusyRef = useRef(false)
  /** Accumulated caption for the in-flight streaming turn. */
  const captionAccumRef = useRef('')
  /** Set when the user barge-in cancelled the current turn (drop the half reply). */
  const turnCanceledRef = useRef(false)
  const draftRef = useRef(draft)

  useEffect(() => () => { stopCamera() }, [])
  useEffect(() => { draftRef.current = draft }, [draft])

  const appendTranscript = (text: string): void => {
    const current = draftRef.current
    const separator = current === '' || /\s$/.test(current) ? '' : ' '
    const next = current + separator + text.trim()
    draftRef.current = next
    inputActions.setDraft(next)
  }

  const stopCamera = (): void => {
    aliveRef.current = false
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current)
      timerRef.current = undefined
    }
    if (autoTimerRef.current !== undefined) {
      window.clearInterval(autoTimerRef.current)
      autoTimerRef.current = undefined
    }
    stopSpeaking()
    void resetVisionSession()
    stopListening()
    streamRef.current?.getTracks().forEach(track => { track.stop() })
    streamRef.current = undefined
    micStreamRef.current?.getTracks().forEach(track => { track.stop() })
    micStreamRef.current = undefined
    setActive(false)
    setCaption('')
    setError('')
  }

  const captureFrame = (): string | undefined => {
    const video = videoRef.current
    if (video === null || video.videoWidth === 0) return undefined
    const width = Math.min(video.videoWidth, 640)
    const height = Math.round(video.videoHeight * width / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return undefined
    ctx.drawImage(video, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.7)
  }

  /** Run one streaming vision turn against the server session. */
  const streamTurn = async (frame: string | undefined, text: string): Promise<string> => {
    if (frame === undefined || streamBusyRef.current) return ''
    streamBusyRef.current = true
    turnCanceledRef.current = false
    captionAccumRef.current = ''
    setCaption(text.trim() !== '' ? t('voiceChatThinking').replace('{text}', text.trim()) : t('cameraChatWaiting'))
    try {
      const full = await runLiveChatFrameStream(frame, text, (delta) => {
        captionAccumRef.current += delta
        setCaption(captionAccumRef.current)
      })
      // A barge-in cancelled this turn mid-generation: drop the half reply.
      return turnCanceledRef.current ? '' : full
    } finally {
      streamBusyRef.current = false
    }
  }

  const tick = async (): Promise<void> => {
    if (!aliveRef.current) return
    const frame = captureFrame()
    if (frame === undefined) return
    const reply = await streamTurn(frame, '')
    if (!aliveRef.current) return
    if (reply !== undefined && reply.trim() !== '') {
      historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 2)), { role: 'assistant', content: reply }]
      captionRef.current = reply.trim()
      setCaption(reply.trim())
      // 周期画面描述也发布为视觉感知（限流），让主 LLM 保持「看着画面」。
      const now = Date.now()
      if (now - lastPerceptionPublishRef.current >= PERCEPTION_PUBLISH_MIN_MS) {
        lastPerceptionPublishRef.current = now
        void publishPerception(reply.trim()).catch(() => {})
      }
    }
  }

  const sendToAssistant = async (): Promise<void> => {
    if (sendingRef.current) return
    let text = captionRef.current
    if (text === '' || text === t('cameraChatWaiting')) {
      // Frame understanding is off or has not run yet: look once right now.
      const frame = captureFrame()
      if (frame === undefined || !aliveRef.current) return
      setCaption(t('cameraChatWaiting'))
      const reply = await streamTurn(frame, '')
      if (!aliveRef.current || reply === undefined || reply.trim() === '') return
      historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 2)), { role: 'assistant', content: reply }]
      captionRef.current = reply.trim()
      setCaption(reply.trim())
      text = reply.trim()
    }
    sendingRef.current = true
    setSending(true)
    try {
      // 描述走「视觉感知」通道（宿主 <perception> 区块 + see()），对话里
      // 只发一条轻量提示触发模型回合——模型基于自己「看到」的画面回答。
      lastPerceptionPublishRef.current = Date.now()
      await publishPerception(text)
      const ok = await sendCameraObservation(t('cameraChatContext'))
      if (!ok) setError(t('cameraChatSendFailed'))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  /**
   * Create the VAD AudioContext inside a user gesture. A fresh AudioContext
   * starts suspended under the autoplay policy, and resume() only succeeds
   * while a user activation is active — an async resume after getUserMedia
   * gets rejected and the analyser stays frozen at silence.
   */
  const ensureAudioContext = (): void => {
    if (vadCtxRef.current !== undefined) return
    const AudioCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioCtor === undefined) return
    try {
      const ctx = new AudioCtor()
      if (ctx.state === 'suspended') {
        // Synchronous call within the click gesture → allowed immediately.
        void ctx.resume().catch(() => {})
      }
      vadCtxRef.current = ctx
    } catch {
      vadCtxRef.current = undefined
    }
  }

  const startCamera = async (): Promise<void> => {
    if (starting || active) return
    ensureAudioContext()
    setStarting(true)
    setError('')
    try {
      if (navigator.mediaDevices === undefined || !navigator.mediaDevices.getUserMedia) {
        setError(t('cameraChatUnsupported'))
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      await resetVisionSession()
      aliveRef.current = true
      historyRef.current = []
      captionRef.current = ''
      setActive(true)
      setCaption(t('cameraChatWaiting'))
    } catch {
      setError(t('cameraChatDenied'))
    } finally {
      setStarting(false)
    }
  }

  // Attach the camera stream once the preview element mounts, then start the
  // caption loop plus the auto-send cadence. (setActive(true) schedules a
  // re-render; the video ref is still null until then, so the stream must be
  // bound in an effect.)
  useEffect(() => {
    if (!active) return
    const video = videoRef.current
    const stream = streamRef.current
    if (video === null || stream === undefined) return
    if (video.srcObject === null) {
      video.srcObject = stream
      void video.play().catch(() => {})
    }
    if ((vision.intervalSec ?? DEFAULT_INTERVAL_SEC) > 0) {
      void tick()
      const intervalMs = (vision.intervalSec ?? DEFAULT_INTERVAL_SEC) * 1000
      timerRef.current = window.setInterval(() => { void tick() }, intervalMs)
    }
    const autoSec = vision.chatIntervalSec ?? 0
    if (autoSec > 0) {
      autoTimerRef.current = window.setInterval(() => { void sendToAssistant() }, autoSec * 1000)
    }
    return () => {
      if (timerRef.current !== undefined) {
        window.clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      if (autoTimerRef.current !== undefined) {
        window.clearInterval(autoTimerRef.current)
        autoTimerRef.current = undefined
      }
    }
  }, [active, vision.intervalSec, vision.chatIntervalSec])

  // Continuous listen mode: whenever the camera is active and voice chat is
  // on, keep the microphone open and detect speech with an RMS gate.
  useEffect(() => {
    if (!active || vision.voiceChat !== true) return
    void startListening()
    return () => { stopListening() }
  }, [active, vision.voiceChat])

  // ---- continuous listen (VAD) ----
  const startListening = async (): Promise<void> => {
    if (vadStreamRef.current !== undefined) return
    try {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setError(t('voiceChatUnsupported'))
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      if (!aliveRef.current) {
        stream.getTracks().forEach(track => { track.stop() })
        return
      }
      ensureAudioContext()
      const ctx = vadCtxRef.current
      if (ctx === undefined) {
        stream.getTracks().forEach(track => { track.stop() })
        setError(t('voiceChatUnsupported'))
        return
      }
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {})
      }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)
      vadStreamRef.current = stream
      vadAnalyserRef.current = analyser
      vadTalkingRef.current = false
      vadSilentRef.current = 0
      vadLoudStreakRef.current = 0
      vadBusyRef.current = false
      setListening(true)
      vadTimerRef.current = window.setInterval(() => { void vadFrame() }, 100)
    } catch {
      setError(t('voiceChatDenied'))
    }
  }

  const stopListening = (): void => {
    setListening(false)
    if (vadTimerRef.current !== undefined) {
      window.clearInterval(vadTimerRef.current)
      vadTimerRef.current = undefined
    }
    stopSegmentRecorder()
    segmentChunksRef.current = []
    pendingSegmentRef.current = undefined
    vadStreamRef.current?.getTracks().forEach(track => { track.stop() })
    vadStreamRef.current = undefined
    if (vadCtxRef.current !== undefined) {
      void vadCtxRef.current.close().catch(() => {})
      vadCtxRef.current = undefined
    }
    vadAnalyserRef.current = undefined
    vadTalkingRef.current = false
  }

  const vadFrame = (): void => {
    const analyser = vadAnalyserRef.current
    if (analyser === undefined) return
    const ctx = vadCtxRef.current
    if (ctx !== undefined && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    const samples = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(samples)
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const v = (samples[i]! - 128) / 128
      sum += v * v
    }
    const loud = Math.sqrt(sum / samples.length) > SPEECH_RMS
    if (loud) {
      vadSilentRef.current = 0
      vadLoudStreakRef.current += 1
      const echoGuard = speakingRef.current || Date.now() - lastSpeakAtRef.current < 400
      if (!vadTalkingRef.current && vadLoudStreakRef.current >= SPEECH_DEBOUNCE_FRAMES && !echoGuard) {
        vadTalkingRef.current = true
        vadLoudStreakRef.current = 0
        stopSpeaking()
        turnCanceledRef.current = true
        void interruptVisionChat()
        setCaption(t('voiceChatHeard'))
        startSegmentRecorder()
      }
    } else {
      vadLoudStreakRef.current = 0
      if (vadTalkingRef.current) {
        vadSilentRef.current += 100
        if (vadSilentRef.current >= SILENCE_MS) {
          vadTalkingRef.current = false
          stopSegmentRecorder()
        }
      }
    }
    if (vadTalkingRef.current && Date.now() - segmentStartedAtRef.current >= MAX_SEGMENT_MS) {
      vadTalkingRef.current = false
      stopSegmentRecorder()
    }
  }

  const startSegmentRecorder = (): void => {
    const stream = vadStreamRef.current
    if (stream === undefined) return
    try {
      segmentChunksRef.current = []
      segmentStartedAtRef.current = Date.now()
      const recorder = new MediaRecorder(stream)
      segmentRecorderRef.current = recorder
      segmentMimeRef.current = recorder.mimeType?.includes('mp4') ? 'audio/mp4' : 'audio/webm'
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) segmentChunksRef.current.push(event.data)
      }
      recorder.onstop = () => { void processSegment() }
      recorder.start()
    } catch {
      segmentRecorderRef.current = undefined
    }
  }

  const stopSegmentRecorder = (): void => {
    const recorder = segmentRecorderRef.current
    segmentRecorderRef.current = undefined
    if (recorder !== undefined && recorder.state !== 'inactive') {
      try {
        recorder.requestData()
        recorder.stop()
      } catch { /* already stopped */ }
    }
  }

  const processSegment = async (): Promise<void> => {
    const chunks = segmentChunksRef.current
    segmentChunksRef.current = []
    if (chunks.length === 0) return
    if (vadBusyRef.current) {
      // Keep the newest segment queued; it runs as soon as the busy one finishes.
      pendingSegmentRef.current = { chunks, mime: segmentMimeRef.current }
      return
    }
    vadBusyRef.current = true
    setListening(false)
    try {
      const blob = new Blob(chunks, { type: segmentMimeRef.current })
      const text = await transcribeAudio(blob)
      if (text === undefined || text.trim() === '') {
        setError(t('voiceChatEmpty'))
        return
      }
      appendTranscript(text)
      setCaption(t('voiceChatUserPrefix').replace('{text}', text.trim()))
    } finally {
      vadBusyRef.current = false
      const pending = pendingSegmentRef.current
      pendingSegmentRef.current = undefined
      if (aliveRef.current) setListening(true)
      if (pending !== undefined) {
        segmentChunksRef.current = pending.chunks
        segmentMimeRef.current = pending.mime
        void processSegment()
      }
    }
  }

  // ---- hold-to-talk voice input (voice chat off) ----
  const stopMic = (): void => {
    const recorder = recorderRef.current
    if (recorder !== undefined && recorder.state !== 'inactive') {
      try {
        recorder.requestData()
        recorder.stop()
      } catch { /* already stopped */ }
    }
  }

  const startMic = async (): Promise<void> => {
    if (micBusy || recording) return
    setError('')
    try {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setError(t('voiceChatUnsupported'))
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      micStreamRef.current = stream
      chunksRef.current = []
      micStartedAtRef.current = Date.now()
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => { void finishMic() }
      recorder.start()
      stopSpeaking()
      setRecording(true)
    } catch {
      setError(t('voiceChatDenied'))
    }
  }

  const finishMic = async (): Promise<void> => {
    setRecording(false)
    const stream = micStreamRef.current
    micStreamRef.current = undefined
    const recorder = recorderRef.current
    recorderRef.current = undefined
    stream?.getTracks().forEach(track => { track.stop() })
    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0 || Date.now() - micStartedAtRef.current < MIN_RECORD_MS) return
    const type = recorder?.mimeType?.includes('mp4') ? 'audio/mp4' : 'audio/webm'
    const blob = new Blob(chunks, { type })
    setMicBusy(true)
    try {
      const text = await transcribeAudio(blob)
      if (text === undefined || text.trim() === '') {
        setError(t('voiceChatEmpty'))
        return
      }
      appendTranscript(text)
      setCaption(t('voiceChatUserPrefix').replace('{text}', text.trim()))
    } finally {
      setMicBusy(false)
    }
  }

  if (vision.enabled !== true) return null

  if (!active) {
    return (
      <div className={css.row}>
        <button type="button" className={css.start} disabled={starting} onClick={() => { void startCamera() }}>
          {starting ? t('pending') : t('cameraChatStart')}
        </button>
        <span className={css.hint}>{t('cameraChatHint')}</span>
      </div>
    )
  }

  return (
    <div className={css.dock} role="status">
      <video ref={videoRef} className={css.preview} muted autoPlay playsInline />
      <div className={css.body}>
        <div className={css.title}>
          {t('cameraChatTitle')}
          {(vision.chatIntervalSec ?? 0) > 0 && <span className={css.badge}>{t('chatAutoBadge')}</span>}
          {vision.voiceChat === true && (
            <span className={listening ? css.listening : css.badge}>
              {listening ? t('voiceChatListening') : t('voiceChatBusy')}
            </span>
          )}
        </div>
        <div className={css.caption}>{caption}</div>
        {error !== '' && <div className={css.error}>{error}</div>}
      </div>
      {vision.voiceChat !== true && (
        <button
          type="button"
          className={recording ? css.micActive : css.mic}
          disabled={micBusy}
          title={micBusy ? t('voiceChatBusy') : t('voiceChatMicLabel')}
          aria-label={t('voiceChatMicLabel')}
          onPointerDown={(event) => {
            event.preventDefault()
            void startMic()
          }}
          onPointerUp={() => { stopMic() }}
          onPointerLeave={() => { stopMic() }}
          onPointerCancel={() => { stopMic() }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M8 10a2 2 0 0 0 2-2V4a2 2 0 1 0-4 0v4a2 2 0 0 0 2 2Zm3-2a3 3 0 1 1-6 0H4a4 4 0 0 0 3 3.87V14H5.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1H9v-2.13A4 4 0 0 0 12 8h-1Z"
            />
          </svg>
        </button>
      )}
      <button
        type="button"
        className={css.send}
        disabled={sending || micBusy}
        onClick={() => { void sendToAssistant() }}
      >
        {sending ? t('pending') : t('cameraChatSend')}
      </button>
      <button type="button" className={css.stop} onClick={stopCamera}>
        {t('cameraChatStop')}
      </button>
    </div>
  )
}



