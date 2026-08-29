/**
 * watchdog 主循环。
 *
 * 单轮优先级：**计划内升级信号 > 崩溃探活**。
 * 信号优先是因为它是人类明确要求的动作，不应该被「正好这一轮 DSH 还没起来」
 * 之类的探活噪声盖掉。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog/watchdog
 */

import { join } from 'node:path'
import { appendFile, mkdir } from 'node:fs/promises'
import type {
  ProbeOutcome,
  RestartReason,
  UpdateSignal,
  WatchdogConfig,
  WatchdogDeps,
  WatchdogHandle,
} from './types.ts'

/**
 * 信号文件目录：`$DSH_HOME/.watchdog`。
 * 放在这个模块（而不是 index.ts）是因为 cli.ts 也要用，
 * 而 cli.ts 不该为了拿两个路径常量就去 import cordis。
 */
export function signalDir(dshHome: string): string {
  return join(dshHome, '.watchdog')
}

/** 升级信号文件路径。 */
export function signalPath(dshHome: string): string {
  return join(signalDir(dshHome), 'update.signal')
}

/** 升级审计日志路径：每次 restart 追加一行 JSONL。 */
export function historyPath(dshHome: string): string {
  return join(signalDir(dshHome), 'history.jsonl')
}

/** 默认配置。probeIntervalSec 取 30 —— 与执行说明的验证标准「30s 内拉起」对齐。 */
export const DEFAULT_WATCHDOG_CONFIG: Omit<WatchdogConfig, 'dshHome' | 'harnessPath'> = {
  port: 3090,
  probeIntervalSec: 30,
  probeTimeoutMs: 5000,
  gracefulExitMs: 2000,
  probeMode: 'port',
}

/**
 * 跑一轮：读信号 → 有就走计划内升级；否则探活 → 挂了就记录 + 拉起。
 * 抛给调用方的异常只可能是 deps 自己抛的；restart / recordRestart 的失败已在内部消化。
 */
export async function runOnce(config: WatchdogConfig, deps: WatchdogDeps): Promise<ProbeOutcome> {
  const signal = await deps.readSignal()
  if (signal !== null && signal.action === 'restart') {
    // 先删信号再重启。
    //
    // 执行说明的伪代码是「先 restart 再 deleteSignalFile」，但那样有个坑：
    // 重启失败（补丁损坏 / 端口仍被占）时信号还在，下一轮又拿到同一个信号，
    // 无限重试同一份坏补丁。先删掉，重启失败的兜底交给下一轮探活 ——
    // 探活发现 DSH 没起来，自然会用 watchdog-restart 再拉一次，且不带坏补丁。
    await deps.clearSignal()
    deps.log(`检测到升级信号 v${signal.version}（${signal.reason}），开始计划内重启`)
    // 缺口 1 修：写审计底账（即使 signal 即将被消费）。
    await appendHistory(deps, config, {
      stage: 'signal-consumed',
      version: signal.version,
      reason: signal.reason,
      patchPath: signal.patchPath ?? null,
    })
    await safeRestart(signal, 'signal-restart', deps)
    return { kind: 'signalled', signal }
  }

  const alive = await deps.probe()
  if (alive) return { kind: 'alive' }

  const reason: RestartReason = 'watchdog-restart'
  deps.log(`DSH 探活失败（端口 ${config.port}），记录负样本并重启`)
  deps.recordRestart(reason, {
    scope: 'person-brain:process-restart',
    port: config.port,
    at: new Date().toISOString(),
  })
  // 缺口 1 修：崩溃审计也写 history.jsonl（便于回看「DSH 何时挂的」）
  await appendHistory(deps, config, { stage: 'watchdog-restart', port: config.port })
  await safeRestart(null, reason, deps)
  return { kind: 'restarted', reason }
}

/** restart 失败不能让主循环崩 —— watchdog 死了就再没人拉 DSH 了。 */
async function safeRestart(
  signal: UpdateSignal | null,
  reason: RestartReason,
  deps: WatchdogDeps,
): Promise<void> {
  try {
    await deps.restart(signal, reason)
  } catch (error) {
    deps.log(`重启失败（${reason}）：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 缺口 1 修：写 history.jsonl 审计底账。失败也不抛（审计失败不能拖垮主循环）。 */
async function appendHistory(
  deps: WatchdogDeps,
  config: WatchdogConfig,
  entry: {
    stage: 'signal-consumed' | 'watchdog-restart' | 'signal-restart-failed' | 'dsh-spawn-failed'
    version?: string
    reason?: string
    patchPath?: string | null
    port?: number
    exitCode?: number | null
  },
): Promise<void> {
  try {
    // appendFile 不创建父目录 —— 历史首次写之前先 mkdir -p
    await mkdir(signalDir(config.dshHome), { recursive: true })
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    await appendFile(historyPath(config.dshHome), line, 'utf8')
  } catch (error) {
    deps.log(`写 history.jsonl 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 启动主循环。
 * @param deps 全部副作用，测试时注入 mock —— 单测绝不能真去杀用户的 3090。
 */
export function startWatchdog(config: WatchdogConfig, deps: WatchdogDeps): WatchdogHandle {
  let stopped = false
  let resolveDone: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  void (async (): Promise<void> => {
    try {
      while (!stopped) {
        await interruptibleSleep(config.probeIntervalSec * 1000, () => stopped, deps.sleep)
        if (stopped) break
        try {
          await runOnce(config, deps)
        } catch (error) {
          // runOnce 内部的 restart/record 已各自消化异常；
          // 走到这里说明 probe / readSignal 本身炸了，记录后继续下一轮。
          deps.log(`本轮异常：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      resolveDone()
    }
  })()

  return {
    stop(): void {
      stopped = true
    },
    get done(): Promise<void> {
      return done
    },
  }
}

/**
 * 可中断睡眠：切成小段，每段之间检查停止标志。
 * 否则 stop() 之后最多要等整整一个 probeIntervalSec 才真的退出。
 */
async function interruptibleSleep(
  totalMs: number,
  shouldStop: () => boolean,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const SLICE_MS = 200
  let remaining = totalMs
  while (remaining > 0 && !shouldStop()) {
    const step = Math.min(SLICE_MS, remaining)
    await sleep(step)
    remaining -= step
  }
}
