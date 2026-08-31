#!/usr/bin/env python3
"""M4 进化引擎 —— llama.cpp + Qwen3.8-27B-UD-IQ1_S + GBNF 约束解码。

这是三架构里"升级设计者"的弱模型引擎（S5 弱模型放大实验的正式载体）。

定位与铁律：
  1. **只做提议器，不做验证器。** 引擎负责"读聚类摘要 -> 产出 patch-skill 等提议"。
     提议好坏由 golden set（CBS）回归 + 人工 review 双门裁决，引擎自己永远不能判自己。
  2. **GPU 推理，空闲调度。** RTX 4070 上 -ngl 99 全层 offload（视觉服务占 2.1GB 后仍够用）。
     不进主对话延迟路径，调用方（host 定时器 / RPC）在空闲窗口才调 propose()。
  3. **GBNF 保格式，任务收窄保内容。** 1bit 量化崩内容不崩格式；GBNF 把"格式必须合法"
     从模型能力里拿走，解码器保证 JSON 结构，模型只剩"填什么"这一件事。
  4. **只能提议建设性动作。** grammar.gbnf 的 kind 白名单里没有 add-rule——弱模型就算
     发疯也吐不出"冻结"提议，从语法层堵死「崩溃越多->冻结越多->系统越瘫」的老死结。

用法（engine 常驻）：
    python engine.py --model <path.gguf> --port 8081 --grammar grammar.gbnf
    # 另一线程 / 调用方：
    python engine.py propose --port 8081 --summary "<聚类摘要>" --max 3
"""

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import http.server

_LLAMA_SERVER = None
_SERVER_PROC = None

# GBNF 里允许的 kind 白名单（与 grammar.gbnf 严格一致，双保险校验）。
_ALLOWED_KINDS = {"patch-skill", "add-skill", "add-case", "add-prompt"}


def _log(msg):
    print("[evolve-engine] %s" % msg, flush=True)


def _project_root():
    """engine.py 位于 蝶翅-app/deploy-tools/evolve/，项目根目录为其上三级。"""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def find_llama_server():
    """定位 llama-server.exe。

    注意：models/llama.cpp/ 虽有 ggml-cuda.dll，但**缺 cuBLAS 运行时
    (cublas64_12/cublasLt64_12/cudart64_12.dll)**，CUDA 后端会静默回退到
    CPU，导致 -ngl 99 失效、CPU 被吃满。真正的 CUDA 版在 llama.cpp-cuda/
    （含全部 cuBLAS DLL）。故此处**优先用 cuda 目录**。
    CPU 兜底版在 llama.cpp-cpu-bak/。
    """
    root = _project_root()
    candidates = [
        os.environ.get("LLAMA_SERVER"),
        os.path.join(root, "models", "llama.cpp-cuda", "llama-server.exe"),
        os.path.join(root, "models", "llama.cpp", "llama-server.exe"),
        os.path.join(root, "models", "llama.cpp-cpu-bak", "llama-server.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise RuntimeError("llama-server.exe 未找到，请设置 LLAMA_SERVER 环境变量")


def start_engine(model_path, port=8081, ctx=32768, grammar=None, ngl=0):
    """后台拉起 llama-server。返回 Popen。ngl=99 全层 GPU，0=纯 CPU 兜底。"""
    global _SERVER_PROC, _LLAMA_SERVER
    if _SERVER_PROC is not None and _SERVER_PROC.poll() is None:
        return _SERVER_PROC
    exe = find_llama_server()
    cmd = [exe, "--model", model_path, "--port", str(port), "--host", "127.0.0.1",
           "--ctx-size", str(ctx), "--seed", "42", "--temp", "0.2", "-ngl", str(ngl),
           "--parallel", "1", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0"]
    if grammar:
        # grammar 是相对路径时转绝对，避免受 cwd 影响
        if not os.path.isabs(grammar):
            grammar = os.path.join(os.path.dirname(__file__), grammar)
        # 中文路径坑：llama.cpp 在 Windows 下用 std::ifstream 读 grammar，
        # 中文目录会报 failed to open file。复制到 ASCII 临时目录再传。
        if any(ord(c) > 127 for c in grammar):
            ascii_dir = os.path.join(os.environ.get("TEMP", os.path.join(os.path.dirname(__file__), "_tmp_grammar")), "evolve-grammar")
            os.makedirs(ascii_dir, exist_ok=True)
            ascii_g = os.path.join(ascii_dir, os.path.basename(grammar))
            import shutil
            try:
                shutil.copy2(grammar, ascii_g)
                _log("grammar 含中文路径，复制到 ASCII 目录: %s" % ascii_g)
                grammar = ascii_g
            except Exception as e:
                _log("grammar 复制到 ASCII 目录失败(%s)，按原路径尝试" % e)
        cmd += ["--grammar-file", grammar]
    logf = open(os.path.join(os.path.dirname(__file__), "llama-server.log"), "ab")
    _log("启动 llama-server: %s" % " ".join(cmd))
    # 必须设置 cwd 为 exe 所在目录：CUDA 版依赖同目录的 ggml-cuda.dll 等，
    # Windows 按当前目录搜索 DLL，cwd 不对会报 STATUS_ENTRYPOINT_NOT_FOUND 退出。
    _SERVER_PROC = subprocess.Popen(cmd, cwd=os.path.dirname(exe), stdout=logf, stderr=subprocess.STDOUT)
    _LLAMA_SERVER = port
    # 等待就绪
    for _ in range(120):
        if _SERVER_PROC.poll() is not None:
            raise RuntimeError("llama-server 启动失败，退出码 %s" % _SERVER_PROC.returncode)
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=2) as r:
                if r.status == 200:
                    return _SERVER_PROC
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("llama-server %d 秒内未就绪" % 60)


def stop_engine():
    global _SERVER_PROC
    if _SERVER_PROC is not None and _SERVER_PROC.poll() is None:
        _SERVER_PROC.terminate()
        try:
            _SERVER_PROC.wait(timeout=10)
        except Exception:
            _SERVER_PROC.kill()
    _SERVER_PROC = None


def _completion(prompt, port, max_tokens=600, temperature=0.2, grammar=None,
                model=None):
    # 与聊天同一个端点（/v1/chat/completions），证明「一个 API 两用」：
    # 聊天不带 grammar → 自然语言；提议带 grammar + 关 thinking → JSON。
    if model is None:
        model = os.environ.get("EVOLVE_ENGINE_MODEL", "Qwen3.8-27B-UD-IQ1_S")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是蝶翅系统的「升级设计者」，负责把失败聚类摘要转成结构化改进提议。严格按用户指令输出，不要额外解释。"},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
        # 关掉 Qwen 的 <think> 推理标签：GBNF 不允许 <think>，弱模型在约束下会退化成空白。
        "chat_template_kwargs": {"enable_thinking": False},
    }
    # grammar 按请求内联，不锁启动级。
    if grammar:
        body["grammar"] = grammar
    body = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:%d/v1/chat/completions" % port,
        data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.loads(r.read().decode("utf-8"))
    return (out.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()


def _validate_proposals(raw):
    """对引擎输出做 schema 校验。坏提议丢弃，绝不带病入库。"""
    if isinstance(raw, str):
        # 容忍 GBNF 可能夹带的前导/尾随文本，取第一个 '[' 到最后一个 ']'
        i, j = raw.find("["), raw.rfind("]")
        if i < 0 or j < i:
            return []
        raw = raw[i:j + 1]
    try:
        items = json.loads(raw)
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    ok = []
    for it in items:
        if not isinstance(it, dict):
            continue
        kind = it.get("kind")
        if kind not in _ALLOWED_KINDS:
            continue
        target = str(it.get("target") or "").strip()
        pid = str(it.get("id") or "").strip()
        details = str(it.get("details") or "").strip()
        rationale = str(it.get("rationale") or "").strip()
        if not (target and pid and details):
            continue
        ok.append({
            "kind": kind,
            "target": target,
            "id": pid,
            "details": details,
            "rationale": rationale or "（引擎未给出理由）",
        })
    return ok


def propose(port, cluster_summary, max_items=3, grammar_path=None):
    """核心：喂聚类摘要，产出建议性提议。失败返回 []。

    grammar_path：GBNF 文件路径。若给出，则在本次请求体里内联 grammar
    （不再依赖启动级 --grammar-file），让 8081 可以同时当聊天模型用。
    """
    sys_prompt = (
        "你是蝶翅系统的「升级设计者」。读下面的失败场景聚类摘要，"
        "针对每一类提出如何改进现有技能/知识/提示，让同类任务下次一次通过。\n"
        "要求：\n"
        "1. 只输出 JSON 数组，不要任何解释性文字；\n"
        "2. kind 只能是 patch-skill / add-skill / add-case / add-prompt；\n"
        "3. details 写清楚具体改什么（补进技能哪一节、加什么步骤）；\n"
        "4. 最多 %d 条；宁缺毋滥，没有把握就不提。\n\n"
        "聚类摘要：\n%s" % (max_items, cluster_summary))
    # 内联读取 grammar（字符串直接进请求体，彻底绕开中文路径的 std::ifstream 坑）。
    grammar = None
    if grammar_path:
        try:
            with open(grammar_path, "r", encoding="utf-8") as f:
                grammar = f.read()
        except Exception as e:
            _log("读取 grammar 失败(%s)，本次不约束格式" % e)
    raw = _completion(sys_prompt, port, max_tokens=600, grammar=grammar)
    _log("引擎原始输出: %s" % raw[:200])
    return _validate_proposals(raw)


# ---------- 懒加载模式（serve-lazy）：首次请求才加载，空闲自动卸载释放显存 ----------
class _LazyManager:
    """在外部端口(如 8081)做反向代理；子 llama-server 跑在内部端口(如 18081)。
    无请求时空闲 idle_sec 后杀掉子进程 -> 释放 ~7.6G 显存，视觉服务(8080)可同开。
    首次请求/空闲后再次请求时按需拉起。"""

    def __init__(self, model_path, internal_port, ctx, ngl, idle_sec):
        self.model_path = model_path
        self.internal_port = internal_port
        self.ctx = ctx
        self.ngl = ngl
        self.idle_sec = idle_sec
        self.proc = None
        self.lock = threading.Lock()
        self.last = time.time()
        self._stop = False
        threading.Thread(target=self._idle_loop, daemon=True).start()

    def ensure_ready(self):
        with self.lock:
            if self.proc is None or self.proc.poll() is not None:
                _log("懒加载：拉起 llama-server（首次请求 / 空闲后再次请求）")
                self.proc = _spawn_llama(self.model_path, self.internal_port, self.ctx, self.ngl)
                if not _wait_health(self.internal_port):
                    raise RuntimeError("llama-server 启动失败（详见 llama-server-lazy.log）")
        self.last = time.time()

    def touch(self):
        self.last = time.time()

    def _idle_loop(self):
        while not self._stop:
            time.sleep(10)
            with self.lock:
                if (self.proc is not None and self.proc.poll() is None
                        and (time.time() - self.last) > self.idle_sec):
                    _log("空闲 %ds，卸载 llama-server 释放显存" % self.idle_sec)
                    try:
                        self.proc.terminate()
                    except Exception:
                        pass
                    self.proc = None

    def shutdown(self):
        self._stop = True
        if self.proc is not None:
            try:
                self.proc.terminate()
            except Exception:
                pass


def _spawn_llama(model_path, port, ctx, ngl):
    exe = find_llama_server()
    # parallel=1：把 ctx 全部留给单会话（避免被多 slot 分摊成 2048/个）；
    # cache-type q8_0：KV cache 量化，8GB 显存下 ctx 提到 32768 不 OOM。
    cmd = [exe, "--model", model_path, "--port", str(port), "--host", "127.0.0.1",
           "--ctx-size", str(ctx), "--seed", "42", "--temp", "0.2", "-ngl", str(ngl),
           "--parallel", "1", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0"]
    logf = open(os.path.join(os.path.dirname(__file__), "llama-server-lazy.log"), "ab")
    # 与 start_engine 一致：cwd 必须设为 exe 所在目录，否则 CUDA 版找不到
    # 同目录的 ggml-cuda.dll，Windows 会按当前目录搜索 DLL 而报
    # STATUS_ENTRYPOINT_NOT_FOUND 直接退出（这是懒加载模式曾经静默失败的根因）。
    return subprocess.Popen(cmd, cwd=os.path.dirname(exe), stdout=logf, stderr=subprocess.STDOUT)


def _wait_health(port, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=2)
            return True
        except Exception:
            time.sleep(1)
    return False


class _ProxyHandler(http.server.BaseHTTPRequestHandler):
    # 由 serve_lazy 在 server 实例上挂 manager；handler 通过 self.server.manager 读取。
    def _forward(self):
        # /health 只报代理存活，不因此触发模型加载（避免健康检查把显存占住）
        if self.path.rstrip("/") == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"proxy-ok"}')
            return
        mgr = self.server.manager
        try:
            mgr.ensure_ready()
        except Exception as e:
            self.send_response(503)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(("engine not ready: %s" % e).encode("utf-8"))
            return
        mgr.touch()
        target = "http://127.0.0.1:%d%s" % (mgr.internal_port, self.path)
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "connection", "content-length",
                                         "transfer-encoding", "accept-encoding")}
        cl = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(cl) if cl > 0 else None
        req = urllib.request.Request(target, data=body, headers=headers, method=self.command)
        try:
            resp = urllib.request.urlopen(req, timeout=600)
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in ("transfer-encoding", "connection", "content-length"):
                    continue
                self.send_header(k, v)
            self.end_headers()
            shutil.copyfileobj(resp, self.wfile)  # 流式转发（兼容 SSE / 普通 JSON）
        except Exception as e:
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(("proxy error: %s" % e).encode("utf-8"))
            except Exception:
                pass

    def do_GET(self):
        self._forward()

    def do_POST(self):
        self._forward()

    def log_message(self, *args):
        pass


def serve_lazy(model_path, port, internal_port, ctx, ngl, idle_sec):
    mgr = _LazyManager(model_path, internal_port, ctx, ngl, idle_sec)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), _ProxyHandler)
    srv.manager = mgr
    _log("懒加载代理就绪：外部 :%d -> 内部 :%d（空闲 %ds 自动卸载，释放显存；首次请求才加载）"
         % (port, internal_port, idle_sec))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mgr.shutdown()


def _main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["serve", "serve-lazy", "propose"])
    ap.add_argument("--model", default=os.environ.get("EVOLVE_MODEL"))
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--internal-port", type=int, default=18081,
                    help="serve-lazy 模式：子 llama-server 跑在的内部端口（外部端口做代理）。")
    ap.add_argument("--idle-sec", type=int, default=600,
                    help="serve-lazy 模式：空闲多少秒后自动卸载模型释放显存。")
    ap.add_argument("--grammar", default=os.path.join(os.path.dirname(__file__), "grammar.gbnf"))
    ap.add_argument("--ctx", type=int, default=32768)
    ap.add_argument("--ngl", type=int, default=99, help="GPU 层数，99=全部 offload 到 RTX 4070（默认）；0=纯 CPU 兜底。")
    ap.add_argument("--summary", default="")
    ap.add_argument("--max", type=int, default=3)
    args = ap.parse_args()

    if args.mode == "serve":
        if not args.model:
            print("serve 模式需要 --model", file=sys.stderr)
            sys.exit(2)
        # 启动【不带】--grammar-file：8081 平时是裸奔聊天模型（蝶翅可聊天）。
        # grammar 改由 propose 模式按请求内联，进化引擎依旧只吐 JSON。
        start_engine(args.model, args.port, args.ctx, grammar=None, ngl=args.ngl)
        _log("引擎就绪（无 grammar 锁，可兼作聊天模型），端口 %d。Ctrl+C 退出。" % args.port)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            stop_engine()
    elif args.mode == "serve-lazy":
        if not args.model:
            print("serve-lazy 模式需要 --model", file=sys.stderr)
            sys.exit(2)
        # 懒加载代理：外部端口(8081)常驻但只占 ~30MB；子 llama-server 在内部端口，
        # 首次请求才拉起、-ngl 99 上 GPU；空闲 idle-sec 后卸载，释放 ~7.6G 显存，
        # 视觉服务(8080)可同时跑。聊天/进化提议都走同一个外部端点。
        serve_lazy(args.model, args.port, args.internal_port, args.ctx, args.ngl, args.idle_sec)
    else:
        if not args.summary:
            print("propose 模式需要 --summary", file=sys.stderr)
            sys.exit(2)
        out = propose(args.port, args.summary, args.max, grammar_path=args.grammar)
        print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _main()
