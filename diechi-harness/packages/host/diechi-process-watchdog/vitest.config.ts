/**
 * watchdog 包专属 vitest 配置。
 *
 * 为什么不用仓库根配置：根 vitest.config.ts 会为整个 226 包的 monorepo
 * 建 alias / 插件图，worker 进程在受限环境下会直接 OOM（实测）。
 * 本包的测试只依赖 node 内置模块 + vitest，不需要那套东西。
 *
 * 跑法（pnpm 不可用时）：
 *   node node_modules/vitest/vitest.mjs run --config packages/host/diechi-process-watchdog/vitest.config.ts
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // 不设 root 的话 vitest 会把仓库根当基准，include 匹配不到本包的 tests。
  root: here,
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
