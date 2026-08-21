/**
 * 蝶翅APP专用配置文件
 * 用于定制DeepSeek Harness的启动行为，专门为蝶翅APP的Skill功能优化
 */

import type { AppWebEntryOptions } from '@deepseek-ai/dsh-client-web'

// 蝶翅APP的默认配置
export const DIECHI_APP_CONFIG: Partial<AppWebEntryOptions> = {
  // 应用名称
  appName: '蝶翅APP - 可切换专家角色的AI工作台',
  
  // 默认启动的Skill ID
  defaultSkillId: 'sqe_8d_001',
  
  // 是否显示技术细节面板（默认隐藏）
  showTechnicalDetails: false,
  
  // 主题配置
  theme: {
    primaryColor: '#1e88e5',
    secondaryColor: '#42a5f5',
    backgroundColor: '#f8f9fa',
    textColor: '#333',
    cardBackground: 'white',
  },
  
  // 默认启动的插件列表
  defaultPlugins: [
    // 核心功能插件
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-skill',
    
    // 蝶翅专用Skill调度插件
    {
      id: '@diechi/dsh-skill-dispatcher',
      kind: 'package',
      packageType: 'app',
      name: '蝶翅Skill调度器',
      description: '为蝶翅APP提供专家角色切换和管理功能',
      host: () => import('./diechi-skill-dispatcher.ts'),
      client: () => import('@/packages/client/ui-skill/src/client/DiechiSkillManager.tsx'),
    },
  ],
  
  // Skill存储配置
  skillStorage: {
    type: 'local',
    prefix: 'diechi-skill-',
  },
  
  // 对话界面优化
  conversation: {
    enableStreaming: true,
    typingEffect: true,
    messageAnimation: true,
  },
  
  // 启动时自动加载的Skill
  autoLoadSkills: [
    'sqe_8d_001',      // SQE客诉处理
    'legal_consult_001', // 法律咨询顾问
    'customer_service_001', // 客户服务专员
    'hr_management_001',   // 人力资源专员
  ],
  
  // 用户界面优化
  ui: {
    showSkillSwitcher: true,  // 显示技能切换器
    showSkillMarket: false,   // 暂时不显示技能市场（后期功能）
    enableVoiceInput: true,   // 启用语音输入
    enableDarkMode: true,     // 启用深色模式
  },
  
  // 个性化设置
  personalization: {
    saveConversationHistory: true,
    enableSkillRecommendations: true,
    showSkillTips: true,
  },
}

// 蝶翅APP的启动函数
export async function startDiechiApp() {
  console.log('🚀 蝶翅APP启动中...')
  console.log('📋 配置:', {
    appName: DIECHI_APP_CONFIG.appName,
    defaultSkill: DIECHI_APP_CONFIG.defaultSkillId,
    plugins: DIECHI_APP_CONFIG.defaultPlugins?.length,
    autoLoadSkills: DIECHI_APP_CONFIG.autoLoadSkills?.length,
  })
  
  // 这里可以添加额外的启动逻辑
  // 比如检查浏览器兼容性、加载用户偏好设置等
  
  return DIECHI_APP_CONFIG
}

// 导出配置类型
export type DiechiAppConfig = typeof DIECHI_APP_CONFIG