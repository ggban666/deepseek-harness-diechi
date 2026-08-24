# 蝶翅基座

蝶翅自己的 DeepSeek Harness 基座，和外面那套原版 Harness 完全分开。

- 原版（不可改）：`D:\桌面\振翅科技\deep seek harness`
- 蝶翅基座（可改）：`D:\桌面\振翅科技\蝶翅-app\diechi-harness`
- 蝶翅数据目录：`D:\桌面\振翅科技\蝶翅-app\diechi-home`（`$DSH_HOME`）
- 访问地址：http://127.0.0.1:3090/

## 核心体系：平权技能

一个平权技能 = 数据库 + 技能 + 人格 的完整「人」：

| 组成 | 实现 | 位置 |
| --- | --- | --- |
| 数据库（大脑） | PersonBrain（SQLite，Node 内置 `node:sqlite`，零依赖） | `$DSH_HOME/persons/<id>/brain.db` |
| 技能（能力） | SkillManifestEntry v2 清单，`id` 即斜杠命令 | `skill-store` 设置命名空间 |
| 人格（提示词） | persona.md / 技能正文 | `$DSH_HOME/persons/<id>/persona.md` |

- 勾选即热装载、取消即热卸载；切换平权技能 = 切换一个完整的人。
- 对话自动归纳（RAG）：每轮 turn 结束自动沉淀入脑。
- 视频实操带 `#实操` 标签入库，与理论知识区分。

## 插件架构（一切皆插件，Cordis）

自定义插件：

- host（Node 侧）
  - `packages/host/skill-store`：平权技能目录 + PersonBrain + see/remember/recall 工具 + 对话自动归纳
  - `packages/host/diechi-brain`：全局大脑（跨人格实操阅历层，自动归类，可独立插拔）
- client（浏览器侧）
  - `packages/client/ui-skill-store`：平权技能中心全部 UI（导航 / 卡片墙 / 阅历 / 商店 / 工坊 / 视觉 / 语音）
  - `packages/client/ui-diechi-brain`：阅历控制台
  - `packages/client/ui-sidebar`：侧边导航 slot 改造（对话 / 平权技能 / 阅历 / 商店 + 工坊面板）
- bundle：`packages/bundle/web-app`（web 表层）
- 前端壳：`apps/web`（vite → dist；客户端插件运行时从 profile 加载）

## 数据目录（$DSH_HOME）

- `settings.yaml`：模型供应商、平权技能目录、视觉 / 语音配置
- `skills/`、`skill-market/`：技能文件与本地商店
- `persons/<id>/`：每个人格的 brain.db + persona.md + manifest.json
- `brain.db`：全局大脑（实操阅历）
- `profiles/web/`：web profile bundle 配置（dsh-base / dsh-web-app / dsh-vision-mix）
- `sessions/`、`storages/`：会话与存储

## 启动

- 推荐：`D:\桌面\振翅科技\蝶翅-app\蝶翅APP启动器.cmd`（统一管理 3090 基座 + 8080 视觉语音）
- 最小：`deploy-tools/start-diechi.cmd`
- 手动：

```bat
set DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home
cd D:\桌面\振翅科技\蝶翅-app\diechi-harness
pnpm dsh web --port 3090
```

- 视觉语音（8080，可选）：`D:\vllm-env\Scripts\python.exe D:\桌面\振翅科技\蝶翅-app\deploy-tools\vision-server.py`

## 构建

在 `diechi-harness/` 下：

```sh
pnpm run build:lib:host    # host 插件
pnpm run build:lib:client  # client 插件（改 UI 后必跑）
pnpm run build:web         # 前端壳
```

改完 host / client 插件后必须重启 `dsh web` 才生效。
