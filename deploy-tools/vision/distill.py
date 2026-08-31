# -*- coding: utf-8 -*-
"""视频蒸馏模块：cangjie-skill v2.5（MIT, github.com/kangarooking/cangjie-skill）
提取框架的本地化移植 —— 把视频的「老师傅详述 + 带时间戳语音转写」蒸馏成
diechi 技能包草稿（frontmatter md），落 diechi-home/distill-inbox/ 供人工 review。

流水线（RIA-TV++ 单机适配版，extractor 提示词搬自 vendor/cangjie-skill/extractors/）：
  D1 并行提取：4 路 extractor（原则/框架/反例/案例）各自产出 YAML 候选单元
  D2 编译：候选单元 + 详述 -> 1..N 个 skill 文件（R/I/A1/A2/E/B 骨架）
  D3 落盘：distill-inbox/<slug>.md + <slug>.extractors.yaml 审计附件

边界：不做书摘/读后感；LLM 只做提取与编译，结构与落盘由代码保证。
本地模型（MiniCPM）与云端通道均可作蒸馏 LLM，由调用方注入 llm(prompt) 函数。
"""
import hashlib
import os
import re
import time

from . import config as cfg

# ---------------- 阶段 1 提示词（与 /api/v1/video/describe 的 stage1 完全一致，勿改动） ----------------

def overview_prompt(n_frames, duration, seg_text):
    return (
        "你是老师傅，正在把这段实操视频讲给徒弟听。画面是按时间顺序均匀采样的关键帧（共 %d 帧，视频实际时长约 %s 秒），语音讲解带时间戳。"
        "请按时间顺序把整个操作讲清楚："
        "1. 开头用一句话说明这次操作的目的是什么、最终要做成什么结果；"
        "2. 按步骤讲清每个动作：用什么工具/材料、怎么操作、先后顺序、画面里能看见的关键细节；"
        "3. 结合语音讲解讲出每步的目的与要点，像现场教学一样自然，不要机械罗列；"
        "4. 哪里容易出错、视频里有没有做错的示范，单独指出并说明正确做法；"
        "5. 结尾用一句话说明怎么判断操作成功（结果标准）。"
        "用「第1步/第2步…」组织，具体、可执行，禁止空泛概括。"
        "\n\n语音分段转写（时间戳）：\n%s"
    ) % (n_frames, str(round(duration or 0, 1)), seg_text or "（本视频无有效语音）")


# ---------------- D1 提取器（搬自 cangjie-skill extractors/，适配视频转写输入） ----------------

_EXTRACTORS = {
    "principle": (
        "原则/清单/规则提取器",
        "原则（应该如何/不应该如何的断言）、清单（结构化的检查项）、"
        "规则（可直接套用的判断规则，如「永远不要…当…」「只有在…时才…」）、箴言（反复强调、有行动指导意义的短句）",
        "「必须…」「不要…」「要记住…」「每当…就要…」「只有…才能…」、编号列表、重复出现的同一断言",
    ),
    "framework": (
        "思维模型/决策框架提取器",
        "思维模型（可迁移的思考结构）、决策框架（面对某类问题的结构化流程）、推理方法（从已知推向未知的路径）、操作流程（多步骤工作流）",
        "某个思考方式被起了专门的名字、讲「面对 X 类问题应该…」的通用流程、反复引用同一个思考结构、if-then/先后/从到句式",
    ),
    "counter_example": (
        "反例/陷阱提取器",
        "明确警告的失败模式（「不要 X，否则…」）、批评的错误做法（「很多人以为 X，但其实…」）、演示中出现的错误与纠正、认知陷阱",
        "「最大的错误是…」「千万不要…」「很多人以为…」「失败的原因是…」「陷阱在于…」+ 负面评价",
    ),
    "case": (
        "案例提取器",
        "讲者/演示者亲自完成的完整案例：问题背景、用了什么方法、怎么做的、结果如何；含操作前后对比",
        "「举个例子」「比如上次…」「我曾经…」、完整演示一个问题的解决过程",
    ),
}


def _extractor_prompt(kind, material):
    name, scope, signals = _EXTRACTORS[kind]
    return (
        "你是 cangjie-skill 流水线中并行运行的 extractor 之一：%s。"
        "输入是一段教学视频的「过程详述 + 时间戳语音转写」。\n"
        "你的职责范围（只找这些）：%s。\n"
        "识别信号（看到这些就要警觉）：%s。\n"
        "要求：\n"
        "1. 逐条提取，宁可多提取，不要遗漏；视频里没有的内容不要编造。\n"
        "2. 每条输出一个 YAML 条目，字段：id（%s01 递增）/ title（一句话）/ type（%s）/ "
        "source_timecode（来自时间戳，如 [03:12-03:45]，无时间戳填 unknown）/ "
        "source_quote（视频原话或画面描述摘录）/ summary（这条知识的要点与适用场景，2-4 句）。"
        "3. 只输出 YAML 条目，不要任何解释、不要代码块标记。\n\n"
        "【视频材料】\n%s"
    ) % (name, scope, signals, kind[:2], kind, material)


# ---------------- D2 编译器 ----------------

_COMPILE_PROMPT = (
    "你是 cangjie-skill（RIA-TV++）的编译器。输入：一段教学视频的「过程详述+时间戳语音转写」，"
    "以及 4 路提取器产出的候选知识单元（YAML）。\n"
    "任务：把候选单元汇编成 1..N 个可执行技能文件。规则：\n"
    "1. 属于同一条工作流的多个单元合并成一个技能；彼此独立的方法论各自成技能；最多 %d 个，宁缺毋滥。\n"
    "2. 每个技能文件的格式（严格遵守，头部 frontmatter 用 --- 包裹）：\n"
    "---\n"
    "name: <ascii-slug，小写字母数字连字符>\n"
    "title: <技能中文名>\n"
    "description: <何时调用+何时不调用，≤200字>\n"
    "when-to-use: <典型触发场景短语，逗号分隔>\n"
    "kind: text\n"
    "version: 0.1.0\n"
    "tags: <逗号分隔>\n"
    "---\n"
    "## R — 原文出处\n> <视频时间戳 + 原话/画面摘录>\n"
    "## I — 方法论骨架\n<用自己的话重写，5-15 行，禁止空话>\n"
    "## A1 — 视频中的应用\n<视频里怎么演示/使用的，含结果>\n"
    "## A2 — 触发场景\n<用户什么情境需要 + 语言信号（用户会说的典型措辞）>\n"
    "## E — 可执行步骤\n<分步，每步带「完成标准」与「判停条件」>\n"
    "## B — 边界\n<不要在什么情况用 + 失败模式/易错点>\n"
    "3. 多个技能之间用一行 =====SKILL===== 分隔。只输出技能文件内容，不要任何解释。\n\n"
    "【视频材料】\n%s\n\n【提取器候选单元】\n%s"
)


# ---------------- 材料合并与解析 ----------------

def merge_material(process, seg_text, max_chars=9000):
    """阶段1详述 + 时间戳转写 → 蒸馏输入材料（超长截中段保头尾）。"""
    parts = ["【过程详述】", (process or "").strip()]
    if seg_text:
        parts += ["", "【语音分段转写（时间戳）】", seg_text.strip()]
    text = "\n".join(parts)
    if len(text) > max_chars:
        head = text[: int(max_chars * 0.6)]
        tail = text[-int(max_chars * 0.3):]
        text = head + "\n……（中段过长，已截断以适配本地模型上下文）……\n" + tail
    return text


def _parse_frontmatter(block):
    """宽容版 frontmatter 解析（不依赖 pyyaml）：返回 (meta dict, body str)。"""
    m = re.match(r"\s*---\s*\n(.*?)\n---\s*\n?", block, re.S)
    if not m:
        return None, block
    meta = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = v.strip().strip('"').strip("'")
        if v:
            meta[k.strip()] = v
    return meta, block[m.end():]


def _slugify(name, fallback_seed):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    if len(s) < 2:
        s = "distill-" + hashlib.md5(fallback_seed.encode("utf-8")).hexdigest()[:6]
    return s[:48]


# ---------------- 落盘 ----------------

def inbox_dir():
    d = os.environ.get("DIECHI_DISTILL_INBOX", "").strip()
    if not d:
        # _DEPLOY_DIR = deploy-tools/，diechi-home 在其上一级（蝶翅-app/）
        d = os.path.normpath(os.path.join(cfg._DEPLOY_DIR, "..", "diechi-home", "distill-inbox"))
    os.makedirs(d, exist_ok=True)
    return d


def _write_unique(path, content):
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(path):
        path = "%s-%d%s" % (base, n, ext)
        n += 1
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    return path


def save_drafts(compiled_md, units, source_video):
    """解析编译产物 → 写 distill-inbox。返回 skill 信息列表。"""
    ts = time.strftime("%Y-%m-%d %H:%M")
    out = []
    blocks = [b for b in re.split(r"^\s*=====SKILL=====\s*$", compiled_md or "", flags=re.M) if b.strip()]
    for block in blocks:
        meta, body = _parse_frontmatter(block)
        if meta is None:
            continue
        name = _slugify(meta.get("name"), (meta.get("title") or "") + source_video + ts)
        meta["name"] = name
        meta.setdefault("title", name)
        meta.setdefault("description", "")
        meta.setdefault("when-to-use", "")
        meta["kind"] = "text"
        meta.setdefault("version", "0.1.0")
        meta.setdefault("tags", "蒸馏, 视频")
        meta["source-video"] = os.path.basename(source_video or "")
        meta["distiller"] = "cangjie-skill-v2.5-port"
        meta["distilled-at"] = ts
        fm = "\n".join("%s: %s" % (k, v) for k, v in meta.items())
        md = "---\n%s\n---\n%s" % (fm, body.strip() + "\n")
        path = _write_unique(os.path.join(inbox_dir(), name + ".md"), md)
        audit = ["# cangjie 蒸馏审计（自动生成，勿装库）", "",
                 "- source: %s" % meta["source-video"], "- distilled-at: %s" % ts, ""]
        for kind, raw in (units or {}).items():
            audit += ["## extractor: %s" % kind, "", (raw or "（该路无产出）").strip(), ""]
        _write_unique(os.path.join(inbox_dir(), name + ".extractors.yaml"), "\n".join(audit))
        out.append({"name": name, "title": meta.get("title", name), "path": path,
                    "description": meta.get("description", "")[:120]})
    return out


# ---------------- 主流程 ----------------

def run_distill(material, llm, opts=None):
    """D1 四路提取 + D2 编译 + D3 落盘。
    llm: 同步函数 prompt->str（调用方负责加锁与线程）。opts: {maxSkills, sourceVideo}。"""
    opts = opts or {}
    max_skills = int(opts.get("maxSkills") or 3)
    source_video = opts.get("sourceVideo") or "unknown.mp4"
    units = {}
    for kind in ("principle", "framework", "counter_example", "case"):
        try:
            units[kind] = (llm(_extractor_prompt(kind, material)) or "").strip()
        except Exception as exc:
            units[kind] = ""
            print("[distill] extractor %s failed: %s" % (kind, str(exc)[:200]), flush=True)
    units_text = "\n".join("### %s\n%s" % (k, v or "（无产出）") for k, v in units.items())
    compiled = ""
    try:
        compiled = (llm(_COMPILE_PROMPT % (max_skills, material, units_text)) or "").strip()
    except Exception as exc:
        print("[distill] compile failed: %s" % str(exc)[:200], flush=True)
    skills = save_drafts(compiled, units, source_video)
    return {"skills": skills, "units": units, "compiled": compiled}


# ---------------- CLI：python -m vision.distill <视频路径> ----------------

def main():
    import argparse
    import asyncio
    from . import media, perception, voice as voice_mod

    ap = argparse.ArgumentParser(description="视频蒸馏 CLI（cangjie 移植，本地 MiniCPM）")
    ap.add_argument("video", help="本机视频路径")
    ap.add_argument("--max-skills", type=int, default=3)
    a = ap.parse_args()

    with open(a.video, "rb") as fh:
        data = fh.read()
    name = os.path.basename(a.video)
    frames, fps, duration = media.decode_video(data, name)
    transcript, segments = None, []
    try:
        wav = media.extract_audio_wav(data, name)
        if wav:
            transcript, segments = voice_mod.transcribe_wav_subprocess(wav)
    except Exception:
        pass
    seg_lines = []
    for sg in segments or []:
        st, en = float(sg.get("start") or 0), float(sg.get("end") or 0)
        tx = (sg.get("text") or "").strip()
        if tx:
            seg_lines.append("[%02d:%02d-%02d:%02d] %s" % (int(st // 60), int(st % 60), int(en // 60), int(en % 60), tx))
    seg_text = "\n".join(seg_lines)
    print("[distill] frames=%s duration=%s segs=%s" % (len(frames), round(duration or 0, 1), len(seg_lines)), flush=True)

    perception._ensure_vision_loaded()
    process = perception.run_vision([{"role": "user", "content": [
        {"type": "video", "video": (frames, fps, duration)},
        {"type": "text", "text": overview_prompt(len(frames), duration, seg_text)},
    ]}])
    print("[distill] overview %s chars" % len(process or ""), flush=True)
    material = merge_material(process, seg_text)
    result = run_distill(material, perception.run_vision_text,
                         {"maxSkills": a.max_skills, "sourceVideo": name})
    for sk in result["skills"]:
        print("[distill] skill -> %s (%s)" % (sk["path"], sk["title"]), flush=True)
    if not result["skills"]:
        print("[distill] 无完整技能产出；原始编译文本已打印：\n%s" % result["compiled"][:2000], flush=True)


if __name__ == "__main__":
    main()
