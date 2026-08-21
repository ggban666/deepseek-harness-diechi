import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: '蝶翅APP',
    short_name: '蝶翅',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    background_color: '#f8fafc',
    theme_color: '#6B46C1',
    icons: [{
      src: '/favicon.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    }, {
      src: '/apple-touch-icon.png',
      sizes: '180x180',
      type: 'image/png',
      purpose: 'any maskable',
    }],
  })
})

it('ships the branded butterfly icon assets', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.png'))
  const touchIcon = await readFile(join(DIST_ROOT, 'apple-touch-icon.png'))
  expect(favicon.byteLength).toBeGreaterThan(1000)
  expect(touchIcon.byteLength).toBeGreaterThan(1000)
})
