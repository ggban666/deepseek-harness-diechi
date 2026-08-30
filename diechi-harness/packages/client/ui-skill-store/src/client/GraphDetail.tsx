/**
 * 节点详情面板：点击节点后常驻右侧，展示完整正文与来源元信息。
 *
 * 两处修正：
 * - 类型徽标改用**按类型切换的 class**。原来靠 `.detailType:has(+ *)` 区分颜色，
 *   而它后面永远跟着关闭按钮，选择器恒真 → 徽标恒为绿色，知识/实操两种配色
 *   是从未生效的死代码。
 * - 面板改为半透明 + 背景模糊（原来的 0.97 不透明度像块贴纸糊在图上）。
 */
import type { BrainGraphNode } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import type { GraphNodeType } from './graph3d.ts'
import { CHIP_CLASS, TONE_CLASS } from './graph-tone.ts'
import css from './KnowledgeGraph.module.css'

const TYPE_KEY: Record<GraphNodeType, SkillStoreKey> = {
  knowledge: 'graphTypeKnowledge',
  memory: 'graphTypeMemory',
  scene: 'graphTypeScene',
}

interface Props {
  node: BrainGraphNode
  /** `this: void` 见 GraphScene 的说明。 */
  t(this: void, key: SkillStoreKey): string
  onClose(this: void): void
}

export function GraphDetail({ node, t, onClose }: Props) {
  return (
    <aside className={css.detail}>
      <div className={css.detailHead}>
        <span className={`${css.detailType ?? ''} ${CHIP_CLASS[node.type]}`}>
          <i className={`${css.chipDot ?? ''} ${TONE_CLASS[node.type]}`} />
          {t(TYPE_KEY[node.type])}
        </span>
        <button type="button" className={css.detailClose} onClick={onClose} aria-label={t('cancel')}>
          ✕
        </button>
      </div>
      <h4 className={css.detailTitle}>{node.label}</h4>
      <p className={css.detailBody}>{node.content}</p>
      <div className={css.detailMeta}>
        <span>{t('graphSource')}: {node.source}</span>
        <span>{node.updatedAt.slice(0, 10)}</span>
        {node.skillId !== '' && <span>#{node.skillId}</span>}
      </div>
    </aside>
  )
}
