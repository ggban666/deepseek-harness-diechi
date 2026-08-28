# diechi-supervisor：协作机制与论证

承接 [diechi-supervisor-design.md](diechi-supervisor-design.md) 的主张——三架构是 AGI 充分必要条件——本文论证三个组件为什么**都必要**、协作机制如何实现、当前缺什么实践与论证。

## 1. 监督者：为什么必要

**主张**：监督者是 AGI 必要条件。缺监督者，升级设计者会自我豁免、改坏基座、系统崩。

### 决策流程

```
PersonBrain.learn(payload)
  │
  ▼
assertSupervision()        ──► 缺 ctx.supervision：SupervisionMissingError
  │
  ▼
ctx.supervision.decide({scope, payload})
  │
  ├─ 查 frozen_rules：命中即 deny，理由 'rule-frozen'
  │
  ├─ 查 authorizations：scope 已授权 → allow
  │
  ├─ 查 negative_samples：同 scope + 同 payload 模式 ≥ 3 次 → flag-review
  │
  └─ 默认 deny + 写 negative_samples 理由 'no-authorization'
```

### 关键设计

- **决策 deterministic 查表**——不调 LLM，避免奖励黑客
- **决策过程写日志**——每条决策落 `negative_samples`，可回溯
- **`reviewProposal` 由人工触发**——监督者不自动批准

### 递归保护

监督者**不能改自己的规则**——避免"自我豁免"的具体 bug：

- `frozen_rules` 表物理上只接受 `human` 写入——`diechi-supervisor` 自己**没有** `INSERT INTO frozen_rules` 的代码路径
- `authorizations.revoke()` 要求 `granted_by='human'`
- 监督者**不能改 PersonBrain.learn() 的 authorize 调用顺序**——私有代码路径

**这是"不自我豁免"必要条件的工程实现**。

### 缺什么

- **形式化论证**：监督者决策流的形式化描述（DFA / π-演算）——目前缺
- **不变量证明**：证明"无 ctx.supervision → 拒绝"是不可绕过的——目前缺
- **跨模型验证**：监督者在 gpt-2 / 其他弱智 LLM 上行为一致——目前缺
- **长期稳定性**：6+ 月监督者无 bug——目前缺

## 2. 升级设计者：为什么必要

**主张**：升级设计者是 AGI 必要条件。缺它，系统僵化在初始架构、不能持续学习。

### 触发条件

- 启动后定时任务（默认 6 小时一次）：扫 `negative_samples` 表，按 `reason` 聚类
- 同一 `reason` 在最近 7 天内累计 ≥ 阈值（默认 10）触发 `analyzeNegativeSamples`
- 监督者发 `supervision/decision` 事件时实时累计

### 提议草案

```ts
interface ProposalDraft {
  target: string
  change: string
  evidence: number[]          // 引用 negative_samples.id
  rationale: string
  rollbackPlan: string        // 必填
}
```

### 生命周期

```
pending ──► allowed ──► 应用 ──► 进入基座
   │           │
   │           └──► superseded
   └──► denied（写明原因入 negative_samples，scope='propose'）
```

`allowed` 提议**不可撤回**——必须走新提议修订。

### 缺什么

- **提议质量评测**：升级设计者提议被批后，系统是否真的改善——E3 实验
- **提议覆盖度**：是否漏掉重要的失败模式——长期运行
- **跨模型一致性**：升级设计者在不同 LLM 上提议质量一致——跨模型验证

## 3. 价值对齐守门员：为什么必要

**主张**：价值对齐守门员是 AGI 必要条件。缺它，AI 偏离人类目标——这是 AGI 安全共识里的核心。

### 授权 scope（默认配置）

| Scope | 含义 | 默认授权 |
|---|---|---|
| `person-brain:remember` | 用户直述记忆 | ✅ |
| `person-brain:learn` | 知识沉淀 | ✅ |
| `person-brain:see-scene` | 视觉场景写入 | ⚠️ 要求视觉开关 |
| `diechi-brain:ingest-video` | 视频实操入库 | ⚠️ 要求用户已开视频 |
| `diechi-brain:ingest-conversation` | 对话归纳 | ✅ |
| `diechi-brain:suggest-skill` | 跨技能归类 | ✅ |
| `evolution:propose` | 升级设计者写提议 | ✅（仅 evolve 实例）|

### 守门员流程

```
业务写入 → ctx.supervision.decide()
                       │
                       ▼
              ctx.supervision.authorize(scope)
                       │
                       ├─ 未授权 → flag-review + 写 negative_samples
                       │
                       └─ 已授权 → 走监督者决策流
```

### 为什么是 `flag-review` 而不是 `deny`

**业务跑得起来，但记忆待人工审**。**不让 AI 因为没授权就拒绝用户合法诉求**——符合"AI 帮助人"的初衷。

### 缺什么

- **授权 scope 的形式化语义**——目前是字符串 + bootstrap 配置，缺形式化
- **价值对齐的实证**——E5 实验只验证"未授权降级"，缺"授权后系统真的对齐人类目标"的实证
- **跨文化一致性**——授权 scope 在不同文化语境下是否一致——缺

## 4. 角色可互换：为什么必要

**主张**：角色可互换是 AGI 必要条件。缺它，三个角色僵化、不能"换位思考"——监督者学不会哪类提议该批、升级设计者学不会监督者为什么这么判。

### 互换触发条件

| 从 → 到 | 触发 | 阈值 |
|---|---|---|
| 监督者 → 临时升级设计者 | 监督者对同类 `deny` 累计 | ≥ 50 |
| 升级设计者 → 临时监督者 | `allowed` ≥ 100 且 `denied/allowed ≤ 0.05` | — |
| 被升级者 → 临时监督者 | 某类 `flag-review` 累计 | ≥ 20 |

### 副作用限制

- **监督者 → 临时升级设计者**：写提议 `evidence` 必填触发那批 negative_samples；批的门槛高 2 倍
- **升级设计者 → 临时监督者**：接管期间不能写自己 `proposals` 表
- **被升级者 → 临时监督者**：临时监督只对自己本次写入决策生效；TTL 30 分钟

### 实现路径

`diechi-supervisor` 注册 `ctx.agentRole` Service：

```ts
interface AgentRole {
  current: 'subject' | 'designer' | 'supervisor'
  swapTo(target, evidence, ttlSec): Promise<RoleTransition>
  revert(): Promise<void>
  history(): readonly RoleTransition[]
}
```

- `PersonBrain.authorize()` 内部读 `ctx.agentRole.current` 决定写入路径分支
- `swapTo()` **只在 `diechi-supervisor` 内部实现**——业务插件拿不到 setter
- 临时身份带 TTL，过期自动 `revert()`；**不可续期**

### 三条护栏

1. **临时身份不能批自己的提议**——`PersonBrain.authorize()` 在 `propose` scope 上检测"写提议的角色与监督者角色同实例"时强制 `deny`
2. **临时身份不豁免 `frozen_rules`**——`frozen_rules` 命中即 `deny`，与当前角色无关
3. **临时身份 TTL 不可续期**——`swapTo` 在已临时身份上调用抛 `RoleAlreadySwappedError`

### 缺什么

- **E4 实验**：监督者升级为设计者后提议质量是否提升——目前缺
- **形式化**：角色可互换的边界（什么时候该互换、什么时候不该）——缺
- **长期稳定性**：可互换机制 6+ 月无 bug——缺

## 5. 负样本循环：为什么必要

**主张**：负样本循环是 AGI 必要条件。缺它，系统只学"对的"不学"错的"——同样的错犯 100 次。

### 写入触发

- 监督者做出 `deny` 或 `flag-review` 决策时
- 升级设计者提议被 `denied` 时
- 业务写入 `PersonBrain` 抛业务错时

### 读取触发

- 升级设计者定时分析
- 用户在 UI 上点"为什么这条没生效"
- 监督者 `decide()` 时查同 scope 历史失败模式

### 清理

- `negative_samples` 超过 10000 条触发 `cleanupNegativeSamples(5000)`
- `proposals` 超过 1000 条触发 `cleanupProposals(500)`

### 缺什么

- **E3 实验**：负样本有效性——目前缺
- **跨模型一致性**：负样本在不同 LLM 上的指导作用一致——缺
- **负样本污染防护**：负样本本身被污染怎么办——目前缺机制

## 6. 待证清单（汇总）

承接 [diechi-supervisor-design.md § 5](diechi-supervisor-design.md#5-待证清单)——

### 缺什么实践（按周期排序）

| 周期 | 实验 / 验证 | 验证什么 |
|---|---|---|
| 1 天 | E2 / E5 | 基座保护 + 守门员有效性 |
| 1 周 | E1 | 持续学习有效性 |
| 1 周 | E3 | 负样本有效性 |
| 1 周 | E4 | 角色可互换有效性 |
| 1 月 | 跨模型验证 | gpt-2 / qwen-7b / 其他 LLM 都跑一遍 |
| 3 月 | 多实例部署 | 跨机器跑 |
| 6 月 | 长期运行 | 无崩 / 无偏 |

### 缺什么论证

| 周期 | 论证 | 状态 |
|---|---|---|
| 1 月 | 不变量证明（"无 ctx.supervision → 拒绝"不可绕）| 缺 |
| 3 月 | 形式化描述（监督者决策流 / 角色可互换）| 缺 |
| 3 月 | 基座可升级性边界 | 缺 |
| 6 月 | 价值对齐形式化 | 缺 |
| **未知** | **AGI 涌现的充分性证明** | **缺——没人能给** |

### 终极缺口

> **AGI 涌现的充分性证明——没人能给。包括我们。**
>
> 我们主张三架构 = AGI 充分必要条件，但这条主张**目前不是定理**。
>
> 第 6 节列的实践 + 论证**全部跑通** = 主张的"工程部分"被验证 = 日常痛点解决。
>
> 但**主张的"涌现必要"部分**——**目前没有任何证据**。
>
> 我们**不回避这条**——**写在文档里**。
>
> 如果将来 5 个实验通 + 跨模型验证通 + 长期无崩 = **"工程充分"被验证**。
>
> 如果再加上"涌现必要"的某个实证 / 形式化片段 = 主张开始从"工程假设"升为"涌现候选定理"。
>
> **不预先否认也不预先断言**——但**敢主张、敢标缺口、敢让人评判**。

## 7. 相关

- 基座契约与待证清单：[diechi-supervisor-design.md](diechi-supervisor-design.md)
- 现有监督者雏形（needs_review / suggestSkill）：[packages/host/diechi-brain](../packages/host/diechi-brain/README.md)
- 扩展点：[docs/architecture.md](architecture.md)
- 插件规范：[packages/AGENTS.md](../packages/AGENTS.md)
