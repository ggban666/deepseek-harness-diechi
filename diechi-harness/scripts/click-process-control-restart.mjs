// 验证 toggle 双向：再次点击视频模型按钮，看是否从「已停止」重新启动
import { chromium } from '../node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:3090'
const OUT_DIR = 'D:/桌面/振翅科技/蝶翅-app/diechi-harness/scripts'

const browser = await chromium.launch({
  executablePath: 'C:/Users/wang/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

page.on('pageerror', e => console.log('[pageerror]', e.message))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
await page.waitForTimeout(5000)

const buttons = await page.$$('button')
let videoBtn = null
for (const btn of buttons) {
  const text = (await btn.textContent()) || ''
  if (text.includes('视频') || text.includes('vision')) { videoBtn = btn; break }
}

if (!videoBtn) { console.log('未找到视频模型按钮'); process.exit(1) }

const before = (await videoBtn.textContent()).trim().replace(/\s+/g, ' ')
console.log('=== 状态1:', before, '===')

// 第一次点击：应该启动
await videoBtn.click().catch(e => console.log('点击1失败:', e.message))
await page.waitForTimeout(5000)
const after1 = (await videoBtn.textContent()).trim().replace(/\s+/g, ' ')
console.log('=== 状态2（点击后5s）:', after1, '===')
await page.screenshot({ path: `${OUT_DIR}/ui-process-control-restart.png` })
console.log('=== 启动后截图已保存 ===')

// 检查 8080 端口是否重新监听
import { execSync } from 'child_process'
const port8080 = execSync('netstat -ano | grep ":8080" | grep LISTENING || echo NOT_LISTENING').toString().trim()
console.log('=== 8080 端口:', port8080 || '未监听', '===')

await browser.close()
