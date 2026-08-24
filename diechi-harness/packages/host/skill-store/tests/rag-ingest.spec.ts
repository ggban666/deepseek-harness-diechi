/** 对话自动检索（RAG）与自动归纳（ingest）辅助函数单元测试。 */

import { describe, expect, it } from 'vitest'
import {
  computeImportance, keywordTokens, messageText, scoreText, truncateText,
} from '../src/skill-store.ts'

describe('keywordTokens', () => {
  it('提取 ASCII 词与中文二元组', () => {
    const tokens = keywordTokens('我想学 8D 报告写法 report')
    expect(tokens.has('8d')).toBe(true)
    expect(tokens.has('report')).toBe(true)
    expect(tokens.has('我想')).toBe(true)
    expect(tokens.has('报告')).toBe(true)
  })
})

describe('scoreText', () => {
  it('相关正文得分高于无关正文', () => {
    const tokens = keywordTokens('用户偏好：喜欢简短回答')
    const related = scoreText('用户偏好：喜欢简短回答，重要', tokens)
    const unrelated = scoreText('今天的天气很好', tokens)
    expect(related).toBeGreaterThan(unrelated)
  })
})

describe('computeImportance', () => {
  it('自我/偏好/约定信号提升重要性', () => {
    expect(computeImportance('我叫张三，请记住')).toBe(3)
    expect(computeImportance('我需要一份 8D 报告')).toBe(2)
    expect(computeImportance('今天天气不错')).toBe(1)
  })
})

describe('truncateText', () => {
  it('超长截断加省略号', () => {
    const out = truncateText('一二三四五', 4)
    expect(out).toBe('一二三…')
    expect(truncateText('短文本', 10)).toBe('短文本')
  })
})

describe('messageText', () => {
  it('提取文本块拼接', () => {
    const text = messageText({ content: [
      { type: 'text', text: '你好' },
      { type: 'text', text: '世界' },
      { type: 'image', text: undefined },
    ] })
    expect(text).toBe('你好 世界')
  })
})