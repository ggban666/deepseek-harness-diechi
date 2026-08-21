# -*- coding: utf-8 -*-
import io

path = r"packages\client\ui-skill-store\src\client\locales.ts"
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read()

def sub(old, new):
    global text
    if old not in text:
        raise SystemExit("NOT FOUND: %r" % old[:90])
    text = text.replace(old, new, 1)

sub("""  | 'installed' | 'empty' | 'pending' | 'builtin' | 'imported' | 'generated'""",
    """  | 'installed' | 'empty' | 'pending' | 'builtin' | 'imported' | 'generated'
  | 'kindText' | 'kindVision' | 'personaToggle' | 'personaHint'
  | 'saveSettings' | 'saveOk' | 'unsaved'""")

sub("""  copyCommand: 'Copy /{id}',
  copied: 'Copied',""",
    """  copyCommand: 'Copy /{id}',
  copied: 'Copied',
  kindText: 'Text skill',
  kindVision: 'Vision skill',
  personaToggle: 'Enable as persona',
  personaHint: 'Checked skills are applied automatically as your persona in every reply. Click "Save settings" to apply changes.',
  saveSettings: 'Save settings',
  saveOk: 'Settings saved.',
  unsaved: 'Unsaved changes',""")

sub("""  copyCommand: '复制 /{id}',
  copied: '已复制',""",
    """  copyCommand: '复制 /{id}',
  copied: '已复制',
  kindText: '文本技能',
  kindVision: '视觉技能',
  personaToggle: '对话中启用（人格）',
  personaHint: '勾选后模型对话将自动按该技能人格工作；改动需点击“保存设置”生效。',
  saveSettings: '保存设置',
  saveOk: '设置已保存。',
  unsaved: '有未保存的改动',""")

with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("locales.ts updated OK")
