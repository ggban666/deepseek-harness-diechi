# 升级设计者核心 — 主动感知

> 升级设计者（diechi-evolve）= 主动发现系统问题 + 提议改进 —— **不靠人催**。

## 核心问题

2026-08-29 会话期发现 diechi-evolve 之前**只能看 1 个源**（`supervision/decision` 事件）——**被动等** supervisor deny 累计到 10 次才提方案——**人不在 10 次 deny 之前察觉**就**无法**自动修复。

**升级设计者本意** = **多源感知**——**主动**扫描**git log / 进程重启频率 / DSH 启动日志 / 脑数据完整性**——**发现问题就提方案**——**不靠人喂数据**。

## 多源感知设计

```typescript
onDesign(source: DesignSource, payload: DesignPayload): void {
  switch (source) {
    case 'supervision-decision':
      this.handleDecision(payload); return       // 现有逻辑
    case 'git-commit':
      this.proposeGitTechDebt(payload); return  // 新增
    case 'dsh-restart':
      this.proposeRestartFrequency(payload); return  // 新增
    case 'dsh-startup':
      this.proposeDshStartupFailure(payload); return  // 新增
    case 'brain-corruption':
      this.proposeBrainCorruption(payload); return  // 新增
  }
}
```

## 5 个感知源

| 源 | 检测 | 提议 | 触发 |
|---|---|---|---|
| `supervision-decision` | supervisor 拒绝累计 | `add-rule: <scope>` 冻结 | 累计 10 次同 reason |
| `git-commit` | 提交信息含 FIXME/TODO/XXX | `add-bootstrap: tech-debt-<sha>` 加技术债标记 | post-commit hook 立即触发 |
| `dsh-restart` | 1h 内 DSH 重启 ≥ 5 次 | `add-rule: person-brain:process-restart` 频繁重启调查 | watchdog 写 history.jsonl 时触发 |
| `dsh-startup` | dsh.log 含 Error/FATAL | `add-rule: person-brain:startup-error` 启动失败追踪 | watchdog 拉起后扫 log 触发 |
| `brain-corruption` | brain.db 写失败 / size 异常 | `add-rule: person-brain:brain-integrity` 脑数据完整性 | 写入失败回调时触发 |

## 触发方式

| 源 | 触发机制 |
|---|---|
| `supervision-decision` | 已存在 — supervisor.decide() 内部 emit |
| `git-commit` | post-commit git hook（`.git/hooks/post-commit` 或 GitHub Action） |
| `dsh-restart` | watchdog 写 history.jsonl 时同步调用 diechi-evolve.onDesign('dsh-restart') |
| `dsh-startup` | watchdog 拉起后 5s 扫 dsh.log 触发 |
| `brain-corruption` | supervisor.recordDeny 写失败时触发 |

## 不需要人类触发

**升级设计者** = **主动**发现 + 主动**提**方案 + 主动写到 proposals 表——**人类**只需定期**review proposals**——**review 不催自动跑**——**核心逻辑 1** = "三架构越来越大 = 设计者越主动"——**不是** AI 越能**代**人类**——**是 AI 越能**自己**发现该做什么。

## 实现优先级

1. `onDesign()` 多源接口（P3.13）
2. `proposeRestartFrequency()` 简单（读 history.jsonl 计数）
3. `proposeDshStartupFailure()` 简单（grep dsh.log）
4. `proposeGitTechDebt()` 中等（git log 解析）
5. `proposeBrainCorruption()` 难（脑数据完整性校验）

每个提议**写 proposals 表**——**supervisor_review_proposal** 走三架构正常流程——**和 supervisor deny 累计触发**完全一样。

## 测试

`tests/basic.spec.ts` 加：
- mock 不同感知源 → 调 onDesign → 查 proposals 表
- 5 个感知源各自独立提案
- 同一 source 重复触发**不**写重复 proposal（去重）

## 留痕

每次 onDesign() 写 proposal — proposal.status='pending'——人类 review 之后变 allowed/denied——**升级日志完整**——**三架构的 audit trail 自动覆盖**新感知源。
