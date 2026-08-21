"/*
蝶翅APP插件管理器 - 前端插件化架构
基于React Context实现插件管理

学习目标：
- 理解前端插件化架构
- 实现插件上下文管理
- 学习状态管理模式
*/

import React, { createContext, useContext, useState, useEffect } from 'react';

// 插件管理器上下文类型
interface PluginManagerContextType {
  plugins: Record<string, any>;
  registerPlugin: (name: string, plugin: any) => void;
  getPlugin: (name: string) => any;
  pluginStatus: Record<string, string>;
  setPluginStatus: (name: string, status: string) => void;
  isReady: boolean;
}

// 创建插件管理器上下文
const PluginManagerContext = createContext<PluginManagerContextType>({
  plugins: {},
  registerPlugin: () => {},
  getPlugin: () => null,
  pluginStatus: {},
  setPluginStatus: () => {},
  isReady: false,
});

// 插件管理器提供者组件
export const PluginManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [plugins, setPlugins] = useState<Record<string, any>>({});
  const [pluginStatus, setPluginStatus] = useState<Record<string, string>>({});
  const [isReady, setIsReady] = useState(false);

  // 注册插件
  const registerPlugin = (name: string, plugin: any) => {
    setPlugins(prev => ({
      ...prev,
      [name]: plugin,
    }));
    setPluginStatus(prev => ({
      ...prev,
      [name]: 'registered',
    }));
    console.log(`🔌 插件注册成功: ${name}`);
  };

  // 获取插件
  const getPlugin = (name: string) => {
    return plugins[name];
  };

  // 设置插件状态
  const setPluginStatusCallback = (name: string, status: string) => {
    setPluginStatus(prev => ({
      ...prev,
      [name]: status,
    }));
  };

  // 模拟插件初始化
  useEffect(() => {
    console.log('🚀 初始化插件管理器...');
    
    // 模拟插件加载过程
    const timer = setTimeout(() => {
      setIsReady(true);
      console.log('✅ 插件管理器初始化完成');
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <PluginManagerContext.Provider
      value={{
        plugins,
        registerPlugin,
        getPlugin,
        pluginStatus,
        setPluginStatus: setPluginStatusCallback,
        isReady,
      }}
    >
      {children}
    </PluginManagerContext.Provider>
  );
};

// 自定义钩子 - 获取插件管理器
export const usePluginManager = () => {
  const context = useContext(PluginManagerContext);
  if (!context) {
    throw new Error('usePluginManager必须在PluginManagerProvider内使用');
  }
  return context;
};

// 插件状态枚举
export const PluginStatus = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  FAILED: 'failed',
  LOADING: 'loading',
} as const;

export type PluginStatusType = typeof PluginStatus[keyof typeof PluginStatus];
