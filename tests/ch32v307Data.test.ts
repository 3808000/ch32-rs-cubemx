// CH32V307VCT6 数据层（M14-C）：100 脚 LQFP100 / 双 ADC 16 通道 / USART1 四档 remap /
// rcc v3 PLL prediv+mul / 4 预设 / 自定义 riscv32imfc targetSpec。
// 期望值来源：docs/M14_CHIP_INTAKE_CONTRACT.md D1/D4/D5/D6/D9 与 /tmp/m14-research R1 §3 / R2 §3。
// 说明：V307 的器件注册（src/model/device.ts）由主控集成；本测试直接读 data/devices/ch32v307vct6/*.json，
// 不依赖注册表。依赖 D 代理运行时能力（maxBySource 校验、prediv 除法语义）的断言在 D 落地后复核。
import { describe, it, expect } from 'vitest'
import { computeClock, defaultClock, matchPreset, mergeClockConfig, validateClock } from '@/model/clock'
import type { ChipData, ClockData, ClockPreset, PeripheralsData, RemapData, ExtiData } from '@/model/types'

import chipJson from '../data/devices/ch32v307vct6/chip.json'
import clockJson from '../data/devices/ch32v307vct6/clock.json'
import remapJson from '../data/devices/ch32v307vct6/remap.json'
import peripheralsJson from '../data/devices/ch32v307vct6/peripherals.json'
import extiJson from '../data/devices/ch32v307vct6/exti.json'

const chip = chipJson as unknown as ChipData
const clock = clockJson as unknown as ClockData & {
  pll: { params: { key: string; options: number[]; default: number; maxBySource?: Record<string, number> }[] }
}
const remap = remapJson as unknown as RemapData
const peripherals = peripheralsJson as unknown as PeripheralsData
const exti = extiJson as unknown as ExtiData

/** 按预设构造完整时钟配置（与 validate-device-data.mjs 的复现逻辑一致）。 */
function presetConfig(preset: ClockPreset) {
  const match = preset.match as unknown as Record<string, number | string | undefined>
  const pll: Record<string, number> = {}
  for (const param of clock.pll.params) {
    const v = match[param.key]
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

describe('CH32V307VCT6 封装与引脚', () => {
  it('LQFP100：100 脚、每边 25、quad', () => {
    expect(chip.package).toBe('LQFP100')
    expect(chip.packageKind).toBe('quad')
    expect(chip.pinsPerSide).toBe(25)
    expect(chip.pins).toHaveLength(100)
    const count = (side: string) => chip.pins.filter((p) => p.side === side).length
    expect([count('left'), count('bottom'), count('right'), count('top')]).toEqual([25, 25, 25, 25])
  })

  it('引脚编号 1..100 连续且唯一', () => {
    const nums = chip.pins.map((p) => p.number)
    expect(nums).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
  })

  it('类型统计：82 IO + 17 POWER + 1 NC；73 脚为 NC（未使用）', () => {
    const byType = (t: string) => chip.pins.filter((p) => p.type === t).length
    expect([byType('IO'), byType('POWER'), byType('NC')]).toEqual([82, 17, 1])
    const nc = chip.pins.find((p) => p.number === 73)!
    expect(nc.name).toBe('NC')
    expect(nc.type).toBe('NC')
  })

  it('GPIO 80 个（IO 82 = 80 端口脚 + 12/13 专用 OSC）；12/13 不合并 PD0/PD1', () => {
    const gpio = chip.pins.filter((p) => /^P[A-E]\d{1,2}$/.test(p.name))
    expect(gpio).toHaveLength(80)
    // 12/13 为独立 OSC_IN/OSC_OUT，PD0/PD1 在 81/82
    expect(chip.pins.find((p) => p.number === 12)?.name).toBe('OSC_IN')
    expect(chip.pins.find((p) => p.number === 13)?.name).toBe('OSC_OUT')
    expect(chip.pins.find((p) => p.number === 81)?.name).toBe('PD0')
    expect(chip.pins.find((p) => p.number === 82)?.name).toBe('PD1')
    expect(chip.pins.filter((p) => p.special === 'osc').map((p) => p.name)).toEqual(['OSC_IN', 'OSC_OUT'])
  })

  it('D1 元数据：halFeature/target/nightly/deviceId/core/family/flash/sram', () => {
    expect(chip.halFeature).toBe('ch32v307vct6')
    expect(chip.target).toBe('riscv32imfc-unknown-none-elf')
    expect(chip.nightly).toBe(true)
    expect(chip.deviceId).toBe('0x30700508')
    expect(chip.remapModel).toBe('afio_v1')
    expect(chip.core).toBe('QingKe V4F (RV32IMAFC)')
    expect(chip.family).toBe('CH32V307')
    expect(chip.flash).toBe('256K')
    expect(chip.sram).toBe('64K')
    expect(chip.docUrl).toBe('https://www.wch.cn/products/CH32V307.html')
  })

  it('targetSpec 逐字存在：abi=ilp32f、+f/+forced-atomics/+xwchc、atomic-cas=false', () => {
    // targetSpec 类型字段由 D 代理加入 ChipData；此处按 JSON 层读取，避免依赖类型落地时序
    const spec = (chip as unknown as { targetSpec?: Record<string, unknown> }).targetSpec!
    expect(spec).toBeDefined()
    expect(spec.abi).toBe('ilp32f')
    expect(spec.arch).toBe('riscv32')
    expect(spec['atomic-cas']).toBe(false)
    expect(spec['max-atomic-width']).toBe(32)
    expect(spec.features).toBe('+m,+f,+c,+forced-atomics,+xwchc')
    expect(spec.linker).toBe('rust-lld')
    expect(spec['panic-strategy']).toBe('abort')
    expect(Object.keys(spec)).toHaveLength(17)
  })

  it('FT 按数据手册：PA0-7/PB0-1/PC0-5/PC13-15 非 FT，其余 GPIO FT', () => {
    // 12/13 专用 OSC 脚在表 3-1 的 I/O 电平列为空，按非 FT 处理
    const nonFt = new Set(['PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PB0', 'PB1', 'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC13', 'PC14', 'PC15', 'OSC_IN', 'OSC_OUT'])
    for (const p of chip.pins.filter((x) => x.type === 'IO')) {
      expect(p.ft).toBe(!nonFt.has(p.name))
    }
  })
})

describe('ADC 通道（ADC1/ADC2 共用 16 路外部通道）', () => {
  it('IN0-15 与 chip.json 双向一致，ADC1/ADC2 各 16 通道', () => {
    expect(peripherals.adc.map((a) => a.id)).toEqual(['ADC1', 'ADC2'])
    for (const adc of peripherals.adc) {
      expect(adc.channels).toHaveLength(16)
      expect(adc.channels.map((c) => c.channel)).toEqual(Array.from({ length: 16 }, (_, i) => `ADC_IN${i}`))
      for (const c of adc.channels) {
        const pin = chip.pins.find((p) => p.name === c.pin)!
        expect(pin.adc).toContain(c.channel)
      }
    }
    // chip → peripherals 反查
    for (const p of chip.pins) {
      for (const ch of p.adc ?? []) {
        expect(peripherals.adc[0].channels.find((c) => c.channel === ch)?.pin).toBe(p.name)
      }
    }
  })

  it('关键引脚：PA0=IN0、PB0=IN8、PC0=IN10、PC5=IN15', () => {
    expect(chip.pins.find((p) => p.name === 'PA0')?.adc).toEqual(['ADC_IN0'])
    expect(chip.pins.find((p) => p.name === 'PB0')?.adc).toEqual(['ADC_IN8'])
    expect(chip.pins.find((p) => p.name === 'PC0')?.adc).toEqual(['ADC_IN10'])
    expect(chip.pins.find((p) => p.name === 'PC5')?.adc).toEqual(['ADC_IN15'])
  })
})

describe('remap 表与 USART1 四档', () => {
  it('(pin, signal, remap) 三元组唯一；每条引用现有 IO 引脚', () => {
    const seen = new Set<string>()
    const pinNames = new Set(chip.pins.map((p) => p.name))
    for (const e of remap.entries) {
      const key = `${e.pin}|${e.signal}|${e.remap}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      expect(pinNames.has(e.pin)).toBe(true)
    }
  })

  it('USART1 四档 remap 0..3（PCFR1.USART1_RM bit0 + PCFR2.USART1_RM2 bit1）', () => {
    const usart1 = peripherals.usart[0]!
    expect(usart1.id).toBe('USART1')
    expect(usart1.remaps.map((r) => r.remap)).toEqual([0, 1, 2, 3])
    const byRemap = new Map(usart1.remaps.map((r) => [r.remap, `${r.tx}/${r.rx}`]))
    expect(byRemap.get(0)).toBe('PA9/PA10')
    expect(byRemap.get(1)).toBe('PB6/PB7')
    expect(byRemap.get(2)).toBe('PB15/PA8')
    expect(byRemap.get(3)).toBe('PA6/PA7')
    for (const r of usart1.remaps) {
      expect(remap.entries).toContainEqual({ pin: r.tx, signal: 'USART1_TX', remap: r.remap })
      expect(remap.entries).toContainEqual({ pin: r.rx, signal: 'USART1_RX', remap: r.remap })
    }
  })

  it('USART2/3/4-8 档位照 ch32-data（USART3 只 0/1/3，USART8 只 0/1）', () => {
    const ids = peripherals.usart.map((u) => u.id)
    expect(ids).toEqual(['USART1', 'USART2', 'USART3', 'USART4', 'USART5', 'USART6', 'USART7', 'USART8'])
    expect(peripherals.usart[2].remaps.map((r) => r.remap)).toEqual([0, 1, 3])
    expect(peripherals.usart[7].remaps.map((r) => r.remap)).toEqual([0, 1])
  })

  it('SPI2/I2C2 只有 remap 0；SPI1/SPI3/I2C1 两档', () => {
    expect(peripherals.spi.map((s) => s.id)).toEqual(['SPI1', 'SPI2', 'SPI3'])
    expect(peripherals.spi[1].remaps.map((r) => r.remap)).toEqual([0])
    expect(peripherals.spi[0].remaps.map((r) => r.remap)).toEqual([0, 1])
    expect(peripherals.spi[2].remaps.map((r) => r.remap)).toEqual([0, 1])
    expect(peripherals.i2c[1].remaps.map((r) => r.remap)).toEqual([0])
    expect(peripherals.i2c[0].remaps.map((r) => r.remap)).toEqual([0, 1])
  })

  it('peripherals 中每个 remap 引脚都能在 remap.json 找到同档信号', () => {
    for (const u of peripherals.usart) {
      for (const r of u.remaps) {
        expect(remap.entries).toContainEqual({ pin: r.tx, signal: `${u.id}_TX`, remap: r.remap })
        expect(remap.entries).toContainEqual({ pin: r.rx, signal: `${u.id}_RX`, remap: r.remap })
      }
    }
    for (const s of peripherals.spi) {
      for (const r of s.remaps) {
        for (const [sig, pin] of Object.entries({ SCK: r.sck, MOSI: r.mosi, MISO: r.miso })) {
          expect(remap.entries).toContainEqual({ pin, signal: `${s.id}_${sig}`, remap: r.remap })
        }
      }
    }
    for (const i of peripherals.i2c) {
      for (const r of i.remaps) {
        expect(remap.entries).toContainEqual({ pin: r.scl, signal: `${i.id}_SCL`, remap: r.remap })
        expect(remap.entries).toContainEqual({ pin: r.sda, signal: `${i.id}_SDA`, remap: r.remap })
      }
    }
  })
})

describe('EXTI', () => {
  it('80 个 GPIO 逐脚 channel=端口内号；IRQ 分组 EXTI0..4/EXTI9_5/EXTI15_10', () => {
    expect(exti.entries).toHaveLength(80)
    for (const e of exti.entries) {
      const ch = parseInt(e.pin.slice(2), 10)
      expect(e.channel).toBe(ch)
      const want = ch <= 4 ? `EXTI${ch}` : ch <= 9 ? 'EXTI9_5' : 'EXTI15_10'
      expect(e.irq).toBe(want)
    }
    // 12/13 专用 OSC 脚不是 EXTI；NC/POWER 也不录入
    expect(exti.entries.some((e) => e.pin === 'OSC_IN' || e.pin === 'OSC_OUT' || e.pin === 'NC')).toBe(false)
  })
})

describe('时钟（rcc v3：输入 ÷ prediv × mul）', () => {
  it('基础参数：144MHz、HSE 3-25MHz 默认 8、defaultSource=PLL、ADC 仅 APB2_DIV2', () => {
    expect(clock.sysclkMaxMhz).toBe(144)
    expect(clock.defaultSource).toBe('PLL')
    const hse = clock.sources.find((s) => s.id === 'HSE')!
    expect(hse.hxtal).toEqual({ min: 3, max: 25, default: 8 })
    expect(clock.sources.find((s) => s.id === 'HSI')?.freqMhz).toBe(8)
    expect(clock.adc.options.map((o) => o.id)).toEqual(['APB2_DIV2'])
    expect(clock.adc.maxMhz).toBe(14)
    expect(clock.timerClock).toBe('apb_x2')
    expect(clock.apb1.maxMhz).toBe(144)
    expect(clock.apb2.maxMhz).toBe(144)
    expect(clock.codegen.fallback).toBe('preset_only')
  })

  it('mul 档位：无 ×2，含 6.5 与 18；默认 18', () => {
    const mul = clock.pll.params.find((p) => p.key === 'mul')!
    expect(mul.options).not.toContain(2)
    expect(mul.options).toContain(6.5)
    expect(mul.options).toContain(18)
    expect(mul.options).toEqual([3, 4, 5, 6, 6.5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18])
    expect(mul.default).toBe(18)
  })

  it('prediv：DIV1..16 默认 1，HSI 源 maxBySource=2（JSON 层；validate 运行时依赖 D）', () => {
    const prediv = clock.pll.params.find((p) => p.key === 'prediv')!
    expect(prediv.options).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(prediv.default).toBe(1)
    expect(prediv.maxBySource).toEqual({ HSI: 2 })
  })

  it('4 预设复现 144/144/96/48 且 matchPreset 命中', () => {
    expect(clock.presets.map((p) => p.id)).toEqual(['144MHZ_HSI', '144MHZ_HSE', '96MHZ_HSI', '48MHZ_HSE'])
    const expected: [string, number][] = [
      ['144MHZ_HSI', 144],
      ['144MHZ_HSE', 144],
      ['96MHZ_HSI', 96],
      ['48MHZ_HSE', 48],
    ]
    for (const [id, mhz] of expected) {
      const preset = clock.presets.find((p) => p.id === id)!
      const cfg = presetConfig(preset)
      expect(computeClock(clock, cfg).sysclkMhz).toBeCloseTo(mhz, 9)
      expect(matchPreset(clock, cfg)?.id).toBe(id)
      expect(clock.codegen.presetConstMap[id]).toBeTruthy()
      expect(validateClock(clock, cfg).filter((i) => i.level === 'error')).toEqual([])
    }
  })

  it('48MHZ_HSE 映射到上游错名常量 SYSCLK_FREQ_96MHZ_HSE（实际字段 8×6=48MHz）', () => {
    expect(clock.codegen.presetConstMap['48MHZ_HSE']).toBe('hal::rcc::Config::SYSCLK_FREQ_96MHZ_HSE')
    const preset = clock.presets.find((p) => p.id === '48MHZ_HSE')!
    expect(presetConfig(preset).pll).toMatchObject({ prediv: 1, mul: 6 })
    expect(computeClock(clock, presetConfig(preset)).sysclkMhz).toBe(48)
  })

  it('defaultClock 落 144MHZ_HSI（PLL+HSI+prediv1+mul18）且 0 error', () => {
    const cfg = defaultClock(clock)
    expect(cfg.source).toBe('PLL')
    expect(cfg.pllSource).toBe('HSI')
    expect(cfg.pll).toMatchObject({ prediv: 1, mul: 18 })
    expect(computeClock(clock, cfg).sysclkMhz).toBe(144)
    expect(matchPreset(clock, cfg)?.id).toBe('144MHZ_HSI')
    expect(validateClock(clock, cfg).filter((i) => i.level === 'error')).toEqual([])
  })

  it('96MHZ_HSI 的 APB1/APB2 为 ÷4', () => {
    const preset = clock.presets.find((p) => p.id === '96MHZ_HSI')!
    expect(preset.match.apb1).toBe(4)
    expect(preset.match.apb2).toBe(4)
    const f = computeClock(clock, presetConfig(preset))
    expect(f.pclk1Mhz).toBe(24)
    expect(f.pclk2Mhz).toBe(24)
  })

  // D 代理落地后的运行时复核：prediv 做除法、maxBySource 对当前 PLL 源生效
  it('prediv 除法：HSE 8MHz ÷ 2 × 18 = 72MHz', () => {
    const cfg = mergeClockConfig(clock, {
      source: 'PLL',
      pllSource: 'HSE',
      hxtalMhz: 8,
      pll: { prediv: 2, mul: 18 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
    })
    expect(computeClock(clock, cfg).sysclkMhz).toBe(72)
  })

  it('HSI 源 prediv=3 超出 maxBySource=2 → validate error', () => {
    const cfg = mergeClockConfig(clock, {
      source: 'PLL',
      pllSource: 'HSI',
      pll: { prediv: 3, mul: 18 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
    })
    const errors = validateClock(clock, cfg).filter((i) => i.level === 'error')
    expect(errors.some((i) => i.message.includes('上限 2'))).toBe(true)
  })
})
