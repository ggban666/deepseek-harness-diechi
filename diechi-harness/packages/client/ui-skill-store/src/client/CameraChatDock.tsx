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
  runLiveChatFrameStream(frame: string, text: string, onDelta: (delta: string) => void, reason?: string): Promise<string>
  /** Cancel the in-flight vision turn (and the TTS voice line). */
  interruptVisionChat(): Promise<void>
  /** Push one frame into the server session buffer (continuous perception, no inference).
   *  Returns the latest per-frame recognition caption (持续识别字幕).
   *  @param diff - 该帧相对上一帧的画面差异 0..1（供后端统计环境变化次数）。 */
  observeVisionFrame(frame: string, diff?: number): Promise<{ caption?: string }>
  /** Close the server-side camera chat session. */
  resetVisionSession(): Promise<void>
  /** Publish one frame description as the host-side vision perception. */
  publishPerception(text: string): Promise<void>
  /** Send a light cue into the current conversation to trigger a model turn. */
  sendCameraObservation(context: string): Promise<boolean>
  /** Transcribe one recorded speech blob through the configured ASR service. */
  transcribeAudio(blob: Blob): Promise<string | undefined>
  /** Speak one line with the configured TTS (voice-chat reply). */
  speak(text: string): Promise<boolean>
  /** Stop the currently playing voice line. */
  stopSpeaking(): void
}

/** Props the renderer binds for the dock entry. */
export type CameraChatDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'skill-store'>
  & InjectFace<CameraChatDockInjected>

/** Default proactive-narration cadence (seconds); 0 = only reply when the user speaks. */
const DEFAULT_INTERVAL_SEC = 0
/** 连续感知推帧间隔（毫秒）：摄像头开着时 1 秒一帧只入缓冲，不触发推理。 */
const OBSERVE_PUSH_MS = 1000
/** Keep at most this many history turns in the vision context. */
const MAX_HISTORY = 6
/** Discard recordings shorter than this (a tap, not speech). */
const MIN_RECORD_MS = 300
/** RMS threshold that counts as speech (0..1). */
const SPEECH_RMS = 0.06
/** TTS 朗读期间的人声阈值（更高：真实人声可打断朗读，扬声器回声残余不误触）。 */
const SPEAKING_RMS = 0.14
/** Consecutive loud frames before a segment starts (200ms debounce). */
const SPEECH_DEBOUNCE_FRAMES = 2
/** Force-finish a spoken segment after this long even if never silent. */
const MAX_SEGMENT_MS = 15_000
/** Silence (ms) that ends one spoken sentence. */
const SILENCE_MS = 900
/** 场景显著变化阈值：与「上次打包」的画面指纹差异 >= 此值 → 立即打包（不等定时器）。 */
const SCENE_CHANGE_RATIO = 0.18
/** 场景变化触发打包后的冷却时间（毫秒），避免连拍式刷屏。 */
const SCENE_PACKET_COOLDOWN_MS = 6_000
/** 定时打包与上一次打包的最小间隔保护（毫秒）。 */
const TIMER_PACKET_MIN_MS = 4_000
/** 打包指令（内部 prompt，随帧发给模型，不走 i18n）。 */
const SCENE_PACKET_PROMPT = '【环境更新】场景发生了变化，请看看现在的情况并简短说明。'
const TIMER_PACKET_CHANGED = '【环境更新】画面出现了明显变化，请简短说明变化并确认当前环境。'
/** Render the camera chat toggle row, then the live preview + caption panel. */
export function CameraChatDock({
  t, useVision, runLiveChatFrameStream, interruptVisionChat, resetVisionSession, observeVisionFrame,
  publishPerception, sendCameraObservation, transcribeAudio, speak, stopSpeaking, useInput, inputActions,
}: CameraChatDockProps) {
  const vision = useVision(value => value)
  const draft = useInput(state => state.draft)
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [sending, setSending] = useState(false)
  const [caption, setCaption] = useState('')
  /** 持续识别字幕：最近一帧识别出的画面内容（事件流累积的实时显示）。 */
  const [recog, setRecog] = useState('')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream>()
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<CameraChatTurn[]>([])
  const lastFrameFpRef = useRef('')
  /** 上次打包发送时间（毫秒时间戳），用于冷却与定时间隔保护。 */
  const lastPacketAtRef = useRef(0)
  /** 上次打包时的画面指纹：判断「自上次打包以来画面是否显著变化」。 */
  const lastSceneFpRef = useRef('')
  const captionRef = useRef('')
  const timerRef = useRef<number | undefined>(undefined)
  const observeTimerRef = useRef<number | undefined>(undefined)
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
    if (observeTimerRef.current !== undefined) {
      window.clearInterval(observeTimerRef.current)
      observeTimerRef.current = undefined
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
    setRecog('')
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

  /** 轻量感知指纹：8x8 灰度位串，用于动态帧去重（画面没变就不发云端）。 */
  const frameFingerprint = async (frame: string): Promise<string> => {
    try {
      const img = new Image()
      img.src = frame
      // drawImage 之前必须等图片 decode 完成，否则同步绘制拿不到像素。
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 8
      canvas.height = 8
      const ctx = canvas.getContext('2d')
      if (ctx === null) return ''
      ctx.drawImage(img, 0, 0, 8, 8)
      const data = ctx.getImageData(0, 0, 8, 8).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += data[i] ?? 0
      const avg = sum / 64
      let bits = ''
      for (let i = 0; i < data.length; i += 4) bits += (data[i] ?? 0) > avg ? '1' : '0'
      return bits
    } catch {
      return ''
    }
  }

  const frameDiff = (a: string, b: string): number => {
    if (a === '' || b === '' || a.length !== b.length) return 1
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    return diff / a.length
  }

  /** 同步预览容器宽高比，保证叠加框与画面像素对齐（不同摄像头比例不同）。 */
  const syncPreviewAspect = (): void => {
    const video = videoRef.current
    const wrap = previewWrapRef.current
    if (video === null || wrap === null || video.videoWidth === 0) return
    wrap.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`
  }



  /** Run one streaming vision turn against the server session. */
  const streamTurn = async (frame: string | undefined, text: string, reason = 'speech'): Promise<string> => {
    if (frame === undefined) return ''
    // 上一轮 fetch 可能仍在收尾：让出通道。语音回合是用户主动交互，必须送达
    // LLM（等更久 + 超时后强制打断接管）；场景/定时回合等待时间短，错过可跳过。
    const waitMs = reason === 'speech' ? 20_000 : 3_000
    const waitDeadline = Date.now() + waitMs
    while (streamBusyRef.current && Date.now() < waitDeadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 60))
    }
    if (streamBusyRef.current) {
      if (reason !== 'speech') return ''
      // 语音回合优先：强行打断在途回合，接管推理通道。
      await interruptVisionChat()
      streamBusyRef.current = false
    }
    streamBusyRef.current = true
    turnCanceledRef.current = false
    captionAccumRef.current = ''
    setCaption(text.trim() !== '' ? t('voiceChatThinking').replace('{text}', text.trim()) : t('cameraChatWaiting'))
    try {
      const full = await runLiveChatFrameStream(frame, text, (delta) => {
        captionAccumRef.current += delta
        setCaption(captionAccumRef.current)
      }, reason)
      // A barge-in cancelled this turn mid-generation: drop the half reply.
      return turnCanceledRef.current ? '' : full
    } finally {
      streamBusyRef.current = false
    }
  }

  /**
   * 事件驱动打包：三种触发（场景变化 / 用户说话 / 定时确认）统一走这里。
   * 把累积的连续感知（视觉时间线事件流 + 最新帧 + 环境状态）打包发给模型，
   * 完成后同步更新主对话 agent 的视觉感知（让 agent 理解所处环境）。
   * @returns 模型回复（可能为空）。
   */
  const dispatchPacket = async (
    reason: 'scene' | 'speech' | 'timer',
    frame: string | undefined,
    text: string,
  ): Promise<string> => {
    if (frame === undefined) return ''
    const now = Date.now()
    lastPacketAtRef.current = now
    const fp = await frameFingerprint(frame)
    if (fp !== '') lastSceneFpRef.current = fp
    const reply = await streamTurn(frame, text, reason)
    if (!aliveRef.current) return ''
    if (reply === undefined || reply.trim() === '') return ''
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 2)), { role: 'assistant', content: reply.trim() }]
    captionRef.current = reply.trim()
    setCaption(reply.trim())
    // 打包本身已限流（场景冷却/定时周期/语音回合），每次打包都同步环境理解给主对话。
    void publishPerception(reply.trim()).catch(() => {})
    return reply.trim()
  }

  /**
   * 连续感知推帧：高频把画面送进后端会话缓冲（最近 60 帧记忆），
   * 不做推理、不回复——用户说话/提问时模型才依据这段记忆回答。
   */
  const pushFrame = async (): Promise<void> => {
    if (!aliveRef.current) return
    const frame = captureFrame()
    if (frame === undefined) return
    const fp = await frameFingerprint(frame)
    const prevFp = lastFrameFpRef.current
    const diff = prevFp !== '' && fp !== '' ? frameDiff(prevFp, fp) : -1
    if (fp !== '') lastFrameFpRef.current = fp
    try {
      const res = await observeVisionFrame(frame, diff)
      if (res.caption !== undefined && res.caption !== '') setRecog(res.caption)
      // 场景突变即时打包（不等定时器）：与上次打包差异显著、冷却已过、且无语音回合占用。
      const now = Date.now()
      const changed = lastSceneFpRef.current !== '' && fp !== ''
        && frameDiff(lastSceneFpRef.current, fp) >= SCENE_CHANGE_RATIO
      if (changed && now - lastPacketAtRef.current >= SCENE_PACKET_COOLDOWN_MS && !streamBusyRef.current) {
        await dispatchPacket('scene', frame, SCENE_PACKET_PROMPT)
      }
    } catch { /* 视觉服务未就绪时静默，不影响摄像头预览 */ }
  }

  /**
   * 定时打包（intervalSec > 0 时由定时器触发）：到点必定打包发送。
   * 画面自上次打包以来显著变化 → 说变化；基本稳定 → 做环境确认。
   * agent 借此保持对「所处环境」的连续理解，而不是只在提问时才知道画面。
   */
  const tick = async (): Promise<void> => {
    if (!aliveRef.current) return
    // 冷却保护：刚打包过（场景变化/语音回合）就跳过本轮定时，避免连发。
    const now = Date.now()
    if (now - lastPacketAtRef.current < TIMER_PACKET_MIN_MS) return
    const frame = captureFrame()
    if (frame === undefined) return
    const fp = await frameFingerprint(frame)
    const diff = lastSceneFpRef.current !== '' && fp !== '' ? frameDiff(lastSceneFpRef.current, fp) : 0
    // 画面稳定就不打包：数据流只持续累积暂存，只有显著变化/用户说话才发 LLM。
    if (diff < SCENE_CHANGE_RATIO) return
    await dispatchPacket('timer', frame, TIMER_PACKET_CHANGED)
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
      lastFrameFpRef.current = ''
      lastSceneFpRef.current = ''
      lastPacketAtRef.current = 0
      setActive(true)
      setCaption(t('cameraChatWaiting'))
    } catch (error) {
      setError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? t('cameraChatDenied')
        : t('cameraChatFailed'))
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
    // 连续感知：摄像头开着就常驻推帧（1 秒一帧，只入缓冲不推理）。
    observeTimerRef.current = window.setInterval(() => { void pushFrame() }, OBSERVE_PUSH_MS)
    // 主动播报（可选）：intervalSec > 0 时按该频率检查画面变化并说一句。
    if ((vision.intervalSec ?? DEFAULT_INTERVAL_SEC) > 0) {
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
      if (observeTimerRef.current !== undefined) {
        window.clearInterval(observeTimerRef.current)
        observeTimerRef.current = undefined
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
    } catch (error) {
      setError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? t('voiceChatDenied')
        : t('voiceChatFailed'))
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
    // TTS 朗读时用更高阈值：正常说话能打断朗读（stopSpeaking+进入用户回合），
    // 扬声器回声残余（echoCancellation 已消除大部分）不会误触自打断。
    const gate = speakingRef.current ? SPEAKING_RMS : SPEECH_RMS
    const loud = Math.sqrt(sum / samples.length) > gate
    if (loud) {
      vadSilentRef.current = 0
      vadLoudStreakRef.current += 1
      // 仅保留朗读刚结束的 400ms 冷却，防播放收尾回声误触。
      const echoGuard = Date.now() - lastSpeakAtRef.current < 400
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
      // 用户语音回灌视觉会话：结合当前画面让模型回应用户说的话。
      const userSpeech = t('voiceChatUserPrefix').replace('{text}', text.trim())
      setCaption(t('voiceChatThinking').replace('{text}', text.trim()))
      historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 2)), { role: 'user', content: userSpeech }]
      const frame = captureFrame()
      if (frame !== undefined) {
        const fp = await frameFingerprint(frame)
        if (fp !== '') lastFrameFpRef.current = fp
      }
      const reply = frame === undefined ? '' : await streamTurn(frame, userSpeech, 'speech')
      if (!aliveRef.current) return
      if (reply !== undefined && reply.trim() !== '') {
        historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 2)), { role: 'assistant', content: reply.trim() }]
        captionRef.current = reply.trim()
        setCaption(reply.trim())
        // 用户语音回合也同步环境理解给主对话 agent。
        lastPacketAtRef.current = Date.now()
        void publishPerception(reply.trim()).catch(() => {})
        // 朗读回复（speakingRef 抑制 VAD 回声自循环）。
        speakingRef.current = true
        try {
          await speak(reply.trim())
        } finally {
          speakingRef.current = false
          lastSpeakAtRef.current = Date.now()
        }
      }
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
    } catch (error) {
      setError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? t('voiceChatDenied')
        : t('voiceChatFailed'))
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
      <div>
        <div className={css.row}>
          <button type="button" className={css.start} disabled={starting} onClick={() => { void startCamera() }}>
            {starting ? t('pending') : t('cameraChatStart')}
          </button>
          <span className={css.hint}>{t('cameraChatHint')}</span>
        </div>
        {error !== '' && <div className={css.error} role="alert">{error}</div>}
      </div>
    )
  }

  return (
    <div className={css.dock} role="status">
      <div ref={previewWrapRef} className={css.previewWrap}>
        <video
          ref={videoRef}
          className={css.preview}
          muted
          autoPlay
          playsInline
          onLoadedMetadata={() => { syncPreviewAspect() }}
        />
      </div>
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
        {recog !== '' && <div className={css.recog}>{t('cameraRecogLabel')}{recog}</div>}
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



