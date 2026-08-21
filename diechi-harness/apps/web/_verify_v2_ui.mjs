import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(5000)
await page.getByText('设置', { exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByText('Skill 设置', { exact: true }).click()
await page.waitForTimeout(1500)
const text = await page.evaluate(() => document.body.innerText)
const checks = ['Skill 设置', '已安装技能', 'SQE客诉处理', '导出 .md', '导出 .json', '版本历史', '再训练', '恢复']
for (const c of checks) console.log(`${c}: ${text.includes(c) ? 'OK' : 'MISSING'}`)
console.log('=== CONSOLE ERRORS ===')
console.log(errors.length ? errors.slice(0, 10) : 'none')
await page.screenshot({ path: 'D:/桌面/振翅新科/_verify_skill_settings_v2.png' })
await browser.close()
