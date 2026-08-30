/**
 * 节点类型 → CSS 类名的映射，集中在一处。
 *
 * 之所以要这张表：CSS module 的类名在 TS 侧是 `Record<string, string>`，
 * 拼字符串取 `css[`tone_${type}`]` 既绕过了类型检查，又依赖 postcss 的
 * localsConvention 配置（本仓配的是 camelCase，带下划线的名字会被改写）。
 * 显式写死三行，读起来也清楚。
 */
import css from './KnowledgeGraph.module.css'
import type { GraphNodeType } from './graph3d.ts'

/** 节点/色点的配色类（提供 `--node-fill` / `--node-stroke`）。 */
export const TONE_CLASS: Readonly<Record<GraphNodeType, string>> = {
  knowledge: css.toneKnowledge ?? '',
  memory: css.toneMemory ?? '',
  scene: css.toneScene ?? '',
}

/** 详情面板类型徽标的配色类。 */
export const CHIP_CLASS: Readonly<Record<GraphNodeType, string>> = {
  knowledge: css.chipKnowledge ?? '',
  memory: css.chipMemory ?? '',
  scene: css.chipScene ?? '',
}
