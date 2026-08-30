/**
 * 三架构度量报表：把真实运行库里的 C(t) / K(t) / 提议 / 固化情况打出来。
 *
 * 这个脚本存在的理由：设计文档里的两条曲线，如果没人能读到真实数字，
 * 就永远只是 PPT。它是 S0「能画出真实的 C(t)、K(t) 两条曲线（哪怕是平的）」
 * 这条验收标准的具体兑现。
 *
 * 跑法（在 diechi-harness 根目录）：
 *   node --import tsx scripts/metrics-report.mts
 *   node --import tsx scripts/metrics-report.mts D:/path/to/diechi-home
 *
 * @module scripts/metrics-report
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SupervisorDb } from '../packages/host/diechi-supervisor/src/db.ts'
import { CapabilityGate } from '../packages/host/diechi-supervisor/src/gate.ts'
import { EvolveDb } from '../packages/host/diechi-evolve/src/db.ts'

/**
 * 默认 $DSH_HOME：diechi-harness 的同级 diechi-home 目录。
 *
 * 两个坑（都踩过）：
 * 1. 目录层级是 蝶翅-app/diechi-home 与 蝶翅-app/diechi-harness 平级，
 *    从 scripts/ 出发要退两级；退一级会指向不存在的 diechi-harness/diechi-home。
 * 2. **必须用 fileURLToPath，不能用 new URL().pathname**——
 *    pathname 会把中文路径百分号编码成 `D:/%E6%A1%8C%E9%9D%A2/...`，
 *    SupervisorDb.open 拿到这个路径会欢快地 mkdir 出一棵乱码目录树，
 *    然后在一个全新的空库上跑出一份毫无意义的报表。
 */
const DEFAULT_HOME = fileURLToPath(new URL('../../diechi-home/', import.meta.url))

const home = process.argv[2] ?? DEFAULT_HOME

if (!existsSync(home)) {
  console.error(`找不到 $DSH_HOME：${home}`)
  console.error('请显式传入路径：node --import tsx scripts/metrics-report.mts <DSH_HOME>')
  process.exit(1)
}
const db = SupervisorDb.open(home)
const evDb = EvolveDb.open(home)
const gate = new CapabilityGate(db)

const line = (s = '') => console.log(s)
const bar = (title: string) => {
  line()
  line('─'.repeat(64))
  line(`  ${title}`)
  line('─'.repeat(64))
}

bar('蝶翅三架构 · 度量报表')
line(`  $DSH_HOME : ${home}`)
line(`  数据库     : ${db.path}`)
line(`  生成时间   : ${new Date().toISOString()}`)

// ───────────────── C(t) 一次通过率 ─────────────────
bar('C(t) 一次通过率（A1 单调性的度量对象）')

const stats = db.countSignalsByKind()
const positive = stats.accepted + stats['no-rework']
const negative = stats['user-undo'] + stats['explicit-bad']
const total = positive + negative

if (total === 0) {
  line('  ⚠ 没有任何体感样本。')
  line('    可能原因：① 还没在 Web UI 里点过赞/踩；② 监督者插件本次启动前还没有埋点代码。')
  line('    C(t) 只有在用户真的给了反馈之后才有意义——在那之前它是空的，不是 0。')
} else {
  const c = positive / total
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`.padStart(6)
  line(`  一次通过率 C = ${(c * 100).toFixed(2)}%   (${positive}/${total})`)
  line()
  line(`    accepted    （用户点采纳）   ${String(stats.accepted).padStart(6)}  ${pct(stats.accepted)}`)
  line(`    no-rework   （闸放行未返工） ${String(stats['no-rework']).padStart(6)}  ${pct(stats['no-rework'])}`)
  line(`    user-undo   （用户重生成）   ${String(stats['user-undo']).padStart(6)}  ${pct(stats['user-undo'])}`)
  line(`    explicit-bad（用户点踩）     ${String(stats['explicit-bad']).padStart(6)}  ${pct(stats['explicit-bad'])}`)
  line()
  line('  判读：accepted + no-rework 是分子；点踩/返工越多，C 越低。')
  line('        这条曲线是 A1 唯一认可的"能力"，其余数字（token 数、对话数）都不算。')
}

// ───────────────── 快照序列 ─────────────────
bar('C(t) / K(t) 快照序列（历次基准回归）')

const snapshots = db.listSnapshots(200)
const cfg = gate.config()

if (snapshots.length === 0) {
  line('  ⚠ 没有 capability_snapshots 记录。')
  line('    S3 沙盒双门还缺"跑 CBS 基准集"这一半——双门的算术已经就绪，')
  line('    但还没有东西往里喂 C′/K′。这是 S3 剩下的唯一缺口，见路线图 S3 备注。')
} else {
  const best = db.bestScore()
  const kBar = gate.kBar()
  line(`  共 ${snapshots.length} 条，按时间倒序（最多显示 15 条）`)
  line()
  line('    时间                      CBS版本    C(t)     K(t)    样本数')
  for (const s of [...snapshots].reverse().slice(-15)) {
    const mark = s.c_score === best ? ' ← 历史最优' : ''
    line(
      `    ${s.at.padEnd(24)}  ${s.cbs_version.padEnd(8)}  ` +
        `${s.c_score.toFixed(4)}   ${s.k_score.toFixed(4)}   ${String(s.sample_count).padStart(5)}${mark}`,
    )
  }
  line()
  line(`  历史最优 C  = ${best === undefined ? '—' : best.toFixed(4)}   （回归门的比较基线，不是最后一次的值）`)
}

// ───────────────── 成本带 ─────────────────
bar('K(t) 成本带（A2 有界性）')
line(`  滑动基线 K̄   = ${gate.kBar().toFixed(4)}   （EMA α=${cfg.emaAlpha}，回看 ${cfg.emaWindow} 条）`)
line(`  软带          = [${(gate.kBar() * (1 - cfg.bandRatio)).toFixed(4)}, ${(gate.kBar() * (1 + cfg.bandRatio)).toFixed(4)}]   （±${(cfg.bandRatio * 100).toFixed(0)}%）`)
line(`  硬顶 K_max    = ${cfg.kMax.toFixed(4)}   （写进 frozen_rules，代码路径改不动）`)
line()
line('  三档处置：带内 = 正常合并；超软带 = 放行但降档；超硬顶 = 拒绝。')
line('  只有软带而没有硬顶的话，成本可以每次涨 19% 一路棘轮上去——硬顶是唯一能拦住它的东西。')

// ───────────────── 提议 ─────────────────
bar('进化提议（升级设计者的产出）')

const proposals = evDb.listAll(200)
if (proposals.length === 0) {
  line('  ⚠ proposals 为空——进化闭环从未运转（这是 2026-08-30 之前的旧状）。')
  line('    现在 evolve 已能根据体感样本产出 7 种提议；只要 C(t) 有数据，')
  line('    analyzeSamples() 就会开始出货。')
} else {
  const byKind = new Map<string, number>()
  const byStatus = new Map<string, number>()
  for (const p of proposals) {
    let kind = 'unknown'
    try {
      kind = (JSON.parse(p.change) as { kind?: string }).kind ?? 'unknown'
    } catch { /* 旧格式字符串，归类 unknown */ }
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1)
  }
  line(`  共 ${proposals.length} 条`)
  line()
  line('    类型分布（S2 的关键指标：add-rule 占比应 ≤ 20%）')
  const ruleCount = byKind.get('add-rule') ?? 0
  const ruleRatio = proposals.length === 0 ? 0 : ruleCount / proposals.length
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
    const flag = kind === 'add-rule' && ruleRatio > 0.2 ? '  ⚠ 占比过高' : ''
    line(`      ${kind.padEnd(14)} ${String(n).padStart(4)}  ${((n / proposals.length) * 100).toFixed(1)}%${flag}`)
  }
  line()
  line(`    add-rule 占比 = ${(ruleRatio * 100).toFixed(1)}%   （目标 ≤ 20%）`)
  line()
  line('    状态分布')
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    line(`      ${status.padEnd(14)} ${String(n).padStart(4)}`)
  }
}

// ───────────────── 负样本与冻结 ─────────────────
bar('监督者现状')

const negatives = db.listNegativeSamples(1000)
const byReason = new Map<string, number>()
for (const n of negatives) byReason.set(n.reason, (byReason.get(n.reason) ?? 0) + 1)

line(`  负样本 ${negatives.length} 条（闸拦截，非用户体感）`)
if (byReason.size > 0) {
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    line(`      ${reason.padEnd(24)} ${String(n).padStart(4)}`)
  }
}

const frozen = db.listFrozenRules()
line()
line(`  冻结规则 ${frozen.length} 条：`)
for (const f of frozen) {
  line(`      ${f.id}`)
  line(`        ${f.reason}`)
}
line()
line('  ⚠ 冻结规则只增不减。add-rule 型提议每批准一条这里就多一条，')
line('    S2 已把 add-rule 降级为最后手段（需 human 确认且 ΔC=0 排在最后）——')
line('    否则系统会把自己越勒越紧，跑久了所有写入全部 deny，这是"学久必瘫"。')

// ───────────────── 双门自检 ─────────────────
bar('双门自检（拿当前真实数字试算）')

const currentC = total === 0 ? 0 : positive / total
const currentK = gate.kBar()
const probe = gate.evaluate({
  cbsVersion: 'CBS-v1',
  cScore: currentC,
  kScore: currentK,
  sampleCount: total,
})
line(`  用当前 C=${currentC.toFixed(4)} / K=${currentK.toFixed(4)} 试算：`)
line(`    回归门 : ${probe.regression.pass ? '通过' : '拦下'}   （基线 ${probe.regression.baseline.toFixed(4)}，Δ ${probe.regression.delta >= 0 ? '+' : ''}${probe.regression.delta.toFixed(4)}）`)
line(`    成本门 : ${probe.cost.pass ? '通过' : '拦下'}   （带 [${probe.cost.bandLo.toFixed(4)}, ${probe.cost.bandHi.toFixed(4)}]，处置 ${probe.cost.action}）`)
line(`    结论   : ${probe.pass ? '放行' : `拒绝（${probe.reason}）`}`)
line()
line('  双门全程 deterministic 查表/算术，不调 LLM（A3）——')
line('  判定一旦交给模型，就等于让考生自己批卷。')

line()
line('─'.repeat(64))
line()

db.close()
