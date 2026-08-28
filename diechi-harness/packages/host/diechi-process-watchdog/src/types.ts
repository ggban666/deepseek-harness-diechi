/**
 * diechi-process-watchdog 类型定义。
 *
 * ## 为什么 watchdog 必须是独立进程
 *
 * 三架构的闭环规则是「任一角色死了，其他能接住不崩溃」。
 * 如果 watchdog 作为 cordis 插件跑在 DSH 进程内，那么 DSH 一崩，
 * watchdog 跟着一起死 —— 这条规则在**最关键的场景下**恰好失效。
 *
 * 所以：主循环跑在独立 Node 进程（src/cli.ts），与 DSH 平级；
 * cordis 插件（src/index.ts）只负责暴露信号路径与状态，不跑主循环。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-watchdog/types
 */

/** watchdog 运行配置。所有字段都可通过环境变量覆盖，见 cli.ts。 */
export interface WatchdogConfig {
  /** `$DSH_HOME` 目录。信号文件与 brain.db-supervisor 都在这里。 */
  dshHome: string

  /** diechi-harness 目录。spawn DSH 时作为 cwd。 */
  harnessPath: string

  /** DSH web 端口。探活与重启都用这个端口。 */
  port: number

  /** 探活间隔（秒）。 */
  probeIntervalSec: number

  /** 单次探活超时（毫秒）。 */
  probeTimeoutMs: number

  /** 发终止信号后等待优雅退出的时间（毫秒），超时则强杀。 */
  gracefulExitMs: number

  /** 探测方式。`port` = TCP 连端口（默认，毫秒级）；`command` = 跑 dsh web --dump-config。 */
  probeMode: 'port' | 'command'
}

/**
 * 监督者写下的升级信号（`$DSH_HOME/.watchdog/update.signal`）。
 *
 * 存在的意义：DSH **不能自杀式升级** —— 要替换的补丁文件正被自己锁着，
 * 必须先被外部进程杀掉，文件锁释放后才能换。所以监督者只写信号，
 * 由 watchdog 执行「杀 → 换文件 → 拉起」。
 */
export interface UpdateSignal {
  /** 目标版本号，人类填。 */
  version: string

  /** 目前只有 restart 一种。 */
  action: 'restart'

  /** 谁请求的，一般是 `diechi-supervisor`。 */
  requestedBy: string

  /** ISO 时间戳。 */
  requestedAt: string

  /** 升级原因，进 negative_samples 的 reason 字段。 */
  reason: string

  /** 补丁目录。存在时 watchdog 会把它拷到 harnessPath 覆盖。 */
  patchPath?: string
}

/** 重启原因。会原样写进 negative_samples.reason，供 diechi-evolve 聚类。 */
export type RestartReason = 'watchdog-restart' | 'signal-restart'

/** watchdog 每一轮循环看到的状态。 */
export type ProbeOutcome =
  /** DSH 活着，什么都不做。 */
  | { kind: 'alive' }
  /** DSH 没了，已触发重启。 */
  | { kind: 'restarted'; reason: RestartReason }
  /** 消费了一个升级信号，已重启。 */
  | { kind: 'signalled'; signal: UpdateSignal }

/**
 * 外部副作用集合。全部可注入，为了可测试 ——
 * 单测里绝不能真去 spawn / kill 用户的 3090 进程。
 */
export interface WatchdogDeps {
  /** 探活。返回 true 表示 DSH 活着。 */
  probe(): Promise<boolean>

  /** 读信号文件。没有或损坏时返回 null。 */
  readSignal(): Promise<UpdateSignal | null>

  /** 删除信号文件（消费完必须删，否则下次循环会重复升级）。 */
  clearSignal(): Promise<void>

  /** 记一条负样本到 brain.db-supervisor。 */
  recordRestart(reason: RestartReason, detail: Record<string, unknown>): void

  /**
   * 重启 DSH。signal 不为 null 时表示计划内升级，需要先替换补丁文件。
   * 顺序必须是：杀进程（释放文件锁）→ 拷补丁 → 拉起。
   */
  restart(signal: UpdateSignal | null, reason: RestartReason): Promise<void>

  /** 睡眠。注入以便测试跳过真实等待。 */
  sleep(ms: number): Promise<void>

  /** 日志。 */
  log(message: string): void
}

/** startWatchdog 返回的句柄。 */
export interface WatchdogHandle {
  /** 请求停止。不会中断正在进行的重启。 */
  stop(): void

  /** 主循环已退出时 resolve。 */
  readonly done: Promise<void>
}
