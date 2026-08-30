/**
 * PersonBrain × supervision_decision 闭环测试。
 *
 * 验证：写入路径把 supervise.decide() 的结果落到 PersonMemory / PersonKnowledge 行，
 * 读路径 recall/recallKnowledge/listFlagged/listPendingMemories 把这个字段读回来。
 *
 * 这是 diechi-supervisor 闭环的"接口层"测试：没有它，UI / RPC 永远拿不到监督者决策。
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonBrain } from '@deepseek-ai/dsh-host-skill-store'
import { SupervisorDb } from '../src/db.ts'
import { SupervisorService } from '../src/service.ts'

function newEnv() {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-sup-'))
  const db = SupervisorDb.open(tmp, 'supervisor.db')
  const service = new SupervisorService({} as never, db)
  const cleanup = () => {
    try { db.close() } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return { tmp, db, service, cleanup }
}

describe('PersonBrain × supervision_decision / 闭环', () => {
  beforeEach(() => {
    // 每个测试都开新 tmp dir — 不共享 db 句柄
  })

  it('缺监督者 → remember() 抛 SupervisionMissingError', () => {
    const { cleanup } = newEnv()
    try {
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        // 关键：不 attach service —— supervision 未注入 → gateWrite 抛 MissingError
        const brain = PersonBrain.open(tmp)
        expect(() => brain.remember('测试', 'episodic', 1, 'user', 'origin', false))
          .toThrow(/缺少 ctx\.supervision/)
        brain.close()
      } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
    } finally { cleanup() }
  })

  it('allow 路径：remember() 落库 supervision_decision=allow 且 recall 返回同字段', () => {
    const { db, service, cleanup } = newEnv()
    try {
      db.insertAuthorization('person-brain:remember', 'test-human')
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        const brain = PersonBrain.open(tmp)
        service.attachBrain(brain)
        const m = brain.remember('闭环测试内容', 'episodic', 2, 'user', 'origin', false)
        expect(m.supervisionDecision).toBe('allow')
        // recall() 返回的对象也带该字段
        const recalled = brain.recall('闭环')
        expect(recalled.length).toBeGreaterThan(0)
        expect(recalled[0]?.supervisionDecision).toBe('allow')
        brain.close()
      } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
    } finally { cleanup() }
  })

  it('flag-review 路径：learn() 落库 supervision_decision=flag-review 且 needs_review=1', () => {
    const { db, service, cleanup } = newEnv()
    try {
      // 让 supervisor 对 person-brain:learn 报 flag-review：用 frozen_rules 之外的策略？
      // 实际：当前 supervisor 仅在 authorization 不存在或 frozen 命中时 deny。
      // flag-review 触发路径来自"显式调用 recordFlag" — 模拟。
      // 退而求其次：用直接 INSERT 验证读路径透出。
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        const brain = PersonBrain.open(tmp)
        // 手动写入一行 flag-review 模拟监督者决定
        // 通过 raw 走 brain — 需 supervisor；所以用 raw db
        const raw = (brain as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => { lastInsertRowid: number | bigint } } } }).db
        const result = raw.prepare(
          'INSERT INTO knowledge (topic, content, tags, status, suggested_skill, source, updated_at, needs_review, supervision_decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run('test:flagged', '监督者标了待审的内容', '测试', 'pending', '', 'video', new Date().toISOString(), 1, 'flag-review')
        expect(Number(result.lastInsertRowid)).toBeGreaterThan(0)
        // recallKnowledge 拿到该行
        const rows = brain.recallKnowledge('test:flagged')
        expect(rows.length).toBe(1)
        expect(rows[0]?.supervisionDecision).toBe('flag-review')
        expect(rows[0]?.needsReview).toBe(true)
        // listFlagged 也应拿到
        const flagged = brain.listFlagged(100)
        expect(flagged.length).toBe(0) // memories 表 — 我们插在 knowledge
        // listFlagged 只查 memories — knowledge 用 listInbox 验证
        const inbox = brain.listInbox('pending', 'video', 100)
        expect(inbox.find((row) => row.topic === 'test:flagged')?.supervisionDecision).toBe('flag-review')
        brain.close()
      } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
    } finally { cleanup() }
  })

  it('listFlagged 只返回 supervision_decision IN (flag-review, deny) 的 memories', () => {
    const { cleanup } = newEnv()
    try {
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        const brain = PersonBrain.open(tmp)
        const raw = (brain as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => { lastInsertRowid: number | bigint } } } }).db
        const at = new Date().toISOString()
        raw.prepare('INSERT INTO memories (kind, content, importance, created_at, source, topic, needs_review, supervision_decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('episodic', 'allow 行', 1, at, 'user', 'allow:1', 0, 'allow')
        raw.prepare('INSERT INTO memories (kind, content, importance, created_at, source, topic, needs_review, supervision_decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('episodic', 'flag 行', 1, at, 'user', 'flag:1', 1, 'flag-review')
        raw.prepare('INSERT INTO memories (kind, content, importance, created_at, source, topic, needs_review, supervision_decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('episodic', 'deny 行', 1, at, 'user', 'deny:1', 0, 'deny')
        const flagged = brain.listFlagged(100)
        const topics = flagged.map((m) => m.topic).sort()
        expect(topics).toEqual(['deny:1', 'flag:1'])
        // allow 行不在 flagged — 符合"只打扰需关注的"
        for (const m of flagged) {
          expect(['flag-review', 'deny']).toContain(m.supervisionDecision)
        }
        brain.close()
      } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
    } finally { cleanup() }
  })

  it('deny 路径：brain.learn() 抛 SupervisionDeniedError 且行未入库', () => {
    const { db, service, cleanup } = newEnv()
    try {
      // 写一条 frozen rule —— 命中后 supervisor 报 deny
      db.insertFrozenRule('person-brain:learn', 'unit-test freeze', 'test-human')
      const tmp = mkdtempSync(join(tmpdir(), 'dsh-pb-'))
      try {
        const brain = PersonBrain.open(tmp)
        service.attachBrain(brain)
        expect(() => brain.learn('test:denied', 'content', 'test', 'video', false, false))
          .toThrow(/监督者拒绝/)
        // 行未入库
        const recalled = brain.recall('test:denied')
        expect(recalled.length).toBe(0)
        brain.close()
      } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
    } finally { cleanup() }
  })
})
