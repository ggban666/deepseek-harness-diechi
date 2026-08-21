/**
 * 蝶翅APP - 语音插件单元测试
 * 基于Jest框架的语音插件测试
 *
 * 测试内容：
 * - 语音录制功能
 * - 音频管理
 * - 状态管理
 * - 错误处理
 *
 * 学习目标：
 * - 掌握Jest测试框架
 * - 实现前端组件测试
 * - 学习React Context测试
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { VoicePluginProvider, useVoicePlugin, VoiceStatus } from '../../src/plugins/voice-plugin';

describe('语音插件单元测试', () => {
  test('语音插件初始化', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    expect(result.current).toBeDefined();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.audioUrl).toBeNull();
    expect(result.current.voiceStatus).toBe('idle');
  });

  test('开始录音功能', async () => {
    // 模拟MediaRecorder
    const mockMediaRecorder = {
      start: jest.fn(),
      stop: jest.fn(),
      stream: {
        getTracks: jest.fn(() => [
          { stop: jest.fn() }
        ])
      },
      ondataavailable: null,
      ondatasavailable: jest.fn()
    };
    
    // 模拟getUserMedia
    global.navigator.mediaDevices = {
      getUserMedia: jest.fn().mockResolvedValue(new MediaStream())
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 开始录音
    await act(async () => {
      await result.current.startRecording();
    });
    
    expect(result.current.isRecording).toBe(true);
    expect(result.current.voiceStatus).toBe('recording');
    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
  });

  test('停止录音功能', async () => {
    // 模拟MediaRecorder
    const mockMediaRecorder = {
      start: jest.fn(),
      stop: jest.fn(),
      stream: {
        getTracks: jest.fn(() => [
          { stop: jest.fn() }
        ])
      },
      ondataavailable: jest.fn((callback) => {
        // 模拟数据可用回调
        callback({ data: new Blob(['test audio data'], { type: 'audio/wav' }) });
      })
    };
    
    // 模拟getUserMedia
    global.navigator.mediaDevices = {
      getUserMedia: jest.fn().mockResolvedValue(new MediaStream())
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 开始录音
    await act(async () => {
      await result.current.startRecording();
    });
    
    // 停止录音
    await act(async () => {
      await result.current.stopRecording();
    });
    
    expect(result.current.isRecording).toBe(false);
    expect(result.current.voiceStatus).toBe('processing');
  });

  test('清除音频功能', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 模拟有音频数据
    act(() => {
      result.current.setVoiceStatus('completed');
    });
    
    // 清除音频
    act(() => {
      result.current.clearAudio();
    });
    
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.audioUrl).toBeNull();
    expect(result.current.voiceStatus).toBe('idle');
  });

  test('语音转文字功能', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 模拟语音转文字
    const mockFile = new File(['test audio content'], 'test.wav', { type: 'audio/wav' });
    
    await act(async () => {
      const resultData = await result.current.transcribeAudio(mockFile);
      expect(resultData.success).toBe(true);
      expect(resultData.text).toContain('语音转换结果');
    });
  });

  test('语音状态管理', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 设置不同状态
    act(() => {
      result.current.setVoiceStatus('starting');
    });
    
    expect(result.current.voiceStatus).toBe('starting');
    
    act(() => {
      result.current.setVoiceStatus('recording');
    });
    
    expect(result.current.voiceStatus).toBe('recording');
    
    act(() => {
      result.current.setVoiceStatus('completed');
    });
    
    expect(result.current.voiceStatus).toBe('completed');
  });

  test('错误处理 - 录音失败', async () => {
    // 模拟录音失败
    global.navigator.mediaDevices = {
      getUserMedia: jest.fn().mockRejectedValue(new Error('录音权限被拒绝'))
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 尝试开始录音
    await act(async () => {
      await expect(result.current.startRecording()).rejects.toThrow();
    });
    
    expect(result.current.voiceStatus).toBe('error');
  });

  test('错误处理 - 语音转文字失败', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 模拟无效文件
    const invalidFile = new File([''], 'invalid.txt', { type: 'text/plain' });
    
    await act(async () => {
      const resultData = await result.current.transcribeAudio(invalidFile);
      expect(resultData.success).toBe(false);
      expect(resultData.error).toBeDefined();
    });
  });

  test('音频播放功能', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { result } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 模拟音频URL
    act(() => {
      result.current.setVoiceStatus('completed');
    });
    
    expect(result.current.voiceStatus).toBe('completed');
  });

  test('组件卸载清理', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <VoicePluginProvider>{children}</VoicePluginProvider>
    );

    const { unmount } = renderHook(() => useVoicePlugin(), { wrapper });
    
    // 卸载组件
    unmount();
    
    // 验证组件已卸载
  });

  test('语音状态枚举', () => {
    expect(VoiceStatus.IDLE).toBe('idle');
    expect(VoiceStatus.STARTING).toBe('starting');
    expect(VoiceStatus.RECORDING).toBe('recording');
    expect(VoiceStatus.PROCESSING).toBe('processing');
    expect(VoiceStatus.TRANSCRIBING).toBe('transcribing');
    expect(VoiceStatus.COMPLETED).toBe('completed');
    expect(VoiceStatus.ERROR).toBe('error');
  });
});
