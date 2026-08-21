# 蝶翅APP 云原生开发环境镜像
# 基于 CNB 默认开发镜像（已含 code-server / git / vscode 插件），叠加 Node + Python + 中文字符集
# GPU 节点为 cnb:arch:amd64:gpu（48GB H20），与本地 RTX 8G 的差异见 CNB开发指南
FROM cnbcool/default-dev-env:latest

# 常用工具 + Python + ffmpeg（视频抽帧/音频转写需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git wget curl unzip openssh-server ca-certificates \
    python3 python3-pip python3-venv ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 中文字符集（命令行输入/输出中文）
ENV LANG C.UTF-8
ENV LANGUAGE C.UTF-8
ENV LC_ALL C.UTF-8

# Node + pnpm（与本地 diechi-harness 对齐: Node >= 22, pnpm >= 9）
RUN corepack enable && corepack prepare pnpm@latest --activate
