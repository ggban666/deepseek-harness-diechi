# 给其他 AI 的执行说明：watchdog + 监督者信号机制

**作者**：王博与 DSH 协作会话
**目的**：让三架构真正闭环——**任一角色死了，其他能接住不崩溃**
**当前缺口**：DSH 3090 进程死亡 → supervisor / evolve / tools / cleanup timer 全部死 → 三架构失效
**修复方案**：加 watchdog 独立进程 + 监督者写升级信号

---

## 现状（你要解决什么）

当前 `D:\桌面\振翅科技\蝶翅-app\` 下：
- `diechi-harness/packages/host/diechi-supervisor/` —— 监督者 host 插件 ✅ ship（57 个测试过）
- `diechi-harness/packages/host/diechi-evolve/` —— 升级设计者 host 插件 ✅ ship（19 个测试过）
- `diechi-harness/docs/diechi-process-watchdog-design.md` —— watchdog 设计 ✅
- `.agents/notes/proposed/process/2026-08-28-diechi-process-watchdog.md` —— proposed Agent Note ✅

**但**：
- watchdog 进程**没实现** —— 设计文档 + proposed 状态
- DSH 3090 进程**没装** diechi-supervisor/evolve（实际跑的是老 DSH）—— `diechi-home/profiles/web/package.json` 的 bundles 列表虽然加了，但 `pnpm install` 没真装上
- 之前的实证（2026-08-28）：3 次 background job 启动 DSH 留孤儿进程占 3090 —— human 手工 taskkill —— 三架构对此无感

---

## 目标

让三架构**真闭环**——实现这一条规则：

> **任何角色（被升级者 / 监督者 / 设计者）死了，剩下的能接住不崩溃。**

**实现路径**：
1. **DSH 主进程**（含被升级者 + 监督者 + 设计者）—— **正常跑三架构**
2. **watchdog 独立进程** —— **进程外监控** —— DSH 死了拉起 + 信号驱动升级
3. **监督者写升级信号** —— **DSH 主进程不参与升级** —— watchdog 杀+替换+拉起

**为什么不简单 kill 老的拉新的**：
- DSH 杀自己会丢内存状态（加载的 PersonBrain、negotiated agents、active role transition）
- 升级要换文件 —— **文件被 DSH 进程锁住** —— 杀之前换不了
- **所以三架构处理**：**监督者说"该升级了" → 写信号 → watchdog 杀 DSH → DSH 死了才能换文件 → 拉起新 DSH → 升级完成**

---

## 实施步骤（按这个顺序做）

### 步骤 1：完成 `diechi-home/profiles/web` 的 pnpm 装包

DSH 启动时报 "cannot resolve profile bundle @deepseek-ai/dsh-host-diechi-supervisor" —— 因为 profile 自己的 `node_modules` 没装这俩包。修法：

`diechi-home/profiles/web/package.json` 已有：
```json
"dependencies": {
  "dsh-vision-mix": "^0.2.2",
  "@deepseek-ai/dsh-host-diechi-supervisor": "file:../../../diechi-harness/packages/host/diechi-supervisor",
  "@deepseek-ai/dsh-host-diechi-evolve": "file:../../../diechi-harness/packages/host/diechi-evolve"
}
```

跑：
```bash
cd D:\桌面\振翅科技\蝶翅-app\diechi-home\profiles\web
set CI=true
pnpm install --no-frozen-lockfile --ignore-scripts
```

如果 `file:` link 不工作（pnpm 10+ 行为变了），备选：
```bash
# 在 diechi-harness 装全 workspace（让 supervisor/evolve 进入 diechi-harness/node_modules）
cd D:\桌面\振翅科技\蝶翅-app\diechi-harness
set CI=true
pnpm install --no-frozen-lockfile --ignore-scripts
# 然后 junction 进 diechi-harness/node_modules：
mkdir diechi-harness\node_modules\@deepseek-ai
mklink /J diechi-harness\node_modules\@deepseek-ai\dsh-host-diechi-supervisor diechi-harness\packages\host\diechi-supervisor
mklink /J diechi-harness\node_modules\@deepseek-ai\dsh-host-diechi-evolve diechi-harness\packages\host\diechi-evolve
```

### 步骤 2：实现 watchdog 独立进程

**新建** `D:\桌面\振翅科技\蝶翅-app\diechi-harness\packages\host\diechi-process-watchdog\`

**目录结构**（参考 diechi-supervisor）：
```
packages/host/diechi-process-watchdog/
├── package.json
├── tsconfig.json
├── cordis.yml
├── README.md
├── src/
│   ├── index.ts          # apply(ctx) cordis 入口（diechi-supervisor 子包）
│   ├── watchdog.ts        # watchdog 主循环（probe + signal 监听）
│   ├── supervisor.ts      # 监督者信号 API 客户端（通过 HTTP 调 ctx.supervision.decide）
│   ├── process.ts         # 进程信号 + spawn + kill（cross-platform Node.js）
│   ├── types.ts
│   └── invariant.ts
└── tests/
    └── basic.spec.ts
```

**核心逻辑**（伪代码）：

```typescript
// watchdog 主循环
async function watch() {
  while (true) {
    await sleep(WATCHDOG_PROBE_INTERVAL_SEC * 1000)  // 默认 30s

    // 1) 检查信号文件（计划内升级）
    if (await signalFileExists('diechi.update.signal')) {
      const sig = await readSignalFile()
      if (sig.action === 'restart') {
        await restartDSH(sig)
        await deleteSignalFile()
        continue
      }
    }

    // 2) 探活（崩溃兜底）
    if (!(await dshAlive())) {
      // 写 negative_samples（diechi-supervisor API）
      await sup.recordDeny(
        { scope: 'person-brain:process-restart', payload: { reason: 'watchdog-restart', exitCode: 'unknown' }, source: 'watchdog' },
        'watchdog-restart',
      )
      await restartDSH({ reason: 'watchdog-restart' })
    }
  }
}

async function dshAlive(): Promise<boolean> {
  // 调 dsh web --dump-config — DSH 自带无侵入命令
  try {
    const out = await execFile('pnpm', ['exec', 'dsh', 'web', '--dump-config'], {
      cwd: diechiHarnessPath,
      timeout: 5000,
      env: { ...process.env, DSH_HOME: diechiHomePath },
    })
    return out.stdout.includes('dsh-base') && out.exitCode === 0
  } catch {
    return false
  }
}

async function restartDSH(sig: { reason: string; version?: string }) {
  // 1) 杀老进程
  if (dshPID) {
    process.kill(dshPID, 'SIGTERM')
    await sleep(2000)
    if (alive(dshPID)) process.kill(dshPID, 'SIGKILL')
  }

  // 2) 替换补丁（杀完之后文件锁释放）
  if (sig.version) {
    const newPath = path.join(updatesPath, sig.version)
    const currentPath = diechiHarnessPath
    await copyDir(newPath, currentPath, { filter: skipNodeModules })
  }

  // 3) 拉起新进程
  const child = spawn('pnpm', ['exec', 'dsh', 'web', '--port', '3090'], {
    cwd: diechiHarnessPath,
    env: { ...process.env, DSH_HOME: diechiHomePath },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  dshPID = child.pid
}
```

**信号文件位置**：`$DSH_HOME/.watchdog/update.signal`

```json
{
  "version": "v0.2.0-rc.6",
  "action": "restart",
  "requestedBy": "diechi-supervisor",
  "requestedAt": "2026-08-28T12:00:00Z",
  "reason": "manual-upgrade",
  "patchPath": "$DSH_HOME/.watchdog/patches/v0.2.0-rc.6"
}
```

### 步骤 3：监督者写信号

**修改** `D:\桌面\振翅科技\蝶翅-app\diechi-harness\packages\host\diechi-supervisor\src\tools.ts`

**新增 RPC tool**：
```typescript
{
  name: 'supervisor_signal_update_ready',
  description: '监督者向 watchdog 写升级信号。caller 必须是 human。',
  parameters: {
    version: { type: 'string', required: true },
    reason: { type: 'string', required: true },
    patchPath: { type: 'string' },
  },
  async execute(args) {
    // human-only 鉴权
    if (args.callerToken !== 'human') return { ok: false, error: 'callerToken 必须为 "human"' }

    // 写信号文件
    const signalPath = path.join(process.env.DSH_HOME, '.watchdog', 'update.signal')
    await fs.mkdir(path.dirname(signalPath), { recursive: true })
    await fs.writeFile(signalPath, JSON.stringify({
      version: args.version,
      action: 'restart',
      requestedBy: 'diechi-supervisor',
      requestedAt: new Date().toISOString(),
      reason: args.reason,
      patchPath: args.patchPath,
    }))

    return { ok: true, signalPath }
  },
}
```

**人类工作流**：
1. 人类升级 DSH（如 `git pull` + `pnpm install`）
2. 人类调 `supervisor_signal_update_ready({version: 'v0.2.0-rc.6', reason: 'manual-upgrade'})`
3. 监督者写信号文件
4. watchdog 进程检测到信号
5. watchdog 杀 DSH → 替换文件 → 拉起新 DSH
6. **DSH 进程**"自杀"是** watchdog 杀的**——**不是 DSH 自己 kill 自己**——**基座保护 OK**

### 步骤 4：profile 装 watchdog bundle

`diechi-home/profiles/web/package.json` bundles 列表加 `dsh-host-diechi-process-watchdog`（位置在 `dsh-host-diechi-supervisor` 之后、`dsh-host-diechi-evolve` 之前）：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-host-diechi-supervisor",
  "@deepseek-ai/dsh-host-diechi-process-watchdog",
  "@deepseek-ai/dsh-host-diechi-evolve",
  "@deepseek-ai/dsh-web-app",
  "dsh-vision-mix"
]
```

`diechi-home/profiles/web/pnpm-workspace.yaml` 加 watchdog 路径：

```yaml
packages:
  - .
  - ../../../diechi-harness/packages/host/diechi-supervisor
  - ../../../diechi-harness/packages/host/diechi-process-watchdog  # 新
  - ../../../diechi-harness/packages/host/diechi-evolve
  - ../../../diechi-harness/packages/host/skill-store
  - ../../../diechi-harness/packages/runtime-diagnostics/invariants
  - ../../../diechi-harness/vendor/cordis
  - ../../../diechi-harness/vendor/loader
  - ../../../diechi-harness/vendor/schemastery
  - ../../../diechi-harness/vendor/cosmokit
```

### 步骤 5：watchdog 进程入口

`watchdog 不是一个 cordis plugin 启动**——它是独立 Node 进程**，跟 DSH 进程平级。

启动方式：Windows 用 NSSM / Task Scheduler / 自建 cmd：

`D:\桌面\振翅科技\蝶翅-app\start-watchdog.cmd`：
```cmd
@echo off
cd /d D:\桌面\振翅科技\蝶翅-app\diechi-harness
set DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home
node -e "import('./packages/host/diechi-process-watchdog/dist/cli.js')"
```

或加进 `diechi-app\蝶翅APP启动器.cmd` 之前先启 watchdog。

### 步骤 6：测试

```bash
# 单元测试
cd diechi-harness
pnpm vitest run packages/host/diechi-process-watchdog/

# 集成测试：起 DSH → 杀 DSH（模拟崩溃）→ watchdog 拉起
pnpm exec dsh web --port 3090 &
sleep 10
kill -9 $(lsof -t -i:3090)  # 模拟崩溃
sleep 35  # 等 watchdog probe
curl http://127.0.0.1:3090/health  # 验证拉起成功
```

### 步骤 7：Agent Note

按 `AGENTS.md` 格式写 `2026-09-XX-diechi-process-watchdog.md`（从 proposed 转 implemented）—— 内容引用本说明 + diechi-process-watchdog-design.md。

---

## 验证三架构闭环

**装完 watchdog 后** 跑 5 个场景：

| 场景 | 期望行为 |
|---|---|
| DSH 正常跑 | watchdog 静默（probe OK） |
| DSH OOM 死 | watchdog 30s 内 probe 失败 → 写 `negative_samples({reason: 'watchdog-restart'})` → spawn 新 DSH |
| 人类升级 | 人类调 `supervisor_signal_update_ready` → 监督者写 signal → watchdog 读 signal → 杀+替换+拉起 |
| watchdog 自己死 | NSSM / systemd 重启 watchdog → 继续监控 |
| 被升级者内存泄漏 | watchdog 累计 `negative_samples` → 10 次后 diechi-evolve 提议 `add-rule: person-brain:process-restart` → 人工审 → frozen_rules |

**任一角色死** —— **其他角色能接住不崩溃** —— **这才是三架构本意**。

---

## 相关文件清单

- 设计文档（已存）：`diechi-harness/docs/diechi-process-watchdog-design.md`
- proposed Agent Note（已存）：`diechi-harness/.agents/notes/proposed/process/2026-08-28-diechi-process-watchdog.md`
- 包目录（待建）：`diechi-harness/packages/host/diechi-process-watchdog/`
- 配置文件（待改）：`diechi-home/profiles/web/package.json` + `pnpm-workspace.yaml`
- 启动器（待改）：`蝶翅APP启动器.cmd` 加 watchdog 启动
- 监督者源码（待改）：`diechi-harness/packages/host/diechi-supervisor/src/tools.ts` 加 `supervisor_signal_update_ready` tool

---

## 完成判定

✅ watchdog 独立进程能起 — `pnpm tsx packages/host/diechi-process-watchdog/dist/cli.js` 不报错
✅ DSH 3090 死了 watchdog 30s 内拉起
✅ 信号驱动升级：人类调 `supervisor_signal_update_ready` → watchdog 杀+替换+拉起
✅ 测试覆盖（建议 ≥5 个测试）：正常 probe / 崩溃 spawn / 信号触发 / 信号文件损坏 / watchdog 自杀兜底
✅ Agent Note 转 implemented
✅ `git add` + `commit` + `push` 到 `ggban666/deepseek-harness-diechi`

---

## 完成后

把 `diechi-process-watchdog-design.md` 标记为"已实现"——本文件作为设计参考存档。

下次 DSH 真崩——不需要 human kill 自己——**系统自己能接住**——**三架构本意达成**。
