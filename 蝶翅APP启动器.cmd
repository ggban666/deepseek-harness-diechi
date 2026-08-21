@echo off
:: =============================================
:: 蝶翅APP 统一启动管理器 v2.0
:: =============================================
:: 管理两套DeepSeek Harness系统
:: - 内层: 蝶翅APP基座 (端口3090)
:: - 外层: 原版Harness (端口3080)
::
:: 作者: Codex Agent
:: 日期: 2026-08-17
:: =============================================

@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 定义路径
set "DIECHI_HOME=D:\桌面\振翅新科\蝶翅-app\diechi-harness"
set "DIECHI_DATA=D:\桌面\振翅新科\蝶翅-app\diechi-home"
set "ORIGIN_HOME=D:\桌面\振翅新科\deep seek harness\deepseek-harness-master"

:: 检查Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 错误: 未检测到Node.js安装
    echo    请先安装Node.js 16+
    pause
    exit /b 1
)

:: 主菜单
:menu
cls
echo.
echo ==============================================
echo   🦋 蝶翅APP 统一启动管理器 v2.0 🦋
echo ==============================================
echo.
echo 当前状态检测中...
echo.

:: 检测服务状态
set "diechi_status=停止"
set "origin_status=停止"

:: 简化检测（实际应检查进程，这里简化演示）
netstat -ano | findstr ":3090" >nul && set "diechi_status=运行中"
netstat -ano | findstr ":3080" >nul && set "origin_status=运行中"

echo 服务状态:
echo   蝶翅APP基座 (3090): %diechi_status%
echo   原版Harness (3080): %origin_status%
echo.

echo ==============================================
echo   请选择操作:
echo ==============================================
echo.
echo  1. 启动 蝶翅APP基座 (端口3090)
echo  2. 停止 蝶翅APP基座
echo  3. 访问 蝶翅APP (http://127.0.0.1:3090)
echo  4. 启动 原版Harness (端口3080)
echo  5. 停止 原版Harness
echo  6. 访问 原版Harness (http://127.0.0.1:3080)
echo  7. 重启 蝶翅APP基座
echo  8. 查看日志

echo.
echo  0. 退出

echo.
set /p choice=请输入选项(0-8):

if "%choice%"=="0" goto exit
if "%choice%"=="1" goto start_diechi
if "%choice%"=="2" goto stop_diechi
if "%choice%"=="3" goto open_diechi
if "%choice%"=="4" goto start_origin
if "%choice%"=="5" goto stop_origin
if "%choice%"=="6" goto open_origin
if "%choice%"=="7" goto restart_diechi
if "%choice%"=="8" goto show_logs

goto menu

:start_diechi
cls
echo 正在启动 蝶翅APP基座 (端口3090)...
cd /d "%DIECHI_HOME%"
start "蝶翅APP" cmd /c "pnpm dsh web --port 3090"
echo 启动命令已发送，请稍等...
timeout /t 3 >nul
goto menu

:stop_diechi
cls
echo 停止 蝶翅APP基座 (端口3090)...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im "蝶翅APP" >nul 2>&1
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
start "原版Harness" cmd /c "pnpm dsh web --port 3080"
echo 启动命令已发送，请稍等...
timeout /t 3 >nul
goto menu

:stop_origin
cls
echo 停止 原版Harness (端口3080)...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im "原版Harness" >nul 2>&1
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
echo 按任意键返回菜单...
pause >nul
goto menu

:exit
cls
echo 谢谢使用 蝶翅APP 统一启动管理器
pause
exit
