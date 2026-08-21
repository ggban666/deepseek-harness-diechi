"/*
蝶翅APP视觉识别页面
基于React + TypeScript实现的视觉识别界面

学习目标：
- 理解视觉识别功能实现
- 学习前端图像处理
- 掌握多模态AI交互
*/

import { useState } from 'react';
import { useVisionPlugin, VisionStatus } from '../plugins/vision-plugin';
import { Card, Typography, Space, Button, Progress, Alert, Image, Avatar, Divider } from '@arco-design/web-react';
import { IconUpload, IconCamera, IconDelete, IconCheckCircle, IconCloseCircle } from '@arco-design/web-react/icon';

const { Title, Text, Paragraph } = Typography;

export default function VisionPage() {
  const {
    isProcessing,
    imageFile,
    imageUrl,
    uploadImage,
    clearImage,
    recognizeImage,
    visionStatus,
    objects,
    scene,
  } = useVisionPlugin();

  const [description, setDescription] = useState('');
  const [showInstructions, setShowInstructions] = useState(true);

  // 处理图像上传
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      uploadImage(e.target.files[0]);
    }
  };

  // 处理图像识别
  const handleRecognize = async () => {
    if (imageFile) {
      const result = await recognizeImage();
      if (result.success) {
        setDescription(result.description);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 p-4">
      {/* 顶部标题 */}
      <div className="mb-6">
        <Card bordered={false} className="bg-white/80 backdrop-blur-sm">
          <Space direction="vertical" size="large">
            <Title heading={3} className="text-purple-600">
              👁️ 视觉识别中心
            </Title>
            
            <Text type="secondary">
              上传图像，获取AI生成的描述、物体检测和场景理解
            </Text>
          </Space>
        </Card>
      </div>

      {/* 主内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧 - 图像上传和处理 */}
        <div>
          <Card title="📷 图像上传" bordered={false} className="bg-white/80 backdrop-blur-sm h-full">
            <Space direction="vertical" size="large" className="w-full">
              
              {/* 上传控制 */}
              <div className="flex gap-4 justify-center">
                <Button
                  type="primary"
                  icon={<IconUpload />}
                  onClick={() => document.getElementById('image-upload')?.click()}
                  disabled={isProcessing || visionStatus === 'processing'}
                  className="w-32 h-32 rounded-full text-xl font-bold"
                >
                  上传图像
                </Button>
                
                <input
                  id="image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                
                {imageUrl && (
                  <Button
                    type="outline"
                    status="danger"
                    icon={<IconDelete />}
                    onClick={clearImage}
                    className="w-32 h-32 rounded-full text-xl font-bold"
                  >
                    清除
                  </Button>
                )}
              </div>

              {/* 相机拍照（模拟） */}
              <div className="text-center">
                <Button
                  type="secondary"
                  icon={<IconCamera />}
                  disabled={true}  // 简化版本，不实现相机功能
                  className="w-32 h-32 rounded-full text-xl font-bold"
                >
                  拍照
                </Button>
                <Text type="secondary" size="small" className="block mt-2">
                  相机功能（敬请期待）
                </Text>
              </div>

              {/* 处理状态 */}
              {visionStatus === 'uploading' && (
                <div className="mt-4">
                  <Progress
                    type="circle"
                    percent={50}
                    status="active"
                    strokeColor="#722ED1"
                    className="mx-auto"
                  />
                  <Text type="secondary" className="block text-center mt-2">
                    上传中...
                  </Text>
                </div>
              )}

              {visionStatus === 'processing' && (
                <div className="mt-4">
                  <Progress
                    type="circle"
                    percent={80}
                    status="active"
                    strokeColor="#722ED1"
                    className="mx-auto"
                  />
                  <Text type="secondary" className="block text-center mt-2">
                    AI分析中...
                  </Text>
                </div>
              )}

              {/* 状态提示 */}
              {visionStatus === 'error' && (
                <Alert type="error" title="处理失败" showIcon />
              )}

              {visionStatus === 'completed' && (
                <Alert type="success" title="识别完成" showIcon />
              )}

              {/* 操作按钮 */}
              {imageUrl && visionStatus !== 'processing' && (
                <div className="mt-4">
                  <Button
                    type="primary"
                    icon={<IconCheckCircle />}
                    onClick={handleRecognize}
                    loading={isProcessing}
                    className="w-full py-3 text-lg font-bold"
                  >
                    开始识别
                  </Button>
                </div>
              )}
            </Space>
          </Card>
        </div>

        {/* 右侧 - 识别结果 */}
        <div>
          <Card title="🔍 识别结果" bordered={false} className="bg-white/80 backdrop-blur-sm h-full">
            <Space direction="vertical" size="large" className="w-full">
              
              {/* 图像预览 */}
              {imageUrl ? (
                <div className="relative">
                  <Image
                    src={imageUrl}
                    alt="上传的图像"
                    className="w-full h-64 object-cover rounded-lg shadow-md"
                  />
                  <div className="absolute top-2 right-2 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full">
                    <Text size="small" className="text-purple-600 font-medium">
                      {imageFile?.name}
                    </Text>
                  </div>
                </div>
              ) : (
                <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Text type="secondary">请上传图像以开始识别</Text>
                </div>
              )}

              {/* 识别结果 */}
              {description && (
                <Card bordered={false} className="bg-purple-50">
                  <Space direction="vertical" size="medium">
                    <Title heading={5} className="text-purple-600">AI描述</Title>
                    <Paragraph className="text-gray-800">
                      {description}
                    </Paragraph>
                  </Space>
                </Card>
              )}

              {/* 物体检测 */}
              {objects.length > 0 && (
                <Card bordered={false} className="bg-purple-50">
                  <Space direction="vertical" size="medium">
                    <Title heading={5} className="text-purple-600">📦 检测到的物体 ({objects.length}个)</Title>
                    <div className="grid grid-cols-2 gap-3">
                      {objects.map((obj, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 bg-white rounded-lg shadow-sm">
                          <Avatar size="small" style={{ backgroundColor: '#722ED1' }}>
                            📦
                          </Avatar>
                          <div>
                            <Text strong className="block">{obj.name}</Text>
                            <Text type="secondary" size="small">
                              置信度: {(obj.confidence * 100).toFixed(1)}%
                            </Text>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Space>
                </Card>
              )}

              {/* 场景理解 */}
              {scene && (
                <Card bordered={false} className="bg-purple-50">
                  <Space direction="vertical" size="medium">
                    <Title heading={5} className="text-purple-600">🌆 场景理解</Title>
                    <div className="flex items-center gap-3 p-3 bg-white rounded-lg shadow-sm">
                      <Avatar size="small" style={{ backgroundColor: '#722ED1' }}>
                        🏞️
                      </Avatar>
                      <Text strong className="text-lg">{scene}</Text>
                    </div>
                  </Space>
                </Card>
              )}
            </Space>
          </Card>
        </div>
      </div>

      {/* 底部 - 使用说明 */}
      <div className="mt-6">
        <Card bordered={false} className="bg-white/80 backdrop-blur-sm">
          <Space direction="vertical" size="medium" className="w-full">
            <Title heading={5} className="text-purple-600">📝 使用说明</Title>
            
            {showInstructions && (
              <Alert
                type="info"
                title="如何使用视觉识别功能"
                showIcon
                onClose={() => setShowInstructions(false)}
                closable
              >
                <Paragraph>
                  1. 点击"上传图像"按钮选择图片文件
                  <br />2. 点击"开始识别"按钮进行AI分析
                  <br />3. 查看AI生成的描述、物体检测和场景理解
                  <br />4. 支持的图像格式：JPG, PNG, WebP
                  <br />5. 最大文件大小：10MB
                </Paragraph>
              </Alert>
            )}
            
            <Divider />
            
            <Paragraph type="secondary" className="text-center">
              🦋 蝶翅AI助手 - 让AI理解你的世界
            </Paragraph>
          </Space>
        </Card>
      </div>
    </div>
  );
}
