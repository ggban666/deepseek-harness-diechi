"""
蝶翅APP主应用 - 基于FastAPI的插件化架构
学习DeepSeek Harness的插件化架构实现

核心架构特性：
- 插件化服务（类似Harness插件系统）
- 事件驱动架构
- 模块化设计
- 配置管理
- 健康监控

学习目标：
- 理解Harness插件系统
- 实现模块化服务
- 学习事件驱动架构
"""

import os
import logging
from typing import Dict, Any
import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 导入插件系统
from plugins import plugin_manager, initialize_plugin_system
from plugins.voice_plugin import voice_plugin
from plugins.chat_plugin import chat_plugin
from plugins.vision_plugin import vision_plugin
from plugins.skill_plugin import skill_plugin

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 创建FastAPI应用
app = FastAPI(
    title="蝶翅AI助手API",
    description="基于DeepSeek Harness插件化架构的多模态AI助手",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件服务
app.mount("/static", StaticFiles(directory="static"), name="static")

# 创建临时目录
os.makedirs("temp", exist_ok=True)
os.makedirs("uploads", exist_ok=True)


@app.on_event("startup")
async def startup_event():
    """应用启动时的初始化
    
    学习Harness的应用启动流程
    """
    logger.info("🚀 蝶翅APP启动中...")
    
    try:
        # 1. 初始化插件系统
        await initialize_plugin_system()
        
        # 2. 注册核心插件
        plugin_manager.register_plugin("voice_recognition", voice_plugin)
        plugin_manager.register_plugin("chat_service", chat_plugin)
        plugin_manager.register_plugin("vision_recognition", vision_plugin)
        plugin_manager.register_plugin("skill_system", skill_plugin)
        
        # 3. 发布应用启动事件
        plugin_manager._publish_event("application_started", {
            "version": "1.0.0",
            "plugins": ["voice_recognition", "chat_service"]
        })
        
        logger.info("✅ 蝶翅APP启动成功")
        logger.info(f"📊 插件系统状态: {plugin_manager.health_check()}")
        
    except Exception as e:
        logger.error(f"❌ 应用启动失败: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时的清理
    
    学习Harness的应用关闭流程
    """
    logger.info("🔌 蝶翅APP正在关闭...")
    
    try:
        # 1. 关闭插件系统
        voice_plugin.shutdown()
        chat_plugin.shutdown()
        plugin_manager.shutdown()
        
        # 2. 发布应用关闭事件
        plugin_manager._publish_event("application_shutdown", {
            "timestamp": "2024-02-07T12:00:00Z"
        })
        
        logger.info("✅ 蝶翅APP已关闭")
        
    except Exception as e:
        logger.error(f"❌ 应用关闭失败: {e}")


# 健康检查端点
@app.get("/health", tags=["系统管理"])
async def health_check():
    """系统健康检查
    
    返回系统整体健康状态
    """
    try:
        # 获取各个组件的健康状态
        voice_status = voice_plugin.health_check()
        chat_status = chat_plugin.health_check()
        plugin_status = plugin_manager.health_check()
        
        overall_status = "healthy" if (
            voice_status["status"] == "ready" and
            chat_status["status"] == "ready" and
            plugin_status["status"] == "ready"
        ) else "degraded"
        
        return {
            "status": overall_status,
            "timestamp": "2024-02-07T12:00:00Z",
            "components": {
                "voice_recognition": voice_status,
                "chat_service": chat_status,
                "plugin_manager": plugin_status
            },
            "message": "蝶翅APP系统正常运行"
        }
    
    except Exception as e:
        return {
            "status": "unhealthy",
            "timestamp": "2024-02-07T12:00:00Z",
            "error": str(e),
            "message": "系统检查失败"
        }


# 插件信息端点
@app.get("/plugins", tags=["系统管理"])
async def list_plugins():
    """列出所有已注册的插件
    
    返回插件系统状态和已注册插件列表
    """
    return plugin_manager.list_plugins()


# 语音识别API
@app.post("/api/v1/voice/transcribe", tags=["语音识别"])
async def transcribe_audio(audio: UploadFile = File(...)):
    """语音转文字
    
    使用Whisper模型进行语音识别
    
    Args:
        audio: 上传的音频文件
        
    Returns:
        dict: 包含转换结果和状态
    """
    try:
        # 获取语音识别插件
        voice_service = plugin_manager.get_plugin("voice_recognition")
        if not voice_service:
            raise HTTPException(status_code=503, detail="语音识别服务不可用")
        
        # 调用插件服务
        result = await voice_service.transcribe_audio(audio)
        
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "语音转换失败"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 语音转换API错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 视觉识别API
@app.post("/api/v1/vision/recognize", tags=["视觉识别"])
async def recognize_image(image: UploadFile = File(...)):
    """图像识别
    
    使用Mage-VL-4B模型进行视觉识别
    
    Args:
        image: 上传的图像文件
        
    Returns:
        dict: 包含识别结果和状态
    """
    try:
        # 获取视觉识别插件
        vision_service = plugin_manager.get_plugin("vision_recognition")
        if not vision_service:
            raise HTTPException(status_code=503, detail="视觉识别服务不可用")
        
        # 调用插件服务
        result = await vision_service.recognize_image(image)
        
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "图像识别失败"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 图像识别API错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 对话API
@app.post("/api/v1/chat", tags=["对话系统"])
async def chat(prompt: str):
    """文本对话
    
    使用DeepSeek API进行智能对话
    
    Args:
        prompt: 用户输入的文本
        
    Returns:
        dict: 包含AI回复和状态
    """
    try:
        # 获取对话服务插件
        chat_service = plugin_manager.get_plugin("chat_service")
        if not chat_service:
            raise HTTPException(status_code=503, detail="对话服务不可用")
        
        # 调用插件服务
        result = await chat_service.generate_response(prompt)
        
        if not result.get("success"):
            raise HTTPException(status_code=503, detail=result.get("error", "AI对话服务不可用"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 对话API错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Skill系统API
@app.get("/api/v1/skills", tags=["Skill系统"])
async def get_available_skills():
    """获取所有可用的Skill
    
    返回Skill列表和当前激活的Skill
    
    Returns:
        dict: Skill列表和状态
    """
    try:
        skill_service = plugin_manager.get_plugin("skill_system")
        if not skill_service:
            raise HTTPException(status_code=503, detail="Skill系统不可用")
        
        return {
            "skills": skill_service.get_available_skills(),
            "current_skill": skill_service.get_current_skill(),
            "status": "success"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 获取Skill列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/skills/switch", tags=["Skill系统"])
async def switch_skill(skill_type: str):
    """切换当前Skill
    
    Args:
        skill_type: 要切换到的Skill类型
        
    Returns:
        dict: 切换结果
    """
    try:
        skill_service = plugin_manager.get_plugin("skill_system")
        if not skill_service:
            raise HTTPException(status_code=503, detail="Skill系统不可用")
        
        from plugins.skill_plugin import SkillType
        skill_enum = SkillType(skill_type)
        
        success = skill_service.switch_skill(skill_enum)
        
        if not success:
            raise HTTPException(status_code=400, detail=f"切换Skill失败: {skill_type}")
        
        return {
            "success": True,
            "current_skill": skill_service.get_current_skill(),
            "message": f"已切换到{skill_type}技能"
        }
        
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的Skill类型: {skill_type}")
    except Exception as e:
        logger.error(f"❌ 切换Skill失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/skills/execute", tags=["Skill系统"])
async def execute_skill(prompt: str, context: Optional[str] = None):
    """执行当前Skill
    
    Args:
        prompt: 用户输入
        context: 上下文信息（可选）
        
    Returns:
        dict: Skill执行结果
    """
    try:
        skill_service = plugin_manager.get_plugin("skill_system")
        if not skill_service:
            raise HTTPException(status_code=503, detail="Skill系统不可用")
        
        result = await skill_service.execute_skill(prompt, context)
        
        if not result.success:
            raise HTTPException(status_code=500, detail=result.response)
        
        return {
            "success": True,
            "response": result.response,
            "execution_time": result.execution_time,
            "tokens_used": result.tokens_used,
            "current_skill": skill_service.get_current_skill(),
            "timestamp": result.timestamp
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Skill执行失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 插件诊断端点
@app.get("/api/v1/plugins/{plugin_name}/info", tags=["系统管理"])
async def get_plugin_info(plugin_name: str):
    """获取插件详细信息
    
    返回特定插件的诊断信息
    
    Args:
        plugin_name: 插件名称
        
    Returns:
        dict: 插件详细信息
    """
    try:
        plugin = plugin_manager.get_plugin(plugin_name)
        if not plugin:
            raise HTTPException(status_code=404, detail=f"插件不存在: {plugin_name}")
        
        return plugin.get_plugin_info()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 插件诊断错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 根路径重定向到API文档
@app.get("/", include_in_schema=False)
async def root():
    """根路径重定向到API文档"""
    return {
        "message": "蝶翅AI助手API服务",
        "version": "1.0.0",
        "documentation": "/api/docs",
        "health_check": "/health",
        "plugins": "/plugins"
    }


# 主应用运行
if __name__ == "__main__":
    logger.info("🚀 启动蝶翅APP主应用...")
    logger.info(f"📊 当前环境: {'生产' if os.getenv('ENVIRONMENT') == 'production' else '开发'}")
    logger.info(f"🔌 API文档: http://localhost:8000/api/docs")
    logger.info(f"🏥 健康检查: http://localhost:8000/health")
    
    # 运行FastAPI应用
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_config=None,
        access_log=True
    )
