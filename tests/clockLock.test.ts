// M3.4 时钟锁定 + Resolve clock issues 自动修复单元测试。
// 数据：真实 CH32V003F4P6（HSI 24 / HSE 4~32 / PLL 固定 ×2）与 CH582M（PLL 480MHz VCO）。
import { describe, it, expect } from 'vitest'
import type { ClockConfig } from '@/model/types'
import {
  applyClockPreset,
  computeClock,
  defaultClock,
  matchPreset,
  mergeClockConfig,
  resolveClockIssues,
  solvePll,
  validateClock,
} from '@/model/clock'
import { applyClockControl, buildClockTree } from '@/model/clock/tree'
import type { ClockNodeControl } from '@/model/clock/tree'
import { getDeviceData } from '@/model/device'

const spec = getDeviceData('CH32V003F4P6').clock

/** 最小合法时钟配置（HSI 直连、全分频 1） */
function cfg(partial: Partial<ClockConfig> = {}): ClockConfig {
  return { source: 'HSI', ahb: 1, apb1: 1, apb2: 1, ...partial }
}

describe('ClockConfig.locked 保留', () => {
  it('mergeClockConfig 保留 locked 数组（拷贝）', () => {
    const locked = ['AHB', 'PLL']
    const merged = mergeClockConfig(spec, { source: 'PLL', locked })
    expect(merged.locked).toEqual(locked)
    expect(merged.locked).not.toBe(locked)
  })

  it('无 locked 字段时保持向后兼容（不产生 undefined 属性）', () => {
    const merged = mergeClockConfig(spec, { ahb: 2 })
    expect('locked' in merged).toBe(false)
  })

  it('applyClockControl 忽略锁定节点的修改', () => {
    const control: ClockNodeControl = { kind: 'select', field: 'ahb', label: '分频', value: 1 }
    const lockedCfg = cfg({ locked: ['AHB'] })
    expect(applyClockControl(lockedCfg, control, 4)).toBe(lockedCfg)
    expect(applyClockControl(cfg(), control, 4).ahb).toBe(4)
  })

  it('锁定 HSE 时晶振修改被忽略', () => {
    const control: ClockNodeControl = { kind: 'number', field: 'hxtalMhz', label: '晶振频率', value: 24 }
    const lockedCfg = cfg({ hxtalMhz: 8, locked: ['HSE'] })
    expect(applyClockControl(lockedCfg, control, 16).hxtalMhz).toBe(8)
  })
})

describe('matchPreset 锁定字段（显式 skipLocked）', () => {
  it('默认严格匹配（代码生成安全）：locked 不改变匹配结果', () => {
    const hse8 = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 8, locked: ['HSE'] })
    expect(matchPreset(spec, hse8)).toBeNull()
  })

  it('skipLocked：HSE 8MHz 锁定后视为通配，命中 24MHz 预设', () => {
    const hse8 = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 8, locked: ['HSE'] })
    expect(matchPreset(spec, hse8, { skipLocked: true })?.id).toBe('24MHZ_HSE')
    // 未锁定仍严格比较
    expect(matchPreset(spec, { ...hse8, locked: [] }, { skipLocked: true })).toBeNull()
  })

  it('skipLocked：PLL 参数不同时锁定 PLL 不再比较源/倍频', () => {
    const pll1 = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSI', pll: { mul: 1 }, locked: ['PLL'] })
    expect(matchPreset(spec, pll1)).toBeNull()
    expect(matchPreset(spec, pll1, { skipLocked: true })?.id).toBe('48MHZ_HSI')
  })

  it('未锁定字段仍参与比较（只锁 HSE 不能掩盖 APB2 差异）', () => {
    const c = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 24, apb2: 2, locked: ['HSE'] })
    expect(matchPreset(spec, c, { skipLocked: true })).toBeNull()
  })
})

describe('applyClockPreset 尊重锁定节点', () => {
  const preset = spec.presets.find((p) => p.id === '48MHZ_HSE')!

  it('未锁定：应用预设覆盖 HSE 频率与源', () => {
    const base = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 8 })
    const next = applyClockPreset(spec, base, preset)
    expect(next.source).toBe('PLL')
    expect(next.pllSource).toBe('HSE')
    expect(next.hxtalMhz).toBe(24)
    expect(next.pll?.mul).toBe(2)
  })

  it('锁定 HSE：保留 8MHz 晶振，其余字段按预设', () => {
    const base = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 8, locked: ['HSE'] })
    const next = applyClockPreset(spec, base, preset)
    expect(next.hxtalMhz).toBe(8)
    expect(next.source).toBe('PLL')
    expect(next.pllSource).toBe('HSE')
    expect(next.locked).toEqual(['HSE'])
  })

  it('锁定 AHB：保留分频，其余字段按预设', () => {
    const base = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 24, ahb: 4, locked: ['AHB'] })
    const next = applyClockPreset(spec, base, spec.presets.find((p) => p.id === '48MHZ_HSI')!)
    expect(next.ahb).toBe(4)
    expect(next.source).toBe('PLL')
    expect(next.pllSource).toBe('HSI')
  })

  it('锁定 SYSCLK：源不变', () => {
    const base = mergeClockConfig(spec, { source: 'HSI', locked: ['SYSCLK'] })
    const next = applyClockPreset(spec, base, preset)
    expect(next.source).toBe('HSI')
    // 未锁定的 PLL/HSE 仍可被预设更新
    expect(next.pllSource).toBe('HSE')
  })
})

describe('solvePll 尊重锁定节点', () => {
  it('PLL 锁定：只保留当前 PLL 源与参数命中的候选', () => {
    const current = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSE', pll: { mul: 2 } })
    expect(solvePll(spec, 48).map((c) => c.source)).toEqual(['HSI', 'HSE'])
    const locked = solvePll(spec, 48, undefined, { locked: ['PLL'], current })
    expect(locked).toHaveLength(1)
    expect(locked[0].source).toBe('HSE')
  })

  it('HSE 锁定：使用当前晶振频率解算（8MHz×2=16）', () => {
    const current = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSE', hxtalMhz: 8, pll: { mul: 2 } })
    const locked = solvePll(spec, 16, undefined, { locked: ['HSE'], current })
    expect(locked).toHaveLength(1)
    expect(locked[0].hxtalMhz).toBe(8)
    expect(locked[0].outMhz).toBe(16)
    // 未锁定 HSE 时仍沿用数据默认 24MHz，无 16MHz 候选
    expect(solvePll(spec, 16)).toEqual([])
  })

  it('SYSCLK 锁定在 HSI：不能切到 PLL → 无候选', () => {
    expect(solvePll(spec, 48, undefined, { locked: ['SYSCLK'], current: cfg() })).toEqual([])
  })
})

describe('resolveClockIssues 自动修复', () => {
  it('ADC warning 档（PLL48/AHB1 → ADC 24MHz）可收敛到零问题配置', () => {
    // D4bis：V003 ADC=HCLK÷2；默认 HSI 档 12MHz 已无 warning，故显式用 PLL 48MHz 触发
    const result = resolveClockIssues(spec, cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 2 } }))
    expect(result).not.toBeNull()
    expect(result!.issues).toEqual([])
    expect(validateClock(spec, result!.config)).toEqual([])
  })

  it('非法分频（APB2=3）修复后无 error / warning', () => {
    const result = resolveClockIssues(spec, cfg({ apb2: 3 }))
    expect(result).not.toBeNull()
    expect(validateClock(spec, result!.config).filter((i) => i.level === 'error')).toEqual([])
    expect(validateClock(spec, result!.config)).toEqual([])
  })

  it('锁定节点保留当前值（AHB=1）', () => {
    const current = {
      ...cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 2 } }),
      locked: ['AHB'],
    }
    const result = resolveClockIssues(spec, current)
    expect(result).not.toBeNull()
    expect(result!.config.ahb).toBe(1)
    expect(result!.config.locked).toEqual(['AHB'])
  })

  it('锁定非法值（APB2=3 被锁）时无解 → null', () => {
    expect(resolveClockIssues(spec, cfg({ apb2: 3, locked: ['APB2'] }))).toBeNull()
  })

  it('锁定 SYSCLK（HSI）时修复不改变时钟源', () => {
    // APB2=3 非法作为修复触发（默认档已无 ADC warning），SYSCLK 锁定保留 HSI
    const result = resolveClockIssues(spec, cfg({ apb2: 3, locked: ['SYSCLK'] }))
    expect(result).not.toBeNull()
    expect(result!.config.source).toBe('HSI')
    expect(validateClock(spec, result!.config)).toEqual([])
  })

  it('配置本身无问题时返回 null（按钮进入“No clock issues”态）', () => {
    expect(resolveClockIssues(spec, cfg({ source: 'HSE', hxtalMhz: 8 }))).toBeNull()
  })

  it('CH582M 固定 VCO：非法 div=2 可修复；锁定非法 PLL 时改走 HSE 直连', () => {
    const spec582 = getDeviceData('CH582M').clock
    const bad = mergeClockConfig(spec582, { source: 'PLL', pllSource: 'HSE', pll: { div: 2 } })
    const result = resolveClockIssues(spec582, bad)
    expect(result).not.toBeNull()
    expect(validateClock(spec582, result!.config).filter((i) => i.level === 'error')).toEqual([])
    const locked = resolveClockIssues(spec582, { ...bad, locked: ['PLL'] })
    expect(locked).not.toBeNull()
    expect(locked!.config.source).toBe('HSE')
    expect(locked!.config.pll).toEqual({ div: 2 })
  })
})

describe('时钟树锁定标记', () => {
  it('锁定节点标记 locked 且控件置灰；不可配置节点 lockable=false', () => {
    const current = { ...defaultClock(spec), locked: ['AHB', 'HSE'] }
    const tree = buildClockTree(spec, current, computeClock(spec, current))
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get('AHB')?.locked).toBe(true)
    expect(byId.get('AHB')?.lockable).toBe(true)
    expect(byId.get('AHB')?.control?.fixed).toBe(true)
    expect(byId.get('HSE')?.locked).toBe(true)
    expect(byId.get('HSE')?.control?.fixed).toBe(true)
    expect(byId.get('PLL')?.locked).toBe(false)
    expect(byId.get('HSI')?.lockable).toBe(false)
    expect(byId.get('TIM1')?.lockable).toBe(false)
  })
})