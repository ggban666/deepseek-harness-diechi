import { Context } from '@deepseek-ai/cordis'
import { CordisInspectRegistryService } from '@deepseek-ai/dsh-cordis-host-runner'
import { describe, expect, it } from 'vitest'
import { registerHostInspectProviders } from '../src/providers.ts'

/**
 * The `cordisInspect` registry is process-global and its Host providers
 * describe the whole runtime, so a second cordis-family preset standing mount
 * (for example `engine` beside `cordis`) must share the first mount's
 * registrations instead of colliding on duplicate ids.
 */

const FIRST_PARTY_IDS = ['Builtin', 'Event', 'Service', 'Tool']

function hostIds(registry: CordisInspectRegistryService): string[] {
  return registry.list()
    .filter(provider => provider.platform === 'host')
    .map(provider => provider.id)
    .sort()
}

describe('tool-cordis host inspect provider registration', () => {
  it('registers every first-party provider on the first mount', async () => {
    const root = new Context()
    const registry = new CordisInspectRegistryService(root)
    const mount = await root.plugin({ name: 'mount', apply: inner => registerHostInspectProviders(inner) })

    expect(hostIds(registry)).toEqual(FIRST_PARTY_IDS)
    expect(registry.list().filter(provider => provider.platform === 'host')).toHaveLength(4)

    await mount.dispose()
    expect(hostIds(registry)).toEqual([])
  })

  it('shares the process-global registry with a second mount instead of colliding', async () => {
    const root = new Context()
    const registry = new CordisInspectRegistryService(root)
    const first = await root.plugin({ name: 'mount-1', apply: inner => registerHostInspectProviders(inner) })

    // A second mount in the same process must not throw on the duplicate ids:
    // it registers nothing and reads the first mount's entries.
    const second = await root.plugin({ name: 'mount-2', apply: inner => registerHostInspectProviders(inner) })
    expect(hostIds(registry)).toEqual(FIRST_PARTY_IDS)

    // The shared registrations are owned by the first mount's fiber and
    // outlive the second mount, which registered nothing.
    await second.dispose()
    expect(hostIds(registry)).toEqual(FIRST_PARTY_IDS)

    await first.dispose()
    expect(hostIds(registry)).toEqual([])
  })
})
