#!/usr/bin/env python3
"""M5b 眼镜帧源桥 —— ESP32 CameraWebServer 拉流 -> 8080 视觉会话 observe。

蝶翅「AI 眼镜」阶段一（OpenGlass DIY）：ESP32-S3 跑 CameraWebServer 固件，
通过 MJPEG 流把镜头画面推到本地 PC，本桥逐帧转 base64 喂给
`POST /api/v1/vision/session/{sid}/observe`（只入缓冲不推理），
用户说话时模型依据连续帧记忆回答——**眼镜本质只是换一个帧源**。

用法：
    python esp32_bridge.py                      # 默认连 192.168.4.1:81（ESP32 AP 模式默认地址）
    python esp32_bridge.py --esp32 192.168.1.50 # 指定 ESP32 IP（CameraWebServer 默认端口 81）
    python esp32_bridge.py --sim demo.jpg       # 无 ESP32 时用本地图片模拟帧源（循环发同一帧）

依赖：requests（vllm-env 通常已有）。纯 CPU、只占极低资源。
"""

import argparse
import base64
import io
import json
import sys
import threading
import time
import urllib.request

import requests  # noqa: F401  # 明确声明，便于排查

VISION_URL = "http://127.0.0.1:8080"
OBSERVE_INTERVAL = 2.0      # 默认每 2 秒推一帧（配合 8080 识别节流 3 秒）
CAPTURE_INTERVAL = 0.5      # MJPEG 拉流时的读取间隔（秒）
MJPEG_BOUNDARY = b"--frame"  # CameraWebServer /stream 的分隔边界


def _get_session():
    """创建/获取 8080 会话（POST），返回 session_id。"""
    req = urllib.request.Request(VISION_URL + "/api/v1/vision/session",
                                 data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode("utf-8"))["session_id"]


def _observe(sid, jpeg, diff=-1.0):
    """把一帧 jpeg 喂给 observe 端点。"""
    data_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
    body = json.dumps({"frame": data_url, "diff": diff}).encode("utf-8")
    req = urllib.request.Request(
        VISION_URL + "/api/v1/vision/session/%s/observe" % sid,
        data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as exc:
        print("[bridge] observe 失败: %s" % exc, flush=True)
        return None


def _mjpeg_frames(url):
    """从 CameraWebServer MJPEG 流逐帧 yield jpeg 字节。"""
    stream = urllib.request.urlopen(url, timeout=10)
    data = b""
    while True:
        chunk = stream.read(4096)
        if not chunk:
            break
        data += chunk
        # 按 boundary 切帧：每段以 \r\n--frame 开头，到下一个 --frame 结束
        while True:
            start = data.find(MJPEG_BOUNDARY)
            if start < 0:
                break
            # 找帧头 Content-Length 后的空行，定位 jpeg 起始
            header_end = data.find(b"\r\n\r\n", start)
            if header_end < 0:
                break
            next_frame = data.find(MJPEG_BOUNDARY, header_end + 4)
            if next_frame < 0:
                break  # 等下一块数据
            jpeg = data[header_end + 4:next_frame]
            if jpeg.startswith(b"\xff\xd8"):  # JPEG 魔数
                yield jpeg
            data = data[next_frame:]


def _sim_frames(image_path):
    """模拟帧源：读一张图片反复发（用于无 ESP32 时端到端验证桥与 observe 链路）。"""
    with open(image_path, "rb") as f:
        jpeg = f.read()
    while True:
        yield jpeg
        time.sleep(OBSERVE_INTERVAL)


def run(esp32_ip, sim=None, interval=OBSERVE_INTERVAL):
    sid = _get_session()
    print("[bridge] 会话 %s 就绪，开始推帧" % sid, flush=True)

    if sim:
        frames = _sim_frames(sim)
        print("[bridge] 模拟帧源: %s" % sim, flush=True)
    else:
        url = "http://%s:81/stream" % esp32_ip
        print("[bridge] 拉流: %s" % url, flush=True)
        frames = _mjpeg_frames(url)

    last = 0.0
    sent = 0
    for jpeg in frames:
        now = time.time()
        if now - last < interval:
            continue
        last = now
        resp = _observe(sid, jpeg)
        sent += 1
        if sent % 20 == 0:
            print("[bridge] 已推 %d 帧 (frames in session: %s)" % (
                sent, (resp or {}).get("frames", "?")), flush=True)


def _main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--esp32", default="192.168.4.1", help="ESP32 IP（CameraWebServer 默认 :81）")
    ap.add_argument("--sim", default=None, help="用本地图片模拟帧源（无 ESP32 调试用）")
    ap.add_argument("--interval", type=float, default=OBSERVE_INTERVAL, help="推帧间隔秒")
    args = ap.parse_args()
    try:
        run(args.esp32, args.sim, args.interval)
    except KeyboardInterrupt:
        print("\n[bridge] 停止", flush=True)


if __name__ == "__main__":
    _main()
