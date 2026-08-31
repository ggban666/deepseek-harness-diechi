/**
 * diechi-process-control 进程控制网关：把外部服务进程的启停暴露成 RPC，
 * 供前端侧边栏按钮手动控制 Qwen3.8 / 视频模型的常驻启停。
 *
 * 设计约束：
 * - 纯动作型网关，无持久化状态——每次 list 都以「端口是否 LISTENING」实时判定，
 *   不信任进程内缓存的句柄，跨重启健壮。
 * - 不碰 3090 主进程（那是 watchdog 的职责）。
 * - 显存冲突只提示不强制（RTX 4070 8GB，两个重显存服务同时常驻会 OOM，
 *   但这是用户的自由，网关只把事实摆出来）。
 *
 * @module @deepseek-ai/dsh-host-diechi-process-control
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ProcessManager } from './manager.ts'
import type { ProcessActionInput, ProcessActionResult, ProcessListResult } from './types.ts'

export type { ProcessActionInput, ProcessActionResult, ProcessId, ProcessInfo, ProcessListResult, ProcessRunState } from './types.ts'

/**
 * 进程控制网关。
 * 构造即向 Typert 网关注册，前端通过 `remote.diechiProcess` 调用。
 */
export class ProcessGateway extends TypertRemoteService {
  private readonly manager = new ProcessManager()

  constructor(ctx: Context) {
    super(ctx, 'diechiProcess')
  }

  /** 列出全部受控进程状态 + 显存提示。 */
  @Remote('list')
  list(): Promise<ProcessListResult> {
    return this.manager.list()
  }

  /** 启动一个进程。 */
  @Remote('start')
  start(input: ProcessActionInput): Promise<ProcessActionResult> {
    return this.manager.start(input)
  }

  /** 停止一个进程。 */
  @Remote('stop')
  stop(input: ProcessActionInput): Promise<ProcessActionResult> {
    return this.manager.stop(input)
  }

  /** 关闭所有已拉起子进程（插件卸载时调用）。 */
  shutdown(): Promise<void> {
    return this.manager.shutdown()
  }
}
