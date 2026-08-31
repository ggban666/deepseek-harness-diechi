// 点击验证：点击视频模型按钮，看状态变化（停止/启动切换）
import { chromium } from '../node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:3090'
const OUT_DIR = 'D:/桌面/振翅科技/蝶翅-app/diechi-harness/scripts'

const browser = await chromium.launch({
  executablePath: 'C:/Users/wang/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

const logs = []
page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})

await page.waitForTimeout(5000)

await page.screenshot({ path: `${OUT_DIR}/ui-process-control-before-click.png` })
console.log('=== 点击前截图已保存 ===')

const buttons = await page.$$('button')
console.log(`=== 页面共 ${buttons.length} 个按钮 ===`)

let videoBtn = null
let qwenBtn = null
for (const btn of buttons) {
  const text = (await btn.textContent()) || ''
  if (text.includes('视频') || text.includes('vision')) videoBtn = btn
  if (text.includes('Qwen3.8') || text.includes('qwen3.8')) qwenBtn = btn
}

if (videoBtn) {
  const before = (await videoBtn.textContent()).trim().replace(/\s+/g, ' ')
  console.log('=== 视频模型按钮当前文案:', before, '===')
  await videoBtn.click().catch(e => console.log('点击失败:', e.message))
  await page.waitForTimeout(3000)
  const after = (await videoBtn.textContent()).trim().replace(/\s+/g, ' ')
  console.log('=== 视频模型按钮点击后文案:', after, '===')
  await page.screenshot({ path: `${OUT_DIR}/ui-process-control-after-click.png` })
  console.log('=== 点击后截图已保存 ===')
} else {
  console.log('未找到视频模型按钮')
}

if (qwenBtn) {
  const text = (await qwenBtn.textContent()).trim().replace(/\s+/g, ' ')
  console.log('=== Qwen3.8 按钮当前文案:', text, '===')
}

const errs = logs.filter(l => l.startsWith('[pageerror]') || (l.includes('error') && l.includes('require')))
if (errs.length) {
  console.log('=== 控制台错误 ===')
  errs.forEach(e => console.log(e))
} else {
  console.log('=== 无相关错误 ===')
}

await browser.close()
