# 蝶翅APP自动化部署脚本

#!/bin/bash

# 蝶翅APP自动化部署脚本
# 用于生产环境一键部署

set -e  # 遇到错误立即退出

# 定义颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "[INFO] "
}

log_success() {
    echo -e "[✓] "
}

log_warning() {
    echo -e "[⚠] "
}

log_error() {
    echo -e "[✗] "
}

# 检查环境
check_environment() {
    log_info "检查环境依赖..."
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js未安装！请先安装Node.js 22+"
        exit 1
    fi
    
    # 检查pnpm
    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm未安装！请先安装pnpm"
        log_info "安装命令：npm install -g pnpm"
        exit 1
    fi
    
    # 检查Git
    if ! command -v git &> /dev/null; then
        log_error "Git未安装！请先安装Git"
        exit 1
    fi
    
    # 检查Docker（可选）
    if ! command -v docker &> /dev/null; then
        log_warning "Docker未安装，跳过容器部署"
    fi
    
    log_success "环境检查通过"
}

# 生产构建
build_production() {
    log_info "开始生产构建..."
    
    cd ""
    
    # 清理旧构建
    log_info "清理旧构建产物..."
    pnpm run clean || true
    
    # 生产构建
    log_info "运行生产构建..."
    pnpm run build:web
    
    if [ False -ne 0 ]; then
        log_error "构建失败！"
        exit 1
    fi
    
    log_success "生产构建完成"
    log_info "构建产物位置：apps/web/dist/"
}

# 本地预览
preview_build() {
    log_info "启动预览服务器..."
    
    cd ""
    pnpm run preview:web &
    
    local PID=$!
    log_success "预览服务器运行中 (PID: 6096)"
    log_info "访问地址：http://localhost:3000"
    log_info "按 Ctrl+C 停止预览"
    
    # 等待用户停止
    wait 6096
}

# Docker部署
deploy_docker() {
    log_info "开始Docker部署..."
    
    cd ""
    
    # 构建镜像
    log_info "构建Docker镜像..."
    docker build -t diechi-app:latest .
    
    if [ False -ne 0 ]; then
        log_error "Docker构建失败！"
        exit 1
    fi
    
    # 停止旧容器（如果存在）
    if docker ps -a | grep -q diechi-app; then
        log_info "停止旧容器..."
        docker stop diechi-app || true
        docker rm diechi-app || true
    fi
    
    # 运行新容器
    log_info "启动新容器..."
    docker run -d \
        --name diechi-app \
        -p 3000:3000 \
        -e NODE_ENV=production \
        -e PORT=3000 \
        --restart unless-stopped \
        diechi-app:latest
    
    if [ False -ne 0 ]; then
        log_error "容器启动失败！"
        exit 1
    fi
    
    log_success "Docker部署完成"
    log_info "容器状态："
    docker ps | grep diechi-app
}

# Vercel部署
deploy_vercel() {
    log_info "开始Vercel部署..."
    
    cd ""
    
    # 检查Git仓库
    if [ ! -d ".git" ]; then
        log_error "当前目录不是Git仓库！"
        log_info "请先初始化Git仓库："
        log_info "  git init"
        log_info "  git add ."
        log_info "  git commit -m 'Initial commit'"
        exit 1
    fi
    
    # 推送到GitHub
    log_info "推送代码到GitHub..."
    git add .
    git commit -m "Update deployment configuration [skip ci]"
    git push origin main
    
    if [ False -ne 0 ]; then
        log_error "Git推送失败！"
        exit 1
    fi
    
    log_info "代码已推送到GitHub"
    log_info "请在Vercel控制台手动部署，或等待CI/CD自动部署"
    
    log_success "Vercel部署准备完成"
}

# 主菜单
main_menu() {
    echo ""
    echo "🚀 蝶翅APP自动化部署脚本"
    echo "============================"
    echo ""
    echo "1. 📦 生产构建"
    echo "2. 👁️  本地预览"
    echo "3. 🐳  Docker部署"
    echo "4. ☁️  Vercel部署"
    echo "5. 🔄  一键完整部署"
    echo ""
    echo "0. ❌ 退出"
    echo ""
    
    read -p "请选择操作 (0-5): " choice
    
    case  in
        1) build_production && main_menu ;;
        2) preview_build && main_menu ;;
        3) deploy_docker && main_menu ;;
        4) deploy_vercel && main_menu ;;
        5)
            build_production
            preview_build
            deploy_docker
            deploy_vercel
            main_menu
            ;;
        0) exit 0 ;;
        *)
            log_error "无效选项！"
            main_menu
            ;;
    esac
}

# 检查环境并启动
check_environment
main_menu

