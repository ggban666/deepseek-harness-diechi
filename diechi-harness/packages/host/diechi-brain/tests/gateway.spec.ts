/**
 * 全局大脑（diechi-brain）单元测试：视频实操入库、自动归类建议、
 * 归位到技能、改标签、删除，以及 skillVision 事件自动入库。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { PersonBrain, dshHomeDir } from '@deepseek-ai/dsh-host-skill-store'
import BrainGateway from '../src/index.ts'

const contexts: Context[] = []
const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diechi-brain-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface HarnessSkill {
  id: string
  title: string
  description?: string
  whenToUse?: string
}

async function harness(skills: readonly HarnessSkill[] = []): Promise<{
  ctx: Context
  brain: BrainGateway
  emitVision: (next: { videoProcess?: { at: string; name: string; process: string } }) => void
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  let emitVision: (next: { videoProcess?: { at: string; name: string; process: string } }) => void = () => {}
  ctx.provide('skillStore', {
    get: () => ({ skills }),
  } as never)
  ctx.provide('skillVision', {
    watch: (callback: (next: { videoProcess?: { at: string; name: string; process: string } }) => void) => {
      emitVision = callback
      return () => {}
    },
  } as never)
  await ctx.plugin(BrainGateway)
  const brain = ctx.get('diechiBrain') as BrainGateway
  return { ctx, brain, emitVision }
}

describe('BrainGateway', () => {
  it('ingest 把实操写入 $DSH_HOME/brain.db 并返回收件箱', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain } = await harness()
      const snapshot = brain.ingest({ at: '2026-08-22T10:00:00', name: '手机贴膜', process: '清洁屏幕 → 对齐 → 按压排气' })
      expect(snapshot.items).toHaveLength(1)
      expect(snapshot.items[0]?.topic).toContain('手机贴膜')
      expect(snapshot.items[0]?.tags).toContain('实操')
      expect(snapshot.items[0]?.status).toBe('pending')
      expect(snapshot.items[0]?.suggestedSkill).toBe('')
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('自动归类：过程正文命中技能标题时给出建议归属', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain } = await harness([
        { id: 'phone-film', title: '手机贴膜', description: '给手机贴钢化膜', whenToUse: '需要贴膜时' },
        { id: 'cooking', title: '做饭', description: '家常菜', whenToUse: '做饭时' },
      ])
      const snapshot = brain.ingest({ at: '2026-08-22T10:01:00', name: '实操视频', process: '手机贴膜 清洁屏幕对齐按压' })
      expect(snapshot.items[0]?.suggestedSkill).toBe('phone-film')
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('skillVision videoProcess 事件自动入库并按 at 去重', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain, emitVision } = await harness()
      emitVision({ videoProcess: { at: '2026-08-22T11:00:00', name: '换轮胎', process: '千斤顶顶起 → 拆螺丝 → 换胎' } })
      expect(brain.list().items).toHaveLength(1)
      emitVision({ videoProcess: { at: '2026-08-22T11:00:00', name: '换轮胎', process: '重复事件' } })
      expect(brain.list().items).toHaveLength(1)
      emitVision({})
      expect(brain.list().items).toHaveLength(1)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('assign 把实操归位到指定平权技能的大脑并标记已归位', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain } = await harness()
      brain.ingest({ at: '2026-08-22T12:00:00', name: '修水管', process: '关阀门 → 拆接头 → 换垫圈' })
      const result = brain.assign({ topic: '实操：修水管', skillId: 'plumbing' })
      expect(result.ok).toBe(true)
      const inbox = brain.list().items
      expect(inbox[0]?.status).toBe('assigned')
      expect(inbox[0]?.suggestedSkill).toBe('plumbing')
      const skillBrain = PersonBrain.open(join(dshHomeDir(), 'persons', 'plumbing'))
      try {
        const rows = skillBrain.recallKnowledge('实操：修水管')
        expect(rows.length).toBe(1)
        expect(rows[0]?.content).toContain('关阀门')
      } finally {
        skillBrain.close()
      }
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('assign 空输入与未知主题返回错误', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain } = await harness()
      expect(brain.assign({ topic: '', skillId: 'x' })).toEqual({ ok: false, error: 'empty-input' })
      expect(brain.assign({ topic: '不存在', skillId: 'x' })).toEqual({ ok: false, error: 'not-found' })
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('setTags 更新标签，remove 删除实操', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain } = await harness()
      brain.ingest({ at: '2026-08-22T13:00:00', name: '拆机', process: '拆后盖 → 断电 → 换电池' })
      const topic = '实操：拆机'
      expect(brain.setTags({ topic, tags: '维修, 电池' })).toBe(true)
      expect(brain.list().items[0]?.tags).toContain('维修')
      expect(brain.removeItem({ topic })).toBe(true)
      expect(brain.list().items).toHaveLength(0)
      expect(brain.setTags({ topic: '', tags: 'x' })).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('confirm 解除待确认并补归类建议；非待确认条目拒绝', async () => {
    const home = tempHome()
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { brain } = await harness([
        { id: 'birthday', title: '用户信息', description: '生日、喜好等个人资料', whenToUse: '需要个人资料时' },
      ])
      // 模拟低置信度归纳：直接写入带待确认标记的知识。
      const global = PersonBrain.openGlobal()
      global.learn('对话：用户生日', '用户生日是 1994 年 3 月 8 日', 'fact', 'conversation', true)
      global.close()
      expect(brain.list().items[0]?.needsReview).toBe(true)

      // 未知主题确认失败。
      expect(brain.confirm({ topic: '不存在' })).toBe(false)
      // 确认成功：待确认解除，建议归属补上。
      expect(brain.confirm({ topic: '对话：用户生日' })).toBe(true)
      const item = brain.list().items[0]
      expect(item?.needsReview).toBe(false)
      expect(item?.suggestedSkill).toBe('birthday')
      // 已确认条目再确认失败（防重复操作）。
      expect(brain.confirm({ topic: '对话：用户生日' })).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})