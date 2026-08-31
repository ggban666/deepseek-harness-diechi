@echo off
chcp 65001 >nul
setlocal

rem 蝶翅APP 重启脚本：停止旧 3090 服务，再由 start-diechi.cmd 统一拉起。
rem 路径以本脚本所在目录（deploy-tools）为基准。

set "APP_ROOT=%~dp0.."
set "MARKER=%~dp0relaunch-diechi.marker"
set "START_CMD=%~dp0start-diechi.cmd"

del "%MARKER%" >nul 2>&1

rem 给当前对话留出完成收尾的时间
timeout /t 25 /nobreak >nul

rem 停止占用 3090 的旧服务
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3090" ^| findstr "LISTENING"') do taskkill /f /pid %%P >nul 2>&1
timeout /t 3 /nobreak >nul

rem 由统一的 start-diechi.cmd 负责拉起 8081 lazy proxy + 3090
if not exist "%START_CMD%" (
  echo FAILED > "%MARKER%"
  echo ERROR: 找不到 %START_CMD%
  exit /b 1
)

start "蝶翅APP Relaunch" "%START_CMD%"

rem 等待端口就绪，写入结果标记
set /a n=0
:wait
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":3090" | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 goto up
set /a n+=1
if %n% geq 45 goto down
goto wait
:up
echo OK > "%MARKER%"
exit /b 0
:down
echo FAILED > "%MARKER%"
exit /b 1
