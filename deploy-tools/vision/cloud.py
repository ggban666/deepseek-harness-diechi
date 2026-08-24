# -*- coding: utf-8 -*-
"""云端视觉模块：OpenAI 兼容 API 客户端（SSE 流式 + 打断）。"""
import json
from .config import _cloud_config


def _cloud_http():
    """优先 httpx，回退 requests。"""
    try:
        import httpx
        return httpx, "httpx"
    except Exception:
        import requests
        return requests, "requests"


async def _cloud_post(messages, cfg, max_new_tokens, temperature, stream=True, cancel_ev=None):
    """调云端 OpenAI 兼容接口；stream=True 时按 SSE 增量 yield 文本。
    cancel_ev 为打断事件：置位后立即中止当前流并释放连接。"""
    http, kind = _cloud_http()
    headers = {
        "Authorization": "Bearer %s" % cfg["apiKey"],
        "Content-Type": "application/json",
    }
    base = (cfg["baseURL"] or "").rstrip("/")
    url = base + "/chat/completions" if base.endswith("/v1") else base + "/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": messages,
        "max_tokens": int(max_new_tokens or 256),
        "temperature": float(temperature or 0.2),
        "stream": bool(stream),
    }
    timeout = float(cfg.get("timeoutSec") or 90)
    if kind == "httpx":
        async with http.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code >= 400:
                    raw = (await resp.aread()).decode("utf-8", "ignore")[:300]
                    raise RuntimeError("cloud vision HTTP %s: %s" % (resp.status_code, raw))
                if not stream:
                    body = json.loads((await resp.aread()).decode("utf-8", "ignore"))
                    yield (body.get("choices") or [{}])[0].get("message", {}).get("content") or ""
                    return
                async for line in resp.aiter_lines():
                    if cancel_ev is not None and cancel_ev.is_set():
                        await resp.aclose()
                        return
                    if not line.startswith("data: "):
                        continue
                    ev = line[6:].strip()
                    if ev == "[DONE]":
                        break
                    try:
                        chunk = json.loads(ev)
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content")
                        if delta:
                            yield delta
                    except Exception:
                        continue
    else:
        resp = http.post(url, headers=headers, json=payload, timeout=timeout, stream=True)
        if resp.status_code >= 400:
            raise RuntimeError("cloud vision HTTP %s: %s" % (resp.status_code, (resp.text or "")[:300]))
        if not stream:
            body = resp.json()
            yield (body.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            return
        for line in resp.iter_lines(decode_unicode=True):
            if cancel_ev is not None and cancel_ev.is_set():
                resp.close()
                return
            if not line or not line.startswith("data: "):
                continue
            ev = line[6:].strip()
            if ev == "[DONE]":
                break
            try:
                chunk = json.loads(ev)
                delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield delta
            except Exception:
                continue
