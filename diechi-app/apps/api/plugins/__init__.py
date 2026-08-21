"""
蝶翅APP插件系统初始化
基于DeepSeek Harness插件化架构实现

插件系统架构：
- 插件注册和管理
- 服务发现
- 事件总线
- 配置管理

学习目标：
- 理解Harness插件系统
- 实现模块化服务
- 学习事件驱动架构
"""

from typing import Dict, Any, Optional
import logging

# 设置插件系统日志
logger = logging.getLogger(__name__)


class PluginManager:
    """
    插件管理器 - 类似DeepSeek Harness的插件管理系统
    
    负责：
    - 插件注册和管理
    - 服务发现
    - 事件总线
    - 配置管理
    """
    
    def __init__(self):
        """初始化插件管理器"""
        self._plugins: Dict[str, Any] = {}
        self._event_handlers: Dict[str, list] = {}
        self._config: Dict[str, Any] = {}
        self._status: str = "initializing"
        
        logger.info("🔌 插件管理器初始化")
    
    def register_plugin(self, plugin_name: str, plugin_instance: Any) -> None:
        """注册插件（类似Harness的插件注册）
        
        Args:
            plugin_name: 插件名称
            plugin_instance: 插件实例
        """
        try:
            self._plugins[plugin_name] = plugin_instance
            logger.info(f"✅ 插件注册成功: {plugin_name}")
            
            # 发布插件注册事件
            self._publish_event("plugin_registered", {
                "plugin_name": plugin_name,
                "plugin_type": plugin_instance.__class__.__name__
            })
            
        except Exception as e:
            logger.error(f"❌ 插件注册失败: {plugin_name} - {e}")
            self._publish_event("plugin_registration_failed", {
                "plugin_name": plugin_name,
                "error": str(e)
            })
    
    def get_plugin(self, plugin_name: str) -> Optional[Any]:
        """获取插件实例（类似Harness的服务发现）
        
        Args:
            plugin_name: 插件名称
            
        Returns:
            插件实例或None
        """
        return self._plugins.get(plugin_name)
    
    def list_plugins(self) -> Dict[str, Any]:
        """列出所有已注册的插件
        
        Returns:
            dict: 包含所有插件信息的字典
        """
        return {
            "total_plugins": len(self._plugins),
            "plugins": list(self._plugins.keys()),
            "status": self._status
        }
    
    def register_event_handler(self, event_name: str, handler: callable) -> None:
        """注册事件处理器（类似Harness的事件系统）
        
        Args:
            event_name: 事件名称
            handler: 处理函数
        """
        if event_name not in self._event_handlers:
            self._event_handlers[event_name] = []
        
        self._event_handlers[event_name].append(handler)
        logger.info(f"📢 事件处理器注册: {event_name}")
    
    def _publish_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """发布事件到事件总线
        
        Args:
            event_name: 事件名称
            data: 事件数据
        """
        logger.debug(f"📢 发布事件: {event_name}")
        
        # 触发所有注册的事件处理器
        if event_name in self._event_handlers:
            for handler in self._event_handlers[event_name]:
                try:
                    handler(event_name, data)
                except Exception as e:
                    logger.error(f"❌ 事件处理器执行失败: {event_name} - {e}")
    
    def set_config(self, config: Dict[str, Any]) -> None:
        """设置插件系统配置
        
        Args:
            config: 配置字典
        """
        self._config.update(config)
        logger.info(f"📝 配置更新: {len(config)}个配置项")
    
    def get_config(self, key: Optional[str] = None) -> Any:
        """获取配置
        
        Args:
            key: 配置键（可选，如果为None则返回所有配置）
            
        Returns:
            配置值或所有配置字典
        """
        if key:
            return self._config.get(key)
        return self._config
    
    def health_check(self) -> Dict[str, Any]:
        """健康检查
        
        Returns:
            dict: 健康状态信息
        """
        return {
            "status": self._status,
            "total_plugins": len(self._plugins),
            "registered_plugins": list(self._plugins.keys()),
            "total_event_handlers": sum(len(handlers) for handlers in self._event_handlers.values()),
            "config_keys": list(self._config.keys()),
            "timestamp": "2024-02-07T12:00:00Z"
        }
    
    def shutdown(self) -> None:
        """关闭插件管理器
        
        类似Harness的插件系统清理
        """
        logger.info("🔌 插件管理器正在关闭...")
        self._status = "shutting_down"
        
        # 发布关闭事件
        self._publish_event("plugin_manager_shutdown", {
            "total_plugins": len(self._plugins),
            "total_event_handlers": sum(len(handlers) for handlers in self._event_handlers.values())
        })
        
        self._status = "shutdown"
        logger.info("✅ 插件管理器已关闭")


# 创建全局插件管理器实例
plugin_manager = PluginManager()


# 插件系统初始化函数
async def initialize_plugin_system() -> None:
    """初始化插件系统
    
    学习Harness插件系统的初始化流程
    """
    logger.info("🚀 初始化蝶翅APP插件系统...")
    
    # 在这里可以添加插件初始化逻辑
    # 例如：加载默认插件、注册事件处理器等
    
    logger.info("✅ 插件系统初始化完成")


# 事件处理器示例
async def log_event_handler(event_name: str, data: Dict[str, Any]) -> None:
    """事件处理器示例 - 记录所有事件
    
    Args:
        event_name: 事件名称
        data: 事件数据
    """
    logger.info(f"📝 事件日志: [{event_name}] {data}")


# 注册全局事件处理器
plugin_manager.register_event_handler("*", log_event_handler)


# 导出插件管理器
__all__ = ["plugin_manager", "initialize_plugin_system"]
