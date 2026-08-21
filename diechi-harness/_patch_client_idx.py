# -*- coding: utf-8 -*-
import io

# ---- CSS ----
css_path = r"packages\client\ui-skill-store\src\client\SkillStoreSection.module.css"
with io.open(css_path, "r", encoding="utf-8") as f:
    css = f.read()
css += """
.kindBadge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-state-business-primary, #6b46c1);
}

.persona {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.persona input:disabled {
  cursor: default;
}

.personaBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 8px;
}

.dirtyBadge {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
  font-size: 11px;
}
"""
with io.open(css_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(css)
print("css updated OK")

# ---- client/index.ts ----
idx_path = r"packages\client\ui-skill-store\src\client\index.ts"
with io.open(idx_path, "r", encoding="utf-8") as f:
    text = f.read()

old = """  /**
   * Persist a vision configuration patch. Each changed field is written
   * separately so unknown sections are never clobbered.
   * @param patch - fields to change.
   */
  async setVision(patch: Partial<VisionState>): Promise<void> {"""
new = """  /**
   * Persist the checked persona set by writing the full catalog with the
   * requested `enabled` flags applied. Unknown ids are ignored.
   * @param updates - id/enabled pairs from the section's save button.
   */
  async saveEnabled(updates: readonly { readonly id: string; readonly enabled: boolean }[]): Promise<void> {
    const current = this.storeScope.getSnapshot().value?.skills ?? []
    const byId = new Map(current.map(entry => [entry.id, entry]))
    for (const update of updates) {
      const existing = byId.get(update.id)
      if (existing === undefined) continue
      byId.set(update.id, { ...existing, enabled: update.enabled })
    }
    await this.storeScope.set('skills', [...byId.values()])
  }

  /**
   * Persist a vision configuration patch. Each changed field is written
   * separately so unknown sections are never clobbered.
   * @param patch - fields to change.
   */
  async setVision(patch: Partial<VisionState>): Promise<void> {"""
if text.count(old) != 1:
    raise SystemExit("setVision anchor not found")
text = text.replace(old, new, 1)

old2 = """      importSkill: (file) => this.importSkill(file),
      removeSkill: (id) => this.removeSkill(id),
      setVision: (patch) => this.setVision(patch),"""
new2 = """      importSkill: (file) => this.importSkill(file),
      removeSkill: (id) => this.removeSkill(id),
      saveEnabled: (updates) => this.saveEnabled(updates),
      setVision: (patch) => this.setVision(patch),"""
if text.count(old2) != 1:
    raise SystemExit("inject anchor not found")
text = text.replace(old2, new2, 1)

with io.open(idx_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("client/index.ts updated OK")
