"""
蝶翅APP - Skill系统插件
基于DeepSeek Harness插件化架构实现

插件功能：
- Skill定义和管理
- 专家角色切换
- Skill参数配置
- Skill执行引擎

学习目标：
- 理解Harness插件系统
- 实现模块化Skill系统
- 学习专家系统设计
"""

import time
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

# 设置日志
logger = logging.getLogger(__name__)


class SkillType(Enum):
    """Skill类型枚举"""
    DOCTOR = "doctor"      # 医生 - 医疗健康咨询
    TEACHER = "teacher"    # 老师 - 教育辅导
    CHEF = "chef"          # 厨师 - 烹饪指导
    ENGINEER = "engineer"  # 工程师 - 技术咨询
    DEFAULT = "default"    # 默认 - 通用助手


@dataclass
class SkillConfig:
    """Skill配置"""
    skill_type: SkillType
    name: str
    description: str
    parameters: Dict[str, Any]
    model: str = "deepseek-chat"
    max_tokens: int = 256
    temperature: float = 0.7


@dataclass
class SkillExecutionResult:
    """Skill执行结果"""
    success: bool
    response: str
    execution_time: float
    tokens_used: int
    timestamp: float


class SkillPlugin:
    """
    Skill系统插件 - Harness插件系统实现
    
    实现专家角色切换和Skill执行引擎
    学习DeepSeek Harness的插件化架构：
    - Skill注册和管理
    - 专家角色切换
    - 参数配置
    - 执行引擎
    """
    
    def __init__(self):
        """插件初始化"""
        self._skills: Dict[str, SkillConfig] = {}
        self._current_skill: Optional[SkillConfig] = None
        self._status: str = "initializing"
        self._stats: Dict[str, Any] = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "avg_execution_time": 0,
            "last_used": None,
            "errors": []
        }
        
        logger.info("🎯 Skill系统插件初始化")
        self._initialize_plugin()
    
    def _initialize_plugin(self) -> None:
        """初始化插件组件
        
        学习Harness插件系统的初始化流程
        """
        try:
            # 注册默认Skill
            self.register_skill(SkillType.DEFAULT, {
                "name": "通用助手",
                "description": "通用AI助手，适合各种日常问题",
                "parameters": {
                    "context_window": 10,
                    "response_style": "friendly"
                }
            })
            
            # 注册专家Skill
            self.register_skill(SkillType.DOCTOR, {
                "name": "医生",
                "description": "专业医疗健康咨询服务",
                "parameters": {
                    "specialty": "内科",
                    "response_style": "professional"
                }
            })
            
            self.register_skill(SkillType.TEACHER, {
                "name": "老师",
                "description": "专业教育辅导和知识传授",
                "parameters": {
                    "subject": "综合",
                    "teaching_style": "interactive"
                }
            })
            
            self.register_skill(SkillType.CHEF, {
                "name": "厨师",
                "description": "专业烹饪指导和食谱推荐",
                "parameters": {
                    "cuisine": "中餐",
                    "difficulty": "简单"
                }
            })
            
            self.register_skill(SkillType.ENGINEER, {
                "name": "工程师",
                "description": "专业技术咨询和问题解决",
                "parameters": {
                    "field": "计算机",
                    "response_style": "technical"
                }
            })
            
            # 设置默认Skill
            self._current_skill = self._skills[SkillType.DEFAULT.value]
            self._status = "ready"
            logger.info("✅ Skill系统插件初始化完成")
            
            # 发布插件就绪事件
            self._publish_event("plugin_ready", {
                "plugin_name": "skill_system",
                "registered_skills": list(self._skills.keys()),
                "current_skill": self._current_skill.skill_type.value if self._current_skill else None,
                "status": "ready"
            })
            
        except Exception as e:
            logger.error(f"❌ Skill系统插件初始化失败: {e}")
            self._status = "failed"
            self._stats["errors"].append(str(e))
            self._publish_event("plugin_failed", {
                "plugin_name": "skill_system",
                "error": str(e)
            })
    
    def _publish_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """发布插件事件（学习Harness的事件系统）
        
        Args:
            event_name: 事件名称
            data: 事件数据
        """
        logger.info(f"📢 发布事件: {event_name}")
        print(f"[SkillPlugin Event] {event_name}: {data}")
    
    def register_skill(self, skill_type: SkillType, config: Dict[str, Any]) -> bool:
        """注册新的Skill
        
        Args:
            skill_type: Skill类型
            config: Skill配置
            
        Returns:
            bool: 注册是否成功
        """
        try:
            skill_config = SkillConfig(
                skill_type=skill_type,
                name=config.get("name", skill_type.value),
                description=config.get("description", ""),
                parameters=config.get("parameters", {})
            )
            
            self._skills[skill_type.value] = skill_config
            logger.info(f"✅ Skill注册成功: {skill_type.value}")
            
            # 发布Skill注册事件
            self._publish_event("skill_registered", {
                "skill_type": skill_type.value,
                "skill_name": skill_config.name
            })
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Skill注册失败: {skill_type.value} - {e}")
            self._stats["errors"].append(f"Skill注册失败: {skill_type.value}")
            return False
    
    def switch_skill(self, skill_type: SkillType) -> bool:
        """切换当前Skill
        
        Args:
            skill_type: 要切换到的Skill类型
            
        Returns:
            bool: 切换是否成功
        """
        if skill_type.value in self._skills:
            self._current_skill = self._skills[skill_type.value]
            logger.info(f"🎯 当前Skill已切换为: {skill_type.value}")
            
            # 发布Skill切换事件
            self._publish_event("skill_switched", {
                "old_skill": self._current_skill.skill_type.value if self._current_skill else None,
                "new_skill": skill_type.value
            })
            
            return True
        else:
            logger.warning(f"⚠️ Skill不存在: {skill_type.value}")
            return False
    
    def get_available_skills(self) -> List[Dict[str, Any]]:
        """获取所有可用的Skill
        
        Returns:
            list: Skill列表
        """
        return [
            {
                "type": skill.skill_type.value,
                "name": skill.name,
                "description": skill.description,
                "is_current": self._current_skill == skill if self._current_skill else False
            }
            for skill in self._skills.values()
        ]
    
    def get_current_skill(self) -> Optional[Dict[str, Any]]:
        """获取当前Skill信息
        
        Returns:
            dict: 当前Skill信息或None
        """
        if self._current_skill:
            return {
                "type": self._current_skill.skill_type.value,
                "name": self._current_skill.name,
                "description": self._current_skill.description,
                "parameters": self._current_skill.parameters
            }
        return None
    
    async def execute_skill(self, prompt: str, context: Optional[str] = None) -> SkillExecutionResult:
        """执行Skill
        
        Args:
            prompt: 用户输入
            context: 上下文信息（可选）
            
        Returns:
            SkillExecutionResult: 执行结果
        """
        start_time = time.time()
        self._stats["total_executions"] += 1
        
        try:
            if not self._current_skill:
                raise ValueError("当前没有激活的Skill")
            
            # 模拟Skill执行过程
            logger.info(f"🎯 执行Skill: {self._current_skill.skill_type.value}")
            logger.info(f"📝 用户输入: {prompt[:50]}...")
            
            # 根据Skill类型生成不同的响应
            if self._current_skill.skill_type == SkillType.DOCTOR:
                response = self._generate_doctor_response(prompt, context)
            elif self._current_skill.skill_type == SkillType.TEACHER:
                response = self._generate_teacher_response(prompt, context)
            elif self._current_skill.skill_type == SkillType.CHEF:
                response = self._generate_chef_response(prompt, context)
            elif self._current_skill.skill_type == SkillType.ENGINEER:
                response = self._generate_engineer_response(prompt, context)
            else:
                response = self._generate_default_response(prompt, context)
            
            # 计算执行指标
            execution_time = time.time() - start_time
            tokens_used = len(response) // 4  # 简化计算
            
            self._stats["avg_execution_time"] = (
                self._stats["avg_execution_time"] * (self._stats["total_executions"] - 1) + execution_time
            ) / self._stats["total_executions"]
            self._stats["last_used"] = time.time()
            self._stats["successful_executions"] += 1
            
            # 发布Skill执行完成事件
            self._publish_event("skill_executed", {
                "skill_type": self._current_skill.skill_type.value,
                "prompt_length": len(prompt),
                "response_length": len(response),
                "execution_time": execution_time,
                "tokens_used": tokens_used
            })
            
            return SkillExecutionResult(
                success=True,
                response=response,
                execution_time=execution_time,
                tokens_used=tokens_used,
                timestamp=time.time()
            )
            
        except Exception as e:
            logger.error(f"❌ Skill执行失败: {e}")
            self._stats["failed_executions"] += 1
            self._stats["errors"].append(str(e))
            
            # 发布Skill执行失败事件
            self._publish_event("skill_execution_failed", {
                "skill_type": self._current_skill.skill_type.value if self._current_skill else "unknown",
                "error": str(e),
                "prompt": prompt[:50] + "..."
            })
            
            return SkillExecutionResult(
                success=False,
                response=f"执行Skill失败: {str(e)}",
                execution_time=time.time() - start_time,
                tokens_used=0,
                timestamp=time.time()
            )
    
    def _generate_doctor_response(self, prompt: str, context: Optional[str] = None) -> str:
        """生成医生Skill响应
        
        Args:
            prompt: 用户输入
            context: 上下文信息
            
        Returns:
            str: AI响应
        """
        return f"👨⚕️ 医生Skill响应：根据您的描述 '{prompt[:30]}...'，建议您注意休息并多喝水。如症状持续，请及时就医。"
    
    def _generate_teacher_response(self, prompt: str, context: Optional[str] = None) -> str:
        """生成老师Skill响应
        
        Args:
            prompt: 用户输入
            context: 上下文信息
            
        Returns:
            str: AI响应
        """
        return f"👩🏫 老师Skill响应：关于 '{prompt[:30]}...' 的问题，我们来一步步学习。首先，让我解释基本概念..."
    
    def _generate_chef_response(self, prompt: str, context: Optional[str] = None) -> str:
        """生成厨师Skill响应
        
        Args:
            prompt: 用户输入
            context: 上下文信息
            
        Returns:
            str: AI响应
        """
        return f"👨🍳 厨师Skill响应：对于 '{prompt[:30]}...' 的烹饪需求，我推荐以下食谱和步骤：1. 准备食材..."
    
    def _generate_engineer_response(self, prompt: str, context: Optional[str] = None) -> str:
        """生成工程师Skill响应
        
        Args:
            prompt: 用户输入
            context: 上下文信息
            
        Returns:
            str: AI响应
        """
        return f"👨💻 工程师Skill响应：关于 '{prompt[:30]}...' 的技术问题，我来为您分析。首先，我们需要考虑...
        
        技术建议：{prompt}"
    
    def _generate_default_response(self, prompt: str, context: Optional[str] = None) -> str:
        """生成默认Skill响应
        
        Args:
            prompt: 用户输入
            context: 上下文信息
            
        Returns:
            str: AI响应
        """
        return f"🤖 通用助手响应：你好！关于您的问题 '{prompt[:30]}...'，我来帮您解决。"
    
    def get_plugin_info(self) -> Dict[str, Any]:
        """获取插件信息（类似Harness的插件诊断）
        
        Returns:
            dict: 插件状态和性能指标
        """
        return {
            "plugin_name": "skill_system",
            "version": "1.0.0",
            "status": self._status,
            "registered_skills": len(self._skills),
            "current_skill": self._current_skill.skill_type.value if self._current_skill else None,
            "available_skills": list(self._skills.keys()),
            "stats": {
                "total_executions": self._stats.get("total_executions", 0),
                "successful_executions": self._stats.get("successful_executions", 0),
                "failed_executions": self._stats.get("failed_executions", 0),
                "avg_execution_time": self._stats.get("avg_execution_time", 0)
            },
            "timestamp": time.time()
        }
    
    def health_check(self) -> Dict[str, Any]:
        """健康检查（类似Harness的健康监控）
        
        Returns:
            dict: 健康状态信息
        """
        return {
            "plugin_name": "skill_system",
            "status": self._status,
            "registered_skills": len(self._skills),
            "current_skill": self._current_skill.skill_type.value if self._current_skill else None,
            "total_executions": self._stats.get("total_executions", 0),
            "successful_executions": self._stats.get("successful_executions", 0),
            "failed_executions": self._stats.get("failed_executions", 0),
            "last_used": self._stats.get("last_used"),
            "timestamp": time.time()
        }
    
    def shutdown(self) -> None:
        """插件关闭（类似Harness的插件卸载）
        
        学习Harness插件系统的清理流程
        """
        logger.info("🔌 Skill系统插件正在关闭...")
        self._status = "shutting_down"
        
        # 发布插件关闭事件
        self._publish_event("plugin_shutdown", {
            "plugin_name": "skill_system",
            "total_executions": self._stats.get("total_executions", 0)
        })
        
        self._status = "shutdown"
        logger.info("✅ Skill系统插件已关闭")


# 创建插件实例
skill_plugin = SkillPlugin()


if __name__ == "__main__":
    # 测试插件
    import asyncio
    
    async def test_plugin():
        print("🎯 测试Skill系统插件...")
        
        # 测试Skill注册
        print(f"📊 注册的Skill数量: {len(skill_plugin.get_available_skills())}")
        
        # 测试Skill切换
        skill_plugin.switch_skill(SkillType.DOCTOR)
        current = skill_plugin.get_current_skill()
        print(f"🎯 当前Skill: {current}")
        
        # 测试Skill执行
        test_prompts = [
            "你好，我感冒了怎么办？",
            "请教我Python编程",
            "教我做一道宫保鸡丁",
            "帮我解决一个网络连接问题"
        ]
        
        for prompt in test_prompts:
            print(f"\n👤 用户: {prompt}")
            result = await skill_plugin.execute_skill(prompt)
            print(f"🤖 Skill响应: {result.response}")
            print(f"✅ 执行状态: {'成功' if result.success else '失败'}")
        
        # 获取插件信息
        info = skill_plugin.get_plugin_info()
        print(f"\n📊 插件信息: {info}")
    
    asyncio.run(test_plugin())
