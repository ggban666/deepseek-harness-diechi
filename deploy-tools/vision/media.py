# -*- coding: utf-8 -*-
"""媒体模块：视频解码、帧采样、关键帧选择、抽音轨（纯函数，无全局状态）。"""
import io
import json
import os
import subprocess as sp
import tempfile
import time
from pathlib import Path

import numpy as np

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


def _frames_to_cloud_images(frames, max_frames):
    """numpy RGB 帧 -> OpenAI 兼容 image_url 列表（均匀采样 + JPEG 压缩）。"""
    from PIL import Image
    total = int(len(frames))
    if total <= 0:
        return [], 0
    n = max(1, min(int(max_frames or 8), total))
    idxs = list(range(total)) if total <= n else [min(total - 1, int(round(i * (total - 1) / (n - 1)))) for i in range(n)]
    out = []
    for i in idxs:
        im = Image.fromarray(frames[i])
        im.thumbnail((768, 768))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=78)
        out.append({
            "type": "image_url",
            "image_url": {"url": "data:image/jpeg;base64," + base64_encode(buf.getvalue())},
        })
    return out, len(idxs)


def base64_encode(data):
    import base64
    return base64.b64encode(data).decode("ascii")


def _ffmpeg_bin():
    import shutil
    for cand in (shutil.which("ffmpeg"), r"D:\ffmpeg\bin\ffmpeg.exe"):
        if cand:
            return cand
    return "ffmpeg"


def extract_audio_wav(file_bytes, name):
    """ffmpeg 抽取音轨 -> 16k 单声道 wav bytes；无音轨返回 None。"""
    suffix = Path(name).suffix.lower() or ".mp4"
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(file_bytes)
            tmp = f.name
        proc = sp.run(
            [_ffmpeg_bin(), "-y", "-i", tmp, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
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


def _probe_video(tmp_path):
    """ffprobe 读取真实 fps/时长（cv2 对 webm/vp8 的 fps 常误读，必须校正）。失败返回 None。"""
    try:
        ff = _ffmpeg_bin()
        probe = ff.replace("ffmpeg.exe", "ffprobe.exe").replace("ffmpeg", "ffprobe")
        proc = sp.run(
            [probe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate,duration", "-of", "json", tmp_path],
            capture_output=True, timeout=30,
        )
        if proc.returncode != 0 or not proc.stdout:
            return None
        data = json.loads(proc.stdout)
        st = (data.get("streams") or [{}])[0]
        fps = None
        rfr = st.get("r_frame_rate") or ""
        if "/" in rfr:
            num, den = rfr.split("/")
            try:
                num, den = float(num), float(den or 1)
                fps = num / den if den > 0 else None
            except ValueError:
                fps = None
        dur = st.get("duration")
        return {
            "fps": fps if fps and fps > 1 else None,
            "duration": float(dur) if dur else None,
        }
    except Exception:
        return None


def decode_video(file_bytes: bytes, name: str):
    """cv2 两遍解码：grab() 精确计数 -> 按步长 retrieve() 采样（内存安全）。
    cv2 对 webm/vp8 的 fps 与帧数读取极不可靠（同文件多次读取结果不同），
    因此 fps 以 ffprobe 为准，帧数以 grab 实读为准；
    duration 始终与采样帧数/有效 fps 自洽，否则模型会按错误时长生成巨量 token 导致 OOM。"""
    import cv2
    suffix = Path(name).suffix.lower() or ".mp4"
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(file_bytes)
            tmp = f.name
        probe = _probe_video(tmp)
        cap = cv2.VideoCapture(tmp)
        if not cap.isOpened():
            raise ValueError("video decode failed")
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        max_frames = _adaptive_frame_cap(w, h)
        fps = probe["fps"] if probe and probe["fps"] else (cap.get(cv2.CAP_PROP_FPS) or 0)
        if not (1 <= fps <= 120):
            fps = 25.0  # 最常见的录制帧率兜底
        # 第一遍：只 grab 不解码，精确统计真实帧数
        count = 0
        while cap.grab():
            count += 1
        cap.release()
        if count == 0:
            raise ValueError("no frames decoded")
        if probe and probe["duration"] and probe["duration"] > 0:
            dur_est = probe["duration"]
        else:
            dur_est = count / fps
        if dur_est > MAX_UPLOAD_SECONDS:
            raise ValueError("video too long (>" + str(MAX_UPLOAD_SECONDS) + "s)")
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
            raise ValueError("no frames decoded")
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


def _sample_frames(items, max_frames):
    """从 (ts, jpeg) 列表均匀采样最多 max_frames 项，保持时间顺序。"""
    total = len(items)
    if total <= 0:
        return []
    if total <= max_frames:
        return list(items)
    idxs = [min(total - 1, int(round(i * (total - 1) / (max_frames - 1)))) for i in range(max_frames)]
    return [items[i] for i in idxs]


def _pick_key_frames(items, max_frames):
    """关键帧选择：先解码 48x36 灰度算相邻帧差，剔除几乎相同的重复帧，
    再均匀采样到 max_frames，保持时间顺序。解码失败时退回均匀采样。"""
    total = len(items)
    if total <= 0:
        return []
    try:
        from PIL import Image as _Img
        smalls = []
        for _t, b in items:
            im = _Img.open(io.BytesIO(b)).convert("RGB").resize((48, 36))
            smalls.append(np.asarray(im, dtype=np.float32))
        key_idx = [0]
        for i in range(1, total):
            prev = smalls[key_idx[-1]]
            diff = float(np.mean(np.abs(smalls[i] - prev)) / 255.0)
            if diff >= 0.03:
                key_idx.append(i)
        picked = [items[i] for i in key_idx]
    except Exception:
        picked = list(items)
    return _sample_frames(picked, max_frames)


_LOCAL_SESSION_MAX_VIDEO_FRAMES = 12   # 本地推理一次吃帧上限（原始分辨率 640x480，8G 显存安全）


def _frames_to_video_content(sess):
    """把会话帧缓冲包装成 MiniCPM video content：
    从最近 60 帧记忆里关键帧去重后采样最多 12 帧（原始分辨率，只统一尺寸 + 自洽 fps/duration）。"""
    if not sess.frames:
        return None
    from PIL import Image
    picked = _pick_key_frames(list(sess.frames), _LOCAL_SESSION_MAX_VIDEO_FRAMES)
    if not picked:
        return None
    imgs = [Image.open(io.BytesIO(b)).convert("RGB") for _, b in picked]
    w0, h0 = imgs[0].size
    imgs = [im if im.size == (w0, h0) else im.resize((w0, h0)) for im in imgs]
    frames = np.stack([np.asarray(im) for im in imgs])
    if len(picked) >= 2:
        ts = [t for t, _ in picked]
        dt = float(np.median(np.diff(ts)))
        fps = float(np.clip(1.0 / dt if dt > 0 else 1.0, 0.2, 4.0))
    else:
        fps = 1.0
    return {"type": "video", "video": (frames, fps, len(frames) / fps)}
