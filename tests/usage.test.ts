// 外设使用归并单元测试：pinUsageSummary（引脚 → 驱动占用汇总）。
import { describe, it, expect } from 'vitest'
import type { PinAssignment, ProjectConfig } from '../src/types'
import { pinUsageSummary } from '../src/lib/usage'
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

describe('pinUsageSummary', () => {
  it('空配置 → 空汇总', () => {
    expect(pinUsageSummary(makeConfig([]), data)).toEqual([])
  })

  it('GPIO INPUT/OUTPUT → "GPIO INPUT"/"GPIO OUTPUT"', () => {
    const out = pinUsageSummary(
      makeConfig([{ pin: 'PC0', mode: 'INPUT', params: {} }, { pin: 'PC1', mode: 'OUTPUT', params: {} }]),
      data,
    )
    const m = new Map(out.map((u) => [u.pin, u.drivers]))
    expect(m.get('PC0')).toEqual(['GPIO INPUT'])
    expect(m.get('PC1')).toEqual(['GPIO OUTPUT'])
  })

  it('AF 引脚 → 外设实例名（USART1_TX → USART1）', () => {
    const out = pinUsageSummary(makeConfig([{ pin: 'PD5', mode: 'AF', function: 'USART1_TX', params: {} }]), data)
    expect(out).toEqual([{ pin: 'PD5', drivers: ['USART1'] }])
  })

  it('AF 与推导出的外设占用去重（USART1 只出现一次）', () => {
    const out = pinUsageSummary(
      makeConfig([
        { pin: 'PD5', mode: 'AF', function: 'USART1_TX', params: {} },
        { pin: 'PD6', mode: 'AF', function: 'USART1_RX', params: {} },
      ]),
      data,
    )
    const m = new Map(out.map((u) => [u.pin, u.drivers]))
    expect(m.get('PD5')).toEqual(['USART1'])
    expect(m.get('PD6')).toEqual(['USART1'])
  })

  it('ANALOG 引脚 → "ADC (ADC_IN0)" + 推导的 ADC1', () => {
    const out = pinUsageSummary(makeConfig([{ pin: 'PA2', mode: 'ANALOG', function: 'ADC_IN0', params: {} }]), data)
    expect(out).toEqual([{ pin: 'PA2', drivers: ['ADC (ADC_IN0)', 'ADC1'] }])
  })

  it('EXTI 启用时叠加 "EXTI" 驱动', () => {
    const out = pinUsageSummary(
      makeConfig([{ pin: 'PC0', mode: 'INPUT', params: { exti: { enabled: true, edge: 'RISING' } } }]),
      data,
    )
    expect(out).toEqual([{ pin: 'PC0', drivers: ['GPIO INPUT', 'EXTI'] }])
  })

  it('EXTI 与 AF 模式共存（AF/EXTI）', () => {
    const out = pinUsageSummary(
      makeConfig([{ pin: 'PD5', mode: 'AF', function: 'USART1_TX', params: { exti: { enabled: true, edge: 'BOTH' } } }]),
      data,
    )
    expect(out[0].drivers).toEqual(expect.arrayContaining(['USART1', 'EXTI']))
  })

  it('未启用的显式外设（无引脚）不出现在汇总中', () => {
    const out = pinUsageSummary(
      makeConfig([{ pin: 'PC0', mode: 'INPUT', params: {} }], {
        peripherals: { SPI1: { enabled: false, params: {} } },
      }),
      data,
    )
    expect(out).toEqual([{ pin: 'PC0', drivers: ['GPIO INPUT'] }])
  })

  it('汇总按引脚名排序', () => {
    const out = pinUsageSummary(
      makeConfig([
        { pin: 'PD5', mode: 'OUTPUT', params: {} },
        { pin: 'PC1', mode: 'INPUT', params: {} },
        { pin: 'PA2', mode: 'INPUT', params: {} },
      ]),
      data,
    )
    expect(out.map((u) => u.pin)).toEqual(['PA2', 'PC1', 'PD5'])
  })

  it('驱动列表保持去重且不重复添加', () => {
    const out = pinUsageSummary(
      makeConfig([{ pin: 'PD5', mode: 'AF', function: 'USART1_TX', params: {} }]),
      data,
    )
    expect(out[0].drivers.filter((d) => d === 'USART1')).toHaveLength(1)
  })

  it('SPI AF 引脚 → SPI1 驱动', () => {
    const out = pinUsageSummary(makeConfig([{ pin: 'PC5', mode: 'AF', function: 'SPI1_SCK', params: {} }]), data)
    expect(out).toEqual([{ pin: 'PC5', drivers: ['SPI1'] }])
  })

  it('I2C AF 引脚 → I2C1 驱动', () => {
    const out = pinUsageSummary(makeConfig([{ pin: 'PC2', mode: 'AF', function: 'I2C1_SCL', params: {} }]), data)
    expect(out).toEqual([{ pin: 'PC2', drivers: ['I2C1'] }])
  })
})
