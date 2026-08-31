#!/usr/bin/env node
/**
 * M4 集成演练：给 brain.db 注入 3 条「用户返工」演练负样本，
 * 让 diechi-evolve 的引擎定时器有真实聚类原料可吃。
 *
 * 模仿 SupervisorDb.insertNegativeSample 的写入格式：
 *   INSERT INTO negative_samples (scope, payload, decision, reason, source, created_at)
 *
 * scope 用 e2e-engine-drill —— 独立 scope，不污染真实统计。
 */
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('D:/桌面/振翅科技/蝶翅-app/diechi-home/brain.db-supervisor')
const rows = [
  { payload: '生成周报时漏掉「本周问题」小节，用户手动补写', },
  { payload: '周报风险段落太笼统，用户返工要求写具体影响和责任人', },
  { payload: '周报结尾没有行动项清单，用户重写收尾', },
]
let n = 0
for (const r of rows) {
  const res = db.prepare(
    'INSERT INTO negative_samples (scope, payload, decision, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('e2e-engine-drill', JSON.stringify(r.payload), 'flag-review', 'user-rework', 'e2e-drill', new Date().toISOString())
  n += Number(res.changes)
}
console.log(`[drill] 写入 ${n} 条演练负样本（scope=e2e-engine-drill, reason=user-rework）`)
const total = db.prepare('SELECT COUNT(*) AS c FROM negative_samples').get()
console.log(`[drill] negative_samples 总数: ${total.c}`)
db.close()
