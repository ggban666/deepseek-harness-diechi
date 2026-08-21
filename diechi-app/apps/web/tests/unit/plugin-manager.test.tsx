/**
 * 蝶翅APP - 插件管理器单元测试
 * 基于Jest框架的插件管理器测试
 *
 * 测试内容：
 * - 插件注册和管理
 * - 插件状态管理
 * - 服务发现
 * - 上下文提供
 *
 * 学习目标：
 * - 掌握Jest测试框架
 * - 实现前端组件测试
 * - 学习React Context测试
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { PluginManagerProvider, usePluginManager } from '../../src/plugins/plugin-manager';

describe('插件管理器单元测试', () => {
  test('插件管理器初始化', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    expect(result.current).toBeDefined();
    expect(result.current.plugins).toEqual({});
    expect(result.current.pluginStatus).toEqual({});
    expect(result.current.isReady).toBe(false);
  });

  test('插件注册功能', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    // 模拟插件注册
    act(() => {
      result.current.registerPlugin('test-plugin', { name: '测试插件' });
    });
    
    expect(result.current.plugins).toHaveProperty('test-plugin');
    expect(result.current.plugins['test-plugin']).toEqual({ name: '测试插件' });
    expect(result.current.pluginStatus).toHaveProperty('test-plugin');
    expect(result.current.pluginStatus['test-plugin']).toBe('registered');
  });

  test('获取插件实例', () => {
    const mockPlugin = { name: '测试插件', version: '1.0.0' };
    
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    // 注册插件
    act(() => {
      result.current.registerPlugin('test-plugin', mockPlugin);
    });
    
    // 获取插件
    const plugin = result.current.getPlugin('test-plugin');
    
    expect(plugin).toEqual(mockPlugin);
    expect(plugin).toHaveProperty('name', '测试插件');
    expect(plugin).toHaveProperty('version', '1.0.0');
  });

  test('插件状态管理', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    // 设置插件状态
    act(() => {
      result.current.setPluginStatus('test-plugin', 'ready');
    });
    
    expect(result.current.pluginStatus).toHaveProperty('test-plugin', 'ready');
  });

  test('插件管理器就绪状态', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    // 模拟插件初始化完成
    act(() => {
      result.current.setPluginStatus('voice-plugin', 'ready');
      result.current.setPluginStatus('chat-plugin', 'ready');
    });
    
    expect(result.current.isReady).toBe(false); // 所有插件都就绪才是true
    
    // 所有插件就绪
    act(() => {
      result.current.setPluginStatus('vision-plugin', 'ready');
      result.current.setPluginStatus('skill-plugin', 'ready');
    });
    
    expect(result.current.isReady).toBe(true);
  });

  test('错误处理 - 获取不存在的插件', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    const plugin = result.current.getPlugin('non-existent-plugin');
    
    expect(plugin).toBeUndefined();
    expect(plugin).toBeFalsy();
  });

  test('插件管理器渲染', () => {
    const { container } = render(
      <PluginManagerProvider>
        <div data-testid="test-content">测试内容</div>
      </PluginManagerProvider>
    );
    
    expect(container).toBeInTheDocument();
    expect(container.querySelector('[data-testid="test-content"]')).toBeInTheDocument();
  });

  test('多插件注册', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { result } = renderHook(() => usePluginManager(), { wrapper });
    
    // 注册多个插件
    const plugins = {
      'voice-plugin': { name: '语音插件' },
      'chat-plugin': { name: '对话插件' },
      'vision-plugin': { name: '视觉识别插件' },
      'skill-plugin': { name: 'Skill系统插件' }
    };
    
    Object.entries(plugins).forEach(([name, plugin]) => {
      act(() => {
        result.current.registerPlugin(name, plugin);
      });
    });
    
    // 验证所有插件都已注册
    Object.keys(plugins).forEach(name => {
      expect(result.current.plugins).toHaveProperty(name);
      expect(result.current.pluginStatus).toHaveProperty(name, 'registered');
    });
    
    expect(Object.keys(result.current.plugins).length).toBe(4);
  });

  test('插件管理器卸载', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginManagerProvider>{children}</PluginManagerProvider>
    );

    const { unmount } = renderHook(() => usePluginManager(), { wrapper });
    
    // 卸载组件
    unmount();
    
    // 验证组件已卸载
    // (在Jest中，组件卸载后hook会保持最后状态)
  });
});
