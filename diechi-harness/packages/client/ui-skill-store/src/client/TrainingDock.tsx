/**
 * Training dock (训练模式): one full-width row above the composer on the
 * session the training round lives in. Prompts the user to feed corpus /
 * video material or have the agent collect data, then closes the round with
 * the "完成训练" button (mirrors the skill-center banner).
 */
import { useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TrainingState } from './skill-format.ts'
import type { RetrainResult } from './skill-display.ts'
import css from './TrainingDock.module.css'

/** Registration-side business face for the training dock. */
export interface TrainingDockInjected {
  hooks: {
    /** In-flight training session snapshot bound as useTraining. */
    training: HostObservable<TrainingState>
  }
  /** Ask the agent to finish the round and generate the new skill revision. */
  finishTraining(): Promise<RetrainResult>
  /** Abandon the round without generating (clears the banner). */
  cancelTraining(): void
}

/** Props the renderer binds for the dock entry. */
export type TrainingDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'skill-store'>
  & InjectFace<TrainingDockInjected>

/** Render the training banner on the training conversation only. */
export function TrainingDock({ sessionId, t, useTraining, finishTraining, cancelTraining }: TrainingDockProps) {
  const training = useTraining(value => value)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>()
  if (!training.active || training.sessionId === '' || training.sessionId !== sessionId) return null

  const handleFinish = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await finishTraining()
      setNotice(result.ok
        ? { kind: 'ok', text: t('trainingFinishSent') }
        : { kind: 'error', text: result.error === 'no-session' ? t('retrainNoSession') : t('trainingFinishFailed') })
    } catch {
      setNotice({ kind: 'error', text: t('trainingFinishFailed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.dock} role="status">
      <span className={css.title}>
        {training.mode === 'retrain'
          ? t('trainingDockRetrain').replace('{title}', training.skillTitle)
          : t('trainingDockCreate').replace('{title}', training.skillTitle)}
      </span>
      <span className={css.hint}>{t('trainingDockHint')}</span>
      <button type="button" className={css.finish} disabled={busy} onClick={() => { void handleFinish() }}>
        {busy ? t('pending') : t('trainingFinish')}
      </button>
      <button type="button" className={css.cancel} disabled={busy} onClick={cancelTraining}>
        {t('cancel')}
      </button>
      {notice !== undefined && (
        <span className={notice.kind === 'ok' ? css.ok : css.error}>{notice.text}</span>
      )}
    </div>
  )
}