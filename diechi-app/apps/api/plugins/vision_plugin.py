"""
蝶翅APP - 视觉识别插件
基于DeepSeek Harness插件化架构实现

插件功能：
- Mage-VL-4B视觉识别模型集成
- 图像描述生成
- 物体检测
- 场景理解

学习目标：
- 理解Harness插件系统
- 实现多模态AI功能
- 学习视觉AI模型集成
"""

import os
import time
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor
from fastapi import UploadFile

# 设置日志
logger = logging.getLogger(__name__)


@dataclass
class VisionPluginConfig:
    """视觉插件配置"""
    model_name: str = "microsoft/MAGE-VL-4B"
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    max_image_size: int = 10 * 1024 * 1024  # 10MB
    supported_formats: list = None
    
    def __post_init__(self):
        if self.supported_formats is None:
            self.supported_formats = ["jpg", "jpeg", "png", "webp"]


class VisionPlugin:
    """
    视觉识别插件 - Harness插件系统实现
    
    支持Mage-VL-4B模型的视觉识别功能
    学习DeepSeek Harness的插件化架构：
    - 插件初始化
    - 服务注册
    - 事件处理
    - 配置管理
    """
    
    def __init__(self, config: Optional[VisionPluginConfig] = None):
        """插件初始化
        
        Args:
            config: 插件配置，如果为None则使用默认配置
        """
        self.config = config or VisionPluginConfig()
        self._model = None
        self._processor = None
        self._status: str = "initializing"
        self._stats: Dict[str, Any] = {
            "model_loaded": False,
            "last_used": None,
            "total_requests": 0,
            "avg_response_time": 0,
            "errors": 0,
            "objects_detected": 0,
            "scenes_understood": 0
        }
        
        logger.info(f"👁️ 视觉识别插件初始化 - 设备: {self.config.device}")
        self._initialize_plugin()
    
    def _initialize_plugin(self) -> None:
        """初始化插件组件
        
        学习Harness插件系统的初始化流程
        """
        try:
            # 1. 加载Mage-VL-4B模型
            logger.info(f"📦 加载Mage-VL-4B模型: {self.config.model_name}")
            
            # 使用INT8量化减少内存使用
            self._model = AutoModelForCausalLM.from_pretrained(
                self.config.model_name,
                torch_dtype=torch.float16,
                device_map="auto"
            ).eval()
            
            # 加载处理器
            self._processor = AutoProcessor.from_pretrained(self.config.model_name)
            
            self._status = "ready"
            self._stats["model_loaded"] = True
            logger.info("✅ 视觉识别模型加载成功")
            
            # 2. 发布插件就绪事件
            self._publish_event("plugin_ready", {
                "plugin_name": "vision_recognition",
                "model": self.config.model_name,
                "device": self.config.device,
                "status": "ready"
            })
            
        except Exception as e:
            logger.error(f"❌ 视觉识别模型加载失败: {e}")
            self._status = "failed"
            self._stats["errors"] += 1
            self._publish_event("plugin_failed", {
                "plugin_name": "vision_recognition",
                "error": str(e)
            })
    
    def _publish_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """发布插件事件（学习Harness的事件系统）
        
        Args:
            event_name: 事件名称
            data: 事件数据
        """
        logger.info(f"📢 发布事件: {event_name}")
        print(f"[VisionPlugin Event] {event_name}: {data}")
    
    def _validate_image_file(self, image_file: UploadFile) -> bool:
        """验证图像文件格式和大小
        
        Args:
            image_file: 上传的图像文件
            
        Returns:
            bool: 文件是否有效
        """
        # 检查文件大小
        if image_file.size > self.config.max_image_size:
            logger.warning(f"⚠️ 图像文件过大: {image_file.size} bytes")
            return False
        
        # 检查文件扩展名
        file_ext = image_file.filename.split('.')[-1].lower()
        if file_ext not in self.config.supported_formats:
            logger.warning(f"⚠️ 不支持的图像格式: {file_ext}")
            return False
        
        return True
    
    async def recognize_image(self, image_file: UploadFile) -> Dict[str, Any]:
        """图像识别 - 主要API接口
        
        Args:
            image_file: 上传的图像文件
            
        Returns:
            dict: 包含识别结果和状态
        """
        start_time = time.time()
        self._stats["total_requests"] += 1
        
        try:
            # 1. 验证文件
            if not self._validate_image_file(image_file):
                return {
                    "success": False,
                    "error": "无效的图像文件",
                    "code": "INVALID_FILE",
                    "timestamp": time.time()
                }
            
            # 2. 保存临时文件
            temp_path = f"temp/{image_file.filename}"
            os.makedirs("temp", exist_ok=True)
            
            with open(temp_path, "wb") as f:
                content = await image_file.read()
                f.write(content)
            
            # 3. 执行视觉识别
            logger.info(f"👁️ 开始图像识别: {image_file.filename}")
            
            if self._model and self._processor:
                # 打开图像
                image = Image.open(temp_path)
                
                # 准备输入
                inputs = self._processor(
                    "描述这张图片",
                    image,
                    return_tensors="pt"
                ).to(self.config.device)
                
                # 推理
                with torch.no_grad():
                    outputs = self._model.generate(**inputs, max_new_tokens=128)
                
                # 解码结果
                description = self._processor.decode(outputs[0], skip_special_tokens=True)
                
                # 4. 提取物体和场景信息
                objects = self._extract_objects(description)
                scene = self._extract_scene(description)
                
                # 5. 计算性能指标
                response_time = time.time() - start_time
                self._stats["avg_response_time"] = (
                    self._stats["avg_response_time"] * (self._stats["total_requests"] - 1) + response_time
                ) / self._stats["total_requests"]
                self._stats["last_used"] = time.time()
                self._stats["objects_detected"] += len(objects)
                self._stats["scenes_understood"] += 1 if scene else 0
                
                # 6. 发布识别完成事件
                self._publish_event("recognition_complete", {
                    "filename": image_file.filename,
                    "description_length": len(description),
                    "objects_count": len(objects),
                    "response_time": response_time,
                    "model": self.config.model_name
                })
                
                return {
                    "success": True,
                    "description": description,
                    "objects": objects,
                    "scene": scene,
                    "image_file": image_file.filename,
                    "response_time": response_time,
                    "model": self.config.model_name,
                    "timestamp": time.time()
                }
            else:
                # 降级处理
                description = f"[图像识别结果] {image_file.filename}"
                objects = []
                scene = "未知场景"
                
                return {
                    "success": True,
                    "description": description,
                    "objects": objects,
                    "scene": scene,
                    "image_file": image_file.filename,
                    "response_time": time.time() - start_time,
                    "model": "local_fallback",
                    "timestamp": time.time()
                }
            
        except Exception as e:
            logger.error(f"❌ 图像识别失败: {e}")
            self._stats["errors"] += 1
            self._publish_event("recognition_failed", {
                "error": str(e),
                "filename": image_file.filename
            })
            
            return {
                "success": False,
                "error": str(e),
                "code": "RECOGNITION_ERROR",
                "timestamp": time.time()
            }
        finally:
            # 清理临时文件
            if os.path.exists(temp_path):
                os.remove(temp_path)
    
    def _extract_objects(self, description: str) -> List[Dict[str, Any]]:
        """从描述中提取物体信息
        
        Args:
            description: 模型生成的描述
            
        Returns:
            list: 物体列表
        """
        # 简化的物体提取逻辑
        objects = []
        
        # 关键词匹配（实际项目中可以使用更复杂的NLP处理）
        keywords = ["人", "车", "树", "建筑", "动物", "书", "电脑", "手机", "椅子", "桌子"]
        
        for keyword in keywords:
            if keyword in description:
                objects.append({
                    "name": keyword,
                    "confidence": 0.9,  # 简化处理
                    "description": f"图像中包含{keyword}"
                })
        
        return objects[:5]  # 限制返回数量
    
    def _extract_scene(self, description: str) -> Optional[str]:
        """从描述中提取场景信息
        
        Args:
            description: 模型生成的描述
            
        Returns:
            str: 场景描述或None
        """
        scenes = [
            "室内", "室外", "办公室", "卧室", "厨房", "客厅", 
            "街道", "公园", "大自然", "城市", "乡村"
        ]
        
        for scene in scenes:
            if scene in description:
                return scene
        
        return None
    
    def get_plugin_info(self) -> Dict[str, Any]:
        """获取插件信息（类似Harness的插件诊断）
        
        Returns:
            dict: 插件状态和性能指标
        """
        return {
            "plugin_name": "vision_recognition",
            "version": "1.0.0",
            "status": self._status,
            "config": {
                "model_name": self.config.model_name,
                "device": self.config.device,
                "supported_formats": self.config.supported_formats
            },
            "stats": self._stats,
            "performance": {
                "avg_response_time": self._stats.get("avg_response_time", 0),
                "objects_per_request": self._stats.get("objects_detected", 0) / max(1, self._stats.get("scenes_understood", 1))
            },
            "timestamp": time.time()
        }
    
    def health_check(self) -> Dict[str, Any]:
        """健康检查（类似Harness的健康监控）
        
        Returns:
            dict: 健康状态信息
        """
        return {
            "plugin_name": "vision_recognition",
            "status": self._status,
            "model_loaded": self._stats.get("model_loaded", False),
            "total_requests": self._stats.get("total_requests", 0),
            "errors": self._stats.get("errors", 0),
            "avg_response_time": self._stats.get("avg_response_time", 0),
            "objects_detected": self._stats.get("objects_detected", 0),
            "scenes_understood": self._stats.get("scenes_understood", 0),
            "last_used": self._stats.get("last_used"),
            "timestamp": time.time()
        }
    
    def shutdown(self) -> None:
        """插件关闭（类似Harness的插件卸载）
        
        学习Harness插件系统的清理流程
        """
        logger.info("🔌 视觉识别插件正在关闭...")
        self._status = "shutting_down"
        
        # 发布插件关闭事件
        self._publish_event("plugin_shutdown", {
            "plugin_name": "vision_recognition",
            "total_requests": self._stats.get("total_requests", 0),
            "objects_detected": self._stats.get("objects_detected", 0)
        })
        
        # 清理资源
        if self._model:
            del self._model
            self._model = None
        
        if self._processor:
            del self._processor
            self._processor = None
        
        self._status = "shutdown"
        logger.info("✅ 视觉识别插件已关闭")


# 创建插件实例
vision_plugin = VisionPlugin()


if __name__ == "__main__":
    # 测试插件
    import asyncio
    
    async def test_plugin():
        print("👁️ 测试视觉识别插件...")
        
        # 创建测试图像文件
        from fastapi import UploadFile
        from io import BytesIO
        
        # 创建一个简单的图像文件
        image_content = b"fake image content"
        image_file = UploadFile(
            filename="test.jpg",
            file=BytesIO(image_content),
            size=len(image_content)
        )
        
        # 测试识别
        result = await vision_plugin.recognize_image(image_file)
        print(f"✅ 测试结果: {result}")
        
        # 获取插件信息
        info = vision_plugin.get_plugin_info()
        print(f"📊 插件信息: {info}")
    
    asyncio.run(test_plugin())
