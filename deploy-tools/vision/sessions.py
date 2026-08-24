# -*- coding: utf-8 -*-
"""对话编排模块：摄像头会话缓冲、消息构建、打断。

职责（对应视频通话的模块分工）：
- 采集到的帧进环形缓冲（最近 60 帧记忆）；
- 用户说话/提问时才触发一轮推理，其余时间只感知不打扰；
- 本地 MiniCPM / 云端 DS 两条推理通道由这里统一编排。
"""
import asyncio
import json
import threading as _threading
import time
import uuid as _uuid
from collections import deque as _deque

from . import cloud
from . import config as cfg
from . import media
from . import perception

VISION_SESSIONS = {}
_VISION_SESSION_MAX = 32            # 最多同时存活会话
_VISION_SESSION_TTL = 600.0         # 10 分钟无活动自动回收
MAX_SESSION_FRAMES = 60             # 每会话保留最近 60 帧（连续感知记忆，推理时先去重再采样）
MAX_SESSION_TEXT_TURNS = 12         # 文字历史条数上限

class VisionSession:
    """一次摄像头对话会话：最近帧环形缓冲 + 连续识别事件流 + 文字历史 + 取消事件。"""
    __slots__ = ("sid", "created", "last_active", "frames", "messages", "cancel", "busy",
                 "captions", "recogBusy", "lastRecogAt",
                 "envFirstAt", "envChangedCount", "envLastChangeAt", "envLastPacketAt",
                 "persona", "memory")

    def __init__(self):
        self.sid = _uuid.uuid4().hex[:12]
        self.created = time.time()
        self.last_active = time.time()
        self.frames = _deque()   # [(ts, jpeg_bytes)] 最近 60 帧（打包时取最新帧作单帧）
        self.messages = []       # [{role, content:[{type:"text",...}]}]
        self.cancel = _threading.Event()
        self.busy = False
        # 逐帧识别事件流（视觉时间线）：[(ts, text)]，第 0 条最早
        self.captions = _deque()
        self.recogBusy = False   # 后台识别任务占用标志（避免并发堆叠）
        self.lastRecogAt = 0.0   # 上次开始识别的时间（节流）
        # 环境观察统计（持续感知累积，打包时注入 prompt）
        self.envFirstAt = time.time()      # 本会话开始观察的时间
        self.envChangedCount = 0           # 累积的场景显著变化次数
        self.envLastChangeAt = None        # 最近一次显著变化时间
        self.envLastPacketAt = None        # 最近一次打包发送时间
        # 当前平权技能上下文（前端每轮热切换下发）：人格=勾选技能内容，记忆=最近视觉记忆
        self.persona = ""
        self.memory = "" 


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


def _session_captions_context(sess, max_n=8):
    """事件流时间线：[(ts, text)] -> prompt 文本块（第1条最早）。"""
    if not sess.captions:
        return ""
    recent = list(sess.captions)[-max_n:]
    lines = []
    for i, (ts, text) in enumerate(recent, 1):
        t = text.strip()
        if not t:
            continue
        ago = int(time.time() - ts)
        if ago < 1:
            lines.append("第%d条（现在）：%s" % (i, t))
        else:
            lines.append("第%d条（%d秒前）：%s" % (i, ago, t))
    if not lines:
        return ""
    return "【视觉时间线】（持续识别累积，第1条最早）\n" + "\n".join(lines)


def _session_env_state(sess, reason):
    """构建【环境状态】块：观察时长/变化次数/最近变化/打包原因/距上次打包。"""
    now = time.time()
    lines = []
    lines.append("打包原因：%s" % {"scene": "场景变化", "speech": "用户说话", "timer": "定时确认"}.get(reason, "用户说话"))
    duration = now - sess.envFirstAt
    if duration > 0:
        lines.append("本会话已连续观察 %d 秒" % int(duration))
    if sess.envChangedCount > 0:
        lines.append("期间画面显著变化 %d 次" % sess.envChangedCount)
        if sess.envLastChangeAt is not None:
            ago = now - sess.envLastChangeAt
            lines.append("最近一次变化在 %d 秒前" % int(ago))
    else:
        lines.append("期间画面基本稳定（无明显场景变化）")
    if sess.envLastPacketAt is not None:
        ago = now - sess.envLastPacketAt
        if ago > 0:
            lines.append("距上次打包 %d 秒" % int(ago))
    return "【环境状态】\n" + "\n".join(lines)


def _session_system_prompt(sess):
    """基础系统提示 + 当前平权技能人格/记忆（技能热切换 = 换一个人）。"""
    base = perception.VISION_SYSTEM_PROMPT
    extra = []
    if sess.persona and sess.persona.strip():
        extra.append("【当前平权技能：人格与规则】\n" + sess.persona.strip())
    if sess.memory and sess.memory.strip():
        extra.append("【长期视觉记忆】\n" + sess.memory.strip())
    if not extra:
        return base
    return base + "\n\n" + "\n\n".join(extra)


def _build_session_messages(sess, user_text, reason="speech"):
    msgs = [{"role": "system", "content": [{"type": "text", "text": _session_system_prompt(sess)}]}]
    msgs += sess.messages[-MAX_SESSION_TEXT_TURNS:]
    content = []
    # 单帧打包：取最新一帧作当前画面（单帧识别准、省显存），历史靠时间线文本累积。
    latest = _latest_frame(sess)
    if latest is not None:
        content.append(_jpeg_image_content(latest))
    text = user_text or "（请结合画面简短描述当前场景）"
    env_ctx = _session_env_state(sess, reason)
    cap_ctx = _session_captions_context(sess)
    if env_ctx:
        text = env_ctx + "\n\n" + text
    if cap_ctx:
        text = cap_ctx + "\n\n" + text
    content.append({"type": "text", "text": text})
    msgs.append({"role": "user", "content": content})
    return msgs


def _latest_frame(sess):
    """会话缓冲最新一帧的 JPEG bytes（无帧返回 None）。"""
    if not sess.frames:
        return None
    return sess.frames[-1][1]


def _jpeg_image_content(jpeg_bytes):
    """JPEG bytes -> MiniCPM image content（OpenAI 兼容 data URL）。"""
    import base64 as _b64
    b64 = _b64.b64encode(jpeg_bytes).decode("ascii")
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}}


def _build_cloud_session_messages(sess, user_text, cc, reason="speech"):
    """摄像头会话 -> 云端消息（最新 1 帧 image_url + 视觉时间线文本）。"""
    msgs = [{"role": "system", "content": [{"type": "text", "text": _session_system_prompt(sess)}]}]
    msgs += sess.messages[-MAX_SESSION_TEXT_TURNS:]
    content = []
    latest = _latest_frame(sess)
    if latest is not None:
        content.append(_jpeg_image_content(latest))
    text = user_text or "（请结合画面简短描述当前场景）"
    env_ctx = _session_env_state(sess, reason)
    cap_ctx = _session_captions_context(sess)
    if env_ctx:
        text = env_ctx + "\n\n" + text
    if cap_ctx:
        text = cap_ctx + "\n\n" + text
    content.append({"type": "text", "text": text})
    msgs.append({"role": "user", "content": content})
    return msgs


def _stream_session_turn(sess, user_text, max_new_tokens, temperature, reason="speech"):
    """在调用线程执行一轮本地推理，yield 文本增量；结束后把轮次写回历史。"""
    parts = []
    try:
        for piece in perception.run_vision_stream(
            _build_session_messages(sess, user_text, reason), sess.cancel,
            max_new_tokens, temperature,
        ):
            if piece:
                parts.append(piece)
                yield piece
    finally:
        out = "".join(parts).strip()
        if user_text:
            sess.messages.append({"role": "user", "content": [{"type": "text", "text": user_text}]})
        if out:
            sess.messages.append({"role": "assistant", "content": [{"type": "text", "text": out}]})
        if len(sess.messages) > MAX_SESSION_TEXT_TURNS:
            del sess.messages[:len(sess.messages) - MAX_SESSION_TEXT_TURNS]
        sess.busy = False
        sess.envLastPacketAt = time.time()


async def _cloud_stream_session_turn(sess, user_text, max_new_tokens, temperature, cc, reason="speech"):
    """摄像头会话云端一轮：流式 yield 增量，结束后写回历史。"""
    parts = []
    try:
        messages = _build_cloud_session_messages(sess, user_text, cc, reason)
        async for piece in cloud._cloud_post(messages, cc, max_new_tokens, temperature, stream=True, cancel_ev=sess.cancel):
            if piece:
                parts.append(piece)
                yield piece
    except Exception as exc:
        yield "（视觉服务异常：%s）" % str(exc)[:200]
    finally:
        out = "".join(parts).strip()
        if user_text:
            sess.messages.append({"role": "user", "content": [{"type": "text", "text": user_text}]})
        if out:
            sess.messages.append({"role": "assistant", "content": [{"type": "text", "text": out}]})
        if len(sess.messages) > MAX_SESSION_TEXT_TURNS:
            del sess.messages[:len(sess.messages) - MAX_SESSION_TEXT_TURNS]
        sess.busy = False
        sess.envLastPacketAt = time.time()


async def _turn_stream(sess, text, max_new_tokens, temperature, reason="speech"):
    """后台线程跑一轮，事件循环里流式产出增量；消费者提前 break 可安全取消。"""
    q = asyncio.Queue()
    stop = _threading.Event()

    def _worker():
        try:
            for piece in _stream_session_turn(sess, text, max_new_tokens, temperature, reason):
                q.put_nowait(piece)
        except Exception as exc:
            q.put_nowait("（视觉服务异常：%s）" % str(exc)[:200])
        finally:
            q.put_nowait(None)

    t = _threading.Thread(target=_worker, daemon=True)
    t.start()
    while True:
        piece = await q.get()
        if piece is None:
            break
        yield piece
