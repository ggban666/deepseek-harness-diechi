/** 自进化面板字典（zh/en）。 */

export type EvolutionLocaleKey =
  | 'badgeLabel'
  | 'panelTitle'
  | 'panelSubtitle'
  | 'close'
  | 'refresh'
  | 'refreshing'
  | 'autoRefresh'
  | 'capabilityTitle'
  | 'capabilityCurrent'
  | 'capabilityBest'
  | 'capabilitySamples'
  | 'costTitle'
  | 'costCurrent'
  | 'costBand'
  | 'costHardMax'
  | 'costActionNone'
  | 'costActionThrottle'
  | 'costActionReject'
  | 'costStatusLabel'
  | 'curveTitle'
  | 'curveLegendC'
  | 'curveLegendK'
  | 'curveEmpty'
  | 'curveEmptyAction'
  | 'signalsTitle'
  | 'sigAccepted'
  | 'sigNoRework'
  | 'sigUserUndo'
  | 'sigExplicitBad'
  | 'signalsEmpty'
  | 'signalsEmptyHint'
  | 'cbsTitle'
  | 'cbsRun'
  | 'cbsRunCommit'
  | 'cbsRunning'
  | 'cbsNever'
  | 'cbsNeverHint'
  | 'famLiveness'
  | 'famSafety'
  | 'famPii'
  | 'cbsFailures'
  | 'proposalsTitle'
  | 'proposalsEmpty'
  | 'proposalsUnavailable'
  | 'proposalDc'
  | 'proposalDk'
  | 'rulesTitle'
  | 'rulesFrozen'
  | 'rulesAuthorized'
  | 'rulesNegatives'
  | 'statusLine'
  | 'feedTitle'
  | 'feedCbs'
  | 'feedCbsNone'
  | 'feedSignals'
  | 'feedProposals'
  | 'feedEmpty'
  | 'noData'
  | 'noDataHint'
  | 'errorLabel'

export const zh: Record<EvolutionLocaleKey, string> = {
  badgeLabel: '自进化',
  panelTitle: '三架构自进化',
  panelSubtitle: '能力只升不降，成本只准在带内浮动。每一点数据都来自真实判定。',
  close: '关闭',
  refresh: '刷新',
  refreshing: '抓取中…',
  autoRefresh: '自动刷新（3s）',
  capabilityTitle: '能力 C(t)',
  capabilityCurrent: '当前',
  capabilityBest: '历史最优',
  capabilitySamples: '体感样本',
  costTitle: '成本 K(t)',
  costCurrent: '当前',
  costBand: '软带 ±20%',
  costHardMax: '硬顶 K_max',
  costActionNone: '带内',
  costActionThrottle: '超软带',
  costActionReject: '超硬顶',
  costStatusLabel: '状态',
  curveTitle: '能力 / 成本 双曲线',
  curveLegendC: 'C(t) 能力',
  curveLegendK: 'K(t) 成本',
  curveEmpty: '还没有历史曲线',
  curveEmptyAction: '跑基准，长出第一点',
  signalsTitle: '体感信号',
  sigAccepted: '点赞',
  sigNoRework: '没返工',
  sigUserUndo: '用户返工',
  sigExplicitBad: '明确不对',
  signalsEmpty: '还没有体感样本',
  signalsEmptyHint: '只有被记录的成功才算成功。去对话里点个赞或踩，C(t) 才有分母。',
  cbsTitle: 'CBS 能力基准集',
  cbsRun: '跑一次（不记录）',
  cbsRunCommit: '跑并记录到曲线',
  cbsRunning: '跑分中…',
  cbsNever: '本次会话还没跑过基准集',
  cbsNeverHint: '跑分在库副本上进行，不会污染生产数据。',
  famLiveness: '放行族',
  famSafety: '拦截族',
  famPii: 'PII 族',
  cbsFailures: '失败任务',
  proposalsTitle: '进化提议',
  proposalsEmpty: '还没有提议',
  proposalsUnavailable: '进化设计者未装载',
  proposalDc: 'ΔC',
  proposalDk: 'ΔK',
  rulesTitle: '规则库',
  rulesFrozen: '冻结规则',
  rulesAuthorized: '已授权',
  rulesNegatives: '负样本',
  statusLine: 'K 在带内 · {frozen} 条冻结规则 · {authorized} 条授权 · {negatives} 条负样本',
  feedTitle: '最新状态',
  feedCbs: '基准：C {score}（{passed}/{total}）',
  feedCbsNone: '基准：本次会话还没跑过',
  feedSignals: '体感：{total} 条样本',
  feedProposals: '提议：{count} 条待审',
  feedEmpty: '还没有动作痕迹。开始对话、跑基准或触发监督，这里会逐条显示。',
  noData: '还没抓到数据',
  noDataHint: '监督者插件未装载，或 RPC 还没就绪。',
  errorLabel: '抓取失败',
}

export const en: Record<EvolutionLocaleKey, string> = {
  badgeLabel: 'Self-evolution',
  panelTitle: 'Tri-architecture Self-evolution',
  panelSubtitle: 'Capability only rises; cost only floats inside the band. Every data point comes from a real judgment.',
  close: 'Close',
  refresh: 'Refresh',
  refreshing: 'Fetching…',
  autoRefresh: 'Auto refresh (3s)',
  capabilityTitle: 'Capability C(t)',
  capabilityCurrent: 'Current',
  capabilityBest: 'Best',
  capabilitySamples: 'Samples',
  costTitle: 'Cost K(t)',
  costCurrent: 'Current',
  costBand: 'Soft band ±20%',
  costHardMax: 'Hard cap K_max',
  costActionNone: 'In band',
  costActionThrottle: 'Over band',
  costActionReject: 'Over cap',
  costStatusLabel: 'Status',
  curveTitle: 'Capability / Cost curves',
  curveLegendC: 'C(t) capability',
  curveLegendK: 'K(t) cost',
  curveEmpty: 'No history curve yet',
  curveEmptyAction: 'Run "record to curve" to grow the first point',
  signalsTitle: 'Experience signals',
  sigAccepted: 'Upvote',
  sigNoRework: 'No rework',
  sigUserUndo: 'User undid',
  sigExplicitBad: 'Marked wrong',
  signalsEmpty: 'No experience samples yet',
  signalsEmptyHint: 'Only recorded successes count. Upvote or downvote a reply to give C(t) a denominator.',
  cbsTitle: 'CBS capability benchmark',
  cbsRun: 'Run (no record)',
  cbsRunCommit: 'Run and record',
  cbsRunning: 'Running…',
  cbsNever: 'No benchmark run in this session',
  cbsNeverHint: 'Scoring runs on a copy of the database — production data stays clean.',
  famLiveness: 'Liveness',
  famSafety: 'Safety',
  famPii: 'PII',
  cbsFailures: 'Failed tasks',
  proposalsTitle: 'Evolution proposals',
  proposalsEmpty: 'No proposals yet',
  proposalsUnavailable: 'Evolve designer not loaded',
  proposalDc: 'ΔC',
  proposalDk: 'ΔK',
  rulesTitle: 'Rule base',
  rulesFrozen: 'Frozen rules',
  rulesAuthorized: 'Authorized',
  rulesNegatives: 'Negatives',
  statusLine: 'K in band · {frozen} frozen · {authorized} authorized · {negatives} negatives',
  feedTitle: 'Latest state',
  feedCbs: 'Benchmark: C {score} ({passed}/{total})',
  feedCbsNone: 'Benchmark: not run this session',
  feedSignals: 'Signals: {total} samples',
  feedProposals: 'Proposals: {count} pending',
  feedEmpty: 'No action traces yet. Start a conversation, run the benchmark, or trigger supervision to see entries here.',
  noData: 'No data yet',
  noDataHint: 'The supervisor plugin is not loaded, or the RPC is not ready.',
  errorLabel: 'Fetch failed',
}
