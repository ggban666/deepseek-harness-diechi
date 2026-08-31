/** 外部服务进程控制字典（zh/en）。 */

export type ProcessControlLocaleKey =
  | 'groupLabel'
  | 'qwenLabel'
  | 'visionLabel'
  | 'running'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'error'
  | 'start'
  | 'stop'
  | 'gpuWarning'
  | 'unavailable'

export const zh: Record<ProcessControlLocaleKey, string> = {
  groupLabel: '服务开关',
  qwenLabel: 'Qwen3.8',
  visionLabel: '视频模型',
  running: '运行中',
  stopped: '已停止',
  starting: '启动中',
  stopping: '停止中',
  error: '异常',
  start: '启动',
  stop: '停止',
  gpuWarning: '显存不足',
  unavailable: '不可达',
}

export const en: Record<ProcessControlLocaleKey, string> = {
  groupLabel: 'Services',
  qwenLabel: 'Qwen3.8',
  visionLabel: 'Vision',
  running: 'Running',
  stopped: 'Stopped',
  starting: 'Starting',
  stopping: 'Stopping',
  error: 'Error',
  start: 'Start',
  stop: 'Stop',
  gpuWarning: 'VRAM low',
  unavailable: 'Unreachable',
}
