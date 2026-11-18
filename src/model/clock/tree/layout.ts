// 时钟树 SVG 布局（纯函数）：把逻辑模型（节点 / 连线 / 分组）映射为画布坐标，
// 输出节点位置、正交连线折线与分组容器。列位置完全由数据推导，禁止按芯片名分支。
// M15：列式自动布局（x=40+column*200 / 列内 y=60+i*140），无硬编码节点坐标表；
// 通用正交走线：跨列经走廊折弯 + 行间通道水平段，同列垂直；走线不穿过任何节点卡矩形。
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

// ---------- 布局常量（全部相对画布原点；列/行间距固定，节点顺序决定行号） ----------

const NODE_W = 160
/** 节点高度需容纳：上限标签 / 频率两栏 / 节点标题 / 控件行（26px） */
const NODE_H = 108
/** 列起点与列间距：x = X0 + column * COL_DX（契约 D3 冻结） */
const X0 = 40
const COL_DX = 200
/** 行起点与行间距：y = Y0 + rowIndex * ROW_DY（列内堆叠顺序） */
const Y0 = 60
const ROW_DY = 140
/** 列间走廊（相邻列之间的空隙）宽度 = COL_DX - NODE_W */
const COL_GAP = COL_DX - NODE_W
/** 分组框留白：顶部 30（容纳分组标签）、左右 16（列间仅 40px；两侧各 16 留 8px 间隙，避免相邻分组框重叠）、底部 18 */
const GROUP_PAD_TOP = 30
const GROUP_PAD_X = 16
const GROUP_PAD_BOTTOM = 18
/** 同一走廊/通道内多条走线的错开步长（px；走廊/通道均宽 40/32，最多 ±12） */
const LANE_STEP = 12
/** 同一走廊最多错开的档位数（-1/0/+1） */
const LANE_SLOTS = 3

/** 计算连线标签位置：取最后一段的中点，水平段在上方、垂直段在右侧。 */
function labelPos(points: ClockPt[]): ClockPt {
  const n = points.length
  if (n < 2) return { x: points[0]!.x + 8, y: points[0]!.y - 8 }
  const a = points[n - 2]!
  const b = points[n - 1]!
  if (a.y === b.y) return { x: (a.x + b.x) / 2, y: a.y - 7 }
  return { x: a.x + 8, y: (a.y + b.y) / 2 }
}

/** 列号 → 列左边界 x */
function columnX(column: number): number {
  return X0 + column * COL_DX
}

/** 列号 c 与 c+1 之间走廊的中心 x */
function corridorX(c: number): number {
  return columnX(c) + NODE_W + COL_GAP / 2
}

/** 行号 r 与 r+1 之间通道的中心 y（行网格全局对齐，任意列该 y 均无节点） */
function channelY(r: number): number {
  return Y0 + r * ROW_DY + NODE_H + (ROW_DY - NODE_H) / 2
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

/**
 * 生成时钟树布局：节点按 column 分列、列内按模型顺序堆叠；连线走通用正交路由。
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

  // ---------- 节点坐标（列 × 行，无 id→坐标表） ----------
  const rowCount = new Map<number, number>()
  const nodes: ClockTreeNode[] = model.nodes.map((n) => {
    const row = rowCount.get(n.column) ?? 0
    rowCount.set(n.column, row + 1)
    return { ...n, x: columnX(n.column), y: Y0 + row * ROW_DY, w: NODE_W, h: NODE_H }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rowOf = new Map<string, number>()
  for (const n of nodes) rowOf.set(n.id, Math.round((n.y - Y0) / ROW_DY))

  // ---------- 分组容器（成员包围盒 + 留白；无成员组不输出） ----------
  const groups: ClockTreeGroup[] = []
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

  // ---------- 走线 ----------
  // 走廊/通道错开计数：同一条走廊（列 c↔c+1）或同一行间通道内多边按 12px 错开。
  const corridorLanes = new Map<number, number>()
  const channelLanes = new Map<number, number>()
  const laneOffset = (used: number): number => ((used % LANE_SLOTS) - 1) * LANE_STEP
  const takeCorridorLane = (c: number): number => {
    const used = corridorLanes.get(c) ?? 0
    corridorLanes.set(c, used + 1)
    return laneOffset(used)
  }
  const takeChannelLane = (r: number): number => {
    const used = channelLanes.get(r) ?? 0
    channelLanes.set(r, used + 1)
    return laneOffset(used)
  }

  /** 同列走线：相邻行=源底中→目标顶中的垂直线；跨行（如同一 ADC 域的多个实例）经列侧走廊绕行。 */
  const sameColumn = (a: ClockTreeNode, b: ClockTreeNode): ClockPt[] => {
    const cx = a.x + NODE_W / 2
    const bMidY = b.y + NODE_H / 2
    const ra = rowOf.get(a.id) ?? 0
    const rb = rowOf.get(b.id) ?? 0
    if (rb >= ra) {
      // 目标在源下方：相邻行走垂直线，跨行走左侧走廊（不穿过中间节点卡）
      if (rb === ra + 1) return [{ x: cx, y: a.y + NODE_H }, { x: cx, y: b.y }]
      const sideX = a.x - COL_GAP / 2
      const jogY = a.y + NODE_H + 8
      return [
        { x: cx, y: a.y + NODE_H },
        { x: cx, y: jogY },
        { x: sideX, y: jogY },
        { x: sideX, y: bMidY },
        { x: b.x, y: bMidY },
      ]
    }
    // 目标在源上方（防御）：右侧走廊绕行
    const sideX = a.x + NODE_W + COL_GAP / 2
    const jogY = a.y - 8
    return [
      { x: cx, y: a.y },
      { x: cx, y: jogY },
      { x: sideX, y: jogY },
      { x: sideX, y: bMidY },
      { x: b.x + NODE_W, y: bMidY },
    ]
  }

  /**
   * 跨列走线：
   * - 相邻列：源右中 → 走廊竖段 → 目标左中；
   * - 跨多列：源右中 → 近端走廊竖段 → 行间通道水平段 → 远端走廊竖段 → 目标左中。
   * 反向（目标列在左）镜像使用左边界/左侧走廊。
   */
  const crossColumn = (a: ClockTreeNode, b: ClockTreeNode, forward: boolean): ClockPt[] => {
    const ra = rowOf.get(a.id) ?? 0
    const rb = rowOf.get(b.id) ?? 0
    const ya = a.y + NODE_H / 2
    const yb = b.y + NODE_H / 2
    const exitX = forward ? a.x + NODE_W : a.x
    const entryX = forward ? b.x : b.x + NODE_W
    const nearCorridorCol = forward ? a.column : a.column - 1
    const farCorridorCol = forward ? b.column - 1 : b.column
    const nearOffset = takeCorridorLane(nearCorridorCol)
    const nearX = corridorX(nearCorridorCol) + nearOffset

    // 相邻列：两端共用走廊（同一 x，避免折线来回跳）
    if (Math.abs(b.column - a.column) === 1) {
      return [
        { x: exitX, y: ya },
        { x: nearX, y: ya },
        { x: nearX, y: yb },
        { x: entryX, y: yb },
      ]
    }

    const farOffset = takeCorridorLane(farCorridorCol)
    const farX = corridorX(farCorridorCol) + farOffset
    // 通道取两端行号较小者的行间隙（该 y 在所有列均无节点）
    const chanRow = Math.min(ra, rb)
    const chan = channelY(chanRow) + takeChannelLane(chanRow)
    return [
      { x: exitX, y: ya },
      { x: nearX, y: ya },
      { x: nearX, y: chan },
      { x: farX, y: chan },
      { x: farX, y: yb },
      { x: entryX, y: yb },
    ]
  }

  const edgePointsOf = (e: ClockEdgeModel): ClockPt[] => {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    // 防御：模型引用不存在的节点时退化为零长线（不抛错，避免画布整体失败）
    if (!a || !b) return [{ x: 0, y: 0 }, { x: 0, y: 0 }]
    if (a.id === b.id) return [{ x: a.x + NODE_W, y: a.y + NODE_H / 2 }, { x: b.x, y: b.y + NODE_H / 2 }]
    if (a.column === b.column) return sameColumn(a, b)
    return crossColumn(a, b, b.column > a.column)
  }

  const edges: ClockTreeEdge[] = model.edges.map((e) => {
    const points = simplify(edgePointsOf(e))
    return { ...e, points, labelAt: labelPos(points) }
  })

  // ---------- 画布尺寸：最大列 x + 节点宽 + 40 × 最大 y + 节点高 + 36 ----------
  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  const width = maxX + 40
  const height = maxY + 36
  return { width, height, nodes, edges, groups }
}
