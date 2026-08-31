/**
 * M4 进化引擎接入层单测。
 * 覆盖：schema 校验（合法/非法 kind/缺必填/夹带文本/非 JSON）、提示词组装、
 * 引擎失败兜底（不抛错、返回空数组）、mock 调用端到端落库。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildClusterSummary,
  buildEnginePrompt,
  generateDrafts,
  runEngineAndPropose,
  validateProposals,
} from '../src/engine.ts'
import type { ProposalDraft } from '../src/types.ts'

describe('M4 engine.ts', () => {
  it('validateProposals 接受合法 JSON 提议', () => {
    const raw = JSON.stringify([
      { kind: 'patch-skill', target: 'person-brain:learn', id: 'skill:x', details: '补步骤', rationale: 'r' },
    ])
    const v = validateProposals(raw)
    expect(v).toHaveLength(1)
    expect(v[0].kind).toBe('patch-skill')
  })

  it('validateProposals 拒绝 add-rule（冻结类）与未知 kind', () => {
    const raw = JSON.stringify([
      { kind: 'add-rule', target: 'x', id: 'y', details: 'd' },
      { kind: 'patch-skill', target: 'a', id: 'b', details: 'c' },
      { kind: 'hack', target: 'z', id: 'w', details: 'v' },
    ])
    const v = validateProposals(raw)
    expect(v).toHaveLength(1)
    expect(v[0].kind).toBe('patch-skill')
  })

  it('validateProposals 丢弃缺必填字段的项', () => {
    const raw = JSON.stringify([
      { kind: 'patch-skill', target: '' },
      { kind: 'add-skill', target: 't', id: 'i', details: 'd' },
    ])
    const v = validateProposals(raw)
    expect(v).toHaveLength(1)
    expect(v[0].kind).toBe('add-skill')
  })

  it('validateProposals 容忍夹带前导/尾随文本', () => {
    const raw = 'Here is result: ' + JSON.stringify([
      { kind: 'add-case', target: 't', id: 'i', details: 'd' },
    ]) + ' done'
    const v = validateProposals(raw)
    expect(v).toHaveLength(1)
    expect(v[0].kind).toBe('add-case')
  })

  it('validateProposals 非 JSON 与空输入返回空数组', () => {
    expect(validateProposals('not json at all')).toHaveLength(0)
    expect(validateProposals('')).toHaveLength(0)
    expect(validateProposals(123)).toHaveLength(0)
  })

  it('buildEnginePrompt 含白名单约束与摘要', () => {
    const p = buildEnginePrompt('聚类A', 3)
    expect(p).toContain('patch-skill')
    expect(p).toContain('add-skill')
    expect(p).toContain('聚类A')
    expect(p).toContain('最多 3 条')
    expect(p).not.toContain('add-rule')
  })

  it('generateDrafts 引擎失败返回空数组（不抛错）', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const drafts = await generateDrafts('摘要')
    expect(drafts).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('generateDrafts 把合法引擎输出转成 ProposalDraft', async () => {
    const payload = JSON.stringify([
      { kind: 'patch-skill', target: 'person-brain:learn', id: 'skill:x', details: '补步骤', rationale: '返工多' },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ content: payload }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const drafts = await generateDrafts('摘要')
    expect(drafts).toHaveLength(1)
    const d = drafts[0]
    expect(d.change.kind).toBe('patch-skill')
    expect(d.change.details).toContain('补步骤')
    expect(d.rollbackPlan).toContain('版本化')
    vi.restoreAllMocks()
  })

  it('runEngineAndPropose 引擎不可用时返回 0 且不调用 propose', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'))
    const propose = vi.fn(() => 1)
    const n = await runEngineAndPropose({ propose }, '摘要')
    expect(n).toBe(0)
    expect(propose).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('runEngineAndPropose 有效提议落库并计数', async () => {
    const payload = JSON.stringify([
      { kind: 'patch-skill', target: 't', id: 'i', details: 'd' },
      { kind: 'add-skill', target: 't2', id: 'i2', details: 'd2' },
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ content: payload }), { status: 200 }),
    )
    const calls: ProposalDraft[] = []
    const propose = (draft: ProposalDraft) => {
      calls.push(draft)
      return calls.length
    }
    const n = await runEngineAndPropose({ propose }, '摘要')
    expect(n).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls[0].change.kind).toBe('patch-skill')
    vi.restoreAllMocks()
  })

  it('runEngineAndPropose 空摘要直接返回 0', async () => {
    const n = await runEngineAndPropose({ propose: () => 1 }, '   ')
    expect(n).toBe(0)
  })

  it('buildClusterSummary 按 reason 聚合失败频次', () => {
    const s = buildClusterSummary([
      { id: 1, scope: 'a', reason: 'rework' },
      { id: 2, scope: 'b', reason: 'rework' },
      { id: 3, scope: 'a', reason: 'rework' },
    ])
    expect(s).toContain('rework')
    expect(s).toContain('3 次')
    expect(s).toContain('a、b')
  })

  it('buildClusterSummary 样本不足(<3)返回空串', () => {
    expect(buildClusterSummary([
      { id: 1, scope: 'a', reason: 'x' },
      { id: 2, scope: 'b', reason: 'x' },
    ])).toBe('')
    expect(buildClusterSummary([])).toBe('')
  })
})
