"""
蝶翅APP - 对话插件
基于DeepSeek Harness插件化架构实现

插件功能：
- DeepSeek API集成
- 对话上下文管理
- 多轮对话支持
- 智能回复生成

学习目标：
- 理解Harness插件系统
- 实现模块化服务
- 学习事件驱动架构
"""

import os
import time
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
import httpx
from pydantic import BaseModel

# 设置日志
logger = logging.getLogger(__name__)


@dataclass
class ChatPluginConfig:
    """对话插件配置"""
    api_key: str = "test-api-key"
    base_url: str = "https://api.deepseek.com/v1/chat/completions"
    default_model: str = "deepseek-chat"
    max_tokens: int = 256
    temperature: float = 0.7
    context_window: int = 10  # 对话上下文窗口大小


class ChatMessage(BaseModel):
    """对话消息模型"""
    role: str  # "user" or "assistant"
    content: str
    timestamp: float = time.time()


class ChatContext:
    """对话上下文管理（学习Harness的状态管理）
    
    实现类似Harness的上下文管理机制
    """
    
    def __init__(self, window_size: int = 10):
        self.window_size = window_size
        self.messages: List[ChatMessage] = []
    
    def add_message(self, role: str, content: str) -> None:
        """添加消息到上下文"""
        message = ChatMessage(role=role, content=content)
        self.messages.append(message)
        
        # 保持上下文窗口大小
        if len(self.messages) > self.window_size:
            self.messages = self.messages[-self.window_size:]
    
    def get_context(self) -> List[Dict[str, Any]]:
        """获取上下文数据（格式化为API请求格式）"""
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.messages
        ]
    
    def clear(self) -> None:
        """清空上下文"""
        self.messages = []
    
    def get_summary(self) -> Dict[str, Any]:
        """获取上下文摘要"""
        return {
            "total_messages": len(self.messages),
            "user_messages": len([m for m in self.messages if m.role == "user"]),
            "assistant_messages": len([m for m in self.messages if m.role == "assistant"]),
            "last_message_time": self.messages[-1].timestamp if self.messages else None
        }


class ChatPlugin:
    """
    对话插件 - Harness插件系统实现
    
    学习DeepSeek Harness的插件化架构：
    - 插件初始化
    - 服务注册
    - 事件处理
    - 配置管理
    - 上下文管理
    """
    
    def __init__(self, config: Optional[ChatPluginConfig] = None):
        """插件初始化
        
        Args:
            config: 插件配置，如果为None则使用默认配置
        """
        self.config = config or ChatPluginConfig()
        self._status: str = "initializing"
        self._stats: Dict[str, Any] = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "avg_response_time": 0,
            "last_used": None,
            "errors": []
        }
        
        # 初始化对话上下文
        self.context = ChatContext(window_size=self.config.context_window)
        
        logger.info(f"💬 对话插件初始化 - 模型: {self.config.default_model}")
        self._initialize_plugin()
    
    def _initialize_plugin(self) -> None:
        """初始化插件组件
        
        学习Harness插件系统的初始化流程
        """
        try:
            # 验证API密钥
            if not self.config.api_key or self.config.api_key == "test-api-key":
                logger.warning("⚠️ DeepSeek API密钥未配置，将使用测试模式")
            
            self._status = "ready"
            logger.info("✅ 对话插件初始化成功")
            
            # 发布插件就绪事件
            self._publish_event("plugin_ready", {
                "plugin_name": "chat_service",
                "model": self.config.default_model,
                "status": "ready"
            })
            
        except Exception as e:
            logger.error(f"❌ 对话插件初始化失败: {e}")
            self._status = "failed"
            self._stats["errors"].append(str(e))
            self._publish_event("plugin_failed", {
                "plugin_name": "chat_service",
                "error": str(e)
            })
    
    def _publish_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """发布插件事件（学习Harness的事件系统）
        
        Args:
            event_name: 事件名称
            data: 事件数据
        """
        logger.info(f"📢 发布事件: {event_name}")
        print(f"[ChatPlugin Event] {event_name}: {data}")
    
    async def generate_response(self, prompt: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """生成AI回复 - 主要API接口
        
        Args:
            prompt: 用户输入的文本
            user_id: 用户ID（可选，用于上下文管理）
            
        Returns:
            dict: 包含AI回复和状态信息
        """
        start_time = time.time()
        self._stats["total_requests"] += 1
        
        try:
            # 1. 添加用户消息到上下文
            self.context.add_message("user", prompt)
            
            # 2. 准备API请求数据
            headers = {
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json"
            }
            
            data = {
                "model": self.config.default_model,
                "messages": self.context.get_context(),
                "max_tokens": self.config.max_tokens,
                "temperature": self.config.temperature,
                "stream": False
            }
            
            logger.info(f"💬 发送对话请求 - 模型: {self.config.default_model}")
            
            # 3. 调用DeepSeek API
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(self.config.base_url, headers=headers, json=data)
                response.raise_for_status()
                result = response.json()
            
            # 4. 处理AI回复
            ai_message = result["choices"][0]["message"]["content"]
            
            # 5. 添加AI回复到上下文
            self.context.add_message("assistant", ai_message)
            
            # 6. 计算性能指标
            response_time = time.time() - start_time
            self._stats["avg_response_time"] = (
                self._stats["avg_response_time"] * (self._stats["total_requests"] - 1) + response_time
            ) / self._stats["total_requests"]
            self._stats["last_used"] = time.time()
            self._stats["successful_requests"] += 1
            
            # 7. 发布对话完成事件
            self._publish_event("chat_completed", {
                "prompt_length": len(prompt),
                "response_length": len(ai_message),
                "response_time": response_time,
                "model": self.config.default_model
            })
            
            return {
                "success": True,
                "response": ai_message,
                "context_summary": self.context.get_summary(),
                "model": self.config.default_model,
                "usage": result.get("usage", {}),
                "response_time": response_time,
                "timestamp": time.time()
            }
            
        except httpx.HTTPStatusError as e:
            logger.error(f"❌ API请求失败: {e}")
            self._stats["failed_requests"] += 1
            self._stats["errors"].append(f"HTTP错误: {e}")
            
            # 降级处理 - 返回本地回复
            fallback_response = self._get_fallback_response(prompt)
            
            self._publish_event("chat_failed", {
                "error": str(e),
                "prompt": prompt[:50] + "..."
            })
            
            return {
                "success": False,
                "response": fallback_response,
                "error": str(e),
                "code": "API_ERROR",
                "timestamp": time.time()
            }
            
        except Exception as e:
            logger.error(f"❌ 对话生成失败: {e}")
            self._stats["failed_requests"] += 1
            self._stats["errors"].append(str(e))
            
            # 降级处理
            fallback_response = self._get_fallback_response(prompt)
            
            self._publish_event("chat_failed", {
                "error": str(e),
                "prompt": prompt[:50] + "..."
            })
            
            return {
                "success": False,
                "response": fallback_response,
                "error": str(e),
                "code": "INTERNAL_ERROR",
                "timestamp": time.time()
            }
    
    def _get_fallback_response(self, prompt: str) -> str:
        """获取降级回复（类似Harness的降级策略）
        
        Args:
            prompt: 用户输入
            
        Returns:
            str: 降级回复
        """
        fallback_responses = [
            f"AI服务暂时 unavailable，请稍后再试。你的问题：{prompt[:30]}...",
            "抱歉，我现在无法处理你的请求，请稍后重试。",
            f"系统正在维护，请稍后再试。你的问题：{prompt[:30]}..."
        ]
        return fallback_responses[hash(prompt) % len(fallback_responses)]
    
    def clear_context(self) -> None:
        """清空对话上下文"""
        self.context.clear()
        logger.info("🧹 对话上下文已清空")
        
        self._publish_event("context_cleared", {
            "total_messages_removed": self.context.get_summary()["total_messages"]
        })
    
    def get_plugin_info(self) -> Dict[str, Any]:
        """获取插件信息（类似Harness的插件诊断）
        
        Returns:
            dict: 插件状态和性能指标
        """
        return {
            "plugin_name": "chat_service",
            "version": "1.0.0",
            "status": self._status,
            "config": {
                "model": self.config.default_model,
                "max_tokens": self.config.max_tokens,
                "temperature": self.config.temperature
            },
            "context": self.context.get_summary(),
            "stats": self._stats,
            "timestamp": time.time()
        }
    
    def health_check(self) -> Dict[str, Any]:
        """健康检查（类似Harness的健康监控）
        
        Returns:
            dict: 健康状态信息
        """
        return {
            "plugin_name": "chat_service",
            "status": self._status,
            "total_requests": self._stats.get("total_requests", 0),
            "successful_requests": self._stats.get("successful_requests", 0),
            "failed_requests": self._stats.get("failed_requests", 0),
            "avg_response_time": self._stats.get("avg_response_time", 0),
            "last_used": self._stats.get("last_used"),
            "timestamp": time.time()
        }
    
    def shutdown(self) -> None:
        """插件关闭（类似Harness的插件卸载）
        
        学习Harness插件系统的清理流程
        """
        logger.info("🔌 对话插件正在关闭...")
        self._status = "shutting_down"
        
        # 发布插件关闭事件
        self._publish_event("plugin_shutdown", {
            "plugin_name": "chat_service",
            "total_requests": self._stats.get("total_requests", 0)
        })
        
        self._status = "shutdown"
        logger.info("✅ 对话插件已关闭")


# 创建插件实例
chat_plugin = ChatPlugin()


if __name__ == "__main__":
    # 测试插件
    import asyncio
    
    async def test_plugin():
        print("💬 测试对话插件...")
        
        # 测试对话
        test_prompts = [
            "你好，你是谁？",
            "请介绍一下蝶翅APP的功能",
            "告诉我一个关于AI的笑话"
        ]
        
        for prompt in test_prompts:
            print(f"\n👤 用户: {prompt}")
            result = await chat_plugin.generate_response(prompt)
            print(f"🤖 AI: {result.get('response', '无回复')}")
            print(f"📊 状态: {'成功' if result['success'] else '失败'}")
        
        # 获取插件信息
        info = chat_plugin.get_plugin_info()
        print(f"\n📊 插件信息: {info}")
    
    asyncio.run(test_plugin())
