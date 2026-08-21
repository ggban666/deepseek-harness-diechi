/**
 * 视觉 settings section: the local-vision configuration — enable switch,
 * endpoint, model and the camera caption cadence (画面描述频率) — plus the
 * recognition entry points (image / video upload / live camera) that turn
 * what the model sees into a skill draft. Durable state rides the
 * `skill-vision` namespace; edits draft locally and persist through the
 * explicit 保存视觉配置 button.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  type RecognitionImage, type RecognitionResult, type SkillDraft,
} from './skill-display.ts'
import css from './VisionSection.module.css'

/** The live local-vision configuration the section edits. */
export interface VisionState {
  /** Whether the local-vision recognition pipeline is enabled. */
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

/** Registration-side business face for the section. */
export interface VisionSectionInjected {
  hooks: {
    /** Vision configuration snapshot bound as useVision. */
    vision: HostObservable<VisionState>
  }
  /** Whether the settings namespace accepts writes. */
  writable: boolean
  /** Persist a vision configuration patch. */
  setVision(patch: Partial<VisionState>): Promise<void>
  /** Recognize one image through the configured local vision model. */
  runRecognition(image: RecognitionImage): Promise<RecognitionResult>
  /** Upload a real video for the local vision model to understand directly. */
  runVideoRecognition(file: File): Promise<RecognitionResult>
  /** Live camera narration: one short sentence describing the current frame. */
  runLiveFrame(frame: string): Promise<string | undefined>
  /** Open the workshop with a recognition draft prefilled in the create form. */
  openCreateDraft(draft: SkillDraft): void
}

/** Props the renderer binds for the section. */
export type VisionSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skill-store'>
  & InjectFace<VisionSectionInjected>

type Notice = { readonly kind: 'ok' | 'error' | 'info'; readonly text: string }

/** Read one picked image file into a `data:` URL. */
/** mm:ss label for the camera timer. */
function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function readAsDataUrl(file: File): Promise<string | undefined> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
}

/** Render one 视觉 settings page over the injected vision configuration and actions. */
export function VisionSection({
  t, useVision, writable, setVision, runRecognition, runVideoRecognition, runLiveFrame, openCreateDraft,
}: VisionSectionProps) {
  const vision = useVision(value => value)
  const [notice, setNotice] = useState<Notice>()
  const [visionDraft, setVisionDraft] = useState<VisionState>()
  const [recognizing, setRecognizing] = useState(false)
  const [recognitionDraft, setRecognitionDraft] = useState<SkillDraft>()
  const [transcript, setTranscript] = useState<string>()
  const [videoChooser, setVideoChooser] = useState(false)
  const [camera, setCamera] = useState<{ status: 'idle' | 'live' | 'paused'; seconds: number; mic: boolean }>({ status: 'idle', seconds: 0, mic: true })
  const [liveNotes, setLiveNotes] = useState<readonly { readonly at: string; readonly text: string }[]>([])
  const liveBusyRef = useRef(false)
  const liveTimerRef = useRef<number>()
  const imageFileInput = useRef<HTMLInputElement>(null)
  const videoFileInput = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream>()
  const recorderRef = useRef<MediaRecorder>()
  const chunksRef = useRef<BlobPart[]>([])
  const secondsTimerRef = useRef<number>()
  const startedAtRef = useRef<number>()
  const discardRef = useRef(false)

  const draft = visionDraft ?? vision
  const report = (kind: Notice['kind'], text: string): void => { setNotice({ kind, text }) }

  const applyResult = (result: RecognitionResult): void => {
    if (result.ok) {
      const summary = result.draft === undefined
        ? result.notice
        : `${result.draft.name}（${result.draft.purpose}）`
      report('ok', `${t('recognizeDone')} ${summary}`)
      setTranscript(result.transcript?.trim() || undefined)
      setRecognitionDraft(result.draft)
    } else {
      setRecognitionDraft(undefined)
      setTranscript(undefined)
      report('error', recognizeErrorText(result.error))
    }
  }

  const submitFrames = async (frames: readonly string[], name: string): Promise<void> => {
    if (frames.length === 0) {
      report('error', t('recognitionNotReady'))
      return
    }
    setRecognizing(true)
    try {
      applyResult(await runRecognition({ dataUrls: frames, name, kind: 'image' }))
    } catch {
      report('error', t('recognitionNotReady'))
    } finally {
      setRecognizing(false)
    }
  }

  const submitVideo = async (file: File): Promise<void> => {
    setRecognizing(true)
    try {
      applyResult(await runVideoRecognition(file))
    } catch {
      report('error', t('recognitionNotReady'))
    } finally {
      setRecognizing(false)
    }
  }

  const onPickImage = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    const dataUrl = await readAsDataUrl(file)
    if (dataUrl === undefined) {
      report('error', t('recognitionNotReady'))
      return
    }
    await submitFrames([dataUrl], file.name)
  }

  const onPickVideo = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    setVideoChooser(false)
    await submitVideo(file)
  }

  const captureFrame = (): string | undefined => {
    const video = previewRef.current
    if (video === null || video.readyState < 2 || video.videoWidth === 0) return undefined
    const width = 480
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.max(1, Math.round(video.videoHeight * (width / video.videoWidth)))
    const ctx = canvas.getContext('2d')
    if (ctx === null) return undefined
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.5)
  }

  const runLiveNote = async (): Promise<void> => {
    if (liveBusyRef.current) return
    const frame = captureFrame()
    if (frame === undefined) return
    liveBusyRef.current = true
    try {
      const text = await runLiveFrame(frame)
      if (text !== undefined && text.trim() !== '') {
        const now = new Date()
        const at = [now.getHours(), now.getMinutes(), now.getSeconds()]
          .map((part) => String(part).padStart(2, '0'))
          .join(':')
        setLiveNotes((prev) => [...prev.slice(-7), { at, text: text.trim() }])
      }
    } catch {
      // silent: live narration must never interrupt recording
    } finally {
      liveBusyRef.current = false
    }
  }

  const startLiveNotes = (): void => {
    stopLiveNotes()
    const cadenceMs = (vision.intervalSec ?? 5) * 1000
    if (cadenceMs <= 0) return
    liveTimerRef.current = window.setInterval(() => { void runLiveNote() }, cadenceMs)
    void runLiveNote()
  }

  const stopLiveNotes = (): void => {
    if (liveTimerRef.current !== undefined) {
      window.clearInterval(liveTimerRef.current)
      liveTimerRef.current = undefined
    }
  }

  const stopRecording = (): void => {
    if (secondsTimerRef.current !== undefined) {
      window.clearInterval(secondsTimerRef.current)
      secondsTimerRef.current = undefined
    }
  }

  const openCamera = async (): Promise<void> => {
    setVideoChooser(false)
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      report('error', t('cameraUnsupported'))
      return
    }
    let stream: MediaStream
    let mic = true
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      mic = false
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      } catch {
        report('error', t('cameraDenied'))
        return
      }
    }
    try {
      streamRef.current = stream
      chunksRef.current = []
      discardRef.current = false
      setCamera({ status: 'live', seconds: 0, mic })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => { void completeRecording() }
      startedAtRef.current = Date.now()
      secondsTimerRef.current = window.setInterval(() => {
        const startedAt = startedAtRef.current ?? Date.now()
        setCamera(state => ({ ...state, seconds: Math.floor((Date.now() - startedAt) / 1000) }))
      }, 1000)
      recorder.start()
      setLiveNotes([])
      startLiveNotes()
    } catch {
      report('error', t('cameraDenied'))
    }
  }

  const toggleRecording = (): void => {
    const recorder = recorderRef.current
    if (recorder === undefined) return
    if (recorder.state === 'recording') {
      recorder.pause()
      stopLiveNotes()
      setCamera(state => ({ ...state, status: 'paused' }))
    } else if (recorder.state === 'paused') {
      recorder.resume()
      startLiveNotes()
      setCamera(state => ({ ...state, status: 'live' }))
    }
  }

  const closeCamera = (): void => {
    stopLiveNotes()
    stopRecording()
    const recorder = recorderRef.current
    recorderRef.current = undefined
    if (recorder !== undefined && recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* already stopped */ }
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = undefined
    if (previewRef.current !== null) {
      previewRef.current.srcObject = null
    }
  }

  const completeRecording = async (): Promise<void> => {
    setCamera(state => ({ ...state, status: 'idle', seconds: 0 }))
    if (discardRef.current) {
      discardRef.current = false
      chunksRef.current = []
      return
    }
    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0) {
      report('error', t('recognitionNotReady'))
      return
    }
    const type = recorderRef.current?.mimeType?.includes('mp4') ? 'video/mp4' : 'video/webm'
    const ext = type === 'video/mp4' ? 'mp4' : 'webm'
    const file = new File([new Blob(chunks, { type })], `camera-${Date.now()}.${ext}`, { type })
    await submitVideo(file)
  }

  const completeCamera = (): void => {
    closeCamera()
  }

  const cancelCamera = (): void => {
    discardRef.current = true
    closeCamera()
    setCamera(state => ({ ...state, status: 'idle', seconds: 0 }))
    setLiveNotes([])
  }

  const recognizeErrorText = (error: string): string => {
    switch (error) {
      case 'vision-disabled': return t('visionDisabled')
      case 'vision-endpoint': return t('visionEndpointMissing')
      case 'vision-timeout': return t('visionTimeout')
      case 'vision-empty': return t('visionEmpty')
      default: return t('visionFailed')
    }
  }

  const persistVision = async (): Promise<void> => {
    if (visionDraft === undefined) return
    const next = visionDraft
    setVisionDraft(undefined)
    try {
      await setVision(next)
    } catch {
      report('error', t('saveFailed'))
    }
  }
  // Release the camera when the settings page unmounts.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  // Attach the live stream to the preview once the camera modal mounts.
  useEffect(() => {
    if (camera.status === 'idle') return
    if (previewRef.current === null || streamRef.current === undefined) return
    previewRef.current.srcObject = streamRef.current
    void previewRef.current.play().catch(() => {})
  }, [camera.status])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('visionTitle')}</h2>
      <p className={css.intro}>{t('visionHint')}</p>

      <div className={css.card}>
        <h3 className={css.cardTitle}>{t('visionCardTitle')}</h3>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('visionEnabled')}</span>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={draft.enabled}
            disabled={!writable}
            onChange={(event) => setVisionDraft({ ...draft, enabled: event.target.checked })}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('visionEndpoint')}</span>
          <input
            type="text"
            className={css.input}
            value={draft.endpoint}
            placeholder="http://127.0.0.1:8080"
            disabled={!writable}
            onChange={(event) => setVisionDraft({ ...draft, endpoint: event.target.value })}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('visionModel')}</span>
          <input
            type="text"
            className={css.input}
            value={draft.model}
            placeholder="MiniCPM-V-4.6"
            disabled={!writable}
            onChange={(event) => setVisionDraft({ ...draft, model: event.target.value })}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('visionInterval')}</span>
          <select
            className={css.select}
            value={draft.intervalSec ?? 5}
            disabled={!writable}
            onChange={(event) => setVisionDraft({ ...draft, intervalSec: Number(event.target.value) })}
          >
            <option value={0}>{t('visionIntervalOff')}</option>
            <option value={3}>{t('visionInterval3')}</option>
            <option value={5}>{t('visionInterval5')}</option>
            <option value={10}>{t('visionInterval10')}</option>
            <option value={15}>{t('visionInterval15')}</option>
            <option value={30}>{t('visionInterval30')}</option>
          </select>
        </label>

        <h3 className={css.subTitle}>{t('cameraChatGroup')}</h3>
        <p className={css.hint}>{t('cameraChatGroupHint')}</p>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('voiceChatEnabled')}</span>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={draft.voiceChat}
            disabled={!writable || !draft.enabled}
            onChange={(event) => setVisionDraft({ ...draft, voiceChat: event.target.checked })}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('chatInterval')}</span>
          <select
            className={css.select}
            value={draft.chatIntervalSec ?? 0}
            disabled={!writable || !draft.enabled}
            onChange={(event) => setVisionDraft({ ...draft, chatIntervalSec: Number(event.target.value) })}
          >
            <option value={0}>{t('chatIntervalOff')}</option>
            <option value={10}>{t('chatInterval10')}</option>
            <option value={20}>{t('chatInterval20')}</option>
            <option value={30}>{t('chatInterval30')}</option>
            <option value={60}>{t('chatInterval60')}</option>
          </select>
        </label>
        <div className={css.actions}>
          <input
            ref={imageFileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void onPickImage(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <input
            ref={videoFileInput}
            type="file"
            accept="video/*"
            hidden
            onChange={(event) => {
              void onPickVideo(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className={css.primary}
            disabled={recognizing}
            onClick={() => imageFileInput.current?.click()}
          >
            {t('recognize')}
          </button>
          <button
            type="button"
            className={css.ghost}
            disabled={recognizing}
            onClick={() => setVideoChooser(value => !value)}
          >
            {t('recognizeVideo')}
          </button>
          {videoChooser && (
            <span className={css.inlineChooser}>
              <button
                type="button"
                className={css.secondary}
                onClick={() => videoFileInput.current?.click()}
              >
                {t('videoUpload')}
              </button>
              <button
                type="button"
                className={css.secondary}
                onClick={() => { void openCamera() }}
              >
                {t('videoCamera')}
              </button>
            </span>
          )}
          <span className={css.hint}>{t('recognizeHint')}</span>
          <button
            type="button"
            className={css.ghost}
            disabled={visionDraft === undefined || !writable}
            onClick={() => { void persistVision() }}
          >
            {t('visionSave')}
          </button>
        </div>
                {camera.status !== 'idle' && createPortal(
          <div className={css.cameraBackdrop} role="dialog" aria-modal="true" aria-label={t('cameraTitle')}>
            <div className={css.cameraDialog}>
              <div className={css.cameraHeader}>
                <span className={css.cameraTitle}>{t('cameraTitle')}</span>
                <span className={camera.status === 'live' ? css.recBadge : css.pausedBadge}>
                  {camera.status === 'live' && <span className={css.recDot} aria-hidden="true" />}
                  {camera.status === 'live' ? t('cameraRecording') : t('cameraPaused')} · {formatSeconds(camera.seconds)}
                </span>
              </div>
              <video ref={previewRef} className={css.cameraPreview} muted playsInline autoPlay />
              {liveNotes.length > 0 && (
                <div className={css.liveBox}>
                  <span className={css.liveLabel}>{t('liveDescribe')}</span>
                  <ul className={css.liveList}>
                    {liveNotes.map((note, index) => (
                      <li key={index} className={css.liveItem}>
                        <time className={css.liveAt}>{note.at}</time>
                        <span className={css.liveText}>{note.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className={css.hint}>
                {camera.mic ? t('cameraMicHint') : t('cameraNoMicHint')}
              </p>
              <p className={css.hint}>{t('cameraHint')}</p>
              <div className={css.actions}>
                <button
                  type="button"
                  className={css.secondary}
                  disabled={recognizing}
                  onClick={toggleRecording}
                >
                  {camera.status === 'paused' ? t('cameraResume') : t('cameraPause')}
                </button>
                <button
                  type="button"
                  className={css.primary}
                  disabled={camera.seconds === 0 || recognizing}
                  onClick={() => { void completeCamera() }}
                >
                  {recognizing ? t('recognizeBusy') : t('cameraUse')}
                </button>
                <button
                  type="button"
                  className={css.ghost}
                  disabled={recognizing}
                  onClick={cancelCamera}
                >
                  {t('cameraCancel')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
      {notice !== undefined && (
        <p className={notice.kind === 'ok' ? css.ok : notice.kind === 'error' ? css.error : css.info} role="status">
          {notice.text}
        </p>
      )}
      {transcript !== undefined && (
        <div className={css.transcriptBox}>
          <span className={css.transcriptLabel}>{t('videoTranscript')}</span>
          <p className={css.transcriptText}>{transcript}</p>
        </div>
      )}
      {recognitionDraft !== undefined && (
        <div className={css.actions}>
          <button
            type="button"
            className={css.secondary}
            onClick={() => {
              openCreateDraft(recognitionDraft)
              setRecognitionDraft(undefined)
            }}
          >
            {t('toWorkshop')}
          </button>
        </div>
      )}
      {!writable && <p className={css.hint}>{t('readOnly')}</p>}
    </div>
  )
}
