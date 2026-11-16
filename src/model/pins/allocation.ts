// ADC 通道 / EXTI 线分配枚举（供分配面板）。
import type { DeviceData } from '@/model/types'

export interface AdcChannelOption {
  channel: string
  pin: string
}

export interface ExtiLineOption {
  channel: number
  irq: string
  pins: string[]
}

/** 全部外部 ADC 通道 → 引脚 */
export function adcChannels(data: DeviceData): AdcChannelOption[] {
  const out: AdcChannelOption[] = []
  for (const inst of data.peripherals.adc) {
    for (const c of inst.channels) out.push({ channel: c.channel, pin: c.pin })
  }
  return out.sort((a, b) => a.channel.localeCompare(b.channel, undefined, { numeric: true }))
}

/** EXTI 线 → 可选引脚（同通道多引脚） */
export function extiLines(data: DeviceData): ExtiLineOption[] {
  const map = new Map<number, ExtiLineOption>()
  for (const e of data.exti.entries) {
    const cur = map.get(e.channel) ?? { channel: e.channel, irq: e.irq, pins: [] }
    cur.pins.push(e.pin)
    map.set(e.channel, cur)
  }
  return [...map.values()].sort((a, b) => a.channel - b.channel)
}

export function extiIrqOf(data: DeviceData, pin: string): string | null {
  return data.exti.entries.find((e) => e.pin === pin)?.irq ?? null
}