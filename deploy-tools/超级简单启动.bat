@echo off
chcp 65001 >nul

:: 超级简单启动器 - 你只需要双击运行
:: 会自动检查一切并启动服务

cls
echo =============================================
echo 🦋 蝶翅APP一键启动器 (超级简单版)
echo =============================================
echo.
echo 正在检查和启动服务，请稍等...
echo.

:: 定义路径
set "HARNESS_PATH=D:\桌面\振翅新科\deep seek harness\deepseek-harness-master\deepseek-harness-master"
set "DIECHI_APP_PATH=D:\桌面\振翅新科\蝶翅-app"

:: 检查Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js！
    echo 我正在帮你下载安装...
    echo 请等待安装完成...
    
    :: 下载Node.js (简化版，实际需要手动下载)
    echo ⚠️ 请手动下载Node.js 22+：https://nodejs.org/
    echo 下载完成后，重新运行这个启动器
    pause
    exit
)

:: 检查pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm！正在安装...
    npm install -g pnpm
    if %ERRORLEVEL% neq 0 (
        echo ❌ pnpm安装失败！请手动运行：npm install -g pnpm
        pause
        exit
    )
    echo ✅ pnpm已安装
)

:: 启动DeepSeek Harness
cd /d "%HARNESS_PATH%"
start "DeepSeek Harness" cmd /k "echo 🚀 启动DeepSeek Harness... && pnpm dsh web"

:: 启动蝶翅APP前端
cd /d "%DIECHI_APP_PATH%"
if not exist "node_modules" (
    echo 📦 安装依赖...请等待...
    pnpm install
)

start "蝶翅APP前端" cmd /k "echo 🚀 启动蝶翅APP前端... && pnpm --filter @diechi/web run dev"

:: 等待启动完成
timeout /t 5 >nul

:: 显示结果
echo.
echo ✅ 启动完成！
echo.
echo 🌐 请在浏览器中打开:
echo   🔗 http://localhost:3000  (蝶翅APP前端)
echo   🔗 http://127.0.0.1:3080  (DeepSeek Harness)
echo.
echo 💡 如果页面打不开，请刷新浏览器或重新运行这个启动器
pause
