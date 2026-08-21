import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const step = (name, ok, extra = '') => console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(6000)
await page.getByText('设置', { exact: true }).first().click()
await page.waitForTimeout(1500)
await page.getByText('Skill 设置', { exact: true }).click()
await page.waitForTimeout(2000)
await page.getByRole('button', { name: '视频生成' }).first().click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '摄像头观看' }).first().click()
await page.waitForTimeout(3000)
const backdrop = page.locator('[role="dialog"][aria-label="摄像头录制"]')
step('摄像头全屏弹窗出现', (await backdrop.count()) > 0)

// capture live narration entries as they stream in
const seen = []
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(3000)
  const items = await page.locator('time').allInnerTexts().catch(() => [])
  const times = items.filter((x) => /^\d{2}:\d{2}:\d{2}$/.test(x.trim()))
  for (const t of times) {
    if (!seen.includes(t)) {
      seen.push(t)
      const li = page.locator('time', { hasText: t }).locator('xpath=..')
      console.log('   实时描述 ' + t + ' → ' + (await li.innerText().catch(() => '')).slice(6, 90))
    }
  }
}
step('实时描述条目持续生成', seen.length >= 3, 'times=' + JSON.stringify(seen))

await page.screenshot({ path: 'D:/桌面/振翅新科/_live_camera2.png', fullPage: false })
await browser.close()
