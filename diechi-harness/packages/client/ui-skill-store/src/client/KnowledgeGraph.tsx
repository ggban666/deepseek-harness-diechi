/**
 * 知识图谱视图（3D）：3D 力导向布局 + 透视投影 + SVG 渲染。
 * 节点按类型着色：知识蓝 / 记忆绿 / 实操橙（scene=已归位的实操行动项）。
 * 交互：拖拽旋转视角（轨道控制）、滚轮缩放、点击节点看详情、拖动节点微调。
 * 纯手写 3D 数学，不依赖 d3/three，无额外包。
 */
import { useMemo, useRef, useState } from 'react'
import type { BrainGraphSnapshot, BrainGraphNode, BrainGraphEdge } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import css from './KnowledgeGraph.module.css'

/** 节点类型 → 颜色 */
const NODE_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  knowledge: { fill: '#3b82f6', stroke: '#1d4ed8', glow: 'rgba(59,130,246,0.35)' },
  memory:    { fill: '#10b981', stroke: '#047857', glow: 'rgba(16,185,129,0.35)' },
  scene:     { fill: '#f59e0b', stroke: '#b45309', glow: 'rgba(245,158,11,0.35)' },
}

/** 节点类型 → 标签 */
const TYPE_LABEL: Record<string, string> = {
  knowledge: '知识',
  memory:    '记忆',
  scene:     '实操',
}

/** 节点基础半径（类型区分）。 */
function nodeRadius(n: BrainGraphNode): number {
  return n.type === 'knowledge' ? 15 : n.type === 'memory' ? 12 : 10
}

/** 3D 点。 */
interface P3 { x: number; y: number; z: number }

/** 轻量 3D 力导向模拟：按技能分簇初始化（同技能聚团、簇间拉开），再三维力迭代。 */
function simulateLayout3D(
  nodes: readonly BrainGraphNode[],
  edges: readonly BrainGraphEdge[],
  iterations = 320,
): Map<string, P3> {
  const pos = new Map<string, P3>()
  // 主脑整理后的簇：同 skillId 的阅历是一个知识团；未归位（''）居中。
  const clusters = new Map<string, BrainGraphNode[]>()
  for (const n of nodes) {
    const list = clusters.get(n.skillId) ?? []
    list.push(n)
    clusters.set(n.skillId, list)
  }
  const clusterIds = [...clusters.keys()]
  // 簇中心沿球面分布（未归位放原点附近，其余均匀铺开）。
  const clusterCenter = new Map<string, P3>()
  let globalIdx = 0
  for (const id of clusterIds) {
    if (id === '') {
      clusterCenter.set(id, { x: 0, y: 0, z: 0 })
      continue
    }
    const golden = Math.PI * (3 - Math.sqrt(5))
    const y = 1 - (globalIdx / Math.max(1, clusterIds.length - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * globalIdx
    clusterCenter.set(id, { x: 300 * r * Math.cos(theta), y: 300 * y, z: 300 * r * Math.sin(theta) })
    globalIdx += 1
  }
  // 簇内节点围绕簇中心散布（小半径），体现「一个技能 = 一团阅历」。
  for (const n of nodes) {
    const center = clusterCenter.get(n.skillId) ?? { x: 0, y: 0, z: 0 }
    const a = Math.random() * Math.PI * 2
    const b = Math.acos(2 * Math.random() - 1)
    const r = 70 + Math.random() * 50
    pos.set(n.id, {
      x: center.x + r * Math.sin(b) * Math.cos(a),
      y: center.y + r * Math.sin(b) * Math.sin(a),
      z: center.z + r * Math.cos(b),
    })
  }
  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations
    const force = new Map<string, P3>()
    for (const id of pos.keys()) force.set(id, { x: 0, y: 0, z: 0 })
    // 斥力（所有对，3D）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i]!.id)!
        const b = pos.get(nodes[j]!.id)!
        let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        const repulse = 320000 / (dist * dist)
        const fx = (dx / dist) * repulse, fy = (dy / dist) * repulse, fz = (dz / dist) * repulse
        const fa = force.get(nodes[i]!.id)!
        const fb = force.get(nodes[j]!.id)!
        fa.x += fx; fa.y += fy; fa.z += fz
        fb.x -= fx; fb.y -= fy; fb.z -= fz
      }
    }
    // 引力（边：同簇逻辑关联）
    for (const e of edges) {
      const a = pos.get(e.source), b = pos.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const attract = dist * 0.02 * e.weight
      const fx = (dx / dist) * attract, fy = (dy / dist) * attract, fz = (dz / dist) * attract
      const fa = force.get(e.source)!, fb = force.get(e.target)!
      fa.x += fx; fa.y += fy; fa.z += fz
      fb.x -= fx; fb.y -= fy; fb.z -= fz
    }
    // 簇锚定：每个节点被拉向自己的簇中心（保持技能组团，不漂散）。
    for (const n of nodes) {
      const center = clusterCenter.get(n.skillId) ?? { x: 0, y: 0, z: 0 }
      const p = pos.get(n.id)!
      const f = force.get(n.id)!
      f.x += (center.x - p.x) * 0.012
      f.y += (center.y - p.y) * 0.012
      f.z += (center.z - p.z) * 0.012
    }
    // 应用
    for (const [id, p] of pos) {
      const f = force.get(id)!
      const len = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z) || 1
      const step = Math.min(len, 22) * temp
      p.x += (f.x / len) * step
      p.y += (f.y / len) * step
      p.z += (f.z / len) * step
    }
  }
  return pos
}

/**
 * 3D → 屏幕投影：先绕 Y 轴（yaw）再绕 X 轴（pitch）旋转，再透视投影。
 * @returns 屏幕坐标 + 深度缩放因子（>1 靠近相机）。
 */
function project(
  p: P3, yaw: number, pitch: number, zoom: number,
  cx: number, cy: number, focal = 620,
): { x: number; y: number; s: number; depth: number } {
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch)
  const x1 = p.x * cosY + p.z * sinY
  const z1 = -p.x * sinY + p.z * cosY
  const y1 = p.y * cosP - z1 * sinP
  const z2 = p.y * sinP + z1 * cosP
  const depth = z2 // 旋转后深度
  const s = zoom * (focal / (focal + depth)) // 透视：越远越小
  return { x: cx + x1 * s, y: cy + y1 * s, s, depth }
}

/** 根节点（skill 名称）的虚拟 ID。 */
const SKILL_ROOT_ID = '__skill_root__'

interface Props {
  t: (key: SkillStoreKey) => string
  snapshot: BrainGraphSnapshot
  skillId?: string
  onClose(): void
}

export function KnowledgeGraph({ t, snapshot, skillId, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredId, setHoveredId] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const [cam, setCam] = useState({ yaw: -0.6, pitch: 0.35 })
  const [query, setQuery] = useState('')
  const [filterType, setFilterType] = useState<string>() // undefined=全部
  const rotateRef = useRef<{ startX: number; startY: number; yaw: number; pitch: number } | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null)

  const W = 1000, H = 680, CX = W / 2, CY = H / 2

  // 搜索匹配：query 命中 label/content/topic 的节点 id 集合。
  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return undefined
    const matched = new Set<string>()
    for (const n of snapshot.nodes) {
      if (n.label.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) matched.add(n.id)
    }
    return matched
  }, [query, snapshot.nodes])

  // 类型筛选：undefined=全部，否则只显示该类型。
  const visibleFilter = (n: BrainGraphNode): boolean => filterType === undefined || n.type === filterType

  // 3D 布局（节点世界坐标，稳定于快照）。
  const layout = useMemo(() => {
    const pos = simulateLayout3D(snapshot.nodes, snapshot.edges)
    if (skillId !== undefined && skillId !== '') {
      pos.set(SKILL_ROOT_ID, { x: 0, y: 0, z: 0 })
    }
    return pos
  }, [snapshot, skillId])

  // 投影：节点 + 根 + 边（一次算完，渲染用）。
  const projected = useMemo(() => {
    const nodes = snapshot.nodes.map((n: BrainGraphNode) => {
      const p = layout.get(n.id)
      if (!p) return null
      if (!visibleFilter(n)) return null
      return { node: n, proj: project(p, cam.yaw, cam.pitch, zoom, CX, CY) }
    }).filter((x): x is { node: BrainGraphNode; proj: { x: number; y: number; s: number; depth: number } } => x !== null)
    const visibleIds = new Set(nodes.map(x => x.node.id))
    const edges = snapshot.edges.map((e: { source: string; target: string; weight: number }) => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return null
      const a = layout.get(e.source), b = layout.get(e.target)
      if (!a || !b) return null
      return { e, pa: project(a, cam.yaw, cam.pitch, zoom, CX, CY), pb: project(b, cam.yaw, cam.pitch, zoom, CX, CY) }
    }).filter((x): x is { e: { source: string; target: string; weight: number }; pa: { x: number; y: number; s: number; depth: number }; pb: { x: number; y: number; s: number; depth: number } } => x !== null)
    // 深度排序（painter's algorithm）：深（depth 大）的先画。
    nodes.sort((a, b) => b.proj.depth - a.proj.depth)
    return { nodes, edges }
  }, [snapshot, layout, cam, zoom, filterType])

  const rootProj = useMemo(() => {
    const p = layout.get(SKILL_ROOT_ID)
    return p ? project(p, cam.yaw, cam.pitch, zoom, CX, CY) : null
  }, [layout, cam, zoom])

  const skillTitle = skillId !== undefined && skillId !== '' ? skillId : t('graphGlobal')

  // hover/选中详情（用投影坐标做命中测试）。
  const hitTest = (clientX: number, clientY: number): string | undefined => {
    const svg = svgRef.current
    if (!svg) return undefined
    const rect = svg.getBoundingClientRect()
    const mx = ((clientX - rect.left) / rect.width) * W
    const my = ((clientY - rect.top) / rect.height) * H
    let best: string | undefined
    let bestDist = Infinity
    for (const { node, proj } of projected.nodes) {
      const r = nodeRadius(node) * proj.s
      const d = Math.hypot(mx - proj.x, my - proj.y)
      if (d < r + 6 && d < bestDist) { bestDist = d; best = node.id }
    }
    return best
  }

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.min(3, Math.max(0.3, z * delta)))
  }

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const id = hitTest(e.clientX, e.clientY)
    if (id !== undefined) {
      dragRef.current = { id, startX: e.clientX, startY: e.clientY }
      // 点击节点：固定详情（点空白/✕ 才取消）；已选中再点则取消。
      setSelectedId(prev => (prev === id ? undefined : id))
      return
    }
    // 点空白：取消固定详情。
    setSelectedId(undefined)
    rotateRef.current = { startX: e.clientX, startY: e.clientY, yaw: cam.yaw, pitch: cam.pitch }
  }

  const handleMouseMove = (e: React.MouseEvent): void => {
    // 拖动节点：把屏幕位移换算到世界坐标（粗略，沿相机平面移动）。
    if (dragRef.current !== null) {
      const svg = svgRef.current
      const rect = svg?.getBoundingClientRect()
      if (!rect) return
      const dx = ((e.clientX - dragRef.current.startX) / rect.width) * W
      const dy = ((e.clientY - dragRef.current.startY) / rect.height) * H
      const p = layout.get(dragRef.current.id)
      if (p) {
        p.x += (dx * Math.cos(cam.yaw) - dy * Math.sin(cam.pitch) * Math.sin(cam.yaw)) * 1.2
        p.y += dy * Math.cos(cam.pitch) * 1.2
        p.z += (-dx * Math.sin(cam.yaw) - dy * Math.sin(cam.pitch) * Math.cos(cam.yaw)) * 1.2
      }
      dragRef.current.startX = e.clientX
      dragRef.current.startY = e.clientY
      return
    }
    if (rotateRef.current !== null) {
      const dx = e.clientX - rotateRef.current.startX
      const dy = e.clientY - rotateRef.current.startY
      setCam({
        yaw: rotateRef.current.yaw + dx * 0.008,
        pitch: Math.max(-1.2, Math.min(1.2, rotateRef.current.pitch + dy * 0.008)),
      })
      return
    }
    setHoveredId(hitTest(e.clientX, e.clientY))
  }

  const handleMouseUp = (): void => {
    rotateRef.current = null
    dragRef.current = null
  }

  const resetView = (): void => {
    setCam({ yaw: -0.6, pitch: 0.35 })
    setZoom(1)
    setSelectedId(undefined)
    setHoveredId(undefined)
  }

  // 详情：hover 临时预览；点击固定（selectedId 优先）。
  const detailNode = projected.nodes.find(p => p.node.id === (selectedId ?? hoveredId))?.node
  const connectedIds = useMemo(() => {
    const ids = new Set<string>()
    if (!detailNode) return ids
    for (const e of snapshot.edges) {
      if (e.source === detailNode.id) ids.add(e.target)
      if (e.target === detailNode.id) ids.add(e.source)
    }
    ids.add(detailNode.id)
    return ids
  }, [snapshot.edges, detailNode])

  return (
    <div className={css.root}>
      <header className={css.header}>
        <button type="button" className={css.backBtn} onClick={onClose}>← {t('graphBack')}</button>
        <span className={css.title}>{t('graphTitle').replace('{title}', skillTitle)}</span>
        <input
          className={css.searchInput}
          type="text"
          placeholder={t('graphSearchPlaceholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedId(undefined) }}
        />
        <span className={css.stats}>
          {t('graphNodes').replace('{n}', String(projected.nodes.length))}
          · {t('graphEdges').replace('{m}', String(projected.edges.length))}
        </span>
      </header>
      <svg
        ref={svgRef}
        className={css.svg}
        viewBox={`0 0 ${W} ${H}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* 边 */}
        {projected.edges.map(({ e, pa, pb }, i) => {
          const dimmed = detailNode !== undefined && !connectedIds.has(e.source) && !connectedIds.has(e.target)
          const searchDimmed = searchMatches !== undefined && !(searchMatches.has(e.source) && searchMatches.has(e.target))
          const avgDepth = (pa.depth + pb.depth) / 2
          const alpha = dimmed || searchDimmed ? 0.04 : 0.18 + e.weight * 0.06
          return (
            <line
              key={i}
              x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke={`rgba(110,150,220,${Math.max(0.02, alpha * (1 - avgDepth / 700))})`}
              strokeWidth={Math.max(0.3, (0.6 + e.weight * 0.25) * Math.min(pa.s, pb.s))}
            />
          )
        })}
        {/* skill 根节点（聚合标签） */}
        {rootProj !== null && (
          <g transform={`translate(${rootProj.x},${rootProj.y})`}>
            <circle r={26 * rootProj.s} fill="rgba(30,64,175,0.14)" stroke="rgba(59,130,246,0.45)" strokeWidth={1.5} strokeDasharray="4,3" />
            <text textAnchor="middle" dominantBaseline="middle"
              fill="rgba(59,130,246,0.75)" fontSize={11} fontWeight={600}
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {(skillTitle !== t('graphGlobal') ? skillTitle : '').slice(0, 10)}
            </text>
          </g>
        )}
        {/* 节点（已按深度排序，近的盖在远的上面） */}
        {projected.nodes.map(({ node: n, proj }) => {
          const colors = NODE_COLORS[n.type]!
          const baseR = nodeRadius(n)
          const r = baseR * proj.s
          const isHovered = n.id === hoveredId
          const isSelected = n.id === selectedId
          const dimmed = detailNode !== undefined && !connectedIds.has(n.id)
          const searchHit = searchMatches !== undefined && searchMatches.has(n.id)
          const searchMiss = searchMatches !== undefined && !searchHit
          const near = Math.max(0.35, Math.min(1, 1 - proj.depth / 900))
          const opacity = searchMiss ? 0.12 : (dimmed ? 0.25 : 0.55 + 0.45 * near)
          return (
            <g key={n.id} transform={`translate(${proj.x},${proj.y})`}
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId(undefined)}
              style={{ cursor: isHovered || isSelected ? 'grab' : 'pointer' }}>
              {/* 外发光（hover/选中/搜索命中） */}
              {(isHovered || isSelected || searchHit) && <circle r={r + 7} fill={searchHit && !isHovered && !isSelected ? 'rgba(250,204,21,0.3)' : colors.glow} />}
              {/* 主球 */}
              <circle r={r} fill={colors.fill} stroke={isSelected ? '#fff' : searchHit ? '#facc15' : colors.stroke}
                strokeWidth={isSelected ? 2.5 : isHovered || searchHit ? 2 : 1.2}
                style={{ opacity, transition: 'stroke-width 0.12s' }} />
              {/* 高光 */}
              <ellipse cx={-r * 0.3} cy={-r * 0.3} rx={r * 0.35} ry={r * 0.25} fill="rgba(255,255,255,0.35)" />
              {/* 标签（hover/选中放大） */}
              <text y={r + 10} textAnchor="middle"
                fill={searchMiss || dimmed ? 'rgba(128,128,128,0.3)' : `rgba(220,230,240,${0.55 + 0.4 * near})`}
                fontSize={(isHovered || isSelected ? 12 : 10) * proj.s} fontWeight={isHovered || isSelected ? 600 : 500}
                style={{ pointerEvents: 'none', userSelect: 'none', transition: 'font-size 0.12s' }}>
                {n.label.length > 12 ? n.label.slice(0, 12) + '…' : n.label}
              </text>
            </g>
          )
        })}
      </svg>
      {/* 视角控制 */}
      <div className={css.viewControls}>
        <button type="button" className={css.viewBtn} onClick={() => setZoom(z => Math.min(3, z * 1.25))} title={t('graphZoomIn')}>+</button>
        <button type="button" className={css.viewBtn} onClick={() => setZoom(z => Math.max(0.3, z * 0.8))} title={t('graphZoomOut')}>−</button>
        <button type="button" className={css.viewBtn} onClick={resetView} title={t('graphReset')}>⟲</button>
      </div>
      {/* 操作提示 */}
      <div className={css.hint}>{t('graphRotateHint')}</div>
      {/* 右侧固定详情面板：点击节点打开，完整阅读 */}
      {detailNode !== undefined && (
        <aside className={css.detailPanel}>
          <div className={css.detailHeader}>
            <div className={css.detailType}>{TYPE_LABEL[detailNode.type]!}</div>
            <button type="button" className={css.detailClose} onClick={() => setSelectedId(undefined)}>✕</button>
          </div>
          <h4 className={css.detailTitle}>{detailNode.label}</h4>
          <p className={css.detailContent}>{detailNode.content}</p>
          <div className={css.detailMeta}>
            <span>{t('graphSource')}: {detailNode.source}</span>
            <span>{detailNode.updatedAt.slice(0, 10)}</span>
            {detailNode.skillId !== '' && <span>#{detailNode.skillId}</span>}
          </div>
        </aside>
      )}
      {/* 图例：可点击筛选类型 */}
      <div className={css.legend}>
        <button
          type="button"
          className={filterType === undefined ? css.legendAllActive : css.legendAll}
          onClick={() => setFilterType(undefined)}
        >
          {t('graphAll')}
        </button>
        {(Object.entries(NODE_COLORS) as [string, typeof NODE_COLORS[string]][]).map(([type, colors]) => (
          <button
            key={type}
            type="button"
            className={filterType === type ? css.legendItemActive : css.legendItem}
            onClick={() => setFilterType(prev => (prev === type ? undefined : type))}
          >
            <span className={css.legendDot} style={{ background: colors.fill }} />
            <span>{TYPE_LABEL[type]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
