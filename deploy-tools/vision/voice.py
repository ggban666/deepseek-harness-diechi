# -*- coding: utf-8 -*-
"""语音模块：Kokoro 中文 TTS + faster-whisper ASR（独立子进程，不抢视觉 GPU）。"""
import asyncio
import base64
import io
import itertools
import json
import os
import subprocess as sp
import sys
import tempfile
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .config import KOKORO_PATH

tts = None  # {sess, vocab, voices, g2p}
asr_model = None  # faster-whisper (video speech transcription)
asr_available = False  # ASR capability flag (health check)

# ---------- ASR（视频语音转写，独立子进程） ----------
# faster-whisper 基于 ctranslate2，与 torch 视觉模型同进程共存会争抢 GPU 并显著拖慢推理。
# 因此转写放到独立子进程执行：子进程独占 CUDA 上下文，退出后显存完全释放。
_DEPLOY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASR_HELPER = os.path.join(_DEPLOY_ROOT, "_asr_helper.py")
ASR_WORKER = os.path.join(_DEPLOY_ROOT, "_asr_worker.py")

# 常驻 faster-whisper worker：只加载一次模型，按行 JSON 收发任务，
# 把 ASR 单次延迟从 8s+（冷启动）降到 1~3s（模型已热）。
_asr_proc = None
_asr_proc_lock = threading.Lock()
_asr_seq = itertools.count(1)


def _ensure_asr_worker():
    global _asr_proc
    if _asr_proc is None or _asr_proc.poll() is not None:
        try:
            _asr_proc = sp.Popen(
                [sys.executable, ASR_WORKER],
                stdin=sp.PIPE, stdout=sp.PIPE, stderr=sp.DEVNULL,
                bufsize=1,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
        except Exception as exc:
            print("[asr] worker spawn error: %s" % exc, flush=True)
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
    """常驻 worker 转写 wav -> (text, segments)；失败或无声返回 (None, [])。

    segments 形如 [{"start": 秒, "end": 秒, "text": 句子}]，供视频实操按时间戳对齐画面与语音。
    """
    with _asr_proc_lock:
        proc = _ensure_asr_worker()
        if proc is None or proc.poll() is not None:
            return None, []
        job_id = next(_asr_seq)
        req = json.dumps({"id": job_id, "wav": base64.b64encode(wav_bytes).decode("ascii")}, ensure_ascii=False) + "\n"

        def _roundtrip(p):
            p.stdin.write(req.encode("utf-8"))
            p.stdin.flush()
            line = p.stdout.readline()
            if not line:
                raise RuntimeError("worker closed stdout")
            resp = json.loads(line.decode("utf-8", "ignore"))
            return ((resp.get("text") or "").strip() or None, resp.get("segments") or [])

        result = {}
        t = threading.Thread(target=lambda: result.update(res=_roundtrip(proc)), daemon=True)
        t.start()
        t.join(90)  # 90s 兜底：正常热模型 1~3s
        if t.is_alive():
            print("[asr] worker roundtrip timed out, restarting", flush=True)
            _kill_asr_worker()
            return None, []
        if "res" not in result and proc.poll() is not None:
            # worker 中途死掉（BrokenPipe 等）：重启一次并重试
            print("[asr] worker died mid-request, respawning", flush=True)
            _kill_asr_worker()
            proc2 = _ensure_asr_worker()
            if proc2 is not None and proc2.poll() is None:
                t = threading.Thread(target=lambda: result.update(res=_roundtrip(proc2)), daemon=True)
                t.start()
                t.join(90)
                if not t.is_alive() and "res" in result:
                    return result["res"]
            return None, []
        if "res" in result:
            return result["res"]
        return None, []


def transcribe_wav(wav_bytes):
    """faster-whisper 转写 -> 文本；失败或无声返回 None。"""
    if asr_model is None:
        return None
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            tmp = f.name
        segments, _info = asr_model.transcribe(tmp, language=None, vad_filter=True)
        parts = [seg.text.strip() for seg in segments]
        text = " ".join(p for p in parts if p)
        return text or None
    except Exception:
        return None
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


# ---------- TTS（Kokoro 中文，ONNX CPU） ----------
def load_tts():
    global tts
    import onnxruntime as ort
    from misaki import zh
    vocab = json.load(open(os.path.join(KOKORO_PATH, "tokenizer.json"), encoding="utf-8"))["model"]["vocab"]
    sess = ort.InferenceSession(os.path.join(KOKORO_PATH, "onnx", "model.onnx"), providers=["CPUExecutionProvider"])
    voices = {}
    for vf in Path(KOKORO_PATH, "voices").glob("*.bin"):
        voices[vf.stem] = np.fromfile(vf, dtype=np.float32).reshape(510, 256)
    try:
        from misaki.en import G2P as _EN_G2P
        en_g2p = _EN_G2P()
        g2p = zh.ZHG2P(version="1.1", en_callable=lambda en: en_g2p(en)[0])
        print("[tts] english enabled.", flush=True)
    except Exception as e:
        g2p = zh.ZHG2P(version="1.1")
        print("[tts] english disabled: " + str(e), flush=True)
    tts = {"sess": sess, "vocab": vocab, "voices": voices, "g2p": g2p}
    print("[tts] loaded.", flush=True)


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
