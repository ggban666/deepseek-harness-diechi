# diechi-process-watchdog · 三架构进程级守护

三架构闭环的最后一块拼图。补的是这个洞：

> DSH 3090 进程死了 → supervisor / evolve / tools / cleanup timer 全部跟着死 → 三架构失效

历史实证（2026-08-28）：3 次 background job 启动 DSH 留下孤儿进程占着 3090，
人不知道该 kill 哪个，而三架构对「被升级者已经没了」这件事**完全无感**。

## 为什么必须是独立进程

三架构的规则是「任一角色死了，其他能接住不崩溃」。
如果 watchdog 作为 cordis 插件跑在 DSH 进程内，那么 DSH 一崩，**watchdog 跟着一起死** ——
这条规则在**最需要它的那一刻**恰好失效。

所以：

| 入口 | 作用 | 是否跑主循环 |
| --- | --- | --- |
| `src/cli.ts` | **独立 Node 进程**，与 DSH 平级 | ✅ 是 |
| `src/index.ts` | cordis 插件，提供 `ctx.watchdog` Service（信号路径与读写） | ❌ 否 |

`index.ts` 挂进 bundle 是为了让监督者拿到信号读写能力，
**不是**为了在进程内守护。

## 启动

```bat
D:\桌面\振翅科技\蝶翅-app\deploy-tools\start-watchdog.cmd
```

或手动：

```bat
set DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home
cd /d D:\桌面\振翅科技\蝶翅-app\diechi-harness
node --import tsx packages/host/diechi-process-watchdog/src/cli.ts
```

停止：Ctrl+C 或关窗口。**不会杀掉已拉起的 DSH**。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | 无（必需） | 数据目录，信号与 `brain.db-supervisor` 都在这 |
| `DIECHI_HARNESS_PATH` | `DSH_HOME/../diechi-harness` | spawn DSH 的 cwd |
| `WATCHDOG_PORT` | `3090` | 探活与重启端口 |
| `WATCHDOG_INTERVAL_SEC` | `30` | 探活间隔 |
| `WATCHDOG_PROBE_MODE` | `port` | `port` = TCP 探活；`command` = 跑 `dsh web --dump-config` |

## 每轮做什么

```
1. 读信号文件 $DSH_HOME/.watchdog/update.signal
   ├─ 有 restart 信号 → 先删信号 → 杀进程 → 拷补丁 → 拉起
   └─ 没有           → 探活
2. 探活（TCP 连端口）
   ├─ 通   → 什么都不做
   └─ 不通 → 写 negative_samples → 杀 → 拉起
```

**信号优先于探活**：计划内升级是人类明确要求的动作，不该被探活噪声盖掉。

**先删信号再重启**（与早期伪代码不同）：先重启再删的话，重启失败时信号还在，
下一轮会拿同一份坏补丁无限重试。先删，失败兜底交给探活 ——
探活发现没起来会再用 `watchdog-restart` 拉一次，且不带坏补丁。

## 升级信号

人类调监督者的 `supervisor_signal_update_ready`（`callerToken` 必须是 `'human'`），
监督者写：

```json
{
  "version": "v0.2.0-rc.6",
  "action": "restart",
  "requestedBy": "diechi-supervisor",
  "requestedAt": "2026-08-29T00:00:00Z",
  "reason": "manual-upgrade",
  "patchPath": "$DSH_HOME/.watchdog/patches/v0.2.0-rc.6"
}
```

**DSH 不能升级自己** —— 要替换的补丁文件正被自己锁着，必须先被外部进程杀掉，
文件锁释放后才能换。所以监督者只写信号，由 watchdog 执行「杀 → 换 → 拉起」。

## 几处刻意的偏离

1. **探活用 TCP 而非 `dsh web --dump-config`**
   跑命令每次要 spawn pnpm + node（秒级），30 秒一轮太重；
   且 pnpm 在受限环境下会失败，导致探活恒定失败 → 误判 DSH 死了 → 不必要的重启。
   端口能连上就说明进程活着，这已经是 watchdog 需要的判据。
   需要深度校验时设 `WATCHDOG_PROBE_MODE=command`。

2. **拉起用 `node apps/cli/lib/bin.js` 而非 `pnpm exec dsh`**
   watchdog 的存在意义就是「在环境已经不太对劲时还能把 DSH 拉起来」，
   启动路径上不该挂一个可有可无的包管理器。

3. **不复用 `SupervisorDb`**
   watchdog 只有一个进程要写 `negative_samples`。去 import supervisor 包会把整个 host 插件
   （cordis / skill-store 传递依赖）拖进启动路径。这里自己开 `node:sqlite` 连接，
   schema 用 `CREATE TABLE IF NOT EXISTS` 与 `diechi-supervisor/src/db.ts` 保持一致。
   **两处若漂移，以 supervisor 那边为准**（它是表的所有者）。

4. **杀进程用 `taskkill /T`（Windows）**
   只 kill 主进程会留下占端口的孤儿进程 —— 这正是 2026-08-28 那三次事故的形式。
   `/T` 杀整棵进程树。taskkill 不可用时回退 `process.kill`（不杀子树，已注明）。

5. **记负样本失败不阻断重启**
   数据库写不进去时重启仍要发生。为了记一笔账而放弃救活被升级者，是本末倒置。

## 测试

```bash
cd diechi-harness
node --import tsx --test packages/host/diechi-process-watchdog/tests/basic.spec.ts
```

17 个用例，覆盖：正常探活 / 崩溃重启 / 信号触发 / 信号损坏 / action 非法 /
重启抛错不冒泡 / 循环启停 / 信号读写 / 负样本落库 / 端口校验。

**为什么用 node:test 而不是 vitest**：本仓库默认用 vitest，但 vitest 4 的 worker
在当前受限环境会直接撞内存上限（`ERR_WORKER_OUT_OF_MEMORY`），
forks / threads / `--no-isolate` 三种模式都试过，worker 起不来。
这是环境问题。包内保留了 `vitest.config.ts`，环境恢复后可直接迁回：

```bash
pnpm vitest run packages/host/diechi-process-watchdog/
```

**铁律：测试绝不真去 spawn 或 kill 3090。** 所有副作用通过 `WatchdogDeps` 注入 mock。

## 已知限制

- watchdog 自身崩溃由 OS 进程监控管（NSSM / systemd / 任务计划），
  三架构不重复造 OS 进程监控。
- 不处理 SIGKILL —— 那是用户强杀，OS 知道。
- watchdog 自己挂了谁来兜底，是「先有鸡还是先有蛋」问题，设计文档标为 P5+ 未解。
- 补丁拷贝时跳过 `node_modules`（补丁只该带源码与构建产物）。

## 相关

- 设计文档：`docs/diechi-process-watchdog-design.md`
- 执行说明：`给其他AI看的执行说明-watchdog+监督者信号机制.md`（仓库根）
- 三架构白皮书：`docs/diechi-supervisor-design.md`
- mount 顺序：`diechi-home/profiles/web/README.md`
