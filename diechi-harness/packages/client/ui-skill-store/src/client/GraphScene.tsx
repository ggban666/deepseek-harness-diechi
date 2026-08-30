/**
 * 图谱的 SVG 场景层：只负责把「已算好的投影」画出来，不含任何状态与交互逻辑。
 *
 * 三条可读性处理（原来没有，是「看不清」的主要来源）：
 * - 节点配色走 CSS 变量（`--node-fill` / `--node-stroke`），由 tone 类按类型切换，
 *   因此**跟随主题**；节点色本身取 `--dsw-static-*`（明暗一致），保证语义色不漂移。
 * - 标签用 `paint-order: stroke` 描一圈底色描边，压在连线上也读得清。
 * - 连线用主题化的 `--dsw-alias-border-l3` 而非写死的蓝，明暗主题下都不会糊。
 *
 * 交互只在 `<svg>` 上挂一层（命中测试统一走 pickNode），**不给每个节点挂
 * onMouseEnter/Leave**——那会和 svg 层的 hitTest 双重记账，节点间移动时来回抖动。
 */
import type { MouseEvent as ReactMouseEvent, RefObject, WheelEvent as ReactWheelEvent } from 'react'
import type { BrainGraphEdge } from '@deepseek-ai/dsh-api-remotes/types'
import type { PlacedNode, Projected, Viewport } from './graph3d.ts'
import { TONE_CLASS } from './graph-tone.ts'
import css from './KnowledgeGraph.module.css'

/** 已投影的一条边。 */
export interface ProjectedEdge {
  readonly key: string
  readonly edge: BrainGraphEdge
  readonly pa: Projected
  readonly pb: Projected
}

/** 技能簇的虚拟根节点（聚合标签）。 */
export interface RootMarker {
  readonly label: string
  readonly proj: Projected
}

interface Props {
  svgRef: RefObject<SVGSVGElement>
  viewport: Viewport
  /** 节点，已按深度降序排好（远的先画，近的自然盖在上面）。 */
  placed: readonly PlacedNode[]
  edges: readonly ProjectedEdge[]
  root: RootMarker | null
  /** 注意：本仓开了 exactOptionalPropertyTypes，可选属性必须显式带上 undefined。 */
  hoveredId?: string | undefined
  selectedId?: string | undefined
  /** 详情节点的邻接集合；undefined = 当前没有聚焦，全亮。 */
  highlight: ReadonlySet<string> | undefined
  /** 搜索命中集合；undefined = 没有搜索词。 */
  searchMatches: ReadonlySet<string> | undefined
  // 函数型 prop 一律标 `this: void`：解构出来后与宿主对象解绑，
  // 标了才能满足 unbound-method，也明确表达这些回调不依赖 this。
  onWheel(this: void, e: ReactWheelEvent<SVGSVGElement>): void
  onMouseDown(this: void, e: ReactMouseEvent<SVGSVGElement>): void
  onMouseMove(this: void, e: ReactMouseEvent<SVGSVGElement>): void
  onMouseUp(this: void, e: ReactMouseEvent<SVGSVGElement>): void
}

/** 深度 → 近度（0 最远，1 最近），用于雾化和字号。 */
function nearness(depth: number): number {
  return Math.max(0, Math.min(1, 1 - depth / 900))
}

export function GraphScene({
  svgRef, viewport, placed, edges, root,
  hoveredId, selectedId, highlight, searchMatches,
  onWheel, onMouseDown, onMouseMove, onMouseUp,
}: Props) {
  return (
    <svg
      ref={svgRef}
      className={css.svg}
      viewBox={`0 0 ${viewport.w} ${viewport.h}`}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* 连线：先画，天然在节点下层 */}
      <g className={css.edges}>
        {edges.map(({ key, edge, pa, pb }) => {
          const related = highlight === undefined
            || highlight.has(edge.source)
            || highlight.has(edge.target)
          const bothHit = searchMatches === undefined
            || (searchMatches.has(edge.source) && searchMatches.has(edge.target))
          const avgDepth = (pa.depth + pb.depth) / 2
          const base = related && bothHit ? 0.18 + edge.weight * 0.06 : 0.04
          const alpha = Math.max(0.03, base * (1 - avgDepth / 700))
          return (
            <line
              key={key}
              className={css.edge}
              x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              strokeOpacity={alpha}
              strokeWidth={Math.max(0.3, (0.6 + edge.weight * 0.25) * Math.min(pa.s, pb.s))}
            />
          )
        })}
      </g>

      {/* 技能簇中心：虚线圆环做聚合标签 */}
      {root !== null && (
        <g className={css.rootMark} transform={`translate(${root.proj.x},${root.proj.y})`}>
          <circle r={26 * root.proj.s} strokeWidth={1.5} strokeDasharray="4,3" />
          <text textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={600}>
            {root.label}
          </text>
        </g>
      )}

      {/* 节点 */}
      {placed.map(({ id, node, proj, r }) => {
        const isHovered = id === hoveredId
        const isSelected = id === selectedId
        const dimmed = highlight !== undefined && !highlight.has(id)
        const hit = searchMatches?.has(id)
        const miss = searchMatches !== undefined && hit !== true
        const near = nearness(proj.depth)
        const opacity = miss ? 0.12 : dimmed ? 0.25 : 0.55 + 0.45 * near
        const active = isHovered || isSelected || hit === true
        return (
          <g
            key={id}
            className={`${css.node ?? ''} ${TONE_CLASS[node.type]}`}
            transform={`translate(${proj.x},${proj.y})`}
          >
            {/* 外发光：命中时换成琥珀色，其余用节点自身色 */}
            {active && (
              <circle
                className={hit === true && !isHovered && !isSelected ? css.glowHit : css.glow}
                r={r + 7}
              />
            )}
            {/* 主球 */}
            <circle
              className={isSelected ? css.ballSelected : hit === true ? css.ballHit : css.ball}
              r={r}
              strokeWidth={isSelected ? 2.5 : active ? 2 : 1.2}
              opacity={opacity}
            />
            {/* 高光：固定在左上，制造球体感 */}
            <ellipse
              className={css.spec}
              cx={-r * 0.3} cy={-r * 0.3}
              rx={r * 0.35} ry={r * 0.25}
            />
            {/* 标签：描边底色，压在连线上也读得清 */}
            <text
              className={css.label}
              y={r + 10}
              textAnchor="middle"
              fontSize={(isHovered || isSelected ? 12 : 10) * proj.s}
              fontWeight={isHovered || isSelected ? 600 : 500}
              opacity={miss ? 0.28 : dimmed ? 0.35 : 0.6 + 0.4 * near}
            >
              {node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
