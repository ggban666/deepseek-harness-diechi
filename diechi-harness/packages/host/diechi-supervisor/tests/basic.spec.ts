/**
 * diechi-supervisor 最小组件测试：监督者数据库 + 决策流程。
 *
 * 跑法（从 diechi-harness 根目录）：
 *   pnpm vitest run packages/host/diechi-supervisor/tests/basic.test.ts
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'

describe('diechi-supervisor / decision flow', () => {
  let tmp: string
  let db: SupervisorDb
  let service: SupervisorService

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-supervisor-'))
    db = SupervisorDb.open(tmp, 'test.db')
    // 构造一个最小的 stub ctx（service 不真用）
    service = new SupervisorService({} as never, db)
  })

  afterAll(() => {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('no authorization + no frozen rule → deny + reason=no-authorization', () => {
    const result = service.decide({ scope: 'test:unknown-scope', payload: {} })
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('no-authorization')
  })

  it('authorized scope → allow', () => {
    db.insertAuthorization('test:authorized', 'human')
    const result = service.decide({ scope: 'test:authorized', payload: {} })
    expect(result.decision).toBe('allow')
  })

  it('frozen rule → deny + reason=rule-frozen', () => {
    db.insertFrozenRule('test:frozen-scope', 'unit test freeze', 'human')
    const result = service.decide({ scope: 'test:frozen-scope', payload: {} })
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('rule-frozen')
  })

  it('frozen rule wins over authorization', () => {
    db.insertAuthorization('test:conflict', 'human')
    db.insertFrozenRule('test:conflict', 'unit test freeze wins', 'human')
    const result = service.decide({ scope: 'test:conflict', payload: {} })
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('rule-frozen')
  })

  it('revokeAuthorization marks row as revoked', () => {
    db.insertAuthorization('test:to-revoke', 'human')
    expect(db.getAuthorization('test:to-revoke')).toBeDefined()
    const ok = db.revokeAuthorization('test:to-revoke')
    expect(ok).toBe(true)
    expect(db.getAuthorization('test:to-revoke')).toBeUndefined()
  })

  it('listFrozenRules returns inserted rules', () => {
    db.insertFrozenRule('test:list-rule', 'listed', 'human')
    const rules = db.listFrozenRules()
    expect(rules.find((r) => r.id === 'test:list-rule')).toBeDefined()
  })
})
