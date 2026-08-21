# -*- coding: utf-8 -*-
import io, re, sys

path = r"packages\bundle\web-app\src\skill-store.ts"
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read()

def sub(old, new, count=1):
    global text
    n = text.count(old)
    if n < count:
        raise SystemExit("NOT FOUND (%d): %r" % (n, old[:80]))
    text = text.replace(old, new, count)

# 1) interface: add kind + enabled after whenToUse
sub("""  /** Extra routing guidance; empty when the entry carries none. */
  readonly whenToUse: string
  /** Invocation controls; both surfaces default to true. */""",
    """  /** Extra routing guidance; empty when the entry carries none. */
  readonly whenToUse: string
  /** Surface tag: a text skill or a vision-model skill. */
  readonly kind: 'text' | 'vision'
  /** Checked as an active conversation persona. */
  readonly enabled: boolean
  /** Invocation controls; both surfaces default to true. */""")

# 2) schema: add kind + enabled after whenToUse
sub("""  whenToUse: z.string().required(false),
  invocation: invocationSchema.required(false),""",
    """  whenToUse: z.string().required(false),
  kind: z.union(['text', 'vision']).default('text'),
  enabled: z.boolean().default(false),
  invocation: invocationSchema.required(false),""")

# 3) builtins: add kind + enabled to every entry (4 occurrences)
old = """    whenToUse: '',
    invocation: { modelInvocable: true, userInvocable: true },"""
new = """    whenToUse: '',
    kind: 'text',
    enabled: false,
    invocation: { modelInvocable: true, userInvocable: true },"""
n = text.count(old)
if n != 4:
    raise SystemExit("expected 4 builtin blocks, found %d" % n)
text = text.replace(old, new)

# 4) inject: add systemPrompt
sub("export const inject = ['settings', 'skills']",
    "export const inject = ['settings', 'skills', 'systemPrompt']")

# 5) replace apply() body tail
marker = "export function apply(ctx: Context): void {"
idx = text.index(marker)
head = text[:idx]
new_apply = """export function apply(ctx: Context): void {
  const store = ctx.settings.register(settingsNamespace(SKILL_STORE_NS), skillStoreSchema)
  ctx.settings.register(settingsNamespace(SKILL_VISION_NS), visionSchema)

  // The reserved generation seam (SkillGenerator) is intentionally not wired
  // yet: a future local-vision backend replaces createSkillGenerator without
  // changing the settings UI or the store format.
  const registrations = new Map<string, () => void>()
  const sync = (settings: SkillStoreSettings): void => {
    const active = new Set<string>()
    for (const entry of settings.skills) {
      if (entry.content.trim() === '') continue
      active.add(entry.id)
      if (!registrations.has(entry.id)) {
        registrations.set(entry.id, ctx.skills.register(toSkillRegistration(entry)))
      }
    }
    for (const [id, dispose] of [...registrations]) {
      if (!active.has(id)) {
        dispose()
        registrations.delete(id)
      }
    }
    syncPersona(ctx, settings)
  }

  sync(store.get())
  store.watch((next) => { sync(next) })
}

/** Render the model-facing persona block from every enabled skill. */
function renderPersona(settings: SkillStoreSettings): string {
  const enabled = settings.skills.filter(entry => entry.enabled)
  if (enabled.length === 0) return ''
  const blocks = enabled.map((entry) => {
    const lines: string[] = []
    lines.push(`## ${entry.title} (/${entry.id}) [${entry.kind}]`)
    if (entry.description.trim() !== '') lines.push(entry.description.trim())
    if (entry.whenToUse.trim() !== '') lines.push(`Use when: ${entry.whenToUse.trim()}`)
    if (entry.content.trim() !== '') lines.push(entry.content.trim())
    return lines.join('\\n')
  })
  return [
    '<system-reminder>',
    'The following skills are checked as your active persona. Follow them in every reply; they define how you approach this conversation. If a checked skill carries full instructions, follow them exactly.',
    '',
    ...blocks,
    '</system-reminder>',
  ].join('\\n')
}

/**
 * Reconcile the enabled skill set onto the system prompt as a scoped persona
 * section. Disposes the previous section before registering the new one so a
 * live settings change is reflected on the next model step.
 */
function syncPersona(ctx: Context, settings: SkillStoreSettings): void {
  if (personaSection !== undefined) {
    personaSection()
    personaSection = undefined
  }
  const text = renderPersona(settings)
  if (text === '') return
  personaSection = ctx.systemPrompt.section({
    name: 'skill-store:persona',
    order: 10,
    text,
  })
}

/** Active persona section disposer; torn down with the plugin. */
let personaSection: (() => void) | undefined
"""

out = head + new_apply
with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(out)
print("skill-store.ts updated OK")
