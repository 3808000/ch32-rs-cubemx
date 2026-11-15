// ADC 通道 / EXTI 线分配枚举单元测试（真实 CH32V003F4P6）。
import { describe, it, expect } from 'vitest'
import { adcChannels, extiLines, extiIrqOf } from '../src/lib/allocation'
import { getDeviceData } from '../src/data/device'

const data = getDeviceData('CH32V003F4P6')

describe('adcChannels', () => {
  it('枚举全部 8 个外部通道', () => {
    const ch = adcChannels(data)
    expect(ch).toHaveLength(8)
    expect(ch.map((c) => c.channel)).toEqual([
      'ADC_IN0', 'ADC_IN1', 'ADC_IN2', 'ADC_IN3', 'ADC_IN4', 'ADC_IN5', 'ADC_IN6', 'ADC_IN7',
    ])
  })

  it('通道按数值排序（IN0..IN7）', () => {
    const ch = adcChannels(data)
    expect([...ch].sort((a, b) => (a.channel < b.channel ? -1 : 1))).toEqual(ch)
  })

  it('通道-引脚映射与 datasheet 一致', () => {
    const m = new Map(adcChannels(data).map((c) => [c.channel, c.pin]))
    expect(m.get('ADC_IN0')).toBe('PA2')
    expect(m.get('ADC_IN1')).toBe('PA1')
    expect(m.get('ADC_IN2')).toBe('PC4')
    expect(m.get('ADC_IN3')).toBe('PD2')
    expect(m.get('ADC_IN4')).toBe('PD3')
    expect(m.get('ADC_IN5')).toBe('PD5')
    expect(m.get('ADC_IN6')).toBe('PD6')
    expect(m.get('ADC_IN7')).toBe('PD4')
  })

  it('每个引脚只出现一次（8 通道 8 引脚一一对应）', () => {
    const pins = adcChannels(data).map((c) => c.pin)
    expect(new Set(pins).size).toBe(8)
  })
})

describe('extiLines', () => {
  it('枚举 EXTI0..7 共 8 条线，按通道升序', () => {
    const lines = extiLines(data)
    expect(lines.map((l) => l.channel)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('每条线的 IRQ 均为单一向量 EXTI7_0', () => {
    for (const l of extiLines(data)) expect(l.irq).toBe('EXTI7_0')
  })

  it('通道 1 汇聚三个可选引脚：PA1/PC1/PD1', () => {
    const l = extiLines(data).find((x) => x.channel === 1)!
    expect(l.pins).toEqual(expect.arrayContaining(['PA1', 'PC1', 'PD1']))
    expect(l.pins).toHaveLength(3)
  })

  it('通道 0 汇聚 PC0/PD0', () => {
    const l = extiLines(data).find((x) => x.channel === 0)!
    expect(l.pins).toEqual(expect.arrayContaining(['PC0', 'PD0']))
  })

  it('所有 exti 表引脚都被归并到对应线（18 引脚不丢失）', () => {
    const total = extiLines(data).reduce((n, l) => n + l.pins.length, 0)
    expect(total).toBe(18)
  })
})

describe('extiIrqOf', () => {
  it('PC0 → EXTI7_0', () => {
    expect(extiIrqOf(data, 'PC0')).toBe('EXTI7_0')
  })

  it('PD4 → EXTI7_0', () => {
    expect(extiIrqOf(data, 'PD4')).toBe('EXTI7_0')
  })

  it('电源脚/未知引脚 → null', () => {
    expect(extiIrqOf(data, 'VSS')).toBeNull()
    expect(extiIrqOf(data, 'PX9')).toBeNull()
  })
})
