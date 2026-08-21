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
await page.getByText('Skill 商店', { exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '工坊', exact: true }).click()
await page.waitForTimeout(1500)
let body = await page.evaluate(() => document.body.innerText)

// Create form
step('创建卡标题', body.includes('创建新技能'))
step('字段：技能名称', body.includes('技能名称'))
step('字段：用途', body.includes('用途（什么时候用它）'))
step('字段：关键步骤', body.includes('关键步骤（可选）'))
step('字段：规则/注意事项', body.includes('规则 / 注意事项（可选）'))
step('字段：补充资料/参考链接', body.includes('补充资料 / 参考链接（可选）'))
step('生成技能按钮存在', await page.getByRole('button', { name: '生成技能' }).count() === 1)

// Required validation: empty name/purpose -> disabled
step('空表单时生成按钮禁用', await page.getByRole('button', { name: '生成技能' }).isDisabled())

// Fill required only -> no-session friendly notice
await page.locator('input[placeholder="例如：会议纪要专家"]').fill('邮件回复专家')
await page.locator('textarea[placeholder="例如：把会议讨论整理成决议与待办清单"]').fill('帮客户写专业邮件')
await page.getByRole('button', { name: '生成技能' }).click()
await page.waitForTimeout(1200)
body = await page.evaluate(() => document.body.innerText)
step('无会话时创建给出友好提示', body.includes('还没有可用的对话'))

// Fill optional fields too, confirm still friendly (no crash)
await page.locator('textarea[placeholder^="例如：1. 提取议题"]').fill('1. 分析收件人 2. 定语气 3. 写正文')
await page.locator('textarea[placeholder^="粘贴你掌握的知识"]').fill('公司邮件规范：抬头Dear+名，结尾Best regards')
await page.getByRole('button', { name: '生成技能' }).click()
await page.waitForTimeout(1200)
body = await page.evaluate(() => document.body.innerText)
step('填全字段仍友好(无会话)', body.includes('还没有可用的对话'))

// Retrain form regression
const row = page.locator('li', { hasText: 'SQE客诉处理' })
await row.getByRole('button', { name: '再训练', exact: true }).click()
await page.waitForTimeout(600)
step('再训练表单仍可用', await row.locator('textarea').count() >= 1)
await row.getByRole('button', { name: '取消', exact: true }).click()
await page.waitForTimeout(400)

console.log('=== CONSOLE ERRORS ===')
console.log(errors.length ? errors.slice(0, 10) : 'none')
if (errors.length > 0) failed = true
await page.screenshot({ path: 'D:/桌面/振翅新科/_verify_create_form.png', fullPage: true })
await browser.close()
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(failed ? 1 : 0)