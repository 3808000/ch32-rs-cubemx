// 时钟核心单元测试：computeClock / validateClock / solvePll / defaultClock /
// mergeClockConfig / matchPreset / nearestPreset / sourceFreqMhz / pllOutMhz
// 数据：真实 CH32V003F4P6（HSI 24MHz、PLL 固定 ×2、AHB 1..256、APB2 1/2/4/8/16、APB1 固定 1）
import { describe, it, expect } from 'vitest'
import type { ClockConfig, ClockData } from '@/model/types'
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
  isClockNodeLockable,
  resolveClockIssues,
} from '@/model/clock'
import { getDeviceData } from '@/model/device'
import { buildClockTree } from '@/model/clock/tree'

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
    expect(sourceFreqMhz(spec, 'UNKNOWN_SRC', cfg())).toBeNull()
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

  it('ADC 时钟取自 HCLK÷2（RM 图 3-2 ADCPRE 复位）：sysclk 48、apb2=4 → 24MHz', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', apb2: 4 }))
    expect(f.pclk2Mhz).toBe(12)
    // D4bis：ADCPRE 上游=HCLK（非 APB2），复位 ÷2；apb2 不再影响 ADC
    expect(f.adcMhz).toBe(24)
  })

  it('ADC 时钟随 HCLK÷2（默认 AHB÷1）：HSI 24 → 12MHz', () => {
    const f = computeClock(spec, cfg())
    expect(f.adcMhz).toBe(12)
  })

  it('V003 的两个定时器取 AHB 分频后的 HCLK，独立于 HAL 的 APB2 参数', () => {
    const f = computeClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', ahb: 2, apb2: 4 }))
    expect(f.sysclkMhz).toBe(48)
    expect(f.pclk2Mhz).toBe(6)
    expect(f.pclk2TimMhz).toBe(24)
    expect(f.pclk1TimMhz).toBe(24)
  })

  it('HSI 24 + ahb=2：hclk=12、pclk1=12、adc=HCLK÷2=6', () => {
    const f = computeClock(spec, cfg({ ahb: 2 }))
    expect(f.hclkMhz).toBe(12)
    expect(f.pclk1Mhz).toBe(12)
    expect(f.adcMhz).toBe(6)
  })
})

describe('validateClock 越界与非法分支', () => {
  it('默认 HSI 档：ADC=HCLK÷2=12MHz（≤14）无 warning', () => {
    // D4bis：ADCPRE 自 HCLK 复位 ÷2，M15 的 24MHz（APB2÷1）偏高 2× 已纠正
    expect(validateClock(spec, defaultClock(spec))).toEqual([])
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

  it('PLL 源非法（UNKNOWN_SRC）→ PLL 源 error + SYSCLK 为 0 error', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'UNKNOWN_SRC' }))
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors.some((i) => i.message.includes('PLL 源 UNKNOWN_SRC 不合法'))).toBe(true)
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

  it('未知源 UNKNOWN_SRC → SYSCLK 为 0 error', () => {
    const issues = validateClock(spec, cfg({ source: 'UNKNOWN_SRC' }))
    expect(issues.some((i) => i.message.includes('SYSCLK 为 0'))).toBe(true)
  })

  it('ADC 恰好 12MHz（≤14）不产生 warning', () => {
    // PLL 48MHz + AHB÷2=24MHz，ADCPRE ÷2 → ADC 12MHz
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', ahb: 2 }))
    expect(issues.filter((i) => i.node === 'ADC')).toHaveLength(0)
  })

  it('PLL HSI 完整合法配置（AHB÷2 → ADC 12MHz）无任何问题', () => {
    const issues = validateClock(spec, cfg({ source: 'PLL', pllSource: 'HSI', pll: { mul: 2 }, ahb: 2, apb2: 4 }))
    expect(issues).toEqual([])
  })
})

describe('M16 displayOnly 源（V003 LSI）', () => {
  it('validateClock：displayOnly 源不可配置为 SYSCLK → error「仅显示时钟源」', () => {
    const issues = validateClock(spec, cfg({ source: 'LSI' }))
    const err = issues.find((i) => i.level === 'error' && i.node === 'SYSCLK')
    expect(err).toBeDefined()
    expect(err!.message).toContain('仅显示时钟源')
  })

  it('defaultClock 不选 displayOnly 源（仍为 HSI）', () => {
    const d = defaultClock(spec)
    expect(d.source).toBe('HSI')
    expect(spec.sources.find((s) => s.id === 'LSI')?.displayOnly).toBe(true)
  })

  it('resolveClockIssues 不把 displayOnly 源放进修复搜索空间', () => {
    const fixed = resolveClockIssues(spec, cfg({ source: 'LSI' }))
    expect(fixed).not.toBeNull()
    expect(fixed!.config.source).not.toBe('LSI')
    expect(['HSI', 'HSE', 'PLL']).toContain(fixed!.config.source)
    expect(fixed!.issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('SYSCLK control.options 与 muxInputs 均不含 LSI（RM 保真：LSI 非 SW mux 输入）', () => {
    const tree = buildClockTree(spec, defaultClock(spec), computeClock(spec, defaultClock(spec)))
    const sys = tree.nodes.find((n) => n.id === 'SYSCLK')!
    expect(sys.control!.options!.map((o) => String(o.value))).not.toContain('LSI')
    expect(sys.muxInputs).not.toContain('LSI')
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
    expect(solvePll(spec, 48, 'UNKNOWN_SRC')).toEqual([])
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
      adc: 'HCLK_DIV2',
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

  it('CH582M defaultSource=PLL（M12）：默认 60MHz 命中预设，新建工程即可生成', () => {
    const d = defaultClock(spec582)
    expect(d.source).toBe('PLL')
    expect(computeClock(spec582, d).sysclkMhz).toBe(60)
    expect(matchPreset(spec582, d)?.id).toBe('60MHZ_PLL')
  })

  it('CH582M 默认配置无 error（不再出现 SYSCLK 为 0）', () => {
    const d = defaultClock(spec582)
    const errors = validateClock(spec582, d).filter((i) => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('mergeClockConfig 沿用 defaultSource=PLL 且命中预设、不报 error（M12）', () => {
    const m = mergeClockConfig(spec582, { ahb: 1 })
    expect(m.source).toBe('PLL')
    expect(matchPreset(spec582, m)?.id).toBe('60MHZ_PLL')
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

// ---------- M14：三芯片接入的通用时钟能力（向后兼容追加） ----------

/** V103/V307 风格：PLL = in / prediv × mul。 */
const predivSpec: ClockData = {
  chip: 'TEST_PREDIV',
  sysclkMaxMhz: 144,
  sources: [
    { id: 'HSI', label: '内部 HSI', freqMhz: 8 },
    { id: 'HSE', label: '外部 HSE', hxtal: { min: 8, max: 25, default: 8 } },
    { id: 'PLL', label: 'PLL', pll: true },
  ],
  pll: {
    outMaxMhz: 144,
    sourceOptions: ['HSI', 'HSE'],
    params: [
      { key: 'prediv', label: '预分频', kind: 'select', options: [1, 2, 4], default: 1, maxBySource: { HSI: 2 } },
      { key: 'mul', label: '倍频', kind: 'select', options: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 18], default: 18 },
    ],
  },
  ahb: { options: [1, 2, 4], maxMhz: 144, default: 1 },
  apb1: { options: [1, 2, 4], maxMhz: 144, default: 1 },
  apb2: { options: [1, 2, 4], maxMhz: 144, default: 1 },
  adc: { options: [{ id: 'APB2_DIV2', label: 'APB2/2', source: 'APB2', div: 2 }], default: 'APB2_DIV2', maxMhz: 14 },
  timerClock: 'apb_x2',
  presets: [],
  codegen: { presetConstMap: {}, fallback: 'explicit' },
}

/** X035 风格：无 PLL、仅 HSI，ADC 来自 SYSCLK/CLK_DIV。 */
const noPllSpec: ClockData = {
  chip: 'TEST_NOPLL',
  sysclkMaxMhz: 48,
  sources: [{ id: 'HSI', label: '内部 HSI', freqMhz: 48 }],
  ahb: { options: [1, 2, 3, 4, 8], maxMhz: 48, default: 1 },
  apb1: { options: [1], maxMhz: 48, default: 1 },
  apb2: { options: [1], maxMhz: 48, default: 1 },
  adc: { options: [{ id: 'SYS', label: 'SYSCLK/8', source: 'SYSCLK', div: 8 }], default: 'SYS', maxMhz: 14 },
  timerClock: 'apb_x2',
  presets: [{ id: '48MHZ_HSI', label: '48MHz (HSI, AHB÷1)', match: { source: 'HSI', ahb: 1, apb1: 1, apb2: 1 } }],
  codegen: { presetConstMap: { '48MHZ_HSI': 'hal::rcc::Config::SYSCLK_FREQ_48MHZ_HSI' }, fallback: 'preset_only' },
}

describe('M14 pllOutMhz：prediv 做除法、mul 做乘法', () => {
  it('8MHz / prediv2 × mul9 = 36MHz', () => {
    expect(pllOutMhz(predivSpec, 8, { prediv: 2, mul: 9 })).toBe(36)
  })
  it('缺省参数取 data 默认值：8 / 1 × 18 = 144MHz', () => {
    expect(pllOutMhz(predivSpec, 8, {})).toBe(144)
  })
  it('固定 VCO 模型（fixedOutMhz ÷ div）不受 prediv 语义影响', () => {
    const fixed: ClockData = {
      ...predivSpec,
      pll: { ...predivSpec.pll!, fixedOutMhz: 480, params: [{ key: 'div', label: '分频', kind: 'select', options: [2, 4], default: 2 }] },
    }
    expect(pllOutMhz(fixed, 8, { div: 4 })).toBe(120)
  })
  it('computeClock 走 prediv：PLL HSI /2 ×9 = 36MHz', () => {
    const f = computeClock(predivSpec, {
      source: 'PLL',
      pllSource: 'HSI',
      pll: { prediv: 2, mul: 9 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
      adc: 'APB2_DIV2',
    })
    expect(f.pllInMhz).toBe(8)
    expect(f.pllOutMhz).toBe(36)
    expect(f.sysclkMhz).toBe(36)
  })
})

describe('M14 无 PLL 芯片（ClockData.pll 缺省）', () => {
  it('defaultClock 不写 pllSource/pll，源为 HSI', () => {
    const d = defaultClock(noPllSpec)
    expect(Object.keys(d)).toEqual(['source', 'hxtalMhz', 'ahb', 'apb1', 'apb2', 'adc'])
    expect(d.source).toBe('HSI')
    expect('pllSource' in d).toBe(false)
    expect('pll' in d).toBe(false)
  })

  it('computeClock：HSI 48MHz、ADC = SYSCLK/8 = 6MHz、无 PLL', () => {
    const f = computeClock(noPllSpec, defaultClock(noPllSpec))
    expect(f.pllInMhz).toBeNull()
    expect(f.pllOutMhz).toBeNull()
    expect(f.sysclkMhz).toBe(48)
    expect(f.adcMhz).toBe(6)
  })

  it('validateClock 默认配置无问题；source=PLL 时报 SYSCLK 为 0', () => {
    expect(validateClock(noPllSpec, defaultClock(noPllSpec))).toEqual([])
    const issues = validateClock(noPllSpec, { source: 'PLL', ahb: 1, apb1: 1, apb2: 1 })
    expect(issues.some((i) => i.level === 'error' && i.message.includes('SYSCLK 为 0'))).toBe(true)
  })

  it('solvePll 恒返回空列表', () => {
    expect(solvePll(noPllSpec, 48)).toEqual([])
    expect(solvePll(noPllSpec, 48, 'HSI')).toEqual([])
  })

  it('mergeClockConfig 不补 pllSource/pll', () => {
    const m = mergeClockConfig(noPllSpec, { ahb: 2 })
    expect(m.ahb).toBe(2)
    expect('pllSource' in m).toBe(false)
    expect('pll' in m).toBe(false)
  })

  it('matchPreset / nearestPreset 容忍无 PLL', () => {
    const d = defaultClock(noPllSpec)
    expect(matchPreset(noPllSpec, d)?.id).toBe('48MHZ_HSI')
    expect(nearestPreset(noPllSpec, 24)?.id).toBe('48MHZ_HSI')
  })

  it('PLL 节点不可锁定（无 PLL 芯片不渲染 PLL）', () => {
    expect(isClockNodeLockable(noPllSpec, 'PLL')).toBe(false)
    expect(isClockNodeLockable(predivSpec, 'PLL')).toBe(true)
  })

  it('computeClock ADC SYSCLK 分支取 sysclk 而非 pclk2：ahb=2 时仍为 48/8', () => {
    const f = computeClock(noPllSpec, { source: 'HSI', ahb: 2, apb1: 1, apb2: 1, adc: 'SYS' })
    expect(f.hclkMhz).toBe(24)
    expect(f.adcMhz).toBe(6)
  })

  it('时钟树不渲染 PLL 节点/分组，ADC 连线直接来自 SYSCLK', () => {
    const d = defaultClock(noPllSpec)
    const tree = buildClockTree(noPllSpec, d, computeClock(noPllSpec, d), validateClock(noPllSpec, d))
    expect(tree.nodes.some((n) => n.id === 'PLL')).toBe(false)
    expect(tree.groups.some((g) => g.id === 'g-pll')).toBe(false)
    expect(tree.nodes.some((n) => n.id === 'SYSCLK')).toBe(true)
    expect(tree.edges.find((e) => e.id === 'sys-adc')?.from).toBe('SYSCLK')
    expect(tree.edges.some((e) => e.to === 'PLL' || e.from === 'PLL')).toBe(false)
  })
})

describe('M14 ClockParamSpec.maxBySource：参数按 PLL 源上限', () => {
  const cfg = (pllSource: string, prediv: number): ClockConfig => ({
    source: 'PLL',
    pllSource,
    pll: { prediv, mul: 6 },
    ahb: 1,
    apb1: 1,
    apb2: 1,
    adc: 'APB2_DIV2',
  })

  it('HSI 源 prediv=4 超过上限 2 → error（消息含参数名/源/上限）', () => {
    const issues = validateClock(predivSpec, cfg('HSI', 4))
    const e = issues.find((i) => i.level === 'error' && i.message.includes('prediv'))
    expect(e).toBeDefined()
    expect(e!.node).toBe('PLL')
    expect(e!.message).toContain('HSI')
    expect(e!.message).toContain('上限 2')
  })

  it('HSI 源 prediv=2 在上限内 → 无该 error', () => {
    const issues = validateClock(predivSpec, cfg('HSI', 2))
    expect(issues.some((i) => i.message.includes('上限'))).toBe(false)
  })

  it('HSE 源无 maxBySource 限制：prediv=4 合法', () => {
    const issues = validateClock(predivSpec, cfg('HSE', 4))
    expect(issues.some((i) => i.message.includes('上限'))).toBe(false)
  })
})
