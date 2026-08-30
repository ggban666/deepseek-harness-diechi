/**
 * 图例 / 类型筛选条。
 *
 * 按固定顺序遍历三种节点类型（不再 `Object.entries` 依赖对象键序 + 类型断言），
 * 每种带一个色点；点击切换筛选，再点一次取消。
 */
import type { SkillStoreKey } from './locales.ts'
import type { GraphNodeType } from './graph3d.ts'
import { TONE_CLASS } from './graph-tone.ts'
import css from './KnowledgeGraph.module.css'

/** 固定的展示顺序，同时决定图例与色点的对应关系。 */
export const GRAPH_TYPES: readonly GraphNodeType[] = ['knowledge', 'memory', 'scene']

const TYPE_KEY: Record<GraphNodeType, SkillStoreKey> = {
  knowledge: 'graphTypeKnowledge',
  memory: 'graphTypeMemory',
  scene: 'graphTypeScene',
}

interface Props {
  active: GraphNodeType | undefined
  counts: Readonly<Record<GraphNodeType, number>>
  /** `this: void` 见 GraphScene 的说明。 */
  t(this: void, key: SkillStoreKey): string
  onToggle(this: void, type: GraphNodeType | undefined): void
}

export function GraphLegend({ active, counts, t, onToggle }: Props) {
  return (
    <div className={css.legend}>
      <button
        type="button"
        className={active === undefined ? css.legendOn : css.legendBtn}
        onClick={() => { onToggle(undefined) }}
      >
        {t('graphAll')}
      </button>
      {GRAPH_TYPES.map(type => (
        <button
          key={type}
          type="button"
          className={active === type ? css.legendOn : css.legendBtn}
          onClick={() => { onToggle(active === type ? undefined : type) }}
        >
          <span className={`${css.legendDot ?? ''} ${TONE_CLASS[type]}`} />
          <span>{t(TYPE_KEY[type])}</span>
          <span className={css.legendCount}>{counts[type]}</span>
        </button>
      ))}
    </div>
  )
}
