// M15 外设时钟域测试：computePeripheralClocks / validatePeripheralClocks / adcClkDiv 数据语义。
// 公式来源（逐字复刻）：ch32-hal spi.rs:833-853 / usart/mod.rs:1093-1100 / i2c.rs:258+；
// ch58x-hal spi.rs:169-177 / uart.rs:360-371 / i2c.rs:128-155 / adc.rs:8-15。
import { describe, it, expect } from 'vitest'
import type {
  ClockConfig,
  ClockData,
  PeripheralsData,
  PeripheralClocksData,
  PeripheralState,
} from '@/model/types'
import {
  computeClock,
  computePeripheralClocks,
  validatePeripheralClocks,
  defaultClock,
  mergeClockConfig,
  presetToConfig,
  applyClockPreset,
  matchPreset,
} from '@/model/clock'
import { getDeviceData } from '@/model/device'

// ---------- 真实芯片数据 ----------
const v003 = getDeviceData('CH32V003F4P6')
const v103 = getDeviceData('CH32V103C8T6')
const v203 = getDeviceData('CH32V203C8T6')
const v307 = getDeviceData('CH32V307VCT6')
const x035 = getDeviceData('CH32X035C8T6')
const h417 = getDeviceData('CH32H417QEU6')
const ch582 = getDeviceData('CH582M')

function run(
  data: { clock: ClockData; peripherals: PeripheralsData },
  partial: Partial<ClockConfig> = {},
  state: Record<string, PeripheralState> = {},
) {
  const cfg = mergeClockConfig(data.clock, partial)
  const freqs = computeClock(data.clock, cfg)
  return {
    cfg,
    freqs,
    nodes: computePeripheralClocks(data.clock, cfg, freqs, data.peripherals, state),
  }
}

function node(nodes: ReturnType<typeof computePeripheralClocks>, id: string) {
  const n = nodes.find((x) => x.periId === id)
  if (!n) throw new Error(`节点缺失：${id}`)
  return n
}

// ---------- 合成 spec（公式边界测试，避免真实总线频率限制） ----------
function makePeripherals(): PeripheralsData {
  return {
    chip: 'TEST',
    usart: [
      {
        id: 'USART1',
        remaps: [],
        params: { baudrate: { kind: 'number', default: 115200, min: 1, max: 9_000_000 } },
      },
    ],
    spi: [{ id: 'SPI1', remaps: [], params: { frequency: { kind: 'number', default: 1_000_000 } } }],
    i2c: [
      {
        id: 'I2C1',
        remaps: [],
        params: {
          speed: { kind: 'number', default: 100_000 },
          duty: { kind: 'select', default: 'Duty2_1', options: ['Duty2_1', 'Duty16_9'] },
        },
      },
    ],
    adc: [{ id: 'ADC1', channels: [], params: {} }],
  }
}

function makeSpec(pc: PeripheralClocksData, sourceMhz = 48): ClockData {
  return {
    chip: 'TEST',
    sysclkMaxMhz: 200,
    sources: [{ id: 'HSI', label: 'HSI', freqMhz: sourceMhz }],
    ahb: { options: [1], maxMhz: 200, default: 1 },
    apb1: { options: [1], maxMhz: 200, default: 1 },
    apb2: { options: [1], maxMhz: 200, default: 1 },
    adc: { options: [{ id: 'APB2', label: 'APB2', source: 'APB2', div: 1 }], default: 'APB2' },
    timerClock: 'sysclk',
    peripheralClocks: pc,
    presets: [],
    codegen: { presetConstMap: {}, fallback: 'explicit' },
  }
}

const ch32Pc = (extra: Partial<PeripheralClocksData> = {}): PeripheralClocksData => ({
  usart: { sourceDefault: 'HCLK', knob: 'baudrate' },
  spi: { sourceDefault: 'HCLK', knob: 'frequency', brg: { divs: [2, 4, 8, 16, 32, 64, 128, 256] } },
  i2c: { sourceDefault: 'HCLK', knob: 'speed', maxKhz: 400 },
  ...extra,
})

const ch58xPc = (extra: Partial<PeripheralClocksData> = {}): PeripheralClocksData => ({
  usart: { sourceDefault: 'HCLK', knob: 'baudrate' },
  spi: { sourceDefault: 'HCLK', knob: 'frequency', brg: { linear: { min: 2, max: 255 } } },
  i2c: { sourceDefault: 'HCLK', knob: 'speed', maxKhz: 400 },
  ...extra,
})

const synthCfg = (partial: Partial<ClockConfig> = {}): ClockConfig => ({
  source: 'HSI',
  ahb: 1,
  apb1: 1,
  apb2: 1,
  ...partial,
})

// ---------- 真实数据：实例遍历与源总线 ----------
describe('computePeripheralClocks 真实数据：遍历与源总线', () => {
  it('V203 遍历全部 USART/SPI/I2C/ADC 实例并追加 USB（含未启用）', () => {
    const { nodes } = run(v203)
    expect(nodes.map((n) => n.periId)).toEqual([
      'USART1',
      'USART2',
      'USART3',
      'USART4',
      'SPI1',
      'SPI2',
      'I2C1',
      'I2C2',
      'ADC1',
      'ADC2',
      'USB',
    ])
    expect(nodes.every((n) => n.nodeId === (n.category === 'usb' ? 'USB' : `P-${n.periId}`))).toBe(true)
  })

  it('V203 USART1 挂 APB2、USART2 挂 APB1（ch32-data bus_clock 复核）', () => {
    const { nodes } = run(v203)
    expect(node(nodes, 'USART1').sourceBus).toBe('APB2')
    expect(node(nodes, 'USART2').sourceBus).toBe('APB1')
    expect(node(nodes, 'USART1').inMhz).toBe(8)
  })

  it('V203 SPI1 挂 APB2、SPI2 挂 APB1', () => {
    const { nodes } = run(v203)
    expect(node(nodes, 'SPI1').sourceBus).toBe('APB2')
    expect(node(nodes, 'SPI2').sourceBus).toBe('APB1')
  })

  it('V203 I2C1/I2C2 均挂 APB1', () => {
    const { nodes } = run(v203)
    expect(node(nodes, 'I2C1').sourceBus).toBe('APB1')
    expect(node(nodes, 'I2C2').sourceBus).toBe('APB1')
  })

  it('V003 源总线：USART1/SPI1=HCLK、I2C1=APB1、ADC=APB2，无 USB 节点', () => {
    const { nodes } = run(v003)
    expect(node(nodes, 'USART1').sourceBus).toBe('HCLK')
    expect(node(nodes, 'SPI1').sourceBus).toBe('HCLK')
    expect(node(nodes, 'I2C1').sourceBus).toBe('APB1')
    expect(node(nodes, 'ADC1').sourceBus).toBe('APB2')
    expect(nodes.some((n) => n.category === 'usb')).toBe(false)
  })

  it('H417 无 USB 节点；I2C4 按 ch32-data 挂 APB2（其余 I2C 挂 APB1）', () => {
    const { nodes } = run(h417)
    expect(nodes.some((n) => n.category === 'usb')).toBe(false)
    expect(node(nodes, 'I2C4').sourceBus).toBe('APB2')
    expect(node(nodes, 'I2C1').sourceBus).toBe('APB1')
    expect(node(nodes, 'USART1').sourceBus).toBe('APB2')
    expect(node(nodes, 'SPI1').sourceBus).toBe('APB2')
    expect(node(nodes, 'SPI4').sourceBus).toBe('APB1')
  })

  it('未启用实例仍计算 requested（取参数缺省）', () => {
    const { nodes } = run(v203, {}, { USART2: { enabled: false, params: { baudrate: 9600 } } })
    expect(node(nodes, 'USART1').requested).toBe(115200)
    expect(node(nodes, 'USART2').requested).toBe(9600)
    expect(node(nodes, 'USART2').issues).toEqual([])
  })
})

// ---------- SPI ----------
describe('SPI 实际分频', () => {
  it('ch32 常规：48MHz 请求 8MHz → DIV_8，实际 6MHz', () => {
    const spec = makeSpec(ch32Pc())
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { SPI1: { enabled: true, params: { frequency: 8_000_000 } } },
    )
    const n = node(nodes, 'SPI1')
    expect(n.actualMhz).toBe(6)
    expect(n.dividerLabel).toBe('÷8 (BRG)')
    expect(n.issues).toEqual([])
  })

  it('ch32 请求恰为 bus/2（24MHz）→ DIV_2，无 warning', () => {
    const spec = makeSpec(ch32Pc())
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { SPI1: { enabled: true, params: { frequency: 24_000_000 } } },
    )
    expect(node(nodes, 'SPI1').actualMhz).toBe(24)
    expect(node(nodes, 'SPI1').issues).toEqual([])
  })

  it('ch32 请求超 bus/2（30MHz）→ 回退 DIV_2 + warning', () => {
    const spec = makeSpec(ch32Pc())
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { SPI1: { enabled: true, params: { frequency: 30_000_000 } } },
    )
    const n = node(nodes, 'SPI1')
    expect(n.dividerLabel).toBe('÷2 (BRG)')
    expect(n.actualMhz).toBe(24)
    expect(n.issues).toHaveLength(1)
    expect(n.issues[0].level).toBe('warning')
    expect(n.issues[0].message).toContain('DIV_2')
  })

  it('ch32 请求低于 bus/256（100kHz）→ 回退 DIV_256 + warning', () => {
    const spec = makeSpec(ch32Pc())
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { SPI1: { enabled: true, params: { frequency: 100_000 } } },
    )
    const n = node(nodes, 'SPI1')
    expect(n.dividerLabel).toBe('÷256 (BRG)')
    expect(n.actualMhz).toBeCloseTo(0.1875, 9)
    expect(n.issues[0].message).toContain('DIV_256')
  })

  it('ch58x 线性：60MHz 请求 1MHz → 整除 fdiv=60，实际 1MHz', () => {
    const { nodes } = run(ch582)
    const n = node(nodes, 'SPI0')
    expect(n.dividerLabel).toBe('÷60 (线性 BRG)')
    expect(n.actualMhz).toBe(1)
    expect(n.issues).toEqual([])
  })

  it('ch58x 线性 clamp 下限：60MHz 请求 100MHz → ÷2，实际 30MHz + warning', () => {
    const { nodes } = run(ch582, {}, { SPI0: { enabled: true, params: { frequency: 100_000_000 } } })
    const n = node(nodes, 'SPI0')
    expect(n.dividerLabel).toBe('÷2 (线性 BRG)')
    expect(n.actualMhz).toBe(30)
    expect(n.issues[0].message).toContain('÷2')
  })

  it('ch58x 线性 clamp 上限：60MHz 请求 100kHz → ÷255，实际 235294Hz + warning', () => {
    const { nodes } = run(ch582, {}, { SPI0: { enabled: true, params: { frequency: 100_000 } } })
    const n = node(nodes, 'SPI0')
    expect(n.dividerLabel).toBe('÷255 (线性 BRG)')
    expect(n.actualMhz).toBeCloseTo(60 / 255, 9)
    expect(n.issues[0].message).toContain('÷255')
  })

  it('未启用实例不产生 warning（节点仍计算 actual）', () => {
    const spec = makeSpec(ch32Pc())
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { SPI1: { enabled: false, params: { frequency: 30_000_000 } } },
    )
    expect(node(nodes, 'SPI1').actualMhz).toBe(24)
    expect(node(nodes, 'SPI1').issues).toEqual([])
  })
})

// ---------- USART ----------
describe('USART 实际波特率与误差', () => {
  it('ch58x 60MHz/115200：HAL 特例 DIV13 DL5，误差 0.16% < 3% 无 warning', () => {
    const { nodes } = run(ch582, {}, { UART0: { enabled: true, params: { baudrate: 115200 } } })
    const n = node(nodes, 'UART0')
    expect(n.dividerLabel).toBe('DIV 13 DL 5')
    expect(n.actualMhz).toBeCloseTo(0.115384615, 9)
    expect(n.errorPct).toBeCloseTo(0.160256, 4)
    expect(n.issues).toEqual([])
  })

  it('ch58x 20MHz/3Mbaud：DL=1，实际 2.5MHz，误差 -16.7% → warning', () => {
    const spec = makeSpec(ch58xPc(), 20)
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { USART1: { enabled: true, params: { baudrate: 3_000_000 } } },
    )
    const n = node(nodes, 'USART1')
    expect(n.dividerLabel).toBe('DIV 1 DL 1')
    expect(n.actualMhz).toBe(2.5)
    expect(n.errorPct).toBeCloseTo(-16.6667, 3)
    expect(n.issues[0].level).toBe('warning')
  })

  it('ch32 误差边界：1MHz/60643 → BRR16 实际 62500，误差 3.06% > 3% → warning', () => {
    const spec = makeSpec(ch32Pc(), 1)
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { USART1: { enabled: true, params: { baudrate: 60643 } } },
    )
    const n = node(nodes, 'USART1')
    expect(n.dividerLabel).toBe('÷16 (BRR)')
    expect(n.actualMhz).toBe(0.0625)
    expect(n.errorPct).toBeCloseTo(3.062, 2)
    expect(n.issues[0].message).toContain('阈值 3%')
  })

  it('自定义阈值 5%：同一配置不再 warning', () => {
    const spec = makeSpec(ch32Pc({ usart: { sourceDefault: 'HCLK', knob: 'baudrate', baudErrorWarnPct: 5 } }), 1)
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { USART1: { enabled: true, params: { baudrate: 60643 } } },
    )
    expect(node(nodes, 'USART1').issues).toEqual([])
  })

  it('ch32 超高速：8MHz/1Mbaud → BRR=8 < 0x10，HAL 拒绝 → actual=null + error', () => {
    const spec = makeSpec(ch32Pc(), 8)
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { USART1: { enabled: true, params: { baudrate: 1_000_000 } } },
    )
    const n = node(nodes, 'USART1')
    expect(n.actualMhz).toBeNull()
    expect(n.issues[0].level).toBe('error')
    expect(n.issues[0].message).toContain('0x10')
  })

  it('真实 V203 默认 8MHz/115200 无 warning（errorPct 0.64%）', () => {
    const { nodes } = run(v203)
    const n = node(nodes, 'USART1')
    expect(n.errorPct).toBeCloseTo(0.642, 2)
    expect(n.issues).toEqual([])
  })
})

// ---------- I2C ----------
describe('I2C 实际 SCL（timing 公式）', () => {
  const i2cRun = (partial: Partial<ClockConfig>, state: Record<string, PeripheralState>) => {
    const spec = makeSpec(ch32Pc())
    return run({ clock: spec, peripherals: makePeripherals() }, partial, state)
  }

  it('48MHz/100kHz standard：CCR=240，实际 100kHz', () => {
    const { nodes } = i2cRun({}, { I2C1: { enabled: true, params: { speed: 100_000 } } })
    expect(node(nodes, 'I2C1').dividerLabel).toBe('÷240 (CCR)')
    expect(node(nodes, 'I2C1').actualMhz).toBe(0.1)
  })

  it('48MHz/400kHz Duty2_1：CCR=40，实际 400kHz，无 error', () => {
    const { nodes } = i2cRun({}, { I2C1: { enabled: true, params: { speed: 400_000 } } })
    expect(node(nodes, 'I2C1').dividerLabel).toBe('÷40 (CCR)')
    expect(node(nodes, 'I2C1').actualMhz).toBeCloseTo(0.4, 9)
    expect(node(nodes, 'I2C1').issues).toEqual([])
  })

  it('48MHz/400kHz Duty16_9：÷25 系数 → CCR=5，实际 384kHz', () => {
    const { nodes } = i2cRun(
      {},
      { I2C1: { enabled: true, params: { speed: 400_000, duty: 'Duty16_9' } } },
    )
    expect(node(nodes, 'I2C1').dividerLabel).toBe('÷5 (CCR)')
    expect(node(nodes, 'I2C1').actualMhz).toBeCloseTo(0.384, 9)
  })

  it('500kHz 超 400kHz 上限 → error（HAL timing() assert），actual=null', () => {
    const { nodes } = i2cRun({}, { I2C1: { enabled: true, params: { speed: 500_000 } } })
    const n = node(nodes, 'I2C1')
    expect(n.actualMhz).toBeNull()
    expect(n.issues[0].level).toBe('error')
    expect(n.issues[0].message).toContain('400kHz')
  })

  it('低速最小 CCR clamp：0.5MHz/100kHz → CCR 最大 4，实际 62.5kHz', () => {
    const spec = makeSpec(ch32Pc(), 0.5)
    const { nodes } = run(
      { clock: spec, peripherals: makePeripherals() },
      {},
      { I2C1: { enabled: true, params: { speed: 100_000 } } },
    )
    expect(node(nodes, 'I2C1').dividerLabel).toBe('÷4 (CCR)')
    expect(node(nodes, 'I2C1').actualMhz).toBeCloseTo(0.0625, 9)
  })
})

// ---------- ADC ----------
describe('ADC 节点：raw 不编造 MHz / 枚举映射 / CK32M', () => {
  it('V203 raw 缺省 3：actual=null、label raw 3 (0b0011)、输入=APB2/ADCPRE', () => {
    const { nodes } = run(v203, { source: 'PLL', pllSource: 'HSI', pll: { mul: 18 }, ahb: 1, apb1: 1, apb2: 1 })
    const n = node(nodes, 'ADC1')
    expect(n.inMhz).toBe(72) // 144MHz / ADCPRE ÷2
    expect(n.requested).toBe(3)
    expect(n.actualMhz).toBeNull()
    expect(n.dividerLabel).toBe('raw 3 (0b0011)')
    expect(n.issues).toEqual([])
  })

  it('V203 adcClkDiv=5 → requested 5、label raw 5 (0b0101)、仍不编造 MHz', () => {
    const { nodes } = run(v203, { adcClkDiv: 5 })
    const n = node(nodes, 'ADC1')
    expect(n.requested).toBe(5)
    expect(n.dividerLabel).toBe('raw 5 (0b0101)')
    expect(n.actualMhz).toBeNull()
  })

  it('X035 raw：输入=SYSCLK/8（现有 CLK_DIV 缺省模型 6MHz），actual=null', () => {
    const { nodes } = run(x035)
    const n = node(nodes, 'ADC1')
    expect(n.inMhz).toBe(6)
    expect(n.requested).toBe(3)
    expect(n.dividerLabel).toBe('raw 3 (0b0011)')
    expect(n.actualMhz).toBeNull()
  })

  it('V003 无 raw 旋钮：actual=输入 ADC 域频率（24MHz），不造 raw 标签', () => {
    const { nodes } = run(v003)
    const n = node(nodes, 'ADC1')
    expect(n.inMhz).toBe(24)
    expect(n.actualMhz).toBe(24)
    expect(n.requested).toBeNull()
    expect(n.dividerLabel).toBeNull()
  })

  it('CH582 SamplingClock 缺省 _3_2MHz：输入 CK32M=32MHz，actual=3.2MHz', () => {
    const { nodes } = run(ch582)
    const n = node(nodes, 'ADC')
    expect(n.sourceBus).toBe('CK32M')
    expect(n.inMhz).toBe(32)
    expect(n.requested).toBe('_3_2MHz')
    expect(n.actualMhz).toBe(3.2)
  })

  it('CH582 samplingClock=_8MHz → actual=8MHz（枚举镜像，不按总线派生）', () => {
    const { nodes } = run(ch582, {}, { ADC: { enabled: true, params: { samplingClock: '_8MHz' } } })
    expect(node(nodes, 'ADC').actualMhz).toBe(8)
  })

  it('computeClock 支持 CK32M 源：CH582 adcMhz=32MHz', () => {
    const cfg = defaultClock(ch582.clock)
    expect(computeClock(ch582.clock, cfg).adcMhz).toBe(32)
  })
})

// ---------- USB ----------
describe('USB 48M 域（HAL 自动 USBPRE）', () => {
  const v203At = (mul: number) =>
    run(v203, { source: 'PLL', pllSource: 'HSI', pll: { mul }, ahb: 1, apb1: 1, apb2: 1 })

  it('V203 PLL 144MHz → USBPRE ÷3，实际 48MHz', () => {
    const n = node(v203At(18).nodes, 'USB')
    expect(n.inMhz).toBe(144)
    expect(n.dividerLabel).toBe('USBPRE ÷3 (HAL auto)')
    expect(n.actualMhz).toBe(48)
    expect(n.issues).toEqual([])
  })

  it('V203 PLL 96MHz → ÷2 实际 48MHz', () => {
    expect(node(v203At(12).nodes, 'USB').actualMhz).toBe(48)
  })

  it('V203 PLL 56MHz（不在合法集）→ warning + actual=null', () => {
    const n = node(v203At(7).nodes, 'USB')
    expect(n.actualMhz).toBeNull()
    expect(n.issues).toHaveLength(1)
    expect(n.issues[0].node).toBe('USB')
    expect(n.issues[0].level).toBe('warning')
    expect(n.issues[0].message).toContain('PLL 56MHz')
  })

  it('V203 非 PLL 源：inMhz=0、actual=null、无 warning（无 PLL 时钟域）', () => {
    const n = node(run(v203).nodes, 'USB')
    expect(n.inMhz).toBe(0)
    expect(n.actualMhz).toBeNull()
    expect(n.issues).toEqual([])
  })

  it('V103 PLL 72MHz → USBPRE ÷1.5，实际 48MHz', () => {
    const { nodes } = run(v103, { source: 'PLL', pllSource: 'HSI', pll: { prediv: 1, mul: 9 } })
    const n = node(nodes, 'USB')
    expect(n.dividerLabel).toBe('USBPRE ÷1.5 (HAL auto)')
    expect(n.actualMhz).toBe(48)
  })

  it('V103 PLL 80MHz（80MHz 预设）→ warning', () => {
    const { nodes } = run(v103, { source: 'PLL', pllSource: 'HSI', pll: { prediv: 1, mul: 10 } })
    expect(node(nodes, 'USB').issues[0].level).toBe('warning')
    expect(node(nodes, 'USB').actualMhz).toBeNull()
  })

  it('V307 PLL 96MHz → ÷2 实际 48MHz', () => {
    const { nodes } = run(v307, { source: 'PLL', pllSource: 'HSI', pll: { prediv: 1, mul: 12 } })
    expect(node(nodes, 'USB').actualMhz).toBe(48)
  })

  it('X035 fixedMhz=48 优先：HSI 直连，无 USBPRE', () => {
    const n = node(run(x035).nodes, 'USB')
    expect(n.sourceBus).toBe('HSI')
    expect(n.inMhz).toBe(48)
    expect(n.actualMhz).toBe(48)
    expect(n.dividerLabel).toContain('HSI 直连')
  })

  it('validPllMhz 含该频率但 autoPre 缺档 → warning + actual=null', () => {
    const clock: ClockData = {
      ...v203.clock,
      peripheralClocks: {
        ...v203.clock.peripheralClocks,
        usb: { autoPre: { 48: 1 }, validPllMhz: [48, 96], note: '' },
      },
    }
    const { nodes } = run(
      { clock, peripherals: v203.peripherals },
      { source: 'PLL', pllSource: 'HSI', pll: { mul: 12 }, ahb: 1, apb1: 1, apb2: 1 },
    )
    const n = node(nodes, 'USB')
    expect(n.actualMhz).toBeNull()
    expect(n.issues[0].level).toBe('warning')
  })
})

// ---------- validatePeripheralClocks ----------
describe('validatePeripheralClocks 汇总规则', () => {
  it('同时汇总 SPI/USART/I2C 节点问题（node=nodeId）', () => {
    const spec = makeSpec(
      ch32Pc({ usart: { sourceDefault: 'HCLK', knob: 'baudrate', baudErrorWarnPct: 1 } }),
      48,
    )
    const peri = makePeripherals()
    const cfg = synthCfg()
    const freqs = computeClock(spec, cfg)
    const issues = validatePeripheralClocks(spec, cfg, freqs, peri, {
      SPI1: { enabled: true, params: { frequency: 30_000_000 } },
      USART1: { enabled: true, params: { baudrate: 2_900_000 } },
      I2C1: { enabled: true, params: { speed: 500_000 } },
    })
    const nodes = issues.map((i) => i.node).sort()
    expect(nodes).toEqual(['P-I2C1', 'P-SPI1', 'P-USART1'])
    expect(issues.find((i) => i.node === 'P-I2C1')?.level).toBe('error')
    expect(issues.find((i) => i.node === 'P-SPI1')?.level).toBe('warning')
    expect(issues.find((i) => i.node === 'P-USART1')?.level).toBe('warning')
  })

  it('无外设时钟块时安全返回空数组', () => {
    const spec = { ...makeSpec(ch32Pc()), peripheralClocks: undefined }
    const cfg = synthCfg()
    expect(computePeripheralClocks(spec, cfg, computeClock(spec, cfg), makePeripherals())).toEqual([])
    expect(validatePeripheralClocks(spec, cfg, computeClock(spec, cfg), makePeripherals())).toEqual([])
  })
})

// ---------- adcClkDiv：merge / preset / match ----------
describe('adcClkDiv 数据语义（V203/X035 可编程，V003 丢弃）', () => {
  it('mergeClockConfig 缺省补 3（V203）', () => {
    expect(mergeClockConfig(v203.clock, {}).adcClkDiv).toBe(3)
    expect(defaultClock(v203.clock).adcClkDiv).toBe(3)
  })

  it('mergeClockConfig 保留合法 5，越界/非整数/非数回落缺省 3', () => {
    expect(mergeClockConfig(v203.clock, { adcClkDiv: 5 }).adcClkDiv).toBe(5)
    expect(mergeClockConfig(v203.clock, { adcClkDiv: 99 }).adcClkDiv).toBe(3)
    expect(mergeClockConfig(v203.clock, { adcClkDiv: -1 }).adcClkDiv).toBe(3)
    expect(mergeClockConfig(v203.clock, { adcClkDiv: 2.5 }).adcClkDiv).toBe(3)
    expect(mergeClockConfig(v203.clock, { adcClkDiv: '5' as unknown as number }).adcClkDiv).toBe(3)
  })

  it('X035 bits=4：15 合法、16 回落 3', () => {
    expect(mergeClockConfig(x035.clock, { adcClkDiv: 15 }).adcClkDiv).toBe(15)
    expect(mergeClockConfig(x035.clock, { adcClkDiv: 16 }).adcClkDiv).toBe(3)
  })

  it('不可编程芯片（V003）丢弃导入的 adcClkDiv', () => {
    expect('adcClkDiv' in mergeClockConfig(v003.clock, { adcClkDiv: 5 })).toBe(false)
  })

  it('matchPreset 不比较 adcClkDiv（144MHz 预设仍命中）', () => {
    const cfg = mergeClockConfig(v203.clock, {
      source: 'PLL',
      pllSource: 'HSI',
      pll: { mul: 18 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
      adcClkDiv: 7,
    })
    expect(matchPreset(v203.clock, cfg)?.id).toBe('144MHZ_HSI')
  })

  it('presetToConfig / applyClockPreset 重置 adcClkDiv 缺省；ADC 锁定则保留', () => {
    const preset = v203.clock.presets.find((p) => p.id === '144MHZ_HSI')!
    const cfg = mergeClockConfig(v203.clock, {
      source: 'PLL',
      pllSource: 'HSI',
      pll: { mul: 18 },
      ahb: 1,
      apb1: 1,
      apb2: 1,
      adcClkDiv: 5,
    })
    expect(presetToConfig(v203.clock, preset, cfg).adcClkDiv).toBe(3)
    expect(applyClockPreset(v203.clock, cfg, preset).adcClkDiv).toBe(3)
    const locked = applyClockPreset(v203.clock, { ...cfg, locked: ['ADC'] }, preset)
    expect(locked.adcClkDiv).toBe(5)
  })
})

// ---------- 数据 D8：V003 SPI 位序 ----------
describe('V003 SPI bitOrder 数据修复（D8）', () => {
  it('spi_v0 仅 MSB：options 不含 LsbFirst，缺省 MsbFirst', () => {
    const bitOrder = v003.peripherals.spi[0].params.bitOrder
    expect(bitOrder.options).toEqual(['MsbFirst'])
    expect(bitOrder.default).toBe('MsbFirst')
  })
})
