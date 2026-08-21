"/*
蝶翅APP主应用组件
基于React + TypeScript的插件化架构

学习目标：
- 理解插件化前端架构
- 实现模块化组件设计
- 学习状态管理最佳实践
*/

import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme } from '@arco-design/web-react';
import { VoicePluginProvider } from './plugins/voice-plugin';
import { ChatPluginProvider } from './plugins/chat-plugin';
import { VisionPluginProvider } from './plugins/vision-plugin';
import { SkillPluginProvider } from './plugins/skill-plugin';
import { PluginManagerProvider } from './plugins/plugin-manager';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';
import SkillsPage from './pages/SkillsPage';
import VisionPage from './pages/VisionPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import './App.css';

// 主应用组件
function App() {
  const [mounted, setMounted] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // 应用启动时的初始化
    console.log('🚀 蝶翅APP前端应用启动...');
    setMounted(true);
    
    // 检查用户偏好主题
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setThemeMode(savedTheme);
    }
    
    return () => {
      console.log('🔌 蝶翅APP前端应用卸载');
    };
  }, []);

  if (!mounted) {
    return <div className="loading-container">
      <div className="loading-spinner"></div>
      <p>加载中...</p>
    </div>;
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#4080FF',
          borderRadius: 4,
        },
        component: {
          padding: 16,
        },
      }}
      themeConfig={{
        theme: themeMode,
        settings: {
          primaryColor: '#4080FF',
          theme: themeMode,
        },
      }}
    >
      <PluginManagerProvider>
        <VoicePluginProvider>
          <ChatPluginProvider>
            <VisionPluginProvider>
              <SkillPluginProvider>
                <Router>
                  <Routes>
                    <Route path="/" element={<Navigate to="/home" replace />} />
                    <Route path="/home" element={<HomePage />} />
                    <Route path="/chat" element={<ChatPage />} />
                    <Route path="/vision" element={<VisionPage />} />
                    <Route path="/skills" element={<SkillsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Router>
              </SkillPluginProvider>
            </VisionPluginProvider>
          </ChatPluginProvider>
        </VoicePluginProvider>
      </PluginManagerProvider>
    </ConfigProvider>
  );
}

export default App;