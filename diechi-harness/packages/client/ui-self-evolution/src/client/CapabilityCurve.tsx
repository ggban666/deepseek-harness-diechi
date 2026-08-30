/**
 * C(t) / K(t) 历史曲线（Canvas）。
 *
 * 关键语义：曲线只画**历史快照**（committed capability_snapshots），不把当前的
 * 实时估计接到末尾。因为 current C(t) 来自体感样本，而 committed 点来自 CBS
 * 跑分，两者混接会在没有样本时画出一条「从 0.75 跌到 0」的虚假退步线。
 *
 * 当前值由面板的数字卡和图例承担，曲线只负责展示时间序列。
 */
import { useEffect, useRef } from 'react'
import type { EvolutionHistoryPoint } from './types.ts'
import css from './CapabilityCurve.module.css'

/** 绘制区高度（px）。 */
const HEIGHT = 180
/** 内边距。 */
const PAD = { top: 14, right: 12, bottom: 22, left: 34 }

const COLOR = {
  grid: 'rgba(128, 128, 128, 0.22)',
  axis: 'rgba(128, 128, 128, 0.55)',
  capability: '#4a9eff',
  capabilityArea: 'rgba(74, 158, 255, 0.12)',
  cost: '#f5a623',
  costArea: 'rgba(245, 166, 35, 0.10)',
  band: 'rgba(245, 166, 35, 0.13)',
  hardMax: 'rgba(232, 74, 74, 0.85)',
  placeholder: 'rgba(128, 128, 128, 0.25)',
}

/** 曲线入参。 */
export interface CapabilityCurveProps {
  readonly history: readonly EvolutionHistoryPoint[]
  readonly bandLo: number
  readonly bandHi: number
  readonly hardMax: number
}

/** 把历史快照画成两条线 + 成本软带 + 硬顶红线。 */
export function CapabilityCurve({
  history, bandLo, bandHi, hardMax,
}: CapabilityCurveProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const parent = canvas.parentElement
    if (parent === null) return

    const draw = (): void => {
      const width = parent.clientWidth
      if (width <= 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(HEIGHT * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${HEIGHT}px`

      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, HEIGHT)

      const plotW = width - PAD.left - PAD.right
      const plotH = HEIGHT - PAD.top - PAD.bottom
      if (plotW <= 0 || plotH <= 0) return

      // 坐标映射：C 固定 0~1，K 的上界取「硬顶」与「历史最高」的较大者，
      // 这样硬顶线永远在画面内——一条画不出来的红线等于没有红线。
      const kValues = [...history.map(p => p.k), bandHi, hardMax]
      const kTop = Math.max(...kValues, 1) * 1.15
      const hasHistory = history.length > 0
      const xAt = (i: number, n: number): number =>
        PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
      const yC = (v: number): number => PAD.top + (1 - clamp01(v)) * plotH
      const yK = (v: number): number => PAD.top + (1 - clamp(v / kTop)) * plotH

      // 网格：三条水平线（0 / 0.5 / 1 的能力刻度）
      ctx.strokeStyle = COLOR.grid
      ctx.lineWidth = 1
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillStyle = COLOR.axis
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const ratio of [0, 0.5, 1]) {
        const y = PAD.top + (1 - ratio) * plotH
        ctx.beginPath()
        ctx.moveTo(PAD.left, y)
        ctx.lineTo(PAD.left + plotW, y)
        ctx.stroke()
        ctx.fillText(ratio.toFixed(1), PAD.left - 6, y)
      }

      // 成本软带（先画，作为背景层）
      ctx.fillStyle = COLOR.band
      const bandTop = yK(bandHi)
      const bandBottom = yK(bandLo)
      ctx.fillRect(PAD.left, bandTop, plotW, Math.max(1, bandBottom - bandTop))

      // 硬顶红线（A2 的绝对约束）
      ctx.strokeStyle = COLOR.hardMax
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(PAD.left, yK(hardMax))
      ctx.lineTo(PAD.left + plotW, yK(hardMax))
      ctx.stroke()
      ctx.setLineDash([])

      // 无历史时画一条占位虚线，避免图区空白得像个 bug
      if (!hasHistory) {
        ctx.strokeStyle = COLOR.placeholder
        ctx.setLineDash([3, 4])
        ctx.lineWidth = 1
        ctx.beginPath()
        const midY = PAD.top + plotH / 2
        ctx.moveTo(PAD.left, midY)
        ctx.lineTo(PAD.left + plotW, midY)
        ctx.stroke()
        ctx.setLineDash([])
        return
      }

      // K(t)：历史曲线
      const kPoints = history.map(p => p.k)
      drawArea(ctx, kPoints, xAt, yK, plotH, COLOR.costArea)
      ctx.strokeStyle = COLOR.cost
      ctx.lineWidth = 2
      ctx.beginPath()
      kPoints.forEach((value, i) => {
        const x = xAt(i, kPoints.length)
        const y = yK(value)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // C(t)：历史曲线
      const cPoints = history.map(p => p.c)
      drawArea(ctx, cPoints, xAt, yC, plotH, COLOR.capabilityArea)
      ctx.strokeStyle = COLOR.capability
      ctx.lineWidth = 2
      ctx.beginPath()
      cPoints.forEach((value, i) => {
        const x = xAt(i, cPoints.length)
        const y = yC(value)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // 历史点的端点高亮
      drawDot(ctx, xAt(cPoints.length - 1, cPoints.length), yC(cPoints[cPoints.length - 1]), COLOR.capability)
      drawDot(ctx, xAt(kPoints.length - 1, kPoints.length), yK(kPoints[kPoints.length - 1]), COLOR.cost)
    }

    draw()
    const observer = new ResizeObserver(() => draw())
    observer.observe(parent)
    return () => observer.disconnect()
  }, [history, bandLo, bandHi, hardMax])

  return (
    <div className={css.wrap}>
      <canvas ref={canvasRef} className={css.canvas} />
    </div>
  )
}

/** 绘制带光晕的当前点。 */
function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  ctx.beginPath()
  ctx.arc(x, y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** 曲线下方的半透明填充区域。 */
function drawArea(
  ctx: CanvasRenderingContext2D,
  values: number[],
  xAt: (i: number, n: number) => number,
  yAt: (v: number) => number,
  plotH: number,
  color: string,
): void {
  if (values.length < 2) return
  const bottom = PAD.top + plotH
  ctx.fillStyle = color
  ctx.beginPath()
  values.forEach((value, i) => {
    const x = xAt(i, values.length)
    const y = yAt(value)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.lineTo(xAt(values.length - 1, values.length), bottom)
  ctx.lineTo(xAt(0, values.length), bottom)
  ctx.closePath()
  ctx.fill()
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v))
}
