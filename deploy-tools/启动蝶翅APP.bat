off
echo
蝶翅APP启动器
:: 蝶翅APP启动器
@echo off
chcp 65001 >nul

:menu
cls
echo.
echo  🚀 蝶翅APP启动器

echo 1. 启动蝶翅APP前端 (开发模式)
echo 2. 启动DeepSeek Harness (Web UI)
echo 3. 同时启动两者
echo 0. 退出

echo.
set /p choice=请选择 (0-3):

if "%choice%"=="1" goto start_diechi
if "%choice%"=="2" goto start_harness
if "%choice%"=="3" goto start_both
if "%choice%"=="0" exit

echo 无效选择！
pause
goto menu

:start_diechi
cd /d "D:\桌面\振翅新科\蝶翅-app"
echo 启动蝶翅APP前端...
pnpm --filter @diechi/web run dev
pause
goto menu

:start_harness
cd /d "D:\桌面\振翅新科\deep seek harness\deepseek-harness-master\deepseek-harness-master"
echo 启动DeepSeek Harness...
pnpm dsh web
pause
goto menu

:start_both
start "蝶翅APP" cmd /c "cd /d "D:\桌面\振翅新科\蝶翅-app" && pnpm --filter @diechi/web run dev"
start "Harness" cmd /c "cd /d "D:\桌面\振翅新科\deep seek harness\deepseek-harness-master\deepseek-harness-master" && pnpm dsh web"
echo 两个服务已启动！
echo 蝶翅APP: http://localhost:3000
echo Harness: http://127.0.0.1:3080
pause
goto menu
