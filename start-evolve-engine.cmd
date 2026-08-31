@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  蝶翅三架构 · M4 进化引擎启动器（Qwen3.8-27B + GBNF）
rem
rem  拉起 llama-server（CUDA，-ngl 99 全层 offload）监听 127.0.0.1:8081。
rem  diechi-evolve 插件的引擎定时器会每小时探测 /health，
rem  引擎在就喂负样本聚类产出提议，不在就静默跳过。
rem
rem  停止：直接关窗口，或 Ctrl+C。
rem  前提：8080 视觉服务占约 2.1GB 显存，剩余够 27B 1bit 模型。
rem ============================================================

set "EVOLVE_DIR=D:\桌面\振翅科技\蝶翅-app\deploy-tools\evolve"
set "EVOLVE_MODEL=D:\桌面\振翅科技\models\Qwen3.8-27B-UD-IQ1_S\Qwen3.8-27B-UD-IQ1_S.gguf"

if not exist "%EVOLVE_MODEL%" (
  echo [evolve-engine] 找不到模型：%EVOLVE_MODEL%
  pause
  exit /b 1
)

cd /d "%EVOLVE_DIR%"

echo [evolve-engine] 模型 = Qwen3.8-27B-UD-IQ1_S
echo [evolve-engine] 端口 = 8081（GBNF 约束解码，kind 白名单无 add-rule）
echo [evolve-engine] GPU  = -ngl 99 全层 offload
echo [evolve-engine] 按 Ctrl+C 停止
echo.

python engine.py serve --model "%EVOLVE_MODEL%" --port 8081 --ctx 2048 --ngl 99

endlocal
