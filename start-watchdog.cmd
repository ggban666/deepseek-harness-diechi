@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  蝶翅三架构 · watchdog 独立进程启动器
rem
rem  watchdog 必须跑在 DSH 进程之外 —— 它跑在 DSH 里的话，
rem  DSH 一崩 watchdog 跟着死，"任一角色死了其他能接住"就失效。
rem  所以这里是一个独立窗口 / 独立进程，跟 3090 的 DSH 平级。
rem
rem  停止：直接关窗口，或 Ctrl+C（不会杀掉已拉起的 DSH）。
rem ============================================================

rem 以本脚本所在目录（蝶翅-app 根目录）为基准
set "APP_ROOT=%~dp0"
set "DSH_HOME=%APP_ROOT%diechi-home"
set "DIECHI_HARNESS_PATH=%APP_ROOT%diechi-harness"
set "NODE_EXE=%APP_ROOT%vendor\node\node.exe"

if not exist "%NODE_EXE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [watchdog] ERROR: 找不到项目内置 Node（%NODE_EXE%），也找不到系统 Node。
    echo [watchdog] 请先运行 setup-vendor.cmd。
    pause
    exit /b 1
  ) else (
    for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i"
  )
)

rem 可按需调整（去掉 rem 生效）：
rem set "WATCHDOG_PORT=3090"
rem set "WATCHDOG_INTERVAL_SEC=30"
rem set "WATCHDOG_PROBE_MODE=port"

cd /d "%DIECHI_HARNESS_PATH%"

if not exist "%DIECHI_HARNESS_PATH%\apps\cli\lib\bin.js" (
  echo [watchdog] 找不到 DSH CLI 入口：%DIECHI_HARNESS_PATH%\apps\cli\lib\bin.js
  echo [watchdog] 请检查 DIECHI_HARNESS_PATH 是否指向 diechi-harness
  pause
  exit /b 1
)

echo [watchdog] DSH_HOME = %DSH_HOME%
echo [watchdog] 信号文件 = %DSH_HOME%\.watchdog\update.signal
echo [watchdog] NODE_EXE = %NODE_EXE%
echo [watchdog] 按 Ctrl+C 停止（已拉起的 DSH 不受影响）
echo.

"%NODE_EXE%" --import tsx packages/host/diechi-process-watchdog/src/cli.ts

endlocal
