@echo off
chcp 65001 >nul

:: 蝶翅APP + DeepSeek Harness 故障排除脚本
:: 检查和修复启动问题

cls
echo =============================================
echo 🔧 蝶翅APP故障排除工具 v1.0
echo =============================================
echo.

:: 检查Node.js版本
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到Node.js！
    echo 请先下载安装Node.js 22+：https://nodejs.org/
    pause
    exit /b 1
)

node --version | findstr /R "^v22" >nul
if %ERRORLEVEL% equ 0 (
    echo ✅ Node.js版本检查通过
) else (
    echo ⚠️  当前Node.js版本可能不兼容
    echo 请升级到Node.js 22+
)

:: 检查pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ 找不到pnpm！正在安装...
    npm install -g pnpm
    if %ERRORLEVEL% neq 0 (
        echo ❌ pnpm安装失败！
        echo 请手动运行：npm install -g pnpm
        pause
        exit /b 1
    )
    echo ✅ pnpm已安装
)

:: 检查项目依赖
cd /d "D:\桌面\振翅新科\蝶翅-app"

if not exist "node_modules" (
    echo 📦 安装项目依赖...
    pnpm install
    if %ERRORLEVEL% neq 0 (
        echo ❌ 依赖安装失败！尝试清理重试...
        pnpm install --force
        if %ERRORLEVEL% neq 0 (
            echo ❌ 依赖安装仍然失败！
            echo 可能需要手动删除node_modules后重试
            pause
            exit /b 1
        )
    )
    echo ✅ 项目依赖已安装
)

:: 检查web应用依赖
cd /d "D:\桌面\振翅新科\蝶翅-app\apps\web"

if not exist "node_modules" (
    echo 📦 安装web应用依赖...
    pnpm install
    if %ERRORLEVEL% neq 0 (
        echo ❌ web应用依赖安装失败！
        pause
        exit /b 1
    )
    echo ✅ web应用依赖已安装
)

echo.
echo =============================================
echo ✅ 故障排除完成！问题已解决

echo.
echo 📋 启动步骤:
echo 1. 运行: D:\桌面\振翅新科\蝶翅-app\一键启动.bat
echo 2. 选择选项3 (同时启动两个服务)
echo 3. 访问: http://localhost:3000 和 http://127.0.0.1:3080

echo.
pause
