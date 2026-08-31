# -*- coding: utf-8 -*-
"""感知模块：MiniCPM 场景理解（本地推理，懒加载，云端模式不占显存）。
"""
import asyncio
import base64
import io
import os
import threading
import time

import numpy as np
import torch

from . import config as cfg

# ---------- MiniCPM 场景理解（本地推理） ----------
processor = None
model = None
infer_lock = asyncio.Lock()
# 识别让路开关：用户回合开始时置位，后台持续识别在下一个 token 停止（数据流让路给 LLM 回合）。
RECOG_CANCEL = threading.Event()
_vision_load_lock = threading.Lock()

VISION_SYSTEM_PROMPT = (
    "你是蝶翅的实时视频通话助手，正在通过摄像头持续观察用户环境。"
    "你的输入包含【视觉时间线】：这是摄像头逐帧识别结果的累积（第1条最早），"
    "代表你「前面发生了什么」的连续记录；【环境状态】是本次打包的触发原因与观察时长。"
    "回答时基于时间线说出具体物体、文字和动作细节，不要泛泛而谈。"
    "打包触发规则："
    "1. 用户消息以【用户语音】开头＝用户开口提问，必须具体详细地回答，"
    "可以引用时间线里之前看到的内容（例如「你前面几秒看到的那个东西是……」）。"
    "2. 打包原因=场景变化＝画面发生了明显变化：用一句简短自然的中文（15~30字）说明变化并描述现在看到的环境。"
    "3. 打包原因=定时确认＝画面与上次基本稳定：用一句话自然确认当前环境即可（不要重复罗列细节）。"
    "回答口语、拟人，直接输出内容，不要前缀、引号或解释。"
)


def load_vision():
    global processor, model
    from transformers import AutoModelForImageTextToText, AutoProcessor
    print("[vision] loading processor...", flush=True)
    processor = AutoProcessor.from_pretrained(cfg.MODEL_PATH, trust_remote_code=True)
    print("[vision] loading model...", flush=True)
    model = AutoModelForImageTextToText.from_pretrained(
        cfg.MODEL_PATH, trust_remote_code=True, dtype=torch.bfloat16, device_map="cuda"
    )
    model.eval()
    print("[vision] loaded.", flush=True)


def _ensure_vision_loaded():
    """本地推理入口调用：按需懒加载 MiniCPM（云端模式下不占显存）。"""
    global model, _last_vision_use
    if model is not None:
        return
    if cfg._vision_mode() != "mini":
        raise RuntimeError("当前为云端模式，未加载本地视觉模型")
    with _vision_load_lock:
        if model is None:
            load_vision()
            _last_vision_use = time.time()


def unload_vision():
    """切换到云端模式时释放本地模型显存；切回 mini 时懒加载。"""
    global processor, model
    model = None
    processor = None
    torch.cuda.empty_cache()
    print("[vision] 已释放本地模型，切换为云端模式", flush=True)


# ---------- 空闲自动卸载（释放显存，供其他 GPU 任务共存） ----------
# 视觉模型仅在推理期间占显存；空闲超过该秒数由守护线程自动 unload，
# 让 27B 进化引擎(8081) 等需要显存的常驻任务能在空闲期共存。
VISION_IDLE_SEC = float(os.environ.get("VISION_IDLE_SEC", "300"))
_last_vision_use = 0.0
_active_infers = 0
_idle_lock = threading.Lock()


def _vision_begin():
    """标记一次推理开始（占用期间禁止空闲卸载）。"""
    global _active_infers, _last_vision_use
    with _idle_lock:
        _active_infers += 1
        _last_vision_use = time.time()


def _vision_end():
    """标记一次推理结束，并更新最后使用时间。"""
    global _active_infers, _last_vision_use
    with _idle_lock:
        _active_infers -= 1
        _last_vision_use = time.time()


def _vision_idle_watcher():
    """后台守护线程：视觉模型空闲超过 VISION_IDLE_SEC 后自动释放显存。"""
    while True:
        time.sleep(30)
        try:
            with _idle_lock:
                idle_too_long = (
                    model is not None
                    and _active_infers == 0
                    and (time.time() - _last_vision_use) > VISION_IDLE_SEC
                )
            if idle_too_long:
                print(
                    f"[vision] 空闲超过 {VISION_IDLE_SEC:.0f}s，自动释放视觉模型显存",
                    flush=True,
                )
                unload_vision()
        except Exception:
            pass


threading.Thread(target=_vision_idle_watcher, daemon=True, name="vision-idle-watcher").start()


def run_vision(messages):
    """transformers 推理。messages 为 [{role, content:[{type, ...}]}]。"""
    _vision_begin()
    try:
        import copy
        from transformers.video_utils import VideoMetadata
        from PIL import Image
        # apply_chat_template 会原地归一化 image_url -> image/url，先深拷贝保护原始结构
        text = processor.apply_chat_template(copy.deepcopy(messages), add_generation_prompt=True)
        images = []
        videos = []
        video_meta = []
        for part in messages[-1]["content"]:
            ptype = part.get("type", "")
            if ptype in ("image", "image_url") or "image_url" in part:
                if isinstance(part.get("image_url"), dict):
                    raw = part.get("image_url", {}).get("url", "") or part.get("image", "")
                else:
                    raw = part.get("url", "") or part.get("image", "")
                if raw.startswith("data:"):
                    raw = raw.split(",", 1)[1]
                try:
                    images.append(Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB"))
                except Exception:
                    continue
            elif ptype == "video" and part.get("video") is not None:
                frames, fps, duration = part["video"]
                videos.append(frames)
                video_meta.append(VideoMetadata(
                    total_num_frames=len(frames), fps=fps,
                    width=frames.shape[2], height=frames.shape[1],
                    duration=duration or (len(frames) / fps),
                ))
        if videos:
            inputs = processor(text=[text], videos=videos, video_metadata=video_meta, return_tensors="pt").to("cuda")
        elif images:
            inputs = processor(text=[text], images=images, return_tensors="pt").to("cuda")
        else:
            inputs = processor(text=[text], return_tensors="pt").to("cuda")
        with torch.inference_mode():
            out = model.generate(**inputs, max_new_tokens=1024, temperature=0.2, do_sample=True)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return processor.decode(gen, skip_special_tokens=True).strip()
    finally:
        _vision_end()


def run_vision_text(text, max_new_tokens=1024):
    """纯文本推理（视频操作提炼第二阶段用，不吃图，省 token）。
    必须走 apply_chat_template：否则模型把输入当续写复述，不会按指令输出 JSON。"""
    _vision_begin()
    try:
        import copy
        msgs = [{"role": "user", "content": [{"type": "text", "text": text}]}]
        prompt = processor.apply_chat_template(copy.deepcopy(msgs), add_generation_prompt=True)
        with torch.inference_mode():
            inputs = processor(text=[prompt], return_tensors="pt").to("cuda")
            out = model.generate(**inputs, max_new_tokens=int(max_new_tokens), temperature=0.2, do_sample=True)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return processor.decode(gen, skip_special_tokens=True).strip()
    finally:
        _vision_end()


def recognize_frame_jpeg(jpeg_bytes, max_new_tokens=80, cancel_ev=None):
    """单帧持续识别：用一句话描述这一帧最重要的信息（画面文字逐字念出/主要物体/动作）。
    供摄像头会话的事件流累积（每 N 秒识别一帧，结果带时间戳入列）。"""
    if model is None:
        _ensure_vision_loaded()
    _vision_begin()
    try:
        import copy
        from PIL import Image
        im = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        prompt = (
            "持续观察模式：用一句简短中文（25字内）描述这一帧画面里最重要的信息："
            "可辨识的文字逐字念出来、主要物体、人物动作。只输出这一句，不要任何前缀。"
        )
        msgs = [{"role": "user", "content": [
            {"type": "image", "image": None},
            {"type": "text", "text": prompt},
        ]}]
        text = processor.apply_chat_template(copy.deepcopy(msgs), add_generation_prompt=True)
        inputs = processor(text=[text], images=[im], return_tensors="pt").to("cuda")
        gen_kwargs = dict(max_new_tokens=max_new_tokens, temperature=0.2, do_sample=True)
        if cancel_ev is not None:
            from transformers import StoppingCriteriaList
            gen_kwargs["stopping_criteria"] = StoppingCriteriaList([_CancelCriteria(cancel_ev)])
        with torch.inference_mode():
            out = model.generate(**inputs, **gen_kwargs)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return processor.decode(gen, skip_special_tokens=True).strip()
    except Exception:
        return ""
    finally:
        _vision_end()


try:
    from transformers import StoppingCriteria as _SC, StoppingCriteriaList as _SCL
except Exception:
    _SC = object
    _SCL = None


class _CancelCriteria(_SC):
    """置位即让 generate 在下一个 token 停止（打断用）。"""

    def __init__(self, ev):
        super().__init__()
        self.ev = ev

    def __call__(self, input_ids, scores, **kwargs):
        return self.ev.is_set()


def _prepare_vision_inputs(messages):
    """与 run_vision 相同的输入组装：apply_chat_template + 收集 image/video。"""
    import copy
    from transformers.video_utils import VideoMetadata
    from PIL import Image
    text = processor.apply_chat_template(copy.deepcopy(messages), add_generation_prompt=True)
    images = []
    videos = []
    video_meta = []
    for part in messages[-1]["content"]:
        ptype = part.get("type", "")
        if ptype in ("image", "image_url") or "image_url" in part:
            if isinstance(part.get("image_url"), dict):
                raw = part.get("image_url", {}).get("url", "") or part.get("image", "")
            else:
                raw = part.get("url", "") or part.get("image", "")
            if raw.startswith("data:"):
                raw = raw.split(",", 1)[1]
            try:
                images.append(Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB"))
            except Exception:
                continue
        elif ptype == "video" and part.get("video") is not None:
            frames, fps, duration = part["video"]
            videos.append(frames)
            video_meta.append(VideoMetadata(
                total_num_frames=len(frames), fps=fps,
                width=frames.shape[2], height=frames.shape[1],
                duration=duration or (len(frames) / fps),
            ))
    if videos:
        return processor(text=[text], videos=videos, video_metadata=video_meta, return_tensors="pt").to("cuda")
    if images:
        return processor(text=[text], images=images, return_tensors="pt").to("cuda")
    # Text-only fallback keeps the SSE endpoint usable while a camera frame is
    # unavailable (for example before video metadata becomes ready).
    return processor(text=[text], return_tensors="pt").to("cuda")


def run_vision_stream(messages, cancel_ev, max_new_tokens=120, temperature=0.2):
    """流式 transformers 推理，yield 文本增量；cancel_ev 置位后尽快停止。"""
    from transformers import TextIteratorStreamer, StoppingCriteria, StoppingCriteriaList
    tokenizer = getattr(processor, "tokenizer", None) or processor
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    inputs = _prepare_vision_inputs(messages)
    gen_kwargs = dict(
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        do_sample=True,
        streamer=streamer,
        stopping_criteria=StoppingCriteriaList([_CancelCriteria(cancel_ev)]),
    )
    _vision_begin()
    with torch.inference_mode():
        thread = threading.Thread(
            target=model.generate, kwargs={**inputs, **gen_kwargs}, daemon=True
        )
        thread.start()
        try:
            for piece in streamer:
                yield piece
        finally:
            cancel_ev.set()
            thread.join(timeout=120)
            _vision_end()
