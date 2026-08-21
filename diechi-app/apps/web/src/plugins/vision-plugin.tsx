"/*
蝶翅APP视觉识别插件 - 前端插件化架构
基于React Context实现视觉识别功能

学习目标：
- 理解前端插件化架构
- 实现视觉识别功能模块化
- 学习状态管理模式
*/

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// 视觉识别上下文类型
interface VisionPluginContextType {
  isProcessing: boolean;
  imageFile: File | null;
  imageUrl: string | null;
  uploadImage: (file: File) => Promise<void>;
  clearImage: () => void;
  recognizeImage: () => Promise<{ description: string; success: boolean }>;
  visionStatus: string;
  setVisionStatus: (status: string) => void;
  objects: Array<{ name: string; confidence: number }>;
  scene: string | null;
}

// 创建视觉识别上下文
const VisionPluginContext = createContext<VisionPluginContextType>({
  isProcessing: false,
  imageFile: null,
  imageUrl: null,
  uploadImage: async () => {},
  clearImage: () => {},
  recognizeImage: async () => ({ description: '', success: false }),
  visionStatus: 'idle',
  setVisionStatus: () => {},
  objects: [],
  scene: null,
});

// 视觉识别插件提供者组件
export const VisionPluginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [visionStatus, setVisionStatus] = useState<string>('idle');
  const [objects, setObjects] = useState<Array<{ name: string; confidence: number }>>([]);
  const [scene, setScene] = useState<string | null>(null);

  // 上传图像
  const uploadImage = useCallback(async (file: File) => {
    try {
      setVisionStatus('uploading');
      setIsProcessing(true);
      console.log('📷 上传图像:', file.name);
      
      // 创建预览URL
      const url = URL.createObjectURL(file);
      setImageFile(file);
      setImageUrl(url);
      setObjects([]);
      setScene(null);
      
      setVisionStatus('uploaded');
    } catch (error) {
      console.error('❌ 上传图像失败:', error);
      setVisionStatus('error');
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // 清除图像
  const clearImage = useCallback(() => {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
    setImageFile(null);
    setImageUrl(null);
    setObjects([]);
    setScene(null);
    setVisionStatus('idle');
    console.log('🧹 图像数据已清除');
  }, [imageUrl]);

  // 图像识别
  const recognizeImage = useCallback(async () => {
    try {
      if (!imageFile) {
        throw new Error('请先上传图像');
      }
      
      setVisionStatus('processing');
      setIsProcessing(true);
      console.log('🔍 开始图像识别:', imageFile.name);
      
      // 模拟图像识别过程
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 生成模拟识别结果
      const mockObjects = [
        { name: '人', confidence: 0.95 },
        { name: '椅子', confidence: 0.88 },
        { name: '电脑', confidence: 0.92 },
      ];
      
      const mockScene = '办公室';
      const mockDescription = `这是一个办公室场景，包含人、椅子、电脑等物体。图像描述：办公室内有一个人正在使用电脑。`;
      
      // 更新状态
      setObjects(mockObjects);
      setScene(mockScene);
      setVisionStatus('completed');
      
      console.log('✅ 图像识别完成');
      return { description: mockDescription, success: true };
      
    } catch (error) {
      console.error('❌ 图像识别失败:', error);
      setVisionStatus('error');
      return { description: '图像识别失败', success: false };
    } finally {
      setIsProcessing(false);
    }
  }, [imageFile]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  return (
    <VisionPluginContext.Provider
      value={{
        isProcessing,
        imageFile,
        imageUrl,
        uploadImage,
        clearImage,
        recognizeImage,
        visionStatus,
        setVisionStatus,
        objects,
        scene,
      }}
    >
      {children}
    </VisionPluginContext.Provider>
  );
};

// 自定义钩子 - 获取视觉识别插件
export const useVisionPlugin = () => {
  const context = useContext(VisionPluginContext);
  if (!context) {
    throw new Error('useVisionPlugin必须在VisionPluginProvider内使用');
  }
  return context;
};

// 视觉状态枚举
export const VisionStatus = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;

export type VisionStatusType = typeof VisionStatus[keyof typeof VisionStatus];
