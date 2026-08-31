/**
 * M5：scope → 真实技能 的确定性映射。
 *
 * 背景（进化闭环的最后一个语义缺口）：
 *   引擎按"失败 scope"产出提议，target 直接填 scope（如 e2e-engine-drill）。
 *   但真实技能是 $DSH_HOME/skills/*.md，id 是文件名。scope ≠ 技能 id 时，
 *   patch-skill 永远找不到目标技能，只能诚实落台账、改不到任何技能 md。
 *
 * 设计原则（与项目公理一致）：
 *   - 映射是**确定性的、代码层的**，不交给弱模型猜（A3：可判定性，查表不调 LLM）。
 *   - 三层解析，命中即停：① scope 本身就是真实技能 id；② 显式映射表
 *     evolve-scope-map.json；③ token Jaccard 模糊匹配技能 id。
 *   - 三层都失败 → 返回 null：patch-skill 保持原始 scope（落台账诚实降级），
 *     add-skill 视为合法新技能 id（保留）。绝不伪造一个技能去落地。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/scope-map
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 技能目录里"算一个技能"的判断（与 FileSkillSink 一致：.md 且非下划线库文件）。 */
function isSkillFile(f: string): boolean {
  return f.endsWith('.md') && !f.startsWith('_')
}

/** 读 $DSH_HOME/skills 下所有真实技能 id（去 .md 后缀）。 */
export function listSkillIds(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir).filter(isSkillFile).map(f => f.replace(/\.md$/, ''))
}

/**
 * 读 evolve-scope-map.json（位于 $DSH_HOME）。不存在/非法 → 空 map。
 * 格式：{ "<scope>": "<skillId>", ... }。value 允许带 `skill:` 前缀（自动去）。
 */
export function loadScopeMap(home: string): Map<string, string> {
  const p = join(home, 'evolve-scope-map.json')
  if (!existsSync(p)) return new Map()
  try {
    const obj = JSON.parse(readFileSync(p, 'utf8')) as unknown
    const m = new Map<string, string>()
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'string' && v) m.set(k, v.replace(/^skill:/, ''))
      }
    }
    return m
  } catch {
    return new Map()
  }
}

/** 传给引擎与解析器的技能世界快照。 */
export interface ScopeMap {
  /** 显式 scope -> skillId（来自 evolve-scope-map.json）。 */
  readonly explicit: ReadonlyMap<string, string>
  /** 真实技能 id 清单（来自 $DSH_HOME/skills/*.md）。 */
  readonly skillIds: ReadonlyArray<string>
}

/** 去掉 `skill:` 前缀并清理空白。 */
function stripPrefix(s: string): string {
  return s.replace(/^skill:/, '').trim()
}

/** 按非字母数字分隔符切 token（中文不做细粒度切分，整体当一个 token）。 */
function tokenize(x: string): Set<string> {
  return new Set(x.split(/[\s_\-]+/).filter(t => t.length > 0))
}

/**
 * 模糊匹配：在候选 id 里找与 scope token Jaccard ≥ 0.5 的最佳者。
 * 仅作兜底；真实场景里 scope 要么直接是技能 id，要么在显式映射表里。
 */
function fuzzyBest(scope: string, ids: readonly string[]): string | null {
  const ts = tokenize(scope)
  if (ts.size === 0) return null
  let best: string | null = null
  let bestScore = 0.5 // 阈值：低于 0.5 视为不可信，宁可不改
  for (const id of ids) {
    const ti = tokenize(id)
    if (ti.size === 0) continue
    let inter = 0
    for (const t of ts) if (ti.has(t)) inter++
    const union = ts.size + ti.size - inter
    const score = union > 0 ? inter / union : 0
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

/**
 * 把 scope 解析成真实技能 id。
 * @returns 真实技能 id；无法解析返回 null（调用方据 kind 决定诚实降级或保留为新技能）。
 */
export function resolveScope(scope: string, map: ScopeMap): string | null {
  const s = stripPrefix(scope)
  if (!s) return null
  // ① scope 本身即真实技能 id
  if (map.skillIds.includes(s)) return s
  // ② 显式映射
  const ex = map.explicit.get(s)
  if (ex) return ex // 允许映射到已存在技能，或指向一个待新建技能 id
  // ③ 模糊兜底
  return fuzzyBest(s, map.skillIds)
}

/** 提议条目的中间形态（引擎/分析器产出，落库前经此解析 target）。 */
export interface ResolvableItem {
  kind: string
  target: string
  id: string
  details: string
  rationale: string
}

/**
 * M5：scope → 真实技能 的解析器。返回非 null 时，提议 target 会被改写为该真实技能 id。
 * 返回 null 表示无法解析（patch-skill 保持原始 scope 诚实落台账；add-skill 视为新技能）。
 */
export type ScopeResolver = (scope: string) => string | null

/**
 * 把一组提议条目的 target 确定性改写为真实技能 id（若 resolver 能解析）。
 * 引擎/分析器产出的 target 是原始 scope（如 e2e-engine-drill）；落库前统一改写，
 * 使 patch-skill 落到真实技能 md。resolver 返回 null 时保持原样。
 */
export function applyScopeResolution(
  items: readonly ResolvableItem[],
  resolver: ScopeResolver,
): ResolvableItem[] {
  return items.map(it => {
    let target = it.target
    let id = it.id
    const resolved = resolver(it.target)
    if (resolved) {
      target = resolved
      id = `skill:${resolved}`
    }
    return { kind: it.kind, target, id, details: it.details, rationale: it.rationale }
  })
}
