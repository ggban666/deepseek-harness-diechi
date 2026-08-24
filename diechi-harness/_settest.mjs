
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

const dir = mkdtempSync(join(tmpdir(), 'dsh-set-test-'))
const file = join(dir, 'settings.yaml')
writeFileSync(file, 'alpha:\n  theme: light\n', 'utf8')
console.log('FILE0:', file)

const ctx = new Context()
const fiber = ctx.plugin(FileSettingsProvider, { filename: file, format: 'yaml', watch: false })
await fiber
const scope = ctx.settings.register(settingsNamespace('alpha'), z.object({
  theme: z.string(),
  fontSize: z.number().default(12),
}))
console.log('BEFORE get:', JSON.stringify(scope.get()))
try {
  await scope.update({ fontSize: 20 })
  console.log('AFTER get:', JSON.stringify(scope.get()))
} catch (e) {
  console.log('UPDATE ERROR:', (e && e.message) || e)
}
await new Promise(r => setTimeout(r, 300))
console.log('FILE:', readFileSync(file, 'utf8'))
await fiber.dispose()
process.exit(0)
