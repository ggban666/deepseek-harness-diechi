"/*
蝶翅APP语音插件 - 前端插件化架构
基于React Context实现语音功能

学习目标：
- 理解前端插件化架构
- 实现语音功能模块化
- 学习状态管理模式
*/

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// 语音插件上下文类型
interface VoicePluginContextType {
  isRecording: boolean;
  audioBlob: Blob | null;
  audioUrl: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearAudio: () => void;
  transcribeAudio: (audioFile: File) => Promise<{ text: string; success: boolean }>;
  voiceStatus: string;
  setVoiceStatus: (status: string) => void;
}

// 创建语音插件上下文
const VoicePluginContext = createContext<VoicePluginContextType>({
  isRecording: false,
  audioBlob: null,
  audioUrl: null,
  startRecording: async () => {},
  stopRecording: async () => {},
  clearAudio: () => {},
  transcribeAudio: async () => ({ text: '', success: false }),
  voiceStatus: 'idle',
  setVoiceStatus: () => {},
});

// 语音插件提供者组件
export const VoicePluginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<string>('idle');

  // 清除音频
  const clearAudio = useCallback(() => {
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioChunks([]);
    console.log('🧹 音频数据已清除');
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      setVoiceStatus('starting');
      console.log('🎤 开始录音...');
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setAudioChunks(prev => [...prev, event.data]);
        }
      };
      
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setAudioBlob(audioBlob);
        setAudioUrl(audioUrl);
        console.log('🎤 录音完成，音频已创建');
      };
      
      recorder.start(1000); // 每1秒收集一次数据
      setMediaRecorder(recorder);
      setIsRecording(true);
      setVoiceStatus('recording');
      
    } catch (error) {
      console.error('❌ 录音失败:', error);
      setVoiceStatus('error');
      throw error;
    }
  }, [audioChunks]);

  // 停止录音
  const stopRecording = useCallback(async () => {
    if (mediaRecorder && isRecording) {
      try {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        setVoiceStatus('processing');
        console.log('🛑 录音已停止');
      } catch (error) {
        console.error('❌ 停止录音失败:', error);
        setVoiceStatus('error');
        throw error;
      }
    }
  }, [mediaRecorder, isRecording]);

  // 语音转文字
  const transcribeAudio = useCallback(async (audioFile: File) => {
    try {
      setVoiceStatus('transcribing');
      console.log('🔤 开始语音转文字...');
      
      // 模拟语音转文字过程
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const resultText = `这是语音转换的结果：${audioFile.name}`;
      
      setVoiceStatus('completed');
      console.log('✅ 语音转文字完成');
      
      return { text: resultText, success: true };
    } catch (error) {
      console.error('❌ 语音转文字失败:', error);
      setVoiceStatus('error');
      return { text: '语音转换失败', success: false };
    }
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (mediaRecorder) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [mediaRecorder, audioUrl]);

  return (
    <VoicePluginContext.Provider
      value={{
        isRecording,
        audioBlob,
        audioUrl,
        startRecording,
        stopRecording,
        clearAudio,
        transcribeAudio,
        voiceStatus,
        setVoiceStatus,
      }}
    >
      {children}
    </VoicePluginContext.Provider>
  );
};

// 自定义钩子 - 获取语音插件
export const useVoicePlugin = () => {
  const context = useContext(VoicePluginContext);
  if (!context) {
    throw new Error('useVoicePlugin必须在VoicePluginProvider内使用');
  }
  return context;
};

// 语音状态枚举
export const VoiceStatus = {
  IDLE: 'idle',
  STARTING: 'starting',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  TRANSCRIBING: 'transcribing',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;

export type VoiceStatusType = typeof VoiceStatus[keyof typeof VoiceStatus];
