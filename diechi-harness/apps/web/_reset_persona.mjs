import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const out = await page.evaluate(async () => {
  const describe = await (await fetch('/api/settings.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'c-1', method: 'settings.describe', payload: {} }),
  })).json()
  const ns = describe?.result?.value?.namespaces?.find(n => n.ns === 'skill-store')
  const skills = ns?.value?.skills ?? []
  const reset = skills.map(s => ({ ...s, enabled: false }))
  const update = await (await fetch('/api/settings.update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'c-2', method: 'settings.update', payload: { namespace: 'skill-store', path: 'skills', value: reset } }),
  })).json()
  const describe2 = await (await fetch('/api/settings.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'c-3', method: 'settings.describe', payload: {} }),
  })).json()
  const ns2 = describe2?.result?.value?.namespaces?.find(n => n.ns === 'skill-store')
  return { updateOk: !!update?.result, enabled: (ns2?.value?.skills ?? []).map(s => [s.id, s.enabled]) }
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
