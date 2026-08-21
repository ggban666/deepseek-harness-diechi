import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const out = await page.evaluate(async () => {
  const rpc = async (method, payload) => await (await fetch('/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-' + Math.random(), method, payload }),
  })).json()
  const d1 = await rpc('settings.describe', {})
  const ns = d1?.result?.value?.namespaces?.find(n => n.ns === 'skill-store')
  const skills = ns?.value?.skills ?? []
  const reset = skills.map(s => ({ ...s, enabled: false }))
  const u = await rpc('settings.update', { ns: 'skill-store', patch: { skills: reset } })
  await new Promise(r => setTimeout(r, 1500))
  const d2 = await rpc('settings.describe', {})
  const ns2 = d2?.result?.value?.namespaces?.find(n => n.ns === 'skill-store')
  return {
    updateOk: JSON.stringify(u?.result),
    after: (ns2?.value?.skills ?? []).map(s => [s.id, s.enabled]),
  }
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
