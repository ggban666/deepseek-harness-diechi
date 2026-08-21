# @deepseek-ai/dsh-client-ui-skill-store

Skill 商店 (Skill Store) settings section, browser half.

## What this plugin does

Adds one `settings.section` page — 左下角设置 → **Skill 商店** — that manages
the installed skill catalog and the reserved local-vision configuration:

- Lists installed skills with their slash command (`/id`), source badge
  (built-in / imported / generated), and content-pending state.
- Imports skills from a `.md` SKILL.md document (YAML frontmatter) or a
  `.json` generic manifest (one entry, an array, or `{ "skills": [...] }`).
- Removes installed skills.
- Persists a vision-model configuration (`skill.vision`: enabled, endpoint,
  model) and hosts the reserved **从视频/摄像头识别生成技能** entry. The
  recognition pipeline is intentionally not implemented yet — the interface
  is reserved for a locally deployed vision model.

Durable state lives in two settings namespaces owned by the
`@deepseek-ai/dsh-web-app/skill-store` host row:

- `skill.store` — the versioned skill catalog (`SkillManifestEntry[]`); the
  host row bridges it onto `ctx.skills` runtime registrations, so imported
  skills appear in the composer slash menu automatically.
- `skill.vision` — the reserved vision configuration.

## Generic skill format

The manifest is versioned (`formatVersion: 1`) and transport-neutral:

```ts
interface SkillManifestEntry {
  formatVersion: 1
  id: string            // kebab-case; the user slash command name /<id>
  title: string
  description: string
  whenToUse?: string
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  content: string       // markdown body; empty marks content as pending
  source: 'builtin' | 'imported' | 'generated'
}
```

The browser half parses and validates imports (`skill-format.ts`); the host
half re-validates the same JSON before registering.

## Model Experience

No direct model context: the store only manages definitions. Invoked skills
reach the model through the standard `skill` loader path owned by
`dsh-tool-skill`; see `dsh-client-ui-skill` for the user slash menu.

## Known Limitations and Deferred Work

- **Vision recognition is wired to the local model** — the section calls the
  OpenAI-compatible endpoint (default llama.cpp `http://127.0.0.1:8080` +
  `MiniCPM-V-4.6`) with a picked image and shows the model's skill draft.
  Video/camera recognition needs frame extraction and lands later.
- **Skill content is not shipped yet** — the four built-in expert entries
  carry empty bodies and are listed as content pending until import or the
  vision pipeline fills them.
- **Store catalog is settings-backed** — imported bodies persist in the
  settings document, not as `SKILL.md` files under `diechi-home/skills`.