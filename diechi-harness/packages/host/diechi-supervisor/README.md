# @deepseek-ai/dsh-host-diechi-supervisor

三架构**监督者** host 插件。在 `PersonBrain` 写入路径上加工程护栏——缺监督者时拒绝写入，决策 deterministic 查表（不调 LLM），不自我豁免。

## 责任

- 启动时在 `$DSH_HOME` 创建监督者数据库（4 张表：`frozen_rules` / `authorizations` / `negative_samples` / `proposals`）
- 读取 `settings.supervisor.bootstrap` 预置 `frozen_rules` 与 `authorizations`
- 把 `ctx.supervision` 提供给 `PersonBrain.setSupervisionContext()`
- 决策流程：查 `frozen_rules` → 查 `authorizations` → 默认 deny

## Mount 顺序

**必须在 `dsh-host-skill-store` 之前**。否则 `PersonBrain.open()` 拿不到 `ctx.supervision`，写入会抛 `SupervisionMissingError`。

## 已知限制

- P0 阶段：决策流程只覆盖"frozen + authorized"两档，**负样本表不持久化**（`recordDeny` / `recordFlag` 递增本地计数器，不落库）
- 升级设计者（`diechi-evolve`）未实现
- 角色可互换（`ctx.agentRole`）未实现
- bootstrap 配置读取是 mock（默认走 `DEFAULT_BOOTSTRAP`）
- 没有 RPC（diechi-brain 的 `@Remote` 风格），是函数式 Service

## 相关

- 设计文档：[docs/diechi-supervisor-design.md](../../docs/diechi-supervisor-design.md)
- 协作机制：[docs/diechi-supervisor-evolve.md](../../docs/diechi-supervisor-evolve.md)
- 思想起源：[docs/wangbo-ai-dialogue-2026/README.md](../../docs/wangbo-ai-dialogue-2026/README.md)
- PersonBrain 监督者契约：[packages/host/skill-store/src/supervision.ts](../skill-store/src/supervision.ts)
