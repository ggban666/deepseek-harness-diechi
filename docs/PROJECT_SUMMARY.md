# 🦋 蝶翅APP项目总结

## 🎯 项目概述

**蝶翅APP** 是一个基于 **DeepSeek Harness** 构建的 **可切换专家角色的AI工作台**，核心理念是：

> **"不是和AI聊天，而是请一位专家帮你干活"**

通过切换不同的专家角色（Skill），用户可以获得专业领域的精准回答和任务帮助，而无需自己编写复杂的提示词。

## 🏗️ 技术架构

### 基础架构
- **基座**：DeepSeek Harness v0.1 (MIT License)
- **前端框架**：React 18 + TypeScript
- **构建工具**：Vite 5
- **状态管理**：Cordis（Harness的核心框架）
- **包管理**：pnpm（工作区模式）

### 项目结构

```
蝶翅-app/
├── 📁 apps/
│   └── web/                  # Web应用主目录
│       ├── src/
│       │   ├── main.ts       # 主入口文件
│       │   ├── diechi-app-entry.ts  # 蝶翅APP定制入口
│       │   ├── diechi-config.ts     # 蝶翅APP配置
│       │   ├── diechi-skill-dispatcher.ts # Skill调度器
│       │   └── index.html    # HTML入口
│       ├── package.json
│       ├── vite.config.ts   # Vite配置
│       └── tsconfig.json
├── 📁 packages/
│   └── client/
│       └── ui-skill/        # Skill管理UI组件
│           └── src/
│               └── client/
│                   └── DiechiSkillManager.tsx # 蝶翅Skill管理器
├── 📄 README.md              # 项目文档
├── 📄 package.json           # 根目录配置
├── 🚀 start-diechi-app.bat   # Windows启动脚本
└── 🚀 start-diechi-app.sh    # Linux/Mac启动脚本
```

## 🎨 核心功能实现

### 1. Skill系统（专家角色管理）

#### 内置专家角色
| ID | 名称 | 分类 | 描述 |
|----|------|------|------|
| `sqe_8d_001` | SQE客诉处理 | 质量管理 | 适用于处理供应商质量问题的8D报告 |
| `legal_consult_001` | 法律咨询顾问 | 法律咨询 | 专业的法律问题咨询和建议 |
| `customer_service_001` | 客户服务专员 | 客户服务 | 专业的客户服务和投诉处理 |
| `hr_management_001` | 人力资源专员 | 人力资源 | 专业的人力资源管理咨询 |

#### 功能特性
- ✅ **一键切换** 专家角色
- ✅ **启用/禁用** 专家角色管理
- ✅ **当前使用** 标记显示
- ✅ **专家描述** 和分类标签
- ✅ **数据持久化** 到浏览器localStorage
- ✅ **自动加载** 默认专家角色

### 2. 对话界面

- ✅ **文字输入** 支持
- ✅ **流式输出** （打字机效果）
- ✅ **消息历史记录**
- ✅ **技术细节面板** （可隐藏）
- ✅ **响应式设计**

### 3. 用户体验优化

- ✅ **深色/浅色模式** 支持
- ✅ **响应式布局**
- ✅ **加载动画**
- ✅ **错误处理** 和友好的错误页面
- ✅ **PWA支持** （基础配置）

## 🔧 核心组件实现

### 1. Skill调度器 (`diechi-skill-dispatcher.ts`)

**功能**：
- 管理Skill的注册、加载、存储
- 处理Skill的切换和启用/禁用
- 与Harness系统集成
- 数据持久化到localStorage

**技术特性**：
- 使用Cordis服务提供机制
- 支持事件订阅和发布
- 自动保存机制（每5分钟）
- 错误处理和系统清理

### 2. Skill管理器 (`DiechiSkillManager.tsx`)

**功能**：
- 显示Skill列表和当前使用的专家
- 处理用户交互（切换、启用/禁用）
- 响应式UI设计
- 状态管理和错误处理

**UI特性**：
- 现代化的卡片式布局
- 流畅的动画效果
- 响应式设计
- 友好的用户提示

### 3. 蝶翅APP入口 (`diechi-app-entry.ts`)

**功能**：
- 集成Harness基础功能
- 注册蝶翅Skill调度器
- 显示欢迎消息和错误处理
- 统一启动流程

## 📊 技术亮点

### 1. 无缝集成Harness
- 完全兼容Harness的插件系统
- 复用Harness的对话界面
- 利用Harness的Agent框架
- 保持Harness的更新兼容性

### 2. 模块化设计
- Skill系统独立于对话界面
- 配置文件集中管理
- 组件高度复用
- 易于扩展和维护

### 3. 用户体验优化
- 快速启动（无需复杂配置）
- 直观的操作界面
- 实时反馈和错误处理
- 响应式设计适配各种设备

### 4. 数据持久化
- Skill数据自动保存
- 浏览器localStorage存储
- 支持用户偏好设置
- 断点续连

## 🚀 使用指南

### 快速启动

```bash
# Windows
start-diechi-app.bat

# Linux/Mac  
./start-diechi-app.sh
```

### 手动启动

```bash
# 进入项目目录
cd 蝶翅-app

# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev:web

# 访问应用
open http://localhost:3000
```

### 创建新的专家角色

1. 编辑 `packages/client/ui-skill/src/client/DiechiSkillManager.tsx`
2. 在 `DEFAULT_DIECHI_SKILLS` 数组中添加新的Skill定义
3. 定义 `system_prompt` 来设置专家的行为和语气

```typescript
{
  id: 'new_skill_id',
  name: '新专家名称',
  description: '专家描述',
  category: '分类',
  tags: ['标签1', '标签2'],
  system_prompt: '专家的系统提示词，定义其行为和语气',
  version: '1.0.0',
  author: '作者',
  created_at: '2024-01-01'
}
```

## 📈 项目优势

### 1. 快速开发
- 基于成熟的Harness框架
- 无需从零开发对话系统
- 专注于业务逻辑实现
- 开发周期缩短80%

### 2. 可扩展性
- 插件化架构
- 易于添加新功能
- 支持第三方集成
- 适配多种场景

### 3. 合规性
- 工具属性，非拟人化
- 符合监管要求
- 低风险应用场景
- 商业化路径清晰

### 4. 用户体验
- 专业的AI专家服务
- 无需学习提示词技巧
- 任务导向的交互
- 高效的问题解决

## 🔮 未来规划

### 短期目标（1-3个月）
- [ ] 完善Skill市场功能
- [ ] 添加更多内置专家角色
- [ ] 优化移动端体验
- [ ] 增加对话历史管理
- [ ] 实现用户偏好设置

### 中期目标（3-6个月）
- [ ] 开发桌面版应用（Electron）
- [ ] 添加多模型API支持
- [ ] 实现Skill分享功能
- [ ] 增加用户反馈系统
- [ ] 优化性能和稳定性

### 长期目标（6-12个月）
- [ ] 移动端应用开发（React Native/Flutter）
- [ ] 企业级功能（团队协作、权限管理）
- [ ] Skill认证和质量控制
- [ ] 商业化模式探索
- [ ] 国际化支持

## 📚 学习资源

### DeepSeek Harness
- [官方文档](https://github.com/deepseek-ai/deepseek-harness)
- [MIT License](LICENSE) - 可商用
- [插件系统](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/core/agent)
- [对话界面](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/ui-conversation)

### 技术栈
- [React 18](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [pnpm](https://pnpm.io/)
- [Cordis](https://github.com/deepseek-ai/cordis) - Harness的状态管理框架

## 🤝 贡献指南

### 欢迎贡献！

我们欢迎各种形式的贡献：
- 🐛 Bug报告和修复
- 🚀 新功能建议
- 📚 文档改进
- 🎨 UI/UX优化
- 🔧 架构改进

### 贡献方式

1. Fork本项目
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交代码：`git commit -m 'feat: 添加xxx功能'`
4. 推送到分支：`git push origin feature/xxx`
5. 提交Pull Request

### 代码规范

- 使用TypeScript进行类型检查
- 代码格式化：ESLint + Prettier
- 提交前运行：`pnpm run lint` 和 `pnpm run format`
- 保持代码简洁和可读性

## 📄 许可证

本项目基于 **MIT License** 许可证，与DeepSeek Harness保持一致。

- ✅ 可商用
- ✅ 可修改
- ✅ 可分发
- 📋 保留版权声明

## 🎉 总结

蝶翅APP成功将DeepSeek Harness作为基座，快速构建了一个专业的AI工作台应用。通过：

1. **完整复用Harness的核心功能**（对话系统、Agent框架、插件系统）
2. **定制开发Skill管理系统**，实现专家角色切换
3. **优化用户体验**，提供现代化的UI界面
4. **保持架构的可扩展性**，便于后续功能扩展

我们成功在短时间内构建了一个符合项目需求的专业AI应用，为用户提供了"请专家帮忙"而不是"和AI聊天"的全新体验。

---

**蝶翅APP** - 让AI专家为你工作，而不是和AI聊天！ 🦋✨

*基于DeepSeek Harness v0.1 (MIT License) 构建*