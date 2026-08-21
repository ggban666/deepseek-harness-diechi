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
  const created = await call('session.create', {})
  const sessionId = created?.result?.value?.sessionId
  const skills = await call('skill.list', { sessionId })
  const names = (skills?.result?.value?.skills ?? []).map(s => s.name)
  return { sessionId, hasImported: names.includes('my-imported-skill'), hasSqe: names.includes('sqe-8d'), total: names.length, names }
})
console.log(JSON.stringify(out, null, 2).slice(0, 4000))
await browser.close()
