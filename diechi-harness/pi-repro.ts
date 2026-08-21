import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import * as mod from '@deepseek-ai/dsh-llm-pi-ai'
const doc = load(readFileSync('D:/桌面/振翅新科/蝶翅-app/diechi-home/settings.yaml', 'utf8'))
const sec = doc['llm-pi-ai']
try {
  mod.assertServiceable(sec)
  console.log('assertServiceable OK')
} catch (e) {
  console.error('assertServiceable FAILED:', e.message)
}
