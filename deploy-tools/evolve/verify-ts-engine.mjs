#!/usr/bin/env node
/**
 * TS 侧引擎接入闭环验证 —— 直接调 diechi-evolve 编译产物（lib/types/engine.js），
 * 验证「TS 代码 -> HTTP -> llama-server(GBNF) -> 合法提议」全链路。
 *
 * 用法（先起引擎）：
 *   python engine.py serve --model <gguf> --port 8081 --ctx 2048 --ngl 99
 *   node verify-ts-engine.mjs
 */
import {
  isEngineReady,
  generateDrafts,
  runEngineAndPropose,
  buildClusterSummary,
} from '../../diechi-harness/packages/host/diechi-evolve/lib/types/engine.js'

const URL = process.env.EVOLVE_ENGINE_URL ?? 'http://127.0.0.1:8081'

// 1. 健康探测
const ready = await isEngineReady()
console.log(`[1] isEngineReady() -> ${ready}`)
if (!ready) {
  console.error('引擎未就绪：请先 python engine.py serve --ngl 99')
  process.exit(1)
}

// 2. buildClusterSummary：负样本 -> 聚类摘要（frequency >= 3 才入选）
const samples = [
  { id: 1, scope: 'weekly-report', reason: 'missing-section-本周问题' },
  { id: 2, scope: 'weekly-report', reason: 'missing-section-本周问题' },
  { id: 3, scope: 'weekly-report', reason: 'missing-section-本周问题' },
  { id: 4, scope: 'weekly-report', reason: 'date-format-不一致' },
  { id: 5, scope: 'weekly-report', reason: 'date-format-不一致' },
  { id: 6, scope: 'daily-standup', reason: 'date-format-不一致' },
  { id: 7, scope: 'other', reason: 'noise-只出现一次' },
]
const summary = buildClusterSummary(samples)
console.log(`[2] buildClusterSummary() ->\n${summary}\n`)
if (!summary) {
  console.error('聚类摘要为空：样本未达频次阈值')
  process.exit(1)
}

// 3. generateDrafts：真实 HTTP 调引擎，GBNF 约束下产出提议草稿
const drafts = await generateDrafts(summary, 3)
console.log(`[3] generateDrafts() -> ${drafts.length} 条草稿`)
for (const d of drafts) {
  console.log(`    - [${d.change.kind}] target=${d.target} id=${d.change.id}`)
  console.log(`      details: ${d.change.details.slice(0, 80)}`)
}
if (drafts.length === 0) {
  console.error('引擎未产出有效提议')
  process.exit(1)
}

// 4. runEngineAndPropose：草稿 -> mock service.propose() 落库链路
const store = []
const mockService = { propose(d) { store.push(d); return store.length } }
const n = await runEngineAndPropose(mockService, summary, 3)
console.log(`[4] runEngineAndPropose() -> 落库 ${n} 条（mock service 收到 ${store.length} 条）`)

// 5. kind 白名单终检：绝不允许 add-rule
const bad = store.filter(d => d.change.kind === 'add-rule')
console.log(`[5] add-rule 检查 -> ${bad.length} 条（必须为 0）`)
if (bad.length > 0 || n === 0) process.exit(1)

console.log('\nPASS：TS 侧引擎接入闭环验证通过')
