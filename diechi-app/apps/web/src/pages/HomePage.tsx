"/*
蝶翅APP主页面 - 核心用户界面
基于React + TypeScript实现

学习目标：
- 理解前端组件化架构
- 实现响应式设计
- 学习状态管理最佳实践
*/

import { useState, useEffect } from 'react';
import { useVoicePlugin, VoiceStatus } from '../plugins/voice-plugin';
import { useChatPlugin, ChatStatus, Skills } from '../plugins/chat-plugin';
import { usePluginManager } from '../plugins/plugin-manager';
import { Button, Card, Typography, Space, Avatar, Progress, Alert } from '@arco-design/web-react';

const { Title, Text, Paragraph } = Typography;

export default function HomePage() {
  const { 
    isRecording, 
    audioUrl, 
    startRecording, 
    stopRecording, 
    clearAudio, 
    transcribeAudio,
    voiceStatus,
    setVoiceStatus
  } = useVoicePlugin();

  const { 
    messages, 
    sendMessage, 
    isSending,
    chatStatus,
    currentSkill,
    setCurrentSkill
  } = useChatPlugin();

  const { plugins, isReady } = usePluginManager();
  const [lastMessage, setLastMessage] = useState<string>('');
  const [showInstructions, setShowInstructions] = useState(true);

  // 处理语音输入
  const handleVoiceInput = async () => {
    try {
      if (!isRecording) {
        await startRecording();
      } else {
        await stopRecording();
        
        if (audioUrl) {
          setVoiceStatus('transcribing');
          const result = await transcribeAudio(new File([], 'recording.wav'));
          setLastMessage(result.text);
          
          if (result.success) {
            await sendMessage(result.text);
          }
        }
      }
    } catch (error) {
      console.error('处理语音输入失败:', error);
      setVoiceStatus('error');
    }
  };

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVoiceStatus('transcribing');
      const result = await transcribeAudio(e.target.files[0]);
      setLastMessage(result.text);
      
      if (result.success) {
        await sendMessage(result.text);
      }
    }
  };

  // 技能选择处理
  const handleSkillChange = (skill: SkillType) => {
    setCurrentSkill(skill);
    console.log(`🎯 当前技能已切换为: ${skill}`);
  };

  // 组件加载时检查插件状态
  useEffect(() => {
    console.log('📊 插件系统状态:', plugins);
    console.log('🎤 语音插件状态:', { isRecording, voiceStatus });
    console.log('💬 对话插件状态:', { isSending, chatStatus });
  }, [plugins, isRecording, voiceStatus, isSending, chatStatus]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      {/* 顶部状态栏 */}
      <div className="mb-6">
        <Card bordered={false} className="bg-white/80 backdrop-blur-sm">
          <Space direction="vertical" size="large">
            <Title heading={3} className="text-blue-600">
              🦋 蝶翅AI助手
            </Title>
            
            <div className="flex gap-4">
              <div className="flex-1">
                <Text type="secondary">语音状态：</Text>
                <Text strong className={
                  voiceStatus === 'error' ? 'text-red-600' : 
                  voiceStatus === 'completed' ? 'text-green-600' : 'text-blue-600'
                }>
                  {voiceStatus}
                </Text>
              </div>
              
              <div className="flex-1">
                <Text type="secondary">对话状态：</Text>
                <Text strong className={
                  chatStatus === 'error' ? 'text-red-600' : 
                  chatStatus === 'completed' ? 'text-green-600' : 'text-blue-600'
                }>
                  {chatStatus}
                </Text>
              </div>
            </div>
            
            <div className="flex gap-4">
              <div className="flex-1">
                <Text type="secondary">当前技能：</Text>
                <Text strong className="text-purple-600">
                  {currentSkill}
                </Text>
              </div>
              
              <div className="flex-1">
                <Text type="secondary">插件系统：</Text>
                <Text strong className={isReady ? 'text-green-600' : 'text-orange-600'}>
                  {isReady ? '已就绪' : '初始化中...'}
                </Text>
              </div>
            </div>
          </Space>
        </Card>
      </div>

      {/* 主内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧 - 语音控制 */}
        <div>
          <Card title="🎤 语音控制" bordered={false} className="bg-white/80 backdrop-blur-sm h-full">
            <Space direction="vertical" size="large" className="w-full">
              
              {/* 录音控制按钮 */}
              <div className="flex gap-4 justify-center">
                <Button
                  type={isRecording ? 'primary' : 'secondary'}
                  status={isRecording ? 'danger' : 'normal'}
                  size="large"
                  icon={isRecording ? '🛑' : '🎤'}
                  onClick={handleVoiceInput}
                  className="w-32 h-32 rounded-full text-2xl font-bold"
                >
                  {isRecording ? '停止录音' : '开始录音'}
                </Button>
                
                <Button
                  type="outline"
                  status="normal"
                  size="large"
                  icon="📁"
                  onClick={() => document.getElementById('file-upload')?.click()}
                  className="w-32 h-32 rounded-full text-2xl font-bold"
                >
                  上传音频
                </Button>
                
                <input
                  id="file-upload"
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {/* 录音状态进度 */}
              {voiceStatus === 'recording' && (
                <div className="mt-4">
                  <Progress
                    type="circle"
                    percent={100}
                    status="active"
                    strokeColor="#4080FF"
                    className="mx-auto"
                  />
                  <Text type="secondary" className="block text-center mt-2">
                    录音中... {Math.floor(audioChunks.length)} 秒
                  </Text>
                </div>
              )}

              {/* 语音状态提示 */}
              {voiceStatus === 'error' && (
                <Alert type="error" title="语音处理失败" showIcon />
              )}

              {voiceStatus === 'completed' && audioUrl && (
                <div className="mt-4">
                  <audio controls src={audioUrl} className="w-full" />
                  <Button
                    type="text"
                    status="danger"
                    icon="delete"
                    onClick={clearAudio}
                    className="mt-2"
                  >
                    清除音频
                  </Button>
                </div>
              )}
            </Space>
          </Card>
        </div>

        {/* 右侧 - 技能选择 */}
        <div>
          <Card title="🎯 技能选择" bordered={false} className="bg-white/80 backdrop-blur-sm h-full">
            <Space direction="vertical" size="large" className="w-full">
              
              <Paragraph type="secondary">
                选择一个专家角色来获得专业的AI助手服务
              </Paragraph>

              {/* 技能选项 */}
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(Skills).map(([key, skill]) => (
                  <Card
                    key={key}
                    bordered={currentSkill !== skill}
                    className={`cursor-pointer transition-all ${currentSkill === skill ? 'border-blue-500 shadow-lg' : 'hover:shadow-md'}`}
                    onClick={() => handleSkillChange(skill)}
                  >
                    <div className="text-center">
                      <div className="text-3xl mb-2">
                        {skill === 'doctor' && '👨⚕️'}
                        {skill === 'teacher' && '👩🏫'}
                        {skill === 'chef' && '👨🍳'}
                        {skill === 'engineer' && '👨💻'}
                        {skill === 'default' && '🤖'}
                      </div>
                      <Text strong className={currentSkill === skill ? 'text-blue-600' : ''}>
                        {skill === 'doctor' && '医生'}
                        {skill === 'teacher' && '老师'}
                        {skill === 'chef' && '厨师'}
                        {skill === 'engineer' && '工程师'}
                        {skill === 'default' && '通用助手'}
                      </Text>
                    </div>
                  </Card>
                ))}
              </div>

              {/* 当前技能详情 */}
              <Card bordered={false} className="bg-blue-50">
                <Space direction="vertical">
                  <Title heading={5} className="text-blue-600">当前技能详情</Title>
                  <Text>
                    {currentSkill === 'doctor' && '专业医疗健康咨询服务'}
                    {currentSkill === 'teacher' && '专业教育辅导和知识传授'}
                    {currentSkill === 'chef' && '专业烹饪指导和食谱推荐'}
                    {currentSkill === 'engineer' && '专业技术咨询和问题解决'}
                    {currentSkill === 'default' && '通用AI助手，适合各种日常问题'}
                  </Text>
                </Space>
              </Card>
            </Space>
          </Card>
        </div>
      </div>

      {/* 底部 - 对话区域 */}
      <div className="mt-6">
        <Card title="💬 对话记录" bordered={false} className="bg-white/80 backdrop-blur-sm">
          <Space direction="vertical" size="medium" className="w-full">
            
            {/* 使用说明 */}
            {showInstructions && (
              <Alert
                type="info"
                title="使用说明"
                showIcon
                onClose={() => setShowInstructions(false)}
                closable
              >
                <Paragraph>
                  1. 点击"开始录音"按钮开始录制语音
                  <br />2. 点击"停止录音"结束录制
                  <br />3. 系统将自动转换语音为文字并生成AI回复
                  <br />4. 选择不同的技能角色获得专业服务
                </Paragraph>
              </Alert>
            )}

            {/* 对话消息列表 */}
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex-shrink-0 ${message.role === 'user' ? 'order-2' : 'order-1'}`}>
                    <Avatar
                      style={{ backgroundColor: message.role === 'user' ? '#4080FF' : '#168CFF' }}
                    >
                      {message.role === 'user' ? '👤' : '🤖'}
                    </Avatar>
                  </div>
                  
                  <div className={`max-w-[80%] ${message.role === 'user' ? 'order-1' : 'order-2'}`}>
                    <Card
                      bordered={false}
                      className={`rounded-lg ${message.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}
                    >
                      <Paragraph className="whitespace-pre-wrap">{message.content}</Paragraph>
                      <Text type="secondary" size="small">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </Text>
                    </Card>
                  </div>
                </div>
              ))}
            </div>

            {/* 对话输入区域 */}
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <Space direction="vertical" size="medium" className="w-full">
                <Text type="secondary">
                  最后输入：{lastMessage || '无'}
                </Text>
                
                <div className="flex gap-2">
                  <Button
                    type="primary"
                    icon="send"
                    loading={isSending}
                    disabled={isSending || !lastMessage}
                    onClick={() => lastMessage && sendMessage(lastMessage)}
                    className="flex-1"
                  >
                    发送消息
                  </Button>
                  
                  <Button
                    type="outline"
                    status="danger"
                    icon="delete"
                    onClick={() => {
                      clearAudio();
                      setLastMessage('');
                    }}
                  >
                    清除
                  </Button>
                </div>
              </Space>
            </div>
          </Space>
        </Card>
      </div>
    </div>
  );
}
