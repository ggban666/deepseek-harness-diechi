/**
 * M4 进化引擎接入层 —— 把 llama.cpp 引擎（Qwen3.8-27B-UD-IQ1_S + GBNF）的提议落进 proposals 表。
 *
 * 职责：
 *   1. 读聚类摘要（负样本/体感样本，由调用方聚合好）。
 *   2. HTTP 调本地 llama-server（默认 127.0.0.1:8081，CPU 空闲调度）产出结构化提议。
 *   3. schema 校验（kind 白名单 / 必填字段），坏提议丢弃，绝不带病入库。
 *   4. 把有效提议转成 ProposalDraft，经 EvolutionService.propose() 落库。
 *
 * 铁律（与 Python engine.py 同源）：
 *   - 引擎只做提议器，不做验证器。好坏由 golden set + 人工 review 双门裁决。
 *   - kind 白名单里没有 add-rule——弱模型吐不出"冻结"提议。
 *   - 引擎失败（超时/拒连/输出非法）→ 返回空数组，绝不抛到调用方把主流程打挂。
 *
 * @module @deepseek-ai/dsh-host-diechi-evolve/engine
 */

import type { ProposalDraft } from './types.ts'

/** GBNF 允许的 kind 白名单（与 deploy-tools/evolve/grammar.gbnf 严格一致）。 */
const ALLOWED_KINDS = new Set(['patch-skill', 'add-skill', 'add-case', 'add-prompt'])

/** llama-server 引擎端点。可用 EVOLVE_ENGINE_URL 覆盖。 */
function engineUrl(): string {
  return process.env.EVOLVE_ENGINE_URL ?? 'http://127.0.0.1:8081'
}

/** 引擎输出 -> 结构化提议。校验失败一律丢弃，返回空数组。 */
export function validateProposals(raw: unknown): Array<{
  kind: string
  target: string
  id: string
  details: string
  rationale: string
}> {
  let text = typeof raw === 'string' ? raw : ''
  if (!text) return []
  // 容忍 GBNF 夹带的前导/尾随文本：取第一个 '[' 到最后一个 ']'
  const i = text.indexOf('[')
  const j = text.lastIndexOf(']')
  if (i < 0 || j < i) return []
  text = text.slice(i, j + 1)
  let items: unknown
  try {
    items = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(items)) return []
  // 把 unknown 值安全转成 string（null/undefined/对象一律空串，避免 no-base-to-string）。
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const out: Array<{ kind: string; target: string; id: string; details: string; rationale: string }> = []
  for (const it of items) {
    if (typeof it !== 'object' || it === null) continue
    const o = it as Record<string, unknown>
    const kind = str(o.kind)
    if (!ALLOWED_KINDS.has(kind)) continue
    const target = str(o.target).trim()
    const id = str(o.id).trim()
    const details = str(o.details).trim()
    const rationale = str(o.rationale).trim()
    if (!target || !id || !details) continue
    out.push({ kind, target, id, details, rationale: rationale || '（引擎未给出理由）' })
  }
  return out
}

/** 组装引擎系统提示词（与 Python engine.py 同源）。 */
export function buildEnginePrompt(
  clusterSummary: string,
  maxItems = 3,
  skillCatalog?: readonly string[],
): string {
  const catalogText =
    skillCatalog && skillCatalog.length > 0
      ? '\n可用技能清单（系统会把 scope 确定性映射到这些真实技能 id 之一；写 details 时请针对真实技能的内容）：\n- '
        + skillCatalog.join('\n- ')
        + '\n'
      : ''
  return (
    '你是蝶翅系统的「升级设计者」。读下面的失败场景聚类摘要（含每类失败的具体表现），' +
    '针对每一类提出如何改进现有技能/知识/提示，让同类任务下次一次通过。\n' +
    '要求：\n' +
    '1. 只输出 JSON 数组，不要任何解释性文字，也不要 Markdown 代码块；\n' +
    '2. kind 只能是 patch-skill / add-skill / add-case / add-prompt；\n' +
    '3. target 填失败涉及的 scope（从摘要里取，系统会把它确定性映射到真实技能）；id 填 skill:<scope> 或该技能名；\n' +
    '4. details 必须具体可落地：写明要在该技能的哪一段补什么内容/步骤/检查项，并直接引用摘要里的失败表现；\n' +
    '5. 至少提出 1 条最稳妥的 patch-skill 提议（针对失败表现补一段方法论/检查清单），最多 ' + String(maxItems) + ' 条；\n' +
    '6. 不确定时宁可选最低风险的 patch-skill，也绝不要输出空数组 []。\n' +
    catalogText +
    '\n聚类摘要：\n' + clusterSummary
  )
}

/** 调 llama-server 的 /completion。失败抛错，由调用方兜底。 */
async function completion(prompt: string, maxTokens = 400): Promise<string> {
  const url = engineUrl() + '/completion'
  // 27B 1bit 弱模型约 2-4 tok/s，400 tokens 需 100-200s；超时放宽到 300s 避免被掐断。
  const doReq = async (): Promise<string> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 不带 cache_prompt：summary 每次不同、prompt 极短（eval <1s），缓存零收益，
      // 反而会因 KV 槽复用（f_sim_best=1.000）偶发返回空生成。
      body: JSON.stringify({
        prompt,
        n_predict: maxTokens,
        temperature: 0.2,
        stop: ['<|im_end|>', '<|endoftext|>'],
      }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) throw new Error(`engine HTTP ${res.status}`)
    const data = await res.json() as { content?: string; error?: string }
    if (typeof data.error === 'string' && data.error) throw new Error(`engine error: ${data.error}`)
    return (data.content ?? '').trim()
  }
  let out = await doReq()
  // 偶发空响应（llama.cpp 槽复用 bug）兜底：重试一次，再空才如实返回。
  if (out.length === 0) {
    out = await doReq()
  }
  return out
}

/** 引擎就绪探测。 */
export async function isEngineReady(): Promise<boolean> {
  try {
    const res = await fetch(engineUrl() + '/health', { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 读聚类摘要 -> 产出提议草稿（不落库）。
 * 引擎失败返回空数组。调用方自行决定是否落库。
 */
/**
 * M5 的 applyScopeResolution / ScopeResolver 已迁到 scope-map.ts（叶子模块），
 * 由 EvolutionService.propose() 在落库前统一对所有提议路径做确定性改写。
 * 这里仅做 re-export 维持对外 API 稳定。
 */
export { applyScopeResolution, type ScopeResolver } from './scope-map.ts'

export async function generateDrafts(
  clusterSummary: string,
  maxItems = 3,
  skillCatalog?: readonly string[],
): Promise<ProposalDraft[]> {
  let raw: string
  try {
    raw = await completion(buildEnginePrompt(clusterSummary, maxItems, skillCatalog))
  } catch {
    return []
  }
  const items = validateProposals(raw)
  return items.map(it => ({
    target: it.target,
    change: {
      kind: it.kind as 'patch-skill' | 'add-skill' | 'add-case' | 'add-prompt',
      id: it.id,
      details: it.details,
    },
    evidence: [],
    rationale: it.rationale,
    rollbackPlan: '版本化补丁段落，回退指针即可，原文永不覆盖。',
    estimatedDc: 0.05,
    estimatedDk: 0,
  }))
}

/**
 * 引擎驱动入口：摘要 -> 提议 -> 落库。
 * 返回落库的提议数。引擎不可用/无有效提议返回 0，不抛错。
 * M5：target 的 scope→真实技能 改写在 EvolutionService.propose() 内统一完成。
 */
export async function runEngineAndPropose(
  service: { propose(draft: ProposalDraft): number },
  clusterSummary: string,
  maxItems = 3,
  skillCatalog?: readonly string[],
): Promise<number> {
  if (!clusterSummary.trim()) return 0
  let drafts: ProposalDraft[]
  try {
    drafts = await generateDrafts(clusterSummary, maxItems, skillCatalog)
  } catch {
    return 0
  }
  let n = 0
  for (const d of drafts) {
    try {
      const id = service.propose(d)
      // id <= 0 表示去重命中（未新增），不计入本轮产出
      if (id > 0) n++
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[diechi-evolve] 单条提议落库失败', error)
      // 单条落库失败不阻断其余
    }
  }
  return n
}

/** 负样本行（supervisor 提供的最小接口；payload 可选——带真实失败描述时引擎才有料可提）。 */
export interface NegativeSampleLike {
  readonly id: number
  readonly scope: string
  readonly reason: string
  /** 失败描述文本（负样本的 payload）。引擎路径会从库里读带 payload 的样本。 */
  readonly payload?: string
}

/**
 * 把负样本聚合成引擎可读的文本摘要。
 * 按 reason 分组统计，输出每一类的失败频次、涉及 scope，**以及每条失败的具体表现（payload）**——
 * 这是引擎能提出具体改进的前提。样本太少（< 3）返回空串——引擎没料可吃，宁可不跑。
 */
export function buildClusterSummary(samples: readonly NegativeSampleLike[]): string {
  const byReason = new Map<string, { count: number; scopes: Set<string>; texts: string[] }>()
  for (const s of samples) {
    const b = byReason.get(s.reason) ?? { count: 0, scopes: new Set<string>(), texts: [] }
    b.count += 1
    b.scopes.add(s.scope)
    const t = (s.payload ?? '').trim()
    if (t && b.texts.length < 5) b.texts.push(t)
    byReason.set(s.reason, b)
  }
  if (byReason.size === 0) return ''
  const lines: string[] = []
  for (const [reason, b] of byReason) {
    if (b.count < 3) continue
    lines.push(`- 失败原因「${reason}」出现 ${b.count} 次，涉及 scope：${[...b.scopes].join('、')}`)
    if (b.texts.length) {
      lines.push('  具体表现：')
      for (const t of b.texts) lines.push(`    · ${t}`)
    }
  }
  return lines.join('\n')
}
