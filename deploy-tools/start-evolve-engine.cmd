@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  蝶翅三架构 · M4 进化引擎启动器（Qwen3.8-27B + GBNF）
rem
rem  拉起 llama-server（CUDA，-ngl 99 全层 offload）监听 127.0.0.1:8081。
rem  这是非 lazy 模式，启动即占显存；日常使用请优先用 start-diechi.cmd 的 lazy 模式。
rem
rem  停止：直接关窗口，或 Ctrl+C。
rem ============================================================

rem 以项目根目录（蝶翅-app，本脚本上一级）为基准
set "APP_ROOT=%~dp0..\"
set "EVOLVE_DIR=%~dp0evolve"
set "EVOLVE_MODEL=%APP_ROOT%models\Qwen3.8-27B-UD-IQ1_S\Qwen3.8-27B-UD-IQ1_S.gguf"
set "PYTHON_EXE=%APP_ROOT%vendor\python\python.exe"

if not exist "%PYTHON_EXE%" (
  where python >nul 2>&1
  if errorlevel 1 (
    echo [evolve-engine] ERROR: 找不到项目内置 Python（%PYTHON_EXE%），也找不到系统 Python。
    echo [evolve-engine] 请先运行 setup-vendor.cmd。
    pause
    exit /b 1
  ) else (
    for /f "delims=" %%i in ('where python') do set "PYTHON_EXE=%%i"
  )
)

if not exist "%EVOLVE_MODEL%" (
  echo [evolve-engine] 找不到模型：%EVOLVE_MODEL%
  pause
  exit /b 1
)

cd /d "%EVOLVE_DIR%"

echo [evolve-engine] 模型 = Qwen3.8-27B-UD-IQ1_S
echo [evolve-engine] 端口 = 8081（GBNF 约束解码）
echo [evolve-engine] GPU  = -ngl 99 全层 offload
echo [evolve-engine] PYTHON_EXE = %PYTHON_EXE%
echo [evolve-engine] 按 Ctrl+C 停止
echo.

"%PYTHON_EXE%" engine.py serve --model "%EVOLVE_MODEL%" --port 8081 --ctx 32768 --ngl 99

endlocal
