// DMA 通道配置（M3.2）：数据层建模、buildDmaPlan 规划、渲染器选用与冲突拦截。
// 覆盖：fixed 芯片默认/显式通道、非法改道拦截、DMAMUX 芯片自动/显式通道路由、
//       重复通道与请求号校验，以及 H417 芯片级 embassy 门禁。
import { describe, expect, it } from 'vitest'
import type { DeviceData, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { derivePeripheralUsage } from '@/model/peripherals'
import { generateProject } from '@/model/codegen'
import { buildDmaPlan, dmaChannelsOf, dmaModelOf, dmaPeripheralOf } from '@/model/codegen/derive'

const HAL_REV = 'a0863ebcc1082f64e508b73d3b944f119b0db77b'

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'dma-demo',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: true, debugPrint: false },
    hal: { rev: HAL_REV },
    ...over,
  }
}

/** 结果 → { path: content } */
function fileMap(r: ReturnType<typeof generateProject>): Record<string, string> {
  return Object.fromEntries(r.files.map((f) => [f.path, f.content]))
}

const v003 = getDeviceData('CH32V003F4P6')
const v203 = getDeviceData('CH32V203C8T6')
const h417 = getDeviceData('CH32H417QEU6')

/** H417 双核数据去掉 cores / embassy 门禁，用于验证单核 DMAMUX 生成路径。 */
const h417Single: DeviceData = {
  ...h417,
  chip: { ...h417.chip, cores: undefined, unsupportedFeatures: [] },
}

function usartConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return baseConfig({
    peripherals: { USART1: { enabled: true, params: {} } },
    pins: [
      pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
      pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
    ],
    ...over,
  })
}

describe('dma.json 建模', () => {
  it('V003/V203 为固定通道，通道表来自 dma.json', () => {
    expect(dmaModelOf(v003)).toBe('fixed')
    expect(dmaChannelsOf(v003).map((c) => c.name)).toEqual([
      'DMA1_CH1',
      'DMA1_CH2',
      'DMA1_CH3',
      'DMA1_CH4',
      'DMA1_CH5',
      'DMA1_CH6',
      'DMA1_CH7',
    ])
    expect(dmaModelOf(v203)).toBe('fixed')
    expect(dmaChannelsOf(v203).map((c) => c.name)).toContain('DMA1_CH8')
  })

  it('H417 为 DMAMUX：16 个物理通道 DMA1_CH1..8 / DMA2_CH1..8', () => {
    expect(dmaModelOf(h417)).toBe('dmamux')
    expect(dmaChannelsOf(h417).map((c) => c.name)).toEqual([
      'DMA1_CH1',
      'DMA1_CH2',
      'DMA1_CH3',
      'DMA1_CH4',
      'DMA1_CH5',
      'DMA1_CH6',
      'DMA1_CH7',
      'DMA1_CH8',
      'DMA2_CH1',
      'DMA2_CH2',
      'DMA2_CH3',
      'DMA2_CH4',
      'DMA2_CH5',
      'DMA2_CH6',
      'DMA2_CH7',
      'DMA2_CH8',
    ])
  })
})

describe('buildDmaPlan', () => {
  it('fixed：未配置时采用数据层固定通道（USART1_TX=4/RX=5，I2C1_TX=6/RX=7）', () => {
    const config = baseConfig({
      peripherals: { USART1: { enabled: true, params: {} }, I2C1: { enabled: true, params: {} } },
      pins: [
        pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
        pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
        pin('PC2', 'AF', { function: 'I2C1_SCL', remap: 0 }),
        pin('PC1', 'AF', { function: 'I2C1_SDA', remap: 0 }),
      ],
    })
    const plan = buildDmaPlan(config, v003, derivePeripheralUsage(config, v003))
    expect(plan.get('USART1_TX')?.channelPeripheral).toBe('DMA1_CH4')
    expect(plan.get('USART1_RX')?.channelPeripheral).toBe('DMA1_CH5')
    expect(plan.get('I2C1_TX')?.channelPeripheral).toBe('DMA1_CH6')
    expect(plan.get('I2C1_RX')?.channelPeripheral).toBe('DMA1_CH7')
    expect(plan.get('USART1_TX')?.explicit).toBe(false)
  })

  it('fixed：显式记录的合法通道不改变生成通道', () => {
    const config = usartConfig({
      dma: [
        { peripheral: 'USART1_TX', channel: 4 },
        { peripheral: 'USART1_RX', channel: 5 },
      ],
    })
    const plan = buildDmaPlan(config, v003, derivePeripheralUsage(config, v003))
    expect(plan.get('USART1_TX')).toMatchObject({ channelPeripheral: 'DMA1_CH4', explicit: true })
    expect(plan.get('USART1_RX')).toMatchObject({ channelPeripheral: 'DMA1_CH5', explicit: true })
  })

  it('dmamux：未手选时按顺序自动占用最低空闲通道', () => {
    const config = baseConfig({
      chip: 'CH32H417QEU6',
      peripherals: { USART1: { enabled: true, params: {} } },
      pins: [
        pin('PA9', 'AF', { function: 'USART1_TX', remap: 7 }),
        pin('PA10', 'AF', { function: 'USART1_RX', remap: 7 }),
      ],
    })
    const plan = buildDmaPlan(config, h417Single, derivePeripheralUsage(config, h417Single))
    expect(plan.get('USART1_TX')).toMatchObject({ channelPeripheral: 'DMA1_CH1', requestNumber: 85, explicit: false })
    expect(plan.get('USART1_RX')).toMatchObject({ channelPeripheral: 'DMA1_CH2', requestNumber: 86, explicit: false })
  })

  it('dmamux：显式通道优先（9 → DMA2_CH1），其余请求避开已占用通道', () => {
    const config = baseConfig({
      chip: 'CH32H417QEU6',
      peripherals: { USART1: { enabled: true, params: {} } },
      dma: [
        { peripheral: 'USART1_TX', channel: 9, request: 85 },
        { peripheral: 'USART1_RX', channel: 2, request: 86 },
      ],
      pins: [
        pin('PA9', 'AF', { function: 'USART1_TX', remap: 7 }),
        pin('PA10', 'AF', { function: 'USART1_RX', remap: 7 }),
      ],
    })
    const plan = buildDmaPlan(config, h417Single, derivePeripheralUsage(config, h417Single))
    expect(plan.get('USART1_TX')).toMatchObject({ channelPeripheral: 'DMA2_CH1', explicit: true })
    expect(plan.get('USART1_RX')).toMatchObject({ channelPeripheral: 'DMA1_CH2', explicit: true })
  })

  it('dmaPeripheralOf：缺数据映射时抛出可诊断错误', () => {
    const noDma: DeviceData = { ...v003, dma: undefined }
    const config = usartConfig()
    expect(() => dmaPeripheralOf(config, noDma, derivePeripheralUsage(config, noDma), 'USART1_TX')).toThrow(
      /缺少 DMA 通道映射：USART1_TX/,
    )
  })
})

describe('DMA 渲染选用', () => {
  it('fixed：embassy USART/I2C 默认使用数据层通道', () => {
    const r = generateProject(
      baseConfig({
        peripherals: { USART1: { enabled: true, params: {} }, I2C1: { enabled: true, params: {} } },
        pins: [
          pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
          pin('PC2', 'AF', { function: 'I2C1_SCL', remap: 0 }),
          pin('PC1', 'AF', { function: 'I2C1_SDA', remap: 0 }),
        ],
      }),
      v003,
    )
    expect(r.errors).toEqual([])
    const m = fileMap(r)
    expect(m['src/generated/usart.rs']).toContain('tx_dma: hal::Peri<')
    expect(m['src/generated/usart.rs']).toContain('DMA1_CH4')
    expect(m['src/generated/usart.rs']).toContain('DMA1_CH5')
    expect(m['src/generated/i2c.rs']).toContain('DMA1_CH6')
    expect(m['src/generated/i2c.rs']).toContain('DMA1_CH7')
    expect(m['src/generated/mod.rs']).toContain('p.DMA1_CH4, p.DMA1_CH5')
  })

  it('fixed：显式配置的合法通道写入生成代码', () => {
    const r = generateProject(
      usartConfig({
        dma: [
          { peripheral: 'USART1_TX', channel: 4 },
          { peripheral: 'USART1_RX', channel: 5 },
        ],
      }),
      v003,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)['src/generated/usart.rs']).toContain('DMA1_CH4')
    expect(fileMap(r)['src/generated/usart.rs']).toContain('DMA1_CH5')
  })

  it('fixed：把请求改到其它通道 → DMA_CHANNEL_CONFLICT 阻止导出', () => {
    const r = generateProject(
      usartConfig({
        dma: [{ peripheral: 'USART1_TX', channel: 1 }],
      }),
      v003,
    )
    expect(r.files).toEqual([])
    const err = r.errors.find((e) => e.code === 'DMA_CHANNEL_CONFLICT')
    expect(err?.level).toBe('error')
    expect(err?.message).toContain('固定使用通道 4')
  })

  it('dmamux：自动分配生成 DMA1_CH1/CH2（H417 单核合成数据）', () => {
    const r = generateProject(
      baseConfig({
        chip: 'CH32H417QEU6',
        peripherals: { USART1: { enabled: true, params: {} } },
        pins: [
          pin('PA9', 'AF', { function: 'USART1_TX', remap: 7 }),
          pin('PA10', 'AF', { function: 'USART1_RX', remap: 7 }),
        ],
      }),
      h417Single,
    )
    expect(r.errors).toEqual([])
    const m = fileMap(r)
    expect(m['src/generated/usart.rs']).toContain('DMA1_CH1')
    expect(m['src/generated/usart.rs']).toContain('DMA1_CH2')
    expect(m['src/generated/mod.rs']).toContain('p.DMA1_CH1, p.DMA1_CH2')
  })

  it('dmamux：显式通道 9 映射为 DMA2_CH1 并生成', () => {
    const r = generateProject(
      baseConfig({
        chip: 'CH32H417QEU6',
        peripherals: { USART1: { enabled: true, params: {} } },
        dma: [
          { peripheral: 'USART1_TX', channel: 9, request: 85 },
          { peripheral: 'USART1_RX', channel: 2, request: 86 },
        ],
        pins: [
          pin('PA9', 'AF', { function: 'USART1_TX', remap: 7 }),
          pin('PA10', 'AF', { function: 'USART1_RX', remap: 7 }),
        ],
      }),
      h417Single,
    )
    expect(r.errors).toEqual([])
    const m = fileMap(r)
    expect(m['src/generated/usart.rs']).toContain('DMA2_CH1')
    expect(m['src/generated/usart.rs']).toContain('DMA1_CH2')
    expect(m['src/generated/mod.rs']).toContain('p.DMA2_CH1, p.DMA1_CH2')
  })
})

describe('DMA 冲突拦截', () => {
  function h417Usart(over: Partial<ProjectConfig> = {}): ProjectConfig {
    return baseConfig({
      chip: 'CH32H417QEU6',
      peripherals: { USART1: { enabled: true, params: {} } },
      pins: [
        pin('PA9', 'AF', { function: 'USART1_TX', remap: 7 }),
        pin('PA10', 'AF', { function: 'USART1_RX', remap: 7 }),
      ],
      ...over,
    })
  }

  it('fixed：V203 真实映射 USART1_TX(4)/SPI2_RX(4) 冲突 → 阻止导出', () => {
    const r = generateProject(
      baseConfig({
        chip: 'CH32V203C8T6',
        peripherals: { USART1: { enabled: true, params: {} }, SPI2: { enabled: true, params: {} } },
        pins: [
          pin('PA9', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PA10', 'AF', { function: 'USART1_RX', remap: 0 }),
          pin('PB13', 'AF', { function: 'SPI2_SCK', remap: 0 }),
          pin('PB15', 'AF', { function: 'SPI2_MOSI', remap: 0 }),
          pin('PB14', 'AF', { function: 'SPI2_MISO', remap: 0 }),
        ],
      }),
      v203,
    )
    expect(r.files).toEqual([])
    const conflicts = r.errors.filter((e) => e.code === 'DMA_CHANNEL_CONFLICT')
    expect(conflicts).toHaveLength(2)
    expect(conflicts.some((e) => e.message.includes('USART1_TX') && e.message.includes('SPI2_RX'))).toBe(true)
  })

  it('fixed：仅 AF 引脚（peripherals 无 enabled 记录）同样参与冲突检测', () => {
    const r = generateProject(
      baseConfig({
        chip: 'CH32V203C8T6',
        pins: [
          pin('PA9', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PA10', 'AF', { function: 'USART1_RX', remap: 0 }),
          pin('PB13', 'AF', { function: 'SPI2_SCK', remap: 0 }),
          pin('PB15', 'AF', { function: 'SPI2_MOSI', remap: 0 }),
          pin('PB14', 'AF', { function: 'SPI2_MISO', remap: 0 }),
        ],
      }),
      v203,
    )
    expect(r.files).toEqual([])
    expect(r.errors.filter((e) => e.code === 'DMA_CHANNEL_CONFLICT')).toHaveLength(2)
  })

  it('dmamux：两个请求显式占用同一物理通道 → 阻止导出', () => {
    const r = generateProject(
      h417Usart({
        dma: [
          { peripheral: 'USART1_TX', channel: 1, request: 85 },
          { peripheral: 'USART1_RX', channel: 1, request: 86 },
        ],
      }),
      h417Single,
    )
    expect(r.files).toEqual([])
    const err = r.errors.find((e) => e.code === 'DMA_CHANNEL_CONFLICT')
    expect(err?.message).toContain('被多个请求占用')
  })

  it('dmamux：请求号与 dma.json 不一致 → 阻止导出', () => {
    const r = generateProject(
      h417Usart({
        dma: [{ peripheral: 'USART1_TX', channel: 1, request: 999 }],
      }),
      h417Single,
    )
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'DMA_CHANNEL_CONFLICT' && e.message.includes('DMAMUX 请求号应为 85'))).toBe(
      true,
    )
  })

  it('dmamux：物理通道不足以覆盖所有请求 → 阻止导出（不生成无法编译的代码）', () => {
    const oneChannel: DeviceData = {
      ...h417Single,
      dma: { ...h417Single.dma!, channels: [{ number: 1, name: 'DMA1_CH1' }] } as DeviceData['dma'],
    }
    const r = generateProject(h417Usart(), oneChannel)
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'DMA_CHANNEL_CONFLICT' && e.message.includes('物理通道不足'))).toBe(true)
  })

  it('dmamux：通道号不在 dma.json channels 中 → 阻止导出', () => {
    const r = generateProject(
      h417Usart({
        dma: [{ peripheral: 'USART1_TX', channel: 99 }],
      }),
      h417Single,
    )
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'DMA_CHANNEL_CONFLICT' && e.message.includes('channels 中'))).toBe(true)
  })

  it('真实 H417 数据仍按芯片 unsupportedFeatures 拦截 embassy（DMAMUX 已建模但不放开）', () => {
    const r = generateProject(h417Usart(), h417)
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'TARGET_FEATURE_UNSUPPORTED')).toBe(true)
  })
})