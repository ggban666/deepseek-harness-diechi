# 蝶翅APP后端Docker镜像构建文件
# 基于DeepSeek Harness插件化架构
# 多阶段构建，优化镜像大小和性能

# ============================================
# Stage 1: 依赖安装和构建
# ============================================
FROM python:3.10-slim AS builder

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY apps/api/requirements.txt .
COPY apps/api/requirements-dev.txt .

# 安装Python依赖
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-dev.txt

# 复制整个后端代码
COPY apps/api .

# 创建必要目录
RUN mkdir -p uploads temp static

# ============================================
# Stage 2: 生产镜像
# ============================================
FROM python:3.10-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制构建产物
COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /app .

# 创建必要目录
RUN mkdir -p uploads temp static

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    DEEPSEEK_API_KEY=your-deepseek-api-key \
    PORT=8000 \
    MODEL_CACHE_DIR=/app/models \
    LOG_LEVEL=INFO

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

# ============================================
# 构建说明
# ============================================
# 构建镜像：
# docker build -t diechi-app-api -f apps/api/Dockerfile .
# 
# 运行容器：
# docker run -p 8000:8000 \
#   -e DEEPSEEK_API_KEY=your-api-key \
#   -e ENVIRONMENT=production \
#   --name diechi-api \
#   diechi-app-api
#
# 使用docker-compose：
# docker-compose -f docker-compose.prod.yml up -d

# ============================================
# 优化说明
# ============================================
# - 使用多阶段构建，减少最终镜像大小
# - 使用slim镜像，减少基础镜像大小
# - 清理apt缓存，减少镜像层大小
# - 使用--no-install-recommends减少安装包
# - 设置健康检查确保服务可用性
# - 使用4个worker处理并发请求
# - 环境变量配置生产环境参数

# ============================================
# 环境变量说明
# ============================================
# DEEPSEEK_API_KEY: DeepSeek API密钥 (必需)
# ENVIRONMENT: 生产环境标识 (production/staging/development)
# PORT: 服务端口 (默认8000)
# MODEL_CACHE_DIR: 模型缓存目录 (默认/app/models)
# LOG_LEVEL: 日志级别 (DEBUG/INFO/WARNING/ERROR)

# ============================================
# 资源要求
# ============================================
# 最低配置：
# - CPU: 2核心
# - 内存: 4GB
# - 存储: 10GB (包含模型文件)
# - GPU: 可选 (支持CUDA加速)

# ============================================
# 性能优化建议
# ============================================
# 1. 使用GPU加速：
#    docker run --gpus all -p 8000:8000 diechi-app-api
#
# 2. 增加worker数量：
#    CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "8"]
#
# 3. 启用缓存：
#    设置REDIS_URL环境变量
#
# 4. 数据库连接：
#    设置DATABASE_URL环境变量
