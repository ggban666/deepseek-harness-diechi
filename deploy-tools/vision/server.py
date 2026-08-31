# -*- coding: utf-8 -*-
"""服务模块：FastAPI 路由 + 模块编排（视频通话分工的“指挥”）。

模块分工：
- 采集：前端摄像头推帧 -> /observe（只入缓冲，不推理）
- 感知：perception.MiniCPM 本地场景理解 / 云端视觉通道
- 对话编排：sessions 会话缓冲/消息构建/打断
- 语音：voice.TTS + ASR（独立子进程）
- 云端：cloud._cloud_post（DS 等 OpenAI 兼容接口）
"""
import asyncio
import base64
import json
import os
import re
import sys
import time

import torch
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import cloud
from . import config as cfg
from . import distill as distill_mod
from . import media
from . import memory as memmod
from . import perception
from . import sessions as sessmod
from . import voice as voice_mod

# 持续识别节流：每 3 秒识别一帧（事件流累积节奏，可调）。
_RECOGNIZE_INTERVAL = 3.0
_MAX_CAPTIONS = 20


async def _run_recognition(sess, jpeg):
    """后台单帧识别 -> 事件流；用户回合到来时 RECOG_CANCEL 置位，识别下个 token 即停（让路）。"""
    perception.RECOG_CANCEL.clear()
    try:
        async with perception.infer_lock:
            text = await asyncio.to_thread(perception.recognize_frame_jpeg, jpeg, 80, perception.RECOG_CANCEL)
            if text and text.strip():
                sess.captions.append((time.time(), text.strip()))
                while len(sess.captions) > _MAX_CAPTIONS:
                    sess.captions.popleft()
                # M1 块摘要调度：空闲窗口内顺手把新 captions 压成块记忆入库（已在锁内，不抢 GPU）
                try:
                    digest, _n = await asyncio.to_thread(memmod.maybe_digest_block, sess)
                    if digest:
                        print("[memory] block digest: %s" % digest[:80], flush=True)
                except Exception:
                    pass
    except Exception:
        pass
    finally:
        sess.recogBusy = False


app = FastAPI(title="diechi vision+tts", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "vision": perception.model is not None or cfg._vision_mode() == "ds",
        "vision_mode": cfg._vision_mode(),
        "vision_model": cfg._current_model(),
        "tts": voice_mod.tts is not None,
        "asr": os.path.exists(voice_mod.ASR_WORKER),
        "vram_mb": round(torch.cuda.max_memory_allocated() / 1024 / 1024) if perception.model is not None else 0,
    }


class VisionModelRequest(BaseModel):
    model: str = ""


@app.get("/api/v1/vision/model")
async def vision_model_get():
    cc = cfg._cloud_config()
    return {
        "model": cfg._current_model(),
        "mode": cfg._vision_mode(),
        "cloud": {
            "configured": bool(cc.get("baseURL") and cc.get("apiKey") and cc.get("model")),
            "baseURL": cc.get("baseURL") or "",
            "model": cc.get("model") or "",
        },
    }


@app.post("/api/v1/vision/model")
async def vision_model_set(req: VisionModelRequest):
    model_name = (req.model or "").strip()
    if not model_name:
        raise HTTPException(400, "model required")
    try:
        with open(cfg._CLOUD_CONFIG_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    data["model"] = model_name
    with open(cfg._CLOUD_CONFIG_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    # 切到云端时释放本地模型显存（切回 mini 时懒加载）
    if cfg._is_cloud_model(model_name) and perception.model is not None:
        perception.unload_vision()
    return {"model": cfg._current_model(), "mode": cfg._vision_mode()}


class ChatRequest(BaseModel):
    model: str = "minicpm-v-4.6"
    messages: list = Field(default_factory=list)
    max_tokens: int = 1024
    temperature: float = 0.2
    stream: bool = False


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    if not req.messages:
        raise HTTPException(400, "empty messages")
    hm = []
    for m in req.messages:
        content = m.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        hm.append({"role": m.get("role", "user"), "content": content})
    cc = cfg._cloud_config()
    use_cloud = cfg._is_cloud_model((cc.get("model") or req.model or ""))
    if use_cloud:
        if not (cc.get("baseURL") and cc.get("apiKey") and cc.get("model")):
            raise HTTPException(503, "云端视觉未配置：请填写 deploy-tools/vision-cloud.json（model/baseURL/apiKey）")
        try:
            parts = [p async for p in cloud._cloud_post(hm, cc, req.max_tokens, req.temperature, stream=False)]
            content = "".join(parts).strip()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(502, "云端视觉调用失败: " + str(exc)[:300])
        return {"choices": [{"message": {"role": "assistant", "content": content}}]}
    await asyncio.to_thread(perception._ensure_vision_loaded)
    if perception.model is None:
        raise HTTPException(503, "vision model not loaded")
    async with perception.infer_lock:
        try:
            content = await asyncio.to_thread(perception.run_vision, hm)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(500, str(exc))
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


SKILL_PROMPT = (
    "请仔细观察这段视频（画面按时间顺序），综合描述视频里发生的事、涉及的动作和场景，"
    "并推断它适合封装成什么技能。只输出一个 JSON 对象，不要任何其他文字："
    "{\"name\":\"技能名称\",\"purpose\":\"什么时候用它（一句话）\",\"steps\":\"关键步骤，用分号分隔\",\"rules\":\"注意事项，用分号分隔\"}"
)


async def _prepare_video_media(data, name):
    """解码视频 + 抽音轨 ASR（带时间戳分段）。返回 (frames, fps, duration, seg_text, transcript)。
    供 video/describe 与 video/distill 共用。"""
    try:
        frames, fps, duration = await asyncio.to_thread(media.decode_video, data, name)
    except Exception as exc:
        raise HTTPException(422, str(exc))
    # 语音转写：抽音轨 -> 独立子进程 faster-whisper（不占主进程 GPU），带时间戳分段
    t_asr0 = time.time()
    transcript, segments = None, []
    try:
        wav = await asyncio.to_thread(media.extract_audio_wav, data, name)
        if wav:
            transcript, segments = await asyncio.to_thread(voice_mod.transcribe_wav_subprocess, wav)
            print("[video] asr %s -> %s (%d segs)" % (
                round(time.time() - t_asr0, 1), "ok" if transcript else "none", len(segments)), flush=True)
    except Exception:
        transcript, segments = None, []
    seg_lines = []
    for sg in segments or []:
        st, en = float(sg.get("start") or 0), float(sg.get("end") or 0)
        tx = (sg.get("text") or "").strip()
        if tx:
            seg_lines.append("[%02d:%02d-%02d:%02d] %s" % (
                int(st // 60), int(st % 60), int(en // 60), int(en % 60), tx))
    return frames, fps, duration, "\n".join(seg_lines), transcript


async def _video_overview(frames, fps, duration, seg_text):
    """阶段 1：老师傅详述（本地 MiniCPM / 云端双通道）。"""
    cc = cfg._cloud_config()
    use_cloud = cfg._is_cloud_model(cfg._current_model())
    prompt = distill_mod.overview_prompt(len(frames), duration, seg_text)
    if use_cloud:
        cloud_images, _n = media._frames_to_cloud_images(frames, cc.get("maxFrames") or 8)
        msgs = [{"role": "user", "content": cloud_images + [{"type": "text", "text": prompt}]}]
        parts = [p async for p in cloud._cloud_post(msgs, cc, 2048, 0.35, stream=False)]
        return "".join(parts).strip()
    msgs = [{"role": "user", "content": [
        {"type": "video", "video": (frames, fps, duration)},
        {"type": "text", "text": prompt},
    ]}]
    async with perception.infer_lock:
        return await asyncio.to_thread(perception.run_vision, msgs)


@app.post("/api/v1/video/describe")
async def video_describe(file: UploadFile = File(...), prompt: str = ""):
    """视频操作提炼（两阶段）：
    阶段 1：帧 + 语音时间戳转写 -> 详细操作过程叙述（老师傅教徒弟）；
    阶段 2：纯文本提炼 -> 可复用技能 JSON。
    本地 MiniCPM / 云端 DS 两套通道均支持。
    """
    cc = cfg._cloud_config()
    use_cloud = cfg._is_cloud_model(cfg._current_model())
    if use_cloud and not (cc.get("baseURL") and cc.get("apiKey") and cc.get("model")):
        raise HTTPException(503, "云端视觉未配置：请填写 deploy-tools/vision-cloud.json（model/baseURL/apiKey）")
    if not use_cloud:
        await asyncio.to_thread(perception._ensure_vision_loaded)
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    frames, fps, duration, seg_text, transcript = await _prepare_video_media(data, file.filename or "video.mp4")
    # 阶段 1：详细操作过程叙述
    t_vis0 = time.time()
    process = await _video_overview(frames, fps, duration, seg_text)
    n_frames = int(len(frames))
    if cfg._is_cloud_model(cfg._current_model()):
        print("[video][ds] stage1 vision=%ss" % round(time.time() - t_vis0, 1), flush=True)
    else:
        print("[video] stage1 frames=%s vision=%ss" % (n_frames, round(time.time() - t_vis0, 1)), flush=True)
    if not process:
        process = ""
    # 阶段 2：纯文本提炼技能 JSON
    stage2_prompt = (
        "下面是某段实操视频的过程详述。请把它提炼成可复用的技能定义。"
        "只输出一个 JSON 对象，不要任何其他文字："
        "{\"name\":\"技能名称\",\"purpose\":\"什么时候用它（一句话）\",\"steps\":\"关键步骤，用分号分隔\",\"rules\":\"注意事项，用分号分隔\"}"
        "要求：steps 要包含关键动作、所用工具与判断要点；rules 要包含易错点与成功标准。"
        "\n\n过程详述：\n" + process
        + ("\n\n语音转写：\n" + seg_text if seg_text else "")
    )
    if use_cloud:
        stage2_messages = [{"role": "user", "content": [{"type": "text", "text": stage2_prompt}]}]
        try:
            parts = [p async for p in cloud._cloud_post(stage2_messages, cc, 1024, 0.35, stream=False)]
            content = "".join(parts).strip()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(502, "云端提炼失败: " + str(exc)[:300])
    else:
        async with perception.infer_lock:
            try:
                content = await asyncio.to_thread(perception.run_vision_text, stage2_prompt)
            except Exception as exc:
                import traceback
                traceback.print_exc()
                raise HTTPException(500, "vision refine failed: " + str(exc)[:300])
    draft = None
    m = re.search(r"\{.*\}", content, re.S)
    if m:
        raw = m.group(0)
        try:
            draft = json.loads(raw)
        except json.JSONDecodeError:
            try:
                draft = json.loads(re.sub(r",\s*}", "}", raw.replace(";", ",")))
            except json.JSONDecodeError:
                draft = None
    transcript_display = transcript
    if transcript_display and len(transcript_display) > 2000:
        transcript_display = transcript_display[:2000] + "……"
    return {
        "content": content, "draft": draft, "process": process,
        "frames": n_frames, "duration": round(duration or 0, 2),
        "transcript": transcript_display,
    }


@app.post("/api/v1/video/distill")
async def video_distill(file: UploadFile = File(None), video_path: str = Form(""), max_skills: int = Form(3)):
    """视频蒸馏（cangjie-skill v2.5 RIA-TV++ 本地移植）：
    视频 -> 老师傅详述 + 时间戳 ASR -> 4 路提取（原则/框架/反例/案例）-> 编译成
    diechi 技能包草稿（frontmatter md）-> 落 diechi-home/distill-inbox/ 供人工 review
    后装入 skills/。file（multipart 上传）或 video_path（本机路径）二选一。
    蒸馏 LLM：云端通道已配置走云端，否则走本地 MiniCPM（纯文本推理）。"""
    cc = cfg._cloud_config()
    use_cloud = cfg._is_cloud_model(cfg._current_model())
    if use_cloud and not (cc.get("baseURL") and cc.get("apiKey") and cc.get("model")):
        raise HTTPException(503, "云端视觉未配置：请填写 deploy-tools/vision-cloud.json（model/baseURL/apiKey）")
    if not use_cloud:
        await asyncio.to_thread(perception._ensure_vision_loaded)
    if file is not None:
        data = await file.read()
        name = file.filename or "video.mp4"
    elif video_path:
        p = os.path.normpath(video_path)
        if not os.path.isfile(p):
            raise HTTPException(404, "视频不存在: %s" % video_path)
        with open(p, "rb") as fh:
            data = fh.read()
        name = os.path.basename(p)
    else:
        raise HTTPException(400, "需要 file（上传）或 video_path（本机路径）之一")
    if not data:
        raise HTTPException(400, "empty upload")
    frames, fps, duration, seg_text, _tr = await _prepare_video_media(data, name)
    if frames is None or len(frames) == 0:
        raise HTTPException(422, "no frames decoded")
    t0 = time.time()
    process = await _video_overview(frames, fps, duration, seg_text)
    if not process or not process.strip():
        raise HTTPException(500, "阶段1详述为空")
    overview = distill_mod.merge_material(process, seg_text)

    def _llm(prompt):
        return perception.run_vision_text(prompt)

    async with perception.infer_lock:
        result = await asyncio.to_thread(distill_mod.run_distill, overview, _llm,
                                         {"maxSkills": max(1, min(int(max_skills or 3), 5)),
                                          "sourceVideo": name})
    skills = result.get("skills") or []
    print("[distill] %s frames=%s total=%ss skills=%d" % (
        name, len(frames), round(time.time() - t0, 1), len(skills)), flush=True)
    return {
        "ok": True, "source": name, "duration": round(duration or 0, 2), "frames": len(frames),
        "overview_chars": len(process), "skills": skills,
        "inbox": distill_mod.inbox_dir(),
        "extractor_raw": {k: (v[:1200] if isinstance(v, str) else v)
                          for k, v in (result.get("units") or {}).items()},
        "compiled_preview": (result.get("compiled") or "")[:1500],
    }


@app.get("/api/v1/memory/stats")
async def memory_stats():
    """长期语义记忆统计（M1 可观测）。"""
    st = memmod.STORE
    kinds = {}
    for e in st.entries:
        kinds[e.get("kind", "?")] = kinds.get(e.get("kind", "?"), 0) + 1
    return {"entries": len(st.entries), "kinds": kinds,
            "data_dir": memmod._DATA_DIR, "vector_backend": "bge-small-zh" if memmod._get_st_model() is not None else "jieba-hash"}


@app.get("/api/v1/memory/search")
async def memory_search(q: str = "", k: int = 5):
    """检索长期语义记忆（调试/前端回看面板用）。"""
    hits = memmod.STORE.search(q, k=max(1, min(k, 20)))
    return {"hits": [{"score": round(s, 3), **e} for s, e in hits]}


@app.post("/api/v1/memory/save")
async def memory_save():
    """手动落盘（正常情况下写入即标脏，下次块摘要后自动存）。"""
    memmod.STORE.save()
    return {"ok": True, "entries": len(memmod.STORE.entries)}


@app.post("/api/v1/asr")
async def asr_endpoint(
    file: UploadFile = File(None),
    audio_base64: str = Form(""),
    mime: str = Form(""),
):
    """语音转文字：multipart 上传任意音频（file 或 audio_base64 字段，wav/mp3/webm/ogg 等
    任意 ffmpeg 可解格式），转 16k 单声道 wav 后由独立子进程 faster-whisper 转写，返回 {text}。
    子进程隔离 CUDA 上下文，不拖慢视觉推理。"""
    data = None
    name = None
    if file is not None:
        data = await file.read()
        name = file.filename or "audio.webm"
    elif audio_base64:
        data = base64.b64decode(audio_base64)
        name = "audio." + (mime.split("/")[-1] or "webm")
    if not data:
        raise HTTPException(400, "empty audio")
    wav = await asyncio.to_thread(media.extract_audio_wav, data, name)
    if not wav:
        raise HTTPException(422, "audio decode failed (no playable track)")
    t0 = time.time()
    text, _segs = await asyncio.to_thread(voice_mod.transcribe_wav_subprocess, wav)
    print("[asr] %ss -> %s" % (round(time.time() - t0, 1), "ok" if text else "none"), flush=True)
    return {"text": text or "", "ok": bool(text)}


@app.get("/api/v1/voices")
async def voices_get():
    """本机可用的 Kokoro 音色列表（按 voices 目录扫描）。"""
    from pathlib import Path
    base = cfg.KOKORO_PATH
    out = []
    try:
        for vf in sorted(Path(base, "voices").glob("*.bin")):
            vid = vf.stem
            gender = "女声" if vid.startswith("zf_") or vid.startswith("af_") or vid.startswith("bf_") else ("男声" if vid.startswith("zm_") or vid.startswith("am_") or vid.startswith("bm_") else "")
            label = (gender + " " + vid).strip() if gender else vid
            out.append({"id": vid, "label": label})
    except Exception:
        pass
    return {"voices": out}


class TTSRequest(BaseModel):
    text: str
    voice: str = "zf_001"
    speed: float = 1.0


@app.post("/api/v1/tts")
async def tts_endpoint(req: TTSRequest):
    try:
        audio = await asyncio.to_thread(voice_mod.synth, req.text, req.voice, req.speed)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return Response(audio, media_type="audio/wav")


@app.post("/api/v1/tts/stream")
async def tts_stream_endpoint(req: TTSRequest):
    try:
        parts = voice_mod.split_sentences(req.text)
        if not parts:
            raise ValueError("empty text")
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    async def gen():
        try:
            loop = asyncio.get_running_loop()
            futures = [loop.run_in_executor(voice_mod._TTS_EXECUTOR, voice_mod.synth_one, p, req.voice, req.speed) for p in parts]
            for i, fut in enumerate(futures):
                audio = await fut
                yield json.dumps({"i": i, "audio": base64.b64encode(audio).decode("ascii")}) + chr(10)
        except Exception as exc:
            yield json.dumps({"error": str(exc)}) + chr(10)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class VisionStreamRequest(BaseModel):
    session_id: str = ""
    frame: str = ""          # JPEG data_url（可选）
    text: str = ""           # 用户语音转写/提问（可选）
    max_tokens: int = 120
    temperature: float = 0.2
    reason: str = "speech"   # 打包触发原因：scene（场景变化）/ speech（用户说话）/ timer（定时确认）
    diff: float = -1.0       # 该帧相对上一帧的画面差异 0..1（前端指纹算好传来，-1 表示未知）
    persona: str = ""        # 当前平权技能人格与规则（热切换：换技能=换人格）
    memory: str = ""         # 最近视觉记忆时间线（长期记忆）


@app.post("/api/v1/vision/session")
async def vision_session_create():
    """创建/获取一个摄像头对话会话，返回 session_id。"""
    sess = sessmod._session_get("")
    return {"session_id": sess.sid}


@app.delete("/api/v1/vision/session/{sid}")
async def vision_session_delete(sid: str):
    sess = sessmod.VISION_SESSIONS.pop(sid, None)
    if sess is not None:
        sess.cancel.set()
    return {"ok": True}


@app.post("/api/v1/vision/session/{sid}/observe")
async def vision_session_observe(sid: str, req: VisionStreamRequest):
    """连续感知：高频推帧只入会话缓冲（不触发推理、不回复）。
    用户说话/提问时，模型依据缓冲里的连续帧记忆回答。"""
    sess = sessmod.VISION_SESSIONS.get(sid)
    if sess is None:
        raise HTTPException(404, "session not found")
    caption = ""
    if req.frame:
        raw = req.frame.split(",", 1)[-1] if "," in req.frame else req.frame
        try:
            jpeg = base64.b64decode(raw)
            sess.frames.append((time.time(), jpeg))
            while len(sess.frames) > sessmod.MAX_SESSION_FRAMES:
                sess.frames.popleft()
        except Exception:
            pass
        # 持续识别（节流）：每 3 秒识别一帧 -> 事件流累积；后台跑，不阻塞推帧。
        now = time.time()
        if not sess.recogBusy and now - sess.lastRecogAt >= _RECOGNIZE_INTERVAL:
            sess.recogBusy = True
            sess.lastRecogAt = now
            asyncio.create_task(_run_recognition(sess, jpeg))
        # 环境统计：前端指纹差异 >= 0.15 视为一次显著场景变化
        if 0.0 <= req.diff <= 1.0 and req.diff >= 0.15:
            sess.envChangedCount += 1
            sess.envLastChangeAt = time.time()
    if sess.captions:
        caption = sess.captions[-1][1]
    sess.last_active = time.time()
    return {"ok": True, "frames": len(sess.frames), "caption": caption}


@app.post("/api/v1/vision/session/{sid}/interrupt")
async def vision_session_interrupt(sid: str):
    """打断当前正在生成的轮次（等价 OpenGlass 的 force_listen/break）。"""
    sess = sessmod.VISION_SESSIONS.get(sid)
    if sess is not None:
        sess.cancel.set()
        return {"ok": True, "canceled": True}
    return {"ok": True, "canceled": False}


@app.post("/api/v1/vision/stream")
async def vision_stream(req: VisionStreamRequest):
    """会话化流式视觉对话：帧 + 文本 -> SSE（session/delta/done/error 事件）。

    帧进会话环形缓冲（音频优先策略由前端控制发送时机），模型一次吃最近 N 帧；
    text 会作为 user 消息累积进会话历史。前端可随时 POST /interrupt 打断。
    当前视觉模型为云端时走云端分支，否则本地 MiniCPM。
    """
    cc = cfg._cloud_config()
    use_cloud = cfg._is_cloud_model(cfg._current_model())
    if not use_cloud:
        try:
            await asyncio.to_thread(perception._ensure_vision_loaded)
        except Exception as exc:
            raise HTTPException(503, "vision model not loaded: " + str(exc)[:200])
    sess = sessmod._session_get(req.session_id)
    if req.frame:
        raw = req.frame.split(",", 1)[-1] if "," in req.frame else req.frame
        try:
            jpeg = base64.b64decode(raw)
            sess.frames.append((time.time(), jpeg))
            while len(sess.frames) > sessmod.MAX_SESSION_FRAMES:
                sess.frames.popleft()
        except Exception:
            pass
    sess.busy = True
    sess.cancel.clear()
    # 技能热切换：每轮下发当前平权技能人格+记忆，增量更新 system prompt。
    if req.persona:
        sess.persona = req.persona
    if req.memory:
        sess.memory = req.memory
    # 用户回合优先：让正在后台运行的持续识别尽快停止，让出推理通道。
    perception.RECOG_CANCEL.set()

    async def gen():
        try:
            yield "data: " + json.dumps({"type": "session", "session_id": sess.sid}) + "\n\n"
            reason = req.reason if req.reason in ("scene", "speech", "timer") else "speech"
            if use_cloud:
                async for piece in sessmod._cloud_stream_session_turn(sess, req.text, req.max_tokens, req.temperature, cc, reason):
                    if piece:
                        yield "data: " + json.dumps({"type": "delta", "delta": piece}) + "\n\n"
            else:
                async with perception.infer_lock:
                    async for piece in sessmod._turn_stream(sess, req.text, req.max_tokens, req.temperature, reason):
                        if piece:
                            yield "data: " + json.dumps({"type": "delta", "delta": piece}) + "\n\n"
        except Exception as exc:
            import traceback
            traceback.print_exc()
            try:
                yield "data: " + json.dumps({"type": "error", "error": str(exc)[:300]}) + "\n\n"
            except Exception:
                pass
        finally:
            sess.cancel.set()
            try:
                yield "data: " + json.dumps({"type": "done"}) + "\n\n"
            except Exception:
                pass

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    if cfg._vision_mode() == "mini":
        # 视觉模型改为懒加载：首个视觉请求时才占显存，空闲超过 VISION_IDLE_SEC
        # 后由 perception 的后台守护线程自动释放。这样 8080 启动时几乎不占显存，
        # 27B 进化引擎(8081) 可在视觉空闲期与之共存（8GB 显存不再被常驻占满）。
        print("[vision] mini 模式：视觉模型懒加载（启动不占显存，空闲自动释放）", flush=True)
    else:
        print("[vision] cloud mode: 跳过本地模型加载（显存不占）", flush=True)
    try:
        voice_mod.load_tts()
        try:
            voice_mod.synth_one(chr(0x4F60) + chr(0x597D) + chr(0x3002), "zf_001", 1.0)
            print("[tts] warmed up.", flush=True)
        except Exception as exc:
            print("[tts] warmup failed:", exc, flush=True)
    except Exception as exc:
        print("[tts] load failed (non-fatal):", exc, flush=True)
    # ASR 常驻 worker 预热：后台先加载 faster-whisper，用户第一次说话即是热调用
    try:
        voice_mod._ensure_asr_worker()
        print("[asr] worker prewarmed.", flush=True)
    except Exception as exc:
        print("[asr] worker prewarm failed:", exc, flush=True)
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
