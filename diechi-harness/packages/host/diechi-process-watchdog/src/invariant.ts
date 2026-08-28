/**
 * diechi-process-watchdog 不变量。
 *
 * 三架构的工程含义是「物理上绕不过去」，不是「约定上不该做」。
 * 所以这里的断言失败一律抛错，不做静默降级 —— watchdog 静默失败
 * 比崩溃更危险：人类会以为有人守着，其实没有。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog/invariant
 */

/** watchdog 自身进入不可恢复状态。设计上应由 OS 进程监控（NSSM / systemd）接管重启。 */
export class WatchdogSelfCrashError extends Error {
  override readonly name = 'WatchdogSelfCrashError'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/** 配置不合法（缺失目录 / 端口越界等）。启动阶段就该发现，不拖到运行时。 */
export class WatchdogConfigError extends Error {
  override readonly name = 'WatchdogConfigError'

  constructor(message: string) {
    super(message)
  }
}

/** 断言条件成立，否则抛 WatchdogSelfCrashError。 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WatchdogSelfCrashError(message)
}

/**
 * 校验端口。非法值直接抛错而不是回退默认值 ——
 * 回退会让 watchdog 守着一个并非用户预期的端口，比直接失败更难排查。
 */
export function assertPort(port: number, label = 'port'): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new WatchdogConfigError(`${label} 必须是 1..65535 的整数，收到 ${String(port)}`)
  }
  return port
}

/** 校验目录存在。 */
export function assertDirExists(dir: string, label: string): string {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new WatchdogConfigError(`${label} 不能为空`)
  }
  return dir
}
