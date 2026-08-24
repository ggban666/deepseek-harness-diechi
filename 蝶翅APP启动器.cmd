@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: =============================================
:: 蝶翅APP 统一启动管理器 v3.0
:: - 蝶翅APP基座 (端口3090)
:: - 原版Harness (端口3080)
:: - 视觉语音服务 (端口8080, deploy-tools\vision-server.py)
:: =============================================

:: 定义路径
set "DIECHI_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-harness"
set "DIECHI_DATA=D:\桌面\振翅科技\蝶翅-app\diechi-home"
set "ORIGIN_HOME=D:\桌面\振翅科技\deep seek harness\deepseek-harness-master\deepseek-harness-master"
set "VISION_PY=D:\vllm-env\Scripts\python.exe"
set "VISION_SCRIPT=D:\桌面\振翅科技\蝶翅-app\deploy-tools\vision-server.py"

:: 检查Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 错误: 未检测到Node.js安装
    echo    请先安装Node.js 22+
    pause
    exit /b 1
)

:: 检查视觉服务环境
if not exist "%VISION_PY%" (
    echo ⚠️ 未找到视觉服务Python环境: %VISION_PY%
    echo   视觉/语音功能将不可用，可继续使用纯文本对话。
    echo.
)

:menu
cls
echo.
echo ==============================================
echo   🦋 蝶翅APP 统一启动管理器 v3.0 🦋
echo ==============================================
echo.
echo 服务状态检测中...
echo.

:: 检测服务状态
set "diechi_status=停止"
set "origin_status=停止"
set "vision_status=停止"
netstat -ano | findstr ":3090" | findstr "LISTENING" >nul && set "diechi_status=运行中"
netstat -ano | findstr ":3080" | findstr "LISTENING" >nul && set "origin_status=运行中"
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul && set "vision_status=运行中"

echo 服务状态:
echo   蝶翅APP基座 (3090): %diechi_status%
echo   原版Harness (3080): %origin_status%
echo   视觉语音服务 (8080): %vision_status%
echo.
echo ==============================================
echo   请选择操作:
echo ==============================================
echo.
echo  1. 启动 蝶翅APP基座 (自动拉起视觉语音服务)
echo  2. 停止 蝶翅APP基座
echo  3. 访问 蝶翅APP (http://127.0.0.1:3090)
echo  4. 启动 原版Harness (端口3080)
echo  5. 停止 原版Harness
echo  6. 访问 原版Harness (http://127.0.0.1:3080)
echo  7. 重启 蝶翅APP基座
echo  8. 启动 视觉语音服务 (端口8080)
echo  9. 停止 视觉语音服务
echo 10. 查看日志
echo.
echo  0. 退出
echo.
set /p choice=请输入选项(0-10):

if "%choice%"=="0" goto exit
if "%choice%"=="1" goto start_diechi
if "%choice%"=="2" goto stop_diechi
if "%choice%"=="3" goto open_diechi
if "%choice%"=="4" goto start_origin
if "%choice%"=="5" goto stop_origin
if "%choice%"=="6" goto open_origin
if "%choice%"=="7" goto restart_diechi
if "%choice%"=="8" goto start_vision
if "%choice%"=="9" goto stop_vision
if "%choice%"=="10" goto show_logs

goto menu

:start_vision
cls
call :stop_vision
if not exist "%VISION_PY%" (
    echo ❌ 未找到 %VISION_PY%
    echo   请确认 vllm-env 存在。
    timeout /t 3 >nul
    goto menu
)
echo 正在启动视觉语音服务 (8080)...
start "视觉语音服务(8080)" "%VISION_PY%" "%VISION_SCRIPT%" 8080
echo 启动命令已发送，模型加载约需 10-30 秒...
timeout /t 3 >nul
goto menu

:stop_vision
cls
echo 停止 视觉语音服务 (8080)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vision-server\.py|_asr_worker\.py' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }"
timeout /t 2 >nul
goto menu

:start_diechi
cls
call :start_vision
echo 正在启动 蝶翅APP基座 (端口3090)...
cd /d "%DIECHI_HOME%"
start "蝶翅APP" cmd /c "set DSH_HOME=%DIECHI_DATA%&& pnpm dsh web --port 3090"
echo 启动命令已发送，请稍等...
timeout /t 3 >nul
goto menu

:stop_diechi
cls
echo 停止 蝶翅APP基座 (端口3090)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3090" ^| findstr "LISTENING"') do taskkill /f /pid %%P >nul 2>&1
echo 已停止蝶翅APP基座
timeout /t 2 >nul
goto menu

:open_diechi
start "" "http://127.0.0.1:3090"
goto menu

:start_origin
cls
echo 正在启动 原版Harness (端口3080)...
cd /d "%ORIGIN_HOME%"
start "原版Harness" cmd /c "set DSH_HOME=&& pnpm dsh web --port 3080"
echo 启动命令已发送，请稍等...
timeout /t 3 >nul
goto menu

:stop_origin
cls
echo 停止 原版Harness (端口3080)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3080" ^| findstr "LISTENING"') do taskkill /f /pid %%P >nul 2>&1
echo 已停止原版Harness
timeout /t 2 >nul
goto menu

:open_origin
start "" "http://127.0.0.1:3080"
goto menu

:restart_diechi
call :stop_diechi
call :start_diechi
goto menu

:show_logs
cls
echo 蝶翅APP基座日志:
cd /d "%DIECHI_HOME%"
if exist "logs" (
    type logs\*.log 2>nul || echo 无日志文件
) else (
    echo 无日志目录
)
echo.
echo 视觉语音服务日志: deploy-tools\vision-8080.log / vision-8080.err.log
echo.
echo 按任意键返回菜单...
pause >nul
goto menu

:exit
cls
echo 谢谢使用 蝶翅APP 统一启动管理器
pause
exit
