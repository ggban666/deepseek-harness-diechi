# -*- coding: utf-8 -*-
"""流式语义记忆模块（VLX-Flow 思想落地：双层记忆之「语义记忆」层）。

与 VisionSession 的分工（VLX-Flow 双层记忆映射）：
- 短期视觉缓存 = sess.captions / sess.frames（已有，秒级细节，滚动淘汰）
- 长期语义记忆 = 本模块（块记忆 + 问答对，磁盘持久化，跨会话存活）

块摘要调度（Cache-Aware Inference 的工程等价物）：
- 每 30s 空闲窗口把 captions 时间线压成一条「块记忆」（时间戳+一句话+关键实体），
  复用 recogBusy/infer_lock 节流，不与主推理抢 GPU；
- 用户提问时检索 top-k 记忆 + 最近帧 + 当前帧组装，token 预算恒定
  （不把整段历史塞给模型 = 延迟稳定、内存平滑，达到线性注意力的工程目的）。

检索后端：bge-small-zh-v1.5 向量（sentence-transformers，CPU ~100MB）优先；
不可用时自动降级 jieba 哈希词袋余弦（零依赖、确定性）。两路分数加权融合。
"""
import hashlib
import json
import os
import re
import threading
import time

import numpy as np

from . import config as cfg

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vision-memory")
_ENTRIES_PATH = os.path.join(_DATA_DIR, "entries.jsonl")
_VECS_PATH = os.path.join(_DATA_DIR, "vectors.npz")

_HASH_DIM = 512          # jieba 降级后端的哈希词袋维度
_MAX_ENTRIES = 2000      # 记忆条目上限（超出淘汰最旧；A1 单调性不适用此处，视觉记忆非固化库）
_TOP_K = 3               # 检索注入条数（恒定 token 预算）
_VEC_WEIGHT = 0.7        # 向量分权重（词频分 0.3）

_st_lock = threading.Lock()
_st_model = None
_st_failed = False


def _get_st_model():
    """惰性加载 bge-small-zh（CPU）。失败记住不再重试，回退词袋。"""
    global _st_model, _st_failed
    if _st_model is not None or _st_failed:
        return _st_model
    with _st_lock:
        if _st_model is not None or _st_failed:
            return _st_model
        try:
            os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
            from sentence_transformers import SentenceTransformer
            _st_model = SentenceTransformer("BAAI/bge-small-zh-v1.5", device="cpu")
            print("[memory] bge-small-zh loaded (cpu)", flush=True)
        except Exception as exc:
            print("[memory] vector backend unavailable, fallback jieba: %s" % str(exc)[:160], flush=True)
            _st_failed = True
        return _st_model


_STOP_TOKENS = set("的了是在和与就都而及着或一个有没有我们不你们我他她它们这那这个那个什么怎么为什么请帮我一下很非常还又再已经正在刚才刚刚现在").union(set("，。！？、；：""''（）"))

def _tokens(text):
    """jieba 分词 + 去停用词/单字。"""
    import jieba
    out = []
    for tk in jieba.cut_for_search(text or ""):
        tk = tk.strip()
        if len(tk) >= 2 and tk not in _STOP_TOKENS and not re.fullmatch(r"[\d\W]+", tk):
            out.append(tk)
    return out


def _hash_vec(text):
    """哈希词袋（512 维 L2 归一化）：降级后端的确定性嵌入。"""
    v = np.zeros(_HASH_DIM, dtype=np.float32)
    for tk in _tokens(text):
        idx = int(hashlib.md5(tk.encode("utf-8")).hexdigest(), 16) % _HASH_DIM
        v[idx] += 1.0
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


class MemoryStore:
    """长期语义记忆：条目 = {id, ts, kind, text, sid}，向量矩阵与条目对齐。"""

    def __init__(self):
        self.entries = []
        self.vecs = None          # np.ndarray [n, d] 或 None
        self._dirty = False
        self.load()

    # ---------- 持久化 ----------
    def load(self):
        try:
            if os.path.exists(_ENTRIES_PATH):
                with open(_ENTRIES_PATH, encoding="utf-8") as fh:
                    self.entries = [json.loads(line) for line in fh if line.strip()]
            if os.path.exists(_VECS_PATH):
                data = np.load(_VECS_PATH)
                if data["vectors"].shape[0] == len(self.entries):
                    self.vecs = data["vectors"]
        except Exception as exc:
            print("[memory] load failed: %s" % str(exc)[:160], flush=True)
            self.entries, self.vecs = [], None
        if len(self.entries) != (self.vecs.shape[0] if self.vecs is not None else 0):
            self.reindex()

    def save(self):
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_ENTRIES_PATH, "w", encoding="utf-8") as fh:
            for e in self.entries:
                fh.write(json.dumps(e, ensure_ascii=False) + "\n")
        if self.vecs is not None:
            np.savez(_VECS_PATH, vectors=self.vecs)
        self._dirty = False

    # ---------- 写入 ----------
    def add(self, text, kind="block", sid=""):
        text = (text or "").strip()
        if not text:
            return None
        now = time.time()
        entry = {"id": hashlib.md5(("%s|%s|%s" % (kind, sid, now)).encode()).hexdigest()[:10],
                 "ts": round(now, 1), "kind": kind, "sid": sid, "text": text[:300]}
        self.entries.append(entry)
        vec = self._embed_one(text)
        self.vecs = vec[None, :] if self.vecs is None else np.vstack([self.vecs, vec])
        self._dirty = True
        if len(self.entries) > _MAX_ENTRIES:
            drop = len(self.entries) - _MAX_ENTRIES
            self.entries = self.entries[drop:]
            self.vecs = self.vecs[drop:]
        return entry["id"]

    def reindex(self):
        """全量重建向量（后端切换/文件错位时）。"""
        if not self.entries:
            self.vecs = None
            return
        self.vecs = np.vstack([self._embed_one(e["text"]) for e in self.entries])
        self._dirty = True

    # ---------- 检索 ----------
    def _embed_one(self, text):
        m = _get_st_model()
        if m is not None:
            try:
                return np.asarray(m.encode([text], normalize_embeddings=True), dtype=np.float32)[0]
            except Exception:
                pass
        return _hash_vec(text)

    def search(self, query, k=_TOP_K):
        """向量分（0.7）+ 词频分（0.3）融合 top-k。返回 [(score, entry)]。"""
        if not self.entries or self.vecs is None or len(self.vecs) == 0:
            return []
        qv = self._embed_one(query)
        # 向量余弦
        v = self.vecs
        vn = np.linalg.norm(v, axis=1)
        vn[vn == 0] = 1.0
        qn = float(np.linalg.norm(qv)) or 1.0
        sim_v = (v @ qv) / (vn * qn)
        # 词频余弦（哈希词袋，维度与向量后端不同时单独算查询向量）
        qh = _hash_vec(query)
        dim = v.shape[1]
        if dim == _HASH_DIM:
            sim_t = (v @ qh)
        else:
            # 向量后端：词袋维度不匹配，用 jieba 重叠率兜底
            qtk = set(_tokens(query))
            sim_t = np.array([
                len(qtk & set(_tokens(e["text"]))) / max(1, len(qtk)) for e in self.entries
            ], dtype=np.float32) if qtk else np.zeros(len(self.entries), dtype=np.float32)
        score = _VEC_WEIGHT * sim_v + (1 - _VEC_WEIGHT) * np.asarray(sim_t, dtype=np.float32)
        idx = np.argsort(-score)[:k]
        return [(float(score[i]), self.entries[int(i)]) for i in idx if score[i] > 0.05]

    def context_block(self, query, k=_TOP_K):
        """检索结果 -> prompt 文本块（恒定预算：最多 k 条 × 300 字）。"""
        hits = self.search(query, k)
        if not hits:
            return ""
        lines = []
        for sc, e in hits:
            ago = int(time.time() - e["ts"])
            when = "刚才" if ago < 60 else ("%d分钟前" % (ago // 60)) if ago < 3600 else ("%d小时前" % (ago // 3600))
            lines.append("- [%s|%s] %s" % (when, "问答" if e["kind"] == "qa" else "观察", e["text"]))
        return "【相关长期记忆】（向量检索，按相关度）\n" + "\n".join(lines)


STORE = MemoryStore()


# ---------- 块摘要调度 ----------

BLOCK_INTERVAL = 30.0        # 空闲窗口 30s 压一次块记忆
BLOCK_MIN_CAPTIONS = 3       # 至少积累 3 条新 captions 才值得压


def block_digest_prompt(lines, span_sec):
    """captions 时间线 -> 块记忆压缩提示词（MiniCPM 空闲窗口跑，40 token 内）。"""
    return (
        "持续观察压缩任务：以下是最近 %d 秒的逐帧观察记录。"
        "把它们压缩成一条记忆，严格 60 字内，一句话概括发生了什么 + 保留关键实体"
        "（人/物/位置/数字/文字），不要评论不要展开，只输出这一条。\n\n观察记录：\n%s"
    ) % (int(span_sec), "\n".join("- %s" % ln for ln in lines))


def maybe_digest_block(sess, now=None):
    """空闲窗口把 sess.captions 新增量压成块记忆入库。
    返回 (digest_text|None, n_captions)。调用方负责拿 infer_lock、判 busy。"""
    now = now or time.time()
    since = getattr(sess, "lastBlockAt", 0.0)
    fresh = [t for ts, t in getattr(sess, "captions", []) if ts > (since or 0)]
    if len(fresh) < BLOCK_MIN_CAPTIONS or (now - (since or sess.created)) < BLOCK_INTERVAL:
        return None, len(fresh)
    span = now - (since or sess.created)
    digest = None
    try:
        from . import perception
        digest = perception.run_vision_text(block_digest_prompt(fresh, span), max_new_tokens=80)
    except Exception as exc:
        print("[memory] digest failed: %s" % str(exc)[:160], flush=True)
    sess.lastBlockAt = now
    if digest and digest.strip():
        tag = time.strftime("%H:%M", time.localtime(now - span))
        STORE.add("[%s-%s] %s" % (tag, time.strftime("%H:%M", time.localtime(now)), digest.strip()[:200]),
                  kind="block", sid=sess.sid)
        try:
            STORE.save()  # 块记忆落盘（问答对随下次块摘要一起存）
        except Exception:
            pass
        return digest.strip(), len(fresh)
    return None, len(fresh)
