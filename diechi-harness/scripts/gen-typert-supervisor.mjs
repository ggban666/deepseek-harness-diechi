/**
 * 只为 diechi-supervisor 跑一次 typert 生成器（避开全量 tsdown 重写 226 个包）。
 *
 * 用途：supervisor 新加了 EvolutionGateway（@Remote 方法）之后，前端要能
 * `remote.diechiEvolution`，需要先生成 lib/typert.remote-client.{js,d.ts}
 * —— 那里面有 zod 运行时校验 schema 和 TypertRemoteMap 的类型合并。
 *
 * 生成器是 TS 源码，用 tsx 跑；入口用 lib（已构建）避免再解析一遍生成器自身。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/lib/index.js'

const root = process.cwd()
const generator = new WorkspaceTypertGenerator(root)

const discovered = generator.discover()
const known = discovered.some((entry) => entry.package === '@deepseek-ai/dsh-host-diechi-supervisor')
console.log('discover 找到 supervisor:', known)
if (!known) {
  console.log('已发现的 Typert 包（前 20）：')
  for (const entry of discovered.slice(0, 20)) console.log('  -', entry.package)
}

// 生成器只算不写盘——落盘是调用方（tsdown 插件 emitArtifacts）的职责。
// 这里复刻同一套文件名约定，避免为构建一个包而触发全量 tsdown 重写 226 个包。
const results = generator.generate(['@deepseek-ai/dsh-host-diechi-supervisor'])
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

  // 生成器在导出缺失时会静默跳过，这里显式体检一遍，免得前端拿到空壳
  if (artifact.js.includes('invocations: [\n  ]')) {
    console.warn('⚠ 生成结果里没有任何 invocation——检查 @Remote 方法是否被导出')
  }
}
console.log('完成')
