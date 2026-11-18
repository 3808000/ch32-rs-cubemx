// 时钟树布局单元测试：节点/连线/分组几何、外设节点（M15 列式布局）、applyClockControl / formatMhz
// 数据：真实 CH32V003F4P6 / CH32V203C8T6 / CH32V307VCT6 / CH32X035C8T6 / CH582M；
// 外设时钟上下文用合成 PeripheralClockContext（A 域 peripheral.ts 并行开发，本文件不依赖其实现）。
import { describe, it, expect } from 'vitest'
import type {
  ClockConfig,
  ClockData,
  ClockFrequencies,
  PeripheralClockFreq,
  PeripheralClocksData,
  PeripheralsData,
  PeripheralState,
} from '@/model/types'
import { computeClock, defaultClock } from '@/model/clock'
import {
  applyClockControl,
  applyPeripheralClockControl,
  buildClockTree,
  formatMhz,
  type ClockNodeControl,
  type ClockTreeLayout,
  type PeripheralClockContext,
} from '@/model/clock/tree'
import { getDeviceData } from '@/model/device'

const v003 = getDeviceData('CH32V003F4P6')
const spec = v003.clock

// ---------- 布局常量（与 layout.ts 契约一致，测试独立声明以固定几何契约） ----------
const X0 = 40
const COL_DX = 200
const Y0 = 60
const ROW_DY = 140
const NODE_W = 160
const NODE_H = 108

// ---------- 合成外设上下文 ----------

/** 源总线频率（测试侧独立实现，仅用于构造合成 periFreqs） */
function busFreq(bus: string, freqs: ClockFrequencies): number {
  switch (bus) {
    case 'HCLK':
      return freqs.hclkMhz
    case 'APB1':
      return freqs.pclk1Mhz
    case 'APB2':
      return freqs.pclk2Mhz
    case 'SYSCLK':
      return freqs.sysclkMhz
    default:
      return 32
  }
}

/** 为 spec 附加外设时钟域数据（A 域 clock.json 尚未落盘时的等价合成数据） */
function withPeripheralClocks(s: ClockData, pc: PeripheralClocksData): ClockData {
  return { ...s, peripheralClocks: pc }
}

/** 为片内外设实例批量生成「全部启用、派生值中性」的上下文（仅验证模型/几何，不验证公式） */
function fakePeriCtx(
  periData: PeripheralsData,
  pc: PeripheralClocksData,
  freqs: ClockFrequencies,
): PeripheralClockContext {
  const state: Record<string, PeripheralState> = {}
  const periFreqs: PeripheralClockFreq[] = []
  const add = (
    category: 'usart' | 'spi' | 'i2c' | 'adc',
    list: { id: string }[],
    busOf: (id: string) => string,
  ) => {
    for (const inst of list) {
      const bus = busOf(inst.id)
      state[inst.id] = { enabled: true, params: {} }
      periFreqs.push({
        nodeId: `P-${inst.id}`,
        periId: inst.id,
        category,
        sourceBus: bus,
        inMhz: busFreq(bus, freqs),
        requested: null,
        actualMhz: null,
        dividerLabel: null,
        issues: [],
      })
    }
  }
  add('usart', periData.usart, (id) => pc.usart?.sourceOverrides?.[id] ?? pc.usart?.sourceDefault ?? 'APB1')
  add('spi', periData.spi, (id) => pc.spi?.sourceOverrides?.[id] ?? pc.spi?.sourceDefault ?? 'APB1')
  add('i2c', periData.i2c, (id) => pc.i2c?.sourceOverrides?.[id] ?? pc.i2c?.sourceDefault ?? 'APB1')
  add('adc', periData.adc, () => pc.adc?.source ?? 'APB2')
  if (pc.usb) {
    periFreqs.push({
      nodeId: 'USB',
      periId: 'USB',
      category: 'usb',
      sourceBus: 'PLL',
      inMhz: freqs.pllOutMhz ?? 0,
      requested: freqs.pllOutMhz,
      actualMhz: 48,
      dividerLabel: 'USBPRE ÷1 (HAL auto)',
      issues: [],
    })
  }
  return { peripherals: periData, state, periFreqs }
}

// ---------- 走线不穿节点卡（验收判据：线段与任一节点矩形内部无交叠） ----------

function nodeBusters(layout: ClockTreeLayout): string[] {
  const hits: string[] = []
  for (const e of layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!
      const b = e.points[i]!
      const sx1 = Math.min(a.x, b.x)
      const sx2 = Math.max(a.x, b.x)
      const sy1 = Math.min(a.y, b.y)
      const sy2 = Math.max(a.y, b.y)
      for (const n of layout.nodes) {
        const ox = Math.min(sx2, n.x + n.w) - Math.max(sx1, n.x)
        const oy = Math.min(sy2, n.y + n.h) - Math.max(sy1, n.y)
        if (ox > 0.5 && oy > 0.5) hits.push(`${e.id} 穿过 ${n.id}`)
      }
    }
  }
  return hits
}

function treeOf(s: ClockData, cfg: ClockConfig, peri?: PeripheralClockContext) {
  return buildClockTree(s, cfg, computeClock(s, cfg), undefined, peri)
}

describe('buildClockTree 节点', () => {
  const cfg = defaultClock(spec)
  const tree = treeOf(spec, cfg)

  it('包含源/PLL/SYSCLK/总线/外设全部节点', () => {
    const ids = tree.nodes.map((n) => n.id)
    for (const id of ['HSI', 'HSE', 'PLL', 'SYSCLK', 'AHB', 'APB1', 'APB2', 'ADC', 'TIM1', 'TIM2']) {
      expect(ids).toContain(id)
    }
  })

  it('默认档（HSI 直连）下 HSI 激活、HSE/PLL 未使用', () => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get('HSI')?.active).toBe(true)
    expect(byId.get('HSE')?.active).toBe(false)
    expect(byId.get('PLL')?.active).toBe(false)
    expect(byId.get('SYSCLK')?.outMhz).toBe(24)
  })

  it('PLL 倍频 fixed 时控件置灰', () => {
    const pll = tree.nodes.find((n) => n.id === 'PLL')
    expect(pll?.control?.fixed).toBe(true)
  })

  it('APB1 唯一档位时控件置灰，APB2 可选', () => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get('APB1')?.control?.fixed).toBe(true)
    expect(byId.get('APB2')?.control?.fixed).toBeFalsy()
  })

  it('HSE 节点带晶振数值控件且含范围', () => {
    const hse = tree.nodes.find((n) => n.id === 'HSE')
    expect(hse?.control?.kind).toBe('number')
    expect(hse?.control?.min).toBe(4)
    expect(hse?.control?.max).toBe(32)
  })

  it('warning 级问题（ADC 24MHz 超建议上限）标记橙色 warning 而非越界红', () => {
    const cfgPll = { ...defaultClock(spec), source: 'PLL', pllSource: 'HSI' }
    const freqs = computeClock(spec, cfgPll)
    const tree2 = buildClockTree(spec, cfgPll, freqs, [
      { node: 'ADC', level: 'warning', message: 'ADC 时钟 48MHz 超过建议上限 14MHz' },
    ])
    expect(tree2.nodes.find((n) => n.id === 'ADC')?.issueLevel).toBe('warning')
    // 兼容字段 overLimit 仅表示 error 级越界
    expect(tree2.nodes.find((n) => n.id === 'ADC')?.overLimit).toBe(false)
    expect(tree2.nodes.find((n) => n.id === 'AHB')?.issueLevel).toBeNull()
  })

  it('error 级问题标记 issueLevel=error 且 overLimit=true', () => {
    const cfgPll = { ...defaultClock(spec), source: 'PLL', pllSource: 'HSI' }
    const freqs = computeClock(spec, cfgPll)
    const tree2 = buildClockTree(spec, cfgPll, freqs, [
      { node: 'AHB', level: 'error', message: 'AHB 分频 12 不在可选档位' },
    ])
    expect(tree2.nodes.find((n) => n.id === 'AHB')?.issueLevel).toBe('error')
    expect(tree2.nodes.find((n) => n.id === 'AHB')?.overLimit).toBe(true)
    expect(tree2.nodes.find((n) => n.id === 'ADC')?.issueLevel).toBeNull()
    // hover 全量消息挂到节点上（D4 issue marker title）
    expect(tree2.nodes.find((n) => n.id === 'AHB')?.issues).toEqual([
      { node: 'AHB', level: 'error', message: 'AHB 分频 12 不在可选档位' },
    ])
    expect(tree2.nodes.find((n) => n.id === 'ADC')?.issues).toBeUndefined()
  })

  it('error 优先于 warning：同节点多级问题取最高级', () => {
    const cfgPll = { ...defaultClock(spec), source: 'PLL', pllSource: 'HSI' }
    const tree2 = buildClockTree(spec, cfgPll, computeClock(spec, cfgPll), [
      { node: 'ADC', level: 'warning', message: '警告' },
      { node: 'ADC', level: 'error', message: '错误' },
    ])
    expect(tree2.nodes.find((n) => n.id === 'ADC')?.issueLevel).toBe('error')
  })

  it('分组容器覆盖四类区域', () => {
    const labels = tree.groups.map((g) => g.label)
    expect(labels.some((l) => l.startsWith('Clock sources'))).toBe(true)
    expect(labels.some((l) => l.startsWith('PLL Max'))).toBe(true)
    expect(labels.some((l) => l.startsWith('System Clock'))).toBe(true)
    expect(labels.some((l) => l.startsWith('ADC Max'))).toBe(true)
  })
})

describe('buildClockTree 列式布局几何', () => {
  const cfg = defaultClock(spec)
  const tree = treeOf(spec, cfg)

  it('所有节点 x = 40 + column*200（无硬编码坐标表）', () => {
    for (const n of tree.nodes) {
      expect(n.x).toBe(X0 + n.column * COL_DX)
      expect(n.w).toBe(NODE_W)
      expect(n.h).toBe(NODE_H)
    }
  })

  it('列内按模型顺序堆叠：y = 60 + 行号*140', () => {
    const rows = new Map<number, number>()
    for (const n of tree.nodes) {
      // 模型顺序即节点数组顺序：同列节点依次占 0..k 行
      const expected = rows.get(n.column) ?? 0
      expect(n.y).toBe(Y0 + expected * ROW_DY)
      rows.set(n.column, expected + 1)
    }
  })

  it('核心列序保持：源→PLL→SYSCLK/AHB→APB→TIM→ADC', () => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get('HSI')?.column).toBe(0)
    expect(byId.get('HSE')?.column).toBe(0)
    expect(byId.get('PLL')?.column).toBe(1)
    expect(byId.get('SYSCLK')?.column).toBe(2)
    expect(byId.get('AHB')?.column).toBe(2)
    expect(byId.get('APB1')?.column).toBe(3)
    expect(byId.get('APB2')?.column).toBe(3)
    expect(byId.get('TIM1')?.column).toBe(4)
    expect(byId.get('TIM2')?.column).toBe(4)
    expect(byId.get('ADC')?.column).toBe(8)
    // 左右相对关系
    expect(byId.get('HSI')!.x).toBeLessThan(byId.get('PLL')!.x)
    expect(byId.get('PLL')!.x).toBeLessThan(byId.get('SYSCLK')!.x)
    expect(byId.get('SYSCLK')!.x).toBeLessThan(byId.get('APB1')!.x)
    expect(byId.get('APB1')!.x).toBeLessThan(byId.get('TIM1')!.x)
    expect(byId.get('TIM2')!.x).toBeLessThan(byId.get('ADC')!.x)
    // SYSCLK→AHB 同列上下
    expect(byId.get('AHB')!.x).toBe(byId.get('SYSCLK')!.x)
    expect(byId.get('AHB')!.y).toBeGreaterThan(byId.get('SYSCLK')!.y)
  })

  it('画布尺寸 = 最大列 x+NODE_W+40 × 最大 y+NODE_H+36', () => {
    const maxX = Math.max(...tree.nodes.map((n) => n.x + n.w))
    const maxY = Math.max(...tree.nodes.map((n) => n.y + n.h))
    expect(tree.width).toBe(maxX + 40)
    expect(tree.height).toBe(maxY + 36)
  })

  it('分组框 = 成员包围盒 + 留白（顶部 30 容纳标签，左右 16 留列间间隙）', () => {
    for (const g of tree.groups) {
      const members = tree.nodes.filter((n) => n.group === g.id)
      expect(members.length).toBeGreaterThan(0)
      const minX = Math.min(...members.map((n) => n.x))
      const minY = Math.min(...members.map((n) => n.y))
      const maxX = Math.max(...members.map((n) => n.x + n.w))
      const maxY = Math.max(...members.map((n) => n.y + n.h))
      expect(g.x).toBe(minX - 16)
      expect(g.y).toBe(minY - 30)
      expect(g.w).toBe(maxX - minX + 32)
      expect(g.h).toBe(maxY - minY + 30 + 18)
      // 成员完全落在框内
      for (const m of members) {
        expect(m.x).toBeGreaterThanOrEqual(g.x)
        expect(m.y).toBeGreaterThanOrEqual(g.y)
        expect(m.x + m.w).toBeLessThanOrEqual(g.x + g.w)
        expect(m.y + m.h).toBeLessThanOrEqual(g.y + g.h)
      }
    }
  })

  it('相邻列分组框互不重叠（列间留 8px 间隙）', () => {
    const gs = tree.groups
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const a = gs[i]!
        const b = gs[j]!
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(ox <= 0 || oy <= 0, `${a.id} 与 ${b.id} 重叠`).toBe(true)
      }
    }
  })

  it('无成员的分组不输出（如无外设数据时无 g-usart）', () => {
    const ids = tree.groups.map((g) => g.id)
    expect(ids).toContain('g-sources')
    expect(ids).toContain('g-pll')
    expect(ids).toContain('g-sys')
    expect(ids).toContain('g-tim')
    expect(ids).toContain('g-adc')
    expect(ids).not.toContain('g-usart')
    expect(ids).not.toContain('g-usb')
  })
})

describe('buildClockTree 连线', () => {
  const cfg = defaultClock(spec)
  const tree = treeOf(spec, cfg)

  it('所有连线为正交折线（每段水平或垂直）', () => {
    for (const e of tree.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1]!
        const b = e.points[i]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
      }
    }
  })

  it('PLL 直连档下 HSI→SYSCLK 激活、PLL→SYSCLK 未激活', () => {
    expect(tree.edges.find((e) => e.id === 'src-HSI-sys')?.active).toBe(true)
    expect(tree.edges.find((e) => e.id === 'pll-sys')?.active).toBe(false)
  })

  it('PLL 档下 PLL→SYSCLK 与对应源→PLL 激活', () => {
    const cfgPll = { ...defaultClock(spec), source: 'PLL', pllSource: 'HSE' }
    const tree2 = buildClockTree(spec, cfgPll, computeClock(spec, cfgPll))
    expect(tree2.edges.find((e) => e.id === 'pll-sys')?.active).toBe(true)
    expect(tree2.edges.find((e) => e.id === 'src-HSE-pll')?.active).toBe(true)
    expect(tree2.edges.find((e) => e.id === 'src-HSI-pll')?.active).toBe(false)
  })

  it('同列连线为竖直直线（SYSCLK→AHB：两点同 x）', () => {
    const e = tree.edges.find((x) => x.id === 'sys-ahb')!
    expect(e.points).toHaveLength(2)
    expect(e.points[0]!.x).toBe(e.points[1]!.x)
    expect(e.points[0]!.y).toBeLessThan(e.points[1]!.y)
  })
})

describe('buildClockTree 走线不穿过节点卡', () => {
  it('CH32V003F4P6 默认档', () => {
    expect(nodeBusters(treeOf(spec, defaultClock(spec)))).toEqual([])
  })

  it('CH32V003F4P6 PLL 档（源跨列汇入 SYSCLK）', () => {
    const cfg = { ...defaultClock(spec), source: 'PLL', pllSource: 'HSE' }
    expect(nodeBusters(treeOf(spec, cfg))).toEqual([])
  })

  it('CH32V003F4P6 含外设节点（HCLK→USART/SPI、APB1→I2C、ADC→P-ADC）', () => {
    const pc: PeripheralClocksData = {
      usart: { sourceDefault: 'HCLK', knob: 'baudrate' },
      spi: { sourceDefault: 'HCLK', knob: 'frequency', brg: { divs: [2, 4, 8, 16] } },
      i2c: { sourceDefault: 'APB1', knob: 'speed', maxKhz: 400 },
      adc: { source: 'APB2' },
    }
    const s = withPeripheralClocks(spec, pc)
    const cfg = defaultClock(s)
    const ctx = fakePeriCtx(v003.peripherals, pc, computeClock(s, cfg))
    expect(nodeBusters(treeOf(s, cfg, ctx))).toEqual([])
  })

  it('CH32V203C8T6 含外设 + USB（长跨列 PLL→USB）', () => {
    const s = getDeviceData('CH32V203C8T6')
    const pc: PeripheralClocksData = {
      usart: { sourceDefault: 'APB1', knob: 'baudrate' },
      spi: { sourceDefault: 'APB1', knob: 'frequency', brg: { divs: [2, 4, 8, 16] } },
      i2c: { sourceDefault: 'APB1', knob: 'speed', maxKhz: 400 },
      adc: { source: 'APB2' },
      usb: { autoPre: { '48': 1, '96': 2, '144': 3 }, validPllMhz: [48, 96, 144] },
    }
    const sp = withPeripheralClocks(s.clock, pc)
    const cfg = defaultClock(sp)
    const ctx = fakePeriCtx(s.peripherals, pc, computeClock(sp, cfg))
    expect(nodeBusters(treeOf(sp, cfg, ctx))).toEqual([])
  })

  it('CH32V307VCT6（8 个 USART 高列 + USB）', () => {
    const s = getDeviceData('CH32V307VCT6')
    const pc: PeripheralClocksData = {
      usart: { sourceDefault: 'APB1', sourceOverrides: { USART1: 'APB2' }, knob: 'baudrate' },
      spi: { sourceDefault: 'APB1', sourceOverrides: { SPI1: 'APB2' }, knob: 'frequency', brg: { divs: [2, 4, 8, 16] } },
      i2c: { sourceDefault: 'APB1', knob: 'speed', maxKhz: 400 },
      adc: { source: 'APB2', clkDiv: { programmable: true, bits: 4, default: 3, raw: true } },
      usb: { autoPre: { '48': 1, '96': 2, '144': 3 }, validPllMhz: [48, 96, 144] },
    }
    const sp = withPeripheralClocks(s.clock, pc)
    const cfg = defaultClock(sp)
    const ctx = fakePeriCtx(s.peripherals, pc, computeClock(sp, cfg))
    const layout = treeOf(sp, cfg, ctx)
    expect(nodeBusters(layout)).toEqual([])
    expect(layout.nodes.filter((n) => n.column === 5)).toHaveLength(8)
  })

  it('CH32X035C8T6（无 PLL，全部 HCLK 外设源）', () => {
    const s = getDeviceData('CH32X035C8T6')
    const pc: PeripheralClocksData = {
      usart: { sourceDefault: 'HCLK', knob: 'baudrate' },
      spi: { sourceDefault: 'HCLK', knob: 'frequency', brg: { divs: [2, 4, 8, 16] } },
      i2c: { sourceDefault: 'HCLK', knob: 'speed', maxKhz: 400 },
      adc: { source: 'SYSCLK', clkDiv: { programmable: true, bits: 4, default: 3, raw: true } },
    }
    const sp = withPeripheralClocks(s.clock, pc)
    const cfg = defaultClock(sp)
    const ctx = fakePeriCtx(s.peripherals, pc, computeClock(sp, cfg))
    expect(nodeBusters(treeOf(sp, cfg, ctx))).toEqual([])
  })

  it('CH582M（PLL 480VCO + CK32M ADC 域）', () => {
    const s = getDeviceData('CH582M')
    const pc: PeripheralClocksData = {
      usart: { sourceDefault: 'HCLK', knob: 'baudrate' },
      spi: { sourceDefault: 'HCLK', knob: 'frequency', brg: { linear: { min: 2, max: 255 } } },
      i2c: { sourceDefault: 'HCLK', knob: 'frequency', maxKhz: 400 },
      adc: { source: 'CK32M', fixedInMhz: 32, knob: 'samplingClock', enumMhz: { _3_2MHz: 3.2, _8MHz: 8 } },
    }
    const sp = withPeripheralClocks(s.clock, pc)
    const cfg = defaultClock(sp)
    const ctx = fakePeriCtx(s.peripherals, pc, computeClock(sp, cfg))
    expect(nodeBusters(treeOf(sp, cfg, ctx))).toEqual([])
  })
})

// ---------- M15 外设节点 ----------

const V003_PC: PeripheralClocksData = {
  usart: { sourceDefault: 'HCLK', knob: 'baudrate', baudErrorWarnPct: 3 },
  spi: { sourceDefault: 'HCLK', knob: 'frequency', brg: { divs: [2, 4, 8, 16, 32, 64, 128, 256] } },
  i2c: { sourceDefault: 'APB1', knob: 'speed', maxKhz: 400 },
  adc: { source: 'APB2', pre: { programmable: false } },
}

const V003_STATE: Record<string, PeripheralState> = {
  USART1: { enabled: true, params: { baudrate: 9600 } },
  SPI1: { enabled: false, params: {} },
  I2C1: { enabled: true, params: { speed: 400000 } },
  ADC1: { enabled: true, params: {} },
}

const V003_FREQS: PeripheralClockFreq[] = [
  {
    nodeId: 'P-USART1',
    periId: 'USART1',
    category: 'usart',
    sourceBus: 'HCLK',
    inMhz: 24,
    requested: 9600,
    actualMhz: 0.0096,
    dividerLabel: '÷250 (BRR)',
    errorPct: 0.16,
    issues: [],
  },
  {
    nodeId: 'P-SPI1',
    periId: 'SPI1',
    category: 'spi',
    sourceBus: 'HCLK',
    inMhz: 24,
    requested: 8000000,
    actualMhz: 6,
    dividerLabel: '÷4 (BRG)',
    issues: [],
  },
  {
    nodeId: 'P-I2C1',
    periId: 'I2C1',
    category: 'i2c',
    sourceBus: 'APB1',
    inMhz: 24,
    requested: 400000,
    actualMhz: 0.4,
    dividerLabel: null,
    issues: [{ node: 'P-I2C1', level: 'warning', message: 'I2C 400 kHz 接近上限' }],
  },
  {
    nodeId: 'P-ADC1',
    periId: 'ADC1',
    category: 'adc',
    sourceBus: 'APB2',
    inMhz: 24,
    requested: 3,
    actualMhz: null,
    dividerLabel: 'raw 0b0011',
    issues: [],
  },
]

const V003_CTX: PeripheralClockContext = {
  peripherals: v003.peripherals,
  state: V003_STATE,
  periFreqs: V003_FREQS,
}

describe('外设节点（M15 peri 上下文）', () => {
  const s = withPeripheralClocks(spec, V003_PC)
  const cfg = defaultClock(s)
  const tree = treeOf(s, cfg, V003_CTX)
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))

  it('每个实例一个节点：label/periId/badge/列/分组', () => {
    for (const [id, label, column, group] of [
      ['P-USART1', 'USART1', 5, 'g-usart'],
      ['P-SPI1', 'SPI1', 6, 'g-spi'],
      ['P-I2C1', 'I2C1', 7, 'g-i2c'],
      ['P-ADC1', 'ADC1', 8, 'g-adc'],
    ] as const) {
      const n = byId.get(id)
      expect(n, id).toBeTruthy()
      expect(n!.label).toBe(label)
      expect(n!.periId).toBe(label)
      expect(n!.badge).toBe('fixed')
      expect(n!.column).toBe(column)
      expect(n!.group).toBe(group)
      expect(n!.lockable).toBe(false)
      expect(n!.locked).toBe(false)
    }
    expect(tree.groups.map((g) => g.id)).toEqual(
      expect.arrayContaining(['g-usart', 'g-spi', 'g-i2c', 'g-adc']),
    )
  })

  it('未启用实例仍渲染但 active=false（dim）', () => {
    expect(byId.get('P-USART1')?.active).toBe(true)
    expect(byId.get('P-SPI1')?.active).toBe(false)
    expect(byId.get('P-SPI1')).toBeTruthy()
  })

  it('usart periParam 为 number 控件，value 取工程状态参数', () => {
    const c = byId.get('P-USART1')!.control!
    expect(c.field).toBe('periParam')
    expect(c.periId).toBe('USART1')
    expect(c.paramKey).toBe('baudrate')
    expect(c.kind).toBe('number')
    expect(c.value).toBe(9600)
    expect(c.min).toBe(1200)
    expect(c.max).toBe(4000000)
  })

  it('i2c periParam 为 select 控件，options 标签用原生单位字符串', () => {
    const c = byId.get('P-I2C1')!.control!
    expect(c.kind).toBe('select')
    expect(c.paramKey).toBe('speed')
    expect(c.options).toEqual([
      { value: 100000, label: '100000' },
      { value: 400000, label: '400000' },
    ])
    expect(c.value).toBe(400000)
  })

  it('maxMhz：SPI=总线/2、I2C=maxKhz/1000、ADC=spec.adc.maxMhz、USART=null', () => {
    expect(byId.get('P-SPI1')?.maxMhz).toBe(12) // HCLK 24 / 2
    expect(byId.get('P-I2C1')?.maxMhz).toBe(0.4) // 400 kHz
    expect(byId.get('P-ADC1')?.maxMhz).toBe(14) // V003 spec.adc.maxMhz
    expect(byId.get('P-USART1')?.maxMhz).toBeNull()
  })

  it('inMhz/outMhz 来自 periFreqs；ADC raw 级 outMhz=null', () => {
    expect(byId.get('P-USART1')?.inMhz).toBe(24)
    expect(byId.get('P-USART1')?.outMhz).toBe(0.0096)
    expect(byId.get('P-ADC1')?.outMhz).toBeNull()
  })

  it('requestedLabel/actualLabel 来自 periFreqs（原生单位 + 误差）', () => {
    const u = byId.get('P-USART1')!
    expect(u.requestedLabel).toBe('9600 baud')
    expect(u.actualLabel).toContain('实际 0.01 MHz')
    expect(u.actualLabel).toContain('误差 0.16%')
    expect(byId.get('P-SPI1')?.requestedLabel).toBe('8 MHz')
    expect(byId.get('P-ADC1')?.requestedLabel).toBe('raw 3')
  })

  it('issues 从 periFreqs 取：issueLevel 与全量消息', () => {
    const i2c = byId.get('P-I2C1')!
    expect(i2c.issueLevel).toBe('warning')
    expect(i2c.overLimit).toBe(false)
    expect(i2c.issues).toHaveLength(1)
    expect(i2c.issues![0]!.message).toContain('400 kHz')
  })

  it('边：HCLK→AHB 节点、APB1→I2C、ADC 域→P-ADCx，active 跟随实例', () => {
    const edge = (id: string) => tree.edges.find((e) => e.id === id)!
    expect(edge('peri-P-USART1').from).toBe('AHB')
    expect(edge('peri-P-SPI1').from).toBe('AHB')
    expect(edge('peri-P-SPI1').active).toBe(false)
    expect(edge('peri-P-I2C1').from).toBe('APB1')
    expect(edge('peri-P-ADC1').from).toBe('ADC')
    expect(edge('peri-P-USART1').to).toBe('P-USART1')
  })
})

describe('外设节点：ADC raw（CTLR3.CLK_DIV）', () => {
  const v203 = getDeviceData('CH32V203C8T6')
  const pc: PeripheralClocksData = {
    usart: { sourceDefault: 'APB1', knob: 'baudrate' },
    spi: { sourceDefault: 'APB1', knob: 'frequency', brg: { divs: [2, 4, 8, 16] } },
    i2c: { sourceDefault: 'APB1', knob: 'speed', maxKhz: 400 },
    adc: { source: 'APB2', clkDiv: { programmable: true, bits: 4, default: 3, raw: true } },
  }
  const s = withPeripheralClocks(v203.clock, pc)
  const cfg = defaultClock(s)
  const tree = treeOf(s, cfg, fakePeriCtx(v203.peripherals, pc, computeClock(s, cfg)))
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))

  it('adcClkDiv 控件：select + 16 档 raw 标签 + min/max', () => {
    const c = byId.get('P-ADC1')!.control as ClockNodeControl
    expect(c.field).toBe('adcClkDiv')
    expect(c.kind).toBe('select')
    expect(c.options).toHaveLength(16)
    expect(c.options![5]).toEqual({ value: 5, label: 'raw 5 (0b0101)' })
    expect(c.options![0]!.label).toBe('raw 0 (0b0000)')
    expect(c.options![15]!.value).toBe(15)
    expect(c.min).toBe(0)
    expect(c.max).toBe(15)
    expect(c.value).toBe(3) // 数据层 default
    expect(byId.get('P-ADC1')!.badge).toBe('raw')
    expect(byId.get('P-ADC2')?.control?.field).toBe('adcClkDiv')
  })

  it('cfg.adcClkDiv 覆盖控件当前值', () => {
    const cfg5 = { ...cfg, adcClkDiv: 5 }
    const t = treeOf(s, cfg5, fakePeriCtx(v203.peripherals, pc, computeClock(s, cfg5)))
    expect(t.nodes.find((n) => n.id === 'P-ADC1')?.control?.value).toBe(5)
  })

  it('ADC 节点锁定时 adcClkDiv 控件置灰；applyClockControl 忽略修改', () => {
    const lockedCfg = { ...cfg, locked: ['ADC'] }
    const t = treeOf(s, lockedCfg, fakePeriCtx(v203.peripherals, pc, computeClock(s, lockedCfg)))
    const c = t.nodes.find((n) => n.id === 'P-ADC1')!.control!
    expect(c.fixed).toBe(true)
    expect(applyClockControl(lockedCfg, c, 5)).toBe(lockedCfg)
  })

  it('ADC→P-ADC 同列垂直边（相邻行两点同 x）', () => {
    const e = tree.edges.find((x) => x.id === 'peri-P-ADC1')!
    expect(e.points).toHaveLength(2)
    expect(e.points[0]!.x).toBe(e.points[1]!.x)
    expect(e.points[1]!.y - e.points[0]!.y).toBe(32) // 行间距 140 - 节点高 108
  })

  it('applyClockControl adcClkDiv：Number + min/max 夹取', () => {
    const c = byId.get('P-ADC1')!.control!
    expect(applyClockControl(cfg, c, 5).adcClkDiv).toBe(5)
    expect(applyClockControl(cfg, c, 99).adcClkDiv).toBe(15)
    expect(applyClockControl(cfg, c, -3).adcClkDiv).toBe(0)
    expect(applyClockControl(cfg, c, '9').adcClkDiv).toBe(9)
  })
})

describe('USB 时钟域节点', () => {
  const v203 = getDeviceData('CH32V203C8T6')
  const pc: PeripheralClocksData = {
    adc: { source: 'APB2' },
    usb: { autoPre: { '48': 1, '96': 2, '144': 3 }, validPllMhz: [48, 96, 144] },
  }
  const s = withPeripheralClocks(v203.clock, pc)
  const cfg = defaultClock(s)
  const freqs = computeClock(s, cfg)
  const ctx: PeripheralClockContext = {
    peripherals: v203.peripherals,
    state: {},
    periFreqs: [
      {
        nodeId: 'USB',
        periId: 'USB',
        category: 'usb',
        sourceBus: 'PLL',
        inMhz: 48,
        requested: 48,
        actualMhz: 48,
        dividerLabel: 'USBPRE ÷1 (HAL auto)',
        issues: [{ node: 'USB', level: 'warning', message: 'USB 时钟非法（示例）' }],
      },
    ],
  }
  const tree = buildClockTree(s, cfg, freqs, undefined, ctx)
  const usb = tree.nodes.find((n) => n.id === 'USB')!

  it('column 9 / g-usb / badge derived / control null / lockable=false', () => {
    expect(usb.column).toBe(9)
    expect(usb.group).toBe('g-usb')
    expect(usb.badge).toBe('derived')
    expect(usb.control).toBeNull()
    expect(usb.lockable).toBe(false)
    expect(tree.groups.map((g) => g.id)).toContain('g-usb')
  })

  it('频率与双行标签来自 periFreqs；PLL→USB 边存在', () => {
    expect(usb.inMhz).toBe(48)
    expect(usb.outMhz).toBe(48)
    expect(usb.requestedLabel).toBe('48 MHz')
    expect(usb.actualLabel).toContain('实际 48 MHz')
    const e = tree.edges.find((x) => x.id === 'pll-usb')!
    expect(e.from).toBe('PLL')
    expect(e.to).toBe('USB')
    expect(e.active).toBe(true)
  })

  it('issueLevel 取 periFreqs 问题级别', () => {
    expect(usb.issueLevel).toBe('warning')
    expect(usb.issues).toHaveLength(1)
  })
})

describe('CH582M ADC 旋钮镜像外设参数', () => {
  const s582 = getDeviceData('CH582M')
  const pc: PeripheralClocksData = {
    adc: {
      source: 'CK32M',
      fixedInMhz: 32,
      knob: 'samplingClock',
      enumMhz: { _3_2MHz: 3.2, _5_33MHz: 5.33, _4MHz: 4, _8MHz: 8 },
    },
  }
  const s = withPeripheralClocks(s582.clock, pc)
  const cfg = defaultClock(s)
  const freqs = computeClock(s, cfg)
  const ctx: PeripheralClockContext = {
    peripherals: s582.peripherals,
    state: { ADC: { enabled: true, params: { samplingClock: '_8MHz' } } },
    periFreqs: [
      {
        nodeId: 'P-ADC',
        periId: 'ADC',
        category: 'adc',
        sourceBus: 'CK32M',
        inMhz: 32,
        requested: '_8MHz',
        actualMhz: 8,
        dividerLabel: null,
        issues: [],
      },
    ],
  }
  const tree = buildClockTree(s, cfg, freqs, undefined, ctx)
  const adc = tree.nodes.find((n) => n.id === 'P-ADC')!

  it('knob → periParam select，value 取工程状态，label 用 enumMhz 换算', () => {
    expect(adc.control?.field).toBe('periParam')
    expect(adc.control?.paramKey).toBe('samplingClock')
    expect(adc.control?.kind).toBe('select')
    expect(adc.control?.value).toBe('_8MHz')
    expect(adc.control?.options?.map((o) => o.value)).toEqual(['_3_2MHz', '_5_33MHz', '_4MHz', '_8MHz'])
    expect(adc.requestedLabel).toBe('8 MHz')
    expect(adc.badge).toBe('fixed')
    expect(adc.column).toBe(8)
    // 边由 ADC 域连出（CK32M 固定域映射到 ADC 域节点）
    expect(tree.edges.find((e) => e.id === 'peri-P-ADC')?.from).toBe('ADC')
  })
})

describe('applyPeripheralClockControl', () => {
  const control: ClockNodeControl = {
    kind: 'number',
    field: 'periParam',
    periId: 'USART1',
    paramKey: 'baudrate',
    label: '波特率',
    value: 115200,
  }

  it('合并 params 写回，保留 enabled/remap，且不修改入参', () => {
    const st: PeripheralState = { enabled: true, params: { baudrate: 115200, parity: 'ParityNone' }, remap: 1 }
    const next = applyPeripheralClockControl(st, control, 9600)
    expect(next).not.toBe(st)
    expect(next.enabled).toBe(true)
    expect(next.remap).toBe(1)
    expect(next.params).toEqual({ baudrate: 9600, parity: 'ParityNone' })
    expect(st.params.baudrate).toBe(115200)
  })

  it('非 periParam 控件原样返回（时钟配置控件由 applyClockControl 处理）', () => {
    const st: PeripheralState = { enabled: true, params: {} }
    const ahb: ClockNodeControl = { kind: 'select', field: 'ahb', label: '分频', value: 1 }
    expect(applyPeripheralClockControl(st, ahb, 2)).toBe(st)
  })

  it('applyClockControl 对 periParam 返回原 ClockConfig（视图层路由）', () => {
    const cfg = defaultClock(spec)
    expect(applyClockControl(cfg, control, 9600)).toBe(cfg)
  })
})

describe('applyClockControl', () => {
  const cfg = defaultClock(spec)

  it('修改 AHB 分频', () => {
    const next = applyClockControl(cfg, { kind: 'select', field: 'ahb', label: '分频', value: 1 }, 4)
    expect(next.ahb).toBe(4)
    expect(next.source).toBe('HSI')
  })

  it('修改 SYSCLK 源', () => {
    const next = applyClockControl(cfg, { kind: 'select', field: 'source', label: '时钟源', value: 'HSI' }, 'PLL')
    expect(next.source).toBe('PLL')
  })

  it('修改 PLL 倍频参数', () => {
    const next = applyClockControl(cfg, { kind: 'select', field: 'pll', pllKey: 'mul', label: '倍频', value: 2 }, 2)
    expect(next.pll?.mul).toBe(2)
  })

  it('修改晶振频率', () => {
    const next = applyClockControl(cfg, { kind: 'number', field: 'hxtalMhz', label: '晶振频率', value: 24 }, 12)
    expect(next.hxtalMhz).toBe(12)
  })

  it('adcClkDiv 携带 min/max 时夹取（越界值不写入非法 raw）', () => {
    const control: ClockNodeControl = {
      kind: 'select',
      field: 'adcClkDiv',
      label: 'CTLR3.CLK_DIV',
      value: 3,
      min: 0,
      max: 15,
    }
    expect(applyClockControl(cfg, control, 20).adcClkDiv).toBe(15)
    expect(applyClockControl(cfg, control, -1).adcClkDiv).toBe(0)
  })
})

describe('真实 clock.json peripheralClocks：7 芯片数据驱动', () => {
  const CHIPS = [
    'CH32V003F4P6',
    'CH32V103C8T6',
    'CH32V203C8T6',
    'CH32V307VCT6',
    'CH32X035C8T6',
    'CH32H417QEU6',
    'CH582M',
  ]

  for (const chip of CHIPS) {
    it(`${chip}：外设节点存在、走线不穿节点、USB 节点与数据一致`, () => {
      const d = getDeviceData(chip)
      const pc = d.clock.peripheralClocks
      expect(pc).toBeTruthy()
      const cfg = defaultClock(d.clock)
      const freqs = computeClock(d.clock, cfg)
      const ctx = fakePeriCtx(d.peripherals, pc!, freqs)
      const layout = buildClockTree(d.clock, cfg, freqs, undefined, ctx)
      expect(nodeBusters(layout)).toEqual([])
      const ids = layout.nodes.map((n) => n.id)
      // 每个实例都有节点（含未启用实例的渲染位）
      for (const inst of d.peripherals.usart) expect(ids).toContain(`P-${inst.id}`)
      for (const inst of d.peripherals.spi) expect(ids).toContain(`P-${inst.id}`)
      for (const inst of d.peripherals.i2c) expect(ids).toContain(`P-${inst.id}`)
      for (const inst of d.peripherals.adc) expect(ids).toContain(`P-${inst.id}`)
      expect(ids.includes('USB')).toBe(!!pc!.usb)
      if (pc!.usb) expect(layout.nodes.find((n) => n.id === 'USB')!.column).toBe(9)
    })
  }
})

describe('formatMhz', () => {
  it('整数不带小数点', () => {
    expect(formatMhz(48)).toBe('48 MHz')
    expect(formatMhz(24)).toBe('24 MHz')
  })
  it('最多 3 位小数且截断尾零', () => {
    expect(formatMhz(14.5)).toBe('14.5 MHz')
    expect(formatMhz(1.23456)).toBe('1.235 MHz')
    expect(formatMhz(12.25)).toBe('12.25 MHz')
  })
  it('null/undefined 显示占位符', () => {
    expect(formatMhz(null)).toBe('—')
    expect(formatMhz(undefined)).toBe('—')
  })
})
