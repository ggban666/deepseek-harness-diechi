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

set "DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home"
set "DIECHI_HARNESS_PATH=D:\桌面\振翅科技\蝶翅-app\diechi-harness"

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
echo [watchdog] 按 Ctrl+C 停止（已拉起的 DSH 不受影响）
echo.

node --import tsx packages/host/diechi-process-watchdog/src/cli.ts

endlocal
