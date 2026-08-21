# 蝶翅APP前端Docker镜像构建文件
# 基于React + TypeScript的插件化架构
# 多阶段构建，优化镜像大小和性能

# ============================================
# Stage 1: 依赖安装和构建
# ============================================
FROM node:18-alpine AS builder

# 安装pnpm
RUN npm install -g pnpm

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制前端代码
COPY apps/web .

# 构建前端
RUN pnpm build

# ============================================
# Stage 2: Nginx生产镜像
# ============================================
FROM nginx:alpine

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制Nginx配置
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost/ || exit 1

# ============================================
# 构建说明
# ============================================
# 构建镜像：
# docker build -t diechi-app-web -f apps/web/Dockerfile .
#
# 运行容器：
# docker run -p 80:80 --name diechi-web diechi-app-web
#
# 使用docker-compose：
# docker-compose -f docker-compose.prod.yml up -d

# ============================================
# Nginx配置说明
# ============================================
# nginx.conf已配置：
# - 静态文件服务
# - Gzip压缩
# - 缓存策略
# - CORS配置
# - 重定向配置

# ============================================
# 优化说明
# ============================================
# - 使用Alpine镜像，减少基础镜像大小
# - 多阶段构建，减少最终镜像大小
# - 使用pnpm加速依赖安装
# - 构建时优化React生产模式
# - Nginx提供高性能静态文件服务
# - Gzip压缩减少传输大小
# - 缓存策略提高加载速度

# ============================================
# 环境变量说明
# ============================================
# REACT_APP_API_URL: 后端API地址 (默认http://localhost:8000)
# NODE_ENV: 环境标识 (production/development)
# PORT: 服务端口 (默认80)

# ============================================
# 资源要求
# ============================================
# 最低配置：
# - CPU: 1核心
# - 内存: 256MB
# - 存储: 50MB (构建产物)

# ============================================
# 性能优化建议
# ============================================
# 1. 启用CDN：
#    将静态文件部署到CDN
#
# 2. 使用缓存：
#    设置浏览器缓存策略
#
# 3. 启用HTTPS：
#    配置SSL证书
#
# 4. 负载均衡：
#    使用多个前端实例

# ============================================
# 监控和日志
# ============================================
# - Nginx访问日志：/var/log/nginx/access.log
# - Nginx错误日志：/var/log/nginx/error.log
# - 前端错误日志：浏览器控制台
