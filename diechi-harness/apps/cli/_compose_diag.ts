import { loadProfile, composeEntries, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { homePatchPath, INSTALL_ANCHOR } from './src/profile-boot.ts'

process.env.DSH_HOME = 'D:\\桌面\\振翅新科\\蝶翅-app\\diechi-home'
const profile = loadProfile('dsh', 'web', INSTALL_ANCHOR, undefined, { userLayer: true })
const bundlePatches = profile.layers.flatMap(layer => layer.patches)
const homePatches = loadOptionalPatches('dsh', homePatchPath()) ?? []
const rows = new Map()
for (const row of composeEntries([bundlePatches, profile.patches, homePatches, []])) {
  if (typeof row.id === 'string') rows.set(row.id, row)
}
console.log('layer bundle packageDirs:')
for (const layer of profile.layers) console.log(' ', layer.packageName, '->', layer.packageDir, '| patch:', layer.patchPath)
console.log('skill-store row present:', rows.has('skill-store'))
if (rows.has('skill-store')) console.log(JSON.stringify(rows.get('skill-store'), null, 2))
console.log('rows total:', rows.size)
