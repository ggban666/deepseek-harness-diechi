/** 阅历控制台字典（zh/en）。 */

export type BrainConsoleLocaleKey =
  | 'nav'
  | 'title'
  | 'intro'
  | 'empty'
  | 'refresh'
  | 'loading'
  | 'expand'
  | 'collapse'
  | 'assignTitle'
  | 'assignPlaceholder'
  | 'assignButton'
  | 'assignedTo'
  | 'statusPending'
  | 'statusAssigned'
  | 'statusArchived'
  | 'tagsLabel'
  | 'tagsSave'
  | 'deleteButton'
  | 'deleteConfirm'
  | 'suggestionNone'
  | 'suggestionPrefix'
  | 'errorLoad'
  | 'errorAction'
  | 'okAction'
  | 'readOnly'


export const zh: Record<BrainConsoleLocaleKey, string> = {
  nav: '阅历控制台',
  title: '阅历控制台',
  intro: '你投喂的视频实操都在这里。确认归位到某个平权技能，它就会进入那个技能的数据库；不归位就留在收件箱，不会乱进任何技能。',
  empty: '还没有实操阅历。拍一段实操视频并完成识别后，会出现在这里。',
  refresh: '刷新',
  loading: '加载中…',
  expand: '展开',
  collapse: '收起',
  assignTitle: '归位到技能',
  assignPlaceholder: '选择技能…',
  assignButton: '归位',
  assignedTo: '已归位',
  statusPending: '待归位',
  statusAssigned: '已归位',
  statusArchived: '已归档',
  tagsLabel: '标签',
  tagsSave: '保存标签',
  deleteButton: '删除',
  deleteConfirm: '确定删除这条实操？删除后不可恢复。',
  suggestionNone: '无自动建议',
  suggestionPrefix: '建议归入',
  errorLoad: '加载失败，请重试',
  errorAction: '操作失败',
  okAction: '完成',
  readOnly: '只读：当前文档不允许写入。',
}

export const en: Record<BrainConsoleLocaleKey, string> = {
  nav: 'Experience Console',
  title: 'Experience Console',
  intro: 'Video practices you fed are collected here. Assign one to a skill to move it into that skill\u2019s database; unassigned items stay in the inbox only.',
  empty: 'No practice yet. Record and recognize a practice video and it will show up here.',
  refresh: 'Refresh',
  loading: 'Loading\u2026',
  expand: 'Expand',
  collapse: 'Collapse',
  assignTitle: 'Assign to skill',
  assignPlaceholder: 'Pick a skill\u2026',
  assignButton: 'Assign',
  assignedTo: 'Assigned',
  statusPending: 'Pending',
  statusAssigned: 'Assigned',
  statusArchived: 'Archived',
  tagsLabel: 'Tags',
  tagsSave: 'Save tags',
  deleteButton: 'Delete',
  deleteConfirm: 'Delete this practice? This cannot be undone.',
  suggestionNone: 'No suggestion',
  suggestionPrefix: 'Suggested:',
  errorLoad: 'Failed to load, please retry',
  errorAction: 'Action failed',
  okAction: 'Done',
  readOnly: 'Read-only: the current document rejects writes.',
}