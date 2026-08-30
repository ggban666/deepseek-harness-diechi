# @deepseek-ai/dsh-host-diechi-supervisor

三架构**监督者** host 插件。在 `PersonBrain` 写入路径上加工程护栏——缺监督者时拒绝写入，决策 deterministic 查表（不调 LLM），不自我豁免。

## 责任

- 启动时在 `$DSH_HOME` 创建监督者数据库（4 张表：`frozen_rules` / `authorizations` / `negative_samples` / `proposals`）
- 读取 `settings.supervisor.bootstrap` 预置 `frozen_rules` 与 `authorizations`
- 把 `ctx.supervision` 提供给 `PersonBrain.setSupervisionContext()`
- 决策流程：查 `frozen_rules` → 查 `authorizations` → 默认 deny

## Mount 顺序

**必须在 `dsh-host-skill-store` 之前**。否则 `PersonBrain.open()` 拿不到 `ctx.supervision`，写入会抛 `SupervisionMissingError`。

## 监督者决策可审计

- 每次写入（`learn` / `remember` / `seeScene` / `predict`）过 `gateWrite` → `supervision.decide()` 得到 `'allow' | 'flag-review' | 'deny'`，**落库到 `supervision_decision` 列**。
- `PersonMemory` / `PersonKnowledge` 接口带 `supervisionDecision` 字段——`recall` / `recallKnowledge` / `listInbox` / `listPractice` 均读回。
- `PersonBrain.listFlagged()` 审计入口：列出 `supervision_decision IN ('flag-review','deny')` 的记忆行。
- diechi-brain 的 `BrainPracticeItem` RPC 透出 `supervisionDecision`——阅历控制台显示"监督者标了待审/拒绝写入"徽标。

## 已知限制

- 负样本表按 `negative_samples` schema 持久化（24h cleanup 保留最近 5000 + proposals.evidence 引用）。
- 升级设计者（`diechi-evolve`）：多源主动感知已实现（正负样本驱动 `analyzeSamples`，产出 8 种提议类型）。
- 角色可互换（`ctx.agentRole`）：已实现（swapTo/revert/history + 三条护栏）。
- bootstrap 配置读取是 mock（默认走 `DEFAULT_BOOTSTRAP`）
- 没有 RPC（diechi-brain 的 `@Remote` 风格），是函数式 Service

## 相关

- 设计文档：[docs/diechi-supervisor-design.md](../../docs/diechi-supervisor-design.md)
- 协作机制：[docs/diechi-supervisor-evolve.md](../../docs/diechi-supervisor-evolve.md)
- 思想起源：[docs/wangbo-ai-dialogue-2026/README.md](../../docs/wangbo-ai-dialogue-2026/README.md)
- PersonBrain 监督者契约：[packages/host/skill-store/src/supervision.ts](../skill-store/src/supervision.ts)
