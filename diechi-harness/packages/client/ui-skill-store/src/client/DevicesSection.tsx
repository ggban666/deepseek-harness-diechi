/**
 * 蓝牙设备 settings section: pair / connect AI-glasses, headset or phone
 * companion devices over Bluetooth Low Energy (Nordic UART). Durable state
 * (audio routing) rides the `skill-devices` namespace; the live BLE link is
 * process-local via the Web Bluetooth transport.
 */
import { useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanionDevice, CompanionDeviceKind } from './device-transport.ts'
import css from './DevicesSection.module.css'

/** Durable companion-device configuration mirrored from `skill-devices`. */
export interface DevicesState {
  /** Whether the current browser provides Web Bluetooth. */
  readonly supported: boolean
  /** The last paired companion device (process-local). */
  readonly device: CompanionDevice | undefined
  /** Whether the paired device is currently connected. */
  readonly connected: boolean
  /** Route device microphone into the conversation. */
  readonly inputEnabled: boolean
  /** Route assistant speech out to the device speaker. */
  readonly outputEnabled: boolean
  /** A pairing scan is in flight. */
  readonly scanning: boolean
  /** A connect / disconnect action is in flight. */
  readonly busy: boolean
}

/** Registration-side business face for the section. */
export interface DevicesSectionInjected {
  hooks: {
    /** Companion-device snapshot bound as useDevices. */
    devices: HostObservable<DevicesState>
  }
  /** Open the system BLE chooser and pair a companion device. */
  scan(): Promise<void>
  /** Connect the paired device (GATT + NUS characteristics). */
  connect(): Promise<void>
  /** Disconnect the paired device. */
  disconnect(): Promise<void>
  /** Persist audio-route preferences. */
  setRoutes(patch: { inputEnabled: boolean; outputEnabled: boolean }): Promise<void>
  /** Send a protocol hello frame over the live link. */
  sendHello(): Promise<boolean>
}

/** Props the renderer binds for the section. */
export type DevicesSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skill-store'>
  & InjectFace<DevicesSectionInjected>

type Notice = { readonly kind: 'ok' | 'error'; readonly text: string }

function kindLabel(kind: CompanionDeviceKind, t: DevicesSectionProps['t']): string {
  switch (kind) {
    case 'ai-glasses': return String(t('devicesKindGlasses'))
    case 'headset': return String(t('devicesKindHeadset'))
    case 'phone': return String(t('devicesKindPhone'))
    default: return String(t('devicesUnknown'))
  }
}

/** Render one 蓝牙设备 settings page over the live companion bridge. */
export function DevicesSection({
  t, useDevices, scan, connect, disconnect, setRoutes, sendHello,
}: DevicesSectionProps) {
  const devices = useDevices(value => value)
  const [notice, setNotice] = useState<Notice>()

  const run = async (action: () => Promise<void>, okText?: string): Promise<void> => {
    setNotice(undefined)
    try {
      await action()
      if (okText !== undefined) setNotice({ kind: 'ok', text: okText })
    } catch {
      setNotice({ kind: 'error', text: String(t('devicesError')) })
    }
  }

  const toggleRoute = (patch: { inputEnabled: boolean; outputEnabled: boolean }): void => {
    void run(() => setRoutes(patch))
  }

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('devicesTitle')}</h2>
      <p className={css.intro}>{t('devicesIntro')}</p>

      {!devices.supported ? (
        <p className={css.warn}>{t('devicesUnsupported')}</p>
      ) : (
        <div className={css.card}>
          {devices.device === undefined ? (
            <p className={css.empty}>{t('devicesNoDevice')}</p>
          ) : (
            <div className={css.device}>
              <div className={css.deviceRow}>
                <span className={css.deviceName}>{devices.device.name}</span>
                <span className={devices.connected ? css.badgeOn : css.badgeOff}>
                  {devices.connected ? t('devicesConnected') : t('devicesDisconnected')}
                </span>
              </div>
              <div className={css.deviceMeta}>
                {kindLabel(devices.device.kind, t)}
                {' · '}
                {devices.device.transport}
              </div>
              <div className={css.actions}>
                <button
                  type="button"
                  className={css.primary}
                  disabled={devices.busy}
                  onClick={() => {
                    void run(
                      devices.connected ? () => disconnect() : () => connect(),
                      undefined,
                    )
                  }}
                >
                  {devices.connected ? t('devicesDisconnect') : t('devicesConnect')}
                </button>
                <button
                  type="button"
                  className={css.ghost}
                  disabled={devices.busy || !devices.connected}
                  onClick={() => {
                    void run(() => sendHello().then(ok => {
                      if (!ok) throw new Error('hello-failed')
                    }), String(t('devicesHelloOk')))
                  }}
                >
                  {t('devicesHello')}
                </button>
              </div>
            </div>
          )}

          <label className={css.row}>
            <input
              type="checkbox"
              className={css.checkbox}
              checked={devices.inputEnabled}
              onChange={(event) => toggleRoute({ inputEnabled: event.target.checked, outputEnabled: devices.outputEnabled })}
            />
            <span className={css.fieldLabel}>{t('devicesInput')}</span>
          </label>
          <label className={css.row}>
            <input
              type="checkbox"
              className={css.checkbox}
              checked={devices.outputEnabled}
              onChange={(event) => toggleRoute({ inputEnabled: devices.inputEnabled, outputEnabled: event.target.checked })}
            />
            <span className={css.fieldLabel}>{t('devicesOutput')}</span>
          </label>
          <p className={css.hint}>{t('devicesRouteHint')}</p>

          <div className={css.actions}>
            <button
              type="button"
              className={css.primary}
              disabled={devices.scanning || devices.busy}
              onClick={() => { void run(() => scan()) }}
            >
              {devices.scanning ? t('devicesScanning') : t('devicesScan')}
            </button>
          </div>

          {notice !== undefined && (
            <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
          )}
        </div>
      )}
    </div>
  )
}