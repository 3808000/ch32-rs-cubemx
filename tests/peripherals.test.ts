// 外设实例推导单元测试：derivePeripheralUsage / enabledUsage。
// 数据：真实 CH32V003F4P6（USART1 四档、SPI1 两档、I2C1 三档、ADC1 八通道）。
import { describe, it, expect } from 'vitest'
import type { PinAssignment, PinMode, ProjectConfig } from '../src/types'
import { derivePeripheralUsage, enabledUsage } from '../src/lib/peripherals'
import { getDeviceData } from '../src/data/device'

const data = getDeviceData('CH32V003F4P6')

/** 构造 ProjectConfig（各测试共用） */
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

function af(pin: string, signal: string): PinAssignment {
  return { pin, mode: 'AF' as PinMode, function: signal, params: {} }
}

function analog(pin: string, channel: string): PinAssignment {
  return { pin, mode: 'ANALOG' as PinMode, function: channel, params: {} }
}

describe('derivePeripheralUsage 基线', () => {
  it('空配置：返回 4 个实例（USART1/SPI1/I2C1/ADC1），全部未启用', () => {
    const usages = derivePeripheralUsage(makeConfig([]), data)
    expect(usages.map((u) => u.id)).toEqual(['USART1', 'SPI1', 'I2C1', 'ADC1'])
    expect(usages.every((u) => !u.enabled)).toBe(true)
  })

  it('未启用实例的 remap 回退到第一档，ADC 恒为 null', () => {
    const usages = derivePeripheralUsage(makeConfig([]), data)
    const m = new Map(usages.map((u) => [u.id, u.remap]))
    expect(m.get('USART1')).toBe(0)
    expect(m.get('SPI1')).toBe(0)
    expect(m.get('I2C1')).toBe(0)
    expect(m.get('ADC1')).toBeNull()
  })

  it('未启用实例使用参数默认值', () => {
    const usages = derivePeripheralUsage(makeConfig([]), data)
    const m = new Map(usages.map((u) => [u.id, u.params]))
    expect(m.get('USART1')!.baudrate).toBe(115200)
    expect(m.get('SPI1')!.mode).toBe('MODE_0')
    expect(m.get('I2C1')!.speed).toBe(100000)
    expect(m.get('ADC1')!.sampleTime).toBe('CYCLES73')
  })

  it('纯 GPIO 引脚不启用任何外设', () => {
    const usages = derivePeripheralUsage(
      makeConfig([{ pin: 'PD5', mode: 'OUTPUT', params: {} }, { pin: 'PD6', mode: 'INPUT', params: {} }]),
      data,
    )
    expect(usages.every((u) => !u.enabled)).toBe(true)
  })
})

describe('USART AF 推导', () => {
  it('PD5 TX + PD6 RX：启用、remap 推断为 0', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD5', 'USART1_TX'), af('PD6', 'USART1_RX')]), data)
    const u = usages.find((x) => x.id === 'USART1')!
    expect(u.enabled).toBe(true)
    expect(u.remap).toBe(0)
    expect(u.pins).toEqual([
      { role: 'tx', pin: 'PD5', signal: 'USART1_TX' },
      { role: 'rx', pin: 'PD6', signal: 'USART1_RX' },
    ])
  })

  it('PD6 TX + PD5 RX：remap 推断为 2（反向引脚）', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD6', 'USART1_TX'), af('PD5', 'USART1_RX')]), data)
    expect(usages.find((x) => x.id === 'USART1')!.remap).toBe(2)
  })

  it('PD0 TX + PD1 RX：remap 推断为 1', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD0', 'USART1_TX'), af('PD1', 'USART1_RX')]), data)
    expect(usages.find((x) => x.id === 'USART1')!.remap).toBe(1)
  })

  it('PC0 TX + PC1 RX：remap 推断为 3', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PC0', 'USART1_TX'), af('PC1', 'USART1_RX')]), data)
    expect(usages.find((x) => x.id === 'USART1')!.remap).toBe(3)
  })

  it('只配 TX（PD5）也视为启用，roles 只有 tx', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD5', 'USART1_TX')]), data)
    const u = usages.find((x) => x.id === 'USART1')!
    expect(u.enabled).toBe(true)
    expect(u.pins).toEqual([{ role: 'tx', pin: 'PD5', signal: 'USART1_TX' }])
  })

  it('CTS/RTS 角色推导（PD3 CTS + PC2 RTS，remap0）', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD3', 'USART1_CTS'), af('PC2', 'USART1_RTS')]), data)
    const u = usages.find((x) => x.id === 'USART1')!
    expect(u.enabled).toBe(true)
    expect(u.pins.map((p) => p.role)).toEqual(['cts', 'rts'])
    expect(u.remap).toBe(0)
  })

  it('显式 state.remap 优先于引脚推断', () => {
    const usages = derivePeripheralUsage(
      makeConfig([af('PD5', 'USART1_TX'), af('PD6', 'USART1_RX')], {
        peripherals: { USART1: { enabled: true, params: {}, remap: 3 } },
      }),
      data,
    )
    expect(usages.find((x) => x.id === 'USART1')!.remap).toBe(3)
  })
})

describe('显式启用（无引脚）', () => {
  it('peripherals 显式 enabled=true：无引脚也启用', () => {
    const usages = derivePeripheralUsage(
      makeConfig([], { peripherals: { USART1: { enabled: true, params: {} } } }),
      data,
    )
    const u = usages.find((x) => x.id === 'USART1')!
    expect(u.enabled).toBe(true)
    expect(u.pins).toEqual([])
  })

  it('显式启用 ADC1 无 ANALOG 引脚：enabled=true、pins 空', () => {
    const usages = derivePeripheralUsage(makeConfig([], { peripherals: { ADC1: { enabled: true, params: {} } } }), data)
    const u = usages.find((x) => x.id === 'ADC1')!
    expect(u.enabled).toBe(true)
    expect(u.pins).toEqual([])
  })

  it('enabled 语义为 OR：显式 enabled=false 但配了 AF 引脚仍视为启用', () => {
    const usages = derivePeripheralUsage(
      makeConfig([af('PD5', 'USART1_TX')], { peripherals: { USART1: { enabled: false, params: {} } } }),
      data,
    )
    // 契约：af.length > 0 || state.enabled —— AF 引脚即占用外设（Rust 单例语义）
    expect(usages.find((x) => x.id === 'USART1')!.enabled).toBe(true)
  })
})

describe('参数合并', () => {
  it('覆盖 baudrate=9600，其余保持默认', () => {
    const usages = derivePeripheralUsage(
      makeConfig([af('PD5', 'USART1_TX'), af('PD6', 'USART1_RX')], {
        peripherals: { USART1: { enabled: true, params: { baudrate: 9600 } } },
      }),
      data,
    )
    const p = usages.find((x) => x.id === 'USART1')!.params
    expect(p.baudrate).toBe(9600)
    expect(p.wordLength).toBe('DataBits8')
    expect(p.stopBits).toBe('STOP1')
    expect(p.parity).toBe('ParityNone')
  })

  it('多参数同时覆盖', () => {
    const usages = derivePeripheralUsage(
      makeConfig([], { peripherals: { SPI1: { enabled: true, params: { mode: 'MODE_3', frequency: 8000000 } } } }),
      data,
    )
    const p = usages.find((x) => x.id === 'SPI1')!.params
    expect(p.mode).toBe('MODE_3')
    expect(p.frequency).toBe(8000000)
    expect(p.bitOrder).toBe('MsbFirst')
  })

  it('显式启用但 params 为空对象 → 全默认', () => {
    const usages = derivePeripheralUsage(
      makeConfig([], { peripherals: { I2C1: { enabled: true, params: {} } } }),
      data,
    )
    const p = usages.find((x) => x.id === 'I2C1')!.params
    expect(p.speed).toBe(100000)
    expect(p.duty).toBe('Duty2_1')
  })
})

describe('ADC ANALOG 推导', () => {
  it('PA2 IN0 + PD4 IN7：ADC1 启用，两通道角色', () => {
    const usages = derivePeripheralUsage(makeConfig([analog('PA2', 'ADC_IN0'), analog('PD4', 'ADC_IN7')]), data)
    const u = usages.find((x) => x.id === 'ADC1')!
    expect(u.enabled).toBe(true)
    expect(u.category).toBe('adc')
    expect(u.remap).toBeNull()
    expect(u.pins).toEqual([
      { role: 'ADC_IN0', pin: 'PA2', signal: 'ADC_IN0' },
      { role: 'ADC_IN7', pin: 'PD4', signal: 'ADC_IN7' },
    ])
  })

  it('只配一个 ANALOG 引脚也启用', () => {
    const usages = derivePeripheralUsage(makeConfig([analog('PC4', 'ADC_IN2')]), data)
    const u = usages.find((x) => x.id === 'ADC1')!
    expect(u.enabled).toBe(true)
    expect(u.pins).toHaveLength(1)
  })

  it('通道名不在实例通道表（ADC_IN8）时不推导', () => {
    const usages = derivePeripheralUsage(makeConfig([analog('PA2', 'ADC_IN8')]), data)
    expect(usages.find((x) => x.id === 'ADC1')!.enabled).toBe(false)
  })

  it('AF 引脚不会误开 ADC', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PA2', 'USART1_RX')]), data)
    expect(usages.find((x) => x.id === 'ADC1')!.enabled).toBe(false)
  })
})

describe('SPI 推导', () => {
  it('PC5 SCK + PC6 MOSI + PC7 MISO：启用、remap 0', () => {
    const usages = derivePeripheralUsage(
      makeConfig([af('PC5', 'SPI1_SCK'), af('PC6', 'SPI1_MOSI'), af('PC7', 'SPI1_MISO')]),
      data,
    )
    const u = usages.find((x) => x.id === 'SPI1')!
    expect(u.enabled).toBe(true)
    expect(u.remap).toBe(0)
    expect(u.pins.map((p) => p.role)).toEqual(['sck', 'mosi', 'miso'])
  })

  it('加 PC0 NSS 后 remap 推断为 1', () => {
    const usages = derivePeripheralUsage(
      makeConfig([af('PC5', 'SPI1_SCK'), af('PC6', 'SPI1_MOSI'), af('PC7', 'SPI1_MISO'), af('PC0', 'SPI1_NSS')]),
      data,
    )
    expect(usages.find((x) => x.id === 'SPI1')!.remap).toBe(1)
  })

  it('显式 state.remap=1 覆盖推断', () => {
    const usages = derivePeripheralUsage(
      makeConfig([af('PC5', 'SPI1_SCK'), af('PC6', 'SPI1_MOSI'), af('PC7', 'SPI1_MISO')], {
        peripherals: { SPI1: { enabled: true, params: {}, remap: 1 } },
      }),
      data,
    )
    expect(usages.find((x) => x.id === 'SPI1')!.remap).toBe(1)
  })
})

describe('I2C 推导', () => {
  it('PC2 SCL + PC1 SDA：remap 0', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PC2', 'I2C1_SCL'), af('PC1', 'I2C1_SDA')]), data)
    const u = usages.find((x) => x.id === 'I2C1')!
    expect(u.enabled).toBe(true)
    expect(u.remap).toBe(0)
    expect(u.pins.map((p) => p.role)).toEqual(['scl', 'sda'])
  })

  it('PD1 SCL + PD0 SDA：remap 1', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD1', 'I2C1_SCL'), af('PD0', 'I2C1_SDA')]), data)
    expect(usages.find((x) => x.id === 'I2C1')!.remap).toBe(1)
  })

  it('PC5 SCL + PC6 SDA：remap 2', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PC5', 'I2C1_SCL'), af('PC6', 'I2C1_SDA')]), data)
    expect(usages.find((x) => x.id === 'I2C1')!.remap).toBe(2)
  })
})

describe('enabledUsage 过滤', () => {
  const usages = derivePeripheralUsage(
    makeConfig(
      [af('PD5', 'USART1_TX'), af('PD6', 'USART1_RX'), analog('PA2', 'ADC_IN0')],
      { peripherals: { SPI1: { enabled: true, params: {} } } },
    ),
    data,
  )

  it('只返回已启用的指定类别实例', () => {
    const usart = enabledUsage(usages, 'usart')
    expect(usart).toHaveLength(1)
    expect(usart[0].id).toBe('USART1')
  })

  it('spi 类别只有显式启用的 SPI1', () => {
    const spi = enabledUsage(usages, 'spi')
    expect(spi.map((u) => u.id)).toEqual(['SPI1'])
    expect(spi[0].enabled).toBe(true)
  })

  it('未启用的类别返回空（i2c）', () => {
    expect(enabledUsage(usages, 'i2c')).toEqual([])
  })

  it('adc 类别包含 ANALOG 推导的 ADC1', () => {
    const adc = enabledUsage(usages, 'adc')
    expect(adc.map((u) => u.id)).toEqual(['ADC1'])
  })

  it('无 AF/ANALOG 引脚且未显式启用的实例被过滤', () => {
    const none = derivePeripheralUsage(makeConfig([{ pin: 'PC3', mode: 'OUTPUT', params: {} }]), data)
    expect(enabledUsage(none, 'usart')).toEqual([])
    expect(enabledUsage(none, 'spi')).toEqual([])
    expect(enabledUsage(none, 'i2c')).toEqual([])
    expect(enabledUsage(none, 'adc')).toEqual([])
  })
})

describe('信号前缀隔离', () => {
  it('SPI1_SCK 的 AF 引脚不启用 USART1', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PC5', 'SPI1_SCK')]), data)
    expect(usages.find((x) => x.id === 'USART1')!.enabled).toBe(false)
    expect(usages.find((x) => x.id === 'SPI1')!.enabled).toBe(true)
  })

  it('TIM1_CH1 的 AF 引脚不启用任何可推导外设（TIM 不在推导范围）', () => {
    const usages = derivePeripheralUsage(makeConfig([af('PD2', 'TIM1_CH1')]), data)
    expect(usages.every((u) => !u.enabled)).toBe(true)
  })
})
