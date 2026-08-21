# -*- coding: utf-8 -*-
import io
path = r"packages\client\ui-skill-store\src\client\SkillStoreSection.tsx"
with io.open(path, "r", encoding="utf-8") as f:
    text = f.read()

old_open = """      {skills.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <ul className={css.list}>"""
new_open = """      {skills.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <>
        <ul className={css.list}>"""
if text.count(old_open) != 1:
    raise SystemExit("open fragment anchor not unique/found")
text = text.replace(old_open, new_open, 1)

old_close = """          </div>
        </div>
      )}

      {notice !== undefined && ("""
new_close = """          </div>
        </div>
        </>
      )}

      {notice !== undefined && ("""
if text.count(old_close) != 1:
    raise SystemExit("close fragment anchor not found")
text = text.replace(old_close, new_close, 1)

with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("fragment wrapped OK")
