# 🦋 蝶翅APP

> 基于 DeepSeek Harness（DSH）基座的一键启动 AI 工作台 —— [GitHub 开源仓库](https://github.com/ggban666/diechi) | ⭐ Star 支持

蝶翅APP 是基于 DeepSeek Harness（`dsh`）基座改造的**一键启动整合版**：以 DSH 为基座，融入 MiniCPM-V 本地实时视觉、Kokoro 语音、平权技能体系、全局大脑与多 Agent 预设，双击启动器即可体验开箱即用的完整 AI 助手平台。

- 基座源码：`diechi-harness/`（可改）
- 数据目录：`diechi-home/`（即 `$DSH_HOME`）
- 访问地址：http://127.0.0.1:3090/

## 为什么强大

- **以 DSH 为基座**：完整保留 DeepSeek Harness 的 Cordis 插件化架构 —— 标准 / 创造 / 引擎三模式合一，Agent 可读写自身运行所在的 Harness。
- **一键启动**：内置统一启动器，双击即启 —— Web 界面（:3090）与视觉语音服务（:8080）一次拉起，免配置、开箱即用。
- **本地实时视觉**：MiniCPM-V 本地推理（免费 / 隐私），也可一键切换云端视觉模型。
- **语音对话**：Kokoro 中文 TTS + ASR，可听、可说、可对话。
- **平权技能**：一个技能 = 数据库（大脑）+ 能力（工具）+ 人格（提示词），勾选即热装载成完整的人。
- **全局大脑**：跨人格实操阅历层，对话自动归纳沉淀，越用越懂你。
- **多 Agent 预设**：标准 / 创造 / 引擎三模式，子代理并行与工作流编排。

## 核心概念：平权技能

「平权技能」是蝶翅的特色，相当于一个可插拔的完整「人」：

| 组成 | 实现 | 位置 |
| --- | --- | --- |
| 数据库（大脑） | PersonBrain，SQLite（Node 内置 `node:sqlite`，零依赖） | `diechi-home/persons/<id>/brain.db` |
| 技能（能力） | SkillManifestEntry v2 清单，`id` 即斜杠命令 | `diechi-home/settings.yaml` 的 `skill-store.skills` |
| 人格（提示词） | persona.md / 技能正文 | `diechi-home/persons/<id>/persona.md` |

- 勾选即热装载，取消即热卸载，切换平权技能 = 切换一个完整的人。
- 对话过程中自动归纳（RAG）：每轮「用户问 + 助手答」结束自动沉淀入脑，数据库因使用而成长。
- 视频投喂识别带 `#实操` 标签，与理论知识区分，自动入库并可归位到技能。

## 功能总览

### 侧边导航（4 项）
`对话 / 平权技能 / 阅历 / 商店`，收起为图标 rail。工坊在左侧可折叠面板（创建 / 导入 / 再训练）。

### 平权技能中心（全屏）
- **卡片墙（平权技能）**：已安装技能卡片，勾选启用。
- **阅历**：技能库现状 + 实操时间线（可视化）。
- **商店**：扫描本地 `diechi-home/skill-market/`，SKILL.md 或 JSON 清单一键安装。

### 实时视觉
- 视觉双通道：默认本地 MiniCPM-V-4.6（免费/隐私，`vision-server.py` 直接推理），也可切换云端 DeepSeek 看图模型 `deepseek-v4-flash-vision-exp` 等，配置 `deploy-tools/vision-cloud.json`（`model` 字段即生效）。
- 实时摄像头对话 = 连续感知：前端每秒推帧进会话缓冲（最近 60 帧），说话/提问时按关键帧去重后以原始分辨率打包成视频喂模型，回答带多帧记忆。
- 图片 / 视频投喂识别，直接生成技能草稿（视频实操两阶段：先讲过程、再提炼 JSON）。
- 识别结果自动入阅历（`#实操`），并给出建议归属技能。

### 语音
- Kokoro 中文 TTS + ASR（8080 端口）。
- 语音对话开关、自动朗读、语速可调。

### 全局大脑与阅历控制台
- 跨人格的实操阅历层（`diechi-home/brain.db`），不依赖人格勾选。
- 视频实操自动入库、自动归类、可手动归位 / 改标签 / 删除。

### 主题
- 深浅色模式，跟随系统或手动，全局 token 统一。

## 目录结构

```
蝶翅-app/
├── diechi-harness/          # 蝶翅基座源码（基于 DSH 改造，可改）
│   ├── apps/web/            # 前端壳（vite 构建 → dist/）
│   ├── apps/cli/            # dsh 命令入口
│   ├── packages/client/     # 浏览器侧插件
│   │   ├── ui-skill-store/      # 平权技能中心全部 UI
│   │   ├── ui-diechi-brain/     # 阅历控制台
│   │   └── ui-sidebar/          # 侧边导航 slot 改造
│   ├── packages/host/       # Node 侧插件
│   │   ├── skill-store/         # 平权技能目录 + PersonBrain + 工具
│   │   └── diechi-brain/        # 全局大脑（实操阅历层）
│   └── packages/bundle/web-app/ # web 表层 bundle
├── diechi-home/             # 数据目录（$DSH_HOME）
│   ├── settings.yaml        # 模型供应商、技能目录、视觉/语音配置
│   ├── persons/<id>/        # 每个人格的 brain.db + persona.md
│   ├── brain.db             # 全局大脑
│   ├── skill-market/        # 本地平权技能商店
│   ├── profiles/web/        # web profile bundle 配置
│   ├── sessions/  storages/ # 会话与存储
├── deploy-tools/            # 启动器、vision-server.py、check-health.ps1
├── docs/                    # 项目文档
├── 蝶翅APP启动器.cmd        # 统一启动管理器
└── README.md
```

## 启动

### 推荐：统一启动器
双击 `蝶翅APP启动器.cmd`，统一管理：
- 蝶翅APP基座（3090）
- 视觉语音服务（8080，`deploy-tools/vision-server.py`）
- 原版 Harness（3080，可选，一般不用）

最小启动：`deploy-tools/start-diechi.cmd`。

### 手动启动
```bat
set DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home
cd D:\桌面\振翅科技\蝶翅-app\diechi-harness
pnpm dsh web --port 3090
```
视觉语音服务（视觉/语音功能依赖，可选）：
```bat
D:\vllm-env\Scripts\python.exe D:\桌面\振翅科技\蝶翅-app\deploy-tools\vision-server.py
```

### 健康自检
`deploy-tools/check-health.ps1` 启动后调用：检查 3090 模型供应商齐全、8080 视觉语音正常，防止「供应商消失 / 服务未起」静默发生。

## 开发与构建

在 `diechi-harness/` 下执行：

```sh
pnpm install                # 首次
pnpm run build:lib:host     # host 插件（Node 侧）
pnpm run build:lib:client   # client 插件（浏览器侧）
pnpm run build:web          # 前端壳 apps/web/dist
pnpm run build              # 以上全部
```

**常见坑**
- 改了 client 插件源码必须重新 `build:lib:client`，然后重启 `dsh web`，否则浏览器加载的还是旧产物（例如 hero 卡片删了却仍然显示，就是构建产物过期）。
- 不要直接改 `apps/web/dist/`，它是构建产物。
- 客户端插件通过 `diechi-home/profiles/` 的 junction 链加载到 `diechi-harness` 的构建产物，重构建后无需重新安装 profile。

## 模型供应商

- 配置集中在 `diechi-home/settings.yaml` 的 `llm-pi-ai.providers`。
- 视觉：云端 OpenAI 兼容通道（8080 转发，配置 `deploy-tools/vision-cloud.json`；默认 DeepSeek `deepseek-v4-flash-vision-exp`，可换 GLM-4.5V / qwen-vl-max / Kimi）。
- 云端：abl、Agnes 等（API Key 走环境变量，如 `AGNES_API_KEY`）。
- 默认对话模型：`agnes-2.5-flash`。

## 注意事项

- DSH 官方处于 developer preview，升级基座可能破坏兼容性，建议锁定版本、谨慎升级。
- 手机版已移除，当前专注桌面端打磨。
- 原版 Harness（`D:\桌面\振翅科技\deep seek harness`）保持不可动，作为对照基线。
