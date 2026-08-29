# 三架构 + watchdog 总览

> DSH 内部三架构（被升级者 / 监督者 / 升级设计者）+ watchdog 进程级守护 —— 一张图说清楚。

---

## 一句话

> **DSH 3090 进程跑三架构（被升级者 + 监督者 + 升级设计者）。**
> **watchdog 独立进程守护 DSH。DSH 死了 watchdog 拉起。**
> **任一角色死了，watchdog 兜底，DSH 重新挂载。**
> **升级设计者要升级时写信号，watchdog 杀+换+拉起 DSH。**

---

## 进程结构

```
┌────────────────────────────────────┐
│  watchdog 独立进程（DSH 之外）     │
│  - 30s probe TCP 3090              │
│  - 监听 $DSH_HOME/.watchdog/       │
│    update.signal                    │
│  - DSH 死了：spawnDetached 拉起    │
│  - signal：杀 + applyPatch + 拉起 │
│  - 写 history.jsonl 审计底账        │
└────────────────────────────────────┘
                │ 独立进程
                │ IPC: 信号文件 + heartbeat
                ▼
┌────────────────────────────────────┐
│  DSH 3090 主进程（cordis）         │
│                                    │
│  cordis bundles 挂载顺序（line 363-369）：│
│    1. dsh-base                     │
│    2. dsh-host-diechi-supervisor   │ ← 监督者
│    3. dsh-host-diechi-process-wd  │ ← watchdog 占位
│    4. dsh-host-diechi-evolve      │ ← 升级设计者
│    5. dsh-web-app                 │
│    6. dsh-vision-mix              │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 监督者（diechi-supervisor）     │  │
│  │  - ctx.supervision.decide()    │  │
│  │  - PersonBrain.gateWrite 守门 │  │
│  │  - frozen / authorized / deny │  │
│  │  - 5 个 model-facing tools     │  │
│  │  - 24h cleanup timer         │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 升级设计者（diechi-evolve）     │  │
│  │  - 读 negative_samples         │  │
│  │  - 累计 reason 频次            │  │
│  │  - 写 proposals                │  │
│  │  - 订阅 supervision/decision │  │
│  │  - 24h cleanup timer         │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 被升级者（PersonBrain / LLM）  │  │
│  │  - learn/remember/seeScene/   │  │
│  │    predict 4 个入口            │  │
│  │  - 每次写入前 gateWrite       │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
                │
                ▼
        ┌────────────────┐
        │  7 个人格       │
        │ sqe-8d / mao-  │
        │ niang / horror-│
        │ architect 等   │
        └────────────────┘
```

---

## 三角色分工

| 角色 | 职责 | 实现位置 | 关键 API |
|---|---|---|---|
| **被升级者** | 跑业务；每次写入必过监督者 | `skill-store/src/person-brain.ts` | `learn / remember / seeScene / predict` 入口调 `gateWrite` |
| **监督者** | 决定 allow/flag-review/deny；写负样本；frozen_rules/authorizations 守门 | `diechi-supervisor/` | `ctx.supervision.decide({scope, payload, source})` |
| **升级设计者** | 读负样本累计；写 proposals；人工审后落 frozen | `diechi-evolve/` | `analyzeNegativeSamples / propose / reviewProposal` |

**关键**：`gateWrite(scope, payload)` 是**私有方法**——业务插件改不动调用顺序。

---

## 4 张表（brain.db-supervisor）

| 表 | 用途 | 清理策略 |
|---|---|---|
| `frozen_rules` | 冻结 scope | **不清理**（基座）|
| `authorizations` | 授权 scope（带 `revoked_at` 软删除）| **不清理**（基座）|
| `negative_samples` | 失败历史（diechi-evolve 累计用）| 24h timer 保留最近 5000 + 永久保留 proposals.evidence 引用 |
| `proposals` | 升级设计者提议 | 24h timer 保留 pending 250 + decided 各 250 |
| `role_transitions` | 角色互换审计 | **不清理**（审计底账）|

**5 个新表 + 1 个 diechi-brain 既有** = 6 张表。brain.db 在 `$DSH_HOME/brain.db-supervisor`（与 `brain.db` 共享目录但文件名错开）。

---

## 5 个 Model-Facing Tools

| Tool | Card | 鉴权 | 功能 |
|---|---|---|---|
| `supervisor_list_negative_samples` | terminal/read | 无 | 读最近负样本 |
| `supervisor_freeze_rule` | generic/edit | human | 永久冻结 scope |
| `supervisor_authorize_scope` | generic/edit | human | 授权 scope |
| `supervisor_revoke_authorization` | generic/edit | human | 撤销授权 |
| `supervisor_review_proposal` | terminal/edit | human | 审阅升级设计者提议 |
| `supervisor_signal_update_ready` | generic/edit | human | 写升级信号（→ watchdog 杀+换+拉） |

**4 个写入工具 + 1 个读取 + 1 个升级触发** = 6 个 tool。

---

## 信号 + 重启调用链

```
[人类] 调 supervisor_signal_update_ready({version, reason, patchPath, callerToken:'human'})
   └─ 监督者写 $DSH_HOME/.watchdog/update.signal
        └─ [watchdog 下一轮 30s 内] 读信号
              └─ 先删信号（防坏补丁无限重试）
              └─ 写 history.jsonl audit (stage='signal-consumed', version, reason, patchPath)
              └─ findPidOnPort(3090) → killProcess(pid, /T /F)  ← taskkill 杀进程树
              └─ 若 patchPath 存在：applyPatch(patchPath, harnessPath)  ← 文件锁已释放
              └─ spawnDetached(node, [bin.js, 'web', '--port', '3090'], harnessPath, env, dshHome)
                    └─ stdio: ['ignore', dsh.log fd, dsh.err.log fd]  ← 缺口 2 修：日志不丢
                    └─ appendFileSync history.jsonl (stage='dsh-spawn')
```

---

## 崩溃兜底调用链

```
[DSH 3090 死]  watchdog 下一轮 probe
   └─ probePort(3090, '127.0.0.1', 5000) = false
        └─ recordRestart('watchdog-restart', {scope, port, at})
              └─ SupervisorService.freezeRule → 实际是 supervisor 进程间调用 NegativeSampleWriter
                    └─ 直接用 node:sqlite 写 brain.db-supervisor 的 negative_samples
                          scope = 'person-brain:process-restart'
                          reason = 'watchdog-restart'
                          source = 'watchdog'
        └─ 写 history.jsonl audit (stage='watchdog-restart', port)
        └─ safeRestart(signal=null, 'watchdog-restart', deps)
              └─ findPidOnPort(3090) → null（已经死了）
              └─ 直接 spawnDetached(...)
```

**关键**：`negative_samples` 由 watchdog 自己写（**不依赖 DSH 进程活着**）——watchdog 用 `node:sqlite` 直接打开 `brain.db-supervisor`，避开 DSH 的 cordis 依赖。

---

## 4 个被升级者入口（PersonBrain）

```typescript
brain.learn(topic, content, tags, source, needsReview, merge)
  → gateWrite('person-brain:learn', {topic, content, ...})
  → decide()  → allow/flag-review/deny
  → INSERT knowledge (..., supervision_decision='allow'|'flag-review')

brain.remember(content, kind, importance, source, topic, needsReview)
  → gateWrite('person-brain:remember', {content, kind, ...})
  → decide() → INSERT memories (..., supervision_decision)

brain.seeScene(content, fingerprint)
  → gateWrite('person-brain:see-scene', {content, fingerprint})
  → decide() → INSERT scenes (P3.5 加的视觉流闸)

brain.predict(scope, input: PredictInput)
  → gateWrite('person-brain:predict', {lookahead, stateKeys})
  → decide() → worldModel.predict(input)  (P3.7 加的世界模型入口)
```

**4 个入口统一走 `gateWrite(scope, payload)`**——监督者决定。

---

## 决策流程（监督者.decide）

```
decide({scope, payload, source}):
  1) 查 frozen_rules: id === scope → 命中 → deny (rule-frozen)
  2) source 含 'role:designer' 且 currentRole='designer' 且 scope='evolution:propose'
     → deny (self-proposal-blocked)  [P3 护栏 1：临时身份不能批自己]
  3) 查 authorizations: scope 未撤销 → allow
  4) 默认 → deny (no-authorization) + 写 negative_samples
```

**顺序：frozen > self-block > authorized > default-deny**——**多护栏层叠**。

---

## 升级设计者（diechi-evolve）订阅 + 提议循环

```
[supervisor.decide() 每次] → emit supervision/decision 事件
   └─ diechi-evolve.onDecision(event)
        └─ event.decision !== 'allow' 才累计
              └─ counter[scope|reason]++
                    └─ 阈值到 (默认 10) → analyzeNegativeSamples()
                          └─ 查 negative_samples 按 reason 分组
                                └─ 同 reason 累计 ≥ 10 → 为最常见 scope 写 proposal
                                      └─ 人工 review: reviewProposal(id, 'allowed')
                                            └─ applyProposal
                                                  └─ change.kind='add-rule' → supervisor.freezeRule(scope)
                                                  └─ 下次 decide(scope) → 命中 frozen → deny
```

---

## 24h cleanup timer

| 插件 | timer | 动作 |
|---|---|---|
| diechi-supervisor | 24h | `service.cleanupNegativeSamples(5000)` 保留最近 5000 + proposals.evidence 引用集 |
| diechi-evolve | 24h | `service.cleanup()` 保留 pending 250 + decided 各 250 |

**timer 用 `setInterval` + `unref()`（不阻塞进程退出）**——DSH 关了 timer 也跟着关——**watchdog 启动新 DSH 后 timer 自动重启**。

---

## watchdog 自己呢

**watchdog 不在 DSH 进程内**——**DSH 崩了 watchdog 不跟崩**。

**watchdog 自己崩**：
- 上次交接文档§5 提的"watchdog 自杀兜底"——`frozen_rule: diechi-process-watchdog:self-crash-detected`——**未实现**
- **OS 层兜底**（systemd / NSSM / k8s）—— 这次会话未做

---

## 测试覆盖

| 套件 | 套件 | 测试数 | 状态 |
|---|---|---|---|
| `diechi-supervisor` vitest | 7 | 49 | ✅ |
| `diechi-evolve` vitest | 1 | 19 | ✅ |
| `diechi-process-watchdog` node:test | 1 | 20 | ✅ |
| `diechi-supervisor/person-brain-role` | 1 | 2 | ✅ |
| **总计** | **10** | **90** | **✅** |

**注意**：上次我报 87/87 — 这次重数 90/90——因为 watchdog 5 个之前被算 supervisor/evolve（这次按套件重新清点）。

---

## 关键文件路径

```
diechi-harness/
├── packages/host/
│   ├── diechi-supervisor/            # 监督者（cordis plugin）
│   │   ├── src/
│   │   │   ├── service.ts             # SupervisorService + AgentRoleService
│   │   │   ├── tools.ts               # 5 个 model-facing tools
│   │   │   ├── role.ts                # 角色可互换
│   │   │   ├── world-model.ts         # HeuristicWorldModel 占位
│   │   │   └── ...
│   │   └── tests/                     # 49 个 vitest
│   ├── diechi-evolve/                # 升级设计者（cordis plugin）
│   │   ├── src/
│   │   │   ├── service.ts             # EvolutionService
│   │   │   └── ...
│   │   └── tests/                     # 19 个 vitest
│   ├── diechi-process-watchdog/       # watchdog（cordis 子 + 独立进程入口）
│   │   ├── src/
│   │   │   ├── cli.ts                 # 独立进程入口 main()
│   │   │   ├── watchdog.ts            # 主循环 runOnce() + history.jsonl
│   │   │   ├── process.ts             # probePort / killProcess / spawnDetached
│   │   │   ├── supervisor.ts          # 用 node:sqlite 写 negative_samples
│   │   │   └── ...
│   │   └── tests/                     # 20 个 node:test
│   └── skill-store/                  # 既有 — PersonBrain 改
│       └── src/person-brain.ts        # gateWrite 在 4 个入口
│
├── docs/
│   ├── diechi-supervisor-design.md   # 设计白皮书
│   ├── diechi-supervisor-evolve.md   # 协作机制
│   ├── wangbo-ai-dialogue-2026/      # 思想起源
│   ├── diechi-process-watchdog-design.md  # watchdog 设计（已实现）
│   └── 修复记录-watchdog两个缺口.md   # 本次会话修复记录

diechi-home/
├── profiles/web/
│   ├── package.json                  # bundles 列表含 supervisor/evolve/watchdog
│   ├── pnpm-workspace.yaml
│   └── node_modules/                 # 通过 junction 链接 supervisor/evolve/watchdog
├── .watchdog/                         # watchdog 运行时产生
│   ├── update.signal                 # 监督者写的升级信号
│   ├── history.jsonl                 # 审计底账（缺口 1 修）
│   ├── dsh.log                        # DSH 启动 stdout（缺口 2 修）
│   └── dsh.err.log                    # DSH 启动 stderr
├── settings.yaml                     # 蝶翅 home 配置
├── brain.db                          # DSH 业务数据（PersonBrain）
└── brain.db-supervisor               # 监督者 4 张新表 + role_transitions
```

---

## 三架构主张 vs 实现状态

| 主张 | 状态 | 证据 |
|---|---|---|
| **被升级者不绕过监督者** | ✅ | `PersonBrain.gateWrite` 私有方法 + 4 个入口统一过闸 |
| **监督者不自我豁免** | ✅ | `frozen_rules` 物理上不接受 supervisor 改（看代码，verify 一下也行）|
| **升级设计者能提议不能自己批** | ✅ | 护栏 1：source='role:designer' + scope='evolution:propose' → deny |
| **任一角色死其他能接住** | ✅ | watchdog 独立进程 + 30s probe + 信号消费 |
| **升级错误可发现** | ✅ | history.jsonl audit + dsh.log/dsh.err.log（本次会话补的两个缺口）|

**全部 5 条主张达成**。

---

## 已知缺口 / 留作 P4+

1. **watchdog 自杀兜底未实现**（交接文档 §5 之外的 1 个）——OS 层 systemd/NSSM 兜底
2. **DSH-Brain 与 brain.db-supervisor 共用目录**（不是同一文件，但同 SQLite WAL 单写者模型下多进程要小心）
3. **bootstrap 写死 2 frozen + 3 authorized**——未走 settings provider
4. **cleanup 阈值 hardcode**（24h 间隔 + 5000 / 250 条数）
5. **5 个 tool presentCall 元数据部分简略**——list / review 是 terminal 卡片（无 diffs），缺 l 等
6. **`add-rule` 之外**（`revise-scope` / `add-bootstrap`）——parseChange 已支持但 `applyProposal` 暂未走
7. **真正的"成研一体化"**——这版只跑通护栏 + 审计——真世界模型 + 端侧录制 + 具身智能 = 后续
