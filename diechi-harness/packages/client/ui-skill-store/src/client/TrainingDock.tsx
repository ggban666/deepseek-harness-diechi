/**
 * Training dock (训练模式): one full-width row above the composer on the
 * session the training round lives in. Prompts the user to feed corpus /
 * video material or have the agent collect data, then closes the round with
 * the "完成训练" button (mirrors the skill-center banner).
 */
import { useEffect, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TrainingState } from './skill-format.ts'
import type { RetrainResult } from './skill-display.ts'
import css from './TrainingDock.module.css'

/** 对话自动归纳通知：宿主归纳落库后推送，客户端在当前会话闪现「已记入大脑」提示条。 */
export interface DistillNotice {
  /** ISO 时间戳；变化即代表一次新的沉淀。 */
  readonly at: string
  /** 沉淀发生的会话 id（只在该会话显示）。 */
  readonly sessionId: string
  /** 沉淀知识主题（如 "对话：用户饮食偏好"）。 */
  readonly topic: string
  /** 归位目标文案（技能标题 / 杂库 / 全局收件箱）。 */
  readonly target: string
}

/** Registration-side business face for the training dock. */
export interface TrainingDockInjected {
  hooks: {
    /** In-flight training session snapshot bound as useTraining. */
    training: HostObservable<TrainingState>
    /** 最近一次对话自动归纳通知（「已记入大脑」提示条）。 */
    distill: HostObservable<DistillNotice | undefined>
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
export function TrainingDock({ sessionId, t, useTraining, useDistill, finishTraining, cancelTraining }: TrainingDockProps) {
  const training = useTraining(value => value)
  const distill = useDistill(value => value)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>()
  // 「已记入大脑」提示条：只在沉淀发生的会话闪现 4 秒，同一 at 不重复。
  const [distillNotice, setDistillNotice] = useState<{ topic: string; target: string }>()
  const lastDistillAt = useRef('')
  useEffect(() => {
    if (distill === undefined) return
    if (distill.sessionId !== sessionId) return
    if (distill.at === lastDistillAt.current) return
    lastDistillAt.current = distill.at
    setDistillNotice({ topic: distill.topic, target: distill.target })
    const timer = setTimeout(() => setDistillNotice(undefined), 4000)
    return () => clearTimeout(timer)
  }, [distill, sessionId])

  const trainingActive = training.active && training.sessionId !== '' && training.sessionId === sessionId
  if (!trainingActive && distillNotice === undefined) return null

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
      {distillNotice !== undefined && (
        <span className={css.distill}>
          🧠 {t('distillNotice').replace('{topic}', distillNotice.topic).replace('{target}', distillNotice.target)}
        </span>
      )}
      {trainingActive && <>
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
      </>}
    </div>
  )
}