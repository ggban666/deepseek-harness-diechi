import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (msg) => { const t = msg.text(); if (msg.type() === 'error') errors.push(`[err] ${t.slice(0, 400)}`) })
page.on('pageerror', (err) => errors.push(`[pageerror] ${String(err).slice(0, 400)}`))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(6000)
const wsBtn = page.getByText('选择工作区', { exact: true })
console.log('workspace btn count:', await wsBtn.count())
if (await wsBtn.count() > 0) {
  await wsBtn.first().click()
  await page.waitForTimeout(1500)
  let body = await page.evaluate(() => document.body.innerText)
  console.log('--- after workspace click ---')
  console.log(body.slice(0, 1200))
  await page.screenshot({ path: 'D:/桌面/振翅新科/_diag_ws1.png' })
  // Try any buttons that look like a workspace/dir choice
  const btns = await page.locator('button').allTextContents()
  console.log('--- buttons ---')
  console.log(JSON.stringify(btns.slice(0, 30)))
}
console.log('--- errors ---')
console.log(errors.length ? errors.slice(0, 15) : 'none')
await browser.close()
