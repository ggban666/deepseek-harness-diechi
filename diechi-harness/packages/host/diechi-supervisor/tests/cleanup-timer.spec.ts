/**
 * P3.12 cleanup timer 集成测试：通过伪造 ctx.effect 注册的 setInterval 不可行（封装了），
 * 改成直接验证 cleanup 逻辑本身的"手动触发"——timer 调度由 cordis 负责；
 * 我们已经验证 apply() 调用 setInterval + unref（被 vitest 接受为 noop）。
 *
 * 验证 SupervisorService.cleanupNegativeSamples + EvolveService.cleanup 在"被定时器调用"语义下行为正确：
 * 1) 定时器触发不抛错
 * 2) 定时器触发后负样本/proposals 表正确清理
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'
import { EvolveDb } from '../../diechi-evolve/src/db.ts'
import { EvolutionService } from '../../diechi-evolve/src/service.ts'

describe('P3.12 cleanup timer 行为（手动模拟）', () => {
  it('timer 触发清理负样本（模拟 1 次 tick）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-p312-'))
    try {
      const supDb = SupervisorDb.open(tmp, 'sup.db')
      const service = new SupervisorService({} as never, supDb)
      for (let i = 1; i <= 100; i += 1) {
        supDb.insertNegativeSample('test:tick', `{"i":${i}}`, 'deny', 'no-auth', 'unit-test')
      }
      // 模拟 timer tick：调一次 cleanup
      const removed = service.cleanupNegativeSamples(20)
      expect(removed).toBe(80)
      expect(supDb.listNegativeSamples(100).length).toBe(20)
      supDb.close()
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  it('timer 触发清理 proposals（模拟 1 次 tick）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-p312-'))
    try {
      const supDb = SupervisorDb.open(tmp, 'sup.db')
      const evoDb = EvolveDb.open(tmp, 'sup.db')
      const service = new EvolutionService({} as never, evoDb, {
        listNegativeSamples: () => [],
        freezeRule: () => undefined,
        authorizeScope: () => undefined,
        revokeAuthorization: () => false,
      })
      // 写 10 条 proposals（5 pending + 5 decided）
      for (let i = 0; i < 10; i += 1) {
        const id = service.propose({
          target: `test:tick-${i}`,
          change: { kind: 'add-rule', id: `test:tick-${i}.policy.r`, details: 'r' },
          evidence: [],
          rationale: 'r',
          rollbackPlan: 'r',
        })
        if (i < 5) service.reviewProposal(id, 'denied')
      }
      // 模拟 timer tick：调一次 cleanup
      const removed = service.cleanup()
      expect(removed).toBe(0)  // 10 行都保留（pending 5 + decided 5 < keepPending=250 / keepDecided=250）
      expect(service.listAll(20).length).toBe(10)
      supDb.close()
      evoDb.close()
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })
})
