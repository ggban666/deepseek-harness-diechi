/**
 * PersonBrain 角色可互换契约：类型契约由 skill-store 提供（基础类型）
 * + 运行时实现由 diechi-supervisor 提供（见 supervisor/src/role.ts）。
 *
 * 默认角色 'subject'（被升级者）：PersonBrain.learn/remember 走业务写入路径。
 * 临时角色 'designer' / 'supervisor'：由监督者或升级设计者在满足阈值后临时切换。
 *
 * @module @deepseek-ai/dsh-host-skill-store/role
 */

export type AgentRoleId = 'subject' | 'designer' | 'supervisor'

/** swapTo 入参。 */
export interface SwapToInput {
  readonly target: 'designer' | 'supervisor'
  readonly evidence: readonly number[]
  readonly ttlSec?: number
}

/** 互换结果。 */
export interface SwapToResult {
  readonly transitionId: number
  readonly previous: AgentRoleId
  readonly expiresAt: string
}

/** AgentRole Service 接口。 */
export interface AgentRoleService {
  current(): AgentRoleId
  swapTo(input: SwapToInput): Promise<SwapToResult>
  revert(): Promise<void>
  history(limit?: number): readonly {
    readonly id: number
    readonly from_role: AgentRoleId
    readonly to_role: AgentRoleId
    readonly evidence: string
    readonly granted_by: string
    readonly granted_at: string
    readonly expires_at: string
    readonly reverted_at: string | null
    readonly reverted_reason: 'ttl-expired' | 'manual-revert' | 'denied-self-proposal' | null
  }[]
}

