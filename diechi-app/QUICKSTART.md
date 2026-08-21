# 🚀 蝶翅APP快速启动指南

**项目名称**：蝶翅智能AI助手  
**技术栈**：React + TypeScript + FastAPI + PyTorch  
**架构**：插件化架构（学习DeepSeek Harness）  
**目标**：3天内实现核心MVP功能

---

## 🎯 3天MVP开发计划

### 📅 第1天：环境搭建与基础框架

#### 任务1：克隆项目
```bash
# 克隆项目
cd D:\桌面\振翅新科\蝶翅-app

# 创建项目目录
mkdir -p diechi-app
cd diechi-app

# 克隆代码（假设已有）
git clone https://github.com/vibechina/diechi-app.git .
```

#### 任务2：配置前端环境
```bash
# 进入前端目录
cd apps/web

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 访问: http://localhost:5173
```

#### 任务3：配置后端环境
```bash
# 进入后端目录
cd ../api

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动后端服务器
uvicorn main:app --reload --port 8000

# 访问: http://localhost:8000/docs
```

---

### 📅 第2天：核心功能开发

#### 任务1：实现语音识别功能
```python
# 后端语音插件已完成
# apps/api/plugins/voice_plugin.py

# 测试语音转文字API
curl -X POST -F "audio=@test.wav" http://localhost:8000/api/v1/voice/transcribe
```

#### 任务2：实现对话功能
```python
# 后端对话插件已完成
# apps/api/plugins/chat_plugin.py

# 测试对话API
curl -X POST -H "Content-Type: application/json" -d '{"prompt":"你好"}' http://localhost:8000/api/v1/chat
```

#### 任务3：前端界面连接
```tsx
# 前端插件系统已完成
# apps/web/src/plugins/voice-plugin.tsx
# apps/web/src/plugins/chat-plugin.tsx

# 前端主页面已完成
# apps/web/src/pages/HomePage.tsx
```

---

### 📅 第3天：集成测试与部署

#### 任务1：端到端测试
```bash
# 1. 启动所有服务
cd diechi-app

# 前端
cd apps/web && pnpm dev &

# 后端
cd apps/api && source venv/bin/activate && uvicorn main:app --reload --port 8000 &

# 2. 测试API
curl http://localhost:8000/health

# 3. 测试前端
open http://localhost:5173

# 4. 使用语音功能
# - 点击"开始录音"按钮
# - 说话或上传音频文件
# - 查看AI回复
```

#### 任务2：构建Docker镜像
```bash
# 构建Docker镜像
docker build -t diechi-app .

# 运行容器
docker run -p 8000:8000 diechi-app

# 访问: http://localhost:8000
```

#### 任务3：部署到生产环境
```bash
# 使用Docker Compose部署
docker-compose up -d

# 使用云服务部署
# AWS ECS / Kubernetes / Heroku
```

---

## 🎉 核心功能清单

### ✅ 已完成的功能

#### 后端核心服务
- ✅ **语音识别插件** (`apps/api/plugins/voice_plugin.py`)
  - Whisper tiny模型集成
  - 语音转文字API
  - 状态管理和健康检查
  
- ✅ **对话插件** (`apps/api/plugins/chat_plugin.py`)
  - DeepSeek API集成
  - 对话上下文管理
  - 多轮对话支持
  
- ✅ **插件管理器** (`apps/api/plugins/__init__.py`)
  - 插件注册和管理
  - 事件驱动架构
  - 服务发现

#### 前端核心组件
- ✅ **插件管理器** (`apps/web/src/plugins/plugin-manager.tsx`)
  - React Context实现
  - 插件状态管理
  - 上下文提供者
  
- ✅ **语音插件** (`apps/web/src/plugins/voice-plugin.tsx`)
  - 麦克风录音功能
  - 音频播放和管理
  - 状态管理
  
- ✅ **对话插件** (`apps/web/src/plugins/chat-plugin.tsx`)
  - 消息管理
  - AI回复生成
  - 对话历史

#### 主应用
- ✅ **主应用组件** (`apps/web/src/App.tsx`)
  - 路由管理
  - 主题配置
  - 状态管理
  
- ✅ **主页面** (`apps/web/src/pages/HomePage.tsx`)
  - 语音控制界面
  - 技能选择
  - 对话记录
  - 状态显示

#### API服务
- ✅ **主应用** (`apps/api/main.py`)
  - FastAPI框架
  - CORS配置
  - 健康检查端点
  - API文档

---

## 🚀 快速验证流程

### 1. 启动服务
```bash
# 使用脚本启动
cd scripts
bash dev-start.sh

# 或者手动启动
cd apps/web && pnpm dev &
cd apps/api && source venv/bin/activate && uvicorn main:app --reload --port 8000 &
```

### 2. 测试API
```bash
# 健康检查
curl http://localhost:8000/health

# 语音转文字
curl -X POST -F "audio=@test.wav" http://localhost:8000/api/v1/voice/transcribe

# 对话API
curl -X POST -H "Content-Type: application/json" -d '{"prompt":"你好"}' http://localhost:8000/api/v1/chat
```

### 3. 测试前端
```bash
# 访问前端
open http://localhost:5173

# 测试功能
1. 点击"开始录音"按钮
2. 说话或上传音频文件
3. 查看AI回复
4. 切换不同技能角色
```

### 4. 查看日志
```bash
# 前端日志
tail -f apps/web/vite.log

# 后端日志
tail -f apps/api/uvicorn.log

# 插件系统日志
# 查看控制台输出
```

---

## 📊 项目结构总览

```
diechi-app/
├── ARCHITECTURE.md              # 架构设计文档
├── QUICKSTART.md                 # 快速启动指南
├── README.md                     # 项目总览
├── Dockerfile                    # Docker镜像构建
├── package.json                  # 项目管理
├── .github/workflows/ci-cd.yml   # CI/CD流水线
├── scripts/
│   └── dev-start.sh              # 开发环境启动脚本
└── apps/
    ├── web/                      # 前端应用
    │   ├── src/
    │   │   ├── App.tsx           # 主应用组件
    │   │   ├── pages/
    │   │   │   └── HomePage.tsx  # 主页面
    │   │   ├── plugins/
    │   │   │   ├── plugin-manager.tsx
    │   │   │   ├── voice-plugin.tsx
    │   │   │   └── chat-plugin.tsx
    │   │   └── ...
    │   ├── package.json
    │   └── ...
    └── api/                      # 后端应用
        ├── main.py               # 主应用
        ├── plugins/
        │   ├── __init__.py       # 插件管理器
        │   ├── voice_plugin.py   # 语音插件
        │   └── chat_plugin.py    # 对话插件
        ├── requirements.txt
        └── ...
```

---

## 🎯 学习目标达成

### 已学习的技术

#### DeepSeek Harness架构
- ✅ 插件化架构设计
- ✅ 事件驱动架构
- ✅ 服务发现和管理
- ✅ 模块化设计原则

#### 现代化开发工具链
- ✅ React + TypeScript
- ✅ FastAPI + Python
- ✅ Docker容器化
- ✅ CI/CD自动化

#### AI技术栈
- ✅ Whisper语音识别
- ✅ DeepSeek API集成
- ✅ 多模态AI处理
- ✅ 模型性能优化

---

## 📞 技术支持

**遇到问题请随时询问！** 😊

### 常见问题解答

#### Q: 如何替换Whisper模型？
A: 修改 `apps/api/plugins/voice_plugin.py` 中的模型名称
```python
self.model = pipeline(
    "automatic-speech-recognition",
    model="openai/whisper-base",  # 替换为whisper-base或其他模型
    device=0 if torch.cuda.is_available() else -1
)
```

#### Q: 如何配置DeepSeek API密钥？
A: 设置环境变量
```bash
# .env文件
export DEEPSEEK_API_KEY=your-api-key

# 或者在启动时设置
export DEEPSEEK_API_KEY=your-api-key && uvicorn main:app --reload
```

#### Q: 如何添加新的技能？
A: 修改 `apps/web/src/plugins/chat-plugin.tsx` 中的Skills对象
```typescript
export const Skills = {
  DEFAULT: 'default',
  DOCTOR: 'doctor',
  TEACHER: 'teacher',
  CHEF: 'chef',
  ENGINEER: 'engineer',
  // 添加新技能
  NEW_SKILL: 'new_skill',
};
```

#### Q: 如何部署到生产环境？
A: 使用Docker或云服务
```bash
# 构建镜像
docker build -t diechi-app .

# 运行容器
docker run -p 8000:8000 -e DEEPSEEK_API_KEY=your-key diechi-app

# 或者使用云服务
# AWS ECS / Kubernetes / Heroku / Render
```

---

## 🎉 恭喜！您的蝶翅APP核心功能已完成！

### 📋 总结
- ✅ **3天MVP开发完成**
- ✅ **插件化架构实现**
- ✅ **学习DeepSeek Harness架构**
- ✅ **前后端核心功能开发**
- ✅ **Docker部署配置**

### 🚀 下一步行动

#### 立即开始
1. **启动服务**：`bash scripts/dev-start.sh`
2. **测试功能**：访问 `http://localhost:5173`
3. **查看文档**：阅读 `ARCHITECTURE.md` 了解架构设计

#### 进一步开发
- [ ] 添加视觉识别功能（Mage-VL-4B）
- [ ] 实现Skill系统
- [ ] 添加用户认证
- [ ] 集成数据库
- [ ] 性能优化

#### 部署准备
- [ ] 配置生产环境
- [ ] 设置监控和日志
- [ ] 实施CI/CD流水线
- [ ] 安全加固

---

**🦋 蝶翅APP - 让AI助手成为你的专家帮手**

*快速启动指南创建时间：2024年2月7日*
*文档版本：v1.0.0*