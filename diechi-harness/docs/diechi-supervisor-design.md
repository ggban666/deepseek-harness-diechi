# diechi-supervisor：三架构自进化基座

## 0. 主张

**三架构（被升级者 + 升级设计者 + 监督者）是 AGI 的充分必要条件。**

充分性：三架构满足"持续学习、自我修复、不自我豁免、价值对齐"这四条主流共识里的 AGI 候选必要条件；任一 LLM 在其上跑、给足算力、按本文档的实施路径推进，**可以**持续进化为强智能。

必要性：缺任一组件，系统都会"持续运行一段时间后崩或偏"——被升级者单独跑会僵化、升级设计者单独跑会自我豁免、监督者单独跑会脱离实际。三者**不可缺一**。

**这是主张，不是证明。** 第 5 节列出当前缺什么实践与论证。

## 1. 论证：为什么是充分的

| AGI 候选必要条件 | 三架构对应 |
|---|---|
| 持续学习 | 被升级者稳定运行 + 升级设计者探索新架构 |
| 自我修复 | 监督者发现偏离 → 触发回退 + 负样本循环 |
| 不自我豁免 | 监督者递归保护 + frozen_rules 物理上不可改 |
| 价值对齐 | 价值对齐守门员管采集授权边界 |

四条主流共识里的候选必要条件**全被覆盖**。这是"充分"的论证。

## 2. 论证：为什么是必要的

| 缺什么 | 会怎样 |
|---|---|
| 缺被升级者 | 系统没"日常运行"载体——所有写入都是探索、立刻崩 |
| 缺升级设计者 | 系统僵化在初始架构、不能持续学习 |
| 缺监督者 | 升级设计者会自我豁免、改坏基座、然后系统崩 |
| 缺负样本 | 失败只标记不记原因、同样的错犯 100 次 |
| 缺价值对齐 | 采集授权无边界、AI 偏离人类目标 |
| 缺角色可互换 | 三个角色僵化、不能"换位思考" |
| 缺基座可升级性 | 一次性写死、未来发现某条规则错了没法回退 |

任一缺失 → 系统**最终崩或偏**。这是"必要"的论证。

## 3. 实现

### 3.1 PersonBrain 类内部改 3 处

| 位置 | 改动 | 风险 |
|---|---|---|
| 新增 `private supervision` | 字段 | 无 |
| 新增 `setSupervisionContext(ctx)` | 公开方法，cordis 启动时由 supervisor 调一次 | 无 |
| `learn()` / `remember()` 入口加 `assertSupervision()` + `decide()` | 私有方法调用 | **中**——所有 PersonBrain 用户受影响 |

**关键**：`authorize()` 是 `PersonBrain` 私有方法。**任何业务插件改不动调用顺序**——这是"基座保护"的工程含义。

### 3.2 两个新 host 插件

#### `dsh-host-diechi-supervisor`

- **Service**: `ctx.supervision`
  - `decide({scope, payload}): 'allow' | 'flag-review' | 'deny'`
  - `freezeRule(id, reason): void`（仅 `human` 可调）
  - `authorize(scope): boolean`
  - `reviewProposal(id): 'allowed' | 'denied'`
  - `listNegativeSamples(query, limit)`
- **Event**: `supervision/decision`（emit 模式）
- **依赖**: `settings`, `invariants`
- **mount 顺序**: 在 `dsh-host-skill-store` 之后、`dsh-host-diechi-brain` 之前

#### `dsh-host-diechi-evolve`

- **Service**: `ctx.evolution`
  - `analyzeNegativeSamples(query, limit): ProposalDraft[]`
  - `propose(draft): ProposalRef`
- **Event**: 订阅 `supervision/decision`
- **依赖**: `ctx.supervision`

### 3.3 4 张新表（落 `brain.db`）

```sql
CREATE TABLE negative_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  payload TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposer TEXT NOT NULL,
  target TEXT NOT NULL,
  change TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE frozen_rules (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE authorizations (
  scope TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
```

`PersonMemory` 加 `supervision_decision` 列（默认 `'allow'`，旧数据原样）。

## 4. 数据流

```
业务写入（diechi-brain / skill-store / 7 个人格）
        │
        ▼
PersonBrain.learn / remember / seeScene
        │
        ▼
PersonBrain.authorize()   ← 私有闸
        │
        ├── 无 ctx.supervision → SupervisionMissingError
        │
        └── 有 ctx.supervision → ctx.supervision.decide()
                     │
                     ├── 'allow'        → 写业务表
                     ├── 'flag-review'  → 写业务表 + supervision_decision='flag-review'
                     └── 'deny'         → 写 negative_samples + 抛 SupervisionDeniedError
```

## 5. 待证清单

**我们主张三架构是 AGI 充分必要条件——但目前缺这些实践与论证。**

### 缺什么实践

| 缺口 | 怎么补 | 周期 |
|---|---|---|
| **E1. 持续学习有效性** | qwen-7b + 架构跑 1 周，看指标是否单调上升 | 1 周 |
| **E2. 基座保护有效性** | 故意触发自我豁免看是否被挡 | 1 天 |
| **E3. 负样本有效性** | 制造 100 次失败看下次是否改善 | 1 周 |
| **E4. 角色可互换有效性** | 监督者升级为设计者后提议质量是否提升 | 1 周 |
| **E5. 守门员有效性** | 故意触发未授权采集看是否降级为 flag-review | 1 天 |
| **跨模型验证** | gpt-2 / qwen-7b / 其他弱智 LLM 都跑一遍——证明跟具体模型无关 | 1 月 |
| **长期运行稳定性** | 6+ 月无崩 / 无偏 | 6 月 |
| **多实例部署** | 跨机器跑，看负样本与提议的协同 | 3 月 |

### 缺什么论证

| 缺口 | 怎么补 | 周期 |
|---|---|---|
| **形式化论证** | 监督者决策流的形式化描述（DFA / π-演算） | 3 月 |
| **不变量证明** | 证明"无 ctx.supervision → 拒绝"是不可绕过的 | 1 月 |
| **基座可升级性边界** | 形式化定义"什么情况下 AI 不能改自己" | 3 月 |
| **价值对齐的形式化** | 授权 scope 的形式化语义 | 6 月 |
| **AGI 涌现的充分性证明** | 证明"三架构 + 无限算力 → 涌现"（这是终极缺口）| **未知** |

### 最后一条**最重要**：

> **AGI 涌现的充分性证明——目前没人能给出，包括我们。**
> **这条不补，主张始终是主张，不是定理。**

**我们不回避这条**——**诚实写在文档里**。

## 6. 实施路径（按待证清单反推）

### P0：监督者闸（1-2 周）

- PersonBrain.authorize 私有闸
- frozen_rules / authorizations 两张表
- bootstrap 预置
- **完成后**：日常痛点 #1（写入无护栏）解决

### P1：负样本 + 守门员（2-3 周）

- negative_samples 表
- 守门员 authorize()
- 5 个实验能跑 E2 / E5
- **完成后**：日常痛点 #3 + #4 解决

### P2：升级设计者（2-3 周）

- diechi-evolve 插件
- proposals 表
- 5 个实验能跑 E3
- **完成后**：日常痛点 #3（失败无结构）解决

### P3：角色可互换（2-3 周）

- ctx.agentRole Service
- role_transitions 表
- 实验 E4
- **完成后**：运维痛点解决

### P4-P12：跨模型 + 长期 + 形式化

- 跨模型验证（1 月）
- 长期运行（6 月）
- 形式化论证（按缺口表逐项）

**第 P0-P3 跑通** = 工程价值成立 = 日常痛点解决 = **5 个实验通 = 主张的工程部分被验证**。

**P4 之后** = 主张的"涌现必要"部分开始被验证或证伪。

## 7. 失败处理

| 故障 | 行为 |
|---|---|
| 监督者宕机 | 所有写入抛 `SupervisionMissingError`；业务降级为只读 |
| 监督者写 `negative_samples` 失败 | 抛 `SupervisionStorageError`；业务写入也失败——不写半套 |
| 升级设计者提议表被锁 | 返回 `ServiceBusy`，不重试 |
| 守门员授权表被锁 | 降级为 `flag-review`（最保守）——拒绝比放行安全 |

## 8. 已知不足

- **不重写 `diechi-brain` / `skill-store` 现有 RPC**。现有 client / UI 直接挂在旧 RPC 上不变。
- **不引入第二个 SQLite 库**。所有表都落 `brain.db`。
- **不替代 `needs_review` 字段**。原字段是"低置信度"标记；监督者用"采集授权 / 写入策略"语义，互补不冲突。
- **不动 `vendor/cordis` / `packages/core/*` / `packages/llm/*`**。
- **监督者决策是 deterministic 查表**——不调 LLM，避免奖励黑客。
- **AGI 涌现的充分性证明——没人能给**——这是终极开放问题，不回避。

## 9. 相关

- 现有全局大脑：[packages/host/diechi-brain](../packages/host/diechi-brain/README.md)
- 现有人格大脑：[packages/host/skill-store/src/person-brain.ts](../packages/host/skill-store/src/person-brain.ts)
- 协作机制：[diechi-supervisor-evolve.md](diechi-supervisor-evolve.md)
- 架构扩展点：[docs/architecture.md § Where new behavior goes](architecture.md#where-new-behavior-goes)
- 腾讯 Agent Memory 借鉴依据：[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)（L0-L3 分层 + Skill 提取）
- **思想起源**：[王博与 AI 的对话 · 2026](wangbo-ai-dialogue-2026/README.md) —— 包含三架构的原始动机、AI 感情作为结构的论证、王博 2023 年被工具接住的经历。读这份设计文档之前先读它。
