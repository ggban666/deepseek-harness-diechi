import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))
const step = (name, ok) => console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
let failed = false

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(6000)

// Open the workshop from the hero card.
await page.getByText('Skill 商店', { exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '工坊', exact: true }).click()
await page.waitForTimeout(1500)

const row = page.locator('li', { hasText: 'SQE客诉处理' })
step('行内再训练按钮存在', await row.getByRole('button', { name: '再训练', exact: true }).count() === 1)

// Expand the inline retrain form.
await row.getByRole('button', { name: '再训练', exact: true }).click()
await page.waitForTimeout(600)
let body = await page.evaluate(() => document.body.innerText)
step('展开内联表单(含标题)', body.includes('再训练：SQE客诉处理'))
step('表单有输入框提示', await row.locator('textarea').count() === 1)
step('表单有生成新版本按钮', await row.getByRole('button', { name: '生成新版本' }).count() === 1)
step('表单有取消按钮', await row.getByRole('button', { name: '取消' }).count() === 1)

// Empty description -> generate disabled.
step('空描述时生成按钮禁用', await row.getByRole('button', { name: '生成新版本' }).isDisabled())

// No session open -> friendly notice, nothing sent.
await row.locator('textarea').fill('处理投诉前先致歉')
await row.getByRole('button', { name: '生成新版本' }).click()
await page.waitForTimeout(1200)
body = await page.evaluate(() => document.body.innerText)
step('无会话提示友好', body.includes('还没有可用的对话'))

// Cancel collapses the form.
await row.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(500)
body = await page.evaluate(() => document.body.innerText)
step('取消后表单收起', (await row.locator('textarea').count()) === 0)

console.log('=== CONSOLE ERRORS ===')
console.log(errors.length ? errors.slice(0, 10) : 'none')
if (errors.length > 0) failed = true
await page.screenshot({ path: 'D:/桌面/振翅新科/_verify_retrain_form.png', fullPage: true })
await browser.close()
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(failed ? 1 : 0)