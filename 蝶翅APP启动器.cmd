@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  蝶翅APP 启动器（命令行版）
rem ============================================================
rem  本脚本已简化为直接调用 deploy-tools/start-diechi.cmd。
rem  推荐日常使用桌面快捷方式：蝶翅APP启动器.exe
rem ============================================================

set "START_CMD=%~dp0deploy-tools\start-diechi.cmd"
if not exist "%START_CMD%" (
  echo ERROR: 找不到启动脚本 %START_CMD%
  pause
  exit /b 1
)

call "%START_CMD%"
