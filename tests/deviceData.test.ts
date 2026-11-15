// 器件注册表与 Lookup 单元测试（真实 CH32V003F4P6 数据）。
import { describe, it, expect } from 'vitest'
import {
  listDevices,
  getDeviceData,
  hasDevice,
  pinByName,
  remapsOfPin,
  pinsOfSignal,
  pinSupportsSignal,
  remapValuesFor,
  extiOfPin,
  irqByName,
  peripheralOfSignal,
  categoryOfPeripheral,
} from '../src/data/device'

const data = getDeviceData('CH32V003F4P6')

describe('注册表', () => {
  it('listDevices 返回已注册芯片（V003 + V203）', () => {
    const list = listDevices()
    const names = list.map((d) => d.chip)
    expect(names).toContain('CH32V003F4P6')
    expect(names).toContain('CH32V203C8T6')
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it('getDeviceData 返回完整六段数据（chip/remap/exti/clock/peripherals/interrupts/dma）', () => {
    expect(data.chip.chip).toBe('CH32V003F4P6')
    expect(data.remap.chip).toBe('CH32V003F4P6')
    expect(data.exti.entries.length).toBeGreaterThan(0)
    expect(data.clock.sysclkMaxMhz).toBe(48)
    expect(data.peripherals.usart).toHaveLength(1)
    expect(data.peripherals.adc).toHaveLength(1)
    expect(data.interrupts.irqs.length).toBeGreaterThan(0)
    expect(data.dma?.requests.length).toBeGreaterThan(0)
  })

  it('getDeviceData 未注册芯片抛异常', () => {
    expect(() => getDeviceData('CH32V999X9X9')).toThrowError(/未注册的芯片/)
  })

  it('hasDevice 命中与未命中', () => {
    expect(hasDevice('CH32V003F4P6')).toBe(true)
    expect(hasDevice('CH32V999X9X9')).toBe(false)
  })
})

describe('芯片引脚表', () => {
  it('TSSOP20：20 脚、每边 10、dual 封装', () => {
    expect(data.chip.pins).toHaveLength(20)
    expect(data.chip.pinsPerSide).toBe(10)
    expect(data.chip.packageKind).toBe('dual')
    expect(data.chip.package).toBe('TSSOP20')
  })

  it('引脚编号 1..20 连续且唯一', () => {
    const nums = data.chip.pins.map((p) => p.number).sort((a, b) => a - b)
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('pinByName：PD4 → 1 号脚、左侧', () => {
    const p = pinByName(data, 'PD4')!
    expect(p.number).toBe(1)
    expect(p.side).toBe('left')
    expect(p.type).toBe('IO')
  })

  it('pinByName 未知名返回 undefined', () => {
    expect(pinByName(data, 'PX9')).toBeUndefined()
  })

  it('电源脚 VSS/VDD 为 POWER 类型', () => {
    expect(pinByName(data, 'VSS')?.type).toBe('POWER')
    expect(pinByName(data, 'VDD')?.type).toBe('POWER')
  })
})

describe('ADC 通道映射', () => {
  it('PD4 = ADC_IN7', () => {
    expect(pinByName(data, 'PD4')?.adc).toEqual(['ADC_IN7'])
  })
  it('PA2 = ADC_IN0', () => {
    expect(pinByName(data, 'PA2')?.adc).toEqual(['ADC_IN0'])
  })
  it('PA1 = ADC_IN1、PC4 = ADC_IN2、PD5 = ADC_IN5、PD6 = ADC_IN6', () => {
    expect(pinByName(data, 'PA1')?.adc).toEqual(['ADC_IN1'])
    expect(pinByName(data, 'PC4')?.adc).toEqual(['ADC_IN2'])
    expect(pinByName(data, 'PD5')?.adc).toEqual(['ADC_IN5'])
    expect(pinByName(data, 'PD6')?.adc).toEqual(['ADC_IN6'])
  })
  it('ADC 8 个外部通道与引脚一一对应', () => {
    const ch = data.peripherals.adc[0].channels
    expect(ch).toHaveLength(8)
    for (const c of ch) {
      expect(pinByName(data, c.pin)?.adc).toContain(c.channel)
    }
  })
  it('数字 IO（PC3）无 ADC 通道', () => {
    expect(pinByName(data, 'PC3')?.adc).toEqual([])
  })
})

describe('remap lookup', () => {
  it('remapsOfPin(PD5)：TX=remap0、RX=remap2、TIM2_CH4=remap3', () => {
    const entries = remapsOfPin(data, 'PD5')
    const bySignal = new Map(entries.map((e) => [e.signal, e.remap]))
    expect(bySignal.get('USART1_TX')).toBe(0)
    expect(bySignal.get('USART1_RX')).toBe(2)
    expect(bySignal.get('TIM2_CH4')).toBe(3)
  })

  it('remapsOfPin 未配置引脚返回空', () => {
    expect(remapsOfPin(data, 'VSS')).toEqual([]) // 电源脚无 AF 能力
    expect(remapsOfPin(data, 'PX9')).toEqual([])
  })

  it('pinsOfSignal(USART1_TX) = PD5/0、PD0/1、PD6/2、PC0/3', () => {
    const entries = pinsOfSignal(data, 'USART1_TX')
    expect(entries).toHaveLength(4)
    const m = new Map(entries.map((e) => [e.pin, e.remap]))
    expect(m.get('PD5')).toBe(0)
    expect(m.get('PD0')).toBe(1)
    expect(m.get('PD6')).toBe(2)
    expect(m.get('PC0')).toBe(3)
  })

  it('pinsOfSignal(USART1_RX) 四档与 datasheet 一致', () => {
    const m = new Map(pinsOfSignal(data, 'USART1_RX').map((e) => [e.pin, e.remap]))
    expect(m.get('PD6')).toBe(0)
    expect(m.get('PD1')).toBe(1)
    expect(m.get('PD5')).toBe(2)
    expect(m.get('PC1')).toBe(3)
  })

  it('pinsOfSignal 未知信号返回空', () => {
    expect(pinsOfSignal(data, 'USART9_TX')).toEqual([])
  })

  it('pinSupportsSignal：正反例', () => {
    expect(pinSupportsSignal(data, 'PD5', 'USART1_TX')).toBe(true)
    expect(pinSupportsSignal(data, 'PD5', 'USART1_RX')).toBe(true) // 反向引脚复用
    expect(pinSupportsSignal(data, 'PC3', 'USART1_TX')).toBe(false)
    expect(pinSupportsSignal(data, 'PC7', 'SPI1_MISO')).toBe(true)
    expect(pinSupportsSignal(data, 'PC0', 'SPI1_MISO')).toBe(false)
  })

  it('remapValuesFor：PD5/USART1_TX → [0]；PC7/SPI1_MISO → [0,1]；PD1/I2C1_SCL → [1]', () => {
    expect(remapValuesFor(data, 'PD5', 'USART1_TX')).toEqual([0])
    expect(remapValuesFor(data, 'PC7', 'SPI1_MISO')).toEqual([0, 1])
    expect(remapValuesFor(data, 'PD1', 'I2C1_SCL')).toEqual([1])
  })

  it('remap 表完整性：每条记录的引脚都存在于芯片引脚表', () => {
    const names = new Set(data.chip.pins.map((p) => p.name))
    for (const e of data.remap.entries) {
      expect(names.has(e.pin)).toBe(true)
      expect(e.remap).toBeGreaterThanOrEqual(0)
      expect(peripheralOfSignal(e.signal)).not.toBeNull()
    }
  })
})

describe('EXTI lookup', () => {
  it('PC1 → 通道 1、单一 IRQ EXTI7_0', () => {
    const e = extiOfPin(data, 'PC1')!
    expect(e.channel).toBe(1)
    expect(e.irq).toBe('EXTI7_0')
  })

  it('PD4 → 通道 4', () => {
    expect(extiOfPin(data, 'PD4')?.channel).toBe(4)
  })

  it('18 个 IO 引脚全部有 EXTI 记录（通道 0..7）', () => {
    expect(data.exti.entries).toHaveLength(18)
    const channels = new Set(data.exti.entries.map((e) => e.channel))
    expect([...channels].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    for (const e of data.exti.entries) expect(e.irq).toBe('EXTI7_0')
  })

  it('extiOfPin 电源脚返回 undefined', () => {
    expect(extiOfPin(data, 'VSS')).toBeUndefined()
  })

  it('irqByName(EXTI7_0) 命中断向量表', () => {
    const irq = irqByName(data, 'EXTI7_0')!
    expect(irq.name).toBe('EXTI7_0')
    expect(typeof irq.number).toBe('number')
  })

  it('irqByName 未知名返回 undefined', () => {
    expect(irqByName(data, 'NOPE')).toBeUndefined()
  })
})

describe('peripheralOfSignal / categoryOfPeripheral', () => {
  it('USART1_TX → USART1；SPI1_MISO → SPI1；I2C1_SCL → I2C1', () => {
    expect(peripheralOfSignal('USART1_TX')).toBe('USART1')
    expect(peripheralOfSignal('SPI1_MISO')).toBe('SPI1')
    expect(peripheralOfSignal('I2C1_SCL')).toBe('I2C1')
  })

  it('ADC_ 前缀统一归到 ADC1', () => {
    expect(peripheralOfSignal('ADC_IN0')).toBe('ADC1')
    expect(peripheralOfSignal('ADC_IN7')).toBe('ADC1')
  })

  it('TIM1_CH1 → TIM1；RCC_MCO → RCC', () => {
    expect(peripheralOfSignal('TIM1_CH1')).toBe('TIM1')
    expect(peripheralOfSignal('RCC_MCO')).toBe('RCC')
  })

  it('无下划线或前导下划线返回 null', () => {
    expect(peripheralOfSignal('MCO')).toBeNull()
    expect(peripheralOfSignal('_X')).toBeNull()
    expect(peripheralOfSignal('')).toBeNull()
  })

  it('categoryOfPeripheral：USART/UART→usart、SPI→spi、I2C→i2c、ADC→adc、TIM→timer、其余 other', () => {
    expect(categoryOfPeripheral('USART1')).toBe('usart')
    expect(categoryOfPeripheral('UART5')).toBe('usart')
    expect(categoryOfPeripheral('SPI2')).toBe('spi')
    expect(categoryOfPeripheral('I2C1')).toBe('i2c')
    expect(categoryOfPeripheral('ADC1')).toBe('adc')
    expect(categoryOfPeripheral('TIM2')).toBe('timer')
    expect(categoryOfPeripheral('RCC')).toBe('other')
    expect(categoryOfPeripheral('DMA1')).toBe('other')
  })

  it('数据层外设实例与类别推导一致', () => {
    for (const u of data.peripherals.usart) expect(categoryOfPeripheral(u.id)).toBe('usart')
    for (const s of data.peripherals.spi) expect(categoryOfPeripheral(s.id)).toBe('spi')
    for (const i of data.peripherals.i2c) expect(categoryOfPeripheral(i.id)).toBe('i2c')
    for (const a of data.peripherals.adc) expect(categoryOfPeripheral(a.id)).toBe('adc')
  })
})

describe('USART1 四档 remap 数据', () => {
  it('四档 remap 的 TX/RX 引脚组合', () => {
    const m = new Map(data.peripherals.usart[0].remaps.map((r) => [r.remap, `${r.tx}/${r.rx}`]))
    expect(m.get(0)).toBe('PD5/PD6')
    expect(m.get(1)).toBe('PD0/PD1')
    expect(m.get(2)).toBe('PD6/PD5')
    expect(m.get(3)).toBe('PC0/PC1')
  })

  it('每档 remap 的引脚都能承载对应信号（与 remap 表交叉校验）', () => {
    for (const r of data.peripherals.usart[0].remaps) {
      expect(remapValuesFor(data, r.tx, 'USART1_TX')).toContain(r.remap)
      expect(remapValuesFor(data, r.rx, 'USART1_RX')).toContain(r.remap)
    }
  })
})

describe('DMA 数据', () => {
  it('USART1_TX=通道4、USART1_RX=通道5、ADC1=通道1', () => {
    const m = new Map(data.dma!.requests.map((r) => [r.request, r.channel]))
    expect(m.get('USART1_TX')).toBe(4)
    expect(m.get('USART1_RX')).toBe(5)
    expect(m.get('ADC1')).toBe(1)
  })
})

describe('CH32H417QEU6（QFN128 双核 / 每引脚 AF）', () => {
  const h417 = getDeviceData('CH32H417QEU6')

  it('已注册，QFN128：128 脚、每边 32、quad', () => {
    expect(hasDevice('CH32H417QEU6')).toBe(true)
    expect(listDevices().map((d) => d.chip)).toContain('CH32H417QEU6')
    expect(h417.chip.pins).toHaveLength(128)
    expect(h417.chip.pinsPerSide).toBe(32)
    expect(h417.chip.packageKind).toBe('quad')
    expect(h417.chip.package).toBe('QFN128')
    expect(h417.chip.deviceId).toBe('0x4170050D')
    expect(h417.chip.remapModel).toBe('per_pin_af')
  })

  it('引脚编号 1..128 连续，底/右/顶/左各 32（逆时针）', () => {
    expect(h417.chip.pins.map((p) => p.number)).toEqual(Array.from({ length: 128 }, (_, i) => i + 1))
    const count = (side: string) => h417.chip.pins.filter((p) => p.side === side).length
    expect([count('bottom'), count('right'), count('top'), count('left')]).toEqual([32, 32, 32, 32])
    // 数据手册 2.1.1：1 号脚在底边最左（PE2），33 号在右边最下（VDD33A）
    expect(pinByName(h417, 'PE2')?.number).toBe(1)
    expect(pinByName(h417, 'VDD33A')?.number).toBe(33)
    expect(pinByName(h417, 'PB12')?.number).toBe(65)
    expect(pinByName(h417, 'VDD33_2')?.number).toBe(128)
  })

  it('双核描述：V3F 主核 + V5F 从核，halFeature/target 与主核一致', () => {
    const cores = h417.chip.cores!
    expect(cores).toHaveLength(2)
    const main = cores.find((c) => c.mainCore)!
    expect(main.id).toBe('v3f')
    expect(main.halFeature).toBe('ch32h417qeu6-v3f')
    expect(main.target).toBe('riscv32imafc-unknown-none-elf')
    expect(cores.find((c) => c.id === 'v5f')?.halFeature).toBe('ch32h417qeu6-v5f')
    expect(cores.find((c) => c.id === 'v5f')?.target).toBe('riscv32imafbc-unknown-none-elf')
    expect(h417.chip.halFeature).toBe(main.halFeature)
    expect(h417.chip.target).toBe(main.target)
    expect(h417.chip.unsupportedFeatures).toContain('embassy')
  })

  it('每引脚 AF：USART1_TX @PA9 = AF7；remap 值域 0..15', () => {
    const e = remapsOfPin(h417, 'PA9').find((x) => x.signal === 'USART1_TX')!
    expect(e.remap).toBe(7)
    expect(remapValuesFor(h417, 'PF7', 'USART8_TX')).toContain(7)
    expect(new Set(h417.remap.entries.map((x) => x.remap))).toBeInstanceOf(Set)
    for (const x of h417.remap.entries) {
      expect(x.remap).toBeGreaterThanOrEqual(0)
      expect(x.remap).toBeLessThanOrEqual(15)
    }
  })

  it('USART1..8 / SPI1..4 / I2C1..4 全部建模', () => {
    expect(h417.peripherals.usart.map((u) => u.id)).toEqual(['USART1', 'USART2', 'USART3', 'USART4', 'USART5', 'USART6', 'USART7', 'USART8'])
    expect(h417.peripherals.spi.map((s) => s.id)).toEqual(['SPI1', 'SPI2', 'SPI3', 'SPI4'])
    expect(h417.peripherals.i2c.map((i) => i.id)).toEqual(['I2C1', 'I2C2', 'I2C3', 'I2C4'])
    // 每档 AF 的引脚都能承载对应信号
    for (const u of h417.peripherals.usart) {
      for (const r of u.remaps) {
        expect(remapValuesFor(h417, r.tx, `${u.id}_TX`)).toContain(r.remap)
        expect(remapValuesFor(h417, r.rx, `${u.id}_RX`)).toContain(r.remap)
      }
    }
  })

  it('ADC1/ADC2 各 16 通道，PA0=ADC_IN0、PC5=ADC_IN15', () => {
    expect(h417.peripherals.adcApi).toBe('v4x7')
    expect(h417.peripherals.adc).toHaveLength(2)
    expect(h417.peripherals.adc[0].channels).toHaveLength(16)
    expect(pinByName(h417, 'PA0')?.adc).toEqual(['ADC_IN0'])
    expect(pinByName(h417, 'PC5')?.adc).toEqual(['ADC_IN15'])
    expect(h417.peripherals.adc[0].params.sampleTime.default).toBe('S71_5')
  })

  it('EXTI 0..15 线：PF10 → 通道10/EXTI15_8，PA0 → 通道0/EXTI7_0', () => {
    expect(extiOfPin(h417, 'PA0')?.irq).toBe('EXTI7_0')
    expect(extiOfPin(h417, 'PF10')?.channel).toBe(10)
    expect(extiOfPin(h417, 'PF10')?.irq).toBe('EXTI15_8')
    expect(irqByName(h417, 'EXTI7_0')).toBeDefined()
    expect(irqByName(h417, 'EXTI15_8')).toBeDefined()
    expect(h417.exti.entries).toHaveLength(95)
  })

  it('时钟：400MHz 预设与 HAL 配方常量', () => {
    expect(h417.clock.sysclkMaxMhz).toBe(400)
    expect(h417.clock.sources.find((s) => s.id === 'HSI')?.freqMhz).toBe(25)
    expect(h417.clock.codegen.fallback).toBe('preset_only')
    expect(h417.clock.codegen.presetConstMap['400MHZ_HSE']).toBe('hal::rcc::Config::with_sysclk_400m_v5f_400m_v3f_100m_hse()')
  })

  it('DMA 表为 DMAMUX 请求号（H4 非固定通道映射）', () => {
    const m = new Map(h417.dma!.requests.map((r) => [r.request, r.channel]))
    expect(m.get('USART1_TX')).toBe(85)
  })
})
