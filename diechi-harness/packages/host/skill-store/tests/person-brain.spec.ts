/**
 * 人格大脑（PersonBrain）单元测试：记忆与知识的写入/检索/生命周期。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshHomeDir, PersonBrain } from '../src/person-brain.ts'
import { skillSearchAnchors } from '../src/skill-store.ts'

const dirs: string[] = []

function tempBrainDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'person-brain-'))
  dirs.push(dir)
  return dir
}

/**
 * 打开 brain 并注入 all-allow 监督者 stub。
 * 三架构基座保护后，learn/remember 走 gateWrite，缺 ctx.supervision 会抛错。
 * 本测试验证 PersonBrain 的记忆/知识逻辑，不验证监督者闸——
 * 用 stub 让 gateWrite 放行（与 diechi-brain/gateway.spec 同模式）。
 */
function openBrain(dir: string): PersonBrain {
  const brain = PersonBrain.open(dir)
  brain.setSupervisionContext({
    decide: () => ({ decision: 'allow' }),
    recordDeny: () => 0,
    recordFlag: () => 0,
  })
  return brain
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})


describe('skillSearchAnchors', () => {
  it('取最新知识主题作为联网搜索锚点：去前缀、去重、最新优先', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.learn('实操：电路焊接', '焊接温度 360 度')
    brain.learn('对话：焊接手法', '左手送丝，焊枪角度 45 度')
    brain.learn('焊接安全', '作业必须戴护目镜')
    // 同一主题再学习 → 更新 updated_at，应排最前
    brain.learn('电路焊接', '焊接温度 380 度，速度 2cm/s')

    const anchors = skillSearchAnchors(brain)
    expect(anchors[0]).toBe('电路焊接')
    expect(anchors).toContain('焊接手法')
    expect(anchors).toContain('焊接安全')
    // 归一化后无重复（实操：电路焊接 与 电路焊接 只保留一个）
    expect(new Set(anchors).size).toBe(anchors.length)
    expect(anchors.some(a => a.startsWith('实操：'))).toBe(false)
    expect(anchors.some(a => a.startsWith('对话：'))).toBe(false)
    brain.close()
  })
})

describe('PersonBrain', () => {
  it('创建 brain.db 并写入/检索记忆', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
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

  it('完全相同的记忆永久去重（跨时间）', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.remember('用户名字叫小蝶', 'fact', 1)
    brain.remember('用户名字叫小蝶', 'fact', 4)
    const rows = brain.recall('', 10)
    expect(rows.length).toBe(1)
    expect(rows[0]?.importance).toBe(4)
    brain.close()
  })

  it('高度相似的记忆自动合并（口语差异容忍）', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.remember('用户名字叫小蝶，喜欢简洁的回复', 'fact', 3)
    // 变体说法：去口语后相同 → 并入既有行，不新增
    brain.remember('用户名叫小蝶，喜欢简洁的回复', 'fact', 1)
    const rows = brain.recall('', 10)
    expect(rows.length).toBe(1)
    expect(rows[0]?.content).toContain('小蝶')
    expect(rows[0]?.importance).toBe(3)
    brain.close()
  })

  it('「名字叫」与「名字是」归一化后合并', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.remember('用户名字叫小蝶', 'fact', 1)
    brain.remember('用户名字是小蝶', 'fact', 2)
    const rows = brain.recall('', 10)
    expect(rows.length).toBe(1)
    expect(rows[0]?.importance).toBe(2)
    brain.close()
  })

  it('不同记忆不误合并（颜色/地点等语义差异）', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.remember('用户喜欢蓝色', 'fact', 1)
    brain.remember('用户喜欢墨绿色', 'fact', 1)
    brain.remember('用户住在杭州西湖边', 'fact', 1)
    expect(brain.recall('', 10).length).toBe(3)
    brain.close()
  })

  it('数字/编号不同的记忆不合并', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.remember('记忆条目 0', 'semantic', 1)
    brain.remember('记忆条目 1', 'semantic', 1)
    expect(brain.recall('', 10).length).toBe(2)
    brain.close()
  })

  it('知识按主题幂等 upsert', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.learn('8d-method', 'D0-D8 八步法：准备/团队/描述/围堵/根因/纠正/验证/预防')
    brain.learn('8d-method', '更新后的 8D 内容')
    const rows = brain.recallKnowledge('8d-method')
    expect(rows.length).toBe(1)
    expect(rows[0]?.content).toBe('更新后的 8D 内容')
    brain.close()
  })

  it('limit 与 LIKE 转义', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    for (let i = 0; i < 5; i += 1) brain.remember(`记忆条目 ${i}`, 'semantic')
    expect(brain.recall('', 3).length).toBe(3)
    expect(brain.recall('记忆条目', 50).length).toBe(5)
    expect(brain.recall('%').length).toBe(0) // 通配符被转义，不匹配
    brain.close()
  })

  it('close 后读写抛错', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
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
      brain.setSupervisionContext({
        decide: () => ({ decision: 'allow' }),
        recordDeny: () => 0,
        recordFlag: () => 0,
      })
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

  it('主题高度相似时自动合并到已有条目，不新增重复（主脑 merge=true）', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.learn('对话：手机贴膜步骤', '先清洁屏幕，再对准贴膜，最后排气泡。', '实操', 'conversation', false, true)
    // 相似主题（同领域，正文高度重叠）→ 合并进旧条目
    brain.learn('对话：给手机贴膜', '先清洁屏幕，再对准贴膜，最后排气泡。', '实操,技巧', 'conversation', false, true)
    const rows = brain.recallKnowledge('')
    expect(rows.length).toBe(1)
    expect(rows[0]?.topic).toBe('对话：手机贴膜步骤')
    expect(rows[0]?.tags).toContain('技巧')
    brain.close()
  })

  it('人格归位写入（merge=false）不合并，只精确 upsert', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.learn('对话：手机贴膜步骤', '先清洁屏幕，再对准贴膜，最后排气泡。', '实操', 'conversation')
    // 人格大脑写入：即使相似也不合并，保持与主脑一致（主脑已合并过）
    brain.learn('对话：给手机贴膜', '先清洁屏幕，再对准贴膜，最后排气泡。', '实操,技巧', 'conversation')
    expect(brain.recallKnowledge('').length).toBe(2)
    brain.close()
  })

  it('主题不同且正文无重叠时不合并', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.learn('对话：手机贴膜', '清洁屏幕后对准贴膜。', '实操', 'conversation', false, true)
    brain.learn('对话：烹饪红烧肉', '五花肉焯水后小火慢炖。', '实操', 'conversation', false, true)
    expect(brain.recallKnowledge('').length).toBe(2)
    brain.close()
  })

  it('合并保留原 topic 与状态，正文去重追加', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.learn('实操：电路焊接', '焊接温度 360 度', '实操', 'video', false, true)
    brain.setPracticeMeta('实操：电路焊接', { status: 'assigned', suggestedSkill: 'misc-bin' })
    // 内容包含旧正文 → 保留更长的新正文
    brain.learn('实操：焊接电路板', '焊接温度 360 度，速度 2cm/s', '实操', 'video', false, true)
    const rows = brain.recallKnowledge('')
    expect(rows.length).toBe(1)
    expect(rows[0]?.content).toBe('焊接温度 360 度，速度 2cm/s')
    expect(rows[0]?.status).toBe('assigned')
    expect(rows[0]?.suggestedSkill).toBe('misc-bin')
    brain.close()
  })

  it('自动除幻觉：模式化假数据与猜测式推断被删除', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    brain.remember('用户手机号：13800001111', 'fact', 1, 'user')
    brain.remember('用户可能喜欢蓝色', 'fact', 1, 'user')
    brain.remember('用户名字叫小蝶', 'fact', 2, 'user')
    const scan = brain.scanAndRemoveHallucinations()
    expect(scan.removed).toBe(2)
    const rows = brain.recall('', 10)
    expect(rows.length).toBe(1)
    expect(rows[0]?.content).toContain('小蝶')
    brain.close()
  })

  it('待确认记忆不参与 recall 注入，确认后恢复', () => {
    const dir = tempBrainDir()
    const brain = openBrain(dir)
    const m = brain.remember('用户手机号：13800001111', 'fact', 1, 'user', '', true)
    expect(brain.recall('', 10).length).toBe(0)
    expect(brain.recallPendingMemories().length).toBe(1)
    expect(brain.confirmMemory(m.id)).toBe(true)
    expect(brain.recall('', 10).length).toBe(1)
    brain.close()
  })
})

