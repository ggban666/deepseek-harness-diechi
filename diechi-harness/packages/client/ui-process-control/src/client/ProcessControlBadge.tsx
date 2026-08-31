/**
 * 侧边栏底部的外部服务开关（`sidebar.footer.action`）。
 *
 * 两个按钮：Qwen3.8 本地模型、视频模型。点一下常驻启动，再点一下停止。
 * 状态点只表达一件事：进程是否在跑（绿 = 运行中，灰 = 已停止，红 = 异常，
 * 蓝闪 = 启停中）。显存冲突时顶部弹一条黄色提示（只提示，不强制互斥）。
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar.footer.action slot declaration (ui-sidebar) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ProcessControlInjected } from './ProcessController.ts'
import type { ProcessId } from './types.ts'
import css from './ProcessControlBadge.module.css'

/** Props the badge binds. */
export type ProcessControlBadgeProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'process-control'>
  & InjectFace<ProcessControlInjected>

const ORDER: readonly ProcessId[] = ['qwen3.8', 'vision']

/** 状态点样式。 */
function tone(state: string | undefined) {
  switch (state) {
    case 'running': return css.toneOk
    case 'starting':
    case 'stopping': return css.toneBusy
    case 'error': return css.toneDanger
    default: return css.toneOff
  }
}

/** 状态文案。 */
function stateLabel(state: string | undefined, t: (k: any) => string): string {
  switch (state) {
    case 'running': return t('running')
    case 'starting': return t('starting')
    case 'stopping': return t('stopping')
    case 'error': return t('error')
    default: return t('stopped')
  }
}

/** Render the sidebar foot entry: two toggle rows for external services. */
export function ProcessControlBadge({ t, useState: useState, toggle, wide }: ProcessControlBadgeProps) {
  const state = useState(value => value)
  const items = state.items
  const busy = state.busy
  const gpuWarning = state.gpuWarning

  // 收起成 rail 时只显示两个圆点，展开时显示完整两行。
  return (
    <div className={`${css.group} ${wide ? '' : css.rail}`}>
      {!state.available && items === null ? (
        <div className={css.unavailable} title={t('unavailable')}>{t('unavailable')}</div>
      ) : (
        <>
          {gpuWarning !== null ? (
            <div className={css.gpuWarning} title={gpuWarning}>{t('gpuWarning')}</div>
          ) : null}
          {ORDER.map((id) => {
            const info = items?.find((i) => i.id === id)
            const isBusy = busy === id
            const running = info?.state === 'running'
            return (
              <button
                key={id}
                type="button"
                className={`${css.row} ${isBusy ? css.busy : ''}`}
                title={`${info?.label ?? id} · ${stateLabel(info?.state, t)} · ${running ? t('stop') : t('start')}`}
                aria-label={`${info?.label ?? id} ${running ? t('stop') : t('start')}`}
                disabled={isBusy || !state.available}
                onClick={() => void toggle(id)}
              >
                <span className={`${css.dot} ${tone(info?.state)}`} aria-hidden="true" />
                {wide ? (
                  <>
                    <span className={css.label}>{info?.label ?? id}</span>
                    <span className={css.state}>{stateLabel(info?.state, t)}</span>
                  </>
                ) : null}
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
