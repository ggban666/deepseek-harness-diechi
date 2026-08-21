#!/bin/bash

# 蝶翅APP开发环境启动脚本
# 基于DeepSeek Harness插件化架构

echo "🚀 蝶翅APP开发环境启动..."
echo "=============================="

# 检查Node.js版本
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js v18+"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm未安装，请先安装pnpm"
    exit 1
fi

# 检查Python版本
if ! command -v python3 &> /dev/null; then
    echo "❌ Python未安装，请先安装Python 3.10+"
    exit 1
fi

# 创建必要的目录
mkdir -p apps/web/dist apps/api/uploads apps/api/temp apps/api/static

# 前端开发服务器
echo "📱 启动前端开发服务器..."
cd apps/web
pnpm install --frozen-lockfile
pnpm dev &
FRONTEND_PID=$!

# 后端开发服务器
echo "🐍 启动后端开发服务器..."
cd ../api
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# 等待服务启动
sleep 3

# 检查服务状态
echo ""
echo "📊 服务状态检查..."

# 检查前端服务
if curl -s http://localhost:5173 > /dev/null; then
    echo "✅ 前端服务运行正常: http://localhost:5173"
else
    echo "⚠️ 前端服务可能未正常启动"
fi

# 检查后端服务
if curl -s http://localhost:8000/health > /dev/null; then
    echo "✅ 后端服务运行正常: http://localhost:8000"
    echo "📖 API文档: http://localhost:8000/api/docs"
    echo "🏥 健康检查: http://localhost:8000/health"
else
    echo "⚠️ 后端服务可能未正常启动"
fi

echo ""
echo "🎉 蝶翅APP开发环境已启动！"
echo "=============================="
echo "📝 使用说明:"
echo "- 前端: http://localhost:5173"
echo "- 后端: http://localhost:8000"
echo "- API文档: http://localhost:8000/api/docs"
echo "- 健康检查: http://localhost:8000/health"
echo ""
echo "🔧 快捷操作:"
echo "- 停止所有服务: kill $FRONTEND_PID $BACKEND_PID"
echo "- 查看日志: tail -f apps/web/vite.log & tail -f apps/api/uvicorn.log"
echo "- 前端构建: cd apps/web && pnpm build"
echo "- 后端测试: cd apps/api && source venv/bin/activate && pytest"

echo ""
echo "📚 学习资源:"
echo "- DeepSeek Harness架构: https://github.com/deepseek-ai/deepseek-harness"
echo "- 插件化开发: https://github.com/deepseek-ai/cordis"
echo "- FastAPI文档: https://fastapi.tiangolo.com/"
echo "- React + TypeScript: https://react.dev/learn/typescript"
