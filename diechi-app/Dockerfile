# 蝶翅APP Docker镜像构建文件
# 基于DeepSeek Harness插件化架构
# 多阶段构建，优化镜像大小

# ============================================
# Stage 1: 前端构建
# ============================================
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# 安装依赖
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

# 复制前端代码
COPY apps/web .

# 构建前端
RUN pnpm build

# ============================================
# Stage 2: 后端构建
# ============================================
FROM python:3.10-slim AS backend-builder

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 安装Python依赖
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY apps/api .

# ============================================
# Stage 3: 生产镜像
# ============================================
FROM python:3.10-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 复制构建产物
COPY --from=frontend-builder /app/dist ./apps/web/dist
COPY --from=backend-builder /app ./apps/api

# 创建必要目录
RUN mkdir -p apps/api/uploads apps/api/temp apps/api/static temp uploads

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    DEEPSEEK_API_KEY=your-deepseek-api-key \
    PORT=8000

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# ============================================
# 构建说明
# ============================================
# 构建镜像：docker build -t diechi-app .
# 运行容器：docker run -p 8000:8000 diechi-app
# 使用环境变量：docker run -p 8000:8000 -e DEEPSEEK_API_KEY=your-key diechi-app

# ============================================
# 优化说明
# ============================================
# - 使用多阶段构建，减少最终镜像大小
# - 使用Alpine和slim镜像，减少基础镜像大小
# - 清理apt缓存，减少镜像层大小
# - 使用--no-install-recommends减少安装包
# - 设置健康检查确保服务可用性
