import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const result = await page.evaluate(async () => {
  const res = await fetch('/api/settings.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'diag-2', method: 'settings.describe', payload: {} }),
  })
  return await res.json()
})
const nsList = result?.result?.value?.namespaces ?? []
const all = nsList.map(n => n.ns)
console.log('TOTAL', all.length)
console.log('HAS skill-store:', all.includes('skill-store'))
console.log('HAS skill-vision:', all.includes('skill-vision'))
for (const n of nsList) {
  if (n.ns === 'skill-store' || n.ns === 'skill-vision') {
    console.log(JSON.stringify({ ns: n.ns, value: n.value, user: n.user, base: n.base, revision: n.revision, applies: n.applies, schema: n.schema }, null, 2))
  }
}
console.log('OTHER relevant:', all.filter(n => n.includes('skill') || n.includes('vision')))
await browser.close()
