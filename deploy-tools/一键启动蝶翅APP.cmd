@echo off
:: 蝶翅APP一键启动器
:: 启动蝶翅DeepSeek Harness基座 (端口3090)
:: 作者: Codex Agent
:: 日期: 2026-08-17

setlocal

:: 检查Node.js是否安装
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 错误: 未检测到Node.js安装
    echo 请先安装Node.js 16+
    pause
    exit /b 1
)

:: 检查pnpm是否安装
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 错误: 未检测到pnpm安装
    echo 正在尝试安装pnpm...
    npm install -g pnpm
    if %ERRORLEVEL% neq 0 (
        echo pnpm安装失败
        pause
        exit /b 1
    )
)

:: 启动蝶翅基座
cd /d "D:\桌面\振翅科技\蝶翅-app\diechi-harness"

if exist "node_modules" (
    echo 检测到已安装的依赖...
) else (
    echo 安装依赖中...
    pnpm install
    if %ERRORLEVEL% neq 0 (
        echo 依赖安装失败
        pause
        exit /b 1
    )
)

:: 固化数据目录(DSH_HOME)：避免回退 ~/.dsh 导致供应商丢失
set "DSH_HOME=%CD%\..\diechi-home"
echo [DSH_HOME]=%DSH_HOME%
echo 正在启动蝶翅APP (DeepSeek Harness基座)...
echo 访问地址: http://127.0.0.1:3090

pnpm dsh web --port 3090

endlocal
pause
