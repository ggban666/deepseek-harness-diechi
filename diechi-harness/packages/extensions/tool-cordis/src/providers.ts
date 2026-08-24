/**
 * First-party Host inspect providers registered by the Cordis tool package.
 *
 * The `cordisInspect` registry is process-global — one directory per process,
 * queried by the model-facing tools of every session — and the providers it
 * carries describe the whole runtime, not one preset's view. A preset that
 * mounts `tool-cordis` therefore registers them ONCE process-wide, and a second
 * cordis-family preset's standing mount (for example `engine` beside `cordis`)
 * SHARES the first mount's registrations instead of colliding on a duplicate.
 * The shared registration outlives the second mount; standing mounts live until
 * whole-tree teardown, so the first mount's disposer runs at the same time the
 * registry stops mattering.
 */

import type { Context } from '@deepseek-ai/cordis'
import { HOST_BUILTIN_INSPECTION } from '@deepseek-ai/dsh-cordis-host-runner'
import type { HostCordisInspectProviderRegistration } from '@deepseek-ai/dsh-cordis-host-runner'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { EVENT_API, queryEventApi, queryServiceApi } from './api-catalog.ts'

const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const
const ANY_OUTPUT = { description: 'JSON data owned by this inspect provider.' } as const
const SERVICE_INPUT = exactInput('service', 'Exact Service key. Omit it for the compact Service and method-signature directory.')
const EVENT_INPUT = exactInput('event', 'Exact Event name. Omit it for the compact Event and listener-signature directory.')
const SERVICE_OUTPUT = {
  description: 'Compact Service directory, or one exact Service contract with only its referenced type declarations.',
} as const
const EVENT_OUTPUT = {
  description: 'Compact Event directory, or one exact Event contract with only its referenced type declarations.',
} as const
const HOST_EVENTS = EVENT_API.filter(event => !event.name.startsWith('cordis/'))

/**
 * Construct Host providers over generated Catalogs, evaluator declarations, and live Tool scope.
 * @param ctx - Host context used for Agent-scoped live Tool queries.
 * @returns registrations for static catalogs and live Host capabilities.
 */
export function hostInspectProviders(ctx: Context): HostCordisInspectProviderRegistration[] {
  return [
    registration(
      'Service',
      'Progressive Host Service discovery: compact capability/signature directory, then one exact coding contract.',
      'listService',
      input => queryServiceApi(readExact(input, 'service')) as unknown as JsonValue,
      SERVICE_INPUT,
      SERVICE_OUTPUT,
    ),
    registration(
      'Event',
      'Progressive Host Event discovery: compact listener directory, then one exact event contract.',
      'listEvents',
      input => queryEventApi(readExact(input, 'event'), HOST_EVENTS) as unknown as JsonValue,
      EVENT_INPUT,
      EVENT_OUTPUT,
    ),
    registration('Builtin', 'Plain-JavaScript symbols available to a dynamic Host half.', 'listBuiltins', () => ({
      builtins: HOST_BUILTIN_INSPECTION,
      referencedTypes: [],
    } as unknown as JsonValue)),
    {
      manifest: {
        id: 'Tool',
        description: 'Tools visible to the requesting Agent, including scoped and dynamic registrations.',
        methods: [{
          name: 'listTools',
          description: 'Return every Tool schema currently callable by this Agent.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        }],
      },
      query(method, _input, context) {
        if (method !== 'listTools') throw new Error(`unknown Tool inspect method "${method}"`)
        return Promise.resolve({ tools: ctx.tools.schemas(context.agent) } as unknown as JsonValue)
      },
    },
  ]
}

function registration(
  id: string,
  description: string,
  method: string,
  query: (input: JsonValue | undefined) => JsonValue | Promise<JsonValue>,
  inputSchema: JsonValue = EMPTY_INPUT,
  outputSchema: JsonValue = ANY_OUTPUT,
): HostCordisInspectProviderRegistration {
  return {
    manifest: {
      id,
      description,
      methods: [{
        name: method,
        description,
        inputSchema,
        outputSchema,
      }],
    },
    async query(requested, input) {
      if (requested !== method) throw new Error(`unknown ${id} inspect method "${requested}"`)
      return await query(input)
    },
  }
}

function exactInput(field: string, description: string): JsonValue {
  return { type: 'object', properties: { [field]: { type: 'string', description } }, additionalProperties: false }
}

/**
 * Register this mount's first-party Host inspect providers into the
 * process-global registry, skipping any id the registry already carries.
 *
 * The registry rejects duplicate ids, and a second cordis-family preset's
 * standing mount runs this same tool package in the same process; without the
 * skip the second mount would fail with "already registered". Providers are
 * whole-runtime facts, so sharing the first registration is semantically
 * correct and leaves every session's `cordis_inspect_list`/`_query` tools
 * working unchanged. Only Host providers are considered: a Client provider
 * sharing an id lives in a different runtime and must not suppress a Host
 * registration.
 * @param ctx - Host context carrying the process-global `cordisInspect` registry.
 */
export function registerHostInspectProviders(ctx: Context): void {
  const known = new Set(
    ctx.cordisInspect.list()
      .filter(provider => provider.platform === 'host')
      .map(provider => provider.id),
  )
  for (const provider of hostInspectProviders(ctx)) {
    if (known.has(provider.manifest.id)) continue
    ctx.effect(() => ctx.cordisInspect.register(provider), `tool-cordis: inspect ${provider.manifest.id}`)
  }
}

function readExact(input: JsonValue | undefined, field: string): string | undefined {
  if (input === undefined || input === null || Array.isArray(input) || typeof input !== 'object') return undefined
  const value = input[field]
  return typeof value === 'string' ? value : undefined
}
