/**
 * M3：文件型固化库 sink——evolve 提议落地到 diechi-home/skills/ 下的 md 文件。
 *
 * 边界（公理直接后果）：
 * - **只写 md，永不改代码**——patch-skill / add-skill 的全部副作用都发生在技能文档里；
 * - **A1 单调性**：补丁只追加不覆盖（patchSkill 永不重写原正文），删除=标记 superseded；
 * - **诚实落盘**：每个写入都带 proposal 来源标记，审计可直接追溯到 proposals 行。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/sink
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CapabilitySink } from './service.ts'

/** 把任意 id 清洗成安全文件名片段。 */
function safeSlug(id: string): string {
  return (id || 'unnamed').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64) || 'unnamed'
}

export class FileSkillSink implements CapabilitySink {
  private readonly skillsDir: string

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true })
    }
  }

  /** 全部技能文件（不含下划线开头的库文件）。 */
  private listSkillFiles(): string[] {
    if (!existsSync(this.skillsDir)) return []
    return readdirSync(this.skillsDir).filter(f => f.endsWith('.md') && !f.startsWith('_'))
  }

  /** 按 frontmatter name 或文件名定位技能文件。 */
  private locateSkill(id: string): string | undefined {
    const bare = id.replace(/^skill:/, '')
    const files = this.listSkillFiles()
    for (const f of files) {
      if (f.replace(/\.md$/, '') === safeSlug(bare)) return join(this.skillsDir, f)
    }
    for (const f of files) {
      try {
        const head = readFileSync(join(this.skillsDir, f), 'utf8').slice(0, 800)
        if (new RegExp(`^name:\\s*${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(head)) {
          return join(this.skillsDir, f)
        }
      } catch {
        // 读不动就跳过
      }
    }
    return undefined
  }

  /** 追加一条带来源标记的补丁段落；同时把 frontmatter version 升一个 minor。 */
  patchSkill(id: string, patch: string): void {
    const file = this.locateSkill(id)
    if (file === undefined) {
      // 目标技能不存在：落进台账，不假装成功（诚实原则）
      this.ledger(`patch-skill 落空：技能 ${id} 不存在。原补丁内容：\n${patch}`)
      return
    }
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const pid = /proposal #(\d+)/.exec(patch)?.[1] ?? 'unknown'
    const section = `\n## Evolve 补丁 · ${ts}（proposal #${pid}）\n\n${patch.trim()}\n\n> 回退方式：删除本段落即可；原技能正文未改动（A1 只增不减）。\n`
    appendFileSync(file, section, 'utf8')
    this.bumpVersion(file)
  }

  addSkill(id: string, details: string): void {
    const slug = safeSlug(id.replace(/^skill:/, ''))
    const file = join(this.skillsDir, `${slug}.md`)
    if (existsSync(file)) {
      // 已存在 → 等价于一次补丁
      this.patchSkill(id, details)
      return
    }
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const md = [
      '---',
      `name: ${slug}`,
      `title: ${slug}`,
      `description: ${details.slice(0, 160)}`,
      'kind: text',
      'version: 0.1.0',
      'tags: evolve, 固化',
      '---',
      '',
      '## I — 方法论骨架',
      details,
      '',
      `> 由 evolve 固化于 ${ts}（A1：固化库只增不减，删除=标记 superseded）`,
      '',
    ].join('\n')
    writeFileSync(file, md, 'utf8')
  }

  addCase(id: string, details: string): void {
    this.ledger(`add-case ${id}\n${details}`)
  }

  addPrompt(id: string, details: string): void {
    this.ledger(`add-prompt ${id}\n${details}`)
  }

  reRoute(id: string, details: string): void {
    // 路由表变更影响成本（A2），必须人工执行——这里只记录提议内容供 review 后手工应用
    this.ledger(`re-route ${id}（需人工应用路由变更）\n${details}`)
  }

  pruneCache(id: string, details: string): void {
    // 唯一允许删的类型：只记录，实际删除必须过双门后人工执行（A1 红线）
    this.ledger(`prune-cache ${id}（需人工双门确认后执行）\n${details}`)
  }

  /** 演进台账：无法/不宜自动落地的动作全部进 _evolve-ledger.md，可审计、不静默。 */
  private ledger(line: string): void {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
    appendFileSync(join(this.skillsDir, '_evolve-ledger.md'), `\n- [${ts}] ${line.replace(/\n/g, '\n  ')}\n`, 'utf8')
  }

  /** frontmatter version 升一个 minor（0.1.0 -> 0.2.0）。 */
  private bumpVersion(file: string): void {
    try {
      const raw = readFileSync(file, 'utf8')
      const bumped = raw.replace(/^version:\s*(\d+)\.(\d+)\.(\d+)/m, (_m, a: string, b: string, c: string) =>
        `version: ${a}.${Number(b) + 1}.${c}`)
      if (bumped !== raw) writeFileSync(file, bumped, 'utf8')
    } catch {
      // 版本号升不了不影响补丁本身
    }
  }
}
