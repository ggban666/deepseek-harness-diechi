import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(5000)
await page.getByText('设置', { exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByText('Skill 商店', { exact: true }).click()
await page.waitForTimeout(1500)

// 1) vision config write
const endpointInput = page.locator('input[placeholder="http://127.0.0.1:11434"]')
await endpointInput.fill('http://127.0.0.1:11434')
await page.getByText('保存视觉配置', { exact: true }).click()
await page.waitForTimeout(1200)

// 2) import a SKILL.md
const md = `---\nname: my-imported-skill\ndescription: 演示导入的测试技能。\nwhen-to-use: 用户需要示例时\n---\n\n# 我的技能\n\n当用户请求时，做这件事。\n`
const fs = await import('node:fs')
fs.writeFileSync('D:/桌面/振翅新科/_test_skill.md', md)
const input = page.locator('input[type="file"]')
await input.setInputFiles('D:/桌面/振翅新科/_test_skill.md')
await page.waitForTimeout(1500)

const text = await page.evaluate(() => document.body.innerText)
const start = text.indexOf('Skill 商店')
console.log('=== AFTER IMPORT ===')
console.log(text.slice(start, start + 1600))
console.log('=== CONSOLE ERRORS ===')
console.log(errors.length ? errors.slice(0, 10) : 'none')
await page.screenshot({ path: 'D:/桌面/振翅新科/_verify_store_imported.png' })
await browser.close()
