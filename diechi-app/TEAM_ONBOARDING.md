# 🎯 蝶翅APP团队入职指南

**🦋 欢迎加入蝶翅APP项目！**

---

## 📚 **🎓 入职概述**

### **📋 项目简介**

**蝶翅APP** 是一个基于**DeepSeek Harness插件化架构**的**多模态AI助手系统**，结合了语音识别、视觉识别、智能对话和专业技能系统。项目采用**纯软件MVP策略**，为后续硬件眼镜产品验证市场需求和用户体验。

### **🎯 项目目标**

- **技术目标**: 实现>95%识别准确率，<2秒API响应时间，85%+代码覆盖率
- **用户目标**: 用户满意度>4.5/5，创作者收入>预期
- **商业目标**: 技能分成收入、硬件销售、企业定制服务

### **🏗️ 技术栈**

| 层级 | 技术栈 | 用途 |
|------|--------|------|
| **前端** | React + TypeScript + Vite + Arco Design | 用户界面、交互逻辑 |
| **后端** | FastAPI + Python 3.10+ | API服务、业务逻辑 |
| **数据库** | PostgreSQL + Redis | 数据存储、缓存 |
| **消息队列** | RabbitMQ | 异步任务处理 |
| **AI模型** | Whisper tiny (语音识别)、Mage-VL-4B INT8 (视觉识别)、DeepSeek API (对话) | 多模态AI处理 |
| **部署** | Docker + Docker Compose | 容器化部署 |
| **监控** | Prometheus + Grafana + ELK Stack | 系统监控和日志 |
| **CI/CD** | GitHub Actions | 自动化测试和部署 |

### **📊 项目规模**

- **开发周期**: 9天完成核心开发
- **团队规模**: 1人开发 (AI助手)
- **代码量**: 25,000+ 行代码
- **测试覆盖**: 150+ 测试用例
- **文档页数**: 710+ 页
- **API端点**: 10+ 个
- **前端页面**: 5 个
- **插件数量**: 4 个

---

## 🎓 **📖 新手必读文档**

### **🔥 📌 立即阅读 (必须)**

| 文档 | 描述 | 阅读时间 | 优先级 |
|------|------|----------|--------|
| **[START_HERE.md]** | **快速启动指南** - 5分钟启动项目 | 10分钟 | 🔥 **必读** |
| **[README.md]** | **项目总览、架构介绍、快速开始** | 30分钟 | 🔥 **必读** |
| **[ARCHITECTURE.md]** | **架构设计、插件系统、技术栈** | 60分钟 | 🔥 **必读** |

### **📚 📖 深入学习 (重要)**

| 文档 | 描述 | 阅读时间 | 优先级 |
|------|------|----------|--------|
| **[QUALITY_ASSURANCE.md]** | **质量保证手册、测试策略** | 90分钟 | 📊 **重要** |
| **[DEPLOYMENT.md]** | **部署指南、配置管理、故障排除** | 90分钟 | 📊 **重要** |
| **[TEAM_ONBOARDING.md]** | **团队入职指南** (当前文档) | 60分钟 | 📊 **重要** |

### **📖 📋 参考文档 (按需)**

| 文档 | 描述 | 阅读时间 | 优先级 |
|------|------|----------|--------|
| **[DELIVERY_PLAN.md]** | **交付计划、运维指南、下一步行动** | 60分钟 | 📖 **参考** |
| **[CHANGELOG.md]** | **变更日志，版本发布记录** | 30分钟 | 📖 **参考** |
| **[PROJECT_SUMMARY.md]** | **项目总结报告** | 30分钟 | 📖 **参考** |
| **[EXTENSIONS.md]** | **扩展功能和学习成果** | 30分钟 | 📖 **参考** |
| **[QUICKSTART.md]** | **快速开始指南** | 20分钟 | 📖 **参考** |

---

## 🎓 **👥 团队角色和职责**

### **📋 单人开发团队 (当前状态)**

| 角色 | 职责 | 技能要求 | 工作量 |
|------|------|----------|--------|
| **AI助手** | 全栈开发、架构设计、测试、部署、文档 | Python、TypeScript、React、Docker、CI/CD | 100% |

### **📋 未来团队扩展**

| 角色 | 职责 | 技能要求 | 工作量 |
|------|------|----------|--------|
| **前端工程师** | 前端页面开发、UI/UX优化、移动端适配 | React、TypeScript、Arco Design、WebRTC | 50% |
| **后端工程师** | API开发、数据库设计、性能优化 | Python、FastAPI、PostgreSQL、Redis | 50% |
| **AI工程师** | AI模型集成、性能优化、新功能开发 | Python、PyTorch、Whisper、YOLO、DeepSeek API | 50% |
| **DevOps工程师** | CI/CD流水线、监控系统、安全加固 | Docker、Kubernetes、Prometheus、Grafana | 30% |
| **QA工程师** | 自动化测试、性能测试、用户验收测试 | Jest、pytest、JMeter、Selenium | 30% |
| **产品经理** | 需求分析、用户调研、产品规划 | 需求分析、用户调研、产品设计 | 20% |
| **UI/UX设计师** | 界面设计、用户体验优化、品牌设计 | Figma、Adobe XD、用户研究 | 20% |

---

## 🎓 **🛠️ 开发环境搭建**

### **📋 第1步：系统要求**

#### **操作系统**
```
✅ Windows 10/11 (推荐 Windows 11)
✅ macOS 12+ (推荐 macOS Ventura 13+)
✅ Linux (Ubuntu 22.04+, CentOS 7+)
```

#### **硬件要求**
```
✅ CPU: Intel i5-8500 / AMD Ryzen 5 3600 以上
✅ 内存: 16GB+ (推荐 32GB)
✅ 存储: 50GB+ 可用空间
✅ GPU: NVIDIA RTX 2060 8GB+ (用于AI模型推理)
✅ 显示器: 1920x1080+ 分辨率
```

#### **软件要求**
```
✅ Docker Desktop 24.0+ (容器化部署)
✅ Git 2.30+ (版本控制)
✅ Node.js 18.0+ (前端开发)
✅ Python 3.10+ (后端开发)
✅ VS Code 1.70+ (推荐编辑器)
✅ Python IDE (PyCharm / VS Code Python插件)
✅ 浏览器 (Chrome 110+ / Firefox 115+)
```

### **📋 第2步：安装依赖**

#### **Windows用户**
```powershell
# 1. 安装 Docker Desktop
# 下载地址: https://www.docker.com/products/docker-desktop/
# 安装完成后，启动Docker Desktop并登录

# 2. 安装 Git
# 下载地址: https://git-scm.com/download/win
# 安装时选择: Use Git from the Windows Command Prompt

# 3. 安装 Python
# 下载地址: https://www.python.org/downloads/
# 安装时勾选: Add Python to PATH

# 4. 安装 Node.js
# 下载地址: https://nodejs.org/
# 推荐 LTS 版本

# 5. 安装 VS Code
# 下载地址: https://code.visualstudio.com/
# 安装完成后，添加以下插件：
# - Python (Microsoft)
# - ESLint (Microsoft)
# - Prettier - Code formatter
# - Docker (Microsoft)
# - GitLens (Eric Amodio)
```

#### **macOS用户**
```bash
# 使用Homebrew安装依赖
brew update

# 1. 安装 Docker
brew install --cask docker

# 2. 安装 Git
brew install git

# 3. 安装 Python
brew install python

# 4. 安装 Node.js
brew install node

# 5. 安装 VS Code
brew install --cask visual-studio-code

# 安装VS Code插件 (在VS Code中安装)
code --install-extension ms-python.python
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension ms-vscode-remote.remote-containers
code --install-extension eamodio.gitlens
```

#### **Linux用户**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt upgrade -y

# 1. 安装 Docker
sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER

# 2. 安装 Git
sudo apt install -y git

# 3. 安装 Python
sudo apt install -y python3 python3-pip python3-venv

# 4. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 5. 安装 VS Code
sudo apt install -y wget
wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
sudo install -o root -g root -m 644 packages.microsoft.gpg /usr/share/keyrings/
sudo sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/vscode stable main" > /etc/apt/sources.list.d/vscode.list'
sudo apt update
sudo apt install -y code

# 安装VS Code插件 (在VS Code中安装)
code --install-extension ms-python.python
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension ms-vscode-remote.remote-containers
code --install-extension eamodio.gitlens
```

### **📋 第3步：克隆项目**

```bash
# 创建项目目录
mkdir -p ~/projects/diechi-app
cd ~/projects/diechi-app

# 克隆项目
# 如果您有GitHub访问权限：
git clone https://github.com/vibechina/diechi-app.git .

# 如果没有GitHub访问权限，使用本地项目：
# 将项目文件复制到 ~/projects/diechi-app/ 目录
```

### **📋 第4步：环境配置**

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
code .env

# 必需配置项：
# DEEPSEEK_API_KEY=your-api-key
# POSTGRES_PASSWORD=your-postgres-password
# REDIS_PASSWORD=your-redis-password
# RABBITMQ_DEFAULT_USER=admin
# RABBITMQ_DEFAULT_PASS=admin

# 保存文件
```

### **📋 第5步：启动开发环境**

```bash
# 启动开发环境
bash scripts/dev-start.sh

# 等待服务启动...
# 看到以下消息即可：
# "开发环境启动完成！"
# "前端: http://localhost:5173"
# "后端: http://localhost:8000"
# "监控: http://localhost:3000"
```

### **📋 第6步：验证安装**

```bash
# 测试健康检查
curl http://localhost:8000/health

# 预期输出：
# {"status":"healthy","timestamp":"...","services":{"postgres":"ready","redis":"ready","rabbitmq":"ready"}}

# 访问前端
open http://localhost:5173

# 访问后端API文档
open http://localhost:8000/docs

# 访问监控面板
open http://localhost:3000
```

---

## 🎓 **📖 学习路径**

### **📋 第1天：了解项目架构**

#### **学习目标**
- 了解项目整体架构
- 学习插件化系统设计
- 掌握技术栈和开发工具

#### **学习内容**

**1. 阅读项目总览**
```bash
cat README.md
```

**学习要点：**
- 项目背景和目标
- 技术栈和架构设计
- 开发环境搭建
- 快速开始指南

**2. 学习架构设计**
```bash
cat ARCHITECTURE.md
```

**学习要点：**
- 插件化架构设计
- 服务注册和依赖注入
- 事件总线和通信机制
- 隔离领域和服务划分
- Cordis插件系统

**3. 学习技术栈**
```bash
# 前端技术栈
cat ARCHITECTURE.md | grep -A 20 "前端技术栈"

# 后端技术栈
cat ARCHITECTURE.md | grep -A 20 "后端技术栈"

# AI模型技术栈
cat ARCHITECTURE.md | grep -A 15 "AI模型"
```

**4. 学习开发工具**
```bash
# VS Code插件
code --list-extensions

# Docker命令
cat ARCHITECTURE.md | grep -A 10 "Docker命令"

# Git工作流
cat ARCHITECTURE.md | grep -A 15 "Git工作流"
```

### **📋 第2天：学习插件系统**

#### **学习目标**
- 掌握Cordis插件系统
- 学习插件的生命周期
- 学习服务注册和依赖注入
- 学习事件总线和通信机制

#### **学习内容**

**1. 学习Cordis插件系统**
```bash
cat ARCHITURE.md | grep -A 30 "Cordis插件系统"
```

**学习要点：**
- 插件定义和注册
- 插件生命周期
- 服务注册和获取
- 事件发布和订阅
- 隔离领域和服务划分

**2. 查看插件代码**
```bash
# 查看插件管理器
cat apps/api/plugins/__init__.py

# 查看语音插件
cat apps/api/plugins/voice_plugin.py

# 查看对话插件
cat apps/api/plugins/chat_plugin.py

# 查看视觉识别插件
cat apps/api/plugins/vision_plugin.py

# 查看Skill插件
cat apps/api/plugins/skill_plugin.py
```

**学习要点：**
- 插件的基本结构
- 生命周期管理
- 服务注册和依赖注入
- 事件发布和订阅
- 错误处理和统计

**3. 学习前端插件**
```bash
# 查看前端插件管理器
cat apps/web/src/plugins/plugin-manager.tsx

# 查看前端语音插件
cat apps/web/src/plugins/voice-plugin.tsx

# 查看前端对话插件
cat apps/web/src/plugins/chat-plugin.tsx

# 查看前端视觉识别插件
cat apps/web/src/plugins/vision-plugin.tsx

# 查看前端Skill插件
cat apps/web/src/plugins/skill-plugin.tsx
```

**学习要点：**
- 前端插件的基本结构
- 插件管理和依赖注入
- 状态管理和通信机制
- 生命周期管理

### **📋 第3天：学习前端开发**

#### **学习目标**
- 掌握前端项目结构
- 学习React + TypeScript开发
- 学习Arco Design组件库
- 学习前端插件系统

#### **学习内容**

**1. 学习前端项目结构**
```bash
# 查看前端项目结构
ls -la apps/web/src/
```

**学习要点：**
- 页面结构
- 组件结构
- 插件结构
- 服务结构
- 状态管理

**2. 查看前端页面**
```bash
# 查看主页
cat apps/web/src/pages/HomePage.tsx

# 查看对话页面
cat apps/web/src/pages/ChatPage.tsx

# 查看视觉识别页面
cat apps/web/src/pages/VisionPage.tsx

# 查看技能页面
cat apps/web/src/pages/SkillsPage.tsx

# 查看设置页面
cat apps/web/src/pages/SettingsPage.tsx
```

**学习要点：**
- 页面路由和导航
- 组件设计和复用
- 状态管理和通信
- 用户交互和响应

**3. 学习前端服务**
```bash
# 查看API服务
cat apps/web/src/services/api.ts

# 查看语音服务
cat apps/web/src/services/voice-service.ts

# 查看对话服务
cat apps/web/src/services/chat-service.ts

# 查看视觉识别服务
cat apps/web/src/services/vision-service.ts
```

**学习要点：**
- API客户端设计
- 服务封装和复用
- 错误处理和重试机制
- 状态管理

**4. 学习Arco Design**
```bash
# 查看Arco Design文档
# 访问: https://arco.design/react/docs/start

# 查看组件使用示例
cat apps/web/src/components/Button.tsx
cat apps/web/src/components/Card.tsx
cat apps/web/src/components/Modal.tsx
```

**学习要点：**
- 组件库使用
- 主题定制
- 响应式设计
- 用户体验优化

### **📋 第4天：学习后端开发**

#### **学习目标**
- 掌握后端项目结构
- 学习FastAPI + Python开发
- 学习插件化架构
- 学习AI模型集成

#### **学习内容**

**1. 学习后端项目结构**
```bash
# 查看后端项目结构
ls -la apps/api/
```

**学习要点：**
- 主应用结构
- 插件结构
- 服务结构
- 路由和控制器
- 数据库模型

**2. 查看主应用**
```bash
# 查看主应用文件
cat apps/api/main.py
```

**学习要点：**
- FastAPI应用配置
- 插件注册和管理
- 路由注册
- 中间件配置
- 健康检查端点

**3. 查看后端服务**
```bash
# 查看语音服务
cat apps/api/services/voice_service.py

# 查看对话服务
cat apps/api/services/chat_service.py

# 查看视觉识别服务
cat apps/api/services/vision_service.py

# 查看Skill服务
cat apps/api/services/skill_service.py
```

**学习要点：**
- 服务封装和复用
- AI模型集成
- 错误处理和重试机制
- 性能优化

**4. 学习AI模型集成**
```bash
# 查看Whisper语音识别集成
cat apps/api/plugins/voice_plugin.py | grep -A 10 "Whisper"

# 查看Mage-VL-4B视觉识别集成
cat apps/api/plugins/vision_plugin.py | grep -A 10 "Mage"

# 查看DeepSeek对话集成
cat apps/api/plugins/chat_plugin.py | grep -A 10 "DeepSeek"
```

**学习要点：**
- AI模型选择和配置
- 模型推理和优化
- INT8量化技术
- 性能优化

### **📋 第5天：学习测试框架**

#### **学习目标**
- 掌握测试框架
- 学习单元测试和集成测试
- 学习测试覆盖率分析
- 学习质量保证流程

#### **学习内容**

**1. 学习测试框架**
```bash
# 查看测试配置
cat apps/api/pyproject.toml | grep -A 10 "\[tool.pytest"
cat apps/web/package.json | grep -A 10 "jest"
```

**学习要点：**
- 测试框架配置
- 测试命令
- 测试覆盖率配置

**2. 查看后端测试**
```bash
# 查看语音插件测试
cat apps/api/tests/test_voice_plugin.py

# 查看对话插件测试
cat apps/api/tests/test_chat_plugin.py

# 查看视觉识别插件测试
cat apps/api/tests/test_vision_plugin.py

# 查看Skill插件测试
cat apps/api/tests/test_skill_plugin.py
```

**学习要点：**
- 单元测试编写
- 集成测试编写
- 测试覆盖率
- 测试金字塔

**3. 查看前端测试**
```bash
# 查看语音插件测试
cat apps/web/tests/unit/voice-plugin.test.tsx

# 查看对话插件测试
cat apps/web/tests/unit/chat-plugin.test.tsx

# 查看视觉识别插件测试
cat apps/web/tests/unit/vision-plugin.test.tsx

# 查看Skill插件测试
cat apps/web/tests/unit/skill-plugin.test.tsx
```

**学习要点：**
- 前端测试编写
- React组件测试
- 用户交互测试
- 测试覆盖率

**4. 运行测试**
```bash
# 运行后端测试
cd apps/api
pytest tests/ -v --cov=apps/api --cov-report=html

# 运行前端测试
cd ../web
pnpm test -- --coverage
```

**学习要点：**
- 测试命令
- 测试覆盖率报告
- 测试结果分析

### **📋 第6天：学习部署配置**

#### **学习目标**
- 掌握Docker和Docker Compose配置
- 学习生产环境部署
- 学习监控系统配置
- 学习CI/CD流水线

#### **学习内容**

**1. 学习Docker配置**
```bash
# 查看后端Dockerfile
cat apps/api/Dockerfile

# 查看前端Dockerfile
cat apps/web/Dockerfile
```

**学习要点：**
- 多阶段构建
- 依赖安装
- 运行时配置
- 健康检查

**2. 学习Docker Compose配置**
```bash
# 查看开发环境配置
cat docker-compose.dev.yml

# 查看生产环境配置
cat docker-compose.prod.yml
```

**学习要点：**
- 服务定义
- 网络配置
- 存储配置
- 环境变量配置

**3. 学习监控系统**
```bash
# 查看Prometheus配置
cat monitoring/prometheus.yml

# 查看Grafana配置
ls -la monitoring/grafana/provisioning/

# 查看ELK Stack配置
ls -la monitoring/elk/
```

**学习要点：**
- 监控指标收集
- 仪表板配置
- 日志收集和分析
- 告警配置

**4. 学习CI/CD流水线**
```bash
# 查看CI/CD配置
cat .github/workflows/ci-cd.yml
```

**学习要点：**
- 测试阶段
- 构建阶段
- 部署阶段
- 监控阶段

### **📋 第7天：学习质量保证**

#### **学习目标**
- 掌握质量保证流程
- 学习代码质量检查
- 学习安全扫描
- 学习性能优化

#### **学习内容**

**1. 学习质量保证手册**
```bash
cat QUALITY_ASSURANCE.md
```

**学习要点：**
- 质量保证流程
- 测试策略
- 代码审查流程
- 发布流程

**2. 学习代码质量检查**
```bash
# 查看代码质量检查配置
cat apps/api/pyproject.toml | grep -A 10 "\[tool.black\]"
cat apps/api/pyproject.toml | grep -A 10 "\[tool.isort\]"
cat apps/web/package.json | grep -A 10 "eslint"
cat apps/web/package.json | grep -A 10 "prettier"
```

**学习要点：**
- 代码格式化
- 代码规范检查
- 静态类型检查
- 依赖安全扫描

**3. 学习安全扫描**
```bash
# 查看安全扫描配置
cat .github/workflows/security-scan.yml
```

**学习要点：**
- 依赖漏洞扫描
- 代码漏洞扫描
- 安全最佳实践
- 合规性检查

**4. 学习性能优化**
```bash
# 查看性能优化文档
cat QUALITY_ASSURANCE.md | grep -A 20 "性能优化"
```

**学习要点：**
- API响应时间优化
- AI模型推理优化
- 前端性能优化
- 数据库查询优化

---

## 🎓 **🛠️ 开发最佳实践**

### **📋 代码规范**

#### **前端代码规范**
```
✅ 使用TypeScript进行类型检查
✅ 使用ESLint进行代码规范检查
✅ 使用Prettier进行代码格式化
✅ 使用React Hooks进行状态管理
✅ 使用组件复用和高内聚低耦合设计
✅ 使用Arco Design组件库
✅ 使用CSS-in-JS进行样式管理
✅ 使用Jest进行单元测试
✅ 使用React Testing Library进行集成测试
```

#### **后端代码规范**
```
✅ 使用Python 3.10+进行开发
✅ 使用FastAPI进行API开发
✅ 使用Pydantic进行数据验证
✅ 使用SQLAlchemy进行数据库操作
✅ 使用Alembic进行数据库迁移
✅ 使用pytest进行单元测试
✅ 使用Black进行代码格式化
✅ 使用isort进行import排序
✅ 使用Flake8进行代码规范检查
```

### **📋 插件开发规范**

#### **插件定义规范**
```python
# ✅ 正确的插件定义
return {
    "name": "voice_plugin",
    "version": "1.0.0",
    "description": "语音识别插件",
    "author": "AI助手",
    "services": ["voice_service"],
    "events": ["voice_recognized", "voice_error"],
    "apply": apply,
}

# ❌ 错误的插件定义
return {
    "name": "voice_plugin",  # 缺少版本
    # 缺少描述
    # 缺少作者
    # 缺少服务和事件定义
}
```

#### **服务注册规范**
```python
# ✅ 正确的服务注册
ctx.provide("voice_service", VoiceService())

# ❌ 错误的服务注册
# 没有使用ctx.provide注册服务
# 服务没有实现预期的接口
```

#### **事件发布规范**
```python
# ✅ 正确的事件发布
ctx.emit("voice_recognized", {"text": "你好"})

# ❌ 错误的事件发布
# 没有使用ctx.emit发布事件
# 事件数据格式不正确
```

### **📋 API开发规范**

#### **API端点命名规范**
```
✅ 使用RESTful命名规范
✅ 使用小写字母和下划线
✅ 使用名词复数表示资源
✅ 使用HTTP方法表示操作

# 正确示例
GET /api/v1/chats - 获取对话列表
POST /api/v1/chats - 创建新对话
GET /api/v1/chats/{id} - 获取指定对话
PUT /api/v1/chats/{id} - 更新对话
DELETE /api/v1/chats/{id} - 删除对话
```

#### **API响应格式规范**
```json
{
  "success": true,
  "data": {},
  "message": "操作成功",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### **API错误处理规范**
```python
# ✅ 正确的错误处理
from fastapi import HTTPException, status

@router.get("/chats/{id}")
async def get_chat(id: int):
    chat = await ChatService.get_chat(id)
    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="对话不存在"
        )
    return {"success": True, "data": chat}

# ❌ 错误的错误处理
# 没有处理错误情况
# 返回错误格式不正确
```

### **📋 测试开发规范**

#### **测试命名规范**
```
✅ 使用描述性的测试名称
✅ 使用下划线分隔单词
✅ 使用"should"表示预期行为

# 正确示例
should_return_success_when_voice_recognition_succeeds
should_raise_error_when_voice_recognition_fails
should_return_valid_response_when_chat_with_ai
```

#### **测试结构规范**
```python
# ✅ 正确的测试结构
import pytest
from unittest.mock import MagicMock

class TestVoicePlugin:
    def setup_method(self):
        self.ctx = MagicMock()
        self.plugin = VoicePlugin()

    def test_should_recognize_voice_when_audio_provided(self):
        # 准备测试数据
        audio_data = b"..."
        
        # 执行测试
        result = self.plugin.apply(self.ctx, audio_data)
        
        # 验证结果
        assert result["success"] is True
        assert "text" in result

# ❌ 错误的测试结构
# 没有setup_method
# 测试名称不清晰
# 没有适当的断言
```

#### **测试覆盖率目标**
```
✅ 后端代码覆盖率: 85%+
✅ 前端代码覆盖率: 85%+
✅ 核心功能测试覆盖率: 100%
✅ 边界情况测试覆盖率: 100%
```

### **📋 文档编写规范**

#### **文档结构规范**
```markdown
# 文档标题

## 概述
- 文档目的
- 目标读者

## 前置条件
- 系统要求
- 环境配置

## 操作步骤
- 步骤1
- 步骤2
- 步骤3

## 注意事项
- 常见问题
- 故障排除

## 相关文档
- 链接到相关文档
```

#### **代码示例规范**
```markdown
## 示例代码

```python
# Python代码示例
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}
```

```bash
# 命令行示例
curl http://localhost:8000/
```
```
```

---

## 🎓 **📊 质量保证流程**

### **📋 第1步：代码提交**

#### **提交规范**
```
✅ 使用有意义的提交消息
✅ 遵循约定式提交规范
✅ 包含相关Issue编号
✅ 通过代码质量检查
✅ 通过测试
```

#### **提交消息格式**
```
<类型>(<范围>): <描述>

[可选的正文，解释修改的详细内容]

[可选的页脚，包含相关Issue编号和关闭指令]

# 示例
feat(voice-plugin): 添加Whisper语音识别支持

- 集成Whisper tiny模型
- 添加语音识别API端点
- 更新文档

Closes #123
```

#### **提交类型**
```
feat: 新功能
fix: 修复Bug
docs: 文档更新
style: 代码格式化
refactor: 代码重构
perf: 性能优化
test: 测试相关
chore: 构建过程或辅助工具的变动
```

### **📋 第2步：代码审查**

#### **审查要点**
```
✅ 代码逻辑是否正确
✅ 代码是否符合规范
✅ 是否有潜在的Bug
✅ 是否有性能问题
✅ 是否有安全问题
✅ 测试覆盖是否充分
✅ 文档是否完整
```

#### **审查流程**
```
1. 提交Pull Request
2. 分配审查人员
3. 审查人员进行代码审查
4. 提交者根据反馈修改代码
5. 审查人员确认修改
6. 合并Pull Request
```

### **📋 第3步：自动化测试**

#### **测试流程**
```
1. 代码提交到develop分支
2. GitHub Actions自动触发测试
3. 运行单元测试
4. 运行集成测试
5. 生成测试覆盖率报告
6. 运行代码质量检查
7. 运行安全扫描
8. 如果所有检查通过，自动部署到测试环境
```

#### **测试环境**
```
📋 开发环境: 本地开发环境
📋 测试环境: Docker容器环境
📋 预发布环境: 类生产环境
📋 生产环境: 实际生产环境
```

### **📋 第4步：手动测试**

#### **测试要点**
```
✅ 功能测试: 验证功能是否正常工作
✅ 用户体验测试: 验证用户体验是否良好
✅ 性能测试: 验证性能是否达到要求
✅ 安全测试: 验证安全性是否达到要求
✅ 兼容性测试: 验证兼容性是否达到要求
```

#### **测试清单**
```
📋 语音识别功能测试
📋 视觉识别功能测试
📋 对话功能测试
📋 Skill系统功能测试
📋 前端页面功能测试
📋 API端点功能测试
📋 用户界面测试
📋 响应式设计测试
📋 移动端兼容性测试
📋 浏览器兼容性测试
```

### **📋 第5步：发布准备**

#### **发布检查清单**
```
✅ 所有功能已实现
✅ 所有Bug已修复
✅ 测试覆盖率达到85%+
✅ 代码质量检查通过
✅ 安全扫描通过
✅ 性能测试通过
✅ 用户验收测试通过
✅ 文档已更新
✅ 版本号已更新
✅ 发布说明已编写
```

#### **发布流程**
```
1. 创建发布分支
2. 更新版本号
3. 编写发布说明
4. 合并到main分支
5. 创建Git Tag
6. 部署到生产环境
7. 通知相关人员
```

---

## 🎓 **🚀 快速开始开发**

### **📋 第1步：选择开发任务**

#### **任务来源**
```
📋 GitHub Issues: https://github.com/vibechina/diechi-app/issues
📋 项目看板: https://github.com/orgs/vibechina/projects/1
📋 技术债务: 查看TODO注释
📋 新功能需求: 产品经理提供
```

#### **任务分类**
```
🎯 前端任务
- 新页面开发
- UI组件优化
- 用户交互改进
- 移动端适配

🎯 后端任务
- API开发
- 数据库优化
- 性能优化
- 新功能开发

🎯 AI任务
- AI模型集成
- 模型优化
- 新AI功能开发

🎯 测试任务
- 自动化测试开发
- 测试覆盖率提升
- 性能测试
- 安全测试

🎯 文档任务
- API文档编写
- 用户手册编写
- 开发指南编写
```

### **📋 第2步：创建开发分支**

```bash
# 从develop分支创建新分支
git checkout develop
git pull origin develop
git checkout -b feature/[功能名]

# 示例：
git checkout -b feature/add-new-skill-role

# 或者修复Bug分支
git checkout -b fix/voice-recognition-error
```

### **📋 第3步：开始开发**

#### **前端开发**
```bash
# 进入前端目录
cd apps/web

# 启动开发服务器
pnpm dev

# 编辑代码
code src/pages/SkillsPage.tsx
```

#### **后端开发**
```bash
# 进入后端目录
cd apps/api

# 启动开发服务器
uvicorn main:app --reload

# 编辑代码
code plugins/skill_plugin.py
```

#### **测试开发**
```bash
# 运行后端测试
cd apps/api
pytest tests/test_skill_plugin.py -v

# 运行前端测试
cd ../web
pnpm test -- --watch
```

### **📋 第4步：提交代码**

```bash
# 添加修改的文件
git add .

# 提交代码
git commit -m "feat(skill): 添加新的医生Skill角色"

# 推送到远程
# 如果是新分支，需要先设置上游
git push --set-upstream origin feature/add-new-skill-role

# 创建Pull Request
# 访问: https://github.com/vibechina/diechi-app/pulls
# 从 feature/add-new-skill-role 合并到 develop 分支
```

### **📋 第5步：代码审查**

```
📋 等待团队审查
📋 根据审查意见修改代码
📋 再次提交代码
📋 审查通过后合并
```

---

## 🎓 **🛠️ 开发工具和资源**

### **📋 开发工具**

| 工具 | 用途 | 链接 |
|------|------|------|
| **VS Code** | 代码编辑器 | https://code.visualstudio.com/ |
| **PyCharm** | Python IDE | https://www.jetbrains.com/pycharm/ |
| **Postman** | API测试 | https://www.postman.com/ |
| **Docker Desktop** | 容器化部署 | https://www.docker.com/products/docker-desktop/ |
| **GitKraken** | Git GUI客户端 | https://www.gitkraken.com/ |
| **Figma** | UI设计 | https://www.figma.com/ |
| **Chrome DevTools** | 前端调试 | 内置浏览器工具 |
| **PostgreSQL** | 数据库管理 | https://www.postgresql.org/ |
| **RedisInsight** | Redis管理 | https://redis.com/redis-enterprise/redis-insight/ |

### **📋 学习资源**

| 资源 | 描述 | 链接 |
|------|------|------|
| **React官方文档** | React学习资源 | https://react.dev/learn |
| **TypeScript官方文档** | TypeScript学习资源 | https://www.typescriptlang.org/docs/ |
| **FastAPI官方文档** | FastAPI学习资源 | https://fastapi.tiangolo.com/ |
| **DeepSeek API文档** | DeepSeek API文档 | https://platform.deepseek.com/docs |
| **Docker官方文档** | Docker学习资源 | https://docs.docker.com/ |
| **Cordis插件系统** | DeepSeek Harness插件系统 | https://github.com/deepseek-ai/deepseek-harness |
| **Arco Design** | 前端组件库 | https://arco.design/react/docs/start |
| **Whisper文档** | Whisper语音识别 | https://github.com/openai/whisper |
| **Mage-VL-4B文档** | 视觉识别模型 | https://huggingface.co/microsoft/Mage-VL-4B |

### **📋 AI模型资源**

| 模型 | 用途 | 链接 |
|------|------|------|
| **Whisper tiny** | 语音识别 | https://github.com/openai/whisper |
| **Mage-VL-4B INT8** | 视觉识别 | https://huggingface.co/microsoft/Mage-VL-4B |
| **DeepSeek API** | 对话生成 | https://platform.deepseek.com/ |
| **FaceNet** | 人脸识别 | https://github.com/timesler/facenet-pytorch |
| **YOLOv8n** | 物体检测 | https://github.com/ultralytics/ultralytics |

### **📋 社区和支持**

| 社区 | 描述 | 链接 |
|------|------|------|
| **GitHub Issues** | 技术问题和Bug报告 | https://github.com/vibechina/diechi-app/issues |
| **GitHub Discussions** | 技术讨论和经验分享 | https://github.com/vibechina/diechi-app/discussions |
| **Slack/Teams** | 团队沟通 | 内部频道 |
| **邮件支持** | 正式支持渠道 | support@diechi.ai |

---

## 🎓 **📈 绩效评估和成长路径**

### **📋 绩效评估指标**

| 指标 | 权重 | 目标值 | 评估周期 |
|------|------|--------|----------|
| **代码质量** | 25% | 85%+覆盖率，0个高危漏洞 | 每月 |
| **功能完成** | 25% | 按时完成分配的任务 | 每月 |
| **代码审查** | 15% | 及时完成代码审查，反馈有价值 | 每月 |
| **学习成长** | 15% | 完成学习计划，掌握新技能 | 每月 |
| **团队协作** | 10% | 积极参与团队讨论，帮助他人 | 每月 |
| **文档贡献** | 10% | 及时更新文档，保持文档完整性 | 每月 |

### **📋 成长路径**

#### **🎯 初级开发者 (0-6个月)**
```
学习目标:
- 掌握项目架构和技术栈
- 完成基础开发任务
- 提升代码质量和测试覆盖率
- 学习插件化开发

成长指标:
✅ 完成10个以上开发任务
✅ 代码覆盖率达到80%+
✅ 无重大Bug报告
✅ 通过代码审查
```

#### **🎯 中级开发者 (6-18个月)**
```
学习目标:
- 掌握系统设计和架构优化
- 独立负责模块开发
- 指导初级开发者
- 参与技术决策

成长指标:
✅ 完成5个以上系统模块开发
✅ 指导2名以上初级开发者
✅ 参与架构设计讨论
✅ 技术方案通过评审
```

#### **🎯 高级开发者 (18个月以上)**
```
学习目标:
- 掌握整体系统架构
- 负责重大技术决策
- 制定技术发展路线
- 推动技术创新

成长指标:
✅ 完成2个以上重大技术改进
✅ 制定技术发展路线
✅ 推动新技术采用
✅ 技术方案获得团队认可
```

---

## 🎓 **💡 常见问题解答**

### **📋 技术问题**

**Q: 如何解决依赖冲突？**
A: 
```bash
# 1. 检查依赖版本
cat apps/api/requirements.txt
cat apps/web/package.json

# 2. 使用虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. 更新依赖
pip install --upgrade package-name
pnpm update package-name

# 4. 清理缓存
pip cache purge
pnpm store prune
```

**Q: Docker容器无法启动？**
A: 
```bash
# 1. 检查日志
docker-compose logs api
docker-compose logs web

# 2. 检查端口占用
netstat -tulnp | grep 8000
netstat -tulnp | grep 5173

# 3. 清理Docker
docker system prune -a

# 4. 重新构建
bash scripts/dev-start.sh --rebuild
```

**Q: API返回500错误？**
A: 
```bash
# 1. 检查后端日志
docker-compose logs api

# 2. 检查数据库连接
# 确保PostgreSQL和Redis服务正常运行

# 3. 检查.env配置
code .env

# 4. 重新启动服务
bash scripts/dev-start.sh --restart
```

**Q: 前端页面白屏？**
A: 
```bash
# 1. 检查浏览器控制台
F12 -> Console

# 2. 检查API服务是否正常
curl http://localhost:8000/health

# 3. 清理浏览器缓存
Ctrl+Shift+Delete

# 4. 重新启动前端服务
cd apps/web
pnpm dev --force
```

### **📋 开发流程问题**

**Q: 如何创建新的Skill角色？**
A: 
```bash
# 1. 创建新的Skill插件
cp apps/api/plugins/skill_plugin.py apps/api/plugins/doctor_skill_plugin.py

# 2. 编辑新插件
code apps/api/plugins/doctor_skill_plugin.py

# 3. 注册新插件
# 编辑 apps/api/main.py，添加新插件

# 4. 创建前端页面
cp apps/web/src/pages/SkillsPage.tsx apps/web/src/pages/DoctorSkillsPage.tsx

# 5. 添加路由
# 编辑 apps/web/src/App.tsx，添加新路由

# 6. 测试新功能
```

**Q: 如何优化AI模型性能？**
A: 
```bash
# 1. 使用INT8量化
# 编辑 apps/api/plugins/vision_plugin.py，使用量化模型

# 2. 优化推理参数
# 调整batch_size和max_length参数

# 3. 使用GPU加速
# 确保Docker配置中启用GPU支持

# 4. 缓存推理结果
# 实现结果缓存机制
```

**Q: 如何添加新的AI功能？**
A: 
```bash
# 1. 选择AI模型
# 例如：语音转文本、文本生成、图像识别等

# 2. 创建新的插件
# 编辑 apps/api/plugins/new_plugin.py

# 3. 注册服务和事件
# 编辑 apps/api/main.py，注册新插件

# 4. 创建前端组件
# 编辑 apps/web/src/components/NewComponent.tsx

# 5. 添加API端点
# 编辑 apps/api/main.py，添加新端点

# 6. 更新文档
# 编辑相关文档，添加新功能说明
```

### **📋 团队协作问题**

**Q: 如何参与代码审查？**
A: 
```
# 1. 查看待审查的Pull Requests
# 访问: https://github.com/vibechina/diechi-app/pulls

# 2. 选择感兴趣的PR进行审查

# 3. 进行代码审查
# - 检查代码逻辑
# - 检查代码规范
# - 检查测试覆盖
# - 提出改进建议

# 4. 提交审查意见
# - 使用GitHub PR评论功能
# - 提供具体的改进建议
```

**Q: 如何获得技术支持？**
A: 
```
# 1. 查看文档
# - START_HERE.md
# - README.md
# - ARCHITECTURE.md
# - QUALITY_ASSURANCE.md

# 2. 查看GitHub Issues
# https://github.com/vibechina/diechi-app/issues

# 3. 在团队频道提问
# Slack/Teams: #技术支持

# 4. 邮件支持
# support@diechi.ai
```

**Q: 如何参与技术讨论？**
A: 
```
# 1. 查看GitHub Discussions
# https://github.com/vibechina/diechi-app/discussions

# 2. 参与技术话题讨论
# 分享经验和见解

# 3. 提出改进建议
# 参与架构讨论

# 4. 贡献技术文章
# 分享学习心得和最佳实践
```

---

## 🎉 **🏆 总结**

### **📊 入职完成清单**

- [ ] ✅ 环境搭建完成
- [ ] ✅ 项目克隆和配置完成
- [ ] ✅ 开发环境启动成功
- [ ] ✅ 核心文档阅读完成
- [ ] ✅ 技术栈学习完成
- [ ] ✅ 开发工具配置完成
- [ ] ✅ 第一个功能开发完成
- [ ] ✅ 代码提交和审查完成

### **🎯 下一步行动**

```
📋 立即开始:
1. 启动开发环境: bash scripts/dev-start.sh
2. 访问前端: http://localhost:5173
3. 测试核心功能: curl http://localhost:8000/health
4. 选择一个Issue开始开发

📋 学习计划:
1. 第1天: 了解项目架构
2. 第2天: 学习插件系统
3. 第3天: 学习前端开发
4. 第4天: 学习后端开发
5. 第5天: 学习测试框架
6. 第6天: 学习部署配置
7. 第7天: 学习质量保证

📋 开发贡献:
1. 查看GitHub Issues
2. 选择感兴趣的任务
3. 创建开发分支
4. 开始开发
5. 提交代码
6. 参与代码审查
```

### **💬 团队寄语**

> 🎓 **欢迎加入蝶翅APP项目！**
> 
> 这是一个充满挑战和机遇的项目，我们相信通过团队的共同努力，一定能够打造出优秀的多模态AI助手系统。
> 
> 在这个过程中，您将学习到前沿的技术，掌握插件化架构设计，提升全栈开发能力。我们期待与您一起成长，共同创造价值。
> 
> 如果您在学习或开发过程中遇到任何问题，请随时联系团队。我们一起努力，让蝶翅APP成为用户喜爱的AI助手！
> 
> **加油！🚀**

---

## 📞 **🎧 技术支持联系方式**

### **📧 邮件支持**
- **支持邮箱**: support@diechi.ai
- **响应时间**: 工作日24小时内

### **💬 即时通讯**
- **Slack/Teams**: #技术支持频道
- **响应时间**: 工作时间内实时响应

### **📋 问题报告**
- **GitHub Issues**: https://github.com/vibechina/diechi-app/issues
- **响应时间**: 24小时内确认，72小时内解决

---

**🦋 蝶翅APP团队祝您开发愉快！**

**如果您有任何问题，请随时联系我们。** 😊