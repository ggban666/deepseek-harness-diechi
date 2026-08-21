# -*- coding: utf-8 -*-
"""
蝶翅APP 本地视觉 + 语音服务
- MiniCPM-V-4.6（官方权重，transformers 5.15 直接推理，真视频理解）
- Kokoro 中文 TTS（ONNX，CPU）
端口 8080，兼容 OpenAI /v1/chat/completions 图像接口。
"""
import os
os.environ['CUDA_PATH'] = r'D:\cuda-root'
os.environ['CUDA_LIB_PATH'] = r'D:\cuda-root\bin'

import asyncio
import base64
import io
import json
import re
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
import uuid as _uuid
from collections import deque as _deque
import torch
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, StreamingResponse
from concurrent.futures import ThreadPoolExecutor
from pydantic import BaseModel, Field

MODEL_PATH = r'D:\桌面\振翅新科\models\MiniCPM-V-4.6'
KOKORO_PATH = r'D:\桌面\振翅新科\models\kokoro-zh'
MAX_UPLOAD_FRAMES = 48  # 解码上限：48 帧在 8G 显卡上约 13s / 7GB 峰值；240 帧会产生 3w+ token 直接 OOM

def _adaptive_frame_cap(width, height):
    """按分辨率调整帧数上限，保证输入 token 数在 8G 显卡安全范围内。"""
    area = width * height
    if area <= 640 * 480:
        return MAX_UPLOAD_FRAMES
    if area <= 1280 * 720:
        return 36
    return 24
MAX_UPLOAD_SECONDS = 900  # 超长视频直接拒绝（摄像头录制可长达 15 分钟）

app = FastAPI(title='diechi vision+tts', version='1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)
infer_lock = asyncio.Lock()

# ---------- 模型加载 ----------
processor = None
model = None
tts = None  # {sess, vocab, voices, g2p}
asr_model = None  # faster-whisper (video speech transcription)
asr_available = False  # ASR capability flag (health check)


def load_vision():
    global processor, model
    from transformers import AutoModelForImageTextToText, AutoProcessor
    print('[vision] loading processor...', flush=True)
    processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
    print('[vision] loading model...', flush=True)
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_PATH, trust_remote_code=True, dtype=torch.bfloat16, device_map='cuda'
    )
    model.eval()
    print('[vision] loaded.', flush=True)


def load_tts():
    global tts
    import onnxruntime as ort
    from misaki import zh
    vocab = json.load(open(os.path.join(KOKORO_PATH, 'tokenizer.json'), encoding='utf-8'))['model']['vocab']
    sess = ort.InferenceSession(os.path.join(KOKORO_PATH, 'onnx', 'model.onnx'), providers=['CPUExecutionProvider'])
    voices = {}
    for vf in Path(KOKORO_PATH, 'voices').glob('*.bin'):
        voices[vf.stem] = np.fromfile(vf, dtype=np.float32).reshape(510, 256)
    try:
        from misaki.en import G2P as _EN_G2P
        en_g2p = _EN_G2P()
        g2p = zh.ZHG2P(version='1.1', en_callable=lambda en: en_g2p(en)[0])
        print('[tts] english enabled.', flush=True)
    except Exception as e:
        g2p = zh.ZHG2P(version='1.1')
        print('[tts] english disabled: ' + str(e), flush=True)
    tts = {'sess': sess, 'vocab': vocab, 'voices': voices, 'g2p': g2p}
    print('[tts] loaded.', flush=True)


# ---------- ASR（视频语音转写，独立子进程） ----------
# faster-whisper 基于 ctranslate2，与 torch 视觉模型同进程共存会争抢 GPU 并显著拖慢推理。
# 因此转写放到独立子进程执行：子进程独占 CUDA 上下文，退出后显存完全释放。
ASR_HELPER = r'D:\桌面\振翅新科\蝶翅-app\deploy-tools\_asr_helper.py'
ASR_WORKER = r'D:\桌面\振翅新科\蝶翅-app\deploy-tools\_asr_worker.py'

# 常驻 faster-whisper worker：只加载一次模型，按行 JSON 收发任务，
# 把 ASR 单次延迟从 8s+（冷启动）降到 1~3s（模型已热）。
import threading as _threading
import itertools as _itertools
_asr_proc = None
_asr_proc_lock = _threading.Lock()
_asr_seq = _itertools.count(1)


def _ensure_asr_worker():
    global _asr_proc
    import subprocess as sp
    if _asr_proc is None or _asr_proc.poll() is not None:
        try:
            _asr_proc = sp.Popen(
                [sys.executable, ASR_WORKER],
                stdin=sp.PIPE, stdout=sp.PIPE, stderr=sp.DEVNULL,
                bufsize=1,
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
            )
        except Exception as exc:
            print('[asr] worker spawn error: %s' % exc, flush=True)
            _asr_proc = None
    return _asr_proc


def _kill_asr_worker():
    global _asr_proc
    proc = _asr_proc
    _asr_proc = None
    if proc is not None:
        try:
            proc.kill()
        except Exception:
            pass


def transcribe_wav_subprocess(wav_bytes):
    """常驻 worker 转写 wav -> 文本；失败或无声返回 None。"""
    import base64 as _b64
    with _asr_proc_lock:
        proc = _ensure_asr_worker()
        if proc is None or proc.poll() is not None:
            return None
        job_id = next(_asr_seq)
        req = json.dumps({'id': job_id, 'wav': _b64.b64encode(wav_bytes).decode('ascii')}, ensure_ascii=False) + '\n'

        def _roundtrip():
            proc.stdin.write(req.encode('utf-8'))
            proc.stdin.flush()
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError('worker closed stdout')
            resp = json.loads(line.decode('utf-8', 'ignore'))
            return (resp.get('text') or '').strip() or None

        result = {}
        t = _threading.Thread(target=lambda: result.update(text=_roundtrip()), daemon=True)
        t.start()
        t.join(90)  # 90s 兜底：正常热模型 1~3s
        if t.is_alive():
            print('[asr] worker roundtrip timed out, restarting', flush=True)
            _kill_asr_worker()
            return None
        if 'text' in result:
            return result['text']
        return None


def _ffmpeg_bin():
    import shutil
    for cand in (shutil.which('ffmpeg'), r'D:\ffmpeg\bin\ffmpeg.exe'):
        if cand:
            return cand
    return 'ffmpeg'


def extract_audio_wav(file_bytes, name):
    """ffmpeg 抽取音轨 -> 16k 单声道 wav bytes；无音轨返回 None。"""
    import subprocess as sp
    suffix = Path(name).suffix.lower() or '.mp4'
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(file_bytes)
            tmp = f.name
        proc = sp.run(
            [_ffmpeg_bin(), '-y', '-i', tmp, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
            capture_output=True, timeout=180,
        )
        if proc.returncode != 0 or not proc.stdout:
            return None
        return proc.stdout
    except Exception:
        return None
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def transcribe_wav(wav_bytes):
    """faster-whisper 转写 -> 文本；失败或无声返回 None。"""
    if asr_model is None:
        return None
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            f.write(wav_bytes)
            tmp = f.name
        segments, _info = asr_model.transcribe(tmp, language=None, vad_filter=True)
        parts = [seg.text.strip() for seg in segments]
        text = ' '.join(p for p in parts if p)
        return text or None
    except Exception:
        return None
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass



def _probe_video(tmp_path):
    """ffprobe 读取真实 fps/时长（cv2 对 webm/vp8 的 fps 常误读，必须校正）。失败返回 None。"""
    import subprocess as sp
    try:
        ff = _ffmpeg_bin()
        probe = ff.replace('ffmpeg.exe', 'ffprobe.exe').replace('ffmpeg', 'ffprobe')
        proc = sp.run(
            [probe, '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=r_frame_rate,duration', '-of', 'json', tmp_path],
            capture_output=True, timeout=30,
        )
        if proc.returncode != 0 or not proc.stdout:
            return None
        data = json.loads(proc.stdout)
        st = (data.get('streams') or [{}])[0]
        fps = None
        rfr = st.get('r_frame_rate') or ''
        if '/' in rfr:
            num, den = rfr.split('/')
            try:
                num, den = float(num), float(den or 1)
                fps = num / den if den > 0 else None
            except ValueError:
                fps = None
        dur = st.get('duration')
        return {
            'fps': fps if fps and fps > 1 else None,
            'duration': float(dur) if dur else None,
        }
    except Exception:
        return None

def decode_video(file_bytes: bytes, name: str):
    """cv2 两遍解码：grab() 精确计数 -> 按步长 retrieve() 采样（内存安全）。
    cv2 对 webm/vp8 的 fps 与帧数读取极不可靠（同文件多次读取结果不同），
    因此 fps 以 ffprobe 为准，帧数以 grab 实读为准；
    duration 始终与采样帧数/有效 fps 自洽，否则模型会按错误时长生成巨量 token 导致 OOM。"""
    import cv2
    suffix = Path(name).suffix.lower() or '.mp4'
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(file_bytes)
            tmp = f.name
        probe = _probe_video(tmp)
        cap = cv2.VideoCapture(tmp)
        if not cap.isOpened():
            raise ValueError('video decode failed')
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        max_frames = _adaptive_frame_cap(w, h)
        fps = probe['fps'] if probe and probe['fps'] else (cap.get(cv2.CAP_PROP_FPS) or 0)
        if not (1 <= fps <= 120):
            fps = 25.0  # 最常见的录制帧率兜底
        # 第一遍：只 grab 不解码，精确统计真实帧数
        count = 0
        while cap.grab():
            count += 1
        cap.release()
        if count == 0:
            raise ValueError('no frames decoded')
        if probe and probe['duration'] and probe['duration'] > 0:
            dur_est = probe['duration']
        else:
            dur_est = count / fps
        if dur_est > MAX_UPLOAD_SECONDS:
            raise ValueError(f'video too long (>{MAX_UPLOAD_SECONDS}s)')
        stride = max(1, int(np.ceil(count / max_frames)))
        cap = cv2.VideoCapture(tmp)
        frames = []
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % stride == 0:
                frames.append(frame[:, :, ::-1])
                if len(frames) >= max_frames:
                    break
            idx += 1
        cap.release()
        if len(frames) == 0:
            raise ValueError('no frames decoded')
        # 关键：MiniCPM 处理器按 duration 生成时间位置 token（不看 total_num_frames）。
        # duration 必须 = 采样帧数 / 原始 fps，否则长视频会产生 2w+ token 直接 OOM/卡死。
        # fps 保持原始帧率（ffprobe 校正），时长按采样帧数折算，二者相乘恰等于采样帧数。
        return np.stack(frames), fps, len(frames) / fps
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def run_vision(messages):
    """transformers 推理。messages 为 [{role, content:[{type, ...}]}]。"""
    import copy
    from transformers.video_utils import VideoMetadata
    from PIL import Image
    # apply_chat_template 会原地归一化 image_url -> image/url，先深拷贝保护原始结构
    text = processor.apply_chat_template(copy.deepcopy(messages), add_generation_prompt=True)
    images = []
    videos = []
    video_meta = []
    for part in messages[-1]['content']:
        ptype = part.get('type', '')
        if ptype in ('image', 'image_url') or 'image_url' in part:
            if isinstance(part.get('image_url'), dict):
                raw = part.get('image_url', {}).get('url', '') or part.get('image', '')
            else:
                raw = part.get('url', '') or part.get('image', '')
            if raw.startswith('data:'):
                raw = raw.split(',', 1)[1]
            images.append(Image.open(io.BytesIO(base64.b64decode(raw))).convert('RGB'))
        elif ptype == 'video' and part.get('video') is not None:
            frames, fps, duration = part['video']
            videos.append(frames)
            video_meta.append(VideoMetadata(
                total_num_frames=len(frames), fps=fps,
                width=frames.shape[2], height=frames.shape[1],
                duration=duration or (len(frames) / fps),
            ))
    if videos:
        inputs = processor(text=[text], videos=videos, video_metadata=video_meta, return_tensors='pt').to('cuda')
    else:
        inputs = processor(text=[text], images=images, return_tensors='pt').to('cuda')
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=1024, temperature=0.2, do_sample=True)
    gen = out[0][inputs['input_ids'].shape[1]:]
    return processor.decode(gen, skip_special_tokens=True).strip()


class ChatRequest(BaseModel):
    model: str = 'minicpm-v-4.6'
    messages: list = Field(default_factory=list)
    max_tokens: int = 1024
    temperature: float = 0.2
    stream: bool = False


@app.get('/health')
async def health():
    return {
        'status': 'ok',
        'vision': model is not None,
        'tts': tts is not None,
        'asr': os.path.exists(ASR_WORKER),
        'vram_mb': round(torch.cuda.max_memory_allocated() / 1024 / 1024) if model is not None else 0,
    }


@app.post('/v1/chat/completions')
async def chat_completions(req: ChatRequest):
    if model is None:
        raise HTTPException(503, 'vision model not loaded')
    if not req.messages:
        raise HTTPException(400, 'empty messages')
    hm = []
    for m in req.messages:
        content = m.get('content')
        if isinstance(content, str):
            content = [{'type': 'text', 'text': content}]
        hm.append({'role': m.get('role', 'user'), 'content': content})
    async with infer_lock:
        try:
            content = await asyncio.to_thread(run_vision, hm)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(500, str(exc))
    return {'choices': [{'message': {'role': 'assistant', 'content': content}}]}


SKILL_PROMPT = (
    '请仔细观察这段视频（画面按时间顺序），综合描述视频里发生的事、涉及的动作和场景，'
    '并推断它适合封装成什么技能。只输出一个 JSON 对象，不要任何其他文字：'
    '{"name":"技能名称","purpose":"什么时候用它（一句话）","steps":"关键步骤，用分号分隔","rules":"注意事项，用分号分隔"}'
)


@app.post('/api/v1/video/describe')
async def video_describe(file: UploadFile = File(...), prompt: str = ''):
    if model is None:
        raise HTTPException(503, 'vision model not loaded')
    data = await file.read()
    if not data:
        raise HTTPException(400, 'empty upload')
    try:
        frames, fps, duration = await asyncio.to_thread(decode_video, data, file.filename or 'video.mp4')
    except Exception as exc:
        raise HTTPException(422, str(exc))
    # 语音转写：抽音轨 -> 独立子进程 faster-whisper（不占主进程 GPU）
    t_asr0 = time.time()
    transcript = None
    try:
        wav = await asyncio.to_thread(extract_audio_wav, data, file.filename or 'video.mp4')
        if wav:
            transcript = await asyncio.to_thread(transcribe_wav_subprocess, wav)
            print('[video] asr %s -> %s' % (round(time.time() - t_asr0, 1), 'ok' if transcript else 'none'), flush=True)
    except Exception:
        transcript = None
    if transcript:
        text_prompt = (
            '请仔细观察这段视频（画面按时间顺序），并结合视频中的语音讲解，'
            '综合理解视频想表达的内容（画面动作、语音说明、操作步骤等），'
            '推断它适合封装成什么技能。只输出一个 JSON 对象，不要任何其他文字：'
            '{"name":"技能名称","purpose":"什么时候用它（一句话）","steps":"关键步骤，用分号分隔","rules":"注意事项，用分号分隔"}'
            '\n\n视频中的语音内容（转写）：\n' + transcript
        )
    else:
        text_prompt = prompt.strip() or SKILL_PROMPT
    messages = [{'role': 'user', 'content': [
        {'type': 'video', 'video': (frames, fps, duration)},
        {'type': 'text', 'text': text_prompt},
    ]}]
    t_vis0 = time.time()
    async with infer_lock:
        try:
            content = await asyncio.to_thread(run_vision, messages)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(500, 'vision inference failed: ' + str(exc)[:300])
    print('[video] frames=%s vision=%ss' % (len(frames), round(time.time() - t_vis0, 1)), flush=True)
    draft = None
    m = re.search(r'\{.*\}', content, re.S)
    if m:
        raw = m.group(0)
        try:
            draft = json.loads(raw)
        except json.JSONDecodeError:
            try:
                import re as _re
                draft = json.loads(_re.sub(r',\s*}', '}', raw.replace(';', ',')))
            except json.JSONDecodeError:
                draft = None
    transcript_display = transcript
    if transcript_display and len(transcript_display) > 2000:
        transcript_display = transcript_display[:2000] + '……'
    return {
        'content': content, 'draft': draft,
        'frames': int(len(frames)), 'duration': round(duration or 0, 2),
        'transcript': transcript_display,
    }


@app.post('/api/v1/asr')
async def asr_endpoint(
    file: UploadFile = File(None),
    audio_base64: str = Form(''),
    mime: str = Form(''),
):
    """语音转文字：multipart 上传任意音频（file 或 audio_base64 字段，wav/mp3/webm/ogg 等
    任意 ffmpeg 可解格式），转 16k 单声道 wav 后由独立子进程 faster-whisper 转写，返回 {text}。
    子进程隔离 CUDA 上下文，不拖慢视觉推理。"""
    data = None
    name = None
    if file is not None:
        data = await file.read()
        name = file.filename or 'audio.webm'
    elif audio_base64:
        data = base64.b64decode(audio_base64)
        name = 'audio.' + (mime.split('/')[-1] or 'webm')
    if not data:
        raise HTTPException(400, 'empty audio')
    wav = await asyncio.to_thread(extract_audio_wav, data, name)
    if not wav:
        raise HTTPException(422, 'audio decode failed (no playable track)')
    t0 = time.time()
    text = await asyncio.to_thread(transcribe_wav_subprocess, wav)
    print('[asr] %ss -> %s' % (round(time.time() - t0, 1), 'ok' if text else 'none'), flush=True)
    return {'text': text or '', 'ok': bool(text)}


class TTSRequest(BaseModel):
    text: str
    voice: str = 'zf_001'
    speed: float = 1.0


def split_sentences(text):
    CJK_STOP = chr(0x3002) + chr(0xFF01) + chr(0xFF1F) + chr(0xFF1B) + chr(10) + "!?;"
    SENT_RE = __import__("re").compile("([^" + CJK_STOP + "]+[" + CJK_STOP + "]?[" + chr(0x201D) + chr(0x2019) + chr(0xFF09) + chr(34) + ")]*|[" + CJK_STOP + "]+)")
    parts = [p.strip() for p in SENT_RE.findall(text) if p.strip()]
    if not parts:
        return [text]
    merged = []
    buf = ""
    for p in parts:
        buf += p
        if len(buf) >= 14 or (buf and buf[-1] in CJK_STOP):
            merged.append(buf)
            buf = ""
    if buf:
        merged.append(buf)
    return merged


def _pcm_from_wav(data):
    with wave.open(io.BytesIO(data), "rb") as w:
        return w.readframes(w.getnframes())


def _wav_from_pcm(pcm):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
    return buf.getvalue()


_tts_cache = {}
_TTS_CACHE_MAX = 256
_tts_order = []


def _cache_get(key):
    val = _tts_cache.get(key)
    if val is not None:
        _tts_order.remove(key)
        _tts_order.append(key)
    return val


def _cache_set(key, val):
    if key in _tts_cache:
        _tts_order.remove(key)
    _tts_cache[key] = val
    _tts_order.append(key)
    while len(_tts_order) > _TTS_CACHE_MAX:
        _tts_cache.pop(_tts_order.pop(0), None)


def synth_one(text, voice, speed):
    key = (text, voice, round(float(speed), 2))
    hit = _cache_get(key)
    if hit is not None:
        return hit
    if tts is None:
        raise RuntimeError("tts not loaded")
    if voice not in tts["voices"]:
        raise ValueError("unknown voice: " + voice)
    ps, _ = tts["g2p"](text)
    ps_f = "".join(c for c in ps if c in tts["vocab"])
    if not ps_f:
        raise ValueError("no pronounceable phonemes")
    ids = np.asarray([0] + [tts["vocab"][c] for c in ps_f] + [0], dtype=np.int64)[None, :]
    style = tts["voices"][voice][len(ps_f) - 1][None, :].astype(np.float32)
    spd = np.asarray([float(speed)], dtype=np.float32)
    wave_out, _ = tts["sess"].run(["waveform", "duration"], {"input_ids": ids, "style": style, "speed": spd})
    pcm = np.clip(wave_out * 32767, -32768, 32767).astype(np.int16)
    audio = _wav_from_pcm(pcm.tobytes())
    _cache_set(key, audio)
    return audio


_TTS_EXECUTOR = ThreadPoolExecutor(max_workers=3)


def synth(text: str, voice: str, speed: float):
    parts = split_sentences(text)
    if len(parts) > 1:
        chunks = [f.result() for f in [_TTS_EXECUTOR.submit(synth_one, p, voice, speed) for p in parts]]
        return _wav_from_pcm(b"".join(_pcm_from_wav(c) for c in chunks))
    return synth_one(text, voice, speed)

@app.post('/api/v1/tts')
async def tts_endpoint(req: TTSRequest):
    try:
        audio = await asyncio.to_thread(synth, req.text, req.voice, req.speed)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return Response(audio, media_type='audio/wav')
@app.post('/api/v1/tts/stream')
async def tts_stream_endpoint(req: TTSRequest):
    try:
        parts = split_sentences(req.text)
        if not parts:
            raise ValueError("empty text")
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    async def gen():
        try:
            loop = asyncio.get_running_loop()
            futures = [loop.run_in_executor(_TTS_EXECUTOR, synth_one, p, req.voice, req.speed) for p in parts]
            for i, fut in enumerate(futures):
                audio = await fut
                yield json.dumps({"i": i, "audio": base64.b64encode(audio).decode("ascii")}) + chr(10)
        except Exception as exc:
            yield json.dumps({"error": str(exc)}) + chr(10)

    return StreamingResponse(gen(), media_type="application/x-ndjson")





# ---------- 视觉会话：流式多帧对话（对标 OpenGlass 会话化） ----------
VISION_SESSIONS = {}
_VISION_SESSION_MAX = 32            # 最多同时存活会话
_VISION_SESSION_TTL = 600.0         # 10 分钟无活动自动回收
MAX_SESSION_FRAMES = 12             # 每会话保留最近 12 帧（8G 显存安全）
MAX_SESSION_TEXT_TURNS = 12         # 文字历史条数上限

VISION_SYSTEM_PROMPT = (
    '你是蝶翅的实时视频通话助手，正通过摄像头看着用户。'
    '用户消息里以「【用户语音】」开头的内容是用户刚刚说话转成的文字，请结合画面简短回应用户；'
    '没有用户语音时，用一句简短自然的中文（15~30字）描述画面中人物此刻正在做什么，没有人物就描述场景。'
    '回答口语、拟人、简短（不超过30字），直接输出内容，不要前缀、引号或解释。'
)


class VisionSession:
    """一次摄像头对话会话：最近帧环形缓冲 + 文字历史 + 取消事件。"""
    __slots__ = ('sid', 'created', 'last_active', 'frames', 'messages', 'cancel', 'busy')

    def __init__(self):
        self.sid = _uuid.uuid4().hex[:12]
        self.created = time.time()
        self.last_active = time.time()
        self.frames = _deque()   # [(ts, jpeg_bytes)]
        self.messages = []       # [{role, content:[{type:'text',...}]}]
        self.cancel = _threading.Event()
        self.busy = False


def _session_get(sid):
    """取会话；不存在则新建。顺带惰性回收过期/超量会话。"""
    now = time.time()
    sess = VISION_SESSIONS.get(sid) if sid else None
    if sess is None:
        sess = VisionSession()
        VISION_SESSIONS[sess.sid] = sess
        sid = sess.sid
    sess.last_active = now
    stale = [k for k, v in VISION_SESSIONS.items() if now - v.last_active > _VISION_SESSION_TTL]
    for k in stale:
        VISION_SESSIONS.pop(k, None)
    if len(VISION_SESSIONS) > _VISION_SESSION_MAX:
        for k in sorted(VISION_SESSIONS, key=lambda kk: VISION_SESSIONS[kk].last_active)[:len(VISION_SESSIONS) - _VISION_SESSION_MAX]:
            VISION_SESSIONS.pop(k, None)
    return sess


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
    for part in messages[-1]['content']:
        ptype = part.get('type', '')
        if ptype in ('image', 'image_url') or 'image_url' in part:
            if isinstance(part.get('image_url'), dict):
                raw = part.get('image_url', {}).get('url', '') or part.get('image', '')
            else:
                raw = part.get('url', '') or part.get('image', '')
            if raw.startswith('data:'):
                raw = raw.split(',', 1)[1]
            images.append(Image.open(io.BytesIO(base64.b64decode(raw))).convert('RGB'))
        elif ptype == 'video' and part.get('video') is not None:
            frames, fps, duration = part['video']
            videos.append(frames)
            video_meta.append(VideoMetadata(
                total_num_frames=len(frames), fps=fps,
                width=frames.shape[2], height=frames.shape[1],
                duration=duration or (len(frames) / fps),
            ))
    if videos:
        return processor(text=[text], videos=videos, video_metadata=video_meta, return_tensors='pt').to('cuda')
    if images:
        return processor(text=[text], images=images, return_tensors='pt').to('cuda')
    # Text-only fallback keeps the SSE endpoint usable while a camera frame is
    # unavailable (for example before video metadata becomes ready).
    return processor(text=[text], return_tensors='pt').to('cuda')


def run_vision_stream(messages, cancel_ev, max_new_tokens=120, temperature=0.2):
    """流式 transformers 推理，yield 文本增量；cancel_ev 置位后尽快停止。"""
    from transformers import TextIteratorStreamer, StoppingCriteria, StoppingCriteriaList
    tokenizer = getattr(processor, 'tokenizer', None) or processor
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    inputs = _prepare_vision_inputs(messages)
    gen_kwargs = dict(
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        do_sample=True,
        streamer=streamer,
        stopping_criteria=StoppingCriteriaList([_CancelCriteria(cancel_ev)]),
    )
    with torch.inference_mode():
        thread = _threading.Thread(
            target=model.generate, kwargs={**inputs, **gen_kwargs}, daemon=True
        )
        thread.start()
        try:
            for piece in streamer:
                yield piece
        finally:
            cancel_ev.set()
            thread.join(timeout=120)


def _frames_to_video_content(sess):
    """把会话帧缓冲打包成 MiniCPM video content（统一尺寸 + 自洽 fps/duration）。"""
    if not sess.frames:
        return None
    from PIL import Image
    imgs = [Image.open(io.BytesIO(b)).convert('RGB') for _, b in sess.frames]
    w0, h0 = imgs[0].size
    imgs = [im if im.size == (w0, h0) else im.resize((w0, h0)) for im in imgs]
    frames = np.stack([np.asarray(im) for im in imgs])
    if len(sess.frames) >= 2:
        ts = [t for t, _ in sess.frames]
        dt = float(np.median(np.diff(ts)))
        fps = float(np.clip(1.0 / dt if dt > 0 else 1.0, 0.2, 4.0))
    else:
        fps = 1.0
    return {'type': 'video', 'video': (frames, fps, len(frames) / fps)}


def _build_session_messages(sess, user_text):
    msgs = [{'role': 'system', 'content': [{'type': 'text', 'text': VISION_SYSTEM_PROMPT}]}]
    msgs += sess.messages[-MAX_SESSION_TEXT_TURNS:]
    content = []
    vc = _frames_to_video_content(sess)
    if vc is not None:
        content.append(vc)
    content.append({'type': 'text', 'text': user_text or '（请结合画面简短描述当前场景）'})
    msgs.append({'role': 'user', 'content': content})
    return msgs


def _stream_session_turn(sess, user_text, max_new_tokens, temperature):
    """在调用线程执行一轮会话推理，yield 文本增量；结束后把轮次写回历史。"""
    parts = []
    try:
        for piece in run_vision_stream(
            _build_session_messages(sess, user_text), sess.cancel,
            max_new_tokens, temperature,
        ):
            if piece:
                parts.append(piece)
                yield piece
    finally:
        out = ''.join(parts).strip()
        if user_text:
            sess.messages.append({'role': 'user', 'content': [{'type': 'text', 'text': user_text}]})
        if out:
            sess.messages.append({'role': 'assistant', 'content': [{'type': 'text', 'text': out}]})
        if len(sess.messages) > MAX_SESSION_TEXT_TURNS:
            del sess.messages[:len(sess.messages) - MAX_SESSION_TEXT_TURNS]
        sess.busy = False


class VisionStreamRequest(BaseModel):
    session_id: str = ''
    frame: str = ''          # JPEG data_url（可选）
    text: str = ''           # 用户语音转写/提问（可选）
    max_tokens: int = 120
    temperature: float = 0.2


@app.post('/api/v1/vision/session')
async def vision_session_create():
    """创建/获取一个摄像头对话会话，返回 session_id。"""
    sess = _session_get('')
    return {'session_id': sess.sid}


@app.delete('/api/v1/vision/session/{sid}')
async def vision_session_delete(sid: str):
    sess = VISION_SESSIONS.pop(sid, None)
    if sess is not None:
        sess.cancel.set()
    return {'ok': True}


@app.post('/api/v1/vision/session/{sid}/interrupt')
async def vision_session_interrupt(sid: str):
    """打断当前正在生成的轮次（等价 OpenGlass 的 force_listen/break）。"""
    sess = VISION_SESSIONS.get(sid)
    if sess is not None:
        sess.cancel.set()
        return {'ok': True, 'canceled': True}
    return {'ok': True, 'canceled': False}


async def _turn_stream(sess, text, max_new_tokens, temperature):
    """后台线程跑一轮，事件循环里流式产出增量；消费者提前 break 可安全取消。"""
    q = asyncio.Queue()
    stop = _threading.Event()

    def _worker():
        def _put(item):
            q.put_nowait(item)
        try:
            for piece in _stream_session_turn(sess, text, max_new_tokens, temperature):
                if stop.is_set():
                    break
                loop.call_soon_threadsafe(_put, piece)
        except Exception as exc:
            loop.call_soon_threadsafe(_put, ('__err__', str(exc)))
        finally:
            loop.call_soon_threadsafe(_put, None)

    loop = asyncio.get_running_loop()
    task = loop.run_in_executor(None, _worker)
    try:
        while True:
            item = await q.get()
            if item is None:
                break
            if isinstance(item, tuple) and item and item[0] == '__err__':
                raise RuntimeError(item[1])
            yield item
    finally:
        stop.set()
        sess.cancel.set()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=60)
        except Exception:
            pass


@app.post('/api/v1/vision/stream')
async def vision_stream(req: VisionStreamRequest):
    """会话化流式视觉对话：帧 + 文本 -> SSE（session/delta/done/error 事件）。

    帧进会话环形缓冲（音频优先策略由前端控制发送时机），模型一次吃最近 N 帧；
    text 会作为 user 消息累积进会话历史。前端可随时 POST /interrupt 打断。
    """
    if model is None:
        raise HTTPException(503, 'vision model not loaded')
    sess = _session_get(req.session_id)
    if req.frame:
        raw = req.frame.split(',', 1)[-1] if ',' in req.frame else req.frame
        try:
            jpeg = base64.b64decode(raw)
            sess.frames.append((time.time(), jpeg))
            while len(sess.frames) > MAX_SESSION_FRAMES:
                sess.frames.popleft()
        except Exception:
            pass
    sess.busy = True
    sess.cancel.clear()

    async def gen():
        try:
            yield 'data: ' + json.dumps({'type': 'session', 'session_id': sess.sid}) + '\n\n'
            async with infer_lock:
                async for piece in _turn_stream(sess, req.text, req.max_tokens, req.temperature):
                    if piece:
                        yield 'data: ' + json.dumps({'type': 'delta', 'delta': piece}) + '\n\n'
        except Exception as exc:
            import traceback
            traceback.print_exc()
            try:
                yield 'data: ' + json.dumps({'type': 'error', 'error': str(exc)[:300]}) + '\n\n'
            except Exception:
                pass
        finally:
            sess.cancel.set()
            try:
                yield 'data: ' + json.dumps({'type': 'done'}) + '\n\n'
            except Exception:
                pass

    return StreamingResponse(
        gen(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    load_vision()
    try:
        load_tts()
        try:
            synth_one(chr(0x4F60) + chr(0x597D) + chr(0x3002), "zf_001", 1.0)
            print("[tts] warmed up.", flush=True)
        except Exception as exc:
            print("[tts] warmup failed:", exc, flush=True)
    except Exception as exc:
        print('[tts] load failed (non-fatal):', exc, flush=True)
    # ASR 常驻 worker 预热：后台先加载 faster-whisper，用户第一次说话即是热调用
    try:
        _ensure_asr_worker()
        print('[asr] worker prewarmed.', flush=True)
    except Exception as exc:
        print('[asr] worker prewarm failed:', exc, flush=True)
    uvicorn.run(app, host='127.0.0.1', port=port, log_level='info')



