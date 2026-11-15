// 时钟核心单元测试：computeClock / validateClock / solvePll / defaultClock /
// mergeClockConfig / matchPreset / nearestPreset / sourceFreqMhz / pllOutMhz
// 数据：真实 CH32V003F4P6（HSI 24MHz、PLL 固定 ×2、AHB 1..256、APB2 1/2/4/8/16、APB1 固定 1）
import { describe, it, expect } from 'vitest'
import type { ClockConfig } from '../src/types'
import {
  computeClock,
  validateClock,
  solvePll,
  defaultClock,
  mergeClockConfig,
  matchPreset,
  nearestPreset,
  sourceFreqMhz,
  pllOutMhz,
} from '../src/lib/clock'
import { getDeviceData } from '../src/data/device'

const spec = getDeviceData('CH32V003F4P6').clock

/** 最小合法时钟配置（HSI 直连、全分频 1） */
function cfg(partial: Partial<ClockConfig> = {}): ClockConfig {
  return { source: 'HSI', ahb: 1, apb1: 1, apb2: 1, ...partial }
}

describe('sourceFreqMhz', () => {
  it('HSI 返回 24MHz', () => {
    expect(sourceFreqMhz(spec, 'HSI', cfg())).toBe(24)
  })
  it('HSE 未指定晶振时返回默认 24MHz', () => {
    expect(sourceFreqMhz(spec, 'HSE', cfg())).toBe(24)
  })
  it('HSE 指定 hxtalMhz=8 时返回 8', () => {
    expect(sourceFreqMhz(spec, 'HSE', cfg({ hxtalMhz: 8 }))).toBe(8)
  })
  it('PLL 源返回 null（需先算 pllIn）', () => {
    expect(sourceFreqMhz(spec, 'PLL', cfg())).toBeNull()
  })
  it('未知源返回 null', () => {
    expect(sourceFreqMhz(spec, 'LSI', cfg())).toBeNull()
  })
})

describe('pllOutMhz', () => {
  it('空参数时使用默认 mul=2：24→48', () => {
    expect(pllOutMhz(spec, 24, {})).toBe(48)
  })
  it('显式 mul=2：24→48', () => {
    expect(pllOutMhz(spec, 24, { mul: 2 })).toBe(48)
  })
  it('小输入：8×2=16', () => {
    expect(pllOutMhz(spec, 8, { mul: 2 })).toBe(16)
  })
})

describe('computeClock 频率链', () => {
  it('HSI 直连：全链 24MHz，无 PLL', () => {
    const f = computeClock(spec, cfg())
    expect(f.pllInMhz).toBeNull()
    expect(f.pllOutMhz).toBeNull()
    expect(f.sysclkMhz).toBe(24)
    expect(f.hclkMhz).toBe(24)
    expect(f.pclk1Mhz).toBe(24)
    expect(f.pclk2Mhz).toBe(24)
  })

  it('PLL HSI×2=48MHz', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 2 } }))
    expect(f.pllInMhz).toBe(24)
    expect(f.pllOutMhz).toBe(48)
    expect(f.sysclkMhz).toBe(48)
  })

  it('PLL HSE 24MHz×2=48MHz', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSE', hxtalMhz: 24, pll: { mul: 2 } }))
    expect(f.pllInMhz).toBe(24)
    expect(f.pllOutMhz).toBe(48)
    expect(f.sysclkMhz).toBe(48)
  })

  it('PLL HSE 8MHz×2=16MHz', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSE', hxtalMhz: 8, pll: { mul: 2 } }))
    expect(f.pllInMhz).toBe(8)
    expect(f.pllOutMhz).toBe(16)
    expect(f.sysclkMhz).toBe(16)
  })

  it('HSE 8MHz 直连：sysclk=8，无 PLL', () => {
    const f = computeClock(spec, cfg({ source: 'HSE', hxtalMhz: 8 }))
    expect(f.pllInMhz).toBeNull()
    expect(f.sysclkMhz).toBe(8)
    expect(f.hclkMhz).toBe(8)
  })

  it('AHB 分频：48/8=6', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', ahb: 8 }))
    expect(f.hclkMhz).toBe(6)
    expect(f.pclk1Mhz).toBe(6)
    expect(f.pclk2Mhz).toBe(6)
  })

  it('AHB 支持非 2 幂档位：48/3=16', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', ahb: 3 }))
    expect(f.hclkMhz).toBe(16)
  })

  it('APB2 分频：48/16=3，APB1 固定 1（=hclk）', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', apb2: 16 }))
    expect(f.pclk2Mhz).toBe(3)
    expect(f.pclk1Mhz).toBe(48)
  })

  it('ADC 时钟取自 APB2：sysclk 48、apb2=4 → 12MHz', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', apb2: 4 }))
    expect(f.pclk2Mhz).toBe(12)
    expect(f.adcMhz).toBe(12)
  })

  it('ADC 时钟随 sysclk 直通（默认档 APB2/1）', () => {
    const f = computeClock(spec, cfg())
    expect(f.adcMhz).toBe(24)
  })

  it('定时器域 = SYSCLK（V003 timerClock=sysclk）：apb2=4 时 pclk2Tim 仍为 48', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', apb2: 4 }))
    expect(f.pclk2Mhz).toBe(12)
    expect(f.pclk2TimMhz).toBe(48)
    expect(f.pclk1TimMhz).toBe(48)
  })

  it('HSI 24 + ahb=2：hclk=12、pclk1=12、adc=pclk2=12', () => {
    const f = computeClock(spec, cfg({ ahb: 2 }))
    expect(f.hclkMhz).toBe(12)
    expect(f.pclk1Mhz).toBe(12)
    expect(f.adcMhz).toBe(12)
  })
})

describe('validateClock 越界与非法分支', () => {
  it('默认 HSI 档：仅 1 条 ADC 超建议上限的 warning（24 > 14）', () => {
    const issues = validateClock(spec, defaultClock(spec))
    expect(issues).toHaveLength(1)
    expect(issues[0].node).toBe('ADC')
    expect(issues[0].level).toBe('warning')
  })

  it('HSE 晶振低于下限 4MHz → error', () => {
    const issues = validateClock(spec, cfg({ source: 'HSE', hxtalMhz: 3 }))
    expect(issues.some((i) => i.node === 'HSE' && i.level === 'error')).toBe(true)
  })

  it('HSE 晶振高于上限 32MHz → error', () => {
    const issues = validateClock(spec, cfg({ source: 'HSE', hxtalMhz: 33 }))
    expect(issues.some((i) => i.node === 'HSE' && i.level === 'error')).toBe(true)
  })

  it('HSE 8MHz 直连：完全无问题', () => {
    expect(validateClock(spec, cfg({ source: 'HSE', hxtalMhz: 8 }))).toEqual([])
  })

  it('PLL 源非法（LSI）→ PLL 源 error + SYSCLK 为 0 error', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'LSI' }))
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors.some((i) => i.message.includes('PLL 源 LSI 不合法'))).toBe(true)
    expect(errors.some((i) => i.message.includes('SYSCLK 为 0'))).toBe(true)
  })

  it('PLL 参数 mul=3 不在档位 → error', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 3 } }))
    expect(issues.some((i) => i.message.includes('倍频=3'))).toBe(true)
  })

  it('PLL HSI mul=3 连锁超频：PLL 输出/SYSCLK/AHB/APB1/APB2 全部 error', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 3 } }))
    const errNodes = issues.filter((i) => i.level === 'error').map((i) => i.node)
    expect(errNodes).toContain('PLL')
    expect(errNodes).toContain('SYSCLK')
    expect(errNodes).toContain('AHB')
    expect(errNodes).toContain('APB1')
    expect(errNodes).toContain('APB2')
  })

  it('PLL HSE 32MHz×2=64 超过 PLL 上限 48 → error（晶振本身合法）', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSE', hxtalMhz: 32 }))
    expect(issues.some((i) => i.message.includes('PLL 输出 64MHz 超过上限'))).toBe(true)
    expect(issues.some((i) => i.node === 'HSE')).toBe(false)
  })

  it('AHB 分频 12 不在可选档位 → error', () => {
    const issues = validateClock(spec, cfg({ ahb: 12 }))
    expect(issues.some((i) => i.node === 'AHB' && i.message.includes('12'))).toBe(true)
  })

  it('APB1 分频 2 不在可选档位（V003 仅 1）→ error', () => {
    const issues = validateClock(spec, cfg({ apb1: 2 }))
    expect(issues.some((i) => i.node === 'APB1' && i.level === 'error')).toBe(true)
  })

  it('APB2 分频 3 不在可选档位 → error', () => {
    const issues = validateClock(spec, cfg({ apb2: 3 }))
    expect(issues.some((i) => i.node === 'APB2' && i.level === 'error')).toBe(true)
  })

  it('未知源 LSI → SYSCLK 为 0 error', () => {
    const issues = validateClock(spec, cfg({ source: 'LSI' }))
    expect(issues.some((i) => i.message.includes('SYSCLK 为 0'))).toBe(true)
  })

  it('ADC 恰好 12MHz（≤14）不产生 warning', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', apb2: 4 }))
    expect(issues.filter((i) => i.node === 'ADC')).toHaveLength(0)
  })

  it('PLL HSI 完整合法配置（apb2=4）无任何问题', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 2 }, apb2: 4 }))
    expect(issues).toEqual([])
  })
})

describe('solvePll', () => {
  it('目标 48MHz：HSI 与 HSE(24) 两个候选', () => {
    const c = solvePll(spec, 48)
    expect(c).toHaveLength(2)
  })

  it('候选按源优先级排序：HSI 在前', () => {
    const c = solvePll(spec, 48)
    expect(c[0].source).toBe('HSI')
    expect(c[1].source).toBe('HSE')
  })

  it('HSI 候选：params.mul=2、outMhz=48、无 hxtalMhz', () => {
    const c = solvePll(spec, 48)[0]
    expect(c.params).toEqual({ mul: 2 })
    expect(c.outMhz).toBe(48)
    expect(c.hxtalMhz).toBeUndefined()
  })

  it('HSE 候选使用默认晶振 24MHz', () => {
    const c = solvePll(spec, 48, 'HSE')
    expect(c).toHaveLength(1)
    expect(c[0].hxtalMhz).toBe(24)
    expect(c[0].outMhz).toBe(48)
  })

  it('限定 HSI 源：仅 1 个候选', () => {
    expect(solvePll(spec, 48, 'HSI')).toHaveLength(1)
  })

  it('目标 16MHz 无法命中（HSE 默认 24×2=48）→ 空列表', () => {
    expect(solvePll(spec, 16)).toEqual([])
  })

  it('未知源 → 空列表', () => {
    expect(solvePll(spec, 48, 'LSI')).toEqual([])
  })

  it('超上限目标（>48）不会返回候选（outMaxMhz 过滤）', () => {
    expect(solvePll(spec, 96)).toEqual([])
  })
})

describe('defaultClock / mergeClockConfig', () => {
  it('defaultClock：HSI 直连 + 各分频默认', () => {
    expect(defaultClock(spec)).toEqual({
      source: 'HSI',
      hxtalMhz: 24,
      pllSource: 'HSI',
      pll: { mul: 2 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
      adc: 'APB2',
    })
  })

  it('mergeClockConfig(undefined) → 全默认', () => {
    expect(mergeClockConfig(spec, undefined)).toEqual(defaultClock(spec))
  })

  it('mergeClockConfig({}) → 全默认', () => {
    expect(mergeClockConfig(spec, {})).toEqual(defaultClock(spec))
  })

  it('mergeClockConfig 只覆盖给出的字段', () => {
    const m = mergeClockConfig(spec, { ahb: 4 })
    expect(m.ahb).toBe(4)
    expect(m.source).toBe('HSI')
    expect(m.apb2).toBe(1)
  })

  it('mergeClockConfig 空 pll 对象 → 补默认 mul=2', () => {
    expect(mergeClockConfig(spec, { pll: {} }).pll).toEqual({ mul: 2 })
  })

  it('mergeClockConfig 保留显式 PLL/HSE 字段', () => {
    const m = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSE', hxtalMhz: 8, pll: { mul: 2 } })
    expect(m.source).toBe('PLL')
    expect(m.pllSource).toBe('HSE')
    expect(m.hxtalMhz).toBe(8)
    expect(m.pll).toEqual({ mul: 2 })
  })
})

describe('defaultClock 数据驱动默认源（无 HSI 芯片）', () => {
  const spec582 = getDeviceData('CH582M').clock

  it('CH582M 只有 HSE+PLL：默认源回退到第一个非 PLL 源 HSE，SYSCLK=32MHz', () => {
    const d = defaultClock(spec582)
    expect(d.source).toBe('HSE')
    expect(computeClock(spec582, d).sysclkMhz).toBe(32)
  })

  it('CH582M 默认配置无 error（不再出现 SYSCLK 为 0）', () => {
    const d = defaultClock(spec582)
    const errors = validateClock(spec582, d).filter((i) => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('mergeClockConfig 在无 HSI 芯片下沿用 HSE 默认源且不报 error', () => {
    const m = mergeClockConfig(spec582, { ahb: 1 })
    expect(m.source).toBe('HSE')
    expect(matchPreset(spec582, m)).toBeNull()
    expect(validateClock(spec582, m).filter((i) => i.level === 'error')).toEqual([])
  })

  it('有 HSI 的芯片默认源保持 HSI（V003 行为不变）', () => {
    expect(defaultClock(spec).source).toBe('HSI')
  })
})

describe('matchPreset 三预设', () => {
  it('命中 48MHZ_HSI（PLL/HSI/mul2/全 1 分频）', () => {
    const c = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSI', pll: { mul: 2 } })
    expect(matchPreset(spec, c)?.id).toBe('48MHZ_HSI')
  })

  it('命中 48MHZ_HSE（PLL/HSE 24MHz/mul2）', () => {
    const c = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSE', hxtalMhz: 24, pll: { mul: 2 } })
    expect(matchPreset(spec, c)?.id).toBe('48MHZ_HSE')
  })

  it('命中 24MHZ_HSE（HSE 24MHz 直连）', () => {
    const c = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 24 })
    expect(matchPreset(spec, c)?.id).toBe('24MHZ_HSE')
  })

  it('HSE 8MHz 不命中 48MHZ_HSE（预设硬编码 24MHz 晶振）', () => {
    const c = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSE', hxtalMhz: 8, pll: { mul: 2 } })
    expect(matchPreset(spec, c)).toBeNull()
  })

  it('分频不同（apb2=2）不命中任何预设', () => {
    const c = mergeClockConfig(spec, { source: 'HSE', hxtalMhz: 24, apb2: 2 })
    expect(matchPreset(spec, c)).toBeNull()
  })

  it('PLL mul=1 与预设 mul=2 不一致 → 不命中', () => {
    const c = mergeClockConfig(spec, { source: 'PLL', pllSource: 'HSI', pll: { mul: 1 } })
    expect(matchPreset(spec, c)).toBeNull()
  })

  it('原始 cfg 未写 pllSource 时按默认源（HSI）匹配', () => {
    const raw: ClockConfig = { source: 'PLL', ahb: 1, apb1: 1, apb2: 1, pll: { mul: 2 } }
    expect(matchPreset(spec, raw)?.id).toBe('48MHZ_HSI')
  })

  it('HSI 直连无对应预设 → null', () => {
    expect(matchPreset(spec, defaultClock(spec))).toBeNull()
  })
})

describe('nearestPreset', () => {
  it('目标 48 → 48MHZ_HSI', () => {
    expect(nearestPreset(spec, 48)?.id).toBe('48MHZ_HSI')
  })

  it('目标 24 → 24MHZ_HSE', () => {
    expect(nearestPreset(spec, 24)?.id).toBe('24MHZ_HSE')
  })

  it('目标 40 → 最近的 48MHZ_HSI（差 8 < 16）', () => {
    expect(nearestPreset(spec, 40)?.id).toBe('48MHZ_HSI')
  })

  it('目标 12 → 最近的 24MHZ_HSE', () => {
    expect(nearestPreset(spec, 12)?.id).toBe('24MHZ_HSE')
  })

  it('目标 0 → 24MHZ_HSE（差 24 < 48）', () => {
    expect(nearestPreset(spec, 0)?.id).toBe('24MHZ_HSE')
  })
})
