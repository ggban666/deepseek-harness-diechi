/**
 * Cross-platform device seam for the desktop implementation and the future
 * mobile/AI-glasses bridge. The web client only supplies discovery and audio
 * routing hints; Android/iOS will provide the real Bluetooth transport.
 */

export type CompanionDeviceKind = 'ai-glasses' | 'headset' | 'phone'
export type CompanionTransportKind = 'bluetooth-le' | 'bluetooth-classic' | 'wifi' | 'browser-audio'

export interface CompanionDevice {
  readonly id: string
  readonly name: string
  readonly kind: CompanionDeviceKind
  readonly transport: CompanionTransportKind
  readonly connected: boolean
  readonly input: boolean
  readonly output: boolean
}

export interface CompanionAudioRoute {
  readonly inputDeviceId?: string
  readonly outputDeviceId?: string
  readonly inputEnabled: boolean
  readonly outputEnabled: boolean
}

/** Versioned messages used by the future phone <-> glasses bridge. */
export type CompanionMessage =
  | { readonly type: 'device/hello'; readonly protocol: 1; readonly device: CompanionDevice }
  | { readonly type: 'audio/input'; readonly sequence: number; readonly codec: 'opus' | 'pcm16'; readonly data: ArrayBuffer }
  | { readonly type: 'video/frame'; readonly sequence: number; readonly mime: string; readonly data: ArrayBuffer }
  | { readonly type: 'assistant/text_delta'; readonly turnId: string; readonly delta: string }
  | { readonly type: 'assistant/audio_chunk'; readonly turnId: string; readonly sequence: number; readonly codec: 'opus' | 'pcm16'; readonly data: ArrayBuffer }
  | { readonly type: 'assistant/interrupt'; readonly turnId?: string; readonly reason: 'user_speech' | 'user_action' | 'connection' }
  | { readonly type: 'session/state'; readonly sessionId: string; readonly state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted' }

export interface CompanionTransport {
  readonly kind: CompanionTransportKind
  scan(): Promise<readonly CompanionDevice[]>
  connect(deviceId: string): Promise<CompanionDevice>
  disconnect(deviceId?: string): Promise<void>
  send(message: CompanionMessage): Promise<void>
  subscribe(listener: (message: CompanionMessage) => void): () => void
}

/** Browser adapter: keeps normal microphone/speaker routing working today. */
export class BrowserAudioTransport implements CompanionTransport {
  readonly kind = 'browser-audio' as const
  private listeners = new Set<(message: CompanionMessage) => void>()
  private connected = false

  async scan(): Promise<readonly CompanionDevice[]> {
    const devices = typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const inputs = devices.filter(device => device.kind === 'audioinput')
    const outputs = devices.filter(device => device.kind === 'audiooutput')
    return [{
      id: 'browser-default-audio',
      name: '当前电脑音频设备',
      kind: 'headset',
      transport: 'browser-audio',
      connected: this.connected,
      input: inputs.length > 0,
      output: outputs.length > 0,
    }]
  }

  async connect(deviceId: string): Promise<CompanionDevice> {
    this.connected = true
    const devices = await this.scan()
    return devices.find(device => device.id === deviceId) ?? devices[0]!
  }

  async disconnect(): Promise<void> { this.connected = false }

  async send(message: CompanionMessage): Promise<void> {
    // Desktop browser audio has no glasses transport; retain the protocol
    // event so the mobile adapter can be swapped in without changing callers.
    for (const listener of this.listeners) listener(message)
  }

  subscribe(listener: (message: CompanionMessage) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** Future Web Bluetooth/mobile hook. Pairing remains platform-owned. */
export interface BluetoothCompanionTransport extends CompanionTransport {
  readonly kind: 'bluetooth-le' | 'bluetooth-classic'
  requestPairing(): Promise<CompanionDevice>
}

/** Nordic UART Service (NUS)：手机/眼镜/耳机伴生桥使用的 BLE 串口服务。 */
export const BLE_COMPANION_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
/** 下行特征（APP → 设备，write）。 */
export const BLE_COMPANION_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
/** 上行特征（设备 → APP，notify）。 */
export const BLE_COMPANION_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

/** Web Bluetooth API 的最小结构面（lib.dom 未内置，避免引入额外依赖）。 */
interface WebBluetooth {
  requestDevice(options: {
    filters?: ReadonlyArray<{ services?: readonly string[]; name?: string; namePrefix?: string }>
    optionalServices?: readonly string[]
    acceptAllDevices?: boolean
  }): Promise<BluetoothDeviceLike>
}
interface BluetoothDeviceLike {
  readonly id: string
  readonly name?: string
  readonly gatt?: BluetoothRemoteGATTServerLike
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
}
interface BluetoothRemoteGATTServerLike {
  readonly connected: boolean
  connect(): Promise<BluetoothRemoteGATTServerLike>
  disconnect(): void
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTServiceLike>
}
interface BluetoothRemoteGATTServiceLike {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristicLike>
}
interface BluetoothRemoteGATTCharacteristicLike {
  readonly value?: DataView
  addEventListener(type: 'characteristicvaluechanged', listener: () => void): void
  writeValue(value: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristicLike>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristicLike>
}

declare global {
  interface Navigator {
    bluetooth?: WebBluetooth
  }
}

/** 已连接的 NUS 设备句柄。 */
interface PairedNusDevice {
  readonly device: BluetoothDeviceLike
  readonly server: BluetoothRemoteGATTServerLike
  readonly tx: BluetoothRemoteGATTCharacteristicLike
  readonly rx: BluetoothRemoteGATTCharacteristicLike
}

/**
 * Web Bluetooth（Nordic UART）伴生桥：Chromium 桌面 / Android 端与 AI 眼镜、
 * 手机伴生应用走 NUS + CompanionMessage JSON 帧。桌面扫描依赖用户手势打开
 * 系统配对面板；配对后的连接 / 断开 / 收发帧全程在此完成。
 */
export class WebBluetoothTransport implements BluetoothCompanionTransport {
  readonly kind = 'bluetooth-le' as const
  private readonly listeners = new Set<(message: CompanionMessage) => void>()
  private readonly decoder = new TextDecoder()
  private device: BluetoothDeviceLike | undefined
  private link: PairedNusDevice | undefined

  /** 当前运行环境是否提供 Web Bluetooth（Chrome/Edge 桌面与 Android 为真）。 */
  static supported(): boolean {
    return typeof navigator !== 'undefined' && navigator.bluetooth !== undefined
  }

  /** 打开系统配对面板，选择一个广播 NUS 的伴生设备。 */
  async requestPairing(): Promise<CompanionDevice> {
    const bluetooth = navigator.bluetooth
    if (bluetooth === undefined) throw new Error('bluetooth-unsupported')
    const device = await bluetooth.requestDevice({
      filters: [{ services: [BLE_COMPANION_SERVICE] }],
      optionalServices: [BLE_COMPANION_SERVICE],
    })
    this.device = device
    return toCompanionDevice(device, false)
  }

  /** 扫描 = 打开系统配对面板（Web Bluetooth 必须由用户手势触发）。 */
  async scan(): Promise<readonly CompanionDevice[]> {
    return [await this.requestPairing()]
  }

  async connect(deviceId: string): Promise<CompanionDevice> {
    const device = this.device
    if (device === undefined || device.id !== deviceId) {
      // 尚未选择过该设备（例如刷新后重连）：重新走配对面板。
      const paired = await this.requestPairing()
      return this.connect(paired.id)
    }
    if (device.gatt === undefined) throw new Error('bluetooth-no-gatt')
    const server = await device.gatt.connect()
    const service = await server.getPrimaryService(BLE_COMPANION_SERVICE)
    const tx = await service.getCharacteristic(BLE_COMPANION_TX)
    const rx = await service.getCharacteristic(BLE_COMPANION_RX)
    rx.addEventListener('characteristicvaluechanged', () => { this.dispatchRx() })
    await rx.startNotifications()
    this.link = { device, server, tx, rx }
    device.addEventListener('gattserverdisconnected', () => {
      this.link = undefined
      this.serverLost()
    })
    return toCompanionDevice(device, true)
  }

  async disconnect(): Promise<void> {
    const link = this.link
    this.link = undefined
    if (link === undefined) return
    await link.rx.stopNotifications().catch(() => {})
    link.server.disconnect()
    this.serverLost()
  }

  async send(message: CompanionMessage): Promise<void> {
    if (this.link === undefined) throw new Error('bluetooth-not-connected')
    const payload = new TextEncoder().encode(JSON.stringify(message))
    await this.link.tx.writeValue(payload)
  }

  subscribe(listener: (message: CompanionMessage) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 连接断开后通知订阅方把设备标记为未连接。 */
  private serverLost(): void {
    const message: CompanionMessage = {
      type: 'session/state',
      sessionId: '',
      state: 'interrupted',
    }
    for (const listener of this.listeners) listener(message)
  }

  private dispatchRx(): void {
    const value = this.link?.rx.value
    if (value === undefined) return
    const text = this.decoder.decode(value)
    try {
      const message = JSON.parse(text) as CompanionMessage
      for (const listener of this.listeners) listener(message)
    } catch {
      // 非 CompanionMessage JSON 帧（如调试串口）直接忽略。
    }
  }
}

/** BluetoothDeviceLike → 协议设备视图。 */
function toCompanionDevice(device: BluetoothDeviceLike, connected: boolean): CompanionDevice {
  return {
    id: device.id,
    name: device.name || '蓝牙伴生设备',
    kind: 'ai-glasses',
    transport: 'bluetooth-le',
    connected,
    input: true,
    output: true,
  }
}

