import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const result = await page.evaluate(async () => {
  const res = await fetch('/api/settings.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'diag-v2', method: 'settings.describe', payload: {} }),
  })
  return await res.json()
})
const nsList = result?.result?.value?.namespaces ?? []
const ns = nsList.find(n => n.ns === 'skill-store')
console.log('skill-store namespace found:', ns !== undefined)
if (ns) {
  const skills = ns.value?.skills ?? []
  console.log('skills count:', skills.length)
  for (const s of skills) {
    console.log(`- ${s.id} | status=${s.status} | formatVersion=${s.formatVersion} | revisions=${Array.isArray(s.revisions) ? s.revisions.length : 'n/a'} | enabled=${s.enabled} | contentLen=${(s.content ?? '').length} | source=${s.source}`)
  }
}
await browser.close()
