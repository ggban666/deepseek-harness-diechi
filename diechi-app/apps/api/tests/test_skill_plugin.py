"""
蝶翅APP - Skill系统插件单元测试
基于pytest框架的Skill系统插件测试

测试内容：
- 插件初始化
- Skill注册和管理
- 专家角色切换
- 技能执行
- 健康检查

学习目标：
- 掌握pytest测试框架
- 实现测试驱动开发(TDD)
- 学习专家系统测试
"""

import pytest
from plugins.skill_plugin import skill_plugin, SkillType
from conftest import assert_plugin_health


class TestSkillPluginInitialization:
    """测试Skill系统插件初始化"""
    
    def test_plugin_initialization(self):
        """测试插件初始化状态"""
        assert skill_plugin is not None, "Skill插件未初始化"
        assert skill_plugin._status == "ready", f"插件状态错误: {skill_plugin._status}"
        print("✅ Skill系统插件初始化成功")
    
    def test_plugin_info(self):
        """测试插件信息获取"""
        plugin_info = skill_plugin.get_plugin_info()
        assert plugin_info["plugin_name"] == "skill_system", "插件名称错误"
        assert plugin_info["status"] == "ready", "插件状态错误"
        assert "skills" in plugin_info, "缺少Skill信息"
        print("✅ Skill系统插件信息获取成功")
    
    def test_plugin_health_check(self):
        """测试插件健康检查"""
        health_data = skill_plugin.health_check()
        assert_plugin_health(health_data, "skill_system")
        assert health_data.get("total_executions") >= 0, "执行计数错误"
        print("✅ Skill系统插件健康检查成功")


class TestSkillRegistration:
    """测试Skill注册功能"""
    
    def test_register_default_skill(self):
        """测试注册默认Skill"""
        from plugins.skill_plugin import SkillConfig
        
        config = SkillConfig(
            skill_type=SkillType.DEFAULT,
            name="通用助手",
            description="通用AI助手",
            parameters={"context_window": 10}
        )
        
        success = skill_plugin.register_skill(SkillType.DEFAULT, {
            "name": "通用助手",
            "description": "通用AI助手",
            "parameters": {"context_window": 10}
        })
        
        assert success is True, "Skill注册失败"
        assert SkillType.DEFAULT.value in skill_plugin._skills, "Skill未注册"
        print("✅ 默认Skill注册成功")
    
    def test_register_doctor_skill(self):
        """测试注册医生Skill"""
        success = skill_plugin.register_skill(SkillType.DOCTOR, {
            "name": "医生",
            "description": "专业医疗健康咨询",
            "parameters": {"specialty": "内科"}
        })
        
        assert success is True, "医生Skill注册失败"
        assert SkillType.DOCTOR.value in skill_plugin._skills, "医生Skill未注册"
        print("✅ 医生Skill注册成功")
    
    def test_register_teacher_skill(self):
        """测试注册老师Skill"""
        success = skill_plugin.register_skill(SkillType.TEACHER, {
            "name": "老师",
            "description": "专业教育辅导",
            "parameters": {"subject": "综合"}
        })
        
        assert success is True, "老师Skill注册失败"
        assert SkillType.TEACHER.value in skill_plugin._skills, "老师Skill未注册"
        print("✅ 老师Skill注册成功")
    
    def test_register_chef_skill(self):
        """测试注册厨师Skill"""
        success = skill_plugin.register_skill(SkillType.CHEF, {
            "name": "厨师",
            "description": "专业烹饪指导",
            "parameters": {"cuisine": "中餐"}
        })
        
        assert success is True, "厨师Skill注册失败"
        assert SkillType.CHEF.value in skill_plugin._skills, "厨师Skill未注册"
        print("✅ 厨师Skill注册成功")
    
    def test_register_engineer_skill(self):
        """测试注册工程师Skill"""
        success = skill_plugin.register_skill(SkillType.ENGINEER, {
            "name": "工程师",
            "description": "专业技术咨询",
            "parameters": {"field": "计算机"}
        })
        
        assert success is True, "工程师Skill注册失败"
        assert SkillType.ENGINEER.value in skill_plugin._skills, "工程师Skill未注册"
        print("✅ 工程师Skill注册成功")


class TestSkillSwitching:
    """测试Skill切换功能"""
    
    def test_switch_to_default_skill(self):
        """测试切换到默认Skill"""
        success = skill_plugin.switch_skill(SkillType.DEFAULT)
        assert success is True, "切换到默认Skill失败"
        assert skill_plugin._current_skill.skill_type == SkillType.DEFAULT, "当前Skill错误"
        print("✅ 切换到默认Skill成功")
    
    def test_switch_to_doctor_skill(self):
        """测试切换到医生Skill"""
        success = skill_plugin.switch_skill(SkillType.DOCTOR)
        assert success is True, "切换到医生Skill失败"
        assert skill_plugin._current_skill.skill_type == SkillType.DOCTOR, "当前Skill错误"
        print("✅ 切换到医生Skill成功")
    
    def test_switch_to_teacher_skill(self):
        """测试切换到老师Skill"""
        success = skill_plugin.switch_skill(SkillType.TEACHER)
        assert success is True, "切换到老师Skill失败"
        assert skill_plugin._current_skill.skill_type == SkillType.TEACHER, "当前Skill错误"
        print("✅ 切换到老师Skill成功")
    
    def test_switch_to_invalid_skill(self):
        """测试切换到无效Skill"""
        class InvalidSkillType:
            value = "invalid_skill"
        
        success = skill_plugin.switch_skill(InvalidSkillType())
        assert success is False, "无效Skill切换应该失败"
        print("✅ 无效Skill切换处理成功")


class TestSkillExecution:
    """测试Skill执行功能"""
    
    @pytest.mark.asyncio
    async def test_execute_default_skill(self):
        """测试执行默认Skill"""
        result = await skill_plugin.execute_skill("你好，请问你是谁？")
        
        assert result.success is True, f"Skill执行失败: {result.response}"
        assert "你好，请问你是谁？" in result.response, "响应缺少输入"
        assert "通用助手" in result.response, "响应缺少Skill名称"
        print("✅ 默认Skill执行成功")
        print(f"   响应: {result.response}")
    
    @pytest.mark.asyncio
    async def test_execute_doctor_skill(self):
        """测试执行医生Skill"""
        skill_plugin.switch_skill(SkillType.DOCTOR)
        
        result = await skill_plugin.execute_skill("我感冒了怎么办？")
        
        assert result.success is True, f"医生Skill执行失败: {result.response}"
        assert "感冒" in result.response, "响应缺少医疗相关内容"
        assert "医生" in result.response, "响应缺少Skill名称"
        print("✅ 医生Skill执行成功")
        print(f"   响应: {result.response}")
    
    @pytest.mark.asyncio
    async def test_execute_teacher_skill(self):
        """测试执行老师Skill"""
        skill_plugin.switch_skill(SkillType.TEACHER)
        
        result = await skill_plugin.execute_skill("教我学习Python编程")
        
        assert result.success is True, f"老师Skill执行失败: {result.response}"
        assert "Python" in result.response, "响应缺少编程相关内容"
        assert "老师" in result.response, "响应缺少Skill名称"
        print("✅ 老师Skill执行成功")
        print(f"   响应: {result.response}")
    
    @pytest.mark.asyncio
    async def test_execute_chef_skill(self):
        """测试执行厨师Skill"""
        skill_plugin.switch_skill(SkillType.CHEF)
        
        result = await skill_plugin.execute_skill("教我做一道宫保鸡丁")
        
        assert result.success is True, f"厨师Skill执行失败: {result.response}"
        assert "宫保鸡丁" in result.response, "响应缺少菜肴相关内容"
        assert "厨师" in result.response, "响应缺少Skill名称"
        print("✅ 厨师Skill执行成功")
        print(f"   响应: {result.response}")
    
    @pytest.mark.asyncio
    async def test_execute_engineer_skill(self):
        """测试执行工程师Skill"""
        skill_plugin.switch_skill(SkillType.ENGINEER)
        
        result = await skill_plugin.execute_skill("帮我解决一个网络连接问题")
        
        assert result.success is True, f"工程师Skill执行失败: {result.response}"
        assert "网络" in result.response, "响应缺少技术相关内容"
        assert "工程师" in result.response, "响应缺少Skill名称"
        print("✅ 工程师Skill执行成功")
        print(f"   响应: {result.response}")
    
    @pytest.mark.asyncio
    async def test_execute_skill_with_context(self):
        """测试Skill执行带上下文"""
        skill_plugin.switch_skill(SkillType.TEACHER)
        
        context = "用户是一名初学者"
        result = await skill_plugin.execute_skill("教我Python基础", context)
        
        assert result.success is True, f"带上下文的Skill执行失败: {result.response}"
        print("✅ 带上下文的Skill执行成功")


class TestSkillStats:
    """测试Skill系统统计功能"""
    
    @pytest.mark.asyncio
    async def test_execution_stats(self):
        """测试执行统计"""
        # 切换到默认Skill
        skill_plugin.switch_skill(SkillType.DEFAULT)
        
        # 执行多次Skill
        test_prompts = [
            "你好",
            "帮我写代码",
            "今天天气",
            "学习Python"
        ]
        
        for prompt in test_prompts:
            await skill_plugin.execute_skill(prompt)
        
        health_data = skill_plugin.health_check()
        assert health_data["total_executions"] == 4, "执行计数错误"
        assert health_data["successful_executions"] == 4, "成功执行计数错误"
        print("✅ 执行统计功能正常")
    
    def test_error_stats(self):
        """测试错误统计"""
        initial_errors = skill_plugin._stats.get("errors", 0)
        
        # 模拟错误
        skill_plugin._stats["errors"] = initial_errors + 2
        
        health_data = skill_plugin.health_check()
        assert health_data["errors"] == initial_errors + 2, "错误计数错误"
        print("✅ 错误统计功能正常")


class TestSkillPluginShutdown:
    """测试Skill系统插件关闭功能"""
    
    def test_plugin_shutdown(self):
        """测试插件关闭"""
        assert skill_plugin._status == "ready", "插件未就绪"
        
        skill_plugin.shutdown()
        assert skill_plugin._status == "shutdown", "插件关闭状态错误"
        print("✅ Skill系统插件关闭功能正常")


# ============================================
# 性能测试
# ============================================

@pytest.mark.performance
@pytest.mark.asyncio
async def test_skill_execution_performance():
    """测试Skill执行性能"""
    import time
    
    test_prompts = ["你好", "帮我写代码", "今天天气", "学习Python", "推荐一本书"]
    
    start_time = time.time()
    
    # 执行100次Skill
    for _ in range(20):
        for prompt in test_prompts:
            await skill_plugin.execute_skill(prompt)
    
    end_time = time.time()
    total_time = end_time - start_time
    avg_time = total_time / 100
    
    print(f"📊 100次Skill执行性能测试:")
    print(f"   总时间: {total_time:.2f}秒")
    print(f"   平均时间: {avg_time:.2f}秒/次")
    print(f"   每秒处理: {100/total_time:.2f}次")
    
    # 性能指标
    assert avg_time < 1.0, f"平均响应时间过长: {avg_time:.2f}秒"
    assert total_time < 100.0, f"总处理时间过长: {total_time:.2f}秒"


# ============================================
# 边界测试
# ============================================

@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_empty_prompt_execution():
    """测试空提示词执行"""
    result = await skill_plugin.execute_skill("")
    assert result.success is False, "空提示词应该执行失败"
    print("✅ 空提示词处理成功")


@pytest.mark.edge_case
@pytest.mark.asyncio
async def test_very_long_prompt_execution():
    """测试超长提示词执行"""
    long_prompt = "A" * 2000  # 2000个字符
    result = await skill_plugin.execute_skill(long_prompt)
    assert result.success is True, f"超长提示词处理失败: {result.response}"
    print("✅ 超长提示词处理成功")


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
        result = await skill_plugin.execute_skill(prompt)
        assert result.success is True, f"特殊字符处理失败: {prompt}"
    
    print("✅ 特殊字符处理成功")


# ============================================
# 集成测试
# ============================================

@pytest.mark.integration
@pytest.mark.asyncio
async def test_skill_plugin_integration(test_client):
    """测试Skill系统插件集成"""
    
    # 测试获取Skill列表
    response = test_client.get("/api/v1/skills")
    assert response.status_code == 200, f"API请求失败: {response.status_code}"
    data = response.json()
    assert "skills" in data, "缺少skills字段"
    assert len(data["skills"]) > 0, "Skill列表为空"
    print("✅ Skill列表API测试成功")
    
    # 测试切换Skill
    response = test_client.post("/api/v1/skills/switch", json={"skill_type": "doctor"})
    assert response.status_code == 200, f"API请求失败: {response.status_code}"
    data = response.json()
    assert data["success"] is True, f"Skill切换失败: {data.get('message')}"
    print("✅ Skill切换API测试成功")
    
    # 测试执行Skill
    response = test_client.post("/api/v1/skills/execute", json={"prompt": "我感冒了怎么办？"})
    assert response.status_code == 200, f"API请求失败: {response.status_code}"
    data = response.json()
    assert data["success"] is True, f"Skill执行失败: {data.get('response')}"
    print("✅ Skill执行API测试成功")
