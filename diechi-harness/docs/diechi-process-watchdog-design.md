# diechi-process-watchdog — 进程级监督设计

## Problem

DSH 3090 跑着 7 个人格 + diechi-supervisor + diechi-evolve 三个 host 插件。**任何进程崩溃**（OOM / 异常 / 被 kill）都意味着"被升级者"没了 —— 即使 supervisor 还活着，**也接不上**：

- supervisor 需要 `ctx.supervision.decide()` —— 这是个 in-memory Service —— 进程死 = Service 死
- diechi-evolve 累计负样本需要 `negative_samples` 表落库 —— 进程死 = 累计 0 失
- 24h cleanup timer / event bus 订阅全部丢失

DSH 本身有 cordis effect 生命周期，但**只在 cordis 内部清理** —— 不会自动重启。

**当前实证**（2026-08-28 实际发生）：3 次 background job 启动 DSH 留孤儿进程占 3090 —— 人类不知道该 kill 哪个 —— supervisor 不知道"端口被占" —— 升级设计者不知道"进程死了" —— **三架构**对此事**完全无感**。

## Decision

新增 `diechi-process-watchdog` host 插件（**P4 阶段，**不在 P0-P3.12 范围**），职责：

1. **健康探针**：每 N 秒（默认 30）调 `dsh web --dump-config`（DSH 自带命令，无侵入）—— 验证 DSH 还活着 + 输出结构 OK
2. **进程组管理**：cordis 启动时记录主进程 PID + PPID；崩溃检测（健康探针连续 N 次失败 / 进程心跳信号）→ 触发重启
3. **崩溃前 dump**：重启前调 `supervisor_freeze_rule({id: 'process-restart-marker', reason: 'auto'})` —— 写 `negative_samples({scope: 'process-restart', reason: 'process-crash'})` —— diechi-evolve 累计 10 次 → 提议 `add-rule: person-brain:process-watchdog` → 人工审 → frozen_rules
4. **重启策略**：默认 `spawn` 新进程替换（macOS/Linux `posix_spawn` / Windows `CreateProcess`）—— 受 supervisor 调度的 fork-and-replace；DSH 重启后 supervisor 重 attach
5. **基座保护**：watchdog 本身是 host 插件 —— 自身崩溃由 OS 进程监控管（k8s / systemd / NSSM）—— 三架构不重复造 OS 进程监控

## Wiring（参考 DSH 当前架构）

```
cordis host plugin
  ├── 启动时：ctx.effect 装：
  │     ├── 探针 timer (30s 间隔)
  │     ├── 进程心跳 timer (5s 间隔)
  │     └── exit handler (process.on('exit'))
  ├── 探针失败 N 次：
  │     ├── 1. 写 negative_samples({scope: 'process-restart', reason: 'probe-fail', source: 'watchdog'})
  │     ├── 2. emit supervision/decision 事件
  │     ├── 3. diechi-evolve handleDecision 累计
  │     └── 4. 阈值到 → 提议 → 人工审
  └── 进程死信号：
        ├── 1. 同上 1-4
        └── 2. spawn dsh web 替换（受 supervisor attachBrain）
```

## 与现有三架构的契约

- **依赖 supervisor**：watchdog 通过 `ctx.supervision` 写 `negative_samples` —— 无 supervisor 不装 watchdog
- **依赖 ctx.evolution 累计**：watchdog 不直接调 diechi-evolve —— 只 emit 事件让 diechi-evolve 订阅处理
- **mount 顺序**：`dsh-base → dsh-host-diechi-supervisor → dsh-host-diechi-process-watchdog → dsh-host-diechi-evolve → dsh-web-app` —— watchdog 在 supervisor 之后、evolve 之前
- **基座保护**：watchdog 自己崩溃 = 设计故障 —— 抛出 `WatchdogSelfCrashError` 让 diechi-supervisor 的 frozen_rule `diechi-process-watchdog:self-crash-detected` 兜底 —— 人工审后再启动

## Implementation Notes

```typescript
// 伪代码
function watchDSH(ctx: Context, sup: SupervisionContext): WatchdogHandle {
  const probe = setInterval(async () => {
    try {
      const out = await execFile('dsh', ['web', '--dump-config'], { timeout: 5000 })
      if (!out.includes('dsh-base')) throw new Error('dump-config incomplete')
    } catch (e) {
      await sup.recordDeny(
        { scope: 'person-brain:process-restart', payload: { reason: 'probe-fail', err: String(e) }, source: 'watchdog' },
        'probe-fail',
      )
      restartDSH()
    }
  }, 30_000)

  process.on('exit', () => {
    sup.recordDeny(
      { scope: 'person-brain:process-restart', payload: { reason: 'process-exit', code: process.exitCode }, source: 'watchdog' },
      'process-exit',
    )
  })

  return { dispose: () => clearInterval(probe) }
}
```

## Acceptance Criteria

- [ ] watchdog 包通过 `pnpm tsc -b` + `pnpm tsdown`
- [ ] watchdog 包在 `diechi-harness/packages/host/diechi-process-watchdog/` 路径下
- [ ] 集成测试：模拟进程崩溃 → watchdog 写 `negative_samples` → diechi-evolve 累计 → 提议
- [ ] `diechi-home/profiles/web/package.json` bundles 列表插入 watchdog（在 supervisor 之后、evolve 之前）
- [ ] watchdog 用 `pnpm vitest` 跑通单测 + integration
- [ ] watchdog 用 `pnpm test` 跑通真启动模拟（5 分钟内完成）
- [ ] Agent Note `2026-09-XX-diechi-process-watchdog.md` 写完（按 AGENTS.md 格式）

## Alternatives Considered

- **用 PM2 / nodemon 跑 DSH**：OS 进程监控 —— 但需要新引入运维工具 —— 三架构目标失败（设计者无法知道为什么被升级者崩了）
- **DSH 内部 fork 子进程**：self-restart —— 但 DSH 已经在 cordis 内部 —— 子进程没 cordis lifecycle —— 等于裸 DSH
- **diechi-supervisor 自己负责 watchdog**：监督者变臃肿 —— 不符合"三角色互相独立"原则
- **让人类用 systemd / k8s 配**：超出 DSH 范围 —— 但 DSH 该提供"被启停的契约"让 OS 工具能接

## Consequences

- 进程级监督下沉到 diechi-supervisor 下方 —— 真正的基座保护
- 监督者新增"process-restart" scope —— frozen / authorized 都可配
- 升级设计者新增"重启频率"维度 —— 高频重启提议"换底层（OOM 泄漏 / 资源不足）"
- 已知限制：watchdog 不处理 SIGKILL —— 那就是用户强杀 —— OS 知道
- 已知限制：watchdog 自身崩溃 → frozen_rule `diechi-process-watchdog:self-crash-detected` 兜底 —— 但**谁来触发 frozen？** —— 这是个**先有鸡先有蛋**问题 —— P5+ 解决

## Related

- 设计文档：[diechi-supervisor-design.md](diechi-supervisor-design.md)
- 协作机制：[diechi-supervisor-evolve.md](diechi-supervisor-evolve.md)
- 思想起源：[wangbo-ai-dialogue-2026/](../wangbo-ai-dialogue-2026/dialogue.md) § 三架构主语
- 当前进程死亡实证（2026-08-28）：3 次 background job 启动 DSH 留孤儿进程占 3090 —— human 通过 taskkill 手工 kill —— 三架构对此无感
