import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(5000)
const btn = page.getByRole('button', { name: '选择工作区' })
console.log('btn count:', await btn.count())
await btn.first().click()
await page.waitForTimeout(500)
console.log('aria-expanded:', await btn.first().getAttribute('aria-expanded'))
await page.waitForTimeout(800)
const roles = await page.evaluate(() => {
  const out = []
  document.querySelectorAll('[role], dialog, [class*="Menu"], [class*="menu"], [class*="Modal"], [class*="modal"]').forEach(el => {
    const r = el.getAttribute('role') ?? el.tagName
    if (el.offsetParent !== null) out.push(`${r} :: ${(el.textContent || '').trim().slice(0, 60)}`)
  })
  return out.slice(0, 40)
})
console.log('--- visible role/dialog elements ---')
console.log(roles.join('\n') || '(none)')
await page.screenshot({ path: 'D:/桌面/振翅新科/_diag_ws3.png' })
await browser.close()
