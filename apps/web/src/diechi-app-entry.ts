/**
 * 蝶翅APP专用入口文件
 * 集成DeepSeek Harness的基础功能 + 蝶翅APP的定制功能
 */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { startDiechiApp } from './diechi-config'
import { apply as diechiSkillDispatcher } from './diechi-skill-dispatcher'

// 蝶翅APP专用入口类
class DiechiAppEntry extends AppWebEntry {
  constructor(el: HTMLElement) {
    super(el)
  }

  // 重写启动方法，添加蝶翅APP的定制功能
  async run() {
    console.log('🎉 蝶翅APP启动程序开始...')
    
    try {
      // 1. 启动蝶翅APP配置
      const config = await startDiechiApp()
      console.log('✅ 蝶翅APP配置加载完成')
      
      // 2. 注册蝶翅Skill调度器插件
      this.ctx.plugin(diechiSkillDispatcher)
      console.log('✅ 蝶翅Skill调度器插件注册完成')
      
      // 3. 调用父类的run方法启动Harness
      await super.run()
      
      console.log('🚀 蝶翅APP启动完成！')
      console.log('📋 当前专家角色:', this.ctx.get('diechi-skill')?.getCurrentSkill()?.name || '未设置')
      
      // 显示欢迎消息
      this.showWelcomeMessage()
      
    } catch (error) {
      console.error('❌ 蝶翅APP启动失败:', error)
      this.showErrorMessage(error as Error)
    }
  }

  // 显示欢迎消息
  private showWelcomeMessage() {
    setTimeout(() => {
      const currentSkill = this.ctx.get('diechi-skill')?.getCurrentSkill()
      if (currentSkill) {
        console.log(`
🎯 当前专家角色: ${currentSkill.name}
📋 描述: ${currentSkill.description}
🏷️ 分类: ${currentSkill.category}

💡 提示: 点击右侧的Skill管理面板可以切换不同的专家角色
🔄 体验不同领域的专业AI服务
`)
      }
    }, 2000)
  }

  // 显示错误消息
  private showErrorMessage(error: Error) {
    const el = document.getElementById('root')
    if (el) {
      el.innerHTML = `
        <div style="
          padding: 40px;
          text-align: center;
          background: #fff3e0;
          border-radius: 12px;
          max-width: 600px;
          margin: 40px auto;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        ">
          <h2 style="color: #e65100; margin-bottom: 20px;">⚠️ 蝶翅APP启动失败</h2>
          <p style="color: #d32f2f; margin-bottom: 16px;">${error.message}</p>
          <p style="color: #666; font-size: 14px;">
            请检查浏览器控制台获取详细错误信息，或尝试刷新页面。
          </p>
          <button 
            onclick="window.location.reload()"
            style="
              background: #1e88e5;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              margin-top: 16px;
              transition: background 0.2s;
            "
            onmouseover="this.style.background='#1565c0'"
            onmouseout="this.style.background='#1e88e5'"
          >
            刷新页面
          </button>
        </div>
      `
    }
  }
}

// 导出DiechiAppEntry
export { DiechiAppEntry }

export default DiechiAppEntry