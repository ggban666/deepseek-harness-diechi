"""
蝶翅APP - 语音插件单元测试
基于pytest框架的语音插件测试

测试内容：
- 插件初始化
- 语音转文字功能
- 健康检查
- 插件信息

学习目标：
- 掌握pytest测试框架
- 实现测试驱动开发(TDD)
- 学习插件系统测试
"""

import pytest
from plugins.voice_plugin import voice_plugin
from conftest import assert_plugin_health, assert_response_success


class TestVoicePluginInitialization:
    """测试语音插件初始化"""
    
    def test_plugin_initialization(self):
        """测试插件初始化状态"""
        assert voice_plugin is not None, "语音插件未初始化"
        assert voice_plugin._status == "ready", f"插件状态错误: {voice_plugin._status}"
        print("✅ 语音插件初始化成功")
    
    def test_plugin_info(self):
        """测试插件信息获取"""
        plugin_info = voice_plugin.get_plugin_info()
        assert plugin_info["plugin_name"] == "voice_recognition", "插件名称错误"
        assert plugin_info["status"] == "ready", "插件状态错误"
        assert "model" in plugin_info, "缺少模型信息"
        print("✅ 语音插件信息获取成功")
    
    def test_plugin_health_check(self):
        """测试插件健康检查"""
        health_data = voice_plugin.health_check()
        assert_plugin_health(health_data, "voice_recognition")
        assert health_data.get("total_requests") >= 0, "请求计数错误"
        print("✅ 语音插件健康检查成功")


class TestVoicePluginTranscription:
    """测试语音转文字功能"""
    
    @pytest.mark.asyncio
    async def test_transcribe_audio_success(self, mock_audio_file):
        """测试语音转文字成功"""
        result = await voice_plugin.transcribe_audio(mock_audio_file)
        assert result["success"] is True, f"转换失败: {result.get('error')}"
        assert "text" in result, "缺少转换结果"
        assert result["text"] == "测试语音转文字结果", "转换结果不匹配"
        print("✅ 语音转文字成功")
    
    @pytest.mark.asyncio
    async def test_transcribe_audio_invalid_file(self):
        """测试无效文件处理"""
        class InvalidFile:
            def __init__(self):
                self.filename = "invalid.txt"
                self.size = 1024
            
            async def read(self):
                return b"invalid content"
        
        result = await voice_plugin.transcribe_audio(InvalidFile())
        assert result["success"] is False, "无效文件应该转换失败"
        assert "error" in result, "缺少错误信息"
        print("✅ 无效文件处理成功")
    
    @pytest.mark.asyncio
    async def test_transcribe_audio_large_file(self, temp_dir):
        """测试大文件处理"""
        large_file = temp_dir / "large_audio.wav"
        large_file.write_bytes(b"x" * (11 * 1024 * 1024))  # 11MB
        
        class LargeFile:
            def __init__(self):
                self.filename = "large_audio.wav"
                self.size = 11 * 1024 * 1024
            
            async def read(self):
                return large_file.read_bytes()
        
        result = await voice_plugin.transcribe_audio(LargeFile())
        assert result["success"] is False, "大文件应该转换失败"
        assert "error" in result, "缺少错误信息"
        print("✅ 大文件处理成功")


class TestVoicePluginStats:
    """测试语音插件统计功能"""
    
    @pytest.mark.asyncio
    async def test_transcription_stats(self, mock_audio_file):
        """测试转换统计"""
        # 执行多次转换
        for _ in range(5):
            await voice_plugin.transcribe_audio(mock_audio_file)
        
        health_data = voice_plugin.health_check()
        assert health_data["total_requests"] == 5, "请求计数错误"
        assert health_data["successful_executions"] == 5, "成功执行计数错误"
        assert health_data["avg_response_time"] > 0, "平均响应时间错误"
        print("✅ 转换统计功能正常")
    
    def test_error_stats(self):
        """测试错误统计"""
        initial_errors = voice_plugin._stats.get("errors", 0)
        
        # 模拟错误
        voice_plugin._stats["errors"] = initial_errors + 3
        
        health_data = voice_plugin.health_check()
        assert health_data["errors"] == initial_errors + 3, "错误计数错误"
        print("✅ 错误统计功能正常")


class TestVoicePluginShutdown:
    """测试语音插件关闭功能"""
    
    def test_plugin_shutdown(self):
        """测试插件关闭"""
        assert voice_plugin._status == "ready", "插件未就绪"
        
        voice_plugin.shutdown()
        assert voice_plugin._status == "shutdown", "插件关闭状态错误"
        print("✅ 插件关闭功能正常")


# ============================================
# 性能测试
# ============================================

@pytest.mark.performance
@pytest.mark.asyncio
async def test_transcription_performance(mock_audio_file):
    """测试语音转文字性能"""
    import time
    
    start_time = time.time()
    
    # 执行10次转换
    for _ in range(10):
        await voice_plugin.transcribe_audio(mock_audio_file)
    
    end_time = time.time()
    total_time = end_time - start_time
    avg_time = total_time / 10
    
    print(f"📊 10次转换性能测试:")
    print(f"   总时间: {total_time:.2f}秒")
    print(f"   平均时间: {avg_time:.2f}秒/次")
    print(f"   每秒处理: {10/total_time:.2f}次")
    
    # 性能指标
    assert avg_time < 2.0, f"平均响应时间过长: {avg_time:.2f}秒"
    assert total_time < 20.0, f"总处理时间过长: {total_time:.2f}秒"


# ============================================
# 边界测试
# ============================================

@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_empty_audio_file():
    """测试空音频文件"""
    class EmptyFile:
        def __init__(self):
            self.filename = "empty.wav"
            self.size = 0
        
        async def read(self):
            return b""
    
    result = await voice_plugin.transcribe_audio(EmptyFile())
    assert result["success"] is False, "空文件应该转换失败"
    print("✅ 空音频文件处理成功")


@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_unsupported_format():
    """测试不支持的文件格式"""
    class UnsupportedFile:
        def __init__(self):
            self.filename = "test.mp3"
            self.size = 1024
        
        async def read(self):
            return b"fake mp3 content"
    
    result = await voice_plugin.transcribe_audio(UnsupportedFile())
    assert result["success"] is False, "不支持的格式应该转换失败"
    print("✅ 不支持格式处理成功")


# ============================================
# 集成测试
# ============================================

@pytest.mark.integration
@pytest.mark.asyncio
async def test_voice_plugin_integration(test_client):
    """测试语音插件集成"""
    # 创建测试音频文件
    from io import BytesIO
    
    audio_content = b"fake audio content for integration test"
    files = {
        'audio': ('test.wav', BytesIO(audio_content), 'audio/wav')
    }
    
    response = test_client.post("/api/v1/voice/transcribe", files=files)
    
    assert response.status_code == 200, f"API请求失败: {response.status_code}"
    data = response.json()
    assert data["success"] is True, f"转换失败: {data.get('error')}"
    assert "text" in data, "缺少转换结果"
    print("✅ 语音插件集成测试成功")
