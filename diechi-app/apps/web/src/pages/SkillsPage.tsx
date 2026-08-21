"/*
蝶翅APP技能页面
基于React + TypeScript实现的Skill管理界面

学习目标：
- 理解Skill系统功能实现
- 学习前端状态管理
- 掌握专家系统交互
*/

import { useState, useEffect } from 'react';
import { useSkillPlugin, SkillStatus, DefaultSkills } from '../plugins/skill-plugin';
import { useChatPlugin } from '../plugins/chat-plugin';
import { Card, Typography, Space, Button, Progress, Alert, Avatar, Divider, Input } from '@arco-design/web-react';
import { IconRobot, IconUser, IconSwap, IconCheckCircle, IconCloseCircle, IconLoading } from '@arco-design/web-react/icon';

const { Title, Text, Paragraph } = Typography;

export default function SkillsPage() {
  const {
    skills,
    currentSkill,
    switchSkill,
    executeSkill,
    isExecuting,
    skillStatus,
  } = useSkillPlugin();

  const { sendMessage, messages } = useChatPlugin();
  const [userInput, setUserInput] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [showInstructions, setShowInstructions] = useState(true);

  // 处理Skill切换
  const handleSwitchSkill = async (skillType: string) => {
    const success = await switchSkill(skillType as any);
    if (success) {
      await sendMessage(`切换到${skillType}技能模式`);
    }
  };

  // 处理Skill执行
  const handleExecuteSkill = async () => {
    if (userInput.trim()) {
      const result = await executeSkill(userInput);
      setAiResponse(result.response);
      
      if (result.success) {
        await sendMessage(userInput);
        await sendMessage(result.response);
      }
      setUserInput('');
    }
  };

  // 处理回车键
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleExecuteSkill();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 p-4">
      {/* 顶部标题 */}
      <div className="mb-6">
        <Card bordered={false} className="bg-white/80 backdrop-blur-sm">
          <Space direction="vertical" size="large">
            <Title heading={3} className="text-green-600">
              🎯 技能中心
            </Title>
            
            <Text type="secondary">
              选择专家角色，获得专业AI助手服务
            </Text>
          </Space>
        </Card>
      </div>

      {/* 主内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧 - Skill选择 */}
        <div>
          <Card title="🎯 Skill选择" bordered={false} className="bg-white/80 backdrop-blur-sm h-full">
            <Space direction="vertical" size="large" className="w-full">
              
              <Paragraph type="secondary">
                选择一个专家角色来获得专业的AI助手服务
              </Paragraph>

              {/* Skill选项 */}
              <div className="grid grid-cols-2 gap-4">
                {skills.length > 0 ? (
                  skills.map((skill) => (
                    <Card
                      key={skill.type}
                      bordered={currentSkill?.type === skill.type}
                      className={`cursor-pointer transition-all ${currentSkill?.type === skill.type ? 'border-green-500 shadow-lg' : 'hover:shadow-md'}`}
                      onClick={() => handleSwitchSkill(skill.type)}
                    >
                      <div className="text-center">
                        <div className="text-3xl mb-2">
                          {skill.type === 'doctor' && '👨⚕️'}
                          {skill.type === 'teacher' && '👩🏫'}
                          {skill.type === 'chef' && '👨🍳'}
                          {skill.type === 'engineer' && '👨💻'}
                          {skill.type === 'default' && '🤖'}
                        </div>
                        <Text strong className={currentSkill?.type === skill.type ? 'text-green-600' : ''}>
                          {skill.name}
                        </Text>
                        <Paragraph type="secondary" size="small" className="mt-1">
                          {skill.description}
                        </Paragraph>
                        {skill.isCurrent && (
                          <Text type="success" size="small">
                            ✅ 当前激活
                          </Text>
                        )}
                      </div>
                    </Card>
                  ))
                ) : (
                  DefaultSkills.map((skill) => (
                    <Card
                      key={skill.type}
                      bordered={false}
                      className="cursor-pointer hover:shadow-md transition-all"
                      onClick={() => handleSwitchSkill(skill.type)}
                    >
                      <div className="text-center">
                        <div className="text-3xl mb-2">
                          {skill.type === 'doctor' && '👨⚕️'}
                          {skill.type === 'teacher' && '👩🏫'}
                          {skill.type === 'chef' && '👨🍳'}
                          {skill.type === 'engineer' && '👨💻'}
                          {skill.type === 'default' && '🤖'}
                        </div>
                        <Text strong>
                          {skill.name}
                        </Text>
                        <Paragraph type="secondary" size="small" className="mt-1">
                          {skill.description}
                        </Paragraph>
                      </div>
                    </Card>
                  ))
                )}
              </div>

              {/* 当前Skill详情 */}
              {currentSkill && (
                <Card bordered={false} className="bg-green-50">
                  <Space direction="vertical">
                    <Title heading={5} className="text-green-600">当前Skill详情</Title>
                    <Text strong className="text-lg">{currentSkill.name}</Text>
                    <Paragraph type="secondary">
                      {currentSkill.description}
                    </Paragraph>
                    <Text type="secondary" size="small">
                      技能类型: {currentSkill.type}
                    </Text>
                  </Space>
                </Card>
              )}

              {/* Skill状态 */}
              {skillStatus === 'switching' && (
                <Alert type="info" title="正在切换技能..." showIcon />
              )}

              {skillStatus === 'error' && (
                <Alert type="error" title="技能切换失败" showIcon />
              )}

              {skillStatus === 'switched' && (
                <Alert type="success" title="技能切换成功！" showIcon />
              )}
            </Space>
          </Card>
        </div>

        {/* 右侧 - Skill执行 */}
        <div>
          <Card title="🚀 Skill执行" bordered={false} className="bg-white/80 backdrop-blur-sm h-full">
            <Space direction="vertical" size="large" className="w-full">
              
              <Paragraph type="secondary">
                在当前技能下执行专业AI助手服务
              </Paragraph>

              {/* 输入区域 */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <Space direction="vertical" size="medium" className="w-full">
                  <Text strong>请输入您的问题或需求：</Text>
                  
                  <Input.TextArea
                    value={userInput}
                    onChange={(value) => setUserInput(value)}
                    placeholder="例如：我感冒了怎么办？请教我Python编程..."
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    onKeyPress={handleKeyPress}
                    disabled={isExecuting}
                  />
                  
                  <div className="flex gap-2">
                    <Button
                      type="primary"
                      icon={<IconRobot />}
                      onClick={handleExecuteSkill}
                      loading={isExecuting}
                      disabled={!userInput.trim() || isExecuting}
                      className="flex-1 py-3 text-lg font-bold"
                    >
                      执行Skill
                    </Button>
                    
                    <Button
                      type="outline"
                      status="danger"
                      icon={<IconCloseCircle />}
                      onClick={() => setUserInput('')}
                      disabled={!userInput.trim()}
                    >
                      清除
                    </Button>
                  </div>
                </Space>
              </div>

              {/* 执行状态 */}
              {skillStatus === 'executing' && (
                <div className="mt-4">
                  <Progress
                    type="circle"
                    percent={75}
                    status="active"
                    strokeColor="#00B42A"
                    className="mx-auto"
                  />
                  <Text type="secondary" className="block text-center mt-2">
                    AI助手正在思考...
                  </Text>
                </div>
              )}

              {skillStatus === 'completed' && aiResponse && (
                <Alert type="success" title="Skill执行完成" showIcon />
              )}

              {skillStatus === 'error' && (
                <Alert type="error" title="Skill执行失败" showIcon />
              )}

              {/* AI响应 */}
              {aiResponse && (
                <Card bordered={false} className="bg-green-50">
                  <Space direction="vertical" size="medium">
                    <Title heading={5} className="text-green-600">🤖 AI助手响应</Title>
                    <Paragraph className="text-gray-800 whitespace-pre-wrap">
                      {aiResponse}
                    </Paragraph>
                    
                    {skillStatus === 'completed' && (
                      <div className="flex gap-4 text-sm text-gray-600">
                        <Text>⏱️ 执行时间: {skillStatus === 'completed' ? '约2秒' : 'N/A'}</Text>
                        <Text>📊 Token使用: {skillStatus === 'completed' ? '约50' : 'N/A'}</Text>
                      </div>
                    )}
                  </Space>
                </Card>
              )}

              {/* 对话历史 */}
              <Card title="💬 对话历史" bordered={false} className="bg-white/80">
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {messages.slice(-5).map((message, index) => (
                    <div key={index} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex-shrink-0 ${message.role === 'user' ? 'order-2' : 'order-1'}`}>
                        <Avatar
                          style={{ backgroundColor: message.role === 'user' ? '#00B42A' : '#168CFF' }}
                        >
                          {message.role === 'user' ? '👤' : '🤖'}
                        </Avatar>
                      </div>
                      
                      <div className={`max-w-[80%] ${message.role === 'user' ? 'order-1' : 'order-2'}`}>
                        <Card
                          bordered={false}
                          className={`rounded-lg ${message.role === 'user' ? 'bg-green-50' : 'bg-blue-50'}`}
                        >
                          <Paragraph className="whitespace-pre-wrap">{message.content}</Paragraph>
                        </Card>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </Space>
          </Card>
        </div>
      </div>

      {/* 底部 - 使用说明 */}
      <div className="mt-6">
        <Card bordered={false} className="bg-white/80 backdrop-blur-sm">
          <Space direction="vertical" size="medium" className="w-full">
            <Title heading={5} className="text-green-600">📝 使用说明</Title>
            
            {showInstructions && (
              <Alert
                type="info"
                title="如何使用Skill系统"
                showIcon
                onClose={() => setShowInstructions(false)}
                closable
              >
                <Paragraph>
                  1. 🎯 **选择技能**: 点击左侧的技能卡片切换专家角色
                  <br />2. 💬 **输入问题**: 在右侧输入框中输入您的问题或需求
                  <br />3. 🚀 **执行Skill**: 点击"执行Skill"按钮获取专业回复
                  <br />4. 📊 **查看结果**: 在下方查看AI助手的专业响应
                  <br />5. 🔄 **切换技能**: 可以随时切换不同的专家角色
                </Paragraph>
              </Alert>
            )}
            
            <Divider />
            
            <Paragraph type="secondary" className="text-center">
              🦋 蝶翅AI助手 - 每个技能都是领域专家
            </Paragraph>
          </Space>
        </Card>
      </div>
    </div>
  );
}
