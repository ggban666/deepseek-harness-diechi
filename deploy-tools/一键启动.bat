@echo off
chcp 65001 >nul

:: 蝶翅APP + DeepSeek Harness 一键启动器 v2.0
:: 固化路径，避免混乱，支持中文显示

set "HARNESS_PATH=D:\桌面\振翅新科\deep seek harness\deepseek-harness-master\deepseek-harness-master"
set "DIECHI_APP_PATH=D:\桌面\振翅新科\蝶翅-app"
set "LAUNCHER_LOG=%DIECHI_APP_PATH%\启动日志.txt"

if exist "%LAUNCHER_LOG%" del "%LAUNCHER_LOG%"

:MENU
cls
color 0A

echo.
echo  🚀 蝶翅APP + DeepSeek Harness 一键启动器 v2.0
echo ==============================================================
echo.
echo  📍 启动时间: %date% %time%
echo  📁 Harness路径: %HARNESS_PATH%
echo  📁 蝶翅APP路径: %DIECHI_APP_PATH%
echo.
echo ==============================================================
echo.
echo  🎯 启动模式选择:
echo.
echo  1. 🚀 启动 DeepSeek Harness (Web UI) - http://127.0.0.1:3080
echo  2. 🦋 启动 蝶翅APP前端 (开发模式) - http://localhost:3000
echo  3. 🔄 同时启动两者 (推荐模式)
echo  4. 🛠️  仅启动 Harness 服务端
echo.
echo  5. 📊 查看启动日志
echo  0. ❌ 退出启动器
echo.

set /p "choice=请输入选项 (0-5): "

if "%choice%"=="1" goto START_HARNESS
if "%choice%"=="2" goto START_DIECHI_APP
if "%choice%"=="3" goto START_BOTH
if "%choice%"=="4" goto START_HARNESS_SERVER
if "%choice%"=="5" goto VIEW_LOG
if "%choice%"=="0" exit

echo 无效选择！
pause >nul
goto MENU

:START_HARNESS
cls
color 0E
echo.
echo 🚀 正在启动 DeepSeek Harness Web UI...
echo ==============================================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js！请先安装Node.js 22+
    pause
    goto MENU
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm！正在尝试安装...
    npm install -g pnpm
    if %ERRORLEVEL% neq 0 (
        echo ❌ pnpm安装失败！请手动安装：npm install -g pnpm
        pause
        goto MENU
    )
)

cd /d "%HARNESS_PATH%"
echo 启动DeepSeek Harness...
pnpm dsh web
pause
goto MENU

:START_DIECHI_APP
cls
color 0B
echo.
echo 🦋 正在启动 蝶翅APP前端 (开发模式)...
echo ==============================================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js！请先安装Node.js 22+
    pause
    goto MENU
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm！正在尝试安装...
    npm install -g pnpm
    if %ERRORLEVEL% neq 0 (
        echo ❌ pnpm安装失败！请手动安装：npm install -g pnpm
        pause
        goto MENU
    )
)

cd /d "%DIECHI_APP_PATH%"
echo 启动蝶翅APP前端...
pnpm --filter @diechi/web run dev
pause
goto MENU

:START_BOTH
cls
color 0D
echo.
echo 🔄 正在同时启动两个服务 (推荐模式)...
echo ==============================================================
echo.

start "DeepSeek Harness" cmd /k "cd /d ""%HARNESS_PATH%"" && pnpm dsh web"
timeout /t 2 >nul

start "蝶翅APP前端" cmd /k "cd /d ""%DIECHI_APP_PATH%"" && pnpm --filter @diechi/web run dev"

echo.
echo ✅ 两个服务已启动！
echo   DeepSeek Harness: http://127.0.0.1:3080
echo   蝶翅APP前端:      http://localhost:3000
echo.
pause
goto MENU

:START_HARNESS_SERVER
cls
color 09
echo.
echo 🛠️ 正在启动 Harness 服务端...
echo ==============================================================
echo.

cd /d "%HARNESS_PATH%"
pnpm dsh
pause
goto MENU

:VIEW_LOG
cls
color 0F
echo.
echo 📊 启动日志查看器
echo ==============================================================
echo.

if not exist "%LAUNCHER_LOG%" (
    echo ❌ 日志文件不存在！
    pause
    goto MENU
)

more "%LAUNCHER_LOG%"
echo.
pause >nul
goto MENU
