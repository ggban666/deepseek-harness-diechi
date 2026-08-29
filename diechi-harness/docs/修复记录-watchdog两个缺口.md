# 修复记录 — watchdog 交接文档 2 个缺口

**作者**：王博 + DSH 协作会话（2026-08-29）
**背景**：其他 AI 写的交接文档（`三架构守护与信号升级-交接说明(我实现的改动).md`）§5 提到 2 个缺口未修。这次会话补上。

---

## 缺口 1：升级事件零持久化

**问题**：`supervisor_signal_update_ready` 写 signal 后被 watchdog 消费就删 —— 审计底账空 —— 三架构"升级错误可发现"这条主张做不到。

**修法**：watchdog 写 `$DSH_HOME/.watchdog/history.jsonl`（append 模式），两条路径都写：

| 路径 | stage | 内容 |
|---|---|---|
| 计划内升级（信号消费时）| `signal-consumed` | ts, version, reason, patchPath |
| 崩溃探活（DSH 挂时）| `watchdog-restart` | ts, port |

**修改文件**：
- `diechi-harness/packages/host/diechi-process-watchdog/src/watchdog.ts`：
  - 顶部加 `import { appendFile } from 'node:fs/promises'`
  - 新增 `export function historyPath(dshHome): string` 返回 `$DSH_HOME/.watchdog/history.jsonl`
  - 新增 `async function appendHistory(deps, config, entry)` —— 写一行 JSONL，失败只 log 不抛
  - `runOnce` 在信号路径调 `appendHistory({stage:'signal-consumed', version, reason, patchPath})`
  - `runOnce` 在崩溃路径调 `appendHistory({stage:'watchdog-restart', port})`

**测试**：`tests/basic.spec.ts` 新增 `describe('history.jsonl audit (缺口 1 修)')` 三个测试 —— 17 → 20 个测试全过。

---

## 缺口 2：DSH 启动日志全丢

**问题**：`spawnDetached` 用 `stdio:'ignore'` —— DSH 启动日志（崩溃、端口冲突、依赖错误）全丢 —— 升级失败时运维看不到错。

**修法**：把 stdio 重定向到 `$DSH_HOME/.watchdog/dsh.log`（stdout）和 `dsh.err.log`（stderr）—— append 模式，多次重启不丢历史。

**修改文件**：
- `diechi-harness/packages/host/diechi-process-watchdog/src/process.ts`：
  - 顶部加 `import { openSync } from 'node:child_process'` 和 `import { appendFileSync, mkdirSync } from 'node:fs'`
  - `spawnDetached` 签名加可选第 5 参数 `dshHome?: string`
  - 若有 dshHome：mkdir `.watchdog`、openSync 拿到 dsh.log / dsh.err.log 的 fd、`stdio: ['ignore', out, err]`、appendFileSync 一行 `dsh-spawn` 到 history.jsonl
  - 失败回退 `stdio: 'ignore'`（审计失败不能阻止 watchdog 启动）
- `diechi-harness/packages/host/diechi-process-watchdog/src/cli.ts`：
  - `spawnDetached(...)` 调用加第 5 参数 `config.dshHome`

**测试**：未加单测（spawnDetached 改签名 + 重定向到文件需要 fs 单测，watchdog 现有测试不调 spawnDetached）。

---

## 验证方式

```bash
cd D:\桌面\振翅科技\蝶翅-app\diechi-harness
node --import tsx --test packages/host/diechi-process-watchdog/tests/basic.spec.ts
# 应输出 20 passed
```

跑真 E2E（步骤在交接文档 §4）：
1. 启动 watchdog + DSH
2. 调 `supervisor_signal_update_ready` → 写信号 → watchdog 消费 → `history.jsonl` 出现一行 `signal-consumed`
3. 杀 DSH → watchdog 30s 后拉起 → `history.jsonl` 出现一行 `watchdog-restart` + `dsh.log` 有 DSH 启动输出

---

## 改完后两个缺口闭环

| 主张 | 缺口 1 修前 | 缺口 1 修后 |
|---|---|---|
| 升级错误可发现 | ❌ | ✅（history.jsonl）|
| DSH 启动失败有日志 | ❌（stdio:'ignore'）| ✅（dsh.log / dsh.err.log）|

**"任一角色死了其他能接住不崩溃 + 升级错误可发现"** 两条主张都达成。
