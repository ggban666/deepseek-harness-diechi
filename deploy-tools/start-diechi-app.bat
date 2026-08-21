@echo off

:: 蝶翅APP启动脚本
:: 基于DeepSeek Harness构建
:: 用于快速启动蝶翅APP开发服务器

echo 🚀 蝶翅APP启动脚本
echo ====================
echo.

:: 检查Node.js版本
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js，请先安装Node.js 22+
    pause
    exit /b 1
)

node --version | findstr /R "^v22" >nul
if %ERRORLEVEL% equ 0 (
    echo ✅ Node.js版本检查通过
) else (
    echo ⚠️  当前Node.js版本可能不兼容，建议使用Node.js 22+
)

:: 检查pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm，请先安装pnpm
    echo 可以通过以下命令安装：
    echo   npm install -g pnpm
    pause
    exit /b 1
)

echo.
echo 📋 启动配置
echo --------------------
echo 应用名称: 蝶翅APP - 可切换专家角色的AI工作台
echo 启动端口: 3000 (默认)
echo 访问地址: http://localhost:3000
echo.

:: 启动开发服务器
cd /d "%~dp0"

echo 🔧 安装依赖（如果需要）...
pnpm install --frozen-lockfile

if %ERRORLEVEL% neq 0 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo.
echo ✅ 依赖安装完成

echo 🚀 启动蝶翅APP开发服务器...
echo (按 Ctrl+C 停止服务器)
echo.

:: 启动Vite开发服务器
pnpm --filter @diechi/web run dev

:: 服务器停止后的提示
echo.
echo 🛑 蝶翅APP开发服务器已停止
pause