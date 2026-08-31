/**
 * 只为 diechi-process-control 跑一次 typert 生成器（避开全量 tsdown 重写 226 个包）。
 *
 * 用途：diechi-process-control 新加了 ProcessGateway（@Remote 方法）之后，
 * 前端要能 remote.diechiProcess，需要先生成 lib/typert.remote-client.{js,d.ts}。
 *
 * 复用 scripts/gen-typert-supervisor.mjs 的同一套落盘约定。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/lib/index.js'

const root = process.cwd()
const generator = new WorkspaceTypertGenerator(root)

const results = generator.generate(['@deepseek-ai/dsh-host-diechi-process-control'])
for (const artifact of results) {
  const output = join(root, artifact.packageRoot, 'lib')
  mkdirSync(output, { recursive: true })

  writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  console.log(`✓ lib/typert.${artifact.face}.{js,d.ts}`)

  if (artifact.remote !== undefined) {
    writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
    console.log('✓ lib/typert.remote-client.{js,d.ts,d.ts.map}')
  }

  if (artifact.js.includes('invocations: [\n  ]')) {
    console.warn('⚠ 生成结果里没有任何 invocation——检查 @Remote 方法是否被导出')
  }
}
console.log('完成')
