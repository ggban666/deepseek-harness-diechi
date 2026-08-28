/**
 * diechi-process-watchdog host 插件：cordis 入口。
 *
 * ## 这里**不跑**主循环
 *
 * 主循环跑在独立进程（src/cli.ts）。如果在本插件里跑，
 * DSH 崩溃时 cordis 进程整个没了，watchdog 跟着死 ——
 * 「任一角色死了其他能接住」这条三架构规则在**最需要它的那一刻**失效。
 *
 * 本插件只做两件事：
 * 1. 提供 `ctx.watchdog` Service，让监督者能写升级信号（含路径常量与读写实现）；
 * 2. 启动时打一行日志，说明守护由哪个进程负责。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog
 */

import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { UpdateSignal } from './types.ts'
import { signalDir, signalPath } from './watchdog.ts'

/** Cordis 插件名。 */
export const name = 'diechi-process-watchdog'

/** 不依赖任何 cordis 服务 —— 依赖越少，DSH 半损坏时越可能还挂得起来。 */
export const inject: readonly string[] = []

/** 升级信号读写。 */
export interface WatchdogService {
  /** `$DSH_HOME/.watchdog` */
  readonly dir: string

  /** `$DSH_HOME/.watchdog/update.signal` */
  readonly signalPath: string

  /** 写信号。监督者（human 调用）用这个通知独立 watchdog 进程升级。 */
  writeSignal(signal: UpdateSignal): Promise<void>

  /** 读信号。没有或内容损坏时返回 null —— 损坏的信号不能让 DSH 起不来。 */
  readSignal(): Promise<UpdateSignal | null>

  /** 清信号。消费完必须调，否则会重复升级。 */
  clearSignal(): Promise<void>
}

/** 独立构造 Service（不依赖 cordis，cli.ts 也能用）。 */
export function createWatchdogService(dshHome: string): WatchdogService {
  const dir = signalDir(dshHome)
  const path = signalPath(dshHome)

  return {
    dir,
    signalPath: path,

    async writeSignal(signal: UpdateSignal): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      // 先写临时文件再 rename：避免 watchdog 正好读到写了一半的 JSON。
      const tmp = `${path}.tmp`
      await writeFile(tmp, `${JSON.stringify(signal, null, 2)}\n`, 'utf8')
      const { rename } = await import('node:fs/promises')
      await rename(tmp, path)
    },

    async readSignal(): Promise<UpdateSignal | null> {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch {
        return null
      }
      try {
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed !== 'object' || parsed === null) return null
        const candidate = parsed as Partial<UpdateSignal>
        if (typeof candidate.version !== 'string' || candidate.action !== 'restart') return null
        return candidate as UpdateSignal
      } catch {
        return null
      }
    },

    async clearSignal(): Promise<void> {
      await rm(path, { force: true })
    },
  }
}

/**
 * Cordis 函数式插件主体。
 */
export function apply(ctx: Context): void {
  const dshHome = process.env.DSH_HOME ?? ''
  const service = createWatchdogService(dshHome)

  ctx.provide('watchdog', service as unknown as WatchdogService)

  // eslint-disable-next-line no-console
  console.log(
    `[diechi-process-watchdog] 信号目录就绪 → ${service.signalPath}\n` +
      '[diechi-process-watchdog] 守护主循环由**独立进程**负责（start-watchdog.cmd），本插件不跑循环',
  )

  ctx.effect(() => () => {
    // 插件卸载只清理自身，不动独立进程 —— 它不归 cordis 管。
  }, 'diechi-process-watchdog: 卸载清理')
}
