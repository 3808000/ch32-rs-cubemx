// CH582M 数据层（M11）：时钟 6 预设 / PLL div 合法范围 / PB17 halUnsupported / ADC 14 通道。
// 期望值硬编码自 docs/CH58X_BACKEND_CONTRACT.md §1 D3 与 §3（逐字核对 reference/ch58x-hal @ 611954e）。
import { describe, it, expect } from 'vitest'
import { getDeviceData } from '@/model/device'
import { computeClock, mergeClockConfig } from '@/model/clock'
import type { ClockConfig, ClockPreset } from '@/model/types'

const data = getDeviceData('CH582M')
const clock = data.clock

/** 按预设构造完整时钟配置（与 validate-device-data.mjs 的复现逻辑一致）。 */
function presetConfig(preset: ClockPreset): ClockConfig {
  const pll: Record<string, number> = {}
  for (const param of clock.pll.params) {
    const v = preset.match[param.key as keyof typeof preset.match]
    if (typeof v === 'number') pll[param.key] = v
  }
  return mergeClockConfig(clock, {
    source: preset.match.source,
    pllSource: preset.match.pllSource,
    hxtalMhz: preset.match.hxtalMhz,
    pll: Object.keys(pll).length ? pll : undefined,
    ahb: preset.match.ahb,
    apb1: preset.match.apb1,
    apb2: preset.match.apb2,
  })
}

describe('CH582M 时钟预设（480MHz VCO ÷ div）', () => {
  it('6 档预设：60/80/48/32/24/20MHz，div 依次为 8/6/10/15/20/24', () => {
    const expected = [
      ['60MHZ_PLL', 60, 8],
      ['80MHZ_PLL', 80, 6],
      ['48MHZ_PLL', 48, 10],
      ['32MHZ_PLL', 32, 15],
      ['24MHZ_PLL', 24, 20],
      ['20MHZ_PLL', 20, 24],
    ] as const
    expect(clock.presets.map((p) => p.id)).toEqual(expected.map(([id]) => id))
    for (const [id, mhz, div] of expected) {
      const preset = clock.presets.find((p) => p.id === id)!
      expect(preset.match.div).toBe(div)
      expect(preset.match.source).toBe('PLL')
      expect(preset.match.pllSource).toBe('HSE')
      expect(computeClock(clock, presetConfig(preset)).sysclkMhz).toBeCloseTo(mhz, 9)
    }
  })

  it('每档预设都满足 480 ÷ div = 标称频率', () => {
    expect(clock.pll.fixedOutMhz).toBe(480)
    for (const preset of clock.presets) {
      const mhz = parseInt(preset.id, 10)
      expect(480 / preset.match.div!).toBeCloseTo(mhz, 9)
    }
  })

  it('presetConstMap 6 项且映射到 sysctl::Config 方法', () => {
    expect(clock.codegen.presetConstMap).toEqual({
      '60MHZ_PLL': 'config.clock.use_pll_60mhz()',
      '80MHZ_PLL': 'config.clock.use_pll_80mhz()',
      '48MHZ_PLL': 'config.clock.use_pll_48mhz()',
      '32MHZ_PLL': 'config.clock.use_pll_32mhz()',
      '24MHZ_PLL': 'config.clock.use_pll_24mhz()',
      '20MHZ_PLL': 'config.clock.use_pll_20mhz()',
    })
    expect(Object.keys(clock.codegen.presetConstMap)).toHaveLength(6)
  })

  it('PLL div 选项为 2..31（5 位寄存器，32 截断为 0），默认 8', () => {
    const div = clock.pll.params.find((p) => p.key === 'div')!
    expect(div.options).toEqual(Array.from({ length: 30 }, (_, i) => i + 2))
    expect(div.options).not.toContain(32)
    expect(div.default).toBe(8)
  })
})

describe('CH582M 引脚标记', () => {
  it('PB17 带 halUnsupported 原因文本', () => {
    const pb17 = data.chip.pins.find((p) => p.name === 'PB17')!
    expect(pb17.halUnsupported).toBeTruthy()
    expect(pb17.halUnsupported).toContain('ch58x-hal 未实现 PB17 的 Pin trait')
  })

  it('仅 PB17 标记 halUnsupported，其它引脚不受影响', () => {
    const marked = data.chip.pins.filter((p) => p.halUnsupported)
    expect(marked.map((p) => p.name)).toEqual(['PB17'])
  })
})

describe('CH582M ADC 14 外部通道与 HAL 映射一致', () => {
  it('ADC_IN0..IN13 的引脚映射逐字符合契约 §3', () => {
    const expected: Record<string, string> = {
      ADC_IN0: 'PA4',
      ADC_IN1: 'PA5',
      ADC_IN2: 'PA12',
      ADC_IN3: 'PA13',
      ADC_IN4: 'PA14',
      ADC_IN5: 'PA15',
      ADC_IN6: 'PA3',
      ADC_IN7: 'PA2',
      ADC_IN8: 'PA1',
      ADC_IN9: 'PA0',
      ADC_IN10: 'PA6',
      ADC_IN11: 'PA7',
      ADC_IN12: 'PA8',
      ADC_IN13: 'PA9',
    }
    const adc = data.peripherals.adc[0]
    expect(adc.channels).toHaveLength(14)
    expect(Object.fromEntries(adc.channels.map((c) => [c.channel, c.pin]))).toEqual(expected)
  })
})

describe('CH582M 默认时钟源（M12：defaultSource 数据驱动）', () => {
  it('clock.json 显式 defaultSource=PLL（HSE 直连不可生成）', () => {
    expect(clock.defaultSource).toBe('PLL')
  })
  it('defaultClock 落在 PLL 且命中 60MHz 预设（新建工程即可生成）', async () => {
    const { defaultClock, matchPreset } = await import('@/model/clock')
    const d = defaultClock(clock)
    expect(d.source).toBe('PLL')
    const f = computeClock(clock, d)
    expect(f.sysclkMhz).toBe(60)
    expect(matchPreset(clock, d)?.id).toBe('60MHZ_PLL')
  })
  it('ch32 芯片无 defaultSource 时行为不变（第一个非 PLL 源）', async () => {
    const { defaultClock } = await import('@/model/clock')
    const v003 = getDeviceData('CH32V003F4P6')
    expect(v003.clock.defaultSource).toBeUndefined()
    expect(defaultClock(v003.clock).source).toBe('HSI')
  })
})
