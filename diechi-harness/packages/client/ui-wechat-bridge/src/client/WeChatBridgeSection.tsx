/**
 * 微信机器人设置段：连接状态确认、目标会话、触发策略、处理日志。
 * 所有状态来自宿主回写的 wechat-bridge 段；操作用户配置写回同段。
 */
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import * as React from 'react'

/** 一条处理日志。 */
export interface BridgeLogEntry {
  at: string
  direction: string // in | out | info | error
  chat: string
  sender: string
  text: string
}

/** 设置段快照。 */
export interface BridgeState {
  enabled: boolean
  status: string
  account: string
  error: string
  targetSessionId: string
  targetSessionTitle: string
  contacts: string[]
  groups: string[]
  replyAll: boolean
  logs: BridgeLogEntry[]
  writable: boolean
}

/** 设置段注入面。 */
export interface WeChatBridgeInjected {
  hooks: {
    bridge: HostObservable<BridgeState>
  }
  setEnabled(value: boolean): Promise<void>
  setTargetSession(id: string, title: string): Promise<void>
  setContacts(list: string[]): Promise<void>
  setGroups(list: string[]): Promise<void>
  setReplyAll(value: boolean): Promise<void>
  clearLogs(): Promise<void>
  useCurrentSession(): Promise<void>
  createDedicatedSession(): Promise<void>
}

/** Props the renderer binds for the section. */
export type WeChatBridgeSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'wechat-bridge'>
  & InjectFace<WeChatBridgeInjected>

/** 状态 → 展示文案/颜色。 */
function statusView(status: string): { label: string; color: string } {
  switch (status) {
    case 'connected': return { label: '已连接', color: '#3fb950' }
    case 'connecting': return { label: '连接中…', color: '#d29922' }
    case 'error': return { label: '异常', color: '#f85149' }
    default: return { label: '未连接', color: '#8b949e' }
  }
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }
const label: React.CSSProperties = { width: 88, color: '#8b949e', fontSize: 13, flexShrink: 0 }
const input: React.CSSProperties = {
  flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #30363d',
  background: '#161b22', color: '#e6edf3', fontSize: 13, minWidth: 0,
}
const button: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #30363d',
  background: '#21262d', color: '#e6edf3', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
}
const logLine: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 12, color: '#8b949e', padding: '2px 0',
  borderBottom: '1px solid #21262d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const hint: React.CSSProperties = { color: '#6e7681', fontSize: 12, margin: '4px 0 0', lineHeight: 1.6 }

/** 逗号分隔文本 → 列表（去空、去重）。 */
function splitList(text: string): string[] {
  return [...new Set(text.split(/[,，、;；]/).map(s => s.trim()).filter(s => s !== ''))]
}

/**
 * 微信机器人设置段组件。
 * @param props - slots 注入面（useBridge 快照 hook + 写回动作）。
 */
export function WeChatBridgeSection({
  useBridge, setEnabled, setTargetSession, setContacts, setGroups, setReplyAll,
  clearLogs, useCurrentSession, createDedicatedSession,
}: WeChatBridgeSectionProps) {
  const bridge = useBridge(value => value)
  const status = statusView(bridge.status)
  const [contactsText, setContactsText] = React.useState(bridge.contacts.join('、'))
  const [groupsText, setGroupsText] = React.useState(bridge.groups.join('、'))
  const [sessionId, setSessionId] = React.useState(bridge.targetSessionId)
  const [sessionTitle] = React.useState(bridge.targetSessionTitle)
  const [busy, setBusy] = React.useState(false)

  const applyList = async (
    field: 'contacts' | 'groups',
    text: string,
    setter: (v: string) => void,
  ): Promise<void> => {
    const list = splitList(text)
    if (field === 'contacts') await setContacts(list)
    else await setGroups(list)
    setter(text)
  }

  return (
    <div style={{ padding: 12, fontSize: 14 }}>
      {/* 连接状态 */}
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600 }}>微信机器人</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: status.color, display: 'inline-block' }} />
          {status.label}
          {bridge.account !== '' && <span style={{ color: '#8b949e', fontSize: 13 }}>· {bridge.account}</span>}
        </span>
      </div>
      {bridge.error !== '' && (
        <div style={{ ...logLine, color: '#f85149' }}>⚠ {bridge.error}</div>
      )}
      <div style={row}>
        <label style={label}>启用桥接</label>
        <input
          type="checkbox"
          checked={bridge.enabled}
          disabled={!bridge.writable || busy}
          onChange={(event) => { setBusy(true); void setEnabled(event.target.checked).finally(() => setBusy(false)) }}
        />
        <span style={{ color: '#8b949e', fontSize: 12 }}>开启后微信消息进入下方目标会话</span>
      </div>

      {/* 目标会话 */}
      <div style={{ ...row, alignItems: 'flex-start' }}>
        <label style={label}>目标会话</label>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            style={{ ...input, width: '100%', boxSizing: 'border-box' }}
            placeholder="会话 ID（可在设置里选当前会话或新建专用会话）"
            value={sessionId}
            disabled={!bridge.writable}
            onChange={(event) => setSessionId(event.target.value)}
            onBlur={() => { if (sessionId.trim() !== '') void setTargetSession(sessionId, sessionTitle) }}
          />
          <div style={row}>
            <button style={button} disabled={!bridge.writable || busy} onClick={() => { setBusy(true); void useCurrentSession().finally(() => setBusy(false)) }}>
              使用当前会话
            </button>
            <button style={button} disabled={!bridge.writable || busy} onClick={() => { setBusy(true); void createDedicatedSession().finally(() => setBusy(false)) }}>
              新建专用会话「微信助手」
            </button>
          </div>
          {bridge.targetSessionTitle !== '' && (
            <div style={hint}>已选：{bridge.targetSessionTitle}（{bridge.targetSessionId.slice(0, 24)}…）</div>
          )}
        </div>
      </div>

      {/* 触发策略 */}
      <div style={{ ...row, alignItems: 'flex-start' }}>
        <label style={label}>触发策略</label>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={{ ...hint, display: 'block' }}>
            <input
              type="checkbox"
              checked={bridge.replyAll}
              disabled={!bridge.writable}
              onChange={(event) => void setReplyAll(event.target.checked)}
            />{' '}
            处理所有消息（不勾选则只处理下方名单中的联系人/群）
          </label>
          <div style={hint}>私聊联系人（逗号分隔）：</div>
          <input
            style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 4 }}
            placeholder="张三、李四"
            value={contactsText}
            disabled={!bridge.writable}
            onChange={(event) => setContactsText(event.target.value)}
            onBlur={() => void applyList('contacts', contactsText, setContactsText)}
          />
          <div style={hint}>群聊（按窗口名，逗号分隔）：</div>
          <input
            style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 4 }}
            placeholder="工作群、项目群"
            value={groupsText}
            disabled={!bridge.writable}
            onChange={(event) => setGroupsText(event.target.value)}
            onBlur={() => void applyList('groups', groupsText, setGroupsText)}
          />
        </div>
      </div>

      {/* 处理日志 */}
      <div style={{ ...row, alignItems: 'flex-start' }}>
        <label style={label}>最近处理</label>
        <div style={{ flex: 1, minWidth: 0 }}>
          {bridge.logs.length === 0 && <div style={hint}>暂无处理记录</div>}
          {bridge.logs.slice(0, 10).map((entry, index) => (
            <div key={`${entry.at}-${index}`} style={logLine}>
              <span style={{ color: entry.direction === 'error' ? '#f85149' : entry.direction === 'out' ? '#58a6ff' : '#8b949e' }}>
                {entry.at.slice(11, 19)} [{entry.direction === 'in' ? '收' : entry.direction === 'out' ? '发' : entry.direction === 'error' ? '错' : '讯'}]
              </span>{' '}
              {entry.chat !== '' && <span>{entry.chat}：</span>}
              {entry.text}
            </div>
          ))}
          {bridge.logs.length > 0 && (
            <button style={{ ...button, marginTop: 6 }} onClick={() => void clearLogs()}>清空日志</button>
          )}
        </div>
      </div>

      <div style={hint}>
        使用前提：电脑已安装并登录微信 4.x（勾选自动登录则重启不重扫）；已执行 pip install wxautox4。
        微信收到的消息会进入目标会话并自动回复，网页会话里同样可见完整对话。
      </div>
    </div>
  )
}
