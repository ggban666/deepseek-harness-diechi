/**
 * diechi-supervisor 集成测试：PersonBrain + 监督者真实交互。
 *
 * 每个测试独立 tmp 目录（SQLite WAL 锁导致跨测试共享 dir 删除会失败）。
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonBrain } from '@deepseek-ai/dsh-host-skill-store'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'

/** 给一个测试创建一个独立 tmp dir + 一对 (db, service) 实例，调用方负责 cleanup。 */
function newEnv(): { tmp: string; db: SupervisorDb; service: SupervisorService; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-int-'))
  const db = SupervisorDb.open(tmp, 'supervisor.db')
  const service = new SupervisorService({} as never, db)
  const cleanup = () => {
    try {
      db.close()
    } catch {
      // 忽略
    }
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // WAL 文件可能被锁，忽略
    }
  }
  return { tmp, db, service, cleanup }
}

describe('diechi-supervisor / integration with PersonBrain', () => {
  it('PersonBrain without supervisor → learn() throws SupervisionMissingError', () => {
    const { tmp, cleanup } = newEnv()
    try {
      const brain = PersonBrain.open(tmp)
      expect(() => brain.learn('test:topic', 'test content', 'unit-test', 'video', false, false))
        .toThrow(/缺少 ctx\.supervision/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('authorized scope → learn() succeeds and writes supervision_decision=allow', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:learn', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      brain.learn('test:topic-a', 'content a', 'unit-test', 'video', false, false)
      const rawDb = (brain as unknown as { db: { prepare: (sql: string) => { get: (topic: string) => unknown } } }).db
      const row = rawDb.prepare('SELECT supervision_decision FROM knowledge WHERE topic = ?').get('test:topic-a') as
        | { supervision_decision: string }
        | undefined
      expect(row?.supervision_decision).toBe('allow')
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('frozen rule scope → learn() throws SupervisionDeniedError', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertFrozenRule('person-brain:learn', 'unit test freeze', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      expect(() => brain.learn('test:topic-b', 'content b', 'unit-test', 'video', false, false))
        .toThrow(/监督者拒绝写入/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('unauthorized scope → learn() throws + writes negative_samples', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      expect(() => brain.learn('test:topic-c', 'content c', 'unit-test', 'video', false, false))
        .toThrow(/监督者拒绝写入/)
      const samples = db.listNegativeSamples(10)
      const found = samples.find((s) => s.scope === 'person-brain:learn')
      expect(found).toBeDefined()
      expect(found?.decision).toBe('deny')
      expect(found?.reason).toBe('no-authorization')
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('remember() also goes through gate', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:remember', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      const m = brain.remember('王博 2023 年被工具接住', 'episodic', 3, 'user', 'origin', false)
      expect(m.content).toContain('王博')
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('remember() without supervisor → throws SupervisionMissingError', () => {
    const { tmp, cleanup } = newEnv()
    try {
      const brain = PersonBrain.open(tmp)
      expect(() => brain.remember('test', 'episodic', 1, 'user', 'test', false))
        .toThrow(/缺少 ctx\.supervision/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  // ---- P3.5 蝶擎感知层 ----

  it('seeScene() without supervisor → throws SupervisionMissingError', () => {
    const { tmp, cleanup } = newEnv()
    try {
      const brain = PersonBrain.open(tmp)
      expect(() => brain.seeScene('王博在厨房切菜', 'fp1'))
        .toThrow(/缺少 ctx\.supervision/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('seeScene() with authorized scope → 场景写入 + 合并计数', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:see-scene', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      // 同指纹 90 秒内合并为同一条 scene
      const s1 = brain.seeScene('王博在厨房切菜', 'fp1')
      const s2 = brain.seeScene('王博在切西红柿', 'fp1')
      expect(s1.id).toBe(s2.id)
      expect(s2.count).toBe(2)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('seeScene() unauthorized → throws SupervisionDeniedError + 负样本落库', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      // 不授权 person-brain:see-scene
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      expect(() => brain.seeScene('敏感内容', 'fp2'))
        .toThrow(/监督者拒绝写入/)
      // 负样本应记录
      const samples = db.listNegativeSamples(10)
      const found = samples.find((s) => s.scope === 'person-brain:see-scene')
      expect(found).toBeDefined()
      expect(found?.decision).toBe('deny')
      expect(found?.reason).toBe('no-authorization')
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('seeScene() with frozen rule → 命中 rule-frozen 拒（与角色无关）', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertFrozenRule('person-brain:see-scene', '视觉流冻结：紧急', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      expect(() => brain.seeScene('王博在吃饭', 'fp3'))
        .toThrow(/监督者拒绝写入/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  // ---- P3.7 世界模型：person-brain:predict ----

  it('predict() without worldModel context → throws', async () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:predict', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      // 不注入 worldModel
      await expect(brain.predict('person-brain:predict', { state: { x: 1 }, lookahead: 3 }))
        .rejects.toThrow(/WorldModelService 未注入/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('P3.10 cleanupNegativeSamples 删除老样本保留最近 N 条', () => {
    const { db, service, cleanup } = newEnv()
    try {
      for (let i = 0; i < 12; i += 1) {
        db.insertNegativeSample('test:cleanup', `{"i":${i}}`, 'deny', 'no-auth', 'unit-test')
      }
      expect(db.listNegativeSamples(20).length).toBe(12)
      const removed = service.cleanupNegativeSamples(5)
      expect(removed).toBe(7)
      expect(db.listNegativeSamples(20).length).toBe(5)
    } finally {
      cleanup()
    }
  })

  it('predict() with worldModel + authorized → 返回推演结果', async () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:predict', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      // 注入启发式世界模型
      const { HeuristicWorldModel } = await import('../../diechi-supervisor/src/world-model.ts')
      brain.setWorldModelContext(new HeuristicWorldModel())
      const out = await brain.predict('person-brain:predict', { state: { x: 1 }, lookahead: 3 })
      expect(out.states).toHaveLength(3)
      expect(out.confidence).toBe(0.1)
      expect(out.modelTag).toBe('heuristic-noop')
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('predict() unauthorized → throws SupervisionDeniedError + 负样本落库', async () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      // 不授权 person-brain:predict
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      const { HeuristicWorldModel } = await import('../../diechi-supervisor/src/world-model.ts')
      brain.setWorldModelContext(new HeuristicWorldModel())
      await expect(brain.predict('person-brain:predict', { state: { x: 1 }, lookahead: 1 }))
        .rejects.toThrow(/监督者拒绝写入/)
      const samples = db.listNegativeSamples(10)
      const found = samples.find((s) => s.scope === 'person-brain:predict')
      expect(found).toBeDefined()
      expect(found?.reason).toBe('no-authorization')
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('predict() frozen rule → throws (与授权无关)', async () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertFrozenRule('person-brain:predict', '世界模型被冻结：上游出问题', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      const { HeuristicWorldModel } = await import('../../diechi-supervisor/src/world-model.ts')
      brain.setWorldModelContext(new HeuristicWorldModel())
      await expect(brain.predict('person-brain:predict', { state: { x: 1 }, lookahead: 1 }))
        .rejects.toThrow(/监督者拒绝写入/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('frozen rule wins over authorization', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:learn', 'test-human')
      db.insertFrozenRule('person-brain:learn', 'frozen wins', 'test-human')
      const brain = PersonBrain.open(tmp)
      service.attachBrain(brain)
      expect(() => brain.learn('test:topic-d', 'content d', 'unit-test', 'video', false, false))
        .toThrow(/监督者拒绝写入/)
      brain.close()
    } finally {
      cleanup()
    }
  })

  it('multiple PersonBrain instances share one supervisor', () => {
    const { tmp, db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:learn', 'test-human')
      const brain1 = PersonBrain.open(tmp)
      const brain2 = PersonBrain.open(tmp)
      service.attachBrain(brain1)
      service.attachBrain(brain2)
      brain1.learn('shared:topic-1', 'from brain1', 'unit-test', 'video', false, false)
      brain2.learn('shared:topic-2', 'from brain2', 'unit-test', 'video', false, false)
      brain1.close()
      brain2.close()
    } finally {
      cleanup()
    }
  })
})
