/**
 * M3 三件套测试：patch-skill 落盘 / golden set 回归门 / 对话路径价值信号。
 *
 * 验证：
 * 1) EvolutionService 产出 patch-skill 提议（返工聚类路径）
 * 2) FileSkillSink.patchSkill 只追加不改原文、version 升 minor、目标不存在落台账
 * 3) reviewProposal('allowed') 在 golden set 低于地板时自动降级 superseded
 * 4) SupervisorService.recordUserSignal：user-undo 同时写正样本 + reason='user-rework' 负样本
 * 5) SupervisorService.runGoldenSet 在真实库上可跑（CBS-v1 三族）
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvolveDb, EvolutionService, FileSkillSink, type SupervisorLike } from '@deepseek-ai/dsh-host-diechi-evolve'
import { SupervisorDb, SupervisorService } from '@deepseek-ai/dsh-host-diechi-supervisor'

function newEnv(golden?: { c: number; passed: number; total: number }) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-m3-'))
  const supDb = SupervisorDb.open(tmp, 'supervisor.db')
  const evoDb = EvolveDb.open(tmp, 'supervisor.db')
  const supervisorService = new SupervisorService({} as never, supDb)
  const skillsDir = join(tmp, 'skills')
  const sink = new FileSkillSink(skillsDir)
  const supervisor: SupervisorLike = {
    listNegativeSamples: limit => supervisorService.listNegativeSamples(limit),
    listPositiveSamples: limit => supervisorService.listPositiveSamples(limit),
    runGoldenSet: golden === undefined
      ? () => supervisorService.runGoldenSet()
      : () => golden,
    freezeRule: (id, reason, frozenBy) => {
      supervisorService.freezeRule(id, reason, frozenBy ?? 'human')
    },
    authorizeScope: (scope, grantedBy) => {
      supervisorService.authorizeScope(scope, grantedBy ?? 'human')
    },
    revokeAuthorization: scope => supervisorService.revokeAuthorization(scope),
  }
  const service = new EvolutionService({} as never, evoDb, supervisor, 'test', sink)
  const cleanup = () => {
    try { supDb.close() } catch { /* ignore */ }
    try { evoDb.close() } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return { tmp, skillsDir, supDb: supervisorService.getDb(), supervisorService, service, sink, cleanup }
}

describe('M3 / patch-skill 提议与落盘', () => {
  it('FileSkillSink.patchSkill：追加补丁段落 + version 升 minor，原文不动', () => {
    const { skillsDir, cleanup } = newEnv()
    try {
      const file = join(skillsDir, 'demo-skill.md')
      writeFileSync(file, '---\nname: demo-skill\ntitle: 演示\nversion: 0.1.0\n---\n## I — 方法论骨架\n原始正文\n', 'utf8')
      const sink = new FileSkillSink(skillsDir)
      sink.patchSkill('skill:demo-skill', '由 proposal #42 落库：把「先备份再操作」写进边界段落')
      const after = readFileSync(file, 'utf8')
      expect(after).toContain('原始正文') // A1：原正文永不动
      expect(after).toContain('## Evolve 补丁')
      expect(after).toContain('proposal #42')
      expect(after).toContain('version: 0.2.0')
      // 二次补丁继续追加
      sink.patchSkill('skill:demo-skill', '由 proposal #43 落库：补第二条边界')
      expect(readFileSync(file, 'utf8')).toContain('proposal #43')
    } finally {
      cleanup()
    }
  })

  it('FileSkillSink.patchSkill：目标技能不存在 → 落台账不假装成功', () => {
    const { skillsDir, cleanup } = newEnv()
    try {
      const sink = new FileSkillSink(skillsDir)
      sink.patchSkill('skill:ghost', '由 proposal #7 落库：补丁内容')
      const ledger = readFileSync(join(skillsDir, '_evolve-ledger.md'), 'utf8')
      expect(ledger).toContain('patch-skill 落空')
      expect(ledger).toContain('proposal #7')
    } finally {
      cleanup()
    }
  })

  it('返工率低的 scope 会产出 patch-skill 提议（analyzeSamples 路径）', () => {
    const { supervisorService, service, cleanup } = newEnv()
    try {
      // 8 次返工、1 次采纳 → rate = 1/9 ≈ 0.11 ≤ 0.5
      for (let i = 0; i < 8; i += 1) supervisorService.recordSignal('test:rework', 'user-undo')
      supervisorService.recordSignal('test:rework', 'accepted')
      const ids = service.analyzeSamples()
      expect(ids.length).toBeGreaterThan(0)
      const rows = service.listAll(20)
      expect(rows.some(r => r.change.includes('patch-skill'))).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe('M3 / golden set 回归门', () => {
  it('allowed 提议在 golden set 低于地板时自动降级 superseded', () => {
    const { service, cleanup } = newEnv({ c: 0.2, passed: 2, total: 10 })
    try {
      const id = service.propose({
        target: 'test:gate',
        change: { kind: 'add-rule', id: 'test:gate', details: '测试冻结' },
        evidence: [1, 2],
        rationale: 'test',
        rollbackPlan: 'revoke',
        estimatedDc: 0,
        estimatedDk: 0,
        needsHumanConfirm: true,
      })
      const review = service.reviewProposal(id, 'allowed')
      expect(review.status).toBe('superseded')
      expect(review.goldenSet?.c).toBe(0.2)
      expect(review.rejectedReason).toContain('golden set')
    } finally {
      cleanup()
    }
  })

  it('golden set 达标 → 正常 allowed 并落副作用', () => {
    const { service, cleanup, skillsDir } = newEnv({ c: 0.75, passed: 30, total: 40 })
    try {
      const id = service.propose({
        target: 'test:ok',
        change: { kind: 'add-skill', id: 'skill:from-proposal', details: '固化一个新技能' },
        evidence: [3],
        rationale: 'test',
        rollbackPlan: 'superseded',
        estimatedDc: 0.04,
        estimatedDk: -0.05,
      })
      const review = service.reviewProposal(id, 'allowed')
      expect(review.status).toBe('allowed')
      expect(review.goldenSet?.c).toBe(0.75)
      // sink 真落盘：skills/from-proposal.md 出现
      expect(readFileSync(join(skillsDir, 'from-proposal.md'), 'utf8')).toContain('固化一个新技能')
    } finally {
      cleanup()
    }
  })

  it('真实库上 runGoldenSet 可跑（CBS-v1）', () => {
    const { supervisorService, cleanup } = newEnv()
    try {
      const gs = supervisorService.runGoldenSet()
      expect(gs.total).toBeGreaterThan(0)
      expect(gs.c).toBeGreaterThanOrEqual(0)
      expect(gs.c).toBeLessThanOrEqual(1)
    } finally {
      cleanup()
    }
  })
})

describe('M3 / 对话路径价值信号', () => {
  it('user-undo 同时写正样本与 reason=user-rework 负样本', () => {
    const { supervisorService, cleanup } = newEnv()
    try {
      const r = supervisorService.recordUserSignal('test:dialogue', 'user-undo', { payload: { q: 'x' } })
      expect(r.positiveId).toBeGreaterThan(0)
      expect(r.negativeId).not.toBeNull()
      const negatives = supervisorService.listNegativeSamples(10)
      const hit = negatives.find(n => n.reason === 'user-rework')
      expect(hit).toBeDefined()
      expect(hit?.scope).toBe('test:dialogue')
      // 采纳类不写负样本
      const r2 = supervisorService.recordUserSignal('test:dialogue', 'accepted')
      expect(r2.negativeId).toBeNull()
    } finally {
      cleanup()
    }
  })
})
