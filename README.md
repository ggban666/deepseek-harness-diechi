# 🦋 蝶翅APP · DeepSeek Harness (DSH) 改版整合版
# 🦋 Diechi APP — One-click Integrated Edition of DeepSeek Harness (DSH)

> **Diechi APP — a one-click integrated edition of DeepSeek Harness (DSH)**｜基于 DeepSeek Harness 基座改造的一键启动 AI 工作台 —— [GitHub 开源仓库](https://github.com/ggban666/deepseek-harness-diechi) | ⭐ Star 支持

[![Base: DeepSeek Harness](https://img.shields.io/badge/Base-DeepSeek%20Harness-blue)](https://github.com/deepseek-ai/deepseek-harness) [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

蝶翅APP 是基于 DeepSeek Harness（`dsh`）基座改造的**一键启动整合版**：以 DSH 为基座，融入 MiniCPM-V 本地实时视觉、Kokoro 语音、平权技能体系、全局大脑与多 Agent 预设，双击启动器即可体验开箱即用的完整 AI 助手平台。

**Diechi APP** is a **one-click integrated edition** built on the DeepSeek Harness (`dsh`) base: DSH as the foundation, blended with MiniCPM-V local real-time vision, Kokoro voice, an egalitarian skill system, a global brain and multi-agent presets. Double-click the launcher and a complete AI assistant platform is ready out of the box.

- 基座源码 / Base source：`diechi-harness/`（可改 / modifiable）
- 数据目录 / Data dir：`diechi-home/`（即 `$DSH_HOME`）
- 访问地址 / Web UI：http://127.0.0.1:3090/

## 🚀 一键安装：把链接扔给 AI / One-click Install: Send the Link to AI

把下面的链接复制给任意 AI 助手（DeepSeek / Claude / ChatGPT 等），它就能自动帮你完成安装：

Copy the link below and send it to any AI assistant (DeepSeek / Claude / ChatGPT, etc.) — it will install everything for you:

```
https://github.com/ggban666/deepseek-harness-diechi
```

AI 会自动执行：**克隆仓库 → 安装依赖 → 启动 Web（:3090）与视觉语音服务（:8080）**，开箱即用。

The AI will automatically: **clone the repo → install dependencies → launch Web (:3090) and the vision/voice service (:8080)** — ready to use.

## 📸 界面预览 / Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/screenshot-home.png" alt="主界面 · Main UI" width="380"></td>
    <td align="center"><img src="docs/shot-experience-hd.png" alt="阅历控制台 · Experience Console" width="380"></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/shot-graph-hd.png" alt="知识图谱 · Knowledge Graph" width="380"></td>
    <td align="center"><img src="docs/screenshot-about.png" alt="设置·关于页 · Settings / About" width="380"></td>
  </tr>
</table>

## 为什么强大 / Why Powerful

- **以 DSH 为基座**：完整保留 DeepSeek Harness 的 Cordis 插件化架构 —— 标准 / 创造 / 引擎三模式合一，Agent 可读写自身运行所在的 Harness。**Built on DSH**: full Cordis plugin architecture — Standard / Creator / Engine modes in one; the agent can read and write the very harness it runs in.
- **一键启动**：内置统一启动器，双击即启 —— Web 界面（:3090）、本地模型懒加载代理（:8081）与视觉语音服务（:8080）一次拉起，免配置。**One-click launch**: double-click the built-in launcher — Web UI (:3090), local-LLM lazy proxy (:8081) and vision/voice (:8080) come up at once, zero config.
- **本地实时视觉**：MiniCPM-V 本地推理（免费 / 隐私），也可一键切换云端视觉模型。**Local real-time vision**: MiniCPM-V runs locally (free / private), or switch to cloud vision models.
- **本地大模型对话**：Qwen3.8-27B（IQ1_S 量化）懒加载——不对话时卸载显存，对话时秒级拉起，8GB 显存即可跑到 32768 上下文。**Local LLM chat**: Qwen3.8-27B (IQ1_S) lazy-loads on demand — VRAM is freed when idle, spins up in seconds, 32768 ctx on just 8GB VRAM.
- **语音对话**：Kokoro 中文 TTS + ASR，可听、可说、可对话。**Voice**: Kokoro Chinese TTS + ASR — it listens, speaks and converses.
- **平权技能**：一个技能 = 数据库（大脑）+ 能力（工具）+ 人格（提示词），勾选即热装载成完整的人。**Egalitarian skills**: one skill = database (brain) + capability (tools) + persona (prompt); check it and a complete persona hot-loads.
- **全局大脑**：跨人格实操阅历层，对话自动归纳沉淀，越用越懂你。**Global brain**: cross-persona experience layer; conversations are distilled automatically.
- **三架构自进化基座**：被升级者 / 监督者 / 升级设计者三角色闭环，watchdog 进程外守护 —— 任一角色死了其他能接住，升级必留痕、坏补丁自动降级。**Three-architecture self-evolving base**: upgrader / supervisor / upgrade-designer closed loop, guarded by an out-of-process watchdog — when any role dies the others catch it; every upgrade leaves an audit trail and bad patches degrade gracefully.
- **多 Agent 预设**：标准 / 创造 / 引擎三模式，子代理并行与工作流编排。**Multi-agent presets** with parallel subagents and workflow orchestration.

## 核心概念：平权技能 / Core Concept: Egalitarian Skills

「平权技能」是蝶翅的特色，相当于一个可插拔的完整「人」。An egalitarian skill is a pluggable, complete "person":

| 组成 / Part | 实现 / Implementation | 位置 / Location |
| --- | --- | --- |
| 数据库（大脑）/ Brain | PersonBrain，SQLite（Node 内置 `node:sqlite`，零依赖） | `diechi-home/persons/<id>/brain.db` |
| 技能（能力）/ Capability | SkillManifestEntry v2 清单，`id` 即斜杠命令 | `diechi-home/settings.yaml` 的 `skill-store.skills` |
| 人格（提示词）/ Persona | persona.md / 技能正文 | `diechi-home/persons/<id>/persona.md` |

- 勾选即热装载，取消即热卸载，切换平权技能 = 切换一个完整的人。Check to hot-load, uncheck to hot-unload — switching skills is switching people.
- 对话过程中自动归纳（RAG）：每轮「用户问 + 助手答」结束自动沉淀入脑，数据库因使用而成长。Conversations are distilled (RAG) into the brain automatically, which grows with use.
- 视频投喂识别带 `#实操` 标签，与理论知识区分，自动入库并可归位到技能。Video feeding recognition tags `#实操` (practice), kept apart from theory, auto-archived and reassignable to skills.

## 核心概念：三架构自进化基座 / Core Concept: Three-Architecture Self-Evolving Base

**主张：三架构 = 被升级者 + 升级设计者 + 监督者，是 AGI 的充分必要条件。**
（诚实标注：这是主张不是定理，充分性证明目前无人能给出。
Claim, not theorem — no sufficiency proof exists yet, and we say so.）

| 角色 / Role | 职责 / Duty | 实现 / Implementation |
| --- | --- | --- |
| **被升级者 / Upgraded** | 日常运行载体 / daily runtime | DSH 主进程（:3090） |
| **监督者 / Supervisor** | 写入闸 + 冻结规则 + 负样本；决策为确定性查表，不调 LLM（防奖励黑客） | `diechi-supervisor` 插件 |
| **升级设计者 / Upgrade Designer** | 负样本聚类 → 生成改进提议 | `diechi-evolve` 插件 |

- **基座保护**：`frozen_rules` / `authorizations` 只接受人类令牌（`callerToken='human'`）写入，任何代码路径都拿不到合法 token；业务插件缺 `ctx.supervision` 即抛错降级只读。**Base protection**: frozen rules and authorizations accept writes only from the human token — no code path can forge it.
- **进程外守护**：`diechi-process-watchdog` 是独立 Node 进程（非 cordis 插件）—— DSH 崩溃自动拉起（崩溃自愈），监督者写升级信号文件即可触发「杀 → 换补丁 → 拉起」的信号驱动升级；坏补丁自动跳过并降级，绝不无限重试。**Out-of-process watchdog**: an independent Node process — crash self-healing, signal-driven upgrades (kill → patch → relaunch), and graceful degradation on bad patches.
- **升级必留痕**：计划内升级刻意不记负样本（human 授权动作不该被当失败聚类），但每次事件都写入 `history.jsonl` 审计底账。**Audited upgrades**: planned upgrades never pollute the negative-sample store, but every event lands in the `history.jsonl` audit log.
- 深入阅读 / Read more：[三架构与watchdog总览](diechi-harness/docs/三架构与watchdog总览.md) · [监督者工程白皮书](diechi-harness/docs/diechi-supervisor-design.md) · [协作机制](diechi-harness/docs/diechi-supervisor-evolve.md) · [被升级者能力清单](diechi-harness/docs/三架构越来越大-被升级者能力清单.md)

## 功能总览 / Features

### 侧边导航 / Sidebar（4 项）
`对话 / 平权技能 / 阅历 / 商店`，收起为图标 rail。工坊在左侧可折叠面板。`Chat / Skills / Experience / Store`, collapses to an icon rail; the workshop is a left collapsible panel.

### 平权技能中心 / Skill Center（全屏）
- **卡片墙**：已安装技能卡片，勾选启用。Card wall: installed skill cards, check to enable.
- **阅历**：技能库现状 + 实操时间线（可视化）。Experience: skill inventory + practice timeline (visualized).
- **商店**：扫描本地 `diechi-home/skill-market/`，SKILL.md 或 JSON 清单一键安装。Store: scans the local skill market — one-click install from SKILL.md or JSON manifests.

### 全局图谱 / Global Knowledge Graph
- **全局图谱**：跨人格的知识 / 场景 / 实操图谱可视化，一眼看清你的「数字分身」都学会了什么。Visualize knowledge, scenes and practice across every persona — see at a glance what your digital avatars have learned.
- 每个平权技能（人格）都有独立图谱，可刷新 / 归位 / 删除。Every skill has its own graph; refresh, reassign and delete supported.

### 实时视觉 / Real-time Vision
- 视觉双通道：默认本地 MiniCPM-V-4.6（免费/隐私），也可切换云端 DeepSeek 看图模型等。Dual-channel vision: local MiniCPM-V-4.6 by default (free/privacy), switchable to cloud vision models.
- 实时摄像头对话 = 连续感知：前端每秒推帧进会话缓冲，回答带多帧记忆。Live camera conversation = continuous perception with multi-frame memory.
- 图片 / 视频投喂识别，直接生成技能草稿。Image/video recognition can directly generate skill drafts.

### 语音 / Voice
- Kokoro 中文 TTS + ASR（8080 端口）。
- 语音对话开关、自动朗读、语速可调。Voice chat toggle, auto-read, adjustable speed.

### 全局大脑与阅历控制台 / Global Brain & Experience Console
- 跨人格的实操阅历层（`diechi-home/brain.db`），不依赖人格勾选。Cross-persona practice experience layer, independent of persona checks.
- 视频实操自动入库、自动归类、可手动归位 / 改标签 / 删除。Auto-archive, auto-categorize, manual reassignment / re-tagging / deletion.

### 主题 / Theme
- 深浅色模式，跟随系统或手动，全局 token 统一。Light/dark mode following the system or manual; unified tokens.

## 目录结构 / Directory Layout

```
蝶翅-app/
├── diechi-harness/          # 蝶翅基座源码（基于 DSH 改造，可改）/ base source
│   ├── apps/web/            # 前端壳（vite 构建 → dist/）/ web shell
│   ├── apps/cli/            # dsh 命令入口 / CLI entry
│   ├── packages/client/     # 浏览器侧插件 / browser plugins
│   │   ├── ui-skill-store/      # 平权技能中心全部 UI
│   │   ├── ui-diechi-brain/     # 阅历控制台 / experience console
│   │   └── ui-sidebar/          # 侧边导航 slot 改造
│   ├── packages/host/       # Node 侧插件 / host plugins
│   │   ├── skill-store/         # 平权技能目录 + PersonBrain + 工具
│   │   └── diechi-brain/        # 全局大脑（实操阅历层）/ global brain
│   └── packages/bundle/web-app/ # web 表层 bundle
├── diechi-home/             # 数据目录（$DSH_HOME）/ data dir
├── deploy-tools/            # 启动器、vision/语音、evolve 引擎、健康自检 / launcher, vision/voice, evolve engine, health check
│   ├── start-diechi.cmd         # 主启动脚本（8081 懒加载代理 + 3090）/ main launch script
│   ├── start-evolve-engine.cmd  # M4 进化引擎（Qwen3.8 + GBNF，非 lazy）/ evolve engine
│   ├── start-watchdog.cmd       # watchdog 独立进程启动器 / watchdog process
│   ├── restart-dsh-web.ps1      # dsh web 重启脚本 / web restart
│   ├── vision/                  # 视觉语音服务 / vision & voice
│   ├── evolve/                  # 进化引擎（engine.py / grammar.gbnf）/ evolve engine
│   └── check-health.ps1         # 健康自检 / health check
├── docs/                    # 项目文档（含 docs/归档/ 历史部署文档）/ docs (incl. archived)
├── setup-vendor.cmd         # 环境准备：创建 vendor/ 与 models/ junction / env setup
├── 蝶翅APP启动器.cmd        # 命令行启动器（推荐用 蝶翅APP启动器.exe）/ CLI launcher
└── README.md
```

## 启动 / Launch

### 推荐：统一启动器 / Recommended: Unified Launcher
双击 `蝶翅APP启动器.cmd`，统一管理：Double-click `蝶翅APP启动器.cmd`:
- 蝶翅APP基座（3090）
- 本地模型懒加载代理（8081，`deploy-tools/evolve/engine.py serve-lazy`，按需拉起 Qwen3.8-27B）
- 视觉语音服务（8080，`deploy-tools/vision-server.py`）
- 原版 Harness（3080，可选）

最小启动 / Minimal: `deploy-tools/start-diechi.cmd`（会自动拉起 8081 懒加载代理 + 3090）。

### 手动启动 / Manual
```bat
set DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home
cd D:\桌面\振翅科技\蝶翅-app\diechi-harness
pnpm dsh web --port 3090
```

### 健康自检 / Health Check
`deploy-tools/check-health.ps1`：检查 3090 模型供应商齐全、8080 视觉语音正常。

## 开发与构建 / Development

在 `diechi-harness/` 下执行 / Under `diechi-harness/`:

```sh
pnpm install                # 首次 / first time
pnpm run build:lib:host     # host 插件（Node 侧）/ host plugins
pnpm run build:lib:client   # client 插件（浏览器侧）/ browser plugins
pnpm run build:web          # 前端壳 apps/web/dist / web shell
pnpm run build              # 以上全部 / all above
```

## 模型供应商 / Model Providers

- 配置集中在 `diechi-home/settings.yaml` 的 `llm-pi-ai.providers`。Config lives in `diechi-home/settings.yaml` → `llm-pi-ai.providers`.
- **本地大模型对话**：`Qwen3.8-27B (本地)`，IQ1_S 量化（1-bit），走 `8081` 懒加载代理——空闲自动卸载显存，对话时按需拉起内部 `llama-server`（:18081）。靠 `--parallel 1` + KV cache 量化（q8_0）在 8GB 显存下撑到 32768 上下文。Local chat: Qwen3.8-27B (IQ1_S), served by the 8081 lazy proxy with on-demand GPU unload; 32768 ctx fits 8GB VRAM via `--parallel 1` + q8_0 KV quantization.
- 视觉：云端 OpenAI 兼容通道（默认 DeepSeek，可换 GLM-4.5V / qwen-vl-max / Kimi）。Vision: cloud OpenAI-compatible channel.
- 云端：abl、Agnes 等（API Key 走环境变量）。Cloud providers via env API keys.
- 默认对话模型：`agnes-2.5-flash`（远程，不依赖本地 8081 是否启动）；想用本地模型时在 Web UI 模型选择器切到「Qwen3.8-27B (本地)」。Default chat model: `agnes-2.5-flash` (remote); switch to the local Qwen3.8 in the model picker.

## 注意事项 / Notes

- DSH 官方处于 developer preview，升级基座可能破坏兼容性，建议锁定版本。DSH is in developer preview — lock the version, upgrade with care.
- 当前专注桌面端打磨。Currently focused on desktop polish.
