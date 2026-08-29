/**
 * watchdog 行为测试。
 *
 * ## 为什么用 node:test 而不是 vitest
 *
 * 本仓库默认用 vitest（`pnpm vitest run ...`），但 vitest 4 的 worker 进程
 * 在当前受限环境里会直接撞内存上限（ERR_WORKER_OUT_OF_MEMORY），
 * forks / threads / --no-isolate 三种模式都试过，均无法启动 worker。
 * 这是环境问题，不是本包的问题 —— 所以这里用 Node 22 内置的 node:test，
 * 逻辑与 vitest 版等价，等环境恢复后可原样迁回 vitest。
 *
 * 跑法：
 *   node --import tsx --test packages/host/diechi-process-watchdog/tests/basic.spec.ts
 * 环境正常时：
 *   pnpm vitest run packages/host/diechi-process-watchdog/
 *
 * ## 铁律
 *
 * **绝不真去 spawn 或 kill 3090。** 所有副作用通过 WatchdogDeps 注入 mock，
 * 文件系统操作只碰临时目录。watchdog 是拿进程生死开玩笑的组件，
 * 测试本身必须比它更保守。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOnce, startWatchdog } from '../src/watchdog.ts'
import { createWatchdogService } from '../src/index.ts'
import { NegativeSampleWriter } from '../src/supervisor.ts'
import { assertPort, WatchdogConfigError } from '../src/invariant.ts'
import type { UpdateSignal, WatchdogConfig, WatchdogDeps } from '../src/types.ts'

const BASE_CONFIG: WatchdogConfig = {
  dshHome: '/tmp/dsh-home',
  harnessPath: '/tmp/diechi-harness',
  port: 3090,
  probeIntervalSec: 30,
  probeTimeoutMs: 5000,
  gracefulExitMs: 2000,
  probeMode: 'port',
}

/** 极简 mock 函数：只记录调用参数，够用且不引框架。 */
interface MockFn {
  (...args: unknown[]): unknown
  calls: unknown[][]
}
function fn(impl?: (...args: unknown[]) => unknown): MockFn {
  const calls: unknown[][] = []
  const f = ((...args: unknown[]): unknown => {
    calls.push(args)
    return impl?.(...args)
  }) as MockFn
  f.calls = calls
  return f
}

function makeSignal(overrides: Partial<UpdateSignal> = {}): UpdateSignal {
  return {
    version: 'v0.2.0-rc.6',
    action: 'restart',
    requestedBy: 'diechi-supervisor',
    requestedAt: new Date().toISOString(),
    reason: 'manual-upgrade',
    ...overrides,
  }
}

interface Harness {
  deps: WatchdogDeps
  restart: MockFn
  recordRestart: MockFn
  clearSignal: MockFn
  probe: MockFn
  logs: string[]
}

function makeDeps(overrides: Partial<WatchdogDeps> = {}): Harness {
  const logs: string[] = []
  const restart = fn(async (): Promise<void> => {})
  const recordRestart = fn((): void => {})
  const clearSignal = fn(async (): Promise<void> => {})
  const probe = fn(async () => true)

  const deps: WatchdogDeps = {
    probe: probe as unknown as WatchdogDeps['probe'],
    readSignal: fn(async () => null) as unknown as WatchdogDeps['readSignal'],
    clearSignal: clearSignal as unknown as WatchdogDeps['clearSignal'],
    recordRestart: recordRestart as unknown as WatchdogDeps['recordRestart'],
    restart: restart as unknown as WatchdogDeps['restart'],
    // mock sleep 必须带一个真实的极小延迟：若立即 resolve，interruptibleSleep
    // 会退化成 busy loop，几十毫秒内堆出几十万轮，直接把测试进程拖垮。
    sleep: (async (): Promise<void> => {
      await new Promise<void>((done) => setTimeout(done, 1))
    }) as WatchdogDeps['sleep'],
    log: (message: string): void => {
      logs.push(message)
    },
    ...overrides,
  }
  return { deps, restart, recordRestart, clearSignal, probe, logs }
}

describe('runOnce', () => {
  it('DSH 活着时什么都不做', async () => {
    const h = makeDeps()

    const outcome = await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(outcome, { kind: 'alive' })
    assert.equal(h.restart.calls.length, 0)
    assert.equal(h.recordRestart.calls.length, 0)
  })

  it('DSH 挂了时记负样本并重启', async () => {
    const h = makeDeps({ probe: fn(async () => false) as unknown as WatchdogDeps['probe'] })

    const outcome = await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(outcome, { kind: 'restarted', reason: 'watchdog-restart' })
    assert.equal(h.recordRestart.calls.length, 1)
    assert.equal(h.recordRestart.calls[0]?.[0], 'watchdog-restart')
    assert.deepEqual(h.restart.calls[0], [null, 'watchdog-restart'])
  })

  it('有升级信号时走计划内重启，且不记为崩溃', async () => {
    const signal = makeSignal()
    const h = makeDeps({
      readSignal: fn(async () => signal) as unknown as WatchdogDeps['readSignal'],
    })

    const outcome = await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(outcome, { kind: 'signalled', signal })
    // 信号带补丁，必须交给 restart 去应用。
    assert.deepEqual(h.restart.calls[0], [signal, 'signal-restart'])
    // 计划内升级不是失败，不该污染 negative_samples ——
    // 否则 diechi-evolve 会把人类主动升级误判成崩溃趋势。
    assert.equal(h.recordRestart.calls.length, 0)
  })

  it('先清信号再重启：重启失败时不会拿同一份坏补丁无限重试', async () => {
    const order: string[] = []
    const h = makeDeps({
      readSignal: fn(async () => makeSignal()) as unknown as WatchdogDeps['readSignal'],
      clearSignal: fn(async () => {
        order.push('clear')
      }) as unknown as WatchdogDeps['clearSignal'],
      restart: fn(async () => {
        order.push('restart')
      }) as unknown as WatchdogDeps['restart'],
    })

    await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(order, ['clear', 'restart'])
  })

  it('信号读不到时按探活结果处理', async () => {
    const h = makeDeps({ probe: fn(async () => false) as unknown as WatchdogDeps['probe'] })

    const outcome = await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(outcome, { kind: 'restarted', reason: 'watchdog-restart' })
  })

  it('signal action 不是 restart 时忽略，回落到探活', async () => {
    const weird = makeSignal({ action: 'unknown' as unknown as 'restart' })
    const h = makeDeps({
      readSignal: fn(async () => weird) as unknown as WatchdogDeps['readSignal'],
    })

    const outcome = await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(outcome, { kind: 'alive' })
    assert.equal(h.restart.calls.length, 0)
  })

  it('restart 抛错时不冒泡 —— watchdog 自身不能因为一次重启失败就死掉', async () => {
    const h = makeDeps({
      probe: fn(async () => false) as unknown as WatchdogDeps['probe'],
      restart: fn(async () => {
        throw new Error('端口仍被占')
      }) as unknown as WatchdogDeps['restart'],
    })

    const outcome = await runOnce(BASE_CONFIG, h.deps)

    assert.deepEqual(outcome, { kind: 'restarted', reason: 'watchdog-restart' })
    assert.ok(h.logs.some((line) => line.includes('重启失败')))
  })
})

describe('startWatchdog', () => {
  it('stop 之后主循环会退出', async () => {
    const h = makeDeps()

    const handle = startWatchdog({ ...BASE_CONFIG, probeIntervalSec: 1 }, h.deps)
    handle.stop()
    await handle.done

    assert.ok(true, '循环已结束')
  })

  it('循环期间会持续探活', async () => {
    const h = makeDeps()

    const handle = startWatchdog({ ...BASE_CONFIG, probeIntervalSec: 1 }, h.deps)
    // 等 1.2s —— probeIntervalSec=1 + interruptibleSleep 200ms slice
    // 60ms 实际只跑第一段 sleep slice，probe 还没触发
    await new Promise<void>((done) => setTimeout(done, 1200))
    handle.stop()
    await handle.done

    assert.ok(h.probe.calls.length > 0, '至少探活过一次')
  })
})

describe('createWatchdogService', () => {
  it('写入的信号能被读回', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-signal-'))
    const service = createWatchdogService(dir)
    const signal = makeSignal({ reason: 'test-upgrade' })

    await service.writeSignal(signal)
    const read = await service.readSignal()

    assert.equal(read?.version, signal.version)
    assert.equal(read?.reason, 'test-upgrade')
  })

  it('信号 JSON 损坏时返回 null 而不是抛错', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-bad-'))
    const service = createWatchdogService(dir)
    await mkdir(join(dir, '.watchdog'), { recursive: true })
    await writeFile(join(dir, '.watchdog', 'update.signal'), '{ 这不是 json', 'utf8')

    assert.equal(await service.readSignal(), null)
  })

  it('信号缺 version 时视为无效', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-partial-'))
    const service = createWatchdogService(dir)
    await mkdir(join(dir, '.watchdog'), { recursive: true })
    await writeFile(
      join(dir, '.watchdog', 'update.signal'),
      JSON.stringify({ action: 'restart', reason: 'x' }),
      'utf8',
    )

    assert.equal(await service.readSignal(), null)
  })

  it('没有信号文件时返回 null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-empty-'))

    assert.equal(await createWatchdogService(dir).readSignal(), null)
  })

  it('clearSignal 之后读不到', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-clear-'))
    const service = createWatchdogService(dir)
    await service.writeSignal(makeSignal())
    await service.clearSignal()

    assert.equal(await service.readSignal(), null)
  })
})

describe('NegativeSampleWriter', () => {
  it('写入的重启记录能按 scope 读回', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-db-'))
    const writer = NegativeSampleWriter.open(dir)

    const id = writer.recordRestart('watchdog-restart', { port: 3090, at: 'now' })
    const rows = writer.listRestarts(10)
    writer.close()

    assert.notEqual(id, null)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.reason, 'watchdog-restart')
  })

  it('库关闭后写入返回 null 而不是抛错（watchdog 不能因此停摆）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-closed-'))
    const writer = NegativeSampleWriter.open(dir)
    writer.close()

    assert.equal(writer.recordRestart('watchdog-restart', {}), null)
    assert.deepEqual(writer.listRestarts(10), [])
  })
})

describe('history.jsonl audit (缺口 1 修)', () => {
  it('有升级信号时 watchdog 写一行 signal-consumed 审计', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-history-'))
    const config: WatchdogConfig = { ...BASE_CONFIG, dshHome: dir }
    const signal = makeSignal({ version: 'v9.9.9', reason: 'audit-test' })
    const h = makeDeps({
      readSignal: fn(async () => signal) as unknown as WatchdogDeps['readSignal'],
    })

    await runOnce(config, h.deps)

    const historyPath = join(dir, '.watchdog', 'history.jsonl')
    const content = await readFile(historyPath, 'utf8')
    const lines = content.split('\n').filter((l) => l.length > 0)
    assert.equal(lines.length, 1, '应恰好写一行')
    const entry = JSON.parse(lines[0]!) as { stage: string; version: string; reason: string; ts: string }
    assert.equal(entry.stage, 'signal-consumed')
    assert.equal(entry.version, 'v9.9.9')
    assert.equal(entry.reason, 'audit-test')
    assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/)  // ISO 时间戳
  })

  it('崩溃探活时也写一行 watchdog-restart 审计（除了 negative_samples）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-history-crash-'))
    const config: WatchdogConfig = { ...BASE_CONFIG, dshHome: dir }
    const h = makeDeps({ probe: fn(async () => false) as unknown as WatchdogDeps['probe'] })

    await runOnce(config, h.deps)

    const historyPath = join(dir, '.watchdog', 'history.jsonl')
    const content = await readFile(historyPath, 'utf8')
    const lines = content.split('\n').filter((l) => l.length > 0)
    // **缺口 1 修前**：崩溃路径不写审计 → 只能从 recordRestart 推
    // **缺口 1 修后**：崩溃路径也写 history.jsonl（但 negative_samples 仍走 recordRestart）
    // 此测试断 history.jsonl 至少有 1 行（崩溃审计）
    assert.ok(lines.length >= 1, '崩溃审计应至少写一行')
  })

  it('DSH 活着时 history.jsonl 不被创建（无事件不写）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watchdog-history-alive-'))
    const config: WatchdogConfig = { ...BASE_CONFIG, dshHome: dir }
    const h = makeDeps()

    await runOnce(config, h.deps)

    // 活着不写 — 也不创建 .watchdog 目录
    const fs = await import('node:fs/promises')
    await assert.rejects(fs.access(join(dir, '.watchdog', 'history.jsonl')))
  })
})

describe('invariant', () => {
  it('非法端口直接抛错，不静默回退', () => {
    assert.throws(() => assertPort(0), WatchdogConfigError)
    assert.throws(() => assertPort(70000), WatchdogConfigError)
    assert.doesNotThrow(() => assertPort(3090))
  })
})
