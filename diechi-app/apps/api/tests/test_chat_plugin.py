"""
蝶翅APP - 对话插件单元测试
基于pytest框架的对话插件测试

测试内容：
- 插件初始化
- 对话生成功能
- 健康检查
- 插件信息

学习目标：
- 掌握pytest测试框架
- 实现测试驱动开发(TDD)
- 学习API集成测试
"""

import pytest
from plugins.chat_plugin import chat_plugin
from conftest import assert_plugin_health, assert_response_success


class TestChatPluginInitialization:
    """测试对话插件初始化"""
    
    def test_plugin_initialization(self):
        """测试插件初始化状态"""
        assert chat_plugin is not None, "对话插件未初始化"
        assert chat_plugin._status == "ready", f"插件状态错误: {chat_plugin._status}"
        print("✅ 对话插件初始化成功")
    
    def test_plugin_info(self):
        """测试插件信息获取"""
        plugin_info = chat_plugin.get_plugin_info()
        assert plugin_info["plugin_name"] == "chat_service", "插件名称错误"
        assert plugin_info["status"] == "ready", "插件状态错误"
        assert "api" in plugin_info, "缺少API信息"
        print("✅ 对话插件信息获取成功")
    
    def test_plugin_health_check(self):
        """测试插件健康检查"""
        health_data = chat_plugin.health_check()
        assert_plugin_health(health_data, "chat_service")
        assert health_data.get("total_requests") >= 0, "请求计数错误"
        print("✅ 对话插件健康检查成功")


class TestChatPluginResponseGeneration:
    """测试对话响应生成功能"""
    
    @pytest.mark.asyncio
    async def test_generate_response_success(self):
        """测试对话响应生成成功"""
        test_prompts = [
            "你好，请问你是谁？",
            "帮我写一封求职信",
            "今天天气怎么样？",
            "教我学习Python编程",
            "给我推荐一本好书"
        ]
        
        for prompt in test_prompts:
            result = await chat_plugin.generate_response(prompt)
            assert result["success"] is True, f"响应生成失败: {result.get('error')}"
            assert "response" in result, "缺少响应结果"
            assert prompt in result["prompt"], "提示词不匹配"
            print(f"✅ 提示词测试通过: '{prompt[:20]}...'")
    
    @pytest.mark.asyncio
    async def test_generate_response_empty_prompt(self):
        """测试空提示词处理"""
        result = await chat_plugin.generate_response("")
        assert result["success"] is False, "空提示词应该生成失败"
        assert "error" in result, "缺少错误信息"
        print("✅ 空提示词处理成功")
    
    @pytest.mark.asyncio
    async def test_generate_response_long_prompt(self):
        """测试长提示词处理"""
        long_prompt = "A" * 1000  # 1000个字符
        result = await chat_plugin.generate_response(long_prompt)
        assert result["success"] is True, f"长提示词处理失败: {result.get('error')}"
        print("✅ 长提示词处理成功")


class TestChatPluginContextManagement:
    """测试对话上下文管理"""
    
    @pytest.mark.asyncio
    async def test_multi_turn_conversation(self):
        """测试多轮对话"""
        conversation = [
            "你好，请问你是谁？",
            "我是AI助手，有什么可以帮你？",
            "帮我写一封求职信",
            "好的，请提供你的基本信息和求职意向"
        ]
        
        for i, message in enumerate(conversation):
            result = await chat_plugin.generate_response(message)
            assert result["success"] is True, f"第{i+1}轮对话失败"
        
        print("✅ 多轮对话测试成功")
    
    @pytest.mark.asyncio
    async def test_context_window(self):
        """测试上下文窗口"""
        # 发送超过上下文窗口的消息
        for i in range(20):
            result = await chat_plugin.generate_response(f"消息{i+1}")
            assert result["success"] is True, f"第{i+1}条消息失败"
        
        health_data = chat_plugin.health_check()
        assert health_data.get("total_requests") == 20, "请求计数错误"
        print("✅ 上下文窗口测试成功")


class TestChatPluginStats:
    """测试对话插件统计功能"""
    
    @pytest.mark.asyncio
    async def test_response_stats(self):
        """测试响应统计"""
        # 执行多次对话
        test_prompts = ["你好", "帮我写代码", "今天天气", "学习Python"]
        
        for prompt in test_prompts:
            await chat_plugin.generate_response(prompt)
        
        health_data = chat_plugin.health_check()
        assert health_data["total_requests"] == 4, "请求计数错误"
        assert health_data["successful_executions"] == 4, "成功执行计数错误"
        print("✅ 响应统计功能正常")
    
    def test_error_stats(self):
        """测试错误统计"""
        initial_errors = chat_plugin._stats.get("errors", 0)
        
        # 模拟错误
        chat_plugin._stats["errors"] = initial_errors + 2
        
        health_data = chat_plugin.health_check()
        assert health_data["errors"] == initial_errors + 2, "错误计数错误"
        print("✅ 错误统计功能正常")


class TestChatPluginShutdown:
    """测试对话插件关闭功能"""
    
    def test_plugin_shutdown(self):
        """测试插件关闭"""
        assert chat_plugin._status == "ready", "插件未就绪"
        
        chat_plugin.shutdown()
        assert chat_plugin._status == "shutdown", "插件关闭状态错误"
        print("✅ 对话插件关闭功能正常")


# ============================================
# 性能测试
# ============================================

@pytest.mark.performance
@pytest.mark.asyncio
async def test_response_generation_performance():
    """测试对话响应生成性能"""
    import time
    
    test_prompts = ["你好", "帮我写代码", "今天天气", "学习Python", "推荐一本书"]
    
    start_time = time.time()
    
    # 执行50次对话
    for _ in range(10):
        for prompt in test_prompts:
            await chat_plugin.generate_response(prompt)
    
    end_time = time.time()
    total_time = end_time - start_time
    avg_time = total_time / 50
    
    print(f"📊 50次对话性能测试:")
    print(f"   总时间: {total_time:.2f}秒")
    print(f"   平均时间: {avg_time:.2f}秒/次")
    print(f"   每秒处理: {50/total_time:.2f}次")
    
    # 性能指标
    assert avg_time < 1.5, f"平均响应时间过长: {avg_time:.2f}秒"
    assert total_time < 75.0, f"总处理时间过长: {total_time:.2f}秒"


# ============================================
# 边界测试
# ============================================

@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_special_characters_prompt():
    """测试特殊字符提示词"""
    special_prompts = [
        "你好！👋 请问你是谁？",
        "帮我写代码：print('Hello, World!')",
        "今天天气怎么样？⛅️",
        "学习Python #编程语言",
        "给我推荐一本好书《深入理解计算机系统》"
    ]
    
    for prompt in special_prompts:
        result = await chat_plugin.generate_response(prompt)
        assert result["success"] is True, f"特殊字符处理失败: {prompt}"
    
    print("✅ 特殊字符处理成功")


@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_unicode_prompt():
    """测试Unicode字符提示词"""
    unicode_prompts = [
        "你好，请问你是谁？",  # 中文
        "Hello, who are you?",  # 英文
        "こんにちは、あなたは誰ですか？",  # 日文
        "你好，请问您是谁？😊",  # Emoji
        "学习编程 💻 很有趣！"  # 中英文混合
    ]
    
    for prompt in unicode_prompts:
        result = await chat_plugin.generate_response(prompt)
        assert result["success"] is True, f"Unicode字符处理失败: {prompt}"
    
    print("✅ Unicode字符处理成功")


# ============================================
# 集成测试
# ============================================

@pytest.mark.integration
@pytest.mark.asyncio
async def test_chat_plugin_integration(test_client):
    """测试对话插件集成"""
    test_prompts = [
        {"prompt": "你好，请问你是谁？"},
        {"prompt": "帮我写一封求职信"},
        {"prompt": "今天天气怎么样？"}
    ]
    
    for test_data in test_prompts:
        response = test_client.post("/api/v1/chat", json=test_data)
        
        assert response.status_code == 200, f"API请求失败: {response.status_code}"
        data = response.json()
        assert data["success"] is True, f"对话生成失败: {data.get('error')}"
        assert "response" in data, "缺少响应结果"
        print(f"✅ 对话API测试通过: '{test_data['prompt'][:20]}...'")
