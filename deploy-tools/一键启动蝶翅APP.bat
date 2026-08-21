off
:: 蝶翅APP 一键启动器
:: 整合DeepSeek Harness + 蝶翅APP前端

chcp 65001 >nul
setlocal enabledelayedexpansion

:: 定义颜色
set "GREEN=0A"
set "YELLOW=0E"
set "RED=0C"
set "BLUE=09"

:: 定义项目路径
set "HARNESS_PATH=D:\桌面\振翅新科\deep seek harness\deepseek-harness-master\deepseek-harness-master"
set "DIECHI_APP_PATH=D:\桌面\振翅新科\蝶翅-app"
set "LAUNCHER_LOG=D:\桌面\振翅新科\蝶翅APP启动日志.txt"

:: 清空日志文件
if exist "%LAUNCHER_LOG%" del "%LAUNCHER_LOG%"

:MAIN_MENU
cls
color %BLUE%

echo.
echo  🚀 蝶翅APP 一键启动器 v1.0
echo ==============================================
echo.
echo  📍 当前时间: %date% %time%
echo  📁 Harness路径: %HARNESS_PATH%
echo  📁 蝶翅APP路径: %DIECHI_APP_PATH%
echo.
echo ==============================================
echo.
echo  🎯 请选择启动模式:
echo.
echo  1. 🚀 启动 DeepSeek Harness (Web UI)
echo  2. 🦋 启动 蝶翅APP 前端 (开发模式)
echo  3. 🔄 同时启动两者 (推荐)
echo  4. 🛠️  仅启动 Harness 服务端
echo.
echo  5. 📊 查看启动日志
echo  6. ⚙️  配置启动选项
echo.
echo  0. ❌ 退出
echo.

set /p "choice=请输入选项 (0-6): "

if "%choice%"=="1" goto START_HARNESS
if "%choice%"=="2" goto START_DIECHI_APP
if "%choice%"=="3" goto START_BOTH
if "%choice%"=="4" goto START_HARNESS_SERVER
if "%choice%"=="5" goto VIEW_LOG
if "%choice%"=="6" goto CONFIG_MENU
if "%choice%"=="0" goto EXIT_LAUNCHER

color %RED%
echo.
echo ❌ 无效选项！请重新选择。
pause >nul
goto MAIN_MENU

:START_HARNESS
cls
color %GREEN%
echo.
echo 🚀 正在启动 DeepSeek Harness...
echo ==============================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js！请先安装Node.js 22+
    pause
    goto MAIN_MENU
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm！请先安装pnpm
    echo 可以通过以下命令安装：
    echo   npm install -g pnpm
    pause
    goto MAIN_MENU
)

cd /d "%HARNESS_PATH%"
start "DeepSeek Harness" cmd /k "echo 启动DeepSeek Harness... && pnpm dsh web"
timeout /t 3 >nul

echo.
echo ✅ DeepSeek Harness已启动！
echo   请访问: http://127.0.0.1:3080
echo.
pause
goto MAIN_MENU

:START_DIECHI_APP
cls
color %YELLOW%
echo.
echo 🦋 正在启动蝶翅APP前端...
echo ==============================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js！请先安装Node.js 22+
    pause
    goto MAIN_MENU
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm！请先安装pnpm
    pause
    goto MAIN_MENU
)

cd /d "%DIECHI_APP_PATH%"
echo 🔧 安装依赖...
pnpm install --frozen-lockfile >nul 2>&1

start "蝶翅APP前端" cmd /k "echo 启动蝶翅APP前端... && pnpm --filter @diechi/web run dev"
timeout /t 3 >nul

echo.
echo ✅ 蝶翅APP前端已启动！
echo   请访问: http://localhost:3000
echo.
pause
goto MAIN_MENU

:START_BOTH
cls
color %GREEN%
echo.
echo 🔄 正在同时启动两个服务...
echo ==============================================
echo.

start "DeepSeek Harness" cmd /k "cd /d ""%HARNESS_PATH%"" && pnpm dsh web"
timeout /t 2 >nul
start "蝶翅APP前端" cmd /k "cd /d ""%DIECHI_APP_PATH%"" && pnpm --filter @diechi/web run dev"
timeout /t 3 >nul

echo.
echo ✅ 两个服务已同时启动！
echo   DeepSeek Harness: http://127.0.0.1:3080
echo   蝶翅APP前端:      http://localhost:3000
echo.
pause
goto MAIN_MENU

:START_HARNESS_SERVER
cls
color %BLUE%
echo.
echo 🛠️ 正在启动 Harness 服务端...
echo ==============================================
echo.

cd /d "%HARNESS_PATH%"
start "Harness服务端" cmd /k "echo 启动Harness服务端... && pnpm dsh"
timeout /t 2 >nul

echo.
echo ✅ Harness服务端已启动！
echo.
pause
goto MAIN_MENU

:VIEW_LOG
cls
color %WHITE%
echo.
echo 📊 启动日志查看器
echo ==============================================
echo.

if not exist "%LAUNCHER_LOG%" (
    echo ❌ 日志文件不存在！
    pause
    goto MAIN_MENU
)

more "%LAUNCHER_LOG%"
echo.
echo ==============================================
echo.
pause >nul
goto MAIN_MENU

:CONFIG_MENU
cls
color %BLUE%
echo.
echo ⚙️ 启动器配置选项
echo ==============================================
echo.
echo  📁 当前配置:
echo  1. Harness路径: %HARNESS_PATH%
echo  2. 蝶翅APP路径: %DIECHI_APP_PATH%
echo.
echo ==============================================
echo.
echo  🔧 配置选项:
echo  4. 修改 Harness 路径
echo  5. 修改 蝶翅APP 路径
echo  0. 返回主菜单
echo.

set /p "config_choice=请输入选项 (0,4,5): "

if "%config_choice%"=="4" goto CONFIG_SET_HARNESS_PATH
if "%config_choice%"=="5" goto CONFIG_SET_DIECHI_PATH
if "%config_choice%"=="0" goto MAIN_MENU

color %RED%
echo.
echo ❌ 无效选项！
pause >nul
goto CONFIG_MENU

:CONFIG_SET_HARNESS_PATH
cls
echo.
echo 🔧 修改 Harness 路径
echo ==============================================
echo.
echo 当前路径: %HARNESS_PATH%
echo.
set /p "new_path=新路径: "
if not "%new_path%"=="" set "HARNESS_PATH=%new_path%"
echo.
echo ✅ Harness路径已更新
echo.
pause
goto CONFIG_MENU

:CONFIG_SET_DIECHI_PATH
cls
echo.
echo 🔧 修改 蝶翅APP 路径
echo ==============================================
echo.
echo 当前路径: %DIECHI_APP_PATH%
echo.
set /p "new_path=新路径: "
if not "%new_path%"=="" set "DIECHI_APP_PATH=%new_path%"
echo.
echo ✅ 蝶翅APP路径已更新
echo.
pause
goto CONFIG_MENU

:EXIT_LAUNCHER
cls
color %RED%
echo.
echo 👋 感谢使用蝶翅APP一键启动器！
echo.
pause >nul
exit
