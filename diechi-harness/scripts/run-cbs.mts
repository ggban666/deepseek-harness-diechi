/**
 * 跑 CBS 能力基准集 —— S3 双门的喂料口。
 *
 * 这是"让 C(t) 第一次有真实数字"的那一步。在此之前，
 * capability_snapshots 是空表，双门无事可做，A1/A2 两条公理只是文档里的口号。
 *
 * 跑法（diechi-harness 根目录）：
 *   node --import tsx scripts/run-cbs.mts                    # 只跑不写（默认，安全）
 *   node --import tsx scripts/run-cbs.mts --commit           # 跑完写入快照
 *   node --import tsx scripts/run-cbs.mts <DSH_HOME> --commit
 *
 * 默认不写库是刻意的：先看清楚分数和失败清单，确认基准集本身没问题，
 * 再让它进历史序列。基准集一旦写进快照，就会成为后续回归门的基线——
 * 拿一份有问题的基准当基线，后面所有的"不退化"都失去了意义。
 *
 * @module scripts/run-cbs
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SupervisorDb } from '../packages/host/diechi-supervisor/src/db.ts'
import { CapabilityGate } from '../packages/host/diechi-supervisor/src/gate.ts'
import { CBS_V1, CbsRunner, type CbsFamily } from '../packages/host/diechi-supervisor/src/cbs.ts'

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const homeArg = args.find((a) => !a.startsWith('--'))

/**
 * 默认 $DSH_HOME：diechi-harness 的同级 diechi-home（从 scripts/ 出发退两级）。
 *
 * **必须用 fileURLToPath，不能用 new URL().pathname**——pathname 会把中文
 * 百分号编码成 `D:/%E6%A1%8C%E9%9D%A2/...`，SupervisorDb.open 会 mkdir 出一棵
 * 乱码目录树，然后在空库上跑出一份「冻结 0 条、授权 0 条」的假报表。
 * 存在性检查必须在 open 之前：open 自带 mkdir，等它建出来了再检查就晚了。
 */
const DEFAULT_HOME = fileURLToPath(new URL('../../diechi-home/', import.meta.url))
const home = homeArg ?? DEFAULT_HOME

if (!existsSync(home)) {
  console.error(`找不到 $DSH_HOME：${home}`)
  console.error('请显式传入路径：node --import tsx scripts/run-cbs.mts <DSH_HOME>')
  process.exit(1)
}

const line = (s = '') => console.log(s)
const bar = (title: string) => {
  line()
  line('─'.repeat(72))
  line(`  ${title}`)
  line('─'.repeat(72))
}

const db = SupervisorDb.open(home)
const gate = new CapabilityGate(db)
const runner = new CbsRunner(CBS_V1)

bar(`CBS 能力基准集 · ${CBS_V1.version}`)
line(`  $DSH_HOME : ${home}`)
line(`  规则库     : 冻结 ${db.listFrozenRules().length} 条，授权 ${db.listAuthorizations().length} 条`)
line(`  任务数     : ${CBS_V1.tasks.length} 条`)
line(`  模式       : ${commit ? '写入快照' : '只跑不写（加 --commit 才会写入）'}`)

const result = runner.run(db)

// ───────────────── 环境自检 ─────────────────
// 基准集里有些任务依赖特定规则已存在于库中。缺了的话任务会失败，
// 但那是**环境没同步**（bootstrap 还没跑），不是基准集或决策逻辑的问题。
// 不先说清楚，下次跑的人会拿着失败清单去改代码，改半天发现改错了地方。
{
  const missing = new Map<string, string[]>()
  const note = (key: string, taskId: string) => {
    const list = missing.get(key) ?? []
    list.push(taskId)
    missing.set(key, list)
  }
  for (const task of CBS_V1.tasks) {
    if (task.expect === 'allow' && db.getAuthorization(task.input.scope) === undefined) {
      note(`授权缺失：${task.input.scope}`, task.id)
    }
    if (task.expectReason === 'rule-frozen' && db.getFrozenRule(task.input.scope) === undefined) {
      note(`冻结规则缺失：${task.input.scope}`, task.id)
    }
  }
  if (missing.size > 0) {
    bar('环境自检 —— 这些失败不是代码问题，是规则还没进库')
    for (const [what, ids] of missing) {
      line(`  ⚠ ${what}`)
      line(`      影响任务：${ids.join(', ')}`)
    }
    line()
    line('  原因：DEFAULT_BOOTSTRAP 里的规则只在 DSH 启动时写入。')
    line('  新加的规则要重启 DSH 才会生效——在此之前跑基准，相关任务必然失败。')
  }
}

// ───────────────── 总分 ─────────────────
bar('总成绩')
line(`  C（一次通过率） = ${result.cScore.toFixed(4)}   （${result.passed}/${result.total}）`)
line(`  K（归一化成本） = ${result.kScore.toFixed(4)}   （冻结 ${result.ruleCount.frozen} × 0.01 + 授权 ${result.ruleCount.authorizations} × 0.005 + 基准 1.0）`)

// ───────────────── 分族 ─────────────────
bar('分族明细')
const familyLabel: Record<CbsFamily, string> = {
  liveness: 'liveness  该放行的（放了才不瘫痪）',
  safety: 'safety    该拦住的（拦了基座才不失守）',
  pii: 'pii       含个人信息的写入',
}
for (const key of ['liveness', 'safety', 'pii'] as CbsFamily[]) {
  const stat = result.byFamily[key]
  const pct = (stat.rate * 100).toFixed(1).padStart(5)
  const filled = Math.round(stat.rate * 20)
  const gauge = '█'.repeat(filled) + '░'.repeat(20 - filled)
  line(`  ${familyLabel[key]}`)
  line(`      ${pct}%  ${gauge}   ${stat.passed}/${stat.total}`)
}

// ───────────────── 失败清单 ─────────────────
if (result.failures.length > 0) {
  bar(`失败清单（${result.failures.length} 条）—— 这是每次跑基准真正要看的东西`)
  for (const f of result.failures) {
    line(`  [${f.id}] ${f.family}`)
    line(`      ${f.desc}`)
    line(`      期望 ${f.expect}${f.expectReason === undefined ? '' : ` (${f.expectReason})`}` +
         `  →  实际 ${f.actual}${f.actualReason === undefined ? '' : ` (${f.actualReason})`}`)
  }
}

// ───────────────── 分族解读 ─────────────────
bar('这张分数意味着什么')
const lv = result.byFamily.liveness.rate
const sf = result.byFamily.safety.rate
const pi = result.byFamily.pii.rate
if (lv === 1 && sf === 1) {
  line('  放行族与拦截族全对——监督者的规则表在这批任务上是精确的。')
} else {
  if (lv < 1) line(`  ⚠ 放行族有 ${result.byFamily.liveness.total - result.byFamily.liveness.passed} 条被误拦 —— 系统会变得碍手碍脚。`)
  if (sf < 1) line(`  ⚠ 拦截族有 ${result.byFamily.safety.total - result.byFamily.safety.passed} 条被放行 —— 基座保护有洞。`)
}
if (pi === 0) {
  line()
  line('  ⚠ PII 族 0 分是**已知缺口，不是度量错误**：')
  line('    当前 decidePure() 只看 scope，不看 payload 内容，基座没有 payload 级判定能力。')
  line('    冻结规则 person-brain:learn.policy.pii-redaction 用的是带后缀的 scope，')
  line('    而业务侧实际传的是裸 scope person-brain:learn，精确匹配永远命中不了——')
  line('    这条 PII 冻结规则是一条从未生效过的死规则。')
  line('    修法：在 decidePure() 加 payload PII 扫描，或把冻结规则改成前缀匹配。')
  line('    先能度量，才谈改进——宁可带真实低分起步，也不把缺口藏起来。')
}

// ───────────────── 双门判定 ─────────────────
const verdict = gate.evaluate({
  cbsVersion: result.version,
  cScore: result.cScore,
  kScore: result.kScore,
  sampleCount: result.total,
})
bar('双门判定（拿这次分数当候选版本试算）')
line(`  回归门 : ${verdict.regression.pass ? '通过' : '不通过'}` +
     `   （历史最优 ${verdict.regression.baseline.toFixed(4)}，本次 ${verdict.regression.candidate.toFixed(4)}，Δ ${verdict.regression.delta >= 0 ? '+' : ''}${verdict.regression.delta.toFixed(4)}）`)
line(`  成本门 : ${verdict.cost.pass ? '通过' : '不通过'}` +
     `   （K̄ ${verdict.cost.kBar.toFixed(4)}，带 [${verdict.cost.bandLo.toFixed(4)}, ${verdict.cost.bandHi.toFixed(4)}]，本次 ${verdict.cost.candidate.toFixed(4)}）`)
line(`  处置   : ${verdict.cost.action === 'none' ? '带内，正常' : verdict.cost.action === 'throttle' ? '超软带，放行但必须降档' : '超硬顶，拒绝'}`)
line(`  结论   : ${verdict.pass ? '放行' : `拦截（${verdict.reason}）`}`)

// ───────────────── 写入快照 ─────────────────
if (commit) {
  const id = db.insertSnapshot(result.version, result.cScore, result.kScore, result.total)
  line()
  line(`  ✓ 已写入 capability_snapshots #${id}`)
  line(`    之后每次跑基准都会跟这条比——回归门跟**历史最优**比，不是跟上次比。`)
} else {
  line()
  line('  提示：加 --commit 写入快照，让这次成绩成为后续回归门的基线。')
}

db.close()
line()
