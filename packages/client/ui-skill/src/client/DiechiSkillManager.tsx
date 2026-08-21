/**
 * 蝶翅APP专用Skill管理面板
 * 在DeepSeek Harness基础上扩展，用于蝶翅APP的专家角色切换功能
 */

import type { Context } from '@deepseek-ai/cordis'
import React, { useEffect, useState } from 'react'
import clsx from 'clsx'

// 蝶翅Skill定义（基于项目文档标准）
export interface DiechiSkillDefinition {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  system_prompt: string
  knowledge_base?: Array<{
    id: string
    content: string
    type: 'text' | 'document' | 'reference'
  }>
  version: string
  author: string
  created_at: string
  enabled?: boolean
  current?: boolean
}

// 蝶翅Skill管理组件属性
export interface DiechiSkillManagerProps {
  className?: string
  onSkillSwitch?: (skillId: string) => void
}

// 默认内置Skill（蝶翅APP专用）
export const DEFAULT_DIECHI_SKILLS: DiechiSkillDefinition[] = [
  {
    id: 'sqe_8d_001',
    name: 'SQE客诉处理',
    description: '适用于处理供应商质量问题的8D报告',
    category: '质量管理',
    tags: ['客诉', '8D', '供应商', 'SQE'],
    system_prompt: `你是一位资深供应商质量工程师（SQE），擅长用8D方法处理客诉问题。

请按照以下步骤处理客户投诉：

1. **问题描述**：准确理解和描述客户投诉的具体内容
2. **临时措施**：制定并实施临时措施防止问题扩大
3. **根本原因分析**：使用5Why法或鱼骨图等方法找出根本原因
4. **纠正措施**：制定永久纠正措施消除根本原因
5. **预防措施**：制定预防措施防止类似问题再次发生
6. **验证**：验证纠正措施的有效性
7. **标准化**：将有效的措施标准化，纳入相关流程
8. **团队认可**：获得相关团队对8D报告的认可

请确保你的回答：
- 专业准确，使用质量管理术语
- 结构化，逻辑清晰
- 提供具体的行动建议
- 考虑供应商关系和成本效益`,
    knowledge_base: [],
    version: '1.0.0',
    author: '蝶翅系统',
    created_at: '2024-01-01',
    enabled: true,
    current: true
  },
  {
    id: 'legal_consult_001',
    name: '法律咨询顾问',
    description: '专业的法律问题咨询和建议',
    category: '法律咨询',
    tags: ['法律', '合同', '风险', '咨询'],
    system_prompt: `你是一位经验丰富的企业法律顾问，专门处理商业法律事务。

在回答法律问题时，请遵循以下原则：

1. **准确性优先**：基于现行法律法规提供准确的法律意见
2. **风险提示**：明确指出潜在的法律风险和不确定性
3. **实用建议**：提供可操作的法律建议和解决方案
4. **合规导向**：确保建议符合最新的法律法规要求
5. **保密原则**：强调法律咨询的保密性质

请注意：
- 不要提供具体的诉讼策略
- 避免成为"法律黑客"，提供的建议应在合理范围内
- 如果问题涉及重大法律风险，建议寻求专业律师的面对面咨询
- 你的回答应基于中国大陆法律体系

请以专业、严谨的法律语言回答问题。`,
    knowledge_base: [],
    version: '1.0.0',
    author: '蝶翅系统',
    created_at: '2024-01-01',
    enabled: true
  },
  {
    id: 'customer_service_001',
    name: '客户服务专员',
    description: '专业的客户服务和投诉处理',
    category: '客户服务',
    tags: ['客服', '投诉', '沟通', '服务'],
    system_prompt: `你是一位优秀的客户服务专员，以"客户至上"为核心理念。

在处理客户问题时，请遵循以下原则：

1. **同理心**：真诚理解客户的感受和需求
2. **快速响应**：及时回应客户的咨询和投诉
3. **专业态度**：保持礼貌、耐心、专业的服务态度
4. **问题解决**：以解决问题为导向，提供具体的解决方案
5. **跟进确认**：确保问题得到彻底解决并跟进客户满意度

请注意：
- 避免使用模板化的回复
- 根据具体情况个性化处理
- 如果问题超出职责范围，及时升级处理
- 保护客户隐私信息

请以温暖、专业、负责任的语气回答问题。`,
    knowledge_base: [],
    version: '1.0.0',
    author: '蝶翅系统',
    created_at: '2024-01-01',
    enabled: true
  },
  {
    id: 'hr_management_001',
    name: '人力资源专员',
    description: '专业的人力资源管理咨询',
    category: '人力资源',
    tags: ['HR', '招聘', '员工', '管理'],
    system_prompt: `你是一位经验丰富的人力资源专家，专注于企业人力资源管理。

在处理人力资源问题时，请遵循以下原则：

1. **合规性**：确保所有建议符合劳动法规和公司政策
2. **员工体验**：以员工满意为导向
3. **业务导向**：平衡员工需求和业务目标
4. **保密原则**：严格保护员工隐私信息
5. **发展导向**：注重员工成长和职业发展

请提供：
- 具体的HR政策建议
- 员工关系处理方案
- 招聘和面试指导
- 绩效管理建议
- 培训发展规划

请以专业、保密、发展的角度回答问题。`,
    knowledge_base: [],
    version: '1.0.0',
    author: '蝶翅系统',
    created_at: '2024-01-01',
    enabled: true
  }
]

// 蝶翅Skill管理组件
export function DiechiSkillManager(props: DiechiSkillManagerProps) {
  const { className, onSkillSwitch } = props
  const ctx = (window as any).__DSH_BOOT__?.ctx as Context | undefined
  
  // 状态管理
  const [skills, setSkills] = useState<DiechiSkillDefinition[]>([])
  const [currentSkill, setCurrentSkill] = useState<DiechiSkillDefinition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // 加载Skill数据
  useEffect(() => {
    if (!ctx) {
      setError('Cordis上下文未加载，请检查应用启动状态')
      setLoading(false)
      return
    }

    try {
      // 获取Skill服务
      const skillService = ctx.get('diechi-skill')
      if (!skillService) {
        console.warn('蝶翅Skill服务未注册，将使用默认配置')
        // 如果服务未注册，使用默认Skill
        setSkills(DEFAULT_DIECHI_SKILLS)
        setCurrentSkill(DEFAULT_DIECHI_SKILLS.find(s => s.current) || DEFAULT_DIECHI_SKILLS[0])
        setLoading(false)
        return
      }

      // 订阅Skill列表更新
      const unsubscribeRegistered = ctx.on('diechi-skill/registered', (skill: DiechiSkillDefinition) => {
        updateSkills()
      })
      
      const unsubscribeSwitched = ctx.on('diechi-skill/switched', (skill: DiechiSkillDefinition) => {
        updateSkills()
        setCurrentSkill(skill)
        if (onSkillSwitch) {
          onSkillSwitch(skill.id)
        }
      })
      
      const unsubscribeEnabled = ctx.on('diechi-skill/enabled-changed', ({ skill, enabled }: { skill: DiechiSkillDefinition, enabled: boolean }) => {
        updateSkills()
      })

      // 初始化数据
      updateSkills()
      setCurrentSkill(skillService.getCurrentSkill() || DEFAULT_DIECHI_SKILLS.find(s => s.current))
      setLoading(false)

      return () => {
        unsubscribeRegistered()
        unsubscribeSwitched()
        unsubscribeEnabled()
      }
    } catch (err) {
      console.error('蝶翅Skill管理器初始化失败:', err)
      setError('初始化失败: ' + (err as Error).message)
      setLoading(false)
    }
  }, [ctx, onSkillSwitch])

  // 更新技能列表
  const updateSkills = () => {
    if (ctx) {
      const skillService = ctx.get('diechi-skill')
      if (skillService) {
        setSkills(skillService.listSkills())
      }
    }
  }

  // 切换Skill
  const handleSwitchSkill = async (skillId: string) => {
    if (ctx) {
      const skillService = ctx.get('diechi-skill')
      if (skillService) {
        try {
          const success = await skillService.switchSkill(skillId)
          if (success && onSkillSwitch) {
            const newSkill = skillService.getSkill(skillId)
            if (newSkill) {
              setCurrentSkill(newSkill)
              onSkillSwitch(skillId)
            }
          }
        } catch (error) {
          console.error('切换Skill失败:', error)
        }
      }
    }
  }

  // 启用/禁用Skill
  const handleToggleSkill = (skillId: string, enabled: boolean) => {
    if (ctx) {
      const skillService = ctx.get('diechi-skill')
      if (skillService) {
        skillService.enableSkill(skillId, enabled)
      }
    }
  }

  // 渲染加载状态
  if (loading) {
    return (
      <div className={clsx(className, 'diechi-skill-manager')}
        style={{
          padding: '20px',
          textAlign: 'center',
          color: '#666',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '12px' }}>🔄</div>
        <div>正在加载专家角色管理器...</div>
      </div>
    )
  }

  // 渲染错误状态
  if (error) {
    return (
      <div className={clsx(className, 'diechi-skill-manager')}
        style={{
          padding: '20px',
          background: '#ffebee',
          border: '1px solid #f44336',
          borderRadius: '8px',
          color: '#d32f2f',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ fontSize: '20px', marginBottom: '12px' }}>⚠️</div>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>技能管理器错误</div>
        <div style={{ fontSize: '14px' }}>{error}</div>
      </div>
    )
  }

  // 渲染内容
  return (
    <div className={clsx(className, 'diechi-skill-manager')}
      style={{
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '400px',
        margin: '0 auto',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
      }}
    >
      {/* 标题 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <div style={{ fontSize: '24px' }}>🎯</div>
        <h3 style={{
          margin: '0',
          color: '#1e88e5',
          fontSize: '18px',
          fontWeight: '600'
        }}>
          蝶翅专家角色管理
        </h3>
      </div>

      {/* 当前Skill显示 */}
      {currentSkill && (
        <div style={{
          background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px',
          borderLeft: '4px solid #1e88e5',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{
            margin: '0 0 8px 0',
            color: '#1565c0',
            fontSize: '16px'
          }}>
            {currentSkill.name}
            {currentSkill.current && (
              <span style={{
                marginLeft: '8px',
                background: '#1e88e5',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '500'
              }}>
                当前使用
              </span>
            )}
          </h4>
          <p style={{
            margin: '0',
            fontSize: '14px',
            color: '#555',
            lineHeight: '1.5'
          }}>
            {currentSkill.description}
          </p>
          <div style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid #bbdefb',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap'
          }}>
            <span style={{
              background: 'rgba(30, 136, 229, 0.1)',
              color: '#1565c0',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: '500'
            }}>
              {currentSkill.category}
            </span>
            {currentSkill.tags.slice(0, 3).map((tag) => (
              <span key={tag} style={{
                background: 'rgba(0, 0, 0, 0.05)',
                color: '#555',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px'
              }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Skill列表 */}
      <h4 style={{
        margin: '0 0 12px 0',
        color: '#333',
        fontSize: '15px',
        fontWeight: '500'
      }}>
        📚 可用的专家角色 ({skills.filter(s => s.enabled !== false).length}/{skills.length})
      </h4>
      
      <div style={{
        maxHeight: '450px',
        overflowY: 'auto',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        background: '#fafafa'
      }}>
        {skills.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '14px'
          }}>
            暂无可用的专家角色
          </div>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.id}
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid #e8e8e8',
                background: skill.current ? 'white' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  background: skill.current ? 'white' : '#f5f7fa',
                  transform: 'translateX(2px)'
                }
              }}
              onClick={() => handleSwitchSkill(skill.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <h5 style={{
                      margin: '0',
                      fontSize: '14px',
                      color: '#333',
                      fontWeight: skill.current ? '600' : '500'
                    }}>
                      {skill.name}
                      {skill.current && ' ✅'}
                    </h5>
                  </div>
                  <p style={{
                    margin: '0',
                    fontSize: '13px',
                    color: '#666',
                    lineHeight: '1.4'
                  }}>
                    {skill.description}
                  </p>
                  <div style={{
                    marginTop: '8px',
                    display: 'flex',
                    gap: '6px',
                    flexWrap: 'wrap'
                  }}>
                    <span style={{
                      background: '#e3f2fd',
                      color: '#1565c0',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '11px'
                    }}>
                      {skill.category}
                    </span>
                    {skill.tags.slice(0, 3).map((tag) => (
                      <span key={tag} style={{
                        background: '#f5f5f5',
                        color: '#555',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '11px'
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ 
                  marginLeft: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    color: '#666',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      checked={skill.enabled !== false}
                      onChange={(e) => handleToggleSkill(skill.id, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: 'pointer' }}
                    />
                    启用
                  </label>
                  {skill.current && (
                    <span style={{
                      background: '#1e88e5',
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      textAlign: 'center'
                    }}>
                      当前使用
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 技能统计 */}
      <div style={{
        marginTop: '16px',
        padding: '12px',
        background: '#f8f9fa',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#666'
      }}>
        <p style={{ margin: '0' }}>
          📊 总计 {skills.length} 个专家角色 • 
          {skills.filter(s => s.enabled !== false).length} 个已启用 • 
          {skills.filter(s => s.current).length} 个当前使用
        </p>
      </div>

      {/* 提示信息 */}
      <div style={{
        marginTop: '12px',
        padding: '8px',
        background: '#fff3e0',
        borderRadius: '4px',
        fontSize: '11px',
        color: '#e65100',
        textAlign: 'center'
      }}>
        💡 点击专家角色卡片可切换当前使用的AI专家
      </div>
    </div>
  )
}

// 插件定义
export function apply(ctx: Context) {
  console.log('🎯 蝶翅专家角色管理器已加载')
  console.log('📚 默认内置专家角色:', DEFAULT_DIECHI_SKILLS.length, '个')
  
  // 注册蝶翅Skill管理器到Slot
  ctx.slots.register('diechi-skill-manager', DiechiSkillManager)
  
  console.log('✅ 蝶翅Skill管理面板组件已注册到 slot:diechi-skill-manager')
}