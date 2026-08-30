/**
 * 知识图谱的 3D 数学层：力导向布局、透视投影、屏幕命中测试。
 *
 * 这一层是**纯函数、无 React、无 DOM 依赖**（命中测试只吃外部传进来的 rect），
 * 因此可以单测，也不会被组件的重渲染节奏拖累。
 *
 * 相比最初内联在 KnowledgeGraph.tsx 里的版本，这里修了三个正确性问题：
 *
 * 1. **布局可复现**：初始化改用种子随机（mulberry32 + FNV-1a 数据指纹），
 *    相同数据每次算出同一份坐标。原来用 `Math.random()`，配合外层对 snapshot
 *    的对象引用依赖，导致 15s 轮询一来整图重新洗牌——图谱类界面最忌讳这个，
 *    用户建立不了空间记忆。
 * 2. **命中测试按屏幕像素判定**：原来把客户端坐标换算到 viewBox 后直接
 *    和节点半径比大小，既没考虑 `preserveAspectRatio` 的留边偏移，也没给远处
 *    小节点兜底半径——远处的点几乎点不中。现在统一在屏幕像素空间判定，
 *    并按「距离 / 命中半径」的比值排序，而不是绝对距离。
 * 3. **力导向去掉热循环里的哈希查找**：原来 O(n²) 斥力每对做 4 次 `Map.get`。
 *    现在每个节点是一个 Body 对象，边预先解析成 Body 直连引用，
 *    内层循环全是对象属性读写。
 *
 * 注意：本仓开了 `noUncheckedIndexedAccess`，且 `src/**` 禁用非空断言
 * （.oxlintrc.json 里 `typescript/no-non-null-assertion: error`），
 * 所以热循环一律用 `for...of` / `.entries()` 取值，不写 `arr[i]!`。
 */
import type {
  BrainGraphNode, BrainGraphEdge,
} from '@deepseek-ai/dsh-api-remotes/types'

/** 世界坐标点。 */
export interface P3 {
  x: number
  y: number
  z: number
}

/**
 * 节点类型联合。从 BrainGraphNode 派生而不是直接引 `GraphNodeType`——
 * 后者没有被 `@deepseek-ai/dsh-api-remotes/types` 再导出，为它去改 API 包
 * 不值得（会牵动 remotes 的浏览器 bundle 重建，是为数不多会静默失败的坑）。
 */
export type GraphNodeType = BrainGraphNode['type']

/** 相机：绕 Y 轴偏航、绕 X 轴俯仰、缩放、以及**注视点**（聚焦节点时平移用）。 */
export interface Camera {
  yaw: number
  pitch: number
  zoom: number
  focus: P3
}

/** 画布视口（viewBox 尺寸 + 中心 + 透视焦距）。 */
export interface Viewport {
  readonly w: number
  readonly h: number
  readonly cx: number
  readonly cy: number
  readonly focal: number
}

/** 投影结果：屏幕坐标 + 透视缩放 + 旋转后深度。 */
export interface Projected {
  readonly x: number
  readonly y: number
  /** 透视缩放因子（>1 靠近相机）。 */
  readonly s: number
  /** 旋转后深度，用于画家算法排序与雾化。 */
  readonly depth: number
}

/** 一个已投影、可参与命中测试的节点。 */
export interface PlacedNode {
  readonly id: string
  readonly node: BrainGraphNode
  readonly proj: Projected
  /** 屏幕半径（已乘透视缩放）。 */
  readonly r: number
}

const ZERO: P3 = { x: 0, y: 0, z: 0 }

// ---------------------------------------------------------------------------
// 节点几何常量
// ---------------------------------------------------------------------------

/** 节点基础半径（按类型区分信息层级）。 */
export function nodeRadius(type: GraphNodeType): number {
  return type === 'knowledge' ? 15 : type === 'memory' ? 12 : 10
}

/** 命中测试的最小屏幕半径（像素）。远处节点透视后可能只有几个像素，必须兜底。 */
const MIN_HIT_PX = 13
/** 命中容差（像素）：允许略微偏离球心。 */
const HIT_SLOP_PX = 4

// ---------------------------------------------------------------------------
// 力导向布局
// ---------------------------------------------------------------------------

/** 物理参数（调过的值，别乱动；改之前先想清楚对「同技能聚团」的影响）。 */
const REPULSION = 320_000
const ATTRACTION = 0.02
const CLUSTER_PULL = 0.012
const MAX_STEP = 22
/** 簇中心所在球面半径。 */
const CLUSTER_RADIUS = 300
/** 簇内初始散布半径区间。 */
const SCATTER_MIN = 70
const SCATTER_RANGE = 50
/** 黄金角，用于把簇中心均匀铺在球面上。 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** 参与模拟的一个质点：位置 + 本轮受力 + 所属簇中心。 */
interface Body extends P3 {
  fx: number
  fy: number
  fz: number
  /** 所属簇的中心，直接持引用，避免每轮再查表。 */
  readonly center: P3
}

/** 一条已解析成 Body 直连引用的边。 */
interface Link {
  readonly a: Body
  readonly b: Body
  readonly w: number
}

/** 32 位整数哈希（FNV-1a），用于把节点集合压成一个稳定种子。 */
function mixString(h: number, s: string): number {
  let acc = h
  for (let i = 0; i < s.length; i++) {
    acc ^= s.charCodeAt(i)
    acc = Math.imul(acc, 0x01000193)
  }
  return acc
}

/**
 * 数据指纹：节点 id + 边端点+权重 → 种子。
 * 节点集合不变时种子不变 → 布局不变；数据真的变了才重新排布。
 */
function dataSeed(nodes: readonly BrainGraphNode[], edges: readonly BrainGraphEdge[]): number {
  let h = 0x811c9dc5
  for (const n of nodes) h = mixString(h, n.id)
  for (const e of edges) h = mixString(h, `${e.source}>${e.target}:${e.weight}`)
  return h >>> 0
}

/** mulberry32：小而快的种子 PRNG，保证同一节点集合每次打开位置一致。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface LayoutOptions {
  /** 迭代次数。默认 320，节点多时可下调。 */
  iterations?: number
}

/**
 * 3D 力导向布局。
 *
 * 初始化按技能分簇：同 `skillId` 的阅历是一团（簇中心沿黄金角球面铺开，
 * 未归位的 `''` 放原点），簇内节点小半径散布。迭代中除了斥力/引力，
 * 还额外加一项**簇锚定**把节点拉回自己的簇中心，避免团块互相漂散。
 *
 * @returns 节点 id → 世界坐标
 */
export function layoutGraph(
  nodes: readonly BrainGraphNode[],
  edges: readonly BrainGraphEdge[],
  options: LayoutOptions = {},
): Map<string, P3> {
  const result = new Map<string, P3>()
  if (nodes.length === 0) return result

  const iterations = options.iterations ?? 320
  const rand = mulberry32(dataSeed(nodes, edges))

  // ---- 簇中心：非 '' 簇沿黄金角球面铺开，'' 簇留在原点 ----
  const centers = new Map<string, P3>()
  for (const node of nodes) {
    if (!centers.has(node.skillId)) centers.set(node.skillId, { x: 0, y: 0, z: 0 })
  }
  const spreadCount = [...centers.keys()].filter(id => id !== '').length
  let placed = 0
  for (const [id, center] of centers) {
    if (id === '') continue
    const y = 1 - (placed / Math.max(1, spreadCount - 1)) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = GOLDEN_ANGLE * placed
    center.x = CLUSTER_RADIUS * ring * Math.cos(theta)
    center.y = CLUSTER_RADIUS * y
    center.z = CLUSTER_RADIUS * ring * Math.sin(theta)
    placed += 1
  }

  // ---- 质点初始化：围绕各自簇中心小半径散布 ----
  const bodies: Body[] = []
  for (const node of nodes) {
    const center = centers.get(node.skillId) ?? ZERO
    const a = rand() * Math.PI * 2
    const b = Math.acos(2 * rand() - 1)
    const r = SCATTER_MIN + rand() * SCATTER_RANGE
    bodies.push({
      x: center.x + r * Math.sin(b) * Math.cos(a),
      y: center.y + r * Math.sin(b) * Math.sin(a),
      z: center.z + r * Math.cos(b),
      fx: 0, fy: 0, fz: 0,
      center,
    })
  }

  // ---- 边预解析为 Body 直连引用（端点缺失的边直接丢弃）----
  const indexOf = new Map<string, number>()
  for (const [i, node] of nodes.entries()) indexOf.set(node.id, i)
  const links: Link[] = []
  for (const e of edges) {
    const ai = indexOf.get(e.source)
    const bi = indexOf.get(e.target)
    if (ai === undefined || bi === undefined) continue
    const a = bodies[ai]
    const b = bodies[bi]
    if (a === undefined || b === undefined) continue
    links.push({ a, b, w: e.weight })
  }

  // ---- 迭代 ----
  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations
    for (const body of bodies) {
      body.fx = 0
      body.fy = 0
      body.fz = 0
    }

    // 斥力：所有节点对
    for (const [i, a] of bodies.entries()) {
      let ax = a.fx
      let ay = a.fy
      let az = a.fz
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]
        if (b === undefined) continue
        const dx = a.x - b.x
        const dy = a.y - b.y
        const dz = a.z - b.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        const f = REPULSION / (dist * dist * dist)
        const ux = dx * f
        const uy = dy * f
        const uz = dz * f
        ax += ux
        ay += uy
        az += uz
        b.fx -= ux
        b.fy -= uy
        b.fz -= uz
      }
      a.fx = ax
      a.fy = ay
      a.fz = az
    }

    // 引力：共享关键词的节点对
    for (const link of links) {
      const dx = link.b.x - link.a.x
      const dy = link.b.y - link.a.y
      const dz = link.b.z - link.a.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const f = (dist * ATTRACTION * link.w) / dist
      const ux = dx * f
      const uy = dy * f
      const uz = dz * f
      link.a.fx += ux
      link.a.fy += uy
      link.a.fz += uz
      link.b.fx -= ux
      link.b.fy -= uy
      link.b.fz -= uz
    }

    // 簇锚定 + 施加位移（限步长，避免早期炸开）
    for (const body of bodies) {
      body.fx += (body.center.x - body.x) * CLUSTER_PULL
      body.fy += (body.center.y - body.y) * CLUSTER_PULL
      body.fz += (body.center.z - body.z) * CLUSTER_PULL

      const len = Math.sqrt(body.fx ** 2 + body.fy ** 2 + body.fz ** 2) || 1
      const step = Math.min(len, MAX_STEP) * temp
      body.x += (body.fx / len) * step
      body.y += (body.fy / len) * step
      body.z += (body.fz / len) * step
    }
  }

  for (const [i, body] of bodies.entries()) {
    const node = nodes[i]
    if (node === undefined) continue
    result.set(node.id, { x: body.x, y: body.y, z: body.z })
  }
  return result
}

// ---------------------------------------------------------------------------
// 投影
// ---------------------------------------------------------------------------

/**
 * 3D → 屏幕：先减去注视点（聚焦），再绕 Y 轴（yaw）、绕 X 轴（pitch）旋转，
 * 最后透视投影。深度 `z2` 用于画家算法排序和雾化衰减。
 */
export function projectPoint(p: P3, cam: Camera, vp: Viewport): Projected {
  const cosY = Math.cos(cam.yaw)
  const sinY = Math.sin(cam.yaw)
  const cosP = Math.cos(cam.pitch)
  const sinP = Math.sin(cam.pitch)
  const ox = p.x - cam.focus.x
  const oy = p.y - cam.focus.y
  const oz = p.z - cam.focus.z
  const x1 = ox * cosY + oz * sinY
  const z1 = -ox * sinY + oz * cosY
  const y1 = oy * cosP - z1 * sinP
  const z2 = oy * sinP + z1 * cosP
  const s = cam.zoom * (vp.focal / (vp.focal + z2))
  return { x: vp.cx + x1 * s, y: vp.cy + y1 * s, s, depth: z2 }
}

/**
 * 把屏幕上的位移换算成世界坐标位移。
 *
 * 相机基向量由 projectPoint 的旋转式解出：
 * - right = (cosY, 0, sinY)
 * - up    = (sinY·sinP, cosP, −cosY·sinP)
 * 先除掉透视缩放回到相机平面，再沿这两个基向量还原到世界空间。
 * （原来那版是拍脑袋的近似，斜着看视角时拖动手感会明显跑偏。）
 */
export function screenDeltaToWorld(
  dxScreen: number, dyScreen: number, s: number, cam: Camera,
): P3 {
  const cosY = Math.cos(cam.yaw)
  const sinY = Math.sin(cam.yaw)
  const cosP = Math.cos(cam.pitch)
  const sinP = Math.sin(cam.pitch)
  const right = { x: cosY, y: 0, z: sinY }
  const up = { x: sinY * sinP, y: cosP, z: -cosY * sinP }
  const a = dxScreen / s
  const b = dyScreen / s
  return {
    x: right.x * a + up.x * b,
    y: right.y * a + up.y * b,
    z: right.z * a + up.z * b,
  }
}

// ---------------------------------------------------------------------------
// 命中测试
// ---------------------------------------------------------------------------

/**
 * `preserveAspectRatio="xMidYMid meet"`（SVG 默认）会等比缩放并居中留边，
 * 直接按 `rect.width / viewBox.width` 换算在宽高比不匹配时整体偏移。
 * 这里把缩放和留边一起算准，屏幕坐标换算才有意义。
 */
export interface PickFrame {
  readonly rect: DOMRect
  /** 屏幕像素 / viewBox 单位。 */
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

export function makePickFrame(svg: SVGSVGElement, vp: Viewport): PickFrame {
  const rect = svg.getBoundingClientRect()
  const scale = Math.min(rect.width / vp.w, rect.height / vp.h) || 1
  return {
    rect,
    scale,
    offsetX: (rect.width - vp.w * scale) / 2,
    offsetY: (rect.height - vp.h * scale) / 2,
  }
}

/** 客户端坐标 → viewBox 坐标。 */
export function toViewBox(
  frame: PickFrame, clientX: number, clientY: number,
): { x: number; y: number } {
  return {
    x: (clientX - frame.rect.left - frame.offsetX) / frame.scale,
    y: (clientY - frame.rect.top - frame.offsetY) / frame.scale,
  }
}

/**
 * 拾取光标下的节点。
 *
 * 判据是**比值**而非绝对距离：命中的优先级 = 距离 / 命中半径，
 * 命中半径 = max(屏幕半径, MIN_HIT_PX) + 容差。这样远处被透视缩小到
 * 几个像素的节点，只要光标压在中心就能选中，不会被近处的大节点抢走。
 * 比值相同时深度浅（离相机近）的赢。
 */
export function pickNode(
  placed: readonly PlacedNode[], frame: PickFrame, clientX: number, clientY: number,
): string | undefined {
  const local = toViewBox(frame, clientX, clientY)
  let bestId: string | undefined
  let bestScore = Infinity
  let bestDepth = Infinity
  for (const item of placed) {
    const rPx = Math.max(item.r * frame.scale, MIN_HIT_PX) + HIT_SLOP_PX
    const dx = (item.proj.x - local.x) * frame.scale
    const dy = (item.proj.y - local.y) * frame.scale
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > rPx) continue
    const score = dist / rPx
    if (score < bestScore - 1e-6) {
      bestScore = score
      bestDepth = item.proj.depth
      bestId = item.id
    } else if (score < bestScore + 1e-6 && item.proj.depth < bestDepth) {
      bestDepth = item.proj.depth
      bestId = item.id
    }
  }
  return bestId
}
