/**
 * 三架构自进化 S0/S1/S2/S3 冒烟验证。
 *
 * 为什么用 node:test 而不是 vitest：本工作区 vitest 4 的 worker 会 OOM
 * （`ERR_WORKER_OUT_OF_MEMORY`，forks / threads / --no-isolate 全试过），
 * 且 vitest 收集不到只依赖 node:sqlite 的裸脚本。
 *
 * 跑法（在 diechi-harness 根目录）：
 *   node --import tsx --test scripts/verify-self-evolution.mts
 *
 * 覆盖的公理：
 * - A1 单调性：回归门 C' ≥ bestC − ε，且跟**历史最优**比
 * - A2 有界性：成本软带 ±20%（throttle）+ 硬顶 K_max（reject），含棘轮防护
 * - A3 可判定性：双门全程 deterministic，不调 LLM
 *
 * @module scripts/verify-self-evolution
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SupervisorDb } from '../packages/host/diechi-supervisor/src/db.ts'
import { SupervisorService, decidePure } from '../packages/host/diechi-supervisor/src/service.ts'
import { CapabilityGate } from '../packages/host/diechi-supervisor/src/gate.ts'
import { AUTHORIZED_SCOPES, CBS_V1, CbsRunner, costOf } from '../packages/host/diechi-supervisor/src/cbs.ts'
import { EvolveDb } from '../packages/host/diechi-evolve/src/db.ts'
import { EvolutionService } from '../packages/host/diechi-evolve/src/service.ts'
import type { CapabilitySink } from '../packages/host/diechi-evolve/src/service.ts'

/** 每个用例一个独立临时库，互不污染。 */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'diechi-verify-'))
  const db = SupervisorDb.open(dir)
  // ctx 在被测路径里未使用（P3.6 之前），传 undefined 即可
  const svc = new SupervisorService(undefined as never, db)
  return { dir, db, svc }
}

/** 从 proposals.change 的 JSON 里取出提议类型。 */
function kindsOf(rows: readonly { change: string }[]): string[] {
  return rows.map((r) => (JSON.parse(r.change) as { kind: string }).kind)
}

// ─────────────────────────── S0 度量层 ───────────────────────────

test('S0: positive_samples 与 capability_snapshots 两张表可用', () => {
  const { db, svc } = setup()
  svc.recordSignal('person-brain:remember', 'accepted', { latencyMs: 120, costUnits: 0.8 })
  svc.recordSignal('person-brain:remember', 'no-rework')
  svc.recordSignal('person-brain:remember', 'explicit-bad')

  assert.equal(svc.listPositiveSamples(10).length, 3)

  const score = svc.currentScore()
  assert.equal(score.total, 3, '总信号数应为 3')
  assert.equal(score.positive, 2, 'accepted + no-rework 算正样本')
  assert.ok(Math.abs(score.c - 2 / 3) < 1e-9, `C 应为 2/3，实际 ${score.c}`)

  db.insertSnapshot('CBS-v1', 0.5, 1.0, 100)
  assert.equal(svc.listSnapshots(10).length, 1)
  assert.equal(svc.latestSnapshot('CBS-v1')?.c_score, 0.5)
})

test('S0: C(t) 会随用户返工而下降（一次通过率是真实度量，不是自嗨指标）', () => {
  const { svc } = setup()
  for (let i = 0; i < 8; i++) svc.recordSignal('person-brain:learn', 'no-rework')
  const before = svc.currentScore().c
  assert.equal(before, 1)

  for (let i = 0; i < 4; i++) svc.recordSignal('person-brain:learn', 'explicit-bad')
  const after = svc.currentScore().c

  assert.ok(after < before, `返工后 C 必须下降：${before} → ${after}`)
  assert.ok(Math.abs(after - 8 / 12) < 1e-9)
})

test('S0: bestScore 跟历史最优比，不跟上一枪比（一次抖动不该永久拉低基线）', () => {
  const { svc } = setup()
  svc.recordSnapshot('CBS-v1', 0.50, 1.00, 100)
  svc.recordSnapshot('CBS-v1', 0.70, 0.95, 100)
  svc.recordSnapshot('CBS-v1', 0.62, 1.10, 100) // 抖动

  assert.equal(svc.bestScore('CBS-v1'), 0.70, '基线必须锁在历史最优 0.70，而不是最后一次的 0.62')
  assert.equal(svc.latestSnapshot('CBS-v1')?.c_score, 0.62)
})

// ─────────────────────────── S3 双门 ───────────────────────────

test('S3: 能力涨且成本在带内 → 放行', () => {
  const { svc } = setup()
  svc.recordSnapshot('CBS-v1', 0.60, 1.00, 100)

  const r = svc.evaluateProposal({ cbsVersion: 'CBS-v1', cScore: 0.65, kScore: 1.05, sampleCount: 100 })
  assert.equal(r.pass, true, JSON.stringify(r))
  assert.equal(r.regression.pass, true)
  assert.equal(r.cost.action, 'none')
  assert.equal(r.reason, undefined)
})

test('S3: A1 回归门——能力退化的提议必须被拦下', () => {
  const { svc } = setup()
  svc.recordSnapshot('CBS-v1', 0.70, 1.00, 100)

  const r = svc.evaluateProposal({ cbsVersion: 'CBS-v1', cScore: 0.65, kScore: 1.00, sampleCount: 100 })
  assert.equal(r.pass, false)
  assert.equal(r.reason, 'regression-gate', '未通过原因要能直接写进 negative_samples')
  assert.ok(Math.abs(r.regression.delta + 0.05) < 1e-9, 'delta 应为 -0.05')
})

test('S3: A2 成本门——超硬顶直接拒绝（防棘轮的最后一道）', () => {
  const { svc } = setup()
  svc.recordSnapshot('CBS-v1', 0.60, 1.00, 100)

  const r = svc.evaluateProposal({ cbsVersion: 'CBS-v1', cScore: 0.95, kScore: 5.0, sampleCount: 100 })
  assert.equal(r.regression.pass, true, '能力确实涨了')
  assert.equal(r.pass, false, '但成本爆了，仍必须拒绝')
  assert.equal(r.reason, 'cost-gate')
  assert.equal(r.cost.action, 'reject')
})

test('S3: A2 成本软带——超 ±20% 但未超硬顶 → 放行但必须降档', () => {
  const { svc } = setup()
  svc.recordSnapshot('CBS-v1', 0.60, 1.00, 100)

  const r = svc.evaluateProposal({ cbsVersion: 'CBS-v1', cScore: 0.70, kScore: 1.50, sampleCount: 100 })
  assert.equal(r.pass, true, '超软带不直接拒绝，否则成本带就没有缓冲余地')
  assert.equal(r.cost.action, 'throttle', '必须降档（降采样数 / 换小模型）')
  assert.ok(r.cost.candidate > r.cost.bandHi)
  assert.equal(r.cost.kMax, 2.0)
})

test('S3: 棘轮防护——只做相对约束时成本会一路爬升，硬顶必须拦住', () => {
  const { db, svc } = setup()

  // 模拟"每次都在软带内涨 19%"：若只有相对约束，每一枪都合规
  let k = 1.0
  for (let i = 0; i < 20; i++) {
    db.insertSnapshot('CBS-v1', 0.60 + i * 0.001, k, 100)
    k *= 1.19
  }
  assert.ok(k > 30, `20 次 +19% 后成本应已失控，实际 ${k.toFixed(1)}`)

  const r = svc.evaluateProposal({ cbsVersion: 'CBS-v1', cScore: 0.99, kScore: k, sampleCount: 100 })
  assert.equal(r.cost.action, 'reject', 'EMA 基线也被带偏了，只有绝对硬顶能救')
  assert.equal(r.pass, false)
})

test('S3: 无历史数据时放行（冷启动不该被自己的度量卡死）', () => {
  const { svc } = setup()
  const r = svc.evaluateProposal({ cbsVersion: 'CBS-v1', cScore: 0.4, kScore: 1.0, sampleCount: 10 })
  assert.equal(r.pass, true)
  assert.equal(r.regression.baseline, 0.4, '无基线时以候选值自身为基线')
  assert.ok(Math.abs(r.cost.kBar - 1.0) < 1e-9, 'K̄ 初值为 1.0')
})

// ─────────────────────────── S2 提议多样化 ───────────────────────────

test('S2: 正样本驱动——做得好的 scope 产出 add-skill，且不再只产出 add-rule', () => {
  const { dir, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const ev = new EvolutionService(undefined as never, evDb, svc)

  for (let i = 0; i < 12; i++) svc.recordSignal('person-brain:remember', 'no-rework')
  const ids = ev.analyzeSamples()

  assert.ok(ids.length > 0, '有 12 条正样本却一条提议都没出')
  const kinds = kindsOf(evDb.listAll(50))
  assert.ok(kinds.includes('add-skill'), `应产出 add-skill，实际 ${JSON.stringify(kinds)}`)
  assert.ok(!kinds.includes('add-rule'), 'scope 有正样本时冻结它是自残')
})

test('S2: 负样本驱动——返工多的 scope 产出 add-prompt（最便宜的改进）', () => {
  const { dir, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const ev = new EvolutionService(undefined as never, evDb, svc)

  for (let i = 0; i < 12; i++) svc.recordSignal('person-brain:learn', 'explicit-bad')
  ev.analyzeSamples()

  const rows = evDb.listAll(50)
  const kinds = kindsOf(rows)
  assert.ok(kinds.includes('add-prompt'), `应产出 add-prompt，实际 ${JSON.stringify(kinds)}`)
  assert.ok(kinds.includes('re-route'), '返工 ≥10 次应额外考虑加算力')

  const prompt = rows.find((r) => (JSON.parse(r.change) as { kind: string }).kind === 'add-prompt')
  const parsed = JSON.parse(prompt!.change) as { dk: number }
  assert.equal(parsed.dk, 0, 'add-prompt 的 ΔK 应为 0（改提示不增加单次成本）')
})

test('S2: 提议按 ΔC − 0.5·ΔK 排序——又涨能力又省钱的排最前', () => {
  const { dir, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const ev = new EvolutionService(undefined as never, evDb, svc)

  for (let i = 0; i < 12; i++) svc.recordSignal('scope:good', 'no-rework') // add-skill  score=0.065
  for (let i = 0; i < 12; i++) svc.recordSignal('scope:bad', 'explicit-bad') // add-prompt score=0.05 / re-route score=-0.045

  ev.analyzeSamples()
  // listAll 是 ORDER BY id DESC，而 analyzeSamples 按排名顺序插入——排名第一的 id 最小
  const rows = [...evDb.listAll(50)].sort((a, b) => a.id - b.id)
  assert.ok(rows.length >= 2, `应至少 2 条提议，实际 ${rows.length}`)
  assert.equal(
    (JSON.parse(rows[0]!.change) as { kind: string }).kind,
    'add-skill',
    'add-skill（ΔC=+0.04，ΔK=−0.05 → score 0.065）应排在 add-prompt（ΔC=+0.05，ΔK=0 → score 0.05）之前',
  )
})

test('S2: add-rule 降级为最后手段——仅在零正样本时出现，且必须 human 二次确认', () => {
  const { dir, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const ev = new EvolutionService(undefined as never, evDb, svc)

  // 只有闸拦截的负样本，没有任何体感正样本
  for (let i = 0; i < 12; i++) {
    svc.recordDeny({ scope: 'person-brain:suspect', payload: { i } }, 'no-authorization')
  }
  ev.analyzeSamples()

  const rows = evDb.listAll(50)
  const rule = rows.find((r) => (JSON.parse(r.change) as { kind: string }).kind === 'add-rule')
  assert.ok(rule !== undefined, `零正样本时应动用 add-rule，实际 ${JSON.stringify(kindsOf(rows))}`)
  const parsed = JSON.parse(rule!.change) as { humanConfirm: boolean; dc: number }
  assert.equal(parsed.humanConfirm, true, '冻结会永久 deny 写入，必须 human 确认')
  assert.equal(parsed.dc, 0, '冻结不提升能力，ΔC=0 让它自然排到固化类提议后面')
})

// ─────────────────────────── S2/L4 落地与诚实降级 ───────────────────────────

test('L4: 未注入固化库 sink 时，新类型提议只标记 allowed，不假装生效', () => {
  const { dir, db, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const ev = new EvolutionService(undefined as never, evDb, svc) // 无 sink

  const id = ev.propose({
    target: 'scope:x',
    change: { kind: 'add-skill', id: 'skill:scope:x', details: 'd' },
    evidence: [],
    rationale: 'r',
    rollbackPlan: 'b',
    estimatedDc: 0.04,
    estimatedDk: -0.05,
  })

  const before = db.listFrozenRules().length
  assert.doesNotThrow(() => ev.reviewProposal(id, 'allowed'))
  assert.equal(db.listFrozenRules().length, before, '没有 sink 就不该写任何东西')
  assert.equal(evDb.getProposal(id)?.status, 'allowed', '但仍要诚实记录"已批准"')
})

test('L4: 注入 sink 后新类型提议真正落地到固化库', () => {
  const { dir, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const calls: string[] = []
  const sink: CapabilitySink = {
    addSkill: (id) => calls.push(`skill:${id}`),
    addCase: (id) => calls.push(`case:${id}`),
    addPrompt: (id) => calls.push(`prompt:${id}`),
    reRoute: (id) => calls.push(`route:${id}`),
    pruneCache: (id) => calls.push(`prune:${id}`),
  }
  const ev = new EvolutionService(undefined as never, evDb, svc, 'test', sink)

  const id = ev.propose({
    target: 'scope:x',
    change: { kind: 'add-skill', id: 'skill:scope:x', details: 'd' },
    evidence: [],
    rationale: 'r',
    rollbackPlan: 'b',
    estimatedDc: 0.04,
    estimatedDk: -0.05,
  })
  ev.reviewProposal(id, 'allowed')

  assert.deepEqual(calls, ['skill:skill:scope:x'])
})

test('L4: add-rule 仍然写 frozen_rules（老路径未回归）', () => {
  const { dir, db, svc } = setup()
  const evDb = EvolveDb.open(dir)
  const ev = new EvolutionService(undefined as never, evDb, svc)

  const id = ev.propose({
    target: 'scope:y',
    change: { kind: 'add-rule', id: 'scope:y', details: '太危险' },
    evidence: [],
    rationale: 'r',
    rollbackPlan: 'b',
    estimatedDc: 0,
    estimatedDk: -0.01,
    needsHumanConfirm: true,
  })
  ev.reviewProposal(id, 'allowed')

  assert.ok(db.getFrozenRule('scope:y') !== undefined, 'add-rule 必须落进 frozen_rules')
})

// ─────────────────────────── S1 成功路径不再静默 ───────────────────────────

test('S1: 闸放行时不再静默——allow 路径会留下体感样本，且默认节流生效', () => {
  const { db, svc } = setup()
  db.insertAuthorization('person-brain:remember', 'test')

  // allow 是高频路径（每次 PersonBrain 写入都要过闸），必须有节流兜底
  svc.decide({ scope: 'person-brain:remember', payload: { a: 1 } })
  svc.decide({ scope: 'person-brain:remember', payload: { a: 2 } })
  assert.equal(svc.listPositiveSamples(10).length, 1, '默认 1s 节流：同一 scope 连打只记一条')

  svc.configureTelemetry({ throttleMs: 0 }) // 关掉节流
  svc.decide({ scope: 'person-brain:remember', payload: { a: 3 } })
  const rows = svc.listPositiveSamples(10)
  assert.equal(rows.length, 2, '关掉节流后每次放行都要记')
  assert.ok(rows.every((r) => r.signal === 'no-rework'))

  // 未授权的 scope 走 deny，不该记成正样本
  svc.decide({ scope: 'person-brain:unauthorized', payload: {} })
  assert.equal(svc.listPositiveSamples(10).length, 2, 'deny 分支不能记正样本')
})

test('S1: 埋点失败不能影响主决策（A3：判定优先于采集）', () => {
  const { db, svc } = setup()
  db.insertAuthorization('person-brain:remember', 'test')

  const result = svc.decide({ scope: 'person-brain:remember', payload: {} })
  assert.equal(result.decision, 'allow', '即便采集出问题，判定结果也必须照常返回')
})

// ─────────────────────────── S3 CBS 能力基准集 ───────────────────────────

/** 建一个带完整 bootstrap 规则的库（对齐 DEFAULT_BOOTSTRAP）。 */
function setupWithBootstrap() {
  const { dir, db, svc } = setup()
  db.insertFrozenRule('person-brain:learn.policy.pii-redaction', 'PII 扫描', 'bootstrap')
  db.insertFrozenRule('person-brain:remember.policy.pii-redaction', 'PII 扫描', 'bootstrap')
  db.insertFrozenRule('capability:cost.k-max', '成本硬顶', 'bootstrap')
  for (const scope of AUTHORIZED_SCOPES) db.insertAuthorization(scope, 'bootstrap')
  return { dir, db, svc }
}

test('S3: CBS 放行族全过——已授权的正常业务不该被误拦', () => {
  const { db } = setupWithBootstrap()
  const result = new CbsRunner(CBS_V1).run(db)
  const failed = result.failures.filter((f) => f.family === 'liveness').map((f) => f.id).join(',')
  assert.equal(result.byFamily.liveness.rate, 1, `liveness 应全过，实际失败：${failed}`)
})

test('S3: CBS 拦截族全过——未授权与冻结的 scope 必须拦住（含临时身份护栏）', () => {
  const { db } = setupWithBootstrap()
  const result = new CbsRunner(CBS_V1).run(db)
  const failed = result.failures
    .filter((f) => f.family === 'safety')
    .map((f) => `${f.id}:${f.actual}(${f.actualReason ?? '-'})`)
    .join(',')
  assert.equal(result.byFamily.safety.rate, 1, `safety 应全过，实际失败：${failed}`)
})

test('S3: 【已知缺口锁定】PII 族当前 0 分——基座没有 payload 级判定能力', () => {
  const { db } = setupWithBootstrap()
  const result = new CbsRunner(CBS_V1).run(db)
  assert.equal(result.byFamily.pii.rate, 0, 'PII 族当前应全挂：decidePure 只看 scope 不看 payload')

  // 这个断言是故意的：**如果哪天它失败了，说明缺口已经被填上**，
  // 那么本测试与 cbs.ts 文件头的诚实说明都必须同步更新。
  // 用一个失败的测试来标记"这里修好了"，比让缺口悄无声息地消失要好。
  assert.ok(
    result.failures.filter((f) => f.family === 'pii').every((f) => f.actual === 'allow'),
    'PII 失败应全部是"该拦没拦"（allow），而不是别的错误',
  )
})

test('S3: 基准集跑在库副本上——不污染生产库的负样本表', () => {
  const { db } = setupWithBootstrap()
  const before = db.listNegativeSamples(100).length
  new CbsRunner(CBS_V1).run(db)
  const after = db.listNegativeSamples(100).length
  assert.equal(after, before, '跑基准不能往生产库写负样本——否则 evolve 会把假失败当真失败去聚类')
  assert.equal(db.listSnapshots(10).length, 0, '跑基准也不该自己写快照（写不写由调用方决定）')
})

test('S3: 沙盒候选评估——加一条冻结规则能提升拦截分，同时推高成本', () => {
  const { db } = setupWithBootstrap()
  const runner = new CbsRunner(CBS_V1)

  const baseline = runner.run(db)
  const { result: candidate, sandbox } = runner.evaluateCandidate(db, {
    addFrozen: [{ id: 'shell:exec', reason: '禁止任意命令执行' }],
  })
  sandbox.close()

  assert.ok(candidate.byFamily.safety.rate >= baseline.byFamily.safety.rate, '加了冻结规则不该让拦截分下降')
  assert.ok(candidate.kScore > baseline.kScore, '加规则必然推高成本——这就是 A2 有界性要管的张力')
  assert.equal(candidate.ruleCount.frozen, baseline.ruleCount.frozen + 1)

  // 把"隐式未授权"升级成"显式冻结"是**改进**，不能因为 reason 变了就判成退步。
  // 这条断言锁死 strictReason 的设计意图：reason 默认不参与判定。
  const upgraded = candidate.failures.length === baseline.failures.length &&
    candidate.byFamily.safety.passed === baseline.byFamily.safety.passed
  assert.ok(upgraded, '保护升级（未授权 → 显式冻结）必须仍然算通过，否则是在惩罚改进')
})

test('S3: 成本随规则数单调上升（K 的真实含义是"每次决策要扫多少规则"）', () => {
  assert.ok(costOf(0, 0) < costOf(1, 0), '加冻结规则 → 成本上升')
  assert.ok(costOf(0, 0) < costOf(0, 1), '加授权 → 成本上升')
  assert.equal(costOf(0, 0), 1, '空规则库成本 = 归一化基准 1.0')
})

test('S3: 双门吃 CBS 结果——能力退化被回归门拦下', () => {
  const { db } = setupWithBootstrap()
  const runner = new CbsRunner(CBS_V1)
  const good = runner.run(db)
  db.insertSnapshot(good.version, good.cScore, good.kScore, good.total)

  const gate = new CapabilityGate(db)
  // 候选：能力掉了 0.1，成本不变 → 回归门必须拦
  const verdict = gate.evaluate({
    cbsVersion: good.version,
    cScore: good.cScore - 0.1,
    kScore: good.kScore,
    sampleCount: good.total,
  })
  assert.equal(verdict.pass, false)
  assert.equal(verdict.reason, 'regression-gate')

  // 候选：能力持平，成本不变 → 放行
  const ok = gate.evaluate({ cbsVersion: good.version, cScore: good.cScore, kScore: good.kScore, sampleCount: good.total })
  assert.equal(ok.pass, true, '不退化就该放行——否则系统永远无法合并任何改进')
})

test('S3: 双门吃 CBS 结果——成本爆硬顶被成本门拦下（防棘轮）', () => {
  const { db } = setupWithBootstrap()
  const runner = new CbsRunner(CBS_V1)
  const good = runner.run(db)
  db.insertSnapshot(good.version, good.cScore, good.kScore, good.total)

  // 硬顶必须高于软带上界，否则 throttle 区间为空、两档退化成一档。
  // 软带上界 = kBar × 1.2，这里硬顶取 kBar × 1.5，中间那 0.3 就是"降档区"。
  const gate = new CapabilityGate(db, { kMax: good.kScore * 1.5 })

  // 超硬顶 → 拒绝
  const verdict = gate.evaluate({
    cbsVersion: good.version,
    cScore: good.cScore + 0.05,
    kScore: good.kScore * 1.6,
    sampleCount: good.total,
  })
  assert.equal(verdict.pass, false)
  assert.equal(verdict.reason, 'cost-gate')
  assert.equal(verdict.cost.action, 'reject', '超硬顶必须拒绝，不能只是降档')

  // 只超软带未超硬顶（1.2× < 1.3× < 1.5×）→ 放行但降档
  const soft = gate.evaluate({
    cbsVersion: good.version,
    cScore: good.cScore + 0.05,
    kScore: good.kScore * 1.3,
    sampleCount: good.total,
  })
  assert.equal(soft.cost.action, 'throttle', '超软带：允许合并但必须降档')
  assert.equal(soft.pass, true)
})

test('S3: 测的就是跑的——CBS 与线上决策共用 decidePure', () => {
  const { db, svc } = setupWithBootstrap()
  for (const task of CBS_V1.tasks) {
    const online = svc.decide(task.input)
    const benchmark = decidePure(db, task.input, task.asRole)
    assert.equal(online.decision, benchmark.decision, `任务 ${task.id}：基准集测的结果与线上判定不一致`)
  }
})
