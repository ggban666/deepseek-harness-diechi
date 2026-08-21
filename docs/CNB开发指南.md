# 🦋 蝶翅APP CNB 云开发指南

> 给在 CNB（腾讯云云原生构建，https://cnb.cool）上开发的 AI agent 看的项目说明。
> 仓库: `Qwen666/diechi`（默认分支 `main`）

## 1. 项目是什么

蝶翅APP 是一个「本地优先」的 AI 工作台：**技能（Skill）即人格**。用户在技能工坊创建/再训练技能（知识库化），勾选后对话自动使用该人格；内置摄像头视频理解——上传视频或开摄像头实时识别，生成技能草稿并一键带进工坊；配本地语音闭环（ASR 识别语音 + 本地视觉模型理解画面 + Kokoro 中文 TTS 朗读）。

Hero 文案：**蝴蝶振翅，一念换天**。

**最终目标（当前在第 1 步，全部在电脑上测试完善后再往下走）**
1. ✅ 电脑端本地运行完善（当前阶段：8G 显存显卡，Windows）
2. 🔜 手机端适配：MiniCPM-V 4.6 面壁官方端侧方案（QNN/端侧推理，不依赖 Ollama）
3. 🔜 AI 眼镜适配：参考 OpenSQZ/OpenGlass 的 ESP32 bridge 架构（详见 docs/开发进度跟踪.md 的 roadmap）

## 2. 技术栈

- **主代码**：`diechi-harness/` —— TypeScript monorepo（DeepSeek Harness fork），pnpm workspace，Node >= 22
- **本地视觉+语音服务**（不在仓库内）：Python + transformers 5.15 + MiniCPM-V-4.6（官方权重）+ faster-whisper + Kokoro TTS，跑在 `http://127.0.0.1:8080`，服务端脚本 `D:\vision-server.py`（本地 Windows 机器，不入库）
- **数据目录**：`diechi-home/`（settings.yaml + 凭据 + 会话，**不入库，敏感**）
- **前端**：`diechi-harness/apps/web`，设置页含 模型/插件/语音/视觉/Skill 设置 等
- **端口**：3090（蝶翅基座，DSH_HOME=`diechi-home`）；原版 3080 保留

## 3. 仓库结构（可改/不可改）

| 路径 | 说明 | 能否改 |
|---|---|---|
| `diechi-harness/` | 主代码（frontend + host 插件 + llm 包） | ✅ 主要改动区 |
| `docs/` | 进度跟踪、本指南 | ✅ |
| `deploy-tools/` | 本地启动器源码/脚本 | ✅ |
| `.cnb.yml` + `.ide/Dockerfile` | CNB 云端开发环境 | ✅ |
| `diechi-home/` | 运行时数据+密钥 | ❌ 不入库，改动见 §6 模板 |
| `models/ vllm-env/ *.exe` | 本地运行资产 | ❌ 不入库 |

**硬性规则**
- 密钥绝不明文写入代码/配置，一律用环境变量名（`apiKeyEnv`）引用。
- 不要假设仓库里有 `diechi-home/settings.yaml`；需要改配置先看 `docs/settings.example.yaml`。
- 本地 Windows 独有内容（`D:\vllm-env`、`D:\vision-server.py`、exe 启动器、摄像头硬件）在云端不存在，涉及这些的改动要以「可配置/可注入」方式设计，让本地能跑。

## 4. 本地如何运行（用户机器，Windows）

```powershell
# 启动器一键起（自动拉起 8080 视觉+语音服务 + 3090 基座）
# 双击 D:\桌面\振翅新科\蝶翅-app\蝶翅APP启动器.exe
# 手动方式:
cd D:\桌面\振翅新科\蝶翅-app\diechi-harness
$env:DSH_HOME='D:\桌面\振翅新科\蝶翅-app\diechi-home'
node --import tsx/esm apps\cli\src\bin.ts web --port 3090
```

agent 在云端改完 → 用户本地 `git pull` → 启动器验证 → 把结果反馈回 issue/对话。

## 5. 云端开发环境（GPU）

- 开发环境由 `.cnb.yml` 声明，使用 **GPU 构建节点 `cnb:arch:amd64:gpu`**：固定 16 核 / **48GB 显存**（H20 或 L40）/ 单次最长 18 小时。当前没有更小显存的节点可选。
- **为什么要「8G 模拟」**：目标设备是本机 8G 显存显卡（MiniCPM-V-4.6 实测 ~3.1GB，推理上限受帧数/分辨率影响）。云端 48G 跑得动不代表 8G 也能跑，所以在云端做推理验证时**必须用显存限制模拟 8G 约束**：

```bash
# 方式一: 限制 torch 最大显存（模拟 8G 卡）
export PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:256
# transformers 加载时限制 device_map 显存
python - <<'EOF'
import torch
from transformers import AutoModel, AutoTokenizer
m = AutoModel.from_pretrained(
    "OpenBMB/MiniCPM-V-4_6", torch_dtype=torch.bfloat16,
    device_map="cuda", max_memory={0: "7.5GB"})  # 模拟 8G 卡
EOF

# 方式二: 直接用 nvidia-smi 观察占用，视频识别帧数上限与本地一致
# 本地实测参数参考: 单图/短视频 3.1GB；视频推理帧上限 480（见 docs/开发进度跟踪.md）
```

- 云端跑 8080 推理服务（可选）：把 `D:\vision-server.py` 的逻辑在云端用等价 Python 服务复刻（模型从 ModelScope 拉 `OpenBMB/MiniCPM-V-4_6`；注意云端无摄像头/麦克风硬件，摄像头链路只能在本地验证）。
- 云端环境常用：`pnpm install`（diechi-harness 下）、`pnpm vitest run <spec>` 跑测试、`node --import tsx/esm apps/cli/src/bin.ts web --port 3090` 起服务冒烟。

## 6. 配置模板用法

`docs/settings.example.yaml` 是脱敏模板。本地把模板复制为 `diechi-home/settings.yaml` 后改（diechi-home 不进 git）。密钥用环境变量名（如 `apiKeyEnv: ABL_API_KEY`），实际值放在本地 `diechi-home/.credentials.yaml` 或系统环境变量。

**已知坑（改配置相关代码必读）**：`llm-pi-ai` 的 `apiKeyEnv` 若为空字符串 `''` 会导致整个供应商命名空间注册失败（供应商全部消失、添加按钮禁用）——2026-08-21 已修 `packages/llm/llm-pi-ai/src/config.ts`（空串按未设置处理），新增代码不要重新引入空字符串密钥。

## 7. 开发工作流（agent 版）

1. 从 `main` 拉新分支或直接小步提交（CNB 云开发环境里直接改）。
2. 改动聚焦、小步：一次一个主题，跑得动相关测试（`pnpm vitest run packages/...`）。
3. 提交信息用中文，说明改动目的和验证方式。
4. 合并/推送后提醒用户本地 `git pull` 验证（摄像头/语音硬件类改动必须本地实测）。
5. 涉及 UI 的改动尽量顺手加 Playwright 冒烟（参考 `docs/开发进度跟踪.md` 的验证记录风格）。

## 8. 当前 Roadmap 对齐（详细见 docs/开发进度跟踪.md）

- 电脑端：把现有功能打磨到「客户舒适」级别（再训练流程、设置项归类、供应商管理）
- 手机端：MiniCPM-V 4.6 面壁官方端侧方案集成（QNN/端侧推理，本地闭环无 API）
- 全双工 Omni：音视频流式对话（对标豆包实时视频通话），届时抄 OpenGlass OmniRuntime
- 眼镜 bridge：ESP32-S3 DIY → Rokid/RayNeo 适配，届时抄 OpenGlass esp32_bridge.py
