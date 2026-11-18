// CH32V103C8T6 数据层（M14-A）：48 脚 LQFP48 / 6 时钟预设 / ADC IN0-9 / remap 唯一性。
// 期望值硬编码自 docs/M14_CHIP_INTAKE_CONTRACT.md D1/D4/D6/D9 与 /tmp/m14-research/R1-hal-facts.md §1、
// R2-pinouts.md §1（逐字核对 ch32-hal src/rcc/v1.rs 与 ch32-data）。
import { describe, it, expect } from 'vitest'
import {
  computeClock,
  mergeClockConfig,
  defaultClock,
  matchPreset,
  validateClock,
} from '@/model/clock'
import type {
  ChipData,
  ClockConfig,
  ClockData,
  ClockPreset,
  ExtiData,
  PeripheralsData,
  RemapData,
} from '@/model/types'
import chipJson from '../data/devices/ch32v103c8t6/chip.json'
import remapJson from '../data/devices/ch32v103c8t6/remap.json'
import extiJson from '../data/devices/ch32v103c8t6/exti.json'
import clockJson from '../data/devices/ch32v103c8t6/clock.json'
import peripheralsJson from '../data/devices/ch32v103c8t6/peripherals.json'

// 直接读取数据文件：src/model/device.ts 的注册表由主控集成时统一追加（A 域外），
// 本测试只校验 A 交付的 JSON 本身，不依赖注册表是否已更新。
const data = {
  chip: chipJson as unknown as ChipData,
  remap: remapJson as unknown as RemapData,
  exti: extiJson as unknown as ExtiData,
  clock: clockJson as unknown as ClockData,
  peripherals: peripheralsJson as unknown as PeripheralsData,
}
const clock = data.clock

/** 按预设构造完整时钟配置（与 validate-device-data.mjs 的复现逻辑一致）。 */
function presetConfig(preset: ClockPreset): ClockConfig {
  const pll: Record<string, number> = {}
  // V103 有 PLL（D3.2 起 ClockData.pll 可缺省；本芯片数据必然存在）
  for (const param of clock.pll!.params) {
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

describe('CH32V103C8T6 引脚（LQFP48）', () => {
  it('48 脚，编号 1..48 连续，四边各 12', () => {
    expect(data.chip.pins).toHaveLength(48)
    expect(data.chip.packageKind).toBe('quad')
    expect(data.chip.pinsPerSide).toBe(12)
    expect(data.chip.pins.map((p) => p.number)).toEqual(Array.from({ length: 48 }, (_, i) => i + 1))
    for (const side of ['left', 'bottom', 'right', 'top'] as const) {
      expect(data.chip.pins.filter((p) => p.side === side)).toHaveLength(12)
    }
  })

  it('37 个 GPIO：PA0-15 / PB0-15 / PC13-15 / PD0-1', () => {
    const io = data.chip.pins.filter((p) => p.type === 'IO').map((p) => p.name)
    const expected = [
      ...Array.from({ length: 16 }, (_, i) => `PA${i}`),
      ...Array.from({ length: 16 }, (_, i) => `PB${i}`),
      'PC13',
      'PC14',
      'PC15',
      'PD0',
      'PD1',
    ]
    expect(new Set(io)).toEqual(new Set(expected))
    expect(io).toHaveLength(37)
    // POWER 11 个：VBAT/NRST/VSSA/VDDA/VSS_1/VDD_1/VSS_2/VDD_2/BOOT0/VSS_3/VDD_3
    expect(data.chip.pins.filter((p) => p.type === 'POWER')).toHaveLength(11)
  })

  it('ADC IN0-9 在 chip.json 与 peripherals.json 双向一致', () => {
    const chipAdc = new Map<string, string>()
    for (const p of data.chip.pins) for (const ch of p.adc ?? []) chipAdc.set(ch, p.name)
    const expected: Record<string, string> = {
      ADC_IN0: 'PA0',
      ADC_IN1: 'PA1',
      ADC_IN2: 'PA2',
      ADC_IN3: 'PA3',
      ADC_IN4: 'PA4',
      ADC_IN5: 'PA5',
      ADC_IN6: 'PA6',
      ADC_IN7: 'PA7',
      ADC_IN8: 'PB0',
      ADC_IN9: 'PB1',
    }
    expect(Object.fromEntries(chipAdc)).toEqual(expected)
    expect(data.peripherals.adc).toHaveLength(1)
    const adc = data.peripherals.adc[0]
    expect(Object.fromEntries(adc.channels.map((c) => [c.channel, c.pin]))).toEqual(expected)
    expect(adc.channels).toHaveLength(10)
  })
})

describe('CH32V103C8T6 remap 数据', () => {
  it('(pin, signal, remap) 三元组唯一且引用的引脚均存在且为 IO', () => {
    const pinByName = new Map(data.chip.pins.map((p) => [p.name, p]))
    const seen = new Set<string>()
    for (const e of data.remap.entries) {
      const key = `${e.pin}|${e.signal}|${e.remap}`
      expect(seen.has(key), `重复三元组 ${key}`).toBe(false)
      seen.add(key)
      const pin = pinByName.get(e.pin)
      expect(pin, `remap 引用不存在的引脚 ${e.pin}`).toBeTruthy()
      expect(pin!.type, `${e.pin} 非 IO 却有复用信号`).toBe('IO')
    }
    // LQFP48 未引出的 PC0-PC12 / PD2-PD15 不应出现在 remap 中
    for (const e of data.remap.entries) {
      expect(pinByName.has(e.pin), `${e.pin} 不在 LQFP48 封装内`).toBe(true)
    }
  })

  it('USART/SPI/I2C 的每一档 remap 都能在 remap.json 找到对应信号', () => {
    const has = (pin: string, signal: string, remap: number) =>
      data.remap.entries.some((e) => e.pin === pin && e.signal === signal && e.remap === remap)
    for (const u of data.peripherals.usart) {
      for (const r of u.remaps) {
        expect(has(r.tx, `${u.id}_TX`, r.remap), `${u.id}_TX@${r.tx}/${r.remap}`).toBe(true)
        expect(has(r.rx, `${u.id}_RX`, r.remap), `${u.id}_RX@${r.rx}/${r.remap}`).toBe(true)
      }
    }
    for (const s of data.peripherals.spi) {
      for (const r of s.remaps) {
        expect(has(r.sck, `${s.id}_SCK`, r.remap), `${s.id}_SCK@${r.sck}/${r.remap}`).toBe(true)
        expect(has(r.mosi, `${s.id}_MOSI`, r.remap), `${s.id}_MOSI@${r.mosi}/${r.remap}`).toBe(true)
        expect(has(r.miso, `${s.id}_MISO`, r.remap), `${s.id}_MISO@${r.miso}/${r.remap}`).toBe(true)
      }
    }
    for (const ic of data.peripherals.i2c) {
      for (const r of ic.remaps) {
        expect(has(r.scl, `${ic.id}_SCL`, r.remap), `${ic.id}_SCL@${r.scl}/${r.remap}`).toBe(true)
        expect(has(r.sda, `${ic.id}_SDA`, r.remap), `${ic.id}_SDA@${r.sda}/${r.remap}`).toBe(true)
      }
    }
  })
})

describe('CH32V103C8T6 时钟预设（sysclkMax 80MHz）', () => {
  it('6 预设：48/72/80MHz × HSI/HSE，computeClock 复现标称频率且 matchPreset 命中', () => {
    const expected = [
      ['48MHZ_HSI', 48, 'HSI', 6, 1, 1],
      ['72MHZ_HSI', 72, 'HSI', 9, 2, 2],
      ['48MHZ_HSE', 48, 'HSE', 6, 1, 1],
      ['72MHZ_HSE', 72, 'HSE', 9, 2, 2],
      ['80MHZ_HSI', 80, 'HSI', 10, 2, 2],
      ['80MHZ_HSE', 80, 'HSE', 10, 2, 2],
    ] as const
    expect(clock.presets.map((p) => p.id)).toEqual(expected.map(([id]) => id))
    for (const [id, mhz, pllSource, mul, apb1, apb2] of expected) {
      const preset = clock.presets.find((p) => p.id === id)!
      expect(preset.match.source).toBe('PLL')
      expect(preset.match.pllSource).toBe(pllSource)
      expect(preset.match.prediv).toBe(1)
      expect(preset.match.mul).toBe(mul)
      expect(preset.match.apb1).toBe(apb1)
      expect(preset.match.apb2).toBe(apb2)
      const cfg = presetConfig(preset)
      expect(computeClock(clock, cfg).sysclkMhz).toBeCloseTo(mhz, 9)
      expect(matchPreset(clock, cfg)?.id).toBe(id)
    }
  })

  it('presetConstMap 6 项：48/72 用 HAL 常量，80 用覆写 pll 的块表达式，fallback=explicit', () => {
    expect(Object.keys(clock.codegen.presetConstMap)).toHaveLength(6)
    expect(clock.codegen.fallback).toBe('explicit')
    expect(clock.codegen.presetConstMap['48MHZ_HSI']).toBe('hal::rcc::Config::SYSCLK_FREQ_48MHZ_HSI')
    expect(clock.codegen.presetConstMap['72MHZ_HSI']).toBe('hal::rcc::Config::SYSCLK_FREQ_72MHZ_HSI')
    expect(clock.codegen.presetConstMap['48MHZ_HSE']).toBe('hal::rcc::Config::SYSCLK_FREQ_48MHZ_HSE')
    expect(clock.codegen.presetConstMap['72MHZ_HSE']).toBe('hal::rcc::Config::SYSCLK_FREQ_72MHZ_HSE')
    for (const id of ['80MHZ_HSI', '80MHZ_HSE']) {
      const expr = clock.codegen.presetConstMap[id]
      expect(expr).toContain('SYSCLK_FREQ_72MHZ_')
      expect(expr).toContain('hal::rcc::PllPreDiv::DIV1')
      expect(expr).toContain('hal::pac::rcc::vals::PllMul::MUL10')
    }
  })

  it('defaultClock 落 48MHZ_HSI（PLL+HSI+prediv1+mul6+全 1）且 validate 0 error', () => {
    const d = defaultClock(clock)
    expect(clock.defaultSource).toBe('PLL')
    expect(d.source).toBe('PLL')
    expect(d.pllSource).toBe('HSI')
    expect(d.pll).toEqual({ prediv: 1, mul: 6 })
    expect(computeClock(clock, d).sysclkMhz).toBe(48)
    expect(matchPreset(clock, d)?.id).toBe('48MHZ_HSI')
    expect(validateClock(clock, d).filter((i) => i.level === 'error')).toEqual([])
  })

  it('80MHz 配方（mul=10, prediv=1, APB1/APB2=2）validateClock 0 error', () => {
    const cfg = mergeClockConfig(clock, {
      source: 'PLL',
      pllSource: 'HSI',
      pll: { prediv: 1, mul: 10 },
      ahb: 1,
      apb1: 2,
      apb2: 2,
    })
    const f = computeClock(clock, cfg)
    expect(f.sysclkMhz).toBe(80)
    expect(f.hclkMhz).toBe(80)
    expect(f.pclk1Mhz).toBe(40)
    expect(f.pclk2Mhz).toBe(40)
    expect(validateClock(clock, cfg).filter((i) => i.level === 'error')).toEqual([])
  })

  // 依赖 D3.1（src/model/clock/index.ts pllOutMhz 的 prediv 除法语义）。
  // 模型扩展落地前 computeClock 会把 prediv 当乘法（8×2×6=96），此用例会失败；集成时复核。
  it('prediv 除法语义：8MHz ÷ 2 × 6 = 24MHz（pllOut 在除后乘）', () => {
    const cfg = mergeClockConfig(clock, {
      source: 'PLL',
      pllSource: 'HSI',
      pll: { prediv: 2, mul: 6 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
    })
    const f = computeClock(clock, cfg)
    expect(f.pllInMhz).toBe(8)
    expect(f.pllOutMhz).toBe(24)
    expect(f.sysclkMhz).toBe(24)
  })
})
