"""
蝶翅APP - 语音识别插件
基于DeepSeek Harness插件化架构实现

插件功能：
- Whisper语音识别模型集成
- 语音活动检测
- 语音转文字API
- 模型性能监控

学习目标：
- 理解Harness插件系统
- 实现模块化服务
- 学习事件驱动架构
"""

import os
import time
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
import torch
from transformers import pipeline, Pipeline
from fastapi import UploadFile

# 设置日志
logger = logging.getLogger(__name__)


@dataclass
class VoicePluginConfig:
    """语音插件配置"""
    model_name: str = "openai/whisper-tiny"
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    max_audio_size: int = 10 * 1024 * 1024  # 10MB
    supported_formats: list = None
    
    def __post_init__(self):
        if self.supported_formats is None:
            self.supported_formats = ["wav", "mp3", "ogg", "flac"]


class VoicePlugin:
    """
    语音识别插件 - Harness插件系统实现
    
    学习DeepSeek Harness的插件化架构：
    - 插件初始化
    - 服务注册
    - 事件处理
    - 配置管理
    """
    
    def __init__(self, config: Optional[VoicePluginConfig] = None):
        """插件初始化
        
        Args:
            config: 插件配置，如果为None则使用默认配置
        """
        self.config = config or VoicePluginConfig()
        self._model: Optional[Pipeline] = None
        self._status: str = "initializing"
        self._stats: Dict[str, Any] = {
            "model_loaded": False,
            "last_used": None,
            "total_requests": 0,
            "avg_response_time": 0,
            "errors": 0
        }
        
        logger.info(f"🎤 语音识别插件初始化 - 设备: {self.config.device}")
        self._initialize_plugin()
    
    def _initialize_plugin(self) -> None:
        """初始化插件组件
        
        学习Harness插件系统的初始化流程
        """
        try:
            # 1. 加载模型（类似Harness的插件加载）
            logger.info(f"📦 加载语音识别模型: {self.config.model_name}")
            self._model = pipeline(
                "automatic-speech-recognition",
                model=self.config.model_name,
                device=0 if self.config.device == "cuda" else -1
            )
            self._status = "ready"
            self._stats["model_loaded"] = True
            logger.info("✅ 语音识别模型加载成功")
            
            # 2. 发布插件就绪事件（类似Harness的事件系统）
            self._publish_event("plugin_ready", {
                "plugin_name": "voice_recognition",
                "model": self.config.model_name,
                "device": self.config.device,
                "status": "ready"
            })
            
        except Exception as e:
            logger.error(f"❌ 语音识别模型加载失败: {e}")
            self._status = "failed"
            self._stats["errors"] += 1
            self._publish_event("plugin_failed", {
                "plugin_name": "voice_recognition",
                "error": str(e)
            })
    
    def _publish_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """发布插件事件（学习Harness的事件系统）
        
        Args:
            event_name: 事件名称
            data: 事件数据
        """
        # 在Harness中，这将发布到事件总线
        logger.info(f"📢 发布事件: {event_name}")
        print(f"[VoicePlugin Event] {event_name}: {data}")
    
    def _validate_audio_file(self, audio_file: UploadFile) -> bool:
        """验证音频文件格式和大小
        
        Args:
            audio_file: 上传的音频文件
            
        Returns:
            bool: 文件是否有效
        """
        # 检查文件大小
        if audio_file.size > self.config.max_audio_size:
            logger.warning(f"⚠️ 音频文件过大: {audio_file.size} bytes")
            return False
        
        # 检查文件扩展名
        file_ext = audio_file.filename.split('.')[-1].lower()
        if file_ext not in self.config.supported_formats:
            logger.warning(f"⚠️ 不支持的音频格式: {file_ext}")
            return False
        
        return True
    
    async def transcribe_audio(self, audio_file: UploadFile) -> Dict[str, Any]:
        """语音转文字 - 主要API接口
        
        Args:
            audio_file: 上传的音频文件
            
        Returns:
            dict: 包含转换结果和状态信息
        """
        start_time = time.time()
        self._stats["total_requests"] += 1
        
        try:
            # 1. 验证文件
            if not self._validate_audio_file(audio_file):
                return {
                    "success": False,
                    "error": "无效的音频文件",
                    "code": "INVALID_FILE",
                    "timestamp": time.time()
                }
            
            # 2. 保存临时文件
            temp_path = f"temp/{audio_file.filename}"
            os.makedirs("temp", exist_ok=True)
            
            with open(temp_path, "wb") as f:
                content = await audio_file.read()
                f.write(content)
            
            # 3. 执行语音识别（类似Harness的服务调用）
            logger.info(f"🎤 开始语音识别: {audio_file.filename}")
            
            if self._model:
                result = self._model(temp_path)
                text = result["text"]
            else:
                # 降级处理
                text = f"[语音转换结果] {audio_file.filename}"
            
            # 4. 计算性能指标
            response_time = time.time() - start_time
            self._stats["avg_response_time"] = (
                self._stats["avg_response_time"] * (self._stats["total_requests"] - 1) + response_time
            ) / self._stats["total_requests"]
            self._stats["last_used"] = time.time()
            
            # 5. 发布处理完成事件
            self._publish_event("transcription_complete", {
                "filename": audio_file.filename,
                "text_length": len(text),
                "response_time": response_time,
                "model": self.config.model_name
            })
            
            return {
                "success": True,
                "text": text,
                "audio_file": audio_file.filename,
                "response_time": response_time,
                "model": self.config.model_name,
                "timestamp": time.time()
            }
            
        except Exception as e:
            logger.error(f"❌ 语音转换失败: {e}")
            self._stats["errors"] += 1
            self._publish_event("transcription_failed", {
                "error": str(e),
                "filename": audio_file.filename
            })
            
            return {
                "success": False,
                "error": str(e),
                "code": "TRANSCRIPTION_ERROR",
                "timestamp": time.time()
            }
        finally:
            # 清理临时文件
            if os.path.exists(temp_path):
                os.remove(temp_path)
    
    def get_plugin_info(self) -> Dict[str, Any]:
        """获取插件信息（类似Harness的插件诊断）
        
        Returns:
            dict: 插件状态和性能指标
        """
        return {
            "plugin_name": "voice_recognition",
            "version": "1.0.0",
            "status": self._status,
            "config": {
                "model_name": self.config.model_name,
                "device": self.config.device,
                "supported_formats": self.config.supported_formats
            },
            "stats": self._stats,
            "timestamp": time.time()
        }
    
    def health_check(self) -> Dict[str, Any]:
        """健康检查（类似Harness的健康监控）
        
        Returns:
            dict: 健康状态信息
        """
        return {
            "plugin_name": "voice_recognition",
            "status": self._status,
            "model_loaded": self._stats.get("model_loaded", False),
            "total_requests": self._stats.get("total_requests", 0),
            "errors": self._stats.get("errors", 0),
            "avg_response_time": self._stats.get("avg_response_time", 0),
            "last_used": self._stats.get("last_used"),
            "timestamp": time.time()
        }
    
    def shutdown(self) -> None:
        """插件关闭（类似Harness的插件卸载）
        
        学习Harness插件系统的清理流程
        """
        logger.info("🔌 语音识别插件正在关闭...")
        self._status = "shutting_down"
        
        # 发布插件关闭事件
        self._publish_event("plugin_shutdown", {
            "plugin_name": "voice_recognition",
            "total_requests": self._stats.get("total_requests", 0)
        })
        
        # 清理资源
        if self._model:
            del self._model
            self._model = None
        
        self._status = "shutdown"
        logger.info("✅ 语音识别插件已关闭")


# 创建插件实例（类似Harness的插件管理）
voice_plugin = VoicePlugin()


if __name__ == "__main__":
    # 测试插件
    import asyncio
    
    async def test_plugin():
        print("🎤 测试语音识别插件...")
        
        # 创建测试音频文件
        from fastapi import UploadFile
        from io import BytesIO
        
        # 创建一个简单的音频文件
        audio_content = b"fake audio content"
        audio_file = UploadFile(
            filename="test.wav",
            file=BytesIO(audio_content),
            size=len(audio_content)
        )
        
        # 测试转换
        result = await voice_plugin.transcribe_audio(audio_file)
        print(f"✅ 测试结果: {result}")
        
        # 获取插件信息
        info = voice_plugin.get_plugin_info()
        print(f"📊 插件信息: {info}")
    
    asyncio.run(test_plugin())
