# -*- coding: utf-8 -*-
"""配置模块：路径、云端视觉配置。所有配置实时读文件，改动即生效，无需重启。"""
import json
import os

# ---------- 路径 ----------
_DEPLOY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _app_models_dir():
    """模型根目录：优先环境变量 DIEHCI_MODELS_DIR，否则相对本文件（安装包可任意放置）。"""
    env_dir = os.environ.get("DIEHCI_MODELS_DIR", "").strip()
    if env_dir:
        return env_dir
    return os.path.normpath(os.path.join(_DEPLOY_DIR, "..", "..", "models"))


MODEL_PATH = os.path.join(_app_models_dir(), "MiniCPM-V-4.6")
KOKORO_PATH = os.path.join(_app_models_dir(), "kokoro-zh")
_CLOUD_CONFIG_PATH = os.path.join(_DEPLOY_DIR, "vision-cloud.json")

# 命中前缀即视为云端模型（本地模型名一律走 MiniCPM）
_CLOUD_PREFIXES = (
    "deepseek", "glm-4.5", "glm-4.6", "qwen-vl", "qwen2.5-vl", "qwen3-vl",
    "kimi", "moonshot", "agnes", "step-", "internvl", "intern2.5",
)


def _cloud_config():
    """读取云端视觉配置；每次实时读文件，改动即生效。"""
    cfg = {"model": "", "baseURL": "", "apiKey": "", "maxFrames": 3, "timeoutSec": 90, "localModelPath": ""}
    try:
        with open(_CLOUD_CONFIG_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            for k in cfg:
                if k in data and data[k] not in (None, ""):
                    cfg[k] = data[k]
    except Exception:
        pass
    return cfg


def _is_cloud_model(name):
    """True 表示该模型名走云端 API；False 走本地 MiniCPM。"""
    if not name:
        return False
    name = str(name).strip().lower()
    if name in ("minicpm", "minicpm-v-4.6", "minicpm-v4.6", "local", "mini", "vlm-quant"):
        return False
    return any(name.startswith(p) for p in _CLOUD_PREFIXES)


def _current_model():
    """当前视觉模型名：配置 model 为空时默认本地 minicpm-v-4.6。"""
    m = (_cloud_config().get("model") or "").strip()
    return m or "minicpm-v-4.6"


def _vision_mode():
    """当前视觉模式：ds（云端）/ mini（本地）。"""
    return "ds" if _is_cloud_model(_current_model()) else "mini"
