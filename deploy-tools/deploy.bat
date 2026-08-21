@echo off

@echo off

:: 蝶翅APP自动化部署脚本 (Windows版本)
:: 用于生产环境一键部署

chcp 65001 >nul
setlocal enabledelayedexpansion

:: 定义颜色
set "GREEN=0A"
set "YELLOW=0E"
set "RED=0C"
set "BLUE=09"
set "RESET=07"

:: 日志函数
:log_info
    echo [INFO] %~1
    goto :eof

:log_success
    echo [✓] %~1
    goto :eof

:log_warning
    color %YELLOW%
    echo [⚠] %~1
    color %BLUE%
    goto :eof

:log_error
    color %RED%
    echo [✗] %~1
    color %BLUE%
    goto :eof

:: 检查环境
:check_environment
    call :log_info "检查环境依赖..."
    
    :: 检查Node.js
    where node >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        call :log_error "Node.js未安装！请先安装Node.js 22+"
        pause
        exit /b 1
    )
    
    :: 检查pnpm
    where pnpm >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        call :log_error "pnpm未安装！请先安装pnpm"
        call :log_info "安装命令：npm install -g pnpm"
        pause
        exit /b 1
    )
    
    :: 检查Git
    where git >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        call :log_error "Git未安装！请先安装Git"
        pause
        exit /b 1
    )
    
    :: 检查Docker（可选）
    where docker >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        call :log_warning "Docker未安装，跳过容器部署"
    )
    
    call :log_success "环境检查通过"
    goto :eof

:: 生产构建
:build_production
    call :log_info "开始生产构建..."
    
    cd /d "%~dp0"
    
    :: 清理旧构建
    call :log_info "清理旧构建产物..."
    pnpm run clean >nul 2>&1 || (
        call :log_warning "清理失败，继续..."
    )
    
    :: 生产构建
    call :log_info "运行生产构建..."
    pnpm run build:web
    
    if %ERRORLEVEL% neq 0 (
        call :log_error "构建失败！"
        pause
        exit /b 1
    )
    
    call :log_success "生产构建完成"
    call :log_info "构建产物位置：apps\web\dist\"
    pause
    goto :eof

:: 本地预览
:preview_build
    call :log_info "启动预览服务器..."
    
    cd /d "%~dp0"
    start "蝶翅APP预览" cmd /k "pnpm run preview:web"
    
    call :log_success "预览服务器已启动"
    call :log_info "访问地址：http://localhost:3000"
    call :log_info "按任意键返回菜单"
    pause >nul
    goto :eof

:: Docker部署
:deploy_docker
    call :log_info "开始Docker部署..."
    
    cd /d "%~dp0"
    
    :: 构建镜像
    call :log_info "构建Docker镜像..."
    docker build -t diechi-app:latest .
    
    if %ERRORLEVEL% neq 0 (
        call :log_error "Docker构建失败！"
        pause
        exit /b 1
    )
    
    :: 停止旧容器（如果存在）
    docker ps -a | findstr /c:"diechi-app" >nul
    if %ERRORLEVEL% equ 0 (
        call :log_info "停止旧容器..."
        docker stop diechi-app >nul 2>&1 || (
            call :log_warning "停止旧容器失败，继续..."
        )
        docker rm diechi-app >nul 2>&1 || (
            call :log_warning "删除旧容器失败，继续..."
        )
    )
    
    :: 运行新容器
    call :log_info "启动新容器..."
    docker run -d ^
        --name diechi-app ^
        -p 3000:3000 ^
        -e NODE_ENV=production ^
        -e PORT=3000 ^
        --restart unless-stopped ^
        diechi-app:latest
    
    if %ERRORLEVEL% neq 0 (
        call :log_error "容器启动失败！"
        pause
        exit /b 1
    )
    
    call :log_success "Docker部署完成"
    call :log_info "容器状态："
    docker ps | findstr /c:"diechi-app"
    pause
    goto :eof

:: 主菜单
:main_menu
    cls
    color %BLUE%
    
    echo.
    echo 🚀 蝶翅APP自动化部署脚本
    echo ============================
    echo.
    echo 1. 📦 生产构建
    echo 2. 👁️  本地预览
    echo 3. 🐳  Docker部署
    echo 4. 🔄  一键完整部署
    echo.
    echo 0. ❌ 退出
    echo.
    
    set /p "choice=请选择操作 (0-4): "
    
    if "%choice%"=="1" call :build_production && goto :main_menu
    if "%choice%"=="2" call :preview_build && goto :main_menu
    if "%choice%"=="3" call :deploy_docker && goto :main_menu
    if "%choice%"=="4" (
        call :build_production
        call :preview_build
        call :deploy_docker
        goto :main_menu
    )
    if "%choice%"=="0" exit /b 0
    
    call :log_error "无效选项！"
    pause
    goto :main_menu

:: 启动脚本
:start
    call :check_environment
    call :main_menu

:: 结束
:end
    exit /b 0

