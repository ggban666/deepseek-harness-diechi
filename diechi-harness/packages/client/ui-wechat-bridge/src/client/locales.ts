/**
 * 微信机器人设置文案。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'wechat-bridge': WeChatBridgeKey
  }
}

export type WeChatBridgeKey = keyof typeof zh

export const zh = {
  nav: '微信机器人',
}

export const en = {
  nav: 'WeChat Bot',
}
