/**
 * 蝶翅APP Web入口文件
 * 基于DeepSeek Harness构建，专为蝶翅APP定制
 * 提供可切换专家角色的AI工作台功能
 */
import { DiechiAppEntry } from './diechi-app-entry'

const el = document.getElementById('root')
if (el === null) throw new Error('蝶翅APP: 找不到根元素 #root')

// 启动蝶翅APP
void new DiechiAppEntry(el).run()
