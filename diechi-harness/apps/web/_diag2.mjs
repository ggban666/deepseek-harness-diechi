import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const result = await page.evaluate(async () => {
  const res = await fetch('/api/settings.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'diag-3', method: 'settings.describe', payload: {} }),
  })
  return await res.json()
})
const nsList = result?.result?.value?.namespaces ?? []
const store = nsList.find(n => n.ns === 'skill-store')
const vision = nsList.find(n => n.ns === 'skill-vision')
console.log('store skills:', JSON.stringify(store?.value?.skills?.map(s => ({ id: s.id, contentLen: s.content?.length, source: s.source })), null, 2))
console.log('vision:', JSON.stringify(vision?.value))
console.log('writable:', result?.result?.value?.writable)
await browser.close()
