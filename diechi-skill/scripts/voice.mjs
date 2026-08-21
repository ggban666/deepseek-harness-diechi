#!/usr/bin/env node
/**
 * 蝶翅语音 CLI —— 能力(skill) 部分：说（TTS 朗读）+ 听（ASR 转写）。
 * 直连本地 8080 语音服务（Kokoro TTS + faster-whisper），无需网页。
 *
 * 用法：
 *   voice.mjs speak <文本> [--voice zf_001|zf_018|zm_010|zm_016] [--speed 1.6] [--out out.wav]
 *   voice.mjs listen <音频文件>          # wav/mp3/webm/ogg 等 ffmpeg 可解格式
 *   voice.mjs health
 */
import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.DIECHI_VOICE_URL || 'http://127.0.0.1:8080'

function usage() {
  console.log(`蝶翅语音 CLI
用法:
  voice.mjs speak <文本> [--voice zf_001] [--speed 1.6] [--out out.wav]
  voice.mjs listen <音频文件>
  voice.mjs health
服务: ${BASE}
`)
  process.exit(0)
}

const args = process.argv.slice(2)
const cmd = args[0] ?? ''
const rest = args.slice(1)

function flag(name, fallback) {
  const i = rest.indexOf(name)
  if (i === -1) return fallback
  return rest[i + 1] ?? fallback
}

async function health() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error(`health ${res.status}`)
  const body = await res.json()
  console.log(`视觉=${body.vision ? 'OK' : '未加载'} 语音=${body.tts ? 'OK' : '未加载'} ASR=${body.asr ? 'OK' : '未加载'} 显存=${body.vram_mb ?? '?'}MB`)
}

async function speak(text, voice, speed, out) {
  const res = await fetch(`${BASE}/api/v1/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  })
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`)
  const audio = Buffer.from(await res.arrayBuffer())
  if (out) {
    writeFileSync(out, audio)
    console.log(`已生成语音：${out}（${(audio.length / 1024).toFixed(0)} KB）`)
  } else {
    process.stdout.write(audio)
  }
}

async function listen(path) {
  const data = (await import('node:fs')).readFileSync(path)
  const form = new FormData()
  form.append('file', new Blob([data]), path.split(/[\\/]/).pop() || 'audio.webm')
  const res = await fetch(`${BASE}/api/v1/asr`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`asr ${res.status}: ${await res.text()}`)
  const body = await res.json()
  if (body.ok) console.log(body.text)
  else console.log('（未能转写出内容）')
}

try {
  switch (cmd) {
    case 'health':
      await health()
      break
    case 'speak': {
      const text = rest.filter(a => !a.startsWith('--'))[0] ?? ''
      if (text === '') usage()
      const out = flag('--out', '')
      await speak(text, flag('--voice', 'zf_001'), Number(flag('--speed', '1.6')), out)
      break
    }
    case 'listen': {
      const path = rest[0] ?? ''
      if (path === '') usage()
      await listen(path)
      break
    }
    default:
      usage()
  }
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(1)
}
