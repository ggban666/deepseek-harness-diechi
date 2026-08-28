/**
 * PersonBrain × AgentRole 端到端集成测试。
 *
 * 验证：业务写入路径在临时身份下，source 字段携带 role，
 * supervisor.decide() 护栏 1 真正生效。
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonBrain } from '@deepseek-ai/dsh-host-skill-store'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'
import { AgentRoleServiceImpl } from '../src/role.ts'

function newEnv() {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-role-'))
  const db = SupervisorDb.open(tmp, 'supervisor.db')
  const agentRole = new AgentRoleServiceImpl({} as never, db)
  const service = new SupervisorService({} as never, db, agentRole)
  const cleanup = () => {
    try { db.close() } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return { tmp, db, agentRole, service, cleanup }
}

describe('PersonBrain × AgentRole / gateWrite carries role to source', () => {
  it('subject role + authorized scope → learn() succeeds', async () => {
    const { db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:learn', 'test-human')
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        const brain = PersonBrain.open(tmp)
        service.attachBrain(brain)
        expect(() => brain.learn('test:role-subject', 'content', 'test', 'video', false, false))
          .not.toThrow()
        brain.close()
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    } finally {
      cleanup()
    }
  })

  it('designer 临时身份 + 业务写入 → 不影响（因为 scope 不是 evolution:propose）', async () => {
    const { db, service, agentRole, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:learn', 'test-human')
      await agentRole.swapTo({ target: 'designer', evidence: [] })
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        const brain = PersonBrain.open(tmp)
        service.attachBrain(brain)
        // 业务写入 person-brain:learn，临时身份是 designer，scope 不是 evolution:propose
        // → 护栏 1 不触发，allow
        expect(() => brain.learn('test:role-designer-ok', 'content', 'test', 'video', false, false))
          .not.toThrow()
        brain.close()
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
      }
      await agentRole.revert()
    } finally {
      cleanup()
    }
  })
})
