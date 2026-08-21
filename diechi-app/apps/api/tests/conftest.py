"""
蝶翅APP后端测试配置
基于pytest框架的测试配置和fixtures

学习目标：
- 掌握pytest测试框架
- 实现测试驱动开发(TDD)
- 学习测试金字塔
"""

import pytest
import os
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from main import app
from plugins import plugin_manager
from plugins.voice_plugin import voice_plugin
from plugins.chat_plugin import chat_plugin
from plugins.vision_plugin import vision_plugin
from plugins.skill_plugin import skill_plugin


@pytest.fixture(scope="session")
def test_client():
    """创建测试客户端"""
    client = TestClient(app)
    return client


@pytest.fixture(scope="session")
def temp_dir():
    """创建临时目录"""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """设置测试环境"""
    # 设置测试环境变量
    os.environ['ENVIRONMENT'] = 'testing'
    os.environ['LOG_LEVEL'] = 'DEBUG'
    
    # 注册测试插件
    plugin_manager.register_plugin("voice_recognition", voice_plugin)
    plugin_manager.register_plugin("chat_service", chat_plugin)
    plugin_manager.register_plugin("vision_recognition", vision_plugin)
    plugin_manager.register_plugin("skill_system", skill_plugin)
    
    yield
    
    # 清理测试环境
    plugin_manager.shutdown()


@pytest.fixture(scope="function")
def mock_voice_plugin():
    """创建语音插件的测试mock"""
    class MockVoicePlugin:
        async def transcribe_audio(self, audio_file):
            return {
                "success": True,
                "text": "测试语音转文字结果",
                "audio_file": audio_file.filename if hasattr(audio_file, 'filename') else "test.wav"
            }
        
        def health_check(self):
            return {"status": "ready", "model": "whisper-tiny"}
        
        def get_plugin_info(self):
            return {
                "plugin_name": "voice_recognition",
                "status": "ready",
                "model": "whisper-tiny"
            }
    
    return MockVoicePlugin()


@pytest.fixture(scope="function")
def mock_chat_plugin():
    """创建对话插件的测试mock"""
    class MockChatPlugin:
        async def generate_response(self, prompt):
            return {
                "success": True,
                "response": f"AI助手回复：{prompt}",
                "prompt": prompt
            }
        
        def health_check(self):
            return {"status": "ready", "api": "deepseek-chat"}
        
        def get_plugin_info(self):
            return {
                "plugin_name": "chat_service",
                "status": "ready",
                "api": "deepseek-chat"
            }
    
    return MockChatPlugin()


@pytest.fixture(scope="function")
def mock_vision_plugin():
    """创建视觉识别插件的测试mock"""
    class MockVisionPlugin:
        async def recognize_image(self, image_file):
            return {
                "success": True,
                "description": "这是一个测试图像，包含人、椅子、电脑等物体",
                "objects": [
                    {"name": "人", "confidence": 0.95},
                    {"name": "椅子", "confidence": 0.88},
                    {"name": "电脑", "confidence": 0.92}
                ],
                "scene": "办公室",
                "image_file": image_file.filename if hasattr(image_file, 'filename') else "test.jpg"
            }
        
        def health_check(self):
            return {"status": "ready", "model": "mage-vl-4b"}
        
        def get_plugin_info(self):
            return {
                "plugin_name": "vision_recognition",
                "status": "ready",
                "model": "mage-vl-4b"
            }
    
    return MockVisionPlugin()


@pytest.fixture(scope="function")
def mock_skill_plugin():
    """创建Skill插件的测试mock"""
    class MockSkillPlugin:
        async def execute_skill(self, prompt, context=None):
            from plugins.skill_plugin import SkillExecutionResult
            return SkillExecutionResult(
                success=True,
                response=f"{prompt} - 这是基于测试技能的回复",
                execution_time=0.5,
                tokens_used=25,
                timestamp=1234567890
            )
        
        def get_available_skills(self):
            return [
                {"type": "default", "name": "通用助手", "description": "通用AI助手", "is_current": True},
                {"type": "doctor", "name": "医生", "description": "专业医疗健康咨询", "is_current": False},
                {"type": "teacher", "name": "老师", "description": "专业教育辅导", "is_current": False}
            ]
        
        def switch_skill(self, skill_type):
            return True
        
        def health_check(self):
            return {"status": "ready", "skills": 5}
        
        def get_plugin_info(self):
            return {
                "plugin_name": "skill_system",
                "status": "ready",
                "skills": 5
            }
    
    return MockSkillPlugin()


@pytest.fixture(scope="function")
def mock_audio_file(temp_dir):
    """创建测试音频文件"""
    audio_path = temp_dir / "test_audio.wav"
    audio_path.write_bytes(b"fake audio content")
    
    class MockAudioFile:
        def __init__(self):
            self.filename = "test_audio.wav"
            self.size = len(b"fake audio content")
            self.content_type = "audio/wav"
        
        async def read(self):
            return b"fake audio content"
    
    return MockAudioFile()


@pytest.fixture(scope="function")
def mock_image_file(temp_dir):
    """创建测试图像文件"""
    image_path = temp_dir / "test_image.jpg"
    image_path.write_bytes(b"fake image content")
    
    class MockImageFile:
        def __init__(self):
            self.filename = "test_image.jpg"
            self.size = len(b"fake image content")
            self.content_type = "image/jpeg"
        
        async def read(self):
            return b"fake image content"
    
    return MockImageFile()


@pytest.fixture(scope="session")
def test_config():
    """测试配置"""
    return {
        "test_timeout": 30,
        "max_retries": 3,
        "coverage_threshold": 80,
        "api_timeout": 10,
        "health_check_interval": 5
    }


# ============================================
# 测试工具函数
# ============================================

def assert_response_success(response, status_code=200):
    """验证API响应成功"""
    assert response.status_code == status_code, f"Expected status {status_code}, got {response.status_code}"
    data = response.json()
    assert data.get("success") is True, f"Expected success=True, got {data.get('success')}"
    return data


def assert_response_failure(response, status_code=400):
    """验证API响应失败"""
    assert response.status_code == status_code, f"Expected status {status_code}, got {response.status_code}"
    data = response.json()
    assert data.get("success") is False, f"Expected success=False, got {data.get('success')}"
    return data


def assert_plugin_health(health_data, plugin_name):
    """验证插件健康状态"""
    assert health_data.get("status") == "ready", f"{plugin_name}插件未就绪"
    assert plugin_name in health_data.get("plugins", {}), f"{plugin_name}插件未注册"
    return health_data


# ============================================
# 测试数据生成器
# ============================================

def generate_test_prompts(count=5):
    """生成测试提示词"""
    prompts = [
        "你好，请问你是谁？",
        "帮我写一封求职信",
        "今天天气怎么样？",
        "教我学习Python编程",
        "给我推荐一本好书"
    ]
    return prompts[:count]


def generate_test_images(count=3):
    """生成测试图像描述"""
    images = [
        {"filename": "office.jpg", "description": "办公室场景，有电脑和椅子"},
        {"filename": "nature.jpg", "description": "大自然风景，有树木和山脉"},
        {"filename": "food.jpg", "description": "美食图片，有各种菜肴"}
    ]
    return images[:count]


def generate_test_audios(count=3):
    """生成测试音频描述"""
    audios = [
        {"filename": "greeting.wav", "transcription": "你好，很高兴见到你"},
        {"filename": "question.wav", "transcription": "请问今天天气怎么样？"},
        {"filename": "instruction.wav", "transcription": "请帮我打开这个文件"}
    ]
    return audios[:count]
