"/*
蝶翅APP Skill系统插件 - 前端插件化架构
基于React Context实现Skill功能

学习目标：
- 理解前端插件化架构
- 实现Skill系统功能模块化
- 学习状态管理模式
*/

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePluginManager } from './plugin-manager';

// Skill类型
export type SkillType = 'default' | 'doctor' | 'teacher' | 'chef' | 'engineer';

// Skill信息类型
interface SkillInfo {
  type: SkillType;
  name: string;
  description: string;
  isCurrent: boolean;
}

// Skill执行结果类型
interface SkillExecutionResult {
  success: boolean;
  response: string;
  executionTime: number;
  tokensUsed: number;
}

// Skill插件上下文类型
interface SkillPluginContextType {
  skills: SkillInfo[];
  currentSkill: SkillInfo | null;
  switchSkill: (skillType: SkillType) => Promise<boolean>;
  executeSkill: (prompt: string) => Promise<SkillExecutionResult>;
  isExecuting: boolean;
  skillStatus: string;
  setSkillStatus: (status: string) => void;
}

// 创建Skill插件上下文
const SkillPluginContext = createContext<SkillPluginContextType>({
  skills: [],
  currentSkill: null,
  switchSkill: async () => false,
  executeSkill: async () => ({ success: false, response: '', executionTime: 0, tokensUsed: 0 }),
  isExecuting: false,
  skillStatus: 'idle',
  setSkillStatus: () => {},
});

// Skill插件提供者组件
export const SkillPluginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [currentSkill, setCurrentSkill] = useState<SkillInfo | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [skillStatus, setSkillStatus] = useState<string>('idle');
  const { getPlugin } = usePluginManager();

  // 获取Skill列表
  const fetchSkills = useCallback(async () => {
    try {
      const skillService = getPlugin('skill_system');
      if (skillService) {
        const response = await fetch('/api/v1/skills');
        const data = await response.json();
        
        if (data.success) {
          setSkills(data.skills);
          setCurrentSkill(data.current_skill);
        }
      }
    } catch (error) {
      console.error('❌ 获取Skill列表失败:', error);
    }
  }, [getPlugin]);

  // 切换Skill
  const switchSkill = useCallback(async (skillType: SkillType) => {
    try {
      setSkillStatus('switching');
      setIsExecuting(true);
      
      const response = await fetch('/api/v1/skills/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_type: skillType })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCurrentSkill(data.current_skill);
        setSkillStatus('switched');
        console.log(`🎯 Skill已切换为: ${skillType}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ 切换Skill失败:', error);
      setSkillStatus('error');
      return false;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  // 执行Skill
  const executeSkill = useCallback(async (prompt: string) => {
    try {
      setSkillStatus('executing');
      setIsExecuting(true);
      
      const response = await fetch('/api/v1/skills/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSkillStatus('completed');
        console.log('✅ Skill执行成功');
        return {
          success: true,
          response: data.response,
          executionTime: data.execution_time,
          tokensUsed: data.tokens_used
        };
      }
      
      return {
        success: false,
        response: data.message || 'Skill执行失败',
        executionTime: 0,
        tokensUsed: 0
      };
    } catch (error) {
      console.error('❌ Skill执行失败:', error);
      setSkillStatus('error');
      return {
        success: false,
        response: '网络错误，请重试',
        executionTime: 0,
        tokensUsed: 0
      };
    } finally {
      setIsExecuting(false);
    }
  }, []);

  // 组件加载时获取Skill列表
  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      console.log('🔌 Skill插件已卸载');
    };
  }, []);

  return (
    <SkillPluginContext.Provider
      value={{
        skills,
        currentSkill,
        switchSkill,
        executeSkill,
        isExecuting,
        skillStatus,
        setSkillStatus,
      }}
    >
      {children}
    </SkillPluginContext.Provider>
  );
};

// 自定义钩子 - 获取Skill插件
export const useSkillPlugin = () => {
  const context = useContext(SkillPluginContext);
  if (!context) {
    throw new Error('useSkillPlugin必须在SkillPluginProvider内使用');
  }
  return context;
};

// Skill状态枚举
export const SkillStatus = {
  IDLE: 'idle',
  SWITCHING: 'switching',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  ERROR: 'error',
  SWITCHED: 'switched',
} as const;

export type SkillStatusType = typeof SkillStatus[keyof typeof SkillStatus];

// 默认Skill数据
export const DefaultSkills: SkillInfo[] = [
  {
    type: 'default',
    name: '通用助手',
    description: '通用AI助手，适合各种日常问题',
    isCurrent: false,
  },
  {
    type: 'doctor',
    name: '医生',
    description: '专业医疗健康咨询服务',
    isCurrent: false,
  },
  {
    type: 'teacher',
    name: '老师',
    description: '专业教育辅导和知识传授',
    isCurrent: false,
  },
  {
    type: 'chef',
    name: '厨师',
    description: '专业烹饪指导和食谱推荐',
    isCurrent: false,
  },
  {
    type: 'engineer',
    name: '工程师',
    description: '专业技术咨询和问题解决',
    isCurrent: false,
  },
];