// 冲突检查单元测试：20 条规则，每条至少一正（规则触发）一反（规则不触发）。
// 数据：真实 CH32V003F4P6；个别规则用合成 DeviceData（SRAM / DMA / unsupportedFeatures）。
import { describe, it, expect } from 'vitest'
import type { DeviceData, PinAssignment, PinMode, ProjectConfig, PeripheralState } from '../src/types'
import { checkConflicts, labelToIdent } from '../src/lib/conflicts'
import { getDeviceData } from '../src/data/device'

const data = getDeviceData('CH32V003F4P6')

/** 构造 ProjectConfig（各冲突测试共用） */
function makeConfig(pins: PinAssignment[], opts: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'test-project',
    pins,
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: true },
    hal: { rev: 'test' },
    ...opts,
  }
}

/** 构造引脚分配 */
function pin(
  name: string,
  mode: PinMode,
  function_?: string,
  extra: { remap?: number; label?: string; exti?: boolean } = {},
): PinAssignment {
  return {
    pin: name,
    mode,
    function: function_,
    remap: extra.remap,
    label: extra.label,
    params: extra.exti ? { exti: { enabled: true, edge: 'RISING' } } : {},
  }
}

/** 启用外设状态 */
function enabled(remap?: number, params: Record<string, string | number | boolean> = {}): PeripheralState {
  return { enabled: true, params, remap }
}

function has(conflicts: { code: string }[], code: string): boolean {
  return conflicts.some((c) => c.code === code)
}

// ---------------------------------------------------------------------------
// 1. UNKNOWN_PIN
describe('UNKNOWN_PIN', () => {
  it('正：不存在的引脚 PA0 → error', () => {
    const out = checkConflicts(makeConfig([pin('PA0', 'OUTPUT')]), data)
    const c = out.find((x) => x.code === 'UNKNOWN_PIN')!
    expect(c.level).toBe('error')
    expect(c.pins).toEqual(['PA0'])
  })
  it('反：全部引脚合法 → 无 UNKNOWN_PIN', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'OUTPUT'), pin('PD5', 'INPUT')]), data)
    expect(has(out, 'UNKNOWN_PIN')).toBe(false)
  })
  it('未知引脚不参与后续引脚级规则（不计 DUPLICATE_PIN）', () => {
    const out = checkConflicts(makeConfig([pin('PA0', 'OUTPUT'), pin('PA0', 'INPUT')]), data)
    expect(has(out, 'DUPLICATE_PIN')).toBe(false)
    expect(out.filter((x) => x.code === 'UNKNOWN_PIN')).toHaveLength(2)
  })
})

// 2. DUPLICATE_PIN
describe('DUPLICATE_PIN', () => {
  it('正：PD5 配置两次 → error', () => {
    const out = checkConflicts(makeConfig([pin('PD5', 'OUTPUT'), pin('PD5', 'INPUT')]), data)
    const c = out.find((x) => x.code === 'DUPLICATE_PIN')!
    expect(c.level).toBe('error')
    expect(c.pins).toEqual(['PD5'])
    expect(c.message).toContain('2 次')
  })
  it('反：不同引脚 → 无 DUPLICATE_PIN', () => {
    const out = checkConflicts(makeConfig([pin('PD5', 'OUTPUT'), pin('PD6', 'INPUT')]), data)
    expect(has(out, 'DUPLICATE_PIN')).toBe(false)
  })
})

// 3. PIN_NOT_CONFIGURABLE
describe('PIN_NOT_CONFIGURABLE', () => {
  it('正：VSS 是 POWER 引脚 → error', () => {
    const out = checkConflicts(makeConfig([pin('VSS', 'OUTPUT')]), data)
    const c = out.find((x) => x.code === 'PIN_NOT_CONFIGURABLE')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('POWER')
  })
  it('反：普通 IO 引脚 PC0 → 无该规则', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'OUTPUT')]), data)
    expect(has(out, 'PIN_NOT_CONFIGURABLE')).toBe(false)
  })
})

// 4. SPECIAL_PIN_LOCKED
describe('SPECIAL_PIN_LOCKED', () => {
  it('正：PD7（NRST）被配置 → error', () => {
    const out = checkConflicts(makeConfig([pin('PD7', 'OUTPUT')]), data)
    const c = out.find((x) => x.code === 'SPECIAL_PIN_LOCKED')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('NRST')
  })
  it('正：PD1（SWD）被配置 → error，提示 SWD 调试', () => {
    const out = checkConflicts(makeConfig([pin('PD1', 'INPUT')]), data)
    expect(out.find((x) => x.code === 'SPECIAL_PIN_LOCKED')?.message).toContain('SWD')
  })
  it('反：unlocked 解锁 PD7 后不再报错', () => {
    const out = checkConflicts(makeConfig([pin('PD7', 'OUTPUT')]), data, ['PD7'])
    expect(has(out, 'SPECIAL_PIN_LOCKED')).toBe(false)
  })
  it('反：普通 IO 引脚 → 无该规则', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'OUTPUT')]), data)
    expect(has(out, 'SPECIAL_PIN_LOCKED')).toBe(false)
  })
  it('osc 引脚（PA1/PA2）不走 SPECIAL_PIN_LOCKED（由 SPECIAL_PIN_OSC 管）', () => {
    const out = checkConflicts(makeConfig([pin('PA1', 'INPUT')]), data)
    expect(has(out, 'SPECIAL_PIN_LOCKED')).toBe(false)
  })
})

// 5. SPECIAL_PIN_OSC
describe('SPECIAL_PIN_OSC', () => {
  it('正：时钟用 HSE 且配置了晶振引脚 PA1 → warning', () => {
    const cfg = makeConfig([pin('PA1', 'INPUT')], {
      clock: { source: 'HSE', hxtalMhz: 24, ahb: 1, apb1: 1, apb2: 1 },
    })
    const out = checkConflicts(cfg, data)
    const c = out.find((x) => x.code === 'SPECIAL_PIN_OSC')!
    expect(c.level).toBe('warning')
    expect(c.pins).toEqual(['PA1'])
  })
  it('正：PLL 源为 HSE 时同样触发（PA2）', () => {
    const cfg = makeConfig([pin('PA2', 'INPUT')], {
      clock: { source: 'PLL', pllSource: 'HSE', hxtalMhz: 24, pll: { mul: 2 }, ahb: 1, apb1: 1, apb2: 1 },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'SPECIAL_PIN_OSC')).toBe(true)
  })
  it('反：时钟用 HSI 时配置 PA1 不报错', () => {
    const cfg = makeConfig([pin('PA1', 'INPUT')], {
      clock: { source: 'HSI', ahb: 1, apb1: 1, apb2: 1 },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'SPECIAL_PIN_OSC')).toBe(false)
  })
  it('反：用 HSE 但未配置晶振引脚 → 无该规则', () => {
    const cfg = makeConfig([pin('PC0', 'INPUT')], {
      clock: { source: 'HSE', hxtalMhz: 24, ahb: 1, apb1: 1, apb2: 1 },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'SPECIAL_PIN_OSC')).toBe(false)
  })
})

// 6. EXTI_ON_NON_INPUT
describe('EXTI_ON_NON_INPUT', () => {
  it('正：PC0 模式 OUTPUT 却启用 EXTI → warning', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'OUTPUT', undefined, { exti: true })]), data)
    const c = out.find((x) => x.code === 'EXTI_ON_NON_INPUT')!
    expect(c.level).toBe('warning')
    expect(c.pins).toEqual(['PC0'])
  })
  it('反：PC0 模式 INPUT 启用 EXTI → 无该规则', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'INPUT', undefined, { exti: true })]), data)
    expect(has(out, 'EXTI_ON_NON_INPUT')).toBe(false)
  })
})

// 7. EXTI_LINE_CONFLICT
describe('EXTI_LINE_CONFLICT', () => {
  it('正：PC1 与 PD1 同属 EXTI 通道 1 → error（PD1 需解锁 SWD）', () => {
    const out = checkConflicts(
      makeConfig([pin('PC1', 'INPUT', undefined, { exti: true }), pin('PD1', 'INPUT', undefined, { exti: true })]),
      data,
      ['PD1'],
    )
    const c = out.find((x) => x.code === 'EXTI_LINE_CONFLICT')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('通道 1')
    expect(c.pins).toEqual(expect.arrayContaining(['PC1', 'PD1']))
    // 解锁后不应再混入 SPECIAL_PIN_LOCKED
    expect(has(out, 'SPECIAL_PIN_LOCKED')).toBe(false)
  })
  it('正：PC0 与 PD0 同属通道 0 → error', () => {
    const out = checkConflicts(
      makeConfig([pin('PC0', 'INPUT', undefined, { exti: true }), pin('PD0', 'INPUT', undefined, { exti: true })]),
      data,
    )
    expect(has(out, 'EXTI_LINE_CONFLICT')).toBe(true)
  })
  it('反：PC1（通道 1）与 PD2（通道 2）不冲突', () => {
    const out = checkConflicts(
      makeConfig([pin('PC1', 'INPUT', undefined, { exti: true }), pin('PD2', 'INPUT', undefined, { exti: true })]),
      data,
    )
    expect(has(out, 'EXTI_LINE_CONFLICT')).toBe(false)
  })
  it('反：单个引脚启用 EXTI → 无冲突', () => {
    const out = checkConflicts(makeConfig([pin('PC1', 'INPUT', undefined, { exti: true })]), data)
    expect(has(out, 'EXTI_LINE_CONFLICT')).toBe(false)
  })
})

// 8. DUPLICATE_LABEL（归一化重名）
describe('DUPLICATE_LABEL', () => {
  it('正：LED 与 led 归一化后同名 → warning', () => {
    const out = checkConflicts(
      makeConfig([pin('PD5', 'OUTPUT', undefined, { label: 'LED' }), pin('PD6', 'OUTPUT', undefined, { label: 'led' })]),
      data,
    )
    const c = out.find((x) => x.code === 'DUPLICATE_LABEL')!
    expect(c.level).toBe('warning')
    expect(c.message).toContain('led')
    expect(c.pins).toEqual(['PD5', 'PD6'])
  })
  it('正：Btn-A 与 btn_a 归一化后同名 → warning', () => {
    const out = checkConflicts(
      makeConfig([
        pin('PC0', 'INPUT', undefined, { label: 'Btn-A' }),
        pin('PC2', 'INPUT', undefined, { label: 'btn_a' }),
      ]),
      data,
    )
    expect(has(out, 'DUPLICATE_LABEL')).toBe(true)
  })
  it('反：LED1 与 LED2 归一化后不同名 → 无该规则', () => {
    const out = checkConflicts(
      makeConfig([
        pin('PD5', 'OUTPUT', undefined, { label: 'LED1' }),
        pin('PD6', 'OUTPUT', undefined, { label: 'LED2' }),
      ]),
      data,
    )
    expect(has(out, 'DUPLICATE_LABEL')).toBe(false)
  })
  it('反：无标签 → 无该规则', () => {
    const out = checkConflicts(makeConfig([pin('PD5', 'OUTPUT'), pin('PD6', 'OUTPUT')]), data)
    expect(has(out, 'DUPLICATE_LABEL')).toBe(false)
  })
})

describe('labelToIdent 标识符归一化', () => {
  it('驼峰转 snake_case：LED_RUN → led_run', () => {
    expect(labelToIdent('LED_RUN')).toBe('led_run')
  })
  it('连字符/点统一为下划线：led-run → led_run', () => {
    expect(labelToIdent('led-run')).toBe('led_run')
    expect(labelToIdent('led.run')).toBe('led_run')
  })
  it('camelCase 拆分：ledRun → led_run', () => {
    expect(labelToIdent('ledRun')).toBe('led_run')
  })
  it('全大写缩写不拆分：LEDRun → ledrun', () => {
    expect(labelToIdent('LEDRun')).toBe('ledrun')
  })
  it('连续下划线压缩：A__B → a_b', () => {
    expect(labelToIdent('A__B')).toBe('a_b')
  })
  it('数字开头加前缀下划线：2BTN → _2_btn（数字-大写边界也拆分）', () => {
    expect(labelToIdent('2BTN')).toBe('_2_btn')
  })
  it('首尾下划线裁剪：_x_ → x', () => {
    expect(labelToIdent('_x_')).toBe('x')
  })
})

// 9. AF_SIGNAL_DUPLICATE
describe('AF_SIGNAL_DUPLICATE', () => {
  it('正：USART1_TX 同时分配到 PD5 与 PC0 → error', () => {
    const out = checkConflicts(
      makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PC0', 'AF', 'USART1_TX')]),
      data,
    )
    const c = out.find((x) => x.code === 'AF_SIGNAL_DUPLICATE')!
    expect(c.level).toBe('error')
    expect(c.pins).toEqual(expect.arrayContaining(['PD5', 'PC0']))
  })
  it('反：TX 与 RX 是不同信号 → 无该规则', () => {
    const out = checkConflicts(
      makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD6', 'AF', 'USART1_RX')]),
      data,
    )
    expect(has(out, 'AF_SIGNAL_DUPLICATE')).toBe(false)
  })
})

// 10. ANALOG_DUPLICATE
describe('ANALOG_DUPLICATE', () => {
  it('正：ADC_IN0 分配到 PA2 与 PD5 → error（PD5 另报 REMAP_UNDEFINED）', () => {
    const out = checkConflicts(
      makeConfig([pin('PA2', 'ANALOG', 'ADC_IN0'), pin('PD5', 'ANALOG', 'ADC_IN0')]),
      data,
    )
    const c = out.find((x) => x.code === 'ANALOG_DUPLICATE')!
    expect(c.level).toBe('error')
    expect(c.pins).toEqual(expect.arrayContaining(['PA2', 'PD5']))
    expect(has(out, 'REMAP_UNDEFINED')).toBe(true)
  })
  it('反：IN0 与 IN7 是不同通道 → 无该规则', () => {
    const out = checkConflicts(
      makeConfig([pin('PA2', 'ANALOG', 'ADC_IN0'), pin('PD4', 'ANALOG', 'ADC_IN7')]),
      data,
    )
    expect(has(out, 'ANALOG_DUPLICATE')).toBe(false)
    expect(has(out, 'REMAP_UNDEFINED')).toBe(false)
  })
})

// 11/12. USART_TX_MISSING / USART_RX_MISSING
describe('USART_TX_MISSING / USART_RX_MISSING', () => {
  it('正：启用 USART1 只配 RX（PD6）→ TX_MISSING warning', () => {
    const cfg = makeConfig([pin('PD6', 'AF', 'USART1_RX')], { peripherals: { USART1: enabled() } })
    const out = checkConflicts(cfg, data)
    const c = out.find((x) => x.code === 'USART_TX_MISSING')!
    expect(c.level).toBe('warning')
    expect(c.peripheral).toBe('USART1')
    expect(has(out, 'USART_RX_MISSING')).toBe(false)
  })
  it('正：启用 USART1 只配 TX（PD5）→ RX_MISSING warning', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX')], { peripherals: { USART1: enabled() } })
    const out = checkConflicts(cfg, data)
    const c = out.find((x) => x.code === 'USART_RX_MISSING')!
    expect(c.level).toBe('warning')
    expect(c.peripheral).toBe('USART1')
    expect(has(out, 'USART_TX_MISSING')).toBe(false)
  })
  it('反：TX+RX 齐全（PD5/PD6，remap0 公共档）→ 两条规则都不触发', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD6', 'AF', 'USART1_RX')], {
      peripherals: { USART1: enabled() },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'USART_TX_MISSING')).toBe(false)
    expect(has(out, 'USART_RX_MISSING')).toBe(false)
  })
  it('反：未启用 USART1 时配 TX 引脚不报缺引脚', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX')])
    const out = checkConflicts(cfg, data)
    expect(has(out, 'USART_TX_MISSING')).toBe(false)
    expect(has(out, 'USART_RX_MISSING')).toBe(false)
  })
})

// 13. PERIPHERAL_CLOCK_INVALID
describe('PERIPHERAL_CLOCK_INVALID', () => {
  it('正：AHB 分频 12 非法档位 → error', () => {
    const cfg = makeConfig([], { clock: { source: 'HSI', ahb: 12, apb1: 1, apb2: 1 } })
    const out = checkConflicts(cfg, data)
    const c = out.find((x) => x.code === 'PERIPHERAL_CLOCK_INVALID')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('AHB')
  })
  it('正：PLL HSE 32MHz 超频 → error', () => {
    const cfg = makeConfig([], {
      clock: { source: 'PLL', pllSource: 'HSE', hxtalMhz: 32, pll: { mul: 2 }, ahb: 1, apb1: 1, apb2: 1 },
    })
    const out = checkConflicts(cfg, data)
    expect(out.filter((x) => x.code === 'PERIPHERAL_CLOCK_INVALID').length).toBeGreaterThanOrEqual(1)
  })
  it('反：合法 HSE 24MHz（命中预设）→ 无该规则', () => {
    const cfg = makeConfig([], { clock: { source: 'HSE', hxtalMhz: 24, ahb: 1, apb1: 1, apb2: 1 } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'PERIPHERAL_CLOCK_INVALID')).toBe(false)
  })
  it('反：不配置 clock → 不做时钟检查', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'OUTPUT')]), data)
    expect(has(out, 'PERIPHERAL_CLOCK_INVALID')).toBe(false)
    expect(has(out, 'CLOCK_PRESET_UNAVAILABLE')).toBe(false)
  })
})

// 14. REMAP_MISMATCH
describe('REMAP_MISMATCH', () => {
  it('正：TX=PD5（仅 remap0）+ RX=PD1（仅 remap1）→ 无交集 error（PD1 解锁 SWD）', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD1', 'AF', 'USART1_RX')], {
      peripherals: { USART1: enabled() },
    })
    const out = checkConflicts(cfg, data, ['PD1'])
    const c = out.find((x) => x.code === 'REMAP_MISMATCH')!
    expect(c.level).toBe('error')
    expect(c.peripheral).toBe('USART1')
    expect(c.message).toContain('无交集')
  })
  it('反：PD5 TX + PD6 RX（公共 remap0）→ 无该规则', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD6', 'AF', 'USART1_RX')], {
      peripherals: { USART1: enabled() },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'REMAP_MISMATCH')).toBe(false)
  })
  it('反：PD6 TX + PD5 RX（公共 remap2，外设显式 remap=2）→ 无该规则', () => {
    const cfg = makeConfig([pin('PD6', 'AF', 'USART1_TX'), pin('PD5', 'AF', 'USART1_RX')], {
      peripherals: { USART1: enabled(2) },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'REMAP_MISMATCH')).toBe(false)
    expect(has(out, 'PIN_CONSUMED_TWICE')).toBe(false)
  })
})

// 15. REMAP_UNDEFINED
describe('REMAP_UNDEFINED', () => {
  it('正：PC3 不支持 USART1_TX（数据层无记录）→ error', () => {
    const out = checkConflicts(makeConfig([pin('PC3', 'AF', 'USART1_TX')]), data)
    const c = out.find((x) => x.code === 'REMAP_UNDEFINED')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('不支持信号')
  })
  it('正：PD5 承载 USART1_TX 的 remap 只能是 0，填 2 → error', () => {
    const out = checkConflicts(makeConfig([pin('PD5', 'AF', 'USART1_TX', { remap: 2 })]), data)
    const c = out.find((x) => x.code === 'REMAP_UNDEFINED')!
    expect(c.message).toContain('只能是 0')
  })
  it('正：PC0 没有 ADC 通道 ADC_IN0 → error', () => {
    const out = checkConflicts(makeConfig([pin('PC0', 'ANALOG', 'ADC_IN0')]), data)
    const c = out.find((x) => x.code === 'REMAP_UNDEFINED')!
    expect(c.message).toContain('没有 ADC 通道')
  })
  it('反：PD5 AF USART1_TX remap=0 → 无该规则', () => {
    const out = checkConflicts(makeConfig([pin('PD5', 'AF', 'USART1_TX', { remap: 0 })]), data)
    expect(has(out, 'REMAP_UNDEFINED')).toBe(false)
  })
  it('反：PA2 ANALOG ADC_IN0 → 无该规则', () => {
    const out = checkConflicts(makeConfig([pin('PA2', 'ANALOG', 'ADC_IN0')]), data)
    expect(has(out, 'REMAP_UNDEFINED')).toBe(false)
  })
})

// 16. PIN_CONSUMED_TWICE
describe('PIN_CONSUMED_TWICE', () => {
  it('正：启用 USART1 但 PD5 配成 GPIO OUTPUT → error', () => {
    const cfg = makeConfig([pin('PD5', 'OUTPUT')], { peripherals: { USART1: enabled() } })
    const out = checkConflicts(cfg, data)
    const c = out.find((x) => x.code === 'PIN_CONSUMED_TWICE')!
    expect(c.level).toBe('error')
    expect(c.pins).toEqual(['PD5'])
    expect(c.peripheral).toBe('USART1')
    expect(c.message).toContain('PD5')
  })
  it('反：启用 ADC1 但 PA2 配成 GPIO → 无冲突（ADC 只占用实际 ANALOG 分配的通道）', () => {
    const cfg = makeConfig([pin('PA2', 'OUTPUT')], { peripherals: { ADC1: enabled() } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'PIN_CONSUMED_TWICE')).toBe(false)
  })
  it('反：PD5 以 AF/USART1_TX 归属该外设 → 无该规则', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX')], { peripherals: { USART1: enabled() } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'PIN_CONSUMED_TWICE')).toBe(false)
  })
  it('反：PA2 以 ANALOG/ADC_IN0 归属 ADC1 → 无该规则', () => {
    const cfg = makeConfig([pin('PA2', 'ANALOG', 'ADC_IN0')], { peripherals: { ADC1: enabled() } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'PIN_CONSUMED_TWICE')).toBe(false)
  })
  it('反：未启用的外设不占用引脚', () => {
    const cfg = makeConfig([pin('PD5', 'OUTPUT')], { peripherals: {} })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'PIN_CONSUMED_TWICE')).toBe(false)
  })
})

// 17. CLOCK_PRESET_UNAVAILABLE
describe('CLOCK_PRESET_UNAVAILABLE', () => {
  it('正：非法时钟（ahb=12）附带最近合法预设提示', () => {
    const cfg = makeConfig([], { clock: { source: 'HSI', ahb: 12, apb1: 1, apb2: 1 } })
    const out = checkConflicts(cfg, data)
    const c = out.find((x) => x.code === 'CLOCK_PRESET_UNAVAILABLE')!
    expect(c.level).toBe('warning')
    expect(c.message).toContain('最接近')
    expect(c.message).toContain('24MHz')
  })
  it('反：合法但无预设（HSI 直连 ahb=2）→ 静默走显式 Config，不告警（合法兜底不应告警）', () => {
    const cfg = makeConfig([], { clock: { source: 'HSI', ahb: 2, apb1: 1, apb2: 1 } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'CLOCK_PRESET_UNAVAILABLE')).toBe(false)
    expect(has(out, 'PERIPHERAL_CLOCK_INVALID')).toBe(false)
  })
  it('反：命中 24MHZ_HSE 预设 → 无该规则', () => {
    const cfg = makeConfig([], { clock: { source: 'HSE', hxtalMhz: 24, ahb: 1, apb1: 1, apb2: 1 } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'CLOCK_PRESET_UNAVAILABLE')).toBe(false)
  })
})

// 18. TARGET_FEATURE_UNSUPPORTED
describe('TARGET_FEATURE_UNSUPPORTED', () => {
  const unsupportedData: DeviceData = {
    ...data,
    chip: { ...data.chip, unsupportedFeatures: ['embassy'] },
  }
  it('正：合成 chip 声明不支持 embassy 且启用 embassy → error', () => {
    const cfg = makeConfig([], { features: { embassy: true, debugPrint: true } })
    const out = checkConflicts(cfg, unsupportedData)
    const c = out.find((x) => x.code === 'TARGET_FEATURE_UNSUPPORTED')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('embassy')
  })
  it('反：合成 chip 不支持 embassy 但未启用 → 无该规则', () => {
    const cfg = makeConfig([], { features: { embassy: false, debugPrint: true } })
    const out = checkConflicts(cfg, unsupportedData)
    expect(has(out, 'TARGET_FEATURE_UNSUPPORTED')).toBe(false)
  })
  it('反：真实 V003 数据未声明 unsupportedFeatures → 无该规则', () => {
    const cfg = makeConfig([], { features: { embassy: true, debugPrint: true } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'TARGET_FEATURE_UNSUPPORTED')).toBe(false)
  })
})

// 19. SRAM_BUDGET_EXCEEDED
describe('SRAM_BUDGET_EXCEEDED', () => {
  it('正：合成 1K SRAM + embassy（粗估 1280B > 1024B）→ warning', () => {
    const smallData: DeviceData = { ...data, chip: { ...data.chip, sram: '1K' } }
    const cfg = makeConfig([], { features: { embassy: true, debugPrint: true } })
    const out = checkConflicts(cfg, smallData)
    const c = out.find((x) => x.code === 'SRAM_BUDGET_EXCEEDED')!
    expect(c.level).toBe('warning')
    expect(c.message).toContain('SRAM')
  })
  it('正：真实 2K SRAM + embassy + 4 类外设 + 12 个 EXTI 引脚（粗估 2112B）→ warning', () => {
    const extiPins = ['PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7', 'PD0', 'PD2', 'PD3', 'PD4'].map((p) =>
      pin(p, 'INPUT', undefined, { exti: true }),
    )
    const cfg = makeConfig(extiPins, {
      features: { embassy: true, debugPrint: true },
      peripherals: { USART1: enabled(), SPI1: enabled(), I2C1: enabled(), ADC1: enabled() },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'SRAM_BUDGET_EXCEEDED')).toBe(true)
  })
  it('反：真实 2K SRAM + embassy 无外设（粗估 1280B < 2048B）→ 无该规则', () => {
    const cfg = makeConfig([], { features: { embassy: true, debugPrint: true } })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'SRAM_BUDGET_EXCEEDED')).toBe(false)
  })
  it('反：SRAM 不可解析（空串）时跳过预算检查', () => {
    const noSramData: DeviceData = { ...data, chip: { ...data.chip, sram: '' } }
    const cfg = makeConfig([], { features: { embassy: true, debugPrint: true } })
    const out = checkConflicts(cfg, noSramData)
    expect(has(out, 'SRAM_BUDGET_EXCEEDED')).toBe(false)
  })
})

// 20. DMA_CHANNEL_CONFLICT
describe('DMA_CHANNEL_CONFLICT', () => {
  const conflictDma: DeviceData = {
    ...data,
    dma: {
      chip: 'CH32V003F4P6',
      requests: [
        { request: 'USART1_TX', channel: 5 },
        { request: 'USART1_RX', channel: 5 },
        { request: 'SPI1_TX', channel: 3 },
      ],
    },
  }
  it('正：合成 DMA（USART1_TX/RX 同通道 5）+ embassy → error', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD6', 'AF', 'USART1_RX')], {
      features: { embassy: true, debugPrint: true },
      peripherals: { USART1: enabled() },
    })
    const out = checkConflicts(cfg, conflictDma)
    const c = out.find((x) => x.code === 'DMA_CHANNEL_CONFLICT')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('通道 5')
    expect(c.message).toContain('USART1_TX')
    expect(c.message).toContain('USART1_RX')
  })
  it('反：真实 DMA 请求分属不同通道（TX=4/RX=5）+ embassy → 无该规则', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD6', 'AF', 'USART1_RX')], {
      features: { embassy: true, debugPrint: true },
      peripherals: { USART1: enabled() },
    })
    const out = checkConflicts(cfg, data)
    expect(has(out, 'DMA_CHANNEL_CONFLICT')).toBe(false)
  })
  it('反：embassy 关闭时不做 DMA 通道检查', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX'), pin('PD6', 'AF', 'USART1_RX')], {
      features: { embassy: false, debugPrint: true },
      peripherals: { USART1: enabled() },
    })
    const out = checkConflicts(cfg, conflictDma)
    expect(has(out, 'DMA_CHANNEL_CONFLICT')).toBe(false)
  })
  it('反：无 DMA 数据的芯片 + embassy 不崩溃', () => {
    const noDmaData: DeviceData = { ...data, dma: undefined }
    const cfg = makeConfig([], { features: { embassy: true, debugPrint: true }, peripherals: { USART1: enabled() } })
    const out = checkConflicts(cfg, noDmaData)
    expect(has(out, 'DMA_CHANNEL_CONFLICT')).toBe(false)
  })
})

// 综合场景
describe('综合场景', () => {
  it('完全干净的工程（无引脚无外设无时钟）→ 零冲突', () => {
    expect(checkConflicts(makeConfig([]), data)).toEqual([])
  })
  it('干净的 USART1 remap0 工程（TX+RX、HSE24 预设时钟）→ 零冲突', () => {
    const cfg = makeConfig([pin('PD5', 'AF', 'USART1_TX', { label: 'UART_TX' }), pin('PD6', 'AF', 'USART1_RX', { label: 'UART_RX' })], {
      peripherals: { USART1: enabled() },
      clock: { source: 'HSE', hxtalMhz: 24, ahb: 1, apb1: 1, apb2: 1 },
    })
    expect(checkConflicts(cfg, data)).toEqual([])
  })
  it('错误码全集都属于 20 条规则枚举', () => {
    const all: string[] = [
      'UNKNOWN_PIN', 'DUPLICATE_PIN', 'PIN_NOT_CONFIGURABLE', 'SPECIAL_PIN_LOCKED', 'SPECIAL_PIN_OSC',
      'EXTI_ON_NON_INPUT', 'EXTI_LINE_CONFLICT', 'DUPLICATE_LABEL', 'AF_SIGNAL_DUPLICATE', 'ANALOG_DUPLICATE',
      'USART_RX_MISSING', 'USART_TX_MISSING', 'PERIPHERAL_CLOCK_INVALID', 'REMAP_MISMATCH', 'REMAP_UNDEFINED',
      'PIN_CONSUMED_TWICE', 'CLOCK_PRESET_UNAVAILABLE', 'TARGET_FEATURE_UNSUPPORTED', 'SRAM_BUDGET_EXCEEDED',
      'DMA_CHANNEL_CONFLICT',
    ]
    const cfg = makeConfig(
      [
        pin('PA0', 'OUTPUT', undefined, { label: 'X' }),
        pin('PD5', 'OUTPUT', undefined, { label: 'x' }),
        pin('PD5', 'INPUT'),
        pin('VSS', 'OUTPUT'),
        pin('PD7', 'OUTPUT'),
      ],
      { clock: { source: 'HSE', hxtalMhz: 24, ahb: 12, apb1: 1, apb2: 1 }, peripherals: { USART1: enabled() } },
    )
    const out = checkConflicts(cfg, data)
    for (const c of out) expect(all).toContain(c.code)
    // 且确实触发了一批不同规则
    expect(new Set(out.map((c) => c.code)).size).toBeGreaterThanOrEqual(7)
  })
})
