# 蝶翅APP - DeepSeek Harness基座改造方案

## 📋 项目概述

蝶翅APP是基于DeepSeek Harness的智能助手平台，将原版Harness改造为蝶翅品牌的独立基座，保留所有核心功能的同时进行品牌化改造。

## 🎯 主要功能

### 1. 独立运行的蝶翅基座
- ✅ 端口: 3090
- ✅ 独立数据目录: `diechi-home/`
- ✅ 蝶翅品牌UI
- ✅ 4个专家角色(Skill):
  - SQE客诉处理
  - 法律咨询顾问
  - 客户服务专员
  - 人力资源专员

### 2. 原版Harness保持独立
- ✅ 端口: 3080
- ✅ 完全独立运行
- ✅ 不可修改，保持原样

### 3. 一键启动器
- ✅ 统一管理两套系统
- ✅ 启动/停止/重启功能
- ✅ 浏览器快速访问

## 📁 文件结构

```
D:\桌面\振翅新科\
├── deep seek harness/          # 🔒 原版Harness（不可动）
│   └── deepseek-harness-master/
│
└── 蝶翅-app/
    ├── diechi-harness/         # ✅ 蝶翅独立基座
    │   ├── apps/web/dist/      # 前端构建产物
    │   │   ├── favicon.png     # 🦋 蝴蝶图标
    │   │   ├── favicon.svg     # 🦋 蝴蝶图标（SVG）
    │   │   ├── index.html      # 🎨 蝶翅品牌页面
    │   │   └── manifest.webmanifest # 📋 PWA配置
    │   └── ...
    │
    ├── diechi-home/            # ✅ 蝶翅数据目录
    │   └── skills/             # 专家角色配置
    │
    ├── 蝶翅APP启动器.cmd      # 🚀 统一启动器
    ├── 一键启动蝶翅APP.cmd     # 🎯 简化启动器
    └── start-diechi.cmd        # 📝 原始启动脚本
```

## 🚀 快速开始

### 方法1: 使用统一启动器 (推荐)

1. 双击运行: `D:\桌面\振翅新科\蝶翅-app\蝶翅APP启动器.cmd`
2. 在菜单中选择:
   - 选项1: 启动蝶翅APP基座
   - 选项3: 访问蝶翅APP (http://127.0.0.1:3090)

### 方法2: 直接启动

1. 双击: `D:\桌面\振翅新科\蝶翅-app\一键启动蝶翅APP.cmd`
2. 自动启动蝶翅基座

### 方法3: 手动启动

```bash
cd D:\桌面\振翅新科\蝶翅-app\diechi-harness
pnpm dsh web --port 3090
```

## 🌐 访问地址

- **蝶翅APP基座**: http://127.0.0.1:3090
- **原版Harness**: http://127.0.0.1:3080

## 🔧 技术细节

### 图标替换
- 原图标: `favicon.svg` (DeepSeek图标)
- 新图标: `favicon.png` (蝴蝶图片)
- 位置: `diechi-harness/apps/web/dist/`

### 品牌化改造
- 页面标题: "DeepSeek Harness" → "蝶翅APP"
- 图标: DeepSeek → 蝴蝶图案
- 颜色主题: 紫色+粉色 (蝶翅品牌色)

### 专家角色配置
位于: `diechi-home/skills/`

每个角色包含:
- `SKILL.md` - 技能配置文件
- 专门的系统提示词
- 独立的功能定义

## 📊 当前状态

✅ **已完成:**
- [x] 蝶翅基座独立运行
- [x] 图标替换为蝴蝶图案
- [x] 品牌UI优化
- [x] 4个专家角色就绪
- [x] 一键启动器开发
- [x] 统一管理界面

⚠️ **待优化:**
- [ ] 专家角色切换面板测试
- [ ] 页面UI进一步美化
- [ ] 文档完善

## 🛠️ 故障排除

### 常见问题

**Q: 无法访问 http://127.0.0.1:3090**
A: 检查是否已启动服务，端口是否被占用

**Q: 图标没有变化**
A: 清除浏览器缓存，重新加载页面

**Q: 启动器报错**
A: 确保已安装Node.js 16+和pnpm

### 端口冲突解决

如果3090端口被占用:
1. 打开任务管理器
2. 结束所有node.exe进程
3. 重新启动

## 📝 更新日志

### v2.0 (2026-08-17)
- ✅ 蝶翅基座独立运行
- ✅ 图标替换完成
- ✅ 品牌UI优化
- ✅ 一键启动器开发
- ✅ 统一管理界面

### v1.0 (2026-08-16)
- ✅ 基础架构搭建
- ✅ 专家角色配置
- ✅ 数据目录设置

## 🤝 贡献指南

本项目由Codex Agent自动化完成，如需手动修改:

1. 修改图标: 替换 `diechi-harness/apps/web/dist/favicon.png`
2. 修改UI: 编辑 `diechi-harness/apps/web/dist/index.html`
3. 修改配置: 编辑 `diechi-home/settings.yaml`

## 📞 技术支持

如有问题，请联系:
- 项目负责人: Codex Agent
- 技术支持: 直接运行启动器查看状态

---

**🦋 蝶翅APP - 让AI助手更美丽 🦋**
