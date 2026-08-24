# -*- coding: utf-8 -*-
"""蝶翅APP 本地视觉 + 语音服务（入口，模块化结构）

对标视频通话的「模块分工协作」：
  vision/config.py       配置：云端/本地 热重载
  vision/cloud.py        云端视觉 API 客户端（DS 等 OpenAI 兼容）
  vision/media.py        媒体：视频解码/帧采样/关键帧/抽音轨
  vision/perception.py   感知：MiniCPM 场景理解（本地）/ 云端视觉
  vision/voice.py        语音：Kokoro TTS + faster-whisper ASR
  vision/sessions.py     对话编排：会话缓冲/消息构建/打断
  vision/server.py       服务：FastAPI 路由编排

端口 8080，兼容 OpenAI /v1/chat/completions 图像接口。
启动方式（与旧版一致）：python vision-server.py [port]
"""
import os

_CUDA_ROOT = r"D:\cuda-root"
if os.path.isdir(_CUDA_ROOT):
    os.environ["CUDA_PATH"] = _CUDA_ROOT
    os.environ["CUDA_LIB_PATH"] = os.path.join(_CUDA_ROOT, "bin")

import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vision.server import main  # noqa: E402

if __name__ == "__main__":
    main()
