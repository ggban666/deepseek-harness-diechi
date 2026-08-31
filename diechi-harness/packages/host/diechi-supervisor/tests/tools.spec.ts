/**
 * diechi-supervisor tools 集成测试：5 个 model-facing 工具的注册 + 行为。
 *
 * 每个测试独立 tmp 目录（SQLite WAL 锁导致跨测试共享 dir 删除会失败）。
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'
import { registerSupervisorTools } from '../src/tools.ts'

function newEnv() {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-tools-'))
  const db = SupervisorDb.open(tmp, 'supervisor.db')
  const service = new SupervisorService({} as never, db)
  const cleanup = () => {
    try { db.close() } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return { tmp, db, service, cleanup }
}

function stubCtx() {
  return {
    tools: {
      register: (_tool: { name: string }) => () => {},
    },
  }
}

describe('diechi-supervisor / tools', () => {
  it('registers exactly 7 tools with the expected names', () => {
    const { service, cleanup } = newEnv()
    try {
      const seen: string[] = []
      const ctx = {
        tools: {
          register: (tool: { name: string }) => {
            seen.push(tool.name)
            return () => {}
          },
        },
      }
      const unreg = registerSupervisorTools(ctx as never, service)
      expect(seen).toEqual([
        'supervisor_list_negative_samples',
        'supervisor_freeze_rule',
        'supervisor_authorize_scope',
        'supervisor_revoke_authorization',
        'supervisor_review_proposal',
        'supervisor_signal_update_ready',
        'supervisor_record_signal',
      ])
      unreg()
    } finally {
      cleanup()
    }
  })

  it('authorize / freeze / revoke via service work end-to-end', () => {
    const { db, service, cleanup } = newEnv()
    try {
      service.authorizeScope('test:scope', 'human')
      expect(db.getAuthorization('test:scope')).toBeDefined()
      service.freezeRule('test:scope', 'unit test freeze', 'human')
      expect(db.getFrozenRule('test:scope')).toBeDefined()
      expect(service.revokeAuthorization('test:scope')).toBe(true)
      expect(db.getAuthorization('test:scope')).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('listNegativeSamples returns the deny sample after a decision', () => {
    const { service, cleanup } = newEnv()
    try {
      service.decide({ scope: 'test:never-authorized', payload: { x: 1 }, source: 'unit-test' })
      const samples = service.listNegativeSamples(10)
      expect(samples.length).toBeGreaterThan(0)
      const found = samples.find((s) => s.scope === 'test:never-authorized')
      expect(found).toBeDefined()
      expect(found?.decision).toBe('deny')
      expect(found?.reason).toBe('no-authorization')
    } finally {
      cleanup()
    }
  })

  it('unregister is a callable disposer', () => {
    const { service, cleanup } = newEnv()
    try {
      const unreg = registerSupervisorTools(stubCtx() as never, service)
      expect(typeof unreg).toBe('function')
      expect(() => unreg()).not.toThrow()
      // 多次调不抛
      expect(() => unreg()).not.toThrow()
    } finally {
      cleanup()
    }
  })

  it('M3：record_signal 工具 —— user-undo 同时写正样本与 user-rework 负样本', async () => {
    const { service, db, cleanup } = newEnv()
    try {
      const tools = new Map<string, { execute: (a: never) => unknown }>()
      const ctx = {
        tools: {
          register: (tool: { name: string; execute: (a: never) => unknown }) => {
            tools.set(tool.name, tool)
            return () => {}
          },
        },
      }
      const unreg = registerSupervisorTools(ctx as never, service)
      const tool = tools.get('supervisor_record_signal')
      expect(tool).toBeDefined()
      // 非法 signal 被挡住，不写库
      const bad = await tool?.execute({ scope: 'test:tool', signal: 'nope' } as never)
      expect(bad).toMatchObject({ ok: false })
      // 合法返工信号：正样本 + 负样本双写
      const ok = await tool?.execute({ scope: 'test:tool', signal: 'user-undo' } as never)
      expect(ok).toMatchObject({ ok: true })
      const neg = service.listNegativeSamples(10).find(s => s.reason === 'user-rework')
      expect(neg?.scope).toBe('test:tool')
      expect(db.listPositiveSamples(10).length).toBeGreaterThan(0)
      unreg()
    } finally {
      cleanup()
    }
  })

  it('service with no frozen rules / no auth → all decide() return deny', () => {
    const { service, cleanup } = newEnv()
    try {
      const r1 = service.decide({ scope: 'a', payload: {} })
      const r2 = service.decide({ scope: 'b', payload: {} })
      expect(r1.decision).toBe('deny')
      expect(r2.decision).toBe('deny')
      const samples = service.listNegativeSamples(100)
      expect(samples.length).toBe(2)
    } finally {
      cleanup()
    }
  })
})
