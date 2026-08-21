/**
 * 语音 settings section: the reply-to-speech configuration — master switch,
 * auto-read of new replies, provider (local Kokoro / OpenAI-compatible API),
 * endpoint, API key, model, voice and speed — plus a live preview. Durable
 * state rides the `skill-voice` namespace; edits draft locally and persist
 * through the explicit 保存语音设置 button.
 */
import { useEffect, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  VOICE_LOCAL_VOICES, VOICE_SAMPLE_TEXT, type VoiceState,
} from './voice.ts'
import css from './VoiceSection.module.css'

/** Registration-side business face for the section. */
export interface VoiceSectionInjected {
  hooks: {
    /** Voice configuration snapshot bound as useVoice. */
    voice: HostObservable<VoiceState>
  }
  /** Whether the settings namespace accepts writes. */
  writable: boolean
  /** Persist a voice configuration patch. */
  setVoice(patch: Partial<VoiceState>): Promise<void>
  /** Synthesize and play one line with the given (possibly unsaved) config. */
  speak(text: string, config: VoiceState): Promise<boolean>
  /** Stop the currently playing line. */
  stopSpeaking(): void
}

/** Props the renderer binds for the section. */
export type VoiceSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skill-store'>
  & InjectFace<VoiceSectionInjected>

type Notice = { readonly kind: 'ok' | 'error'; readonly text: string }

/** Render one 语音 settings page over the injected voice configuration. */
export function VoiceSection({ t, useVoice, writable, setVoice, speak, stopSpeaking }: VoiceSectionProps) {
  const voice = useVoice(value => value)
  const [draft, setDraft] = useState<VoiceState>()
  const [notice, setNotice] = useState<Notice>()
  const [previewing, setPreviewing] = useState(false)

  const current = draft ?? voice
  const dirty = draft !== undefined

  useEffect(() => () => { stopSpeaking() }, [stopSpeaking])

  const persist = async (): Promise<void> => {
    if (draft === undefined) return
    const next = draft
    setDraft(undefined)
    try {
      await setVoice(next)
      setNotice({ kind: 'ok', text: t('saveOk') })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    }
  }

  const preview = async (): Promise<void> => {
    setPreviewing(true)
    try {
      const ok = await speak(VOICE_SAMPLE_TEXT, current)
      if (!ok) setNotice({ kind: 'error', text: t('voiceFailed') })
    } finally {
      setPreviewing(false)
    }
  }

  const patch = (next: Partial<VoiceState>): void => {
    setDraft({ ...current, ...next })
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('voiceTitle')}</h2>
      <p className={css.intro}>{t('voiceHint')}</p>

      <div className={css.card}>
        <label className={css.row}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={current.enabled}
            disabled={!writable}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          <span className={css.fieldLabel}>{t('voiceEnabled')}</span>
        </label>
        <label className={css.row}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={current.autoSpeak}
            disabled={!writable || !current.enabled}
            onChange={(event) => patch({ autoSpeak: event.target.checked })}
          />
          <span className={css.fieldLabel}>{t('voiceAuto')}</span>
        </label>
        <label className={css.row}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={current.asrEnabled}
            disabled={!writable || !current.enabled}
            onChange={(event) => patch({ asrEnabled: event.target.checked })}
          />
          <span className={css.fieldLabel}>{t('voiceInput')}</span>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('voiceProvider')}</span>
          <select
            className={css.select}
            value={current.provider}
            disabled={!writable}
            onChange={(event) => patch({ provider: event.target.value as VoiceState['provider'] })}
          >
            <option value="local">{t('voiceProviderLocal')}</option>
            <option value="openai">{t('voiceProviderOpenAI')}</option>
          </select>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('voiceEndpoint')}</span>
          <input
            type="text"
            className={css.input}
            value={current.endpoint}
            placeholder="http://127.0.0.1:8080"
            disabled={!writable}
            onChange={(event) => patch({ endpoint: event.target.value })}
          />
        </label>

        {current.provider === 'openai' && (
          <>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('voiceApiKey')}</span>
              <input
                type="password"
                className={css.input}
                value={current.apiKey}
                placeholder="sk-…"
                disabled={!writable}
                onChange={(event) => patch({ apiKey: event.target.value })}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('voiceModel')}</span>
              <input
                type="text"
                className={css.input}
                value={current.model}
                placeholder="tts-1"
                disabled={!writable}
                onChange={(event) => patch({ model: event.target.value })}
              />
            </label>
          </>
        )}

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('voiceVoice')}</span>
          {current.provider === 'local' ? (
            <select
              className={css.select}
              value={current.voice}
              disabled={!writable}
              onChange={(event) => patch({ voice: event.target.value })}
            >
              {VOICE_LOCAL_VOICES.map(entry => (
                <option key={entry.id} value={entry.id}>{t(entry.label)}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className={css.input}
              value={current.voice}
              placeholder="alloy"
              disabled={!writable}
              onChange={(event) => patch({ voice: event.target.value })}
            />
          )}
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('voiceSpeed')}（{current.speed.toFixed(1)}x）</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            className={css.range}
            value={current.speed}
            disabled={!writable}
            onChange={(event) => patch({ speed: Number(event.target.value) })}
          />
        </label>

        <div className={css.actions}>
          <button
            type="button"
            className={css.ghost}
            disabled={previewing || !current.enabled}
            onClick={() => { void preview() }}
          >
            {previewing ? t('voiceBusy') : t('voicePreview')}
          </button>
          <button
            type="button"
            className={css.primary}
            disabled={!writable || !dirty}
            onClick={() => { void persist() }}
          >
            {t('voiceSave')}
          </button>
        </div>
        {notice !== undefined && (
          <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
        )}
      </div>
    </div>
  )
}
