/**
 * 蝶翅APP Skill调度器 - Host端实现
 * 负责管理Skill的加载、存储、切换和与Harness系统的集成
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DiechiSkillDefinition } from '@/packages/client/ui-skill/src/client/DiechiSkillManager'
import { DEFAULT_DIECHI_SKILLS } from '@/packages/client/ui-skill/src/client/DiechiSkillManager'

export interface DiechiSkillService {
  registerSkill: (skill: DiechiSkillDefinition) => void
  getSkill: (id: string) => DiechiSkillDefinition | undefined
  listSkills: () => DiechiSkillDefinition[]
  switchSkill: (id: string) => Promise<boolean>
  enableSkill: (id: string, enabled: boolean) => void
  getCurrentSkill: () => DiechiSkillDefinition | undefined
  saveSkills: () => void
  loadSkills: () => void
}

declare module '@deepseek-ai/cordis' {
  interface Services {
    'diechi-skill': DiechiSkillService
  }
}

// Skill存储接口
export interface SkillStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
}

// 默认本地存储实现
class LocalSkillStorage implements SkillStorage {
  private prefix: string
  
  constructor(prefix: string = 'diechi-skill-') {
    this.prefix = prefix
  }
  
  getItem(key: string): string | null {
    return localStorage.getItem(this.prefix + key)
  }
  
  setItem(key: string, value: string): void {
    localStorage.setItem(this.prefix + key, value)
  }
  
  removeItem(key: string): void {
    localStorage.removeItem(this.prefix + key)
  }
  
  clear(): void {
    // 清除所有以prefix开头的key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(this.prefix)) {
        localStorage.removeItem(key)
      }
    }
  }
}

// Skill调度服务实现
export function apply(ctx: Context) {
  console.log('🔧 蝶翅Skill调度器启动中...')
  
  // Skill注册表
  const skillRegistry: Record<string, DiechiSkillDefinition> = {}
  
  // 存储管理器
  const storage = new LocalSkillStorage('diechi-skill-')
  
  // 初始化默认Skill
  DEFAULT_DIECHI_SKILLS.forEach(skill => {
    skillRegistry[skill.id] = { ...skill }
  })
  
  // 从存储中加载用户自定义Skill
  loadSkillsFromStorage()
  
  // 确保至少有一个Skill被设置为当前使用
  ensureCurrentSkill()

  // 提供Skill管理服务
  ctx.provide('diechi-skill', {
    registerSkill: (skill: DiechiSkillDefinition) => {
      // 检查是否已存在相同ID的Skill
      if (skillRegistry[skill.id]) {
        console.warn(`Skill with id ${skill.id} already exists, updating...`)
      }
      
      skillRegistry[skill.id] = { ...skill }
      saveSkillsToStorage()
      ctx.emit('diechi-skill/registered', skill)
    },
    
    getSkill: (id: string) => skillRegistry[id],
    
    listSkills: () => Object.values(skillRegistry),
    
    switchSkill: async (id: string) => {
      const skill = skillRegistry[id]
      if (!skill) {
        console.warn(`Skill not found: ${id}`)
        return false
      }

      // 更新当前Skill标记
      Object.values(skillRegistry).forEach(s => s.current = false)
      skill.current = true
      skill.enabled = true

      // 保存到存储
      saveSkillsToStorage()

      // 触发事件
      ctx.emit('diechi-skill/switched', skill)
      
      console.log(`✅ 已切换到专家角色: ${skill.name}`)
      return true
    },
    
    enableSkill: (id: string, enabled: boolean) => {
      const skill = skillRegistry[id]
      if (skill) {
        skill.enabled = enabled
        saveSkillsToStorage()
        ctx.emit('diechi-skill/enabled-changed', { skill, enabled })
      }
    },
    
    getCurrentSkill: () => {
      return Object.values(skillRegistry).find(skill => skill.current)
    },
    
    saveSkills: saveSkillsToStorage,
    
    loadSkills: loadSkillsFromStorage,
  })

  // 监听系统事件
  ctx.on('diechi-skill/switch-requested', async (id: string) => {
    await ctx.get('diechi-skill')?.switchSkill(id)
  })

  console.log('✅ 蝶翅Skill调度器已启动')
  console.log(`📊 当前已注册 ${Object.keys(skillRegistry).length} 个专家角色`)
  console.log(`🎯 当前使用: ${ctx.get('diechi-skill')?.getCurrentSkill()?.name || '无'}`)

  // 启动时自动加载默认Skill
  autoLoadDefaultSkills()

  // 定期保存（每5分钟）
  setInterval(saveSkillsToStorage, 5 * 60 * 1000)

  // 组件卸载时保存
  ctx.effect(() => {
    return () => {
      saveSkillsToStorage()
      console.log('💾 Skill数据已保存')
    }
  })

  // 系统错误处理
  ctx.on('error', (error: Error) => {
    console.error('蝶翅Skill调度器错误:', error)
  })

  // 系统销毁时保存
  ctx.on('dispose', () => {
    saveSkillsToStorage()
    console.log('🗑️ 蝶翅Skill调度器已销毁，数据已保存')
  })

  // 导出服务到上下文
  return {
    name: 'diechi-skill-dispatcher',
    version: '1.0.0',
    description: '蝶翅APP专用Skill调度器',
  }
}

// 保存Skill到存储
function saveSkillsToStorage() {
  const skillService = (globalThis as any).__DSH_CONTEXT__?.get?.('diechi-skill')
  if (!skillService) return
  
  try {
    const skills = skillService.listSkills()
    const data = JSON.stringify(skills, null, 2)
    localStorage.setItem('diechi-skill-all', data)
    console.log('💾 Skill数据已保存到localStorage')
  } catch (error) {
    console.error('保存Skill数据失败:', error)
  }
}

// 从存储加载Skill
function loadSkillsFromStorage() {
  const skillService = (globalThis as any).__DSH_CONTEXT__?.get?.('diechi-skill')
  if (!skillService) return
  
  try {
    const data = localStorage.getItem('diechi-skill-all')
    if (data) {
      const skills: DiechiSkillDefinition[] = JSON.parse(data)
      skills.forEach(skill => {
        skillRegistry[skill.id] = skill
      })
      console.log(`📂 从存储加载了 ${skills.length} 个Skill`)
    }
  } catch (error) {
    console.error('加载Skill数据失败:', error)
  }
}

// 确保至少有一个Skill被设置为当前使用
function ensureCurrentSkill() {
  const hasCurrent = Object.values(skillRegistry).some(skill => skill.current)
  if (!hasCurrent && Object.keys(skillRegistry).length > 0) {
    // 设置第一个Skill为当前使用
    const firstSkill = Object.values(skillRegistry)[0]
    firstSkill.current = true
    console.log(`⚠️ 自动设置 ${firstSkill.name} 为当前使用的专家角色`)
  }
}

// 自动加载默认Skill
function autoLoadDefaultSkills() {
  const skillService = (globalThis as any).__DSH_CONTEXT__?.get?.('diechi-skill')
  if (!skillService) return
  
  const configSkills = ['sqe_8d_001', 'legal_consult_001', 'customer_service_001', 'hr_management_001']
  
  configSkills.forEach(skillId => {
    const skill = skillService.getSkill(skillId)
    if (skill && !skill.enabled) {
      skillService.enableSkill(skillId, true)
      console.log(`🔄 自动启用专家角色: ${skill.name}`)
    }
  })
}

// 导出skillRegistry供调试使用
// @ts-ignore
globalThis.diechiSkillRegistry = skillRegistry