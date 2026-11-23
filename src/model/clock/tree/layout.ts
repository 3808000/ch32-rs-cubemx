// 时钟树 SVG 布局（纯函数）：把逻辑模型（节点 / 连线 / 分组）映射为画布坐标，
// 输出节点位置、正交连线折线与分组容器。列位置完全由数据推导，禁止按芯片名分支。
// M16：kind 簇尺寸（PRIM 常量，渲染共用）；有 clock.json.diagram → 数据坐标优先；
// 无 diagram → M15 列式回退（列内 y 行距=簇高+32，列距按簇宽自适应、最小 200）。
// 走线统一为通用正交避障路由：走廊/通道错开（M15 机制）+ lanes hint 优先 + 不穿任何簇矩形。
import type { ClockConfig, ClockData, ClockFrequencies, ClockIssue } from '@/model/types'
import {
  buildClockModel,
  type ClockEdgeModel,
  type ClockGroupModel,
  type ClockNodeModel,
  type PeripheralClockContext,
} from './model'

export interface ClockPt {
  x: number
  y: number
}

/** 带坐标的时钟树节点（逻辑内容 + 几何字段） */
export interface ClockTreeNode extends ClockNodeModel {
  x: number
  y: number
  w: number
  h: number
}

/** 带折线点集的时钟树连线（逻辑内容 + 几何字段） */
export interface ClockTreeEdge extends ClockEdgeModel {
  /** 正交折线点集 */
  points: ClockPt[]
  labelAt: ClockPt
}

/** 带坐标的分组容器（逻辑内容 + 几何字段） */
export interface ClockTreeGroup extends ClockGroupModel {
  x: number
  y: number
  w: number
  h: number
}

export interface ClockTreeLayout {
  width: number
  height: number
  nodes: ClockTreeNode[]
  edges: ClockTreeEdge[]
  groups: ClockTreeGroup[]
}

// ---------- D1 图元尺寸（契约逐字；渲染层与布局共用） ----------

export const PRIM = {
  OSC_W: 96,
  OSC_H: 44,
  MUX_W: 84,
  MUX_ROW: 16,
  MUX_PAD: 12,
  READOUT_W: 104,
  READOUT_H: 44,
  CLUSTER_GAP: 12,
  DIV_W: 96,
  DIV_H: 44,
  STEP_W: 72,
  STEP_H: 32,
  PERI_W: 190,
  PERI_H: 96,
} as const

// ---------- 列式回退常量（无 diagram 时使用） ----------

/** 列起点 / 行起点（M15 语义保留） */
const X0 = 40
const Y0 = 60
/** 列距下限：仍保持 x=40+column*200 的既有节奏（宽簇按实际宽度扩张） */
const COL_MIN_DX = 200
const COL_GAP = 40
/** 同列节点行距：簇高 + 32 */
const ROW_GAP = 32
/** 分组框留白：顶部 30（分组标签）、左右 16（列间留 8px 间隙）、底部 18 */
const GROUP_PAD_TOP = 30
const GROUP_PAD_X = 16
const GROUP_PAD_BOTTOM = 18
/** 同一走廊/通道内多条走线的错开步长（M15 机制） */
const LANE_STEP = 12
const LANE_SLOTS = 3
/** 障碍重合判定的半像素容差（端点在簇边界上不算穿越） */
const EPS = 0.5
/** 极端绕行余量（画布外走线，保证总有可行正交路径） */
const DETOUR = 20

interface Size {
  w: number
  h: number
}

function muxRows(node: ClockNodeModel): number {
  return Math.max(1, node.muxInputs?.length ?? 1)
}

/** PLL 簇的参数 stepper 数量（PLL 节点来自 spec.pll.params；aux PLL 无参数） */
function pllStepCount(spec: ClockData, node: ClockNodeModel): number {
  return node.id === 'PLL' ? (spec.pll?.params.length ?? 0) : 0
}

/**
 * kind → 簇宽高（D1）：
 * - osc/readout/peri 固定；readout 带 hint 行 +16；
 * - mux = mux 竖块 + gap + 读数卡；竖块高 = MUX_PAD*2 + 输入行数*MUX_ROW；
 * - pll = mux + 参数 stepper 链（每个 STEP_W，块间 CLUSTER_GAP）+ 读数卡；
 * - div = stepper + gap + 读数卡。
 */
export function clusterSize(spec: ClockData, node: ClockNodeModel | ClockTreeNode): Size {
  switch (node.kind) {
    case 'osc':
      return { w: PRIM.OSC_W, h: PRIM.OSC_H }
    case 'mux': {
      const muxH = PRIM.MUX_PAD * 2 + muxRows(node) * PRIM.MUX_ROW
      return { w: PRIM.MUX_W + PRIM.CLUSTER_GAP + PRIM.READOUT_W, h: Math.max(muxH, PRIM.READOUT_H) }
    }
    case 'pll': {
      const steps = pllStepCount(spec, node)
      const blocks = steps + 2 // mux + steps + readout
      const w = PRIM.MUX_W + steps * PRIM.STEP_W + PRIM.READOUT_W + PRIM.CLUSTER_GAP * (blocks - 1)
      const muxH = PRIM.MUX_PAD * 2 + muxRows(node) * PRIM.MUX_ROW
      return { w, h: Math.max(muxH, PRIM.STEP_H, PRIM.READOUT_H) }
    }
    case 'div':
      return { w: PRIM.DIV_W + PRIM.CLUSTER_GAP + PRIM.READOUT_W, h: Math.max(PRIM.DIV_H, PRIM.READOUT_H) }
    case 'readout':
      return { w: PRIM.READOUT_W, h: PRIM.READOUT_H + (node.hint && node.readoutText === undefined ? 16 : 0) }
    case 'peri':
      return { w: PRIM.PERI_W, h: PRIM.PERI_H }
  }
}

// ---------- D2 锚点 ----------

/** 输出锚点：所有 kind 均为簇右中（mux/pll/div 的读数卡垂直居中于簇，故等价读数卡右中）。 */
export function anchorOut(node: ClockTreeNode): ClockPt {
  return { x: node.x + node.w, y: node.y + node.h / 2 }
}

/**
 * 输入锚点：mux/pll = 左缘指定输入行，缺省按来源 ID 查找（含仅显示灰行）；
 * 其它 kind（osc/div/readout/peri）= 左中。
 */
export function anchorIn(node: ClockTreeNode, fromId?: string, inputIndex?: number): ClockPt {
  if ((node.kind === 'mux' || node.kind === 'pll') && node.muxInputs?.length) {
    const i = inputIndex ?? node.muxInputs.indexOf(fromId ?? '')
    if (i >= 0 && i < node.muxInputs.length) {
      return { x: node.x, y: node.y + PRIM.MUX_PAD + i * PRIM.MUX_ROW + PRIM.MUX_ROW / 2 }
    }
  }
  return { x: node.x, y: node.y + node.h / 2 }
}

// ---------- 正交路由 ----------

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 线段是否穿过矩形内部（严格内部；贴边/端点不算）。 */
function segmentHitsRect(a: ClockPt, b: ClockPt, r: Rect): boolean {
  if (a.y === b.y) {
    if (a.y <= r.y + EPS || a.y >= r.y + r.h - EPS) return false
    const lo = Math.min(a.x, b.x)
    const hi = Math.max(a.x, b.x)
    return Math.min(hi, r.x + r.w) - Math.max(lo, r.x) > EPS
  }
  if (a.x === b.x) {
    if (a.x <= r.x + EPS || a.x >= r.x + r.w - EPS) return false
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    return Math.min(hi, r.y + r.h) - Math.max(lo, r.y) > EPS
  }
  return true
}

function pathClear(points: ClockPt[], rects: Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    for (const r of rects) {
      if (segmentHitsRect(a, b, r)) return false
    }
  }
  return true
}

/** 去掉重复点与共线中间点（保持正交折线形状） */
function simplify(pts: ClockPt[]): ClockPt[] {
  const out: ClockPt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    out.push(p)
  }
  const res: ClockPt[] = []
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const a = out[i - 1]!
      const b = out[i]!
      const c = out[i + 1]!
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue
    }
    res.push(out[i]!)
  }
  return res
}

/** 计算连线标签位置：取最后一段的中点，水平段在上方、垂直段在右侧。 */
function labelPos(points: ClockPt[], label?: string): ClockPt {
  const n = points.length
  if (n < 2) return { x: points[0]!.x + 8, y: points[0]!.y - 8 }
  const a = points[n - 2]!
  const b = points[n - 1]!
  if (a.y === b.y) {
    const labelWidth = (label?.length ?? 0) * 5
    const prev = points[n - 3]
    if (Math.abs(b.x - a.x) < labelWidth && prev?.x === a.x) {
      return { x: a.x + labelWidth / 2 + 6, y: (prev.y + a.y) / 2 }
    }
    return { x: (a.x + b.x) / 2, y: a.y - 7 }
  }
  return { x: a.x + 8, y: (a.y + b.y) / 2 }
}

/** 走廊错开档位（-12 / 0 / +12 循环），保证同走廊多条走线不重叠。 */
function laneOffset(used: number): number {
  return ((used % LANE_SLOTS) - 1) * LANE_STEP
}

function uniqOffsets(first: number): number[] {
  const base = [0, LANE_STEP, -LANE_STEP, LANE_STEP * 2, -LANE_STEP * 2, LANE_STEP * 3, -LANE_STEP * 3]
  return [first, ...base.filter((o) => o !== first)]
}

interface RouteCtx {
  rects: Rect[]
  minX: number
  maxX: number
  minY: number
  maxY: number
  corridorUse: Map<number, number>
  channelUse: Map<number, number>
  lanes?: Record<string, number>
  routed: ClockTreeEdge[]
}

/** 只复用同源走廊。不同输出端口允许十字交越，不能共用一段线。 */
export function sharesForeignSegment(points: readonly ClockPt[], from: string, routed: readonly ClockTreeEdge[]): boolean {
  return routed.some((edge) => edge.from !== from && points.slice(1).some((b, i) => {
    const a = points[i]!
    const horizontal = a.y === b.y
    const axis = horizontal ? 'x' : 'y'
    const lane = horizontal ? 'y' : 'x'
    return edge.points.slice(1).some((d, j) => {
      const c = edge.points[j]!
      return a[lane] === c[lane] && a[lane] === d[lane]
        && Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
          > Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
    })
  }))
}

/** 异源的横线和竖线相交，即使只在其中一条线的端点接触也会造成误读。 */
export function crossesForeignWire(points: readonly ClockPt[], from: string, routed: readonly ClockTreeEdge[]): boolean {
  const between = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)
  return routed.some((edge) => edge.from !== from && points.slice(1).some((b, i) => {
    const a = points[i]!
    return edge.points.slice(1).some((d, j) => {
      const c = edge.points[j]!
      if (a.y === b.y && c.x === d.x && c.y !== d.y) {
        return between(c.x, a.x, b.x) && between(a.y, c.y, d.y)
      }
      return a.x === b.x && a.y !== b.y && c.y === d.y
        && between(a.x, c.x, d.x) && between(c.y, a.y, b.y)
    })
  }))
}

/** 接入缓冲直线（M16 用户裁决）：锚点外先走一段垂直于框边的直线再进走廊，
 *  末段必须水平垂直进入左缘锚点（不得竖线贴框边擦行）。 */
const STUB = 14
const MIN_STUB = 10
/** 走廊/通道与簇边界最小间距：竖/横段不得贴框边擦行 */
const GRAZE = 3

/** 擦边判定：线段与某簇左/右（竖段）或上/下（横段）边界重合且范围相交 → 拒绝。 */
function grazes(points: ClockPt[], rects: Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    for (const r of rects) {
      if (a.x === b.x) {
        if (Math.abs(a.x - r.x) < GRAZE || Math.abs(a.x - (r.x + r.w)) < GRAZE) {
          if (Math.min(Math.max(a.y, b.y), r.y + r.h) - Math.max(Math.min(a.y, b.y), r.y) > EPS) return true
        }
      } else if (a.y === b.y) {
        if (Math.abs(a.y - r.y) < GRAZE || Math.abs(a.y - (r.y + r.h)) < GRAZE) {
          if (Math.min(Math.max(a.x, b.x), r.x + r.w) - Math.max(Math.min(a.x, b.x), r.x) > EPS) return true
        }
      }
    }
  }
  return false
}

/** 通用正交避障路由：缓冲直线 + 垂直进入 + 走廊/通道错开 + 擦边拒绝 + 极端绕行兜底。 */
function routeEdge(a: ClockTreeNode, b: ClockTreeNode, edge: ClockEdgeModel, ctx: RouteCtx): ClockPt[] {
  const p0 = anchorOut(a)
  const p1 = anchorIn(b, a.id, edge.inputIndex)
  // 缓冲段：出锚点右行 STUB、入锚点左行 STUB（均垂直于框边）
  const s0: ClockPt = { x: p0.x + STUB, y: p0.y }
  const s1: ClockPt = { x: p1.x - STUB, y: p1.y }
  let crossingFallback: ClockPt[] | null = null
  const tryPath = (pts: ClockPt[]): ClockPt[] | null => {
    const p = simplify(pts)
    if (p.length > 2 && (Math.abs(p[1]!.x - p0.x) < MIN_STUB || Math.abs(p1.x - p.at(-2)!.x) < MIN_STUB)) return null
    if (!pathClear(p, ctx.rects) || grazes(p, ctx.rects)) return null
    if (!sharesForeignSegment(p, a.id, ctx.routed) && !crossesForeignWire(p, a.id, ctx.routed)) return p
    crossingFallback ??= p
    return null
  }

  // 1) 同 y 水平直连（两端天然垂直于框边）
  if (p0.y === p1.y) {
    const p = tryPath([p0, p1])
    if (p) return p
  }

  // 输出到多个下游时，优先从同一竖线分叉。两端保留缓冲，复用段必须仍能避开节点和异源线。
  for (const previous of ctx.routed) {
    if (previous.from !== a.id || previous.points.length < 4) continue
    const mx = previous.points[1]!.x
    if (mx - p0.x < MIN_STUB || p1.x - mx < MIN_STUB) continue
    const p = tryPath([p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1])
    if (p) return p
  }

  // 2) 缓冲 L（末段水平垂直进入左缘）
  for (const pts of [
    [p0, s0, { x: s1.x, y: s0.y }, s1, p1],
    [p0, s0, { x: s0.x, y: s1.y }, s1, p1],
  ]) {
    const p = tryPath(pts as ClockPt[])
    if (p) return p
  }

  const hint = ctx.lanes?.[edge.id]
  // 3) H-V-H：竖向走两簇之间走廊（缓冲段之间）
  const rightOfA = a.x + a.w
  const leftOfB = b.x
  let baseMx: number
  if (leftOfB >= rightOfA) baseMx = (rightOfA + leftOfB) / 2
  else if (a.x >= b.x + b.w) baseMx = (b.x + b.w + a.x) / 2
  else baseMx = Math.max(rightOfA, b.x + b.w) + DETOUR
  const corridorKey = Math.round(baseMx)
  const autoX = laneOffset(ctx.corridorUse.get(corridorKey) ?? 0)
  const hintX = hint !== undefined ? hint * LANE_STEP : autoX
  for (const off of uniqOffsets(hintX)) {
    const mx = baseMx + off
    const p = tryPath([p0, s0, { x: mx, y: s0.y }, { x: mx, y: s1.y }, s1, p1])
    if (p) {
      ctx.corridorUse.set(corridorKey, (ctx.corridorUse.get(corridorKey) ?? 0) + 1)
      return p
    }
  }

  // 4) V-H-V：横向走两簇之间通道（缓冲段之间）
  let baseMy: number
  if (b.y >= a.y + a.h) baseMy = (a.y + a.h + b.y) / 2
  else if (a.y >= b.y + b.h) baseMy = (b.y + b.h + a.y) / 2
  else baseMy = Math.max(a.y + a.h, b.y + b.h) + DETOUR
  const channelKey = Math.round(baseMy)
  const autoY = laneOffset(ctx.channelUse.get(channelKey) ?? 0)
  const hintY = hint !== undefined ? hint * LANE_STEP : autoY
  for (const off of uniqOffsets(hintY)) {
    const my = baseMy + off
    const p = tryPath([p0, s0, { x: s0.x, y: my }, { x: s1.x, y: my }, s1, p1])
    if (p) {
      ctx.channelUse.set(channelKey, (ctx.channelUse.get(channelKey) ?? 0) + 1)
      return p
    }
  }

  // 5) 极端绕行：画布上/下外侧横向通道（缓冲段保持垂直进入）
  for (const my of [ctx.minY - DETOUR, ctx.maxY + DETOUR]) {
    const p = tryPath([p0, s0, { x: s0.x, y: my }, { x: s1.x, y: my }, s1, p1])
    if (p) return p
  }
  // 6) 画布左/右外侧竖向走廊（防御兜底）
  for (const mx of [ctx.minX - DETOUR, ctx.maxX + DETOUR]) {
    const p = tryPath([p0, s0, { x: mx, y: s0.y }, { x: mx, y: s1.y }, s1, p1])
    if (p) return p
  }
  // 走廊都被占用时优先保留已有避障结果。
  return crossingFallback ?? simplify([p0, s0, { x: s0.x, y: s1.y }, s1, p1])
}

// ---------- 主布局 ----------

/**
 * 生成时钟树布局：有 diagram → 簇左上坐标取数据；无 → 列式回退。
 * 节点 / 连线 / 分组的构成由 buildClockModel 决定，本函数只负责坐标与走线。
 */
export function buildClockTree(
  spec: ClockData,
  cfg: ClockConfig,
  freqs: ClockFrequencies,
  issues?: ClockIssue[],
  peri?: PeripheralClockContext,
): ClockTreeLayout {
  const model = buildClockModel(spec, cfg, freqs, issues, peri)
  const diagram = spec.diagram

  const nodes: ClockTreeNode[] = []
  const dims = new Map<string, Size>()
  for (const n of model.nodes) dims.set(n.id, clusterSize(spec, n))

  if (diagram) {
    // ---------- 数据坐标优先（diagram.nodes[id] = 簇左上） ----------
    const missing: ClockNodeModel[] = []
    let maxRight = X0
    let placed = 0
    for (const n of model.nodes) {
      const d = diagram.nodes?.[n.id]
      const size = dims.get(n.id)!
      if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) {
        nodes.push({ ...n, x: d.x, y: d.y, ...size })
        maxRight = Math.max(maxRight, d.x + size.w)
        placed++
      } else {
        missing.push(n)
      }
    }
    // validate 保证全覆盖；运行时缺省节点放最右列堆叠（同一 x，不 warn）
    const missingX = placed > 0 ? maxRight + 40 : X0
    let cursorY = Y0
    for (const n of missing) {
      const size = dims.get(n.id)!
      nodes.push({ ...n, x: missingX, y: cursorY, ...size })
      cursorY += size.h + ROW_GAP
      maxRight = Math.max(maxRight, missingX + size.w)
    }
  } else {
    // ---------- M15 列式回退：列内 y=簇高+32，列距 max(200, 列宽+40) ----------
    const colWidth = new Map<number, number>()
    for (const n of model.nodes) {
      const size = dims.get(n.id)!
      colWidth.set(n.column, Math.max(colWidth.get(n.column) ?? 0, size.w))
    }
    const colX = new Map<number, number>()
    let x = X0
    for (const col of [...colWidth.keys()].sort((p, q) => p - q)) {
      colX.set(col, x)
      x += Math.max(COL_MIN_DX, colWidth.get(col)! + COL_GAP)
    }
    const cursorY = new Map<number, number>()
    for (const n of model.nodes) {
      const size = dims.get(n.id)!
      const y = cursorY.get(n.column) ?? Y0
      nodes.push({ ...n, x: colX.get(n.column)!, y, ...size })
      cursorY.set(n.column, y + size.h + ROW_GAP)
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))

  // ---------- 分组容器：diagram.groups 显式数据优先，否则成员包围盒 ----------
  const groups: ClockTreeGroup[] = []
  if (diagram?.groups?.length) {
    for (const g of diagram.groups) {
      groups.push({ id: g.id, label: g.label, x: g.x, y: g.y, w: g.w, h: g.h })
    }
  } else {
    for (const g of model.groups) {
      const members = nodes.filter((n) => n.group === g.id)
      if (!members.length) continue
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const m of members) {
        minX = Math.min(minX, m.x)
        minY = Math.min(minY, m.y)
        maxX = Math.max(maxX, m.x + m.w)
        maxY = Math.max(maxY, m.y + m.h)
      }
      groups.push({
        ...g,
        x: minX - GROUP_PAD_X,
        y: minY - GROUP_PAD_TOP,
        w: maxX - minX + GROUP_PAD_X * 2,
        h: maxY - minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
      })
    }
  }

  // ---------- 走线（正交 + 走廊错开 + 不穿簇） ----------
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  const ctx: RouteCtx = {
    rects: nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
    minX,
    maxX,
    minY,
    maxY,
    corridorUse: new Map(),
    channelUse: new Map(),
    lanes: diagram?.lanes,
    routed: [],
  }
  for (const e of model.edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    // 防御：模型引用不存在的节点时退化为零长线（不抛错，避免画布整体失败）
    const points =
      a && b ? routeEdge(a, b, e, ctx) : [{ x: 0, y: 0 }, { x: 0, y: 0 }]
    ctx.routed.push({ ...e, points, labelAt: labelPos(points, e.label) })
  }

  // ---------- 画布尺寸：最大簇右下 + 40 / 36 ----------
  let right = 0
  let bottom = 0
  for (const n of nodes) {
    right = Math.max(right, n.x + n.w)
    bottom = Math.max(bottom, n.y + n.h)
  }
  return { width: right + 40, height: bottom + 36, nodes, edges: ctx.routed, groups }
}
