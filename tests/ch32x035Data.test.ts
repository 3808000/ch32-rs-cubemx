// CH32X035C8T6 数据层（M14）：LQFP48 48 脚 / 无 PLL 时钟（HSI 48MHz + AHB 分频）/ SPI v0 仅 MSB-first /
// EXTI 三组 IRQ（EXTI7_0 / EXTI15_8 / EXTI25_16）。
// 期望值硬编码自 docs/M14_CHIP_INTAKE_CONTRACT.md D1/D2/D4/D5/D6 与 R1 §2（ch32-hal src/rcc/x0.rs、
// src/spi.rs、src/adc.rs）与 R2 §2（CH32X035DS0 V2.3 表 2-1）。数据文件直接以 JSON 导入（不经 device.ts
// 注册表），测试只验证数据本身；注册表接入由集成方完成。
import { describe, it, expect } from 'vitest'
import { computeClock, defaultClock, matchPreset, mergeClockConfig, validateClock } from '@/model/clock'
import type {
  ChipData,
  ClockConfig,
  ClockData,
  ClockPreset,
  ExtiData,
  InterruptsData,
  PeripheralsData,
  RemapData,
} from '@/model/types'
import chipJson from '../data/devices/ch32x035c8t6/chip.json'
import remapJson from '../data/devices/ch32x035c8t6/remap.json'
import extiJson from '../data/devices/ch32x035c8t6/exti.json'
import clockJson from '../data/devices/ch32x035c8t6/clock.json'
import peripheralsJson from '../data/devices/ch32x035c8t6/peripherals.json'
import interruptsJson from '../data/devices/ch32x035c8t6/interrupts.json'

const chip = chipJson as unknown as ChipData
const remap = remapJson as unknown as RemapData
const exti = extiJson as unknown as ExtiData
const clock = clockJson as unknown as ClockData
const peripherals = peripheralsJson as unknown as PeripheralsData
const interrupts = interruptsJson as unknown as InterruptsData

const ioPins = chip.pins.filter((p) => p.type === 'IO')
const pinNames = new Set(chip.pins.map((p) => p.name))

/** 预设 → 完整配置（与 validate-device-data.mjs 的复现逻辑一致；无 PLL 芯片不传 pll 参数）。 */
function presetConfig(preset: ClockPreset): ClockConfig {
  return mergeClockConfig(clock, {
    source: preset.match.source,
    hxtalMhz: preset.match.hxtalMhz,
    ahb: preset.match.ahb,
    apb1: preset.match.apb1,
    apb2: preset.match.apb2,
  })
}

describe('CH32X035C8T6 芯片元数据（契约 D1）', () => {
  it('halFeature/target/nightly/存储/deviceId 逐字符合契约', () => {
    expect(chip.chip).toBe('CH32X035C8T6')
    expect(chip.family).toBe('CH32X035')
    expect(chip.core).toBe('QingKe V4C (RV32IMAC)')
    expect(chip.halFeature).toBe('ch32x035c8t6')
    expect(chip.target).toBe('riscv32imc-unknown-none-elf')
    expect(chip.nightly).toBe(false)
    expect(chip.flash).toBe('62K')
    expect(chip.sram).toBe('20K')
    expect(chip.deviceId).toBe('0x03510601')
    expect(chip.remapModel).toBe('afio_v1')
    expect(chip.docUrl).toBe('https://www.wch.cn/products/CH32X035.html')
    expect(chip.unsupportedFeatures).toBeUndefined()
  })

  it('source 记录数据手册编号/版本/表号与 ch32-data 交叉核对', () => {
    expect(chip.source).toContain('CH32X035DS0 V2.3')
    expect(chip.source).toContain('表 2-1')
    expect(chip.source).toContain('id=443')
    expect(chip.source).toContain('ch32-data')
  })
})

describe('CH32X035C8T6 引脚表（LQFP48，契约 D2 / R2 §2.2）', () => {
  it('48 脚：46 IO + 2 POWER，编号 1..48 连续，每边 12', () => {
    expect(chip.package).toBe('LQFP48')
    expect(chip.packageKind).toBe('quad')
    expect(chip.pinsPerSide).toBe(12)
    expect(chip.pins).toHaveLength(48)
    expect(ioPins).toHaveLength(46)
    expect(chip.pins.filter((p) => p.type === 'POWER')).toHaveLength(2)
    expect(chip.pins.map((p) => p.number)).toEqual(Array.from({ length: 48 }, (_, i) => i + 1))
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(chip.pins.filter((p) => p.side === side)).toHaveLength(12)
    }
  })

  it('引脚名唯一，电源脚为 GND(47)/VDD(48)', () => {
    expect(new Set(chip.pins.map((p) => p.name)).size).toBe(48)
    expect(chip.pins.find((p) => p.number === 47)?.name).toBe('GND')
    expect(chip.pins.find((p) => p.number === 48)?.name).toBe('VDD')
    expect(chip.pins.find((p) => p.number === 47)?.type).toBe('POWER')
    expect(chip.pins.find((p) => p.number === 48)?.type).toBe('POWER')
  })

  it('GPIO 端口集合为 PA0-23 / PB0-13 / PC6-7,PC14-19（LQFP48 未引出 PC0-5、PB14-21）', () => {
    const expected = [
      ...Array.from({ length: 24 }, (_, i) => `PA${i}`),
      ...Array.from({ length: 14 }, (_, i) => `PB${i}`),
      'PC6',
      'PC7',
      'PC14',
      'PC15',
      'PC16',
      'PC17',
      'PC18',
      'PC19',
    ]
    expect([...ioPins.map((p) => p.name)].sort()).toEqual([...expected].sort())
  })

  it('ADC 引脚：PA0-PA7=IN0-7、PB0/PB1=IN8/IN9，共 10 个外部通道', () => {
    const adcPins = chip.pins.flatMap((p) => (p.adc ?? []).map((ch) => [ch, p.name] as const))
    expect(Object.fromEntries(adcPins)).toEqual({
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
    })
  })

  it('RST 复用 PA21（special=nrst）、SWD 在 PC18/PC19、PC17 仅带 BOOT alias', () => {
    const rst = chip.pins.find((p) => p.name === 'PA21')!
    expect(rst.type).toBe('IO')
    expect(rst.special).toBe('nrst')
    expect(rst.aliases).toContain('RST')
    expect(chip.pins.find((p) => p.name === 'PC18')!.special).toBe('swd')
    expect(chip.pins.find((p) => p.name === 'PC19')!.special).toBe('swd')
    const boot = chip.pins.find((p) => p.name === 'PC17')!
    expect(boot.aliases).toContain('BOOT')
    expect(boot.aliases).toContain('UDP')
    expect(boot.special ?? null).toBeNull()
  })

  it('表 2-1 无 FT 列 → 全部 ft=false', () => {
    expect(chip.pins.every((p) => p.ft === false)).toBe(true)
  })
})

describe('CH32X035C8T6 remap 表', () => {
  it('(pin, signal, remap) 三元组唯一，且只引用 LQFP48 上的 IO 引脚', () => {
    const seen = new Set<string>()
    for (const e of remap.entries) {
      expect(pinNames.has(e.pin)).toBe(true)
      expect(ioPins.some((p) => p.name === e.pin)).toBe(true)
      const key = `${e.pin}|${e.signal}|${e.remap}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(remap.entries.length).toBeGreaterThan(0)
  })

  it('外设 remap 各档在 remap.json 中都有对应 (pin, signal, remap) 条目', () => {
    const has = (pin: string, signal: string, r: number) =>
      remap.entries.some((e) => e.pin === pin && e.signal === signal && e.remap === r)
    for (const u of peripherals.usart) {
      for (const rm of u.remaps) {
        for (const sig of ['tx', 'rx'] as const) {
          expect(has(rm[sig], `${u.id}_${sig.toUpperCase()}`, rm.remap)).toBe(true)
        }
      }
    }
    for (const s of peripherals.spi) {
      for (const rm of s.remaps) {
        for (const sig of ['sck', 'mosi', 'miso'] as const) {
          expect(has(rm[sig], `${s.id}_${sig.toUpperCase()}`, rm.remap)).toBe(true)
        }
      }
    }
    for (const ic of peripherals.i2c) {
      for (const rm of ic.remaps) {
        for (const sig of ['scl', 'sda'] as const) {
          expect(has(rm[sig], `${ic.id}_${sig.toUpperCase()}`, rm.remap)).toBe(true)
        }
      }
    }
  })
})

describe('CH32X035C8T6 外设实例（契约 D6，逐档溯源 ch32-data CH32X0.yaml + X035_I2C1.yaml）', () => {
  it('USART1-4 各档 remap 号（LQFP48 裁剪后）', () => {
    const ids = peripherals.usart.map((u) => u.id)
    expect(ids).toEqual(['USART1', 'USART2', 'USART3', 'USART4'])
    const byId = Object.fromEntries(peripherals.usart.map((u) => [u.id, u.remaps.map((r) => r.remap)]))
    // USART2 remap3 的 TX/RX 在 PC0/PC1（未引出）→ 整档剔除
    // USART3 remap2 的 RX 在 PB14（未引出）→ 整档剔除
    expect(byId).toEqual({
      USART1: [0, 1, 2, 3],
      USART2: [0, 1, 2, 4],
      USART3: [0, 1],
      USART4: [0, 1, 2, 3, 4, 5],
    })
  })

  it('USART1 remap0 引脚逐字符合表 2-3（TX PB10 / RX PB11 / CK PB9 / CTS PC16 / RTS PC17）', () => {
    const r0 = peripherals.usart[0].remaps.find((r) => r.remap === 0)!
    expect(r0).toMatchObject({ tx: 'PB10', rx: 'PB11', ck: 'PB9', cts: 'PC16', rts: 'PC17' })
  })

  it('SPI1 仅保留 LQFP48 可用的 remap0/remap2（remap1 SCK=PB15、remap3 SCK=PC5 未引出）', () => {
    expect(peripherals.spi.map((s) => s.id)).toEqual(['SPI1'])
    const remaps = peripherals.spi[0].remaps
    expect(remaps.map((r) => r.remap)).toEqual([0, 2])
    expect(remaps.find((r) => r.remap === 0)).toMatchObject({ sck: 'PA5', mosi: 'PA7', miso: 'PA6', nss: 'PA4' })
    expect(remaps.find((r) => r.remap === 2)).toMatchObject({ sck: 'PA11', mosi: 'PA10', miso: 'PA9', nss: 'PA12' })
  })

  it('I2C1 六档（0..5），SCL/SDA 全部落在 LQFP48 引脚', () => {
    expect(peripherals.i2c.map((i) => i.id)).toEqual(['I2C1'])
    expect(peripherals.i2c[0].remaps.map((r) => r.remap)).toEqual([0, 1, 2, 3, 4, 5])
    expect(peripherals.i2c[0].remaps.find((r) => r.remap === 3)).toMatchObject({ scl: 'PC19', sda: 'PC18' })
  })

  it('ADC1 与 chip.json 双向一致（IN0-IN9 ↔ 引脚）', () => {
    expect(peripherals.adc.map((a) => a.id)).toEqual(['ADC1'])
    const chipAdc = new Map<string, string>()
    for (const p of chip.pins) for (const ch of p.adc ?? []) chipAdc.set(ch, p.name)
    const periAdc = new Map(peripherals.adc[0].channels.map((c) => [c.channel, c.pin]))
    expect(periAdc.size).toBe(10)
    expect(Object.fromEntries(periAdc)).toEqual(Object.fromEntries(chipAdc))
  })

  it('参数默认值都在 options 内（validate 门禁）', () => {
    const specs = [
      ...peripherals.usart.flatMap((u) => Object.entries(u.params)),
      ...peripherals.spi.flatMap((s) => Object.entries(s.params)),
      ...peripherals.i2c.flatMap((i) => Object.entries(i.params)),
      ...peripherals.adc.flatMap((a) => Object.entries(a.params)),
    ]
    for (const [key, spec] of specs) {
      if (spec.options) expect(spec.options, key).toContain(spec.default)
      else expect(['number', 'boolean'], key).toContain(spec.kind)
    }
  })
})

describe('CH32X035C8T6 SPI v0 位序限制（契约 D6 / R1 §2.4）', () => {
  it('SPI1 bitOrder options 仅 ["MsbFirst"]，默认 MsbFirst', () => {
    for (const spi of peripherals.spi) {
      const bitOrder = spi.params.bitOrder
      expect(bitOrder.options).toEqual(['MsbFirst'])
      expect(bitOrder.default).toBe('MsbFirst')
      expect(bitOrder.options).not.toContain('LsbFirst')
    }
  })
})

describe('CH32X035C8T6 时钟数据（契约 D4）', () => {
  it('clock.json 无 pll 字段（无 PLL 芯片，D3.2）', () => {
    expect('pll' in (clockJson as Record<string, unknown>)).toBe(false)
    expect(clock.pll).toBeUndefined()
  })

  it('时钟源仅 HSI 48MHz，无 HSE/LSI/LSE 选择', () => {
    expect(clock.sources.map((s) => s.id)).toEqual(['HSI'])
    expect(clock.sources[0].freqMhz).toBe(48)
    expect(clock.sources.some((s) => s.hxtal)).toBe(false)
    expect(clock.sysclkMaxMhz).toBe(48)
  })

  it('AHB 档位 1..8/16/32/64/128/256，APB1/APB2 固定 1', () => {
    expect(clock.ahb.options).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 64, 128, 256])
    expect(clock.ahb.default).toBe(1)
    expect(clock.ahb.maxMhz).toBe(48)
    expect(clock.apb1.options).toEqual([1])
    expect(clock.apb2.options).toEqual([1])
    expect(clock.apb1.maxMhz).toBe(48)
    expect(clock.apb2.maxMhz).toBe(48)
  })

  it('ADC 源为 SYSCLK/CLK_DIV（div=8，上限 14MHz，label 标注语义待核实）', () => {
    expect(clock.adc.options).toHaveLength(1)
    const adc = clock.adc.options[0]
    expect(adc.id).toBe('SYS')
    expect(adc.source).toBe('SYSCLK')
    expect(adc.div).toBe(8)
    expect(clock.adc.default).toBe('SYS')
    expect(clock.adc.maxMhz).toBe(14)
    expect(adc.label).toContain('待核实')
    expect(adc.label).toContain('0b11')
  })

  it('定时器直取 HCLK，显式配置仅写 AHB，缺省 HSI', () => {
    expect(clock.timerClock).toBe('hclk')
    expect(clock.codegen.rccLayout).toBe('ahb_only')
    expect(clock.defaultSource).toBeUndefined()
  })

  it('四档预设与四个 HAL 常量逐字对应', () => {
    expect(clock.presets.map((p) => p.id)).toEqual(['48MHZ_HSI', '24MHZ_HSI', '16MHZ_HSI', '12MHZ_HSI'])
    expect(clock.presets.map((p) => p.match.ahb)).toEqual([1, 2, 3, 4])
    for (const p of clock.presets) {
      expect(p.match).toMatchObject({ source: 'HSI', apb1: 1, apb2: 1 })
    }
    expect(clock.codegen.presetConstMap).toEqual({
      '48MHZ_HSI': 'hal::rcc::Config::SYSCLK_FREQ_48MHZ_HSI',
      '24MHZ_HSI': 'hal::rcc::Config::SYSCLK_FREQ_24MHZ_HSI',
      '16MHZ_HSI': 'hal::rcc::Config::SYSCLK_FREQ_16MHZ_HSI',
      '12MHZ_HSI': 'hal::rcc::Config::SYSCLK_FREQ_12MHZ_HSI',
    })
  })

  it('四档预设复现：HCLK=48/24/16/12MHz，且全部 0 error', () => {
    // 注意：X035 的 AHB 预分频器是唯一的时钟分频级。ch32-hal 的 Clocks 把 sysclk 恒定为 HSI 48MHz
    // （src/rcc/x0.rs clocks_from_registers），SYSCLK_FREQ_*MHZ_HSI 常量实际设置的是 HCLK
    // （hclk = HSI/ahb_pre，src/rcc/x0.rs:48-63,97-113）。因此标称频率对应 computeClock 的 hclkMhz；
    // sysclkMhz 保持 48（PLL/源直连模型不变），与 HAL 语义一致。
    for (const preset of clock.presets) {
      const nominal = parseInt(preset.id, 10)
      const cfg = presetConfig(preset)
      const f = computeClock(clock, cfg)
      expect(f.pllInMhz).toBeNull()
      expect(f.pllOutMhz).toBeNull()
      expect(f.sysclkMhz).toBe(48)
      expect(f.hclkMhz).toBe(nominal)
      expect(f.pclk1Mhz).toBe(nominal)
      expect(f.pclk2Mhz).toBe(nominal)
      // TIM1/2/3 直接使用 HCLK。
      expect(f.pclk1TimMhz).toBe(nominal)
      expect(f.pclk2TimMhz).toBe(nominal)
      // ADC = SYSCLK(HSI 48MHz)/8，与 AHB 分频无关
      expect(f.adcMhz).toBe(6)
      const errors = validateClock(clock, cfg).filter((i) => i.level === 'error')
      expect(errors).toEqual([])
      expect(matchPreset(clock, cfg)?.id).toBe(preset.id)
    }
  })

  it('defaultClock = HSI + AHB÷1 → 48MHz，命中 48MHZ_HSI 预设', () => {
    const d = defaultClock(clock)
    expect(d.source).toBe('HSI')
    expect(d.ahb).toBe(1)
    expect(d.apb1).toBe(1)
    expect(d.apb2).toBe(1)
    expect('pllSource' in d).toBe(false)
    expect('pll' in d).toBe(false)
    const f = computeClock(clock, d)
    expect(f.sysclkMhz).toBe(48)
    expect(f.hclkMhz).toBe(48)
    expect(f.adcMhz).toBe(6)
    expect(validateClock(clock, d).filter((i) => i.level === 'error')).toEqual([])
    expect(matchPreset(clock, d)?.id).toBe('48MHZ_HSI')
  })

  it('AHB÷6（HAL 复位默认 8MHz）无对应预设常量，使用显式分频', () => {
    const cfg = mergeClockConfig(clock, { source: 'HSI', ahb: 6, apb1: 1, apb2: 1 })
    expect(computeClock(clock, cfg).hclkMhz).toBe(8)
    expect(matchPreset(clock, cfg)).toBeNull()
  })
})

describe('CH32X035C8T6 EXTI（契约 D5：X0 三组 IRQ）', () => {
  it('46 条，每条对应一个 IO 引脚，channel=端口内引脚号', () => {
    expect(exti.entries).toHaveLength(46)
    for (const e of exti.entries) {
      expect(ioPins.some((p) => p.name === e.pin)).toBe(true)
      expect(e.channel).toBe(parseInt(e.pin.slice(2), 10))
    }
  })

  it('IRQ 按通道分组：0-7 → EXTI7_0、8-15 → EXTI15_8、16-25 → EXTI25_16', () => {
    for (const e of exti.entries) {
      const expected = e.channel <= 7 ? 'EXTI7_0' : e.channel <= 15 ? 'EXTI15_8' : 'EXTI25_16'
      expect(e.irq, e.pin).toBe(expected)
    }
    // 三组都必须真实出现在 interrupts.json（importer 产出）
    const irqNames = new Set(interrupts.irqs.map((i) => i.name))
    expect(irqNames.has('EXTI7_0')).toBe(true)
    expect(irqNames.has('EXTI15_8')).toBe(true)
    expect(irqNames.has('EXTI25_16')).toBe(true)
    for (const e of exti.entries) expect(irqNames.has(e.irq)).toBe(true)
    // 不再是 V1/V3 的 EXTI0..EXTI15_10 命名
    expect(irqNames.has('EXTI9_5')).toBe(false)
    expect(irqNames.has('EXTI15_10')).toBe(false)
  })

  it('PC16-19 走 EXTI25_16（通道 16-19），PC6/PC7 走 EXTI7_0', () => {
    expect(exti.entries.find((e) => e.pin === 'PC16')).toMatchObject({ channel: 16, irq: 'EXTI25_16' })
    expect(exti.entries.find((e) => e.pin === 'PC19')).toMatchObject({ channel: 19, irq: 'EXTI25_16' })
    expect(exti.entries.find((e) => e.pin === 'PC7')).toMatchObject({ channel: 7, irq: 'EXTI7_0' })
    expect(exti.entries.find((e) => e.pin === 'PC14')).toMatchObject({ channel: 14, irq: 'EXTI15_8' })
  })
})
