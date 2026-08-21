/**
 * 人格大脑（PersonBrain）单元测试：记忆与知识的写入/检索/生命周期。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshHomeDir, PersonBrain } from '../src/person-brain.ts'

const dirs: string[] = []

function tempBrainDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'person-brain-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('PersonBrain', () => {
  it('创建 brain.db 并写入/检索记忆', () => {
    const dir = tempBrainDir()
    const brain = PersonBrain.open(dir)
    expect(existsSync(join(dir, 'brain.db'))).toBe(true)

    const a = brain.remember('用户偏好：喜欢简短回答', 'fact', 3)
    const b = brain.remember('今天聊了 8D 报告模板', 'episodic', 1)
    expect(a.id).toBeGreaterThan(0)
    expect(a.kind).toBe('fact')
    expect(a.importance).toBe(3)
    expect(b.content).toContain('8D')

    const hits = brain.recall('偏好', 10)
    expect(hits.length).toBe(1)
    expect(hits[0]?.content).toContain('用户偏好')

    const recent = brain.recall('', 10)
    expect(recent.length).toBe(2)
    // 重要性更高的 fact 排前面
    expect(recent[0]?.kind).toBe('fact')

    brain.close()
  })

  it('知识按主题幂等 upsert', () => {
    const dir = tempBrainDir()
    const brain = PersonBrain.open(dir)
    brain.learn('8d-method', 'D0-D8 八步法：准备/团队/描述/围堵/根因/纠正/验证/预防')
    brain.learn('8d-method', '更新后的 8D 内容')
    const rows = brain.recallKnowledge('8d-method')
    expect(rows.length).toBe(1)
    expect(rows[0]?.content).toBe('更新后的 8D 内容')
    brain.close()
  })

  it('limit 与 LIKE 转义', () => {
    const dir = tempBrainDir()
    const brain = PersonBrain.open(dir)
    for (let i = 0; i < 5; i += 1) brain.remember(`记忆条目 ${i}`, 'semantic')
    expect(brain.recall('', 3).length).toBe(3)
    expect(brain.recall('记忆条目', 50).length).toBe(5)
    expect(brain.recall('%').length).toBe(0) // 通配符被转义，不匹配
    brain.close()
  })

  it('close 后读写抛错', () => {
    const dir = tempBrainDir()
    const brain = PersonBrain.open(dir)
    brain.close()
    expect(() => brain.remember('x')).toThrow(/closed/)
    expect(() => brain.recall('x')).toThrow(/closed/)
  })

  it('openGlobal 落在 $DSH_HOME/brain.db，实操知识带标签', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    dirs.push(home)
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      expect(dshHomeDir()).toBe(home)
      const brain = PersonBrain.openGlobal()
      expect(brain.path).toBe(join(home, 'brain.db'))
      expect(existsSync(brain.path)).toBe(true)
      brain.learn('实操：手机贴膜', '第1步…第2步…', '实操')
      const rows = brain.recallKnowledge('', '实操')
      expect(rows.length).toBe(1)
      expect(rows[0]?.tags).toContain('实操')
      expect(rows[0]?.topic).toContain('手机贴膜')
      brain.close()
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})
