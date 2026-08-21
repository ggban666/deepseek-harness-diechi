# 蝶翅APP Docker镜像构建文件
# 基于Node.js 24，用于生产环境部署
# 构建阶段
FROM node:24-alpine AS builder

WORKDIR /app

# 安装依赖
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制项目文件
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建生产版本
RUN pnpm --filter @diechi/web run build

# 生产阶段
FROM node:24-alpine AS production

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/apps/web/dist ./dist

# 复制必要的配置文件
COPY apps/web/package.json ./package.json

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 启动应用
CMD ["node", "dist/assets/index.js"]
