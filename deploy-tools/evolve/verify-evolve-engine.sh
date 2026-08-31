#!/usr/bin/env bash
# M4 硬验收：Qwen3.8-27B-UD-IQ1_S 弱模型引擎端到端（GPU 版）。
# 覆盖 S5 弱模型放大实验第一个实测点：约束解码下能否产出建设性提议。
#
# 前置：
#   - CUDA 版 llama.cpp 已放到 D:\桌面\振翅科技\models\llama.cpp\
#   - 模型已下载（D:\桌面\振翅科技\models\Qwen3.8-27B-UD-IQ1_S\）
#
# 用法：
#   bash verify-evolve-engine.sh                # 等模型下完自动验收
#   bash verify-evolve-engine.sh --skip-wait    # 模型已下完直接跑
set -u

MODEL="/d/桌面/振翅科技/models/Qwen3.8-27B-UD-IQ1_S/Qwen3.8-27B-UD-IQ1_S.gguf"
TARGET=5760000000          # 5.76GB 目标大小
PORT=8081
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_DIR="/d/桌面/振翅科技/models/llama.cpp"
NGL="99"                   # 全上 GPU（RTX 4070）

echo "==== M4 硬验收：弱模型进化引擎 (GPU) ===="
echo "模型: $MODEL"
echo "GPU 层数: $NGL"

# ---------- 1. 等模型下载完 ----------
if [ "${1:-}" != "--skip-wait" ]; then
  echo "---- 等待模型下载完成 (目标 ${TARGET}B) ----"
  while :; do
    if [ ! -f "$MODEL" ]; then echo "模型文件不存在"; exit 1; fi
    sz=$(stat -c %s "$MODEL")
    if [ "$sz" -ge "$TARGET" ]; then echo "模型就绪 size=$sz"; break; fi
    echo -n "  $((sz/1024/1024))MB / $((TARGET/1024/1024))MB ... "
    sleep 30
  done
fi

# ---------- 2. 校验文件大小 ----------
sz=$(stat -c %s "$MODEL")
echo "---- 模型大小: $sz 字节 (目标 >= $TARGET) ----"
if [ "$sz" -lt "$TARGET" ]; then
  echo "[FAIL] 模型不完整，只有 $sz < $TARGET"
  exit 1
fi

# ---------- 3. 确认 CUDA 版 llama.cpp ----------
echo "---- 确认 CUDA 版 llama-server ----"
if [ ! -f "$LLAMA_DIR/ggml-cuda.dll" ]; then
  echo "[FAIL] $LLAMA_DIR 不是 CUDA 版（缺 ggml-cuda.dll）。"
  echo "       需下载 llama-b10712-bin-win-cuda-12.4-x64.zip 解压替换。"
  exit 1
fi
echo "[OK] CUDA 版就位 (ggml-cuda.dll)"

# ---------- 4. 架构支持验证（GPU 加载）----------
echo "---- 用 llama-cli 加载验证 qwen35 架构 + GPU 推理 ----"
LLAMA_CLI="$LLAMA_DIR/llama-cli.exe"
LOAD_LOG="$SELF_DIR/load-test.log"
"$LLAMA_CLI" -m "$MODEL" -p "test" -n 2 -ngl "$NGL" -c 256 --no-display-prompt > "$LOAD_LOG" 2>&1
RC=$?
echo "退出码=$RC  (加载日志: $LOAD_LOG)"
grep -qiE "error|unknown architecture|not supported|failed to load" "$LOAD_LOG" \
  && echo "[FAIL] llama.cpp 无法加载模型（架构不支持？）" \
  && grep -iE "error|unknown architecture|not supported" "$LOAD_LOG" | head -5 \
  && exit 1
grep -qiE "model loaded|llama_new_context|Prompt:" "$LOAD_LOG" \
  && echo "[PASS] 架构支持验证通过" || echo "[WARN] 未找到明确的加载标志（查看日志确认）"

# ---------- 5. 引擎 serve（走 engine.py，复用 cwd/DLL/中文路径修复）----------
echo "---- 启动引擎 serve (port $PORT, ngl=$NGL) ----"
# 确保旧实例不占端口
OLD_PID=$(netstat -ano 2>/dev/null | grep ":$PORT.*LISTENING" | awk '{print $NF}' | head -1)
[ -n "$OLD_PID" ] && taskkill //F //PID "$OLD_PID" 2>/dev/null
# engine.py 会设置 cwd 到 llama.cpp 目录并处理 grammar 中文路径
python "$SELF_DIR/engine.py" serve \
  --model "$MODEL" --port "$PORT" --ctx 2048 --ngl "$NGL" \
  --grammar "$SELF_DIR/grammar.gbnf" > "$SELF_DIR/serve.log" 2>&1 &
SERVER_JOB=$!
echo "  引擎启动 (job=$SERVER_JOB)"

echo "  等待引擎就绪 ..."
READY=0
for i in $(seq 1 240); do
  if curl -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "  就绪 (${i}0s内)"
    READY=1
    break
  fi
  sleep 5
  # 引擎若退出则提前报错
  if ! kill -0 "$SERVER_JOB" 2>/dev/null; then
    echo "[FAIL] 引擎退出，日志尾部："
    tail -15 "$SELF_DIR/serve.log"
    exit 1
  fi
done
if [ "$READY" -eq 0 ]; then
  echo "[FAIL] 引擎 200 秒未就绪"
  tail -20 "$SELF_DIR/serve.log"
  exit 1
fi

# ---------- 6. 真实聚类摘要 propose ----------
echo "---- 用真实负样本聚类摘要跑 propose ----"
SUMMARY='[失败聚类] 类别1「简历解析返工」reason=rework 频次=5 次，涉及 scope: person-brain:resume、person-brain:parse；
用户反复纠正「技能年限算错」「公司名识别错」，每次都要手动改。
类别2「合规问答返工」reason=rework 频次=4 次，涉及 scope: person-brain:legal；
用户追问时发现引用过时法规，回答被退回。'

python "$SELF_DIR/engine.py" propose --port "$PORT" --summary "$SUMMARY" --max 3 \
  > "$SELF_DIR/propose-out.json" 2> "$SELF_DIR/propose-err.log"
RC=$?
echo "  propose 退出码=$RC"

if [ -f "$SELF_DIR/propose-out.json" ]; then
  echo "---- 引擎产出：----"
  cat "$SELF_DIR/propose-out.json"
  echo ""
  N=$(python -c "import json,sys; d=json.load(open(r'$SELF_DIR/propose-out.json')); print(len(d))" 2>/dev/null || echo 0)
  echo "  合法提议数量: $N"
  if [ "$N" -gt 0 ]; then
    echo "[PASS] 弱模型在 GBNF 约束下产出 $N 条建设性提议 —— S5 第一个实测点通过"
  else
    echo "[FAIL] 引擎未产出任何合法提议（看 propose-err.log 与 serve.log）"
    tail -10 "$SELF_DIR/propose-err.log" 2>/dev/null
  fi
fi

# ---------- 7. 清理 ----------
kill "$SERVER_JOB" 2>/dev/null
wait "$SERVER_JOB" 2>/dev/null
echo "==== 验收结束 ===="
