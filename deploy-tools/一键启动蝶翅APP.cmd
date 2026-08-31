@echo off
chcp 65001 >nul
setlocal

rem 蝶翅APP一键启动器
rem 已简化为调用统一的 start-diechi.cmd，避免重复维护多份启动逻辑。

set "START_CMD=%~dp0start-diechi.cmd"
if not exist "%START_CMD%" (
  echo ERROR: 找不到启动脚本 %START_CMD%
  pause
  exit /b 1
)

call "%START_CMD%"
