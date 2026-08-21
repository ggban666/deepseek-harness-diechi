# @deepseek-ai/dsh-client-ui-skill-store

Skill 商店设置面板，浏览器半侧。

## 功能

在 左下角设置 中注册一个 `settings.section` 页面 —— **Skill 设置**，管理已安装技能目录与本地视觉配置：

- 列出已安装技能：斜杠命令（`/id`）、来源徽标（内置 / 已导入 / 已生成）、内容待生成状态。
- 导入技能：支持 `.md`（SKILL.md 的 YAML frontmatter 格式）或 `.json`（通用清单：单个条目、数组、或 `{ "skills": [...] }`）。
- 移除已安装技能。
- 持久化视觉模型配置（`skill.vision`：启用、地址、模型），并承载入口：**识别图片** 与 **视频生成**（上传视频 / 摄像头观看——摄像头持续采样画面，可暂停，点「完成」结束并生成技能）：调用本地部署的视觉模型（默认 llama.cpp `http://127.0.0.1:8080` + `MiniCPM-V-4.6`，OpenAI 兼容接口）。图片直接识别；视频自动抽帧（最多 8 帧）后识别，返回画面描述与技能草拟（名称/用途/步骤/规则），并支持「一键带到工坊创建表单」继续完善。

持久化数据放在 `@deepseek-ai/dsh-web-app/skill-store` 宿主行拥有的两个 settings 命名空间：

- `skill.store` —— 带版本号的技能目录（`SkillManifestEntry[]`）；宿主行将其桥接到 `ctx.skills` 运行时注册，导入的技能会自动出现在对话斜杠菜单。
- `skill.vision` —— 本地视觉模型配置（启用、地址、模型）。

## 通用技能格式

清单带版本号（`formatVersion: 1`）且与传输方式无关：

```ts
interface SkillManifestEntry {
  formatVersion: 1
  id: string            // kebab-case；即用户斜杠命令 /<id>
  title: string
  description: string
  whenToUse?: string
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  content: string       // markdown 正文；为空表示内容待生成
  source: 'builtin' | 'imported' | 'generated'
}
```

浏览器半侧负责解析与校验导入（`skill-format.ts`）；宿主半侧在注册前会重新校验同一份 JSON。

## 模型体验

不直接影响模型上下文：商店只管理定义。被调用的技能经 `dsh-tool-skill` 的标准 `skill` 加载路径到达模型；用户斜杠菜单见 `dsh-client-ui-skill`。

## 已知限制与暂缓事项

- **视觉识别生成为预留接口** —— 本地视觉模型管线尚未接入，UI 仅提示预留。
- **技能内容暂未填充** —— 四个内置专家条目正文为空，列为"内容待生成"，待导入或视觉管线填充。
- **商店目录由 settings 承载** —— 导入的正文保存在设置文档中，而非 `diechi-home/skills` 下的 `SKILL.md` 文件。