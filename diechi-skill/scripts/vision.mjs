#!/usr/bin/env node
/**
 * 蝶翅视觉 CLI —— 能力(skill) 部分：看图片 / 看视频 / 健康检查。
 * 直连本地 8080 视觉服务（MiniCPM-V-4.6），无需网页。
 *
 * 用法：
 *   vision.mjs image <图片路径> [提示词]
 *   vision.mjs video <视频路径> [提示词]
 *   vision.mjs health
 */
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.DIECHI_VISION_URL || 'http://127.0.0.1:8080'

function usage() {
  console.log(`蝶翅视觉 CLI
用法:
  vision.mjs image <图片路径> [提示词]
  vision.mjs video <视频路径> [提示词]
  vision.mjs health
服务: ${BASE}
`)
  process.exit(0)
}

const args = process.argv.slice(2)
const cmd = args[0] ?? ''
const rest = args.slice(1)

async function health() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error(`health ${res.status}`)
  const body = await res.json()
  console.log(`视觉=${body.vision ? 'OK' : '未加载'} 语音=${body.tts ? 'OK' : '未加载'} ASR=${body.asr ? 'OK' : '未加载'} 显存=${body.vram_mb ?? '?'}MB`)
}

async function describeImage(path, prompt) {
  const data = readFileSync(path)
  const b64 = data.toString('base64')
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', image: b64 },
      { type: 'text', text: prompt || '请仔细描述这张图片里的内容（场景、物体、文字、人物动作），用中文。' },
    ],
  }]
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'minicpm-v-4.6', messages }),
  })
  if (!res.ok) throw new Error(`vision ${res.status}: ${await res.text()}`)
  const body = await res.json()
  const text = body?.choices?.[0]?.message?.content ?? ''
  console.log(text)
}

async function describeVideo(path, prompt) {
  const data = readFileSync(path)
  const form = new FormData()
  form.append('file', new Blob([data]), path.split(/[\\/]/).pop() || 'video.mp4')
  if (prompt) form.append('prompt', prompt)
  const res = await fetch(`${BASE}/api/v1/video/describe`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`video ${res.status}: ${await res.text()}`)
  const body = await res.json()
  console.log(JSON.stringify(body, null, 2))
}

try {
  switch (cmd) {
    case 'health':
      await health()
      break
    case 'image': {
      const path = rest[0] ?? ''
      if (path === '') usage()
      await describeImage(path, rest[1])
      break
    }
    case 'video': {
      const path = rest[0] ?? ''
      if (path === '') usage()
      await describeVideo(path, rest[1])
      break
    }
    default:
      usage()
  }
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(1)
}
