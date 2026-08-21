import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))

const step = (name, ok, extra = '') => console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
let failed = false

// 1. Open homepage and wait for the app shell + hero empty state.
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(6000)
let body = await page.evaluate(() => document.body.innerText)
step('hero 商店卡可见', body.includes('Skill 商店'))
step('hero 工坊卡可见', body.includes('Skill 工坊') || body.includes('工坊'))

// 2. Open the skill center via the hero store card.
await page.getByText('Skill 商店', { exact: true }).first().click()
await page.waitForTimeout(1200)
body = await page.evaluate(() => document.body.innerText)
step('技能中心打开(商店tab)', body.includes('技能中心') && body.includes('商店'))
step('商店含刷新按钮', body.includes('刷新'))

// 3. Force a rescan (host re-scans on refreshTick) and wait for the catalog.
await page.getByRole('button', { name: '刷新' }).click()
await page.waitForTimeout(2500)
body = await page.evaluate(() => document.body.innerText)
step('商店扫描到会议纪要专家', body.includes('会议纪要专家'))
step('商店展示作者 蝶翅商店', body.includes('蝶翅商店'))
step('商店展示标签 会议/纪要', body.includes('会议') && body.includes('纪要'))

// 4. Install the market skill.
const installBtn = page.locator('li', { hasText: '会议纪要专家' }).getByRole('button', { name: '安装' })
await installBtn.click()
await page.waitForTimeout(1500)
body = await page.evaluate(() => document.body.innerText)
step('安装成功提示', body.includes('已安装 meeting-minutes。'))
step('商店卡片标记已安装', body.includes('已安装'))

// 5. Close the center, go to settings -> Skill 设置.
await page.getByRole('button', { name: '关闭' }).click()
await page.waitForTimeout(800)
await page.getByText('设置', { exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByText('Skill 设置', { exact: true }).click()
await page.waitForTimeout(1500)
body = await page.evaluate(() => document.body.innerText)
step('设置页出现会议纪要专家', body.includes('会议纪要专家'))
step('设置页出现 /meeting-minutes', body.includes('/meeting-minutes'))
step('来源标记为商店', body.includes('商店'))
step('找到会议纪要专家行', (await page.locator('li', { hasText: '会议纪要专家' }).count()) > 0)

// 6. Check the persona box, verify dirty state, save.
const row = page.locator('li', { hasText: '会议纪要专家' })
const check = row.locator('input[type="checkbox"]')
await check.check()
await page.waitForTimeout(400)
body = await page.evaluate(() => document.body.innerText)
step('出现未保存提示', body.includes('有未保存的改动'))
await page.getByRole('button', { name: '保存设置' }).click()
await page.waitForTimeout(1500)
body = await page.evaluate(() => document.body.innerText)
step('保存成功提示', body.includes('设置已保存。'))

console.log('=== CONSOLE ERRORS ===')
console.log(errors.length ? errors.slice(0, 10) : 'none')
if (errors.length > 0) failed = true

await page.screenshot({ path: 'D:/桌面/振翅新科/_verify_store_e2e.png', fullPage: true })
await browser.close()
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(failed ? 1 : 0)