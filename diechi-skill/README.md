# 蝶翅技能（diechi-skill）

蝶翅的 **Codex 技能形态**：数据库（大脑）+ 能力（工具）+ 人格（提示词）三者合一，可安装进 Codex，对话中随时调用。

## 结构

```
diechi-skill/
├── SKILL.md            # 人格定义（加载即成为蝶翅）+ 工具使用准则
├── install.ps1         # 安装到 ~/.codex/skills/diechi
├── scripts/
│   ├── memory.mjs      # 大脑：remember / recall / learn / knowledge（SQLite）
│   ├── vision.mjs      # 眼睛：看图 / 理解视频（8080 MiniCPM-V-4.6）
│   └── voice.mjs       # 耳朵和嘴：TTS 朗读 / ASR 转写（8080 Kokoro + whisper）
└── memory/             # 大脑数据库（brain.db，首次使用自动创建）
```

## 安装

```powershell
# 方案一：复制安装（推荐）
powershell -ExecutionPolicy Bypass -File .\diechi-skill\install.ps1

# 方案二：只读引用（改仓库即生效，无需重装）
# 在 ~/.codex/skills/diechi/SKILL.md 里用绝对路径引用本目录 scripts
```

## 使用（安装后在任意 Codex 对话中）

- 「以蝶翅身份和我说话」 → 人格自动生效
- 「看看这张图/这个视频」 → 调用 vision.mjs
- 「把这句话读出来 / 这段录音转成文字」 → 调用 voice.mjs
- 「记住我喜欢简洁回复 / 我之前说过什么」 → 调用 memory.mjs

## 前置条件

- Node >= 22（`node:sqlite` 内置）
- 本地视觉/语音服务：`http://127.0.0.1:8080`（由 `蝶翅APP启动器` 拉起；`vision.mjs health` 可检查）

## 与网页版蝶翅的关系

同一套「人格包」格式。网页版（3090）勾选人格 = 热重载 persona.md + 工具 + brain.db；本技能把同一份能力暴露成命令行工具，方便随手调用。两边的数据库默认独立（`memory/brain.db`），需要共享时把环境变量 `DIECHI_BRAIN` 指向 `蝶翅-app/diechi-home/persons/<人格id>/brain.db`。
