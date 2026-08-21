"""
蝶翅APP - 视觉识别插件单元测试
基于pytest框架的视觉识别插件测试

测试内容：
- 插件初始化
- 图像识别功能
- 物体检测
- 场景理解
- 健康检查

学习目标：
- 掌握pytest测试框架
- 实现测试驱动开发(TDD)
- 学习AI模型测试
"""

import pytest
from plugins.vision_plugin import vision_plugin
from conftest import assert_plugin_health


class TestVisionPluginInitialization:
    """测试视觉识别插件初始化"""
    
    def test_plugin_initialization(self):
        """测试插件初始化状态"""
        assert vision_plugin is not None, "视觉识别插件未初始化"
        assert vision_plugin._status == "ready", f"插件状态错误: {vision_plugin._status}"
        print("✅ 视觉识别插件初始化成功")
    
    def test_plugin_info(self):
        """测试插件信息获取"""
        plugin_info = vision_plugin.get_plugin_info()
        assert plugin_info["plugin_name"] == "vision_recognition", "插件名称错误"
        assert plugin_info["status"] == "ready", "插件状态错误"
        assert "model" in plugin_info, "缺少模型信息"
        print("✅ 视觉识别插件信息获取成功")
    
    def test_plugin_health_check(self):
        """测试插件健康检查"""
        health_data = vision_plugin.health_check()
        assert_plugin_health(health_data, "vision_recognition")
        assert health_data.get("total_requests") >= 0, "请求计数错误"
        print("✅ 视觉识别插件健康检查成功")


class TestVisionPluginImageRecognition:
    """测试图像识别功能"""
    
    @pytest.mark.asyncio
    async def test_recognize_image_success(self, mock_image_file):
        """测试图像识别成功"""
        result = await vision_plugin.recognize_image(mock_image_file)
        assert result["success"] is True, f"识别失败: {result.get('error')}"
        assert "description" in result, "缺少描述结果"
        assert "objects" in result, "缺少物体检测结果"
        assert "scene" in result, "缺少场景理解结果"
        
        # 验证识别结果
        assert len(result["objects"]) > 0, "物体检测结果为空"
        assert result["scene"] is not None, "场景理解结果为空"
        assert len(result["description"]) > 0, "描述结果为空"
        
        print("✅ 图像识别成功")
        print(f"   描述: {result['description'][:50]}...")
        print(f"   物体: {len(result['objects'])}个")
        print(f"   场景: {result['scene']}")
    
    @pytest.mark.asyncio
    async def test_recognize_image_invalid_file(self):
        """测试无效文件处理"""
        class InvalidFile:
            def __init__(self):
                self.filename = "invalid.txt"
                self.size = 1024
            
            async def read(self):
                return b"invalid content"
        
        result = await vision_plugin.recognize_image(InvalidFile())
        assert result["success"] is False, "无效文件应该识别失败"
        assert "error" in result, "缺少错误信息"
        print("✅ 无效文件处理成功")
    
    @pytest.mark.asyncio
    async def test_recognize_image_large_file(self, temp_dir):
        """测试大文件处理"""
        large_file = temp_dir / "large_image.jpg"
        large_file.write_bytes(b"x" * (11 * 1024 * 1024))  # 11MB
        
        class LargeFile:
            def __init__(self):
                self.filename = "large_image.jpg"
                self.size = 11 * 1024 * 1024
            
            async def read(self):
                return large_file.read_bytes()
        
        result = await vision_plugin.recognize_image(LargeFile())
        assert result["success"] is False, "大文件应该识别失败"
        assert "error" in result, "缺少错误信息"
        print("✅ 大文件处理成功")


class TestVisionPluginObjectDetection:
    """测试物体检测功能"""
    
    @pytest.mark.asyncio
    async def test_object_detection(self, mock_image_file):
        """测试物体检测"""
        result = await vision_plugin.recognize_image(mock_image_file)
        
        assert len(result["objects"]) > 0, "物体检测结果为空"
        
        # 验证物体检测结果格式
        for obj in result["objects"]:
            assert "name" in obj, "物体缺少名称"
            assert "confidence" in obj, "物体缺少置信度"
            assert 0 <= obj["confidence"] <= 1, "置信度范围错误"
            assert obj["confidence"] >= 0.8, f"置信度过低: {obj['confidence']}"
        
        print("✅ 物体检测功能正常")
        print(f"   检测到 {len(result['objects'])} 个物体")
        for obj in result["objects"]:
            print(f"   - {obj['name']}: {obj['confidence']*100:.1f}%")
    
    @pytest.mark.asyncio
    async def test_scene_understanding(self, mock_image_file):
        """测试场景理解"""
        result = await vision_plugin.recognize_image(mock_image_file)
        
        assert result["scene"] is not None, "场景理解结果为空"
        assert len(result["scene"]) > 0, "场景描述为空"
        
        # 验证场景类型
        valid_scenes = ["室内", "室外", "办公室", "卧室", "厨房", "客厅", "街道", "公园"]
        assert result["scene"] in valid_scenes, f"未知场景: {result['scene']}"
        
        print("✅ 场景理解功能正常")
        print(f"   场景: {result['scene']}")


class TestVisionPluginDescriptionGeneration:
    """测试描述生成功能"""
    
    @pytest.mark.asyncio
    async def test_description_generation(self, mock_image_file):
        """测试描述生成"""
        result = await vision_plugin.recognize_image(mock_image_file)
        
        assert len(result["description"]) > 50, "描述过短"
        assert len(result["description"]) < 500, "描述过长"
        
        # 验证描述包含关键信息
        description = result["description"].lower()
        assert "人" in description or "object" in description, "描述缺少主要物体"
        assert "office" in description.lower() or "室内" in description, "描述缺少场景信息"
        
        print("✅ 描述生成功能正常")
        print(f"   描述: {result['description'][:100]}...")


class TestVisionPluginStats:
    """测试视觉识别插件统计功能"""
    
    @pytest.mark.asyncio
    async def test_recognition_stats(self, mock_image_file):
        """测试识别统计"""
        # 执行多次识别
        for _ in range(5):
            await vision_plugin.recognize_image(mock_image_file)
        
        health_data = vision_plugin.health_check()
        assert health_data["total_requests"] == 5, "请求计数错误"
        assert health_data["successful_executions"] == 5, "成功执行计数错误"
        assert health_data["objects_detected"] > 0, "物体检测计数错误"
        print("✅ 识别统计功能正常")
    
    def test_error_stats(self):
        """测试错误统计"""
        initial_errors = vision_plugin._stats.get("errors", 0)
        
        # 模拟错误
        vision_plugin._stats["errors"] = initial_errors + 1
        
        health_data = vision_plugin.health_check()
        assert health_data["errors"] == initial_errors + 1, "错误计数错误"
        print("✅ 错误统计功能正常")


class TestVisionPluginShutdown:
    """测试视觉识别插件关闭功能"""
    
    def test_plugin_shutdown(self):
        """测试插件关闭"""
        assert vision_plugin._status == "ready", "插件未就绪"
        
        vision_plugin.shutdown()
        assert vision_plugin._status == "shutdown", "插件关闭状态错误"
        print("✅ 视觉识别插件关闭功能正常")


# ============================================
# 性能测试
# ============================================

@pytest.mark.performance
@pytest.mark.asyncio
async def test_image_recognition_performance(mock_image_file):
    """测试图像识别性能"""
    import time
    
    start_time = time.time()
    
    # 执行20次识别
    for _ in range(20):
        await vision_plugin.recognize_image(mock_image_file)
    
    end_time = time.time()
    total_time = end_time - start_time
    avg_time = total_time / 20
    
    print(f"📊 20次图像识别性能测试:")
    print(f"   总时间: {total_time:.2f}秒")
    print(f"   平均时间: {avg_time:.2f}秒/次")
    print(f"   每秒处理: {20/total_time:.2f}次")
    
    # 性能指标 (基于INT8量化模型，预期2.5-4.0秒/图像)
    assert avg_time < 5.0, f"平均响应时间过长: {avg_time:.2f}秒"
    assert total_time < 100.0, f"总处理时间过长: {total_time:.2f}秒"
    print("✅ 性能测试通过")


# ============================================
# 边界测试
# ============================================

@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_empty_image_file():
    """测试空图像文件"""
    class EmptyFile:
        def __init__(self):
            self.filename = "empty.jpg"
            self.size = 0
        
        async def read(self):
            return b""
    
    result = await vision_plugin.recognize_image(EmptyFile())
    assert result["success"] is False, "空文件应该识别失败"
    print("✅ 空图像文件处理成功")


@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_unsupported_image_format():
    """测试不支持的图像格式"""
    class UnsupportedFile:
        def __init__(self):
            self.filename = "test.mp3"
            self.size = 1024
        
        async def read(self):
            return b"fake mp3 content"
    
    result = await vision_plugin.recognize_image(UnsupportedFile())
    assert result["success"] is False, "不支持的格式应该识别失败"
    print("✅ 不支持格式处理成功")


@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_corrupted_image_file():
    """测试损坏的图像文件"""
    class CorruptedFile:
        def __init__(self):
            self.filename = "corrupted.jpg"
            self.size = 1024
        
        async def read(self):
            return b"PK\x03\x04..."  # ZIP文件头，不是JPEG
    
    result = await vision_plugin.recognize_image(CorruptedFile())
    assert result["success"] is False, "损坏文件应该识别失败"
    print("✅ 损坏文件处理成功")


# ============================================
# 集成测试
# ============================================

@pytest.mark.integration
@pytest.mark.asyncio
async def test_vision_plugin_integration(test_client):
    """测试视觉识别插件集成"""
    from io import BytesIO
    
    # 创建测试图像文件
    image_content = b"fake image content for integration test"
    files = {
        'image': ('test.jpg', BytesIO(image_content), 'image/jpeg')
    }
    
    response = test_client.post("/api/v1/vision/recognize", files=files)
    
    assert response.status_code == 200, f"API请求失败: {response.status_code}"
    data = response.json()
    assert data["success"] is True, f"图像识别失败: {data.get('error')}"
    assert "description" in data, "缺少描述结果"
    assert "objects" in data, "缺少物体检测结果"
    assert "scene" in data, "缺少场景理解结果"
    print("✅ 视觉识别插件集成测试成功")
