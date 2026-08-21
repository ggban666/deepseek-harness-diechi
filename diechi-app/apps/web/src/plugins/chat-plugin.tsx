"/*
蝶翅APP对话插件 - 前端插件化架构
基于React Context实现对话功能

学习目标：
- 理解前端插件化架构
- 实现对话功能模块化
- 学习状态管理模式
*/

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// 对话消息类型
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  status: 'sent' | 'received' | 'error';
}

// 对话插件上下文类型
interface ChatPluginContextType {
  messages: ChatMessage[];
  sendMessage: (message: string) => Promise<void>;
  clearMessages: () => void;
  isSending: boolean;
  chatStatus: string;
  setChatStatus: (status: string) => void;
  currentSkill: string;
  setCurrentSkill: (skill: string) => void;
}

// 创建对话插件上下文
const ChatPluginContext = createContext<ChatPluginContextType>({
  messages: [],
  sendMessage: async () => {},
  clearMessages: () => {},
  isSending: false,
  chatStatus: 'idle',
  setChatStatus: () => {},
  currentSkill: 'default',
  setCurrentSkill: () => {},
});

// 对话插件提供者组件
export const ChatPluginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [chatStatus, setChatStatus] = useState<string>('idle');
  const [currentSkill, setCurrentSkill] = useState<string>('default');

  // 发送消息
  const sendMessage = useCallback(async (message: string) => {
    try {
      setIsSending(true);
      setChatStatus('sending');
      
      // 添加用户消息
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        status: 'sent',
      };
      
      setMessages(prev => [...prev, userMessage]);
      console.log('👤 用户消息已添加:', message);

      // 模拟AI回复
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const aiResponse = `AI助手回复：${message} - 这是基于 ${currentSkill} 技能的回复`;
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now(),
        status: 'received',
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      setChatStatus('completed');
      console.log('🤖 AI回复已生成:', aiResponse);
      
    } catch (error) {
      console.error('❌ 发送消息失败:', error);
      setChatStatus('error');
      
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '抱歉，AI服务暂时 unavailable，请稍后再试。',
        timestamp: Date.now(),
        status: 'error',
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [currentSkill]);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    console.log('🧹 对话历史已清空');
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      console.log('🔌 对话插件已卸载');
    };
  }, []);

  return (
    <ChatPluginContext.Provider
      value={{
        messages,
        sendMessage,
        clearMessages,
        isSending,
        chatStatus,
        setChatStatus,
        currentSkill,
        setCurrentSkill,
      }}
    >
      {children}
    </ChatPluginContext.Provider>
  );
};

// 自定义钩子 - 获取对话插件
export const useChatPlugin = () => {
  const context = useContext(ChatPluginContext);
  if (!context) {
    throw new Error('useChatPlugin必须在ChatPluginProvider内使用');
  }
  return context;
};

// 对话状态枚举
export const ChatStatus = {
  IDLE: 'idle',
  SENDING: 'sending',
  RECEIVING: 'receiving',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;

export type ChatStatusType = typeof ChatStatus[keyof typeof ChatStatus];

// 技能类型
export const Skills = {
  DEFAULT: 'default',
  DOCTOR: 'doctor',
  TEACHER: 'teacher',
  CHEF: 'chef',
  ENGINEER: 'engineer',
} as const;

export type SkillType = typeof Skills[keyof typeof Skills];