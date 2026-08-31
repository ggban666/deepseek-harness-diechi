#!/usr/bin/env bash
# 断点续传下载 Qwen3.8-27B-UD-IQ1_S（HF 单连接经常中途 reset，必须循环续传）
set -u
PROXY="${DIECHI_PROXY:-http://127.0.0.1:65532}"
URL="https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ1_S.gguf"
OUT="/d/桌面/振翅科技/models/Qwen3.8-27B-UD-IQ1_S/Qwen3.8-27B-UD-IQ1_S.gguf"

mkdir -p "$(dirname "$OUT")"
# 注意：只允许一个下载进程写 OUT（多进程 curl -C - 并发写会污染文件，导致 GGUF 损坏）
for i in $(seq 1 1000); do
  size=$(stat -c %s "$OUT" 2>/dev/null || echo 0)
  # -C - 断点续传；speed-limit 放宽到 512B/s 避免带宽波动被误判为死连
  curl -sS -L -C - --connect-timeout 20 --speed-time 90 --speed-limit 512 --retry 3 --retry-delay 5 \
    -x "$PROXY" "$URL" >> "$OUT" 2>/dev/null
  rc=$?
  new=$(stat -c %s "$OUT" 2>/dev/null || echo 0)
  if [ "$rc" -eq 0 ]; then
    echo "DONE size=$new after $i attempts"
    exit 0
  fi
  echo "attempt $i rc=$rc size=$size -> $new"
  if [ "$new" -eq "$size" ]; then
    sleep 3
  fi
done
echo "GIVE_UP size=$(stat -c %s "$OUT" 2>/dev/null || echo 0)"
exit 1
