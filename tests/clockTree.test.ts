// 时钟树布局单元测试：节点/连线/分组几何与 applyClockControl / formatMhz
// 数据：真实 CH32V003F4P6（HSI 24MHz、HSE 晶振、PLL 固定 ×2、APB1 固定 1）
import { describe, it, expect } from 'vitest'
import { computeClock, defaultClock } from '../src/lib/clock'
import { buildClockTree, applyClockControl, formatMhz } from '../src/lib/clock/tree'
import { getDeviceData } from '../src/data/device'

const spec = getDeviceData('CH32V003F4P6').clock

describe('buildClockTree 节点', () => {
  const cfg = defaultClock(spec)
  const tree = buildClockTree(spec, cfg, computeClock(spec, cfg))

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

describe('buildClockTree 连线', () => {
  const cfg = defaultClock(spec)
  const tree = buildClockTree(spec, cfg, computeClock(spec, cfg))

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
