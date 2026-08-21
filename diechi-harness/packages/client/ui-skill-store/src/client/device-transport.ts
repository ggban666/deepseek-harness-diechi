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

