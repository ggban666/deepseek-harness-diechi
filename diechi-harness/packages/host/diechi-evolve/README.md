# @deepseek-ai/dsh-host-diechi-evolve

三架构**升级设计者** host 插件。读 `ctx.supervision` 的负样本，按 `reason` 聚类，写 `proposals` 表，等人工 review 后由监督者落 `frozen_rules` / `authorizations`。

## 责任

- 打开共享的监督者数据库（`proposals` + `negative_samples`，与 `diechi-supervisor` 同一文件）
- 构造 `EvolutionService`：扫描负样本 → 写 `proposals` 表
- 把 `ctx.evolution` 暴露给后续插件（diechi-supervisor 的 P3 `review_proposal` 工具会通过它调 `reviewProposal` / `analyzeNegativeSamples`）
- 启动时跑一次 `analyzeNegativeSamples`（轻量 scan，不阻塞）

## Mount 顺序

必须在 `dsh-host-diechi-supervisor` 之后 mount（依赖 `ctx.supervision`）。不要求比 `skill-store` 早。

## 提议生命周期

```
pending ──► allowed ──► EvolutionService.applyProposal() → supervisor.freezeRule() 落 frozen_rules
   │
   └──► denied / superseded（写明原因入 negative_samples）
```

`allowed` 后 `applyProposal` 把"add-rule"应用到 `frozen_rules`——P2 阶段只支持 `add-rule`；`revise-scope` / `add-bootstrap` 留给 P3。

## 触发阈值

- 同一 `reason` 在最近 7 天内累计 ≥ 10 触发提议
- 单次 `analyzeNegativeSamples` 最多产出 5 条提议
- 时间窗 / 阈值当前写死，未来可通过 `settings.evolution.thresholds` 配置

## 已知限制（P2 阶段）

- `analyzeNegativeSamples` 不调 LLM——**纯规则聚类**（避免奖励黑客）。"为什么这个改"靠 `rationale` 字段 + 引用 `evidence`。
- `reviewProposal` 当前只能由 `diechi-supervisor` 的 `supervisor_review_proposal` 工具触发（human-only）。
- 订阅 `supervision/decision` 事件做实时累计留给 P2.5——目前靠启动时一次性 scan。
- 角色可互换（`ctx.agentRole`）未实现。

## 相关

- 设计文档：[docs/diechi-supervisor-design.md](../../docs/diechi-supervisor-design.md)
- 协作机制：[docs/diechi-supervisor-evolve.md](../../docs/diechi-supervisor-evolve.md)
- 监督者包：[../diechi-supervisor](../diechi-supervisor/README.md)
- 思想起源：[docs/wangbo-ai-dialogue-2026/README.md](../../docs/wangbo-ai-dialogue-2026/README.md)
