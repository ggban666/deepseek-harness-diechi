import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const out = await page.evaluate(async () => {
  const call = async (method, payload) => {
    const res = await fetch('/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'diag-' + Math.random().toString(36).slice(2), method, payload }),
    })
    return await res.json()
  }
  const desc = await call('settings.describe', {})
  const store = desc?.result?.value?.namespaces?.find(n => n.ns === 'skill-store')
  const remaining = (store?.value?.skills ?? []).filter(s => s.id !== 'my-imported-skill')
  const write = await call('settings.update', { ns: 'skill-store', patch: { skills: remaining } })
  return { before: store?.value?.skills?.length, writeOk: write?.result?.ok, after: write?.result?.value?.value?.skills?.length }
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
