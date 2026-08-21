import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(5000)
await page.screenshot({ path: 'D:/桌面/振翅新科/_verify_home.png' })
// check img srcs on page
const imgs = await page.evaluate(() => Array.from(document.images).map(i => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight })))
console.log(JSON.stringify(imgs, null, 2))
await browser.close()
