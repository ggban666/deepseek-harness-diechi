/**
 * P3.6 事件总线测试：SupervisorService.decide() 每次决策后 emit 事件。
 * 验证：
 * 1) decide() 每次都调观察者
 * 2) 观察者抛错不影响主决策
 * 3) event payload 包含 scope / decision / reason / sampleId / at
 * 4) onDecision 返回 disposer，调用后不再 emit
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'

function newEnv() {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-event-'))
  const db = SupervisorDb.open(tmp, 'supervisor.db')
  const service = new SupervisorService({} as never, db)
  const cleanup = () => {
    try { db.close() } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return { tmp, db, service, cleanup }
}

describe('P3.6 supervision/decision event bus', () => {
  it('decide() fires event for deny', () => {
    const { service, cleanup } = newEnv()
    try {
      const events: { scope: string; decision: string; reason: string }[] = []
      service.onDecision((e) => events.push({ scope: e.scope, decision: e.decision, reason: e.reason }))
      service.decide({ scope: 'test:no-auth', payload: {}, source: 'unit-test' })
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ scope: 'test:no-auth', decision: 'deny', reason: 'no-authorization' })
    } finally {
      cleanup()
    }
  })

  it('decide() fires event for allow', () => {
    const { db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('test:auth', 'test-human')
      const events: string[] = []
      service.onDecision((e) => events.push(e.decision))
      service.decide({ scope: 'test:auth', payload: {}, source: 'unit-test' })
      expect(events).toEqual(['allow'])
    } finally {
      cleanup()
    }
  })

  it('observer throwing does not break main decide()', () => {
    const { service, cleanup } = newEnv()
    try {
      const events: string[] = []
      service.onDecision(() => { throw new Error('observer boom') })
      service.onDecision((e) => events.push(e.decision))
      // 第一个观察者抛错应被吞掉，第二个仍执行
      const result = service.decide({ scope: 'test:no-auth', payload: {}, source: 'unit-test' })
      expect(result.decision).toBe('deny')
      expect(events).toEqual(['deny'])
    } finally {
      cleanup()
    }
  })

  it('onDecision disposer removes observer', () => {
    const { service, cleanup } = newEnv()
    try {
      const events: string[] = []
      const dispose = service.onDecision((e) => events.push(e.decision))
      service.decide({ scope: 'test:a', payload: {} })
      dispose()
      service.decide({ scope: 'test:b', payload: {} })
      expect(events).toEqual(['deny'])  // 只有第一次
    } finally {
      cleanup()
    }
  })

  it('multiple observers all fire', () => {
    const { service, cleanup } = newEnv()
    try {
      const a: string[] = []
      const b: string[] = []
      service.onDecision((e) => a.push(e.scope))
      service.onDecision((e) => b.push(e.scope))
      service.decide({ scope: 'test:multi', payload: {} })
      expect(a).toEqual(['test:multi'])
      expect(b).toEqual(['test:multi'])
    } finally {
      cleanup()
    }
  })

  it('event payload includes at (ISO timestamp)', () => {
    const { service, cleanup } = newEnv()
    try {
      let capturedAt = ''
      service.onDecision((e) => { capturedAt = e.at })
      const before = Date.now()
      service.decide({ scope: 'test:ts', payload: {} })
      const after = Date.now()
      // at 是 ISO 字符串，解析后毫秒应在 [before, after] 区间
      const t = Date.parse(capturedAt)
      expect(t).toBeGreaterThanOrEqual(before)
      expect(t).toBeLessThanOrEqual(after)
    } finally {
      cleanup()
    }
  })
})
