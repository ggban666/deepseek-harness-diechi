// 验证 ui-process-control 两个开关按钮是否在侧边栏渲染，并自测 remote.diechiProcess RPC
import { chromium } from '../node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:3090'
const OUT = 'D:/桌面/振翅科技/蝶翅-app/diechi-harness/scripts/ui-process-control-shot.png'

const browser = await chromium.launch({
  executablePath: 'C:/Users/wang/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const logs = []
page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => {
  console.log('goto 警告:', e.message)
})

// 等待侧边栏渲染
await page.waitForTimeout(4000)

// 1) 在 DOM 里找按钮文案
const bodyText = await page.evaluate(() => document.body.innerText)
const hasQwen = bodyText.includes('Qwen3.8') || bodyText.includes('qwen3.8') || bodyText.includes('Qwen')
const hasVision = bodyText.includes('视频') || bodyText.includes('vision') || bodyText.includes('Vision')

console.log('=== DOM 文案检测 ===')
console.log('含 Qwen3.8 相关文案:', hasQwen)
console.log('含 视频模型 相关文案:', hasVision)

// 2) 在 window 上探测 remote.diechiProcess 是否存在（若能访问到前端 remote 对象）
const remoteProbe = await page.evaluate(() => {
  // 尝试多种方式找 remote
  const hints = []
  if (window.__remote) hints.push('window.__remote 存在')
  if (window.__diechiProcess) hints.push('window.__diechiProcess 存在')
  // 扫描全局对象的键
  const keys = Object.keys(window).filter(k => /remote|diechi|process|control/i.test(k)).slice(0, 30)
  hints.push('全局匹配键:', JSON.stringify(keys))
  return hints
})
console.log('=== remote 探测 ===')
remoteProbe.forEach(h => console.log(h))

// 3) 截图
await page.screenshot({ path: OUT, fullPage: false })
console.log('=== 截图已保存:', OUT, '===')

// 4) 打印控制台错误（若有）
const errs = logs.filter(l => l.startsWith('[pageerror]') || l.includes('error') || l.includes('Error'))
if (errs.length) {
  console.log('=== 控制台错误 ===')
  errs.forEach(e => console.log(e))
} else {
  console.log('=== 无控制台错误 ===')
}

await browser.close()
