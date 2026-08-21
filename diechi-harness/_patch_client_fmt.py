# -*- coding: utf-8 -*-
import io

path = r"packages\client\ui-skill-store\src\client\skill-format.ts"
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read()

def sub(old, new, count=1):
    global text
    n = text.count(old)
    if n < count:
        raise SystemExit("NOT FOUND (%d): %r" % (n, old[:90]))
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

# 2) isSkillManifestEntry: tolerate legacy entries without kind/enabled
sub("""    && typeof entry.description === 'string'
    && typeof entry.content === 'string'
    && (entry.source === 'builtin' || entry.source === 'imported' || entry.source === 'generated')""",
    """    && typeof entry.description === 'string'
    && typeof entry.content === 'string'
    && (entry.kind === undefined || entry.kind === 'text' || entry.kind === 'vision')
    && (entry.enabled === undefined || typeof entry.enabled === 'boolean')
    && (entry.source === 'builtin' || entry.source === 'imported' || entry.source === 'generated')""")

# 3) normalizeJsonEntry: parse kind + enabled
sub("""  if (typeof entry.content !== 'string') throw new Error(`技能 ${entry.id} 缺少 content`)
  const id = entry.id.trim()
  return {
    formatVersion: 1,
    id,
    title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title : id,
    description: entry.description,
    whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
    invocation: parseInvocation(entry.invocation),
    content: entry.content,
    source: 'imported',
  }""",
    """  if (typeof entry.content !== 'string') throw new Error(`技能 ${entry.id} 缺少 content`)
  const id = entry.id.trim()
  return {
    formatVersion: 1,
    id,
    title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title : id,
    description: entry.description,
    whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
    kind: entry.kind === 'vision' ? 'vision' : 'text',
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : false,
    invocation: parseInvocation(entry.invocation),
    content: entry.content,
    source: 'imported',
  }""")

# 4) parseSkillMarkdown: parse kind + enabled from frontmatter
sub("""  const id = name.trim()
  return {
    formatVersion: 1,
    id,
    title: typeof data.title === 'string' && data.title.trim() !== '' ? data.title : id,
    description: data.description.trim(),
    whenToUse: typeof data['when-to-use'] === 'string' ? data['when-to-use'] : '',
    invocation: {""",
    """  const id = name.trim()
  return {
    formatVersion: 1,
    id,
    title: typeof data.title === 'string' && data.title.trim() !== '' ? data.title : id,
    description: data.description.trim(),
    whenToUse: typeof data['when-to-use'] === 'string' ? data['when-to-use'] : '',
    kind: data.kind === 'vision' ? 'vision' : 'text',
    enabled: data.enabled === true,
    invocation: {""")

with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("skill-format.ts updated OK")
