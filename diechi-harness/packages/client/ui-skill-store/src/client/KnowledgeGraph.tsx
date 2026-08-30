/**
 * 知识图谱视图（3D）：力导向布局 + 透视投影 + SVG 渲染。
 *
 * 这一层只做**状态编排与事件处理**；数学在 `graph3d.ts`，绘制在
 * `GraphScene.tsx` / `GraphDetail.tsx` / `GraphLegend.tsx`。
 *
 * 交互：拖拽空白处旋转视角、滚轮缩放、点击节点聚焦（相机缓动到该节点）、
 * 拖动节点微调位置、搜索命中高亮、图例按类型筛选。
 *
 * 布局：详情面板是**挤压式的右栏**（不是浮在画布上的浮层），画布让出宽度。
 * 这样聚焦的节点永远落在剩余画布的正中，不会被面板压住。
 * 这里有个连带约束：面板**只能由点击（selectedId）驱动**，不能由 hover 驱动——
 * hover 会让画布随光标在节点间移动而反复伸缩，进而让光标脱离节点，
 * 形成「收缩→脱离→展开→又命中」的抖动死循环。
 *
 * 相对最初版本修掉的三个问题：
 * 1. **拖动节点无效** —— 原实现直接 mutate `useMemo` 返回的坐标对象，而拖拽分支
 *    又提前 return，全程零 state 变更，React 根本不会重渲染。现在拖动写入
 *    `overrides` state。
 * 2. **远处节点点不中** —— 见 graph3d.ts 的 pickNode（屏幕像素判定 + 最小命中半径）。
 * 3. **每次打开布局都不一样** —— 见 graph3d.ts 的种子化布局。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { BrainGraphSnapshot, BrainGraphNode } from '@deepseek-ai/dsh-api-remotes/types'
import type { SkillStoreKey } from './locales.ts'
import {
  layoutGraph, nodeRadius, projectPoint, screenDeltaToWorld,
  makePickFrame, pickNode,
} from './graph3d.ts'
import type { Camera, P3, PickFrame, PlacedNode, Viewport } from './graph3d.ts'
import { GraphScene } from './GraphScene.tsx'
import type { ProjectedEdge, RootMarker } from './GraphScene.tsx'
import { GraphDetail } from './GraphDetail.tsx'
import { GraphLegend } from './GraphLegend.tsx'
import type { GraphNodeType } from './graph3d.ts'
import css from './KnowledgeGraph.module.css'

/** 画布逻辑尺寸（viewBox）。模块级常量，引用稳定，可安全进 useMemo 依赖。 */
const VIEWPORT: Viewport = { w: 1000, h: 680, cx: 500, cy: 340, focal: 620 }

const INITIAL_CAMERA: Camera = { yaw: -0.6, pitch: 0.35, zoom: 1, focus: { x: 0, y: 0, z: 0 } }
const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const PITCH_LIMIT = 1.2
/** 聚焦某个节点时拉近到的倍率。 */
const FOCUS_ZOOM = 1.6
const FOCUS_MS = 420
/** 超过这个位移（像素）就算拖动，不再当作点击。 */
const DRAG_SLOP_PX = 3
/** 技能簇根节点的虚拟 id。 */
const SKILL_ROOT_ID = '__skill_root__'

const ORIGIN: P3 = { x: 0, y: 0, z: 0 }

/** 缓动曲线（easeOutCubic）。 */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3
}

const ZOOM_CLAMP = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** 拖拽空白处旋转视角时的手势状态。 */
interface RotateState {
  x: number
  y: number
  yaw: number
  pitch: number
}

/** 拖动单个节点时的手势状态；`moved` 用来区分「拖动」与「点击」。 */
interface DragState {
  id: string
  x: number
  y: number
  origin: P3
  moved: boolean
}

interface Props {
  /** `this: void` 见 GraphScene 的说明。 */
  t(this: void, key: SkillStoreKey, params?: Record<string, unknown>): string
  snapshot: BrainGraphSnapshot
  skillId?: string
  onClose(this: void): void
}

export function KnowledgeGraph({ t, snapshot, skillId, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredId, setHoveredId] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA)
  const [query, setQuery] = useState('')
  const [filterType, setFilterType] = useState<GraphNodeType>()
  /** 用户拖动过的节点坐标，覆盖力导向结果。 */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, P3>>(new Map())

  const rotateRef = useRef<RotateState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number>()
  /** 与 camera 同步的镜像，供 rAF 回调读取最新值而不产生闭包过期。 */
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  /** 事件回调与 rAF 需要读最新坐标，但不想因此重建回调，所以用 ref 镜像。 */
  const positionsRef = useRef<ReadonlyMap<string, P3>>(new Map())

  useEffect(() => () => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
  }, [])

  // ---- 相机缓动：聚焦到某个世界坐标 ----
  const easeTo = useCallback((target: P3, zoom: number): void => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    const from = { ...cameraRef.current.focus }
    const fromZoom = cameraRef.current.zoom
    const begin = performance.now()
    const step = (now: number): void => {
      const p = Math.min(1, (now - begin) / FOCUS_MS)
      const k = easeOut(p)
      setCamera(prev => ({
        ...prev,
        focus: {
          x: from.x + (target.x - from.x) * k,
          y: from.y + (target.y - from.y) * k,
          z: from.z + (target.z - from.z) * k,
        },
        zoom: fromZoom + (zoom - fromZoom) * k,
      }))
      rafRef.current = p < 1 ? requestAnimationFrame(step) : undefined
    }
    rafRef.current = requestAnimationFrame(step)
  }, [])

  /** 聚焦某个节点：相机移到它身上并拉近。 */
  const focusOn = useCallback((id: string): void => {
    const p = positionsRef.current.get(id)
    if (p !== undefined) easeTo(p, FOCUS_ZOOM)
  }, [easeTo])

  // ---- 搜索 ----
  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return undefined
    const matched = new Set<string>()
    for (const n of snapshot.nodes) {
      if (n.label.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) matched.add(n.id)
    }
    return matched
  }, [query, snapshot.nodes])

  // ---- 布局：力导向 + 用户拖动覆盖 ----
  // 单技能视图额外放一个虚拟根节点在原点，作为该技能这团阅历的聚合标记。
  const baseLayout = useMemo(() => {
    const pos = layoutGraph(snapshot.nodes, snapshot.edges)
    if (skillId !== undefined && skillId !== '') pos.set(SKILL_ROOT_ID, { ...ORIGIN })
    return pos
  }, [snapshot.nodes, snapshot.edges, skillId])

  const positions = useMemo(() => {
    if (overrides.size === 0) return baseLayout
    const merged = new Map(baseLayout)
    for (const [id, p] of overrides) merged.set(id, p)
    return merged
  }, [baseLayout, overrides])

  positionsRef.current = positions

  // ---- 投影 ----
  const { placed, edges, root } = useMemo(() => {
    const out: PlacedNode[] = []
    const visible = new Set<string>()
    for (const n of snapshot.nodes) {
      if (filterType !== undefined && n.type !== filterType) continue
      const p = positions.get(n.id)
      if (p === undefined) continue
      const proj = projectPoint(p, camera, VIEWPORT)
      out.push({ id: n.id, node: n, proj, r: nodeRadius(n.type) * proj.s })
      visible.add(n.id)
    }
    const es: ProjectedEdge[] = []
    for (const e of snapshot.edges) {
      if (!visible.has(e.source) || !visible.has(e.target)) continue
      const a = positions.get(e.source)
      const b = positions.get(e.target)
      if (a === undefined || b === undefined) continue
      es.push({
        key: `${e.source}->${e.target}`,
        edge: e,
        pa: projectPoint(a, camera, VIEWPORT),
        pb: projectPoint(b, camera, VIEWPORT),
      })
    }
    // 画家算法：深度降序 = 远的先入列 = 先画 = 被近的盖住。
    out.sort((x, y) => y.proj.depth - x.proj.depth)

    // 类型筛选生效时不画簇心——它是聚合标记，不属于任何单一类型。
    let rootMark: RootMarker | null = null
    const rp = positions.get(SKILL_ROOT_ID)
    if (rp !== undefined && filterType === undefined && skillId !== undefined && skillId !== '') {
      rootMark = { label: skillId.slice(0, 10), proj: projectPoint(rp, camera, VIEWPORT) }
    }
    return { placed: out, edges: es, root: rootMark }
  }, [snapshot.nodes, snapshot.edges, positions, camera, filterType, skillId])

  const counts = useMemo(() => {
    const acc: Record<GraphNodeType, number> = { knowledge: 0, memory: 0, scene: 0 }
    for (const n of snapshot.nodes) acc[n.type] += 1
    return acc
  }, [snapshot.nodes])

  const skillTitle = skillId !== undefined && skillId !== '' ? skillId : t('graphGlobal')

  // ---- 详情：只认点击选中 ----
  // 不用 hover 驱动详情面板，理由见文件头：面板会挤压画布宽度，hover 驱动会抖动。
  // hover 仍然负责「高亮节点 + 邻居」，只是不再撑开面板。
  const detailNode: BrainGraphNode | undefined = selectedId === undefined
    ? undefined
    : placed.find(p => p.id === selectedId)?.node

  const activeId = selectedId ?? hoveredId

  const highlight = useMemo(() => {
    if (activeId === undefined) return undefined
    const ids = new Set<string>([activeId])
    for (const e of snapshot.edges) {
      if (e.source === activeId) ids.add(e.target)
      if (e.target === activeId) ids.add(e.source)
    }
    return ids
  }, [snapshot.edges, activeId])

  // ---- 事件 ----
  const frameOf = (): PickFrame | undefined => {
    const svg = svgRef.current
    return svg === null ? undefined : makePickFrame(svg, VIEWPORT)
  }

  const handleWheel = (e: ReactWheelEvent<SVGSVGElement>): void => {
    e.preventDefault()
    setCamera(c => ({ ...c, zoom: ZOOM_CLAMP(c.zoom * (e.deltaY > 0 ? 0.9 : 1.1)) }))
  }

  const handleMouseDown = (e: ReactMouseEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return
    const frame = frameOf()
    if (frame === undefined) return
    const id = pickNode(placed, frame, e.clientX, e.clientY)
    if (id !== undefined) {
      const origin = positions.get(id)
      if (origin !== undefined) {
        dragRef.current = { id, x: e.clientX, y: e.clientY, origin, moved: false }
      }
      return
    }
    // 点空白：进入旋转，并取消固定详情（在 mouseup 判定，避免拖动误清）。
    rotateRef.current = { x: e.clientX, y: e.clientY, yaw: camera.yaw, pitch: camera.pitch }
  }

  const handleMouseMove = (e: ReactMouseEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (drag !== null) {
      if (!drag.moved
        && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_SLOP_PX) return
      drag.moved = true
      const frame = frameOf()
      if (frame === undefined) return
      const s = projectPoint(drag.origin, camera, VIEWPORT).s
      const d = screenDeltaToWorld(
        (e.clientX - drag.x) / frame.scale,
        (e.clientY - drag.y) / frame.scale,
        s,
        camera,
      )
      setOverrides(prev => new Map(prev).set(drag.id, {
        x: drag.origin.x + d.x,
        y: drag.origin.y + d.y,
        z: drag.origin.z + d.z,
      }))
      return
    }
    const rot = rotateRef.current
    if (rot !== null) {
      setCamera(c => ({
        ...c,
        yaw: rot.yaw + (e.clientX - rot.x) * 0.008,
        pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rot.pitch + (e.clientY - rot.y) * 0.008)),
      }))
      return
    }
    const frame = frameOf()
    if (frame === undefined) return
    setHoveredId(pickNode(placed, frame, e.clientX, e.clientY))
  }

  const handleMouseUp = (e: ReactMouseEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (drag !== null) {
      dragRef.current = null
      if (!drag.moved) {
        // 视为点击：切换选中，并把相机缓动到该节点。
        if (selectedId === drag.id) {
          setSelectedId(undefined)
          easeTo(ORIGIN, 1)
        } else {
          setSelectedId(drag.id)
          focusOn(drag.id)
        }
      }
      return
    }
    if (rotateRef.current !== null) {
      rotateRef.current = null
      // 空白处没有产生旋转位移才算「点空白」：清掉固定详情并回到全景。
      const frame = frameOf()
      if (frame !== undefined && pickNode(placed, frame, e.clientX, e.clientY) === undefined) {
        setSelectedId(undefined)
        if (selectedId !== undefined) easeTo(ORIGIN, 1)
      }
    }
  }

  const resetView = (): void => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    setCamera(INITIAL_CAMERA)
    setSelectedId(undefined)
    setHoveredId(undefined)
    setOverrides(new Map())
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <button type="button" className={css.backBtn} onClick={onClose}>
          ← {t('graphBack')}
        </button>
        <span className={css.title}>{t('graphTitle', { title: skillTitle })}</span>
        <input
          className={css.searchInput}
          type="text"
          placeholder={t('graphSearchPlaceholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedId(undefined) }}
        />
        <span className={css.stats}>
          {t('graphNodes', { n: placed.length })}
          {' · '}
          {t('graphEdges', { m: edges.length })}
        </span>
      </header>

      {/* 画布与详情右栏平级排列：面板出现时画布让出宽度，而不是被面板盖住。 */}
      <div className={css.body}>
        <div className={css.canvasWrap}>
          <GraphScene
            svgRef={svgRef}
            viewport={VIEWPORT}
            placed={placed}
            edges={edges}
            root={root}
            hoveredId={hoveredId}
            selectedId={selectedId}
            highlight={highlight}
            searchMatches={searchMatches}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />

          <div className={css.viewControls}>
            <button
              type="button" className={css.viewBtn}
              onClick={() => { setCamera(c => ({ ...c, zoom: ZOOM_CLAMP(c.zoom * 1.25) })) }}
              title={t('graphZoomIn')}
            >+</button>
            <button
              type="button" className={css.viewBtn}
              onClick={() => { setCamera(c => ({ ...c, zoom: ZOOM_CLAMP(c.zoom * 0.8) })) }}
              title={t('graphZoomOut')}
            >−</button>
            <button type="button" className={css.viewBtn} onClick={resetView} title={t('graphReset')}>⟲</button>
          </div>

          <div className={css.hint}>{t('graphRotateHint')}</div>

          <GraphLegend active={filterType} counts={counts} t={t} onToggle={setFilterType} />
        </div>

        {detailNode !== undefined && (
          <GraphDetail node={detailNode} t={t} onClose={() => { setSelectedId(undefined) }} />
        )}
      </div>
    </div>
  )
}
