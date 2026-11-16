// 时钟树 SVG 布局（纯函数）：输入 ClockData + ClockConfig + ClockFrequencies，
// 输出节点 / 正交连线 / 分组容器布局。列位置完全由数据推导，禁止按芯片名分支。
import type { ClockConfig, ClockData, ClockFrequencies, ClockIssue } from '@/model/types'
import { pllOutMhz, sourceFreqMhz } from '@/model/clock'

export interface ClockPt {
  x: number
  y: number
}

export interface ClockNodeControlOption {
  value: string | number
  label: string
}

/** 节点内嵌控件描述（画布下拉弹层与详情面板共用） */
export interface ClockNodeControl {
  kind: 'select' | 'number'
  /** 对应 ClockConfig 的字段；pll 参数用 field='pll' + pllKey */
  field: 'source' | 'pllSource' | 'hxtalMhz' | 'adc' | 'ahb' | 'apb1' | 'apb2' | 'pll'
  /** field === 'pll' 时的参数 key */
  pllKey?: string
  label: string
  value: string | number
  options?: ClockNodeControlOption[]
  /** 固定值（数据层 fixed 或唯一档位）：UI 置灰不可改 */
  fixed?: boolean
  min?: number
  max?: number
  unit?: string
}

export interface ClockTreeNode {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  /** 输入频率（MHz），源节点为 null */
  inMhz: number | null
  /** 输出频率（MHz） */
  outMhz: number | null
  /** 频率上限（MHz），无上限为 null */
  maxMhz: number | null
  /** 问题级别：error 红 / warning 橙 / null 正常（来自 validateClock 定位到本节点） */
  issueLevel: 'error' | 'warning' | null
  /** 越界错误（error 级；保留以兼容既有调用方） */
  overLimit: boolean
  /** 是否在当前有效链路上 */
  active: boolean
  control: ClockNodeControl | null
  /** 控件行位置的只读说明（如 TIM 倍率） */
  hint?: string
}

export interface ClockTreeEdge {
  id: string
  from: string
  to: string
  /** 正交折线点集 */
  points: ClockPt[]
  active: boolean
  label?: string
  labelAt: ClockPt
}

export interface ClockTreeGroup {
  id: string
  label: string
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

/** 频率显示：整数不带小数点，最多 3 位小数（尾零自然截断）。 */
export function formatMhz(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const r = Math.round(v * 1000) / 1000
  return `${r} MHz`
}

/** 汇总某个节点上的问题级别：任一 error 即 error，否则有 warning 即 warning。 */
function issueLevelOf(issues: ClockIssue[] | undefined, node: string): 'error' | 'warning' | null {
  if (!issues?.length) return null
  let level: 'error' | 'warning' | null = null
  for (const i of issues) {
    if (i.node !== node) continue
    if (i.level === 'error') return 'error'
    level = 'warning'
  }
  return level
}

function srcActive(cfg: ClockConfig, srcId: string): boolean {
  return cfg.source === srcId || (cfg.source === 'PLL' && (cfg.pllSource ?? '') === srcId)
}

/** 分频总线节点（AHB/APB1/APB2） */
function busNode(
  id: string,
  label: string,
  field: 'ahb' | 'apb1' | 'apb2',
  div: ClockData['ahb'],
  inMhz: number,
  outMhz: number,
  x: number,
  y: number,
  cfg: ClockConfig,
  issues: ClockIssue[] | undefined,
): ClockTreeNode {
  const issueLevel = issueLevelOf(issues, id)
  return {
    id,
    label,
    x,
    y,
    w: NODE_W,
    h: NODE_H,
    inMhz,
    outMhz,
    maxMhz: div.maxMhz,
    issueLevel,
    overLimit: issueLevel === 'error',
    active: true,
    control: {
      kind: 'select',
      field,
      label: '分频',
      value: cfg[field],
      options: div.options.map((o) => ({ value: o, label: `÷${o}` })),
      fixed: div.options.length <= 1,
    },
  }
}

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
 * 节点数量与取值全部来自 spec（源数量、PLL 参数、分频档位、ADC 选项、定时器域模式）。
 */
export function buildClockTree(
  spec: ClockData,
  cfg: ClockConfig,
  freqs: ClockFrequencies,
  issues?: ClockIssue[],
): ClockTreeLayout {
  const nodes: ClockTreeNode[] = []
  const edges: ClockTreeEdge[] = []
  const groups: ClockTreeGroup[] = []

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

  const usePll = cfg.source === 'PLL'
  const pllSourceId = cfg.pllSource ?? spec.pll.sourceOptions[0] ?? ''

  // ---------- 分组容器 ----------
  groups.push(
    {
      id: 'g-sources',
      label: 'Clock sources',
      x: SRC_X - 20,
      y: SRC_Y0 - GROUP_PAD,
      w: NODE_W + 40,
      h: lastBottom + 18 - (SRC_Y0 - GROUP_PAD),
    },
    { id: 'g-pll', label: `PLL Max ${spec.pll.outMaxMhz} MHz`, x: PLL_X - 20, y: pllTop - GROUP_PAD, w: NODE_W + 40, h: NODE_H + GROUP_PAD + 10 },
    { id: 'g-sys', label: 'System Clock', x: SYS_X - 20, y: sysTop - GROUP_PAD, w: NODE_W + 40, h: NODE_H + GROUP_PAD + 10 },
  )
  const timMode = spec.timerClock ?? 'apb_x2'
  const tim1Max = timMode === 'sysclk' ? spec.sysclkMaxMhz : spec.apb1.maxMhz * 2
  const tim2Max = timMode === 'sysclk' ? spec.sysclkMaxMhz : spec.apb2.maxMhz * 2
  groups.push({
    id: 'g-tim',
    label: `TIM Max ${tim1Max} MHz`,
    x: PERIPH_X - 20,
    y: tim1Y - GROUP_PAD,
    w: NODE_W + 40,
    h: tim2Y + NODE_H + 18 - (tim1Y - GROUP_PAD),
  })
  groups.push({
    id: 'g-adc',
    label: spec.adc.maxMhz !== undefined ? `ADC Max ${spec.adc.maxMhz} MHz` : 'ADC',
    x: PERIPH_X - 20,
    y: adcY - GROUP_PAD,
    w: NODE_W + 40,
    h: NODE_H + GROUP_PAD + 18,
  })

  // ---------- 节点 ----------
  const srcY: Record<string, number> = {}
  srcSpecs.forEach((s, i) => {
    const y = SRC_Y0 + i * SRC_DY
    srcY[s.id] = y
    const out = s.hxtal ? (cfg.hxtalMhz ?? s.hxtal.default) : (s.freqMhz ?? null)
    const srcLevel = issueLevelOf(issues, s.id)
    nodes.push({
      id: s.id,
      label: s.label,
      x: SRC_X,
      y,
      w: NODE_W,
      h: NODE_H,
      inMhz: null,
      outMhz: out,
      maxMhz: null,
      issueLevel: srcLevel,
      overLimit: srcLevel === 'error',
      active: srcActive(cfg, s.id),
      control: s.hxtal
        ? {
            kind: 'number',
            field: 'hxtalMhz',
            label: '晶振频率',
            value: out ?? 0,
            min: s.hxtal.min,
            max: s.hxtal.max,
            unit: 'MHz',
          }
        : null,
      hint: s.hxtal ? `范围 ${s.hxtal.min}~${s.hxtal.max} MHz` : undefined,
    })
  })

  // PLL（倍频下拉；数据层 fixed 时置灰）。即使当前未选用 PLL，也显示其潜在输出（置灰态），
// 便于用户判断切到 PLL 后的频率。
  const pllLabel = spec.sources.find((s) => s.pll)?.label ?? 'PLL'
  const firstParam = spec.pll.params[0]
  const pllInShown = sourceFreqMhz(spec, pllSourceId, cfg)
  const pllOutShown = pllInShown === null ? null : pllOutMhz(spec, pllInShown, cfg.pll ?? {})
  const pllLevel = issueLevelOf(issues, 'PLL')
  nodes.push({
    id: 'PLL',
    label: pllLabel,
    x: PLL_X,
    y: pllTop,
    w: NODE_W,
    h: NODE_H,
    inMhz: pllInShown,
    outMhz: pllOutShown,
    maxMhz: spec.pll.outMaxMhz,
    issueLevel: pllLevel,
    overLimit: pllLevel === 'error',
    active: usePll,
    control: firstParam
      ? {
          kind: 'select',
          field: 'pll',
          pllKey: firstParam.key,
          label: firstParam.label,
          value: cfg.pll?.[firstParam.key] ?? firstParam.default,
          options: firstParam.options.map((o) => ({
            value: o,
            label: spec.pll.fixedOutMhz !== undefined ? `÷${o}` : `×${o}`,
          })),
          fixed: firstParam.fixed || firstParam.options.length <= 1,
        }
      : null,
    hint: usePll ? undefined : '未使用',
  })

  // SYSCLK（源选择）
  const directSrc = spec.sources.find((s) => s.id === cfg.source)
  const sysIn = usePll
    ? freqs.pllOutMhz
    : directSrc
      ? directSrc.hxtal
        ? (cfg.hxtalMhz ?? directSrc.hxtal.default)
        : (directSrc.freqMhz ?? null)
      : null
  const sysLevel = issueLevelOf(issues, 'SYSCLK')
  nodes.push({
    id: 'SYSCLK',
    label: 'SYSCLK',
    x: SYS_X,
    y: sysTop,
    w: NODE_W,
    h: NODE_H,
    inMhz: sysIn,
    outMhz: freqs.sysclkMhz,
    maxMhz: spec.sysclkMaxMhz,
    issueLevel: sysLevel,
    overLimit: sysLevel === 'error',
    active: true,
    control: {
      kind: 'select',
      field: 'source',
      label: '时钟源',
      value: cfg.source,
      options: spec.sources.map((s) => ({ value: s.id, label: s.label })),
    },
  })

  // 总线
  nodes.push(
    busNode('AHB', 'AHB', 'ahb', spec.ahb, freqs.sysclkMhz, freqs.hclkMhz, SYS_X, ahbY, cfg, issues),
    busNode('APB1', 'APB1', 'apb1', spec.apb1, freqs.hclkMhz, freqs.pclk1Mhz, APB1_X, apbY, cfg, issues),
    busNode('APB2', 'APB2', 'apb2', spec.apb2, freqs.hclkMhz, freqs.pclk2Mhz, APB2_X, apbY, cfg, issues),
  )

  // 定时器域（模式由 spec.timerClock 决定：sysclk 直通 / APB 分频>1 时 ×2）
  const timHint = timMode === 'sysclk' ? 'SYSCLK 直通' : undefined
  const tim1Level = issueLevelOf(issues, 'TIM1')
  nodes.push({
    id: 'TIM1',
    label: 'TIM1',
    x: PERIPH_X,
    y: tim1Y,
    w: NODE_W,
    h: NODE_H,
    inMhz: freqs.pclk1Mhz,
    outMhz: freqs.pclk1TimMhz,
    maxMhz: tim1Max,
    issueLevel: tim1Level,
    overLimit: tim1Level === 'error',
    active: true,
    control: null,
    hint: timMode === 'sysclk' ? timHint : cfg.apb1 > 1 ? '×2' : '×1',
  })
  const tim2Level = issueLevelOf(issues, 'TIM2')
  nodes.push({
    id: 'TIM2',
    label: 'TIM2',
    x: PERIPH_X,
    y: tim2Y,
    w: NODE_W,
    h: NODE_H,
    inMhz: freqs.pclk2Mhz,
    outMhz: freqs.pclk2TimMhz,
    maxMhz: tim2Max,
    issueLevel: tim2Level,
    overLimit: tim2Level === 'error',
    active: true,
    control: null,
    hint: timMode === 'sysclk' ? timHint : cfg.apb2 > 1 ? '×2' : '×1',
  })

  // ADC（时钟源来自 spec.adc.options）
  const adcOpt = spec.adc.options.find((o) => o.id === (cfg.adc ?? spec.adc.default)) ?? spec.adc.options[0]!
  const adcBase = adcOpt.source === 'AHB' ? freqs.hclkMhz : adcOpt.source === 'APB1' ? freqs.pclk1Mhz : freqs.pclk2Mhz
  const adcLevel = issueLevelOf(issues, 'ADC')
  nodes.push({
    id: 'ADC',
    label: 'ADC',
    x: PERIPH_X,
    y: adcY,
    w: NODE_W,
    h: NODE_H,
    inMhz: adcBase,
    outMhz: freqs.adcMhz,
    maxMhz: spec.adc.maxMhz ?? null,
    issueLevel: adcLevel,
    overLimit: adcLevel === 'error',
    active: true,
    control: {
      kind: 'select',
      field: 'adc',
      label: '时钟源',
      value: cfg.adc ?? spec.adc.default,
      options: spec.adc.options.map((o) => ({ value: o.id, label: o.label })),
      fixed: spec.adc.options.length <= 1,
    },
  })

  // ---------- 连线（正交折线） ----------
  const edge = (id: string, from: string, to: string, points: ClockPt[], active: boolean, label?: string) => {
    edges.push({ id, from, to, points, active, label, labelAt: labelPos(points) })
  }
  const srcRight = SRC_X + NODE_W
  // 复用线走廊：PLL 分组框上方（避免压住分组标签与边框）
  const corrY = pllTop - GROUP_PAD - 14

  for (const s of srcSpecs) {
    const y = srcY[s.id]!
    const eyPll = y + Math.round(NODE_H * 0.54) // 下出口：馈 PLL
    const eySys = y + Math.round(NODE_H * 0.26) // 上出口：直入 SYSCLK
    edge(
      `src-${s.id}-pll`,
      s.id,
      'PLL',
      [
        { x: srcRight, y: eyPll },
        { x: LANE_SRC_PLL, y: eyPll },
        { x: LANE_SRC_PLL, y: mc },
        { x: PLL_X, y: mc },
      ],
      usePll && pllSourceId === s.id,
    )
    edge(
      `src-${s.id}-sys`,
      s.id,
      'SYSCLK',
      [
        { x: srcRight, y: eySys },
        { x: LANE_SRC_SYS, y: eySys },
        { x: LANE_SRC_SYS, y: corrY },
        { x: LANE_MUX, y: corrY },
        { x: LANE_MUX, y: mc },
        { x: SYS_X, y: mc },
      ],
      cfg.source === s.id,
    )
  }
  edge('pll-sys', 'PLL', 'SYSCLK', [{ x: PLL_X + NODE_W, y: mc }, { x: SYS_X, y: mc }], usePll)

  const ahbCx = SYS_X + NODE_W / 2
  edge('sys-ahb', 'SYSCLK', 'AHB', [{ x: ahbCx, y: sysTop + NODE_H }, { x: ahbCx, y: ahbY }], true, `÷${cfg.ahb}`)
  const busMidY = ahbBottom + APB_DY / 2
  edge(
    'ahb-apb1',
    'AHB',
    'APB1',
    [
      { x: SYS_X + 40, y: ahbBottom },
      { x: SYS_X + 40, y: busMidY },
      { x: APB1_X + NODE_W / 2, y: busMidY },
      { x: APB1_X + NODE_W / 2, y: apbY },
    ],
    true,
    `÷${cfg.apb1}`,
  )
  edge(
    'ahb-apb2',
    'AHB',
    'APB2',
    [
      { x: SYS_X + NODE_W - 40, y: ahbBottom },
      { x: SYS_X + NODE_W - 40, y: busMidY },
      { x: APB2_X + NODE_W / 2, y: busMidY },
      { x: APB2_X + NODE_W / 2, y: apbY },
    ],
    true,
    `÷${cfg.apb2}`,
  )

  // 定时器域：APB 底部出口（错开 x 避免同点重叠）
  const tim1Cy = tim1Y + NODE_H / 2
  const tim2Cy = tim2Y + NODE_H / 2
  edge(
    'apb1-tim1',
    'APB1',
    'TIM1',
    [
      { x: APB1_X + NODE_W / 2, y: apbBottom },
      { x: APB1_X + NODE_W / 2, y: tim1Cy },
      { x: PERIPH_X, y: tim1Cy },
    ],
    true,
    timMode === 'sysclk' ? 'SYSCLK' : cfg.apb1 > 1 ? '×2' : '×1',
  )
  edge(
    'apb2-tim2',
    'APB2',
    'TIM2',
    [
      { x: APB2_X + 40, y: apbBottom },
      { x: APB2_X + 40, y: tim2Cy },
      { x: PERIPH_X, y: tim2Cy },
    ],
    true,
    timMode === 'sysclk' ? 'SYSCLK' : cfg.apb2 > 1 ? '×2' : '×1',
  )

  // ADC：按数据里的时钟源选出发节点与走线
  const adcCy = adcY + NODE_H / 2
  const adcLabel = `÷${adcOpt.div}`
  if (adcOpt.source === 'AHB') {
    edge('ahb-adc', 'AHB', 'ADC', [
      { x: SYS_X + NODE_W, y: ahbY + NODE_H / 2 },
      { x: PERIPH_X - 80, y: ahbY + NODE_H / 2 },
      { x: PERIPH_X - 80, y: adcCy },
      { x: PERIPH_X, y: adcCy },
    ], true, adcLabel)
  } else if (adcOpt.source === 'APB1') {
    edge('apb1-adc', 'APB1', 'ADC', [
      { x: APB1_X + 120, y: apbBottom },
      { x: APB1_X + 120, y: adcCy },
      { x: PERIPH_X, y: adcCy },
    ], true, adcLabel)
  } else {
    edge('apb2-adc', 'APB2', 'ADC', [
      { x: APB2_X + 120, y: apbBottom },
      { x: APB2_X + 120, y: adcCy },
      { x: PERIPH_X, y: adcCy },
    ], true, adcLabel)
  }

  const width = PERIPH_X + NODE_W + 40
  const height = adcY + NODE_H + 36
  return { width, height, nodes, edges, groups }
}

/** 应用画布/详情控件修改，返回新的 ClockConfig（纯函数）。 */
export function applyClockControl(cfg: ClockConfig, control: ClockNodeControl, value: string | number): ClockConfig {
  switch (control.field) {
    case 'source':
      return { ...cfg, source: String(value) }
    case 'pllSource':
      return { ...cfg, pllSource: String(value) }
    case 'adc':
      return { ...cfg, adc: String(value) }
    case 'hxtalMhz':
      return { ...cfg, hxtalMhz: Number(value) }
    case 'ahb':
      return { ...cfg, ahb: Number(value) }
    case 'apb1':
      return { ...cfg, apb1: Number(value) }
    case 'apb2':
      return { ...cfg, apb2: Number(value) }
    case 'pll':
      return { ...cfg, pll: { ...(cfg.pll ?? {}), [control.pllKey ?? 'mul']: Number(value) } }
  }
}
