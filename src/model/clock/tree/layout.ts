// 时钟树 SVG 布局（纯函数）：把逻辑模型（节点 / 连线 / 分组）映射为画布坐标，
// 输出节点位置、正交连线折线与分组容器。列位置完全由数据推导，禁止按芯片名分支。
import type { ClockConfig, ClockData, ClockFrequencies, ClockIssue } from '@/model/types'
import { buildClockModel, type ClockEdgeModel, type ClockGroupModel, type ClockNodeModel } from './model'

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

// ---------- 布局常量（列坐标，全部相对画布原点） ----------

const NODE_W = 160
/** 节点高度需容纳：上限标签 / 频率两栏 / 节点标题 / 控件行（26px） */
const NODE_H = 108
/** 源列（HSI/HSE…纵向堆叠） */
const SRC_X = 40
const SRC_Y0 = 60
const SRC_DY = 140 // NODE_H + 32 间距
/** PLL 列 / SYSCLK 列 */
const PLL_X = 280
const SYS_X = 520
const AHB_DY = 56 // SYSCLK 底 → AHB 顶
const APB_DY = 60 // AHB 底 → APB 顶
/** APB 总线行 */
const APB1_X = 380
const APB2_X = 680
/** 外设列（TIM 域 / ADC） */
const PERIPH_X = 1000
const PERIPH_DY = 124
/** 分组框顶部到首节点的留白（容纳分组标签） */
const GROUP_PAD = 30
/** 走线列：源→PLL / 源→SYSCLK 复用 / SYSCLK 复用汇流 */
const LANE_SRC_PLL = 240
const LANE_SRC_SYS = 260
const LANE_MUX = 476

/** 计算连线标签位置：取最后一段的中点，水平段在上方、垂直段在右侧。 */
function labelPos(points: ClockPt[]): ClockPt {
  const n = points.length
  if (n < 2) return { x: points[0]!.x + 8, y: points[0]!.y - 8 }
  const a = points[n - 2]!
  const b = points[n - 1]!
  if (a.y === b.y) return { x: (a.x + b.x) / 2, y: a.y - 7 }
  return { x: a.x + 8, y: (a.y + b.y) / 2 }
}

/**
 * 生成时钟树布局：左列时钟源 → PLL / SYSCLK 多路复用 → AHB → APB1/APB2 → 外设列（TIM 域、ADC）。
 * 节点 / 连线 / 分组的构成由 buildClockModel 决定，本函数只负责坐标与走线。
 */
export function buildClockTree(
  spec: ClockData,
  cfg: ClockConfig,
  freqs: ClockFrequencies,
  issues?: ClockIssue[],
): ClockTreeLayout {
  const model = buildClockModel(spec, cfg, freqs, issues)

  // ---------- 纵向位置推导 ----------
  const srcSpecs = spec.sources.filter((s) => !s.pll)
  const lastBottom = SRC_Y0 + (srcSpecs.length - 1) * SRC_DY + NODE_H
  /** SYSCLK 多路复用中心 y = 源堆叠的垂直中点 */
  const mc = (SRC_Y0 + lastBottom) / 2
  const pllTop = mc - NODE_H / 2
  const sysTop = pllTop
  const ahbY = sysTop + NODE_H + AHB_DY
  const ahbBottom = ahbY + NODE_H
  const apbY = ahbBottom + APB_DY
  const apbBottom = apbY + NODE_H
  const tim1Y = apbY + PERIPH_DY
  const tim2Y = apbY + PERIPH_DY * 2
  // ADC 分组框在 TIM 分组框下方留出间距，避免标签与边框重叠
  const adcY = tim2Y + NODE_H + GROUP_PAD + 28

  // ---------- 节点坐标（按节点 id 定位到列） ----------
  const srcY: Record<string, number> = {}
  const posById = new Map<string, ClockPt>()
  srcSpecs.forEach((s, i) => {
    const y = SRC_Y0 + i * SRC_DY
    srcY[s.id] = y
    posById.set(s.id, { x: SRC_X, y })
  })
  posById.set('PLL', { x: PLL_X, y: pllTop })
  posById.set('SYSCLK', { x: SYS_X, y: sysTop })
  posById.set('AHB', { x: SYS_X, y: ahbY })
  posById.set('APB1', { x: APB1_X, y: apbY })
  posById.set('APB2', { x: APB2_X, y: apbY })
  posById.set('TIM1', { x: PERIPH_X, y: tim1Y })
  posById.set('TIM2', { x: PERIPH_X, y: tim2Y })
  posById.set('ADC', { x: PERIPH_X, y: adcY })

  const nodes: ClockTreeNode[] = model.nodes.map((n) => ({ ...n, ...posById.get(n.id)!, w: NODE_W, h: NODE_H }))

  // ---------- 分组容器坐标 ----------
  const groupBox = (x: number, y: number, h: number) => ({ x, y, w: NODE_W + 40, h })
  const groupById: Record<string, { x: number; y: number; w: number; h: number }> = {
    'g-sources': groupBox(SRC_X - 20, SRC_Y0 - GROUP_PAD, lastBottom + 18 - (SRC_Y0 - GROUP_PAD)),
    'g-pll': groupBox(PLL_X - 20, pllTop - GROUP_PAD, NODE_H + GROUP_PAD + 10),
    'g-sys': groupBox(SYS_X - 20, sysTop - GROUP_PAD, NODE_H + GROUP_PAD + 10),
    'g-tim': groupBox(PERIPH_X - 20, tim1Y - GROUP_PAD, tim2Y + NODE_H + 18 - (tim1Y - GROUP_PAD)),
    'g-adc': groupBox(PERIPH_X - 20, adcY - GROUP_PAD, NODE_H + GROUP_PAD + 18),
  }
  const groups: ClockTreeGroup[] = model.groups.map((g) => ({ ...g, ...groupById[g.id]! }))

  // ---------- 连线（正交折线） ----------
  const srcRight = SRC_X + NODE_W
  // 复用线走廊：PLL 分组框上方（避免压住分组标签与边框）
  const corrY = pllTop - GROUP_PAD - 14
  const ahbCx = SYS_X + NODE_W / 2
  const busMidY = ahbBottom + APB_DY / 2
  const tim1Cy = tim1Y + NODE_H / 2
  const tim2Cy = tim2Y + NODE_H / 2
  const adcCy = adcY + NODE_H / 2

  const edgePointsOf = (e: ClockEdgeModel): ClockPt[] => {
    // 源 → PLL：下出口，经走线列后从 PLL 左侧中部进入
    if (e.to === 'PLL') {
      const y = srcY[e.from]!
      const ey = y + Math.round(NODE_H * 0.54)
      return [
        { x: srcRight, y: ey },
        { x: LANE_SRC_PLL, y: ey },
        { x: LANE_SRC_PLL, y: mc },
        { x: PLL_X, y: mc },
      ]
    }
    // 源 → SYSCLK：上出口，经复用走廊汇入 SYSCLK 左侧中部
    if (e.to === 'SYSCLK' && e.from !== 'PLL') {
      const y = srcY[e.from]!
      const ey = y + Math.round(NODE_H * 0.26)
      return [
        { x: srcRight, y: ey },
        { x: LANE_SRC_SYS, y: ey },
        { x: LANE_SRC_SYS, y: corrY },
        { x: LANE_MUX, y: corrY },
        { x: LANE_MUX, y: mc },
        { x: SYS_X, y: mc },
      ]
    }
    // PLL → SYSCLK
    if (e.from === 'PLL') {
      return [
        { x: PLL_X + NODE_W, y: mc },
        { x: SYS_X, y: mc },
      ]
    }
    // SYSCLK → AHB
    if (e.from === 'SYSCLK') {
      return [
        { x: ahbCx, y: sysTop + NODE_H },
        { x: ahbCx, y: ahbY },
      ]
    }
    // AHB → APB1 / APB2：经总线行中线分叉
    if (e.from === 'AHB' && e.to === 'APB1') {
      return [
        { x: SYS_X + 40, y: ahbBottom },
        { x: SYS_X + 40, y: busMidY },
        { x: APB1_X + NODE_W / 2, y: busMidY },
        { x: APB1_X + NODE_W / 2, y: apbY },
      ]
    }
    if (e.from === 'AHB' && e.to === 'APB2') {
      return [
        { x: SYS_X + NODE_W - 40, y: ahbBottom },
        { x: SYS_X + NODE_W - 40, y: busMidY },
        { x: APB2_X + NODE_W / 2, y: busMidY },
        { x: APB2_X + NODE_W / 2, y: apbY },
      ]
    }
    // APB → TIM 域：APB 底部出口（错开 x 避免同点重叠）
    if (e.from === 'APB1' && e.to === 'TIM1') {
      return [
        { x: APB1_X + NODE_W / 2, y: apbBottom },
        { x: APB1_X + NODE_W / 2, y: tim1Cy },
        { x: PERIPH_X, y: tim1Cy },
      ]
    }
    if (e.from === 'APB2' && e.to === 'TIM2') {
      return [
        { x: APB2_X + 40, y: apbBottom },
        { x: APB2_X + 40, y: tim2Cy },
        { x: PERIPH_X, y: tim2Cy },
      ]
    }
    // → ADC：按数据里的时钟源选出发节点与走线
    if (e.from === 'AHB') {
      return [
        { x: SYS_X + NODE_W, y: ahbY + NODE_H / 2 },
        { x: PERIPH_X - 80, y: ahbY + NODE_H / 2 },
        { x: PERIPH_X - 80, y: adcCy },
        { x: PERIPH_X, y: adcCy },
      ]
    }
    if (e.from === 'APB1') {
      return [
        { x: APB1_X + 120, y: apbBottom },
        { x: APB1_X + 120, y: adcCy },
        { x: PERIPH_X, y: adcCy },
      ]
    }
    return [
      { x: APB2_X + 120, y: apbBottom },
      { x: APB2_X + 120, y: adcCy },
      { x: PERIPH_X, y: adcCy },
    ]
  }

  const edges: ClockTreeEdge[] = model.edges.map((e) => {
    const points = edgePointsOf(e)
    return { ...e, points, labelAt: labelPos(points) }
  })

  const width = PERIPH_X + NODE_W + 40
  const height = adcY + NODE_H + 36
  return { width, height, nodes, edges, groups }
}