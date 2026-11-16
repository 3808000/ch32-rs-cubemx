// 器件注册表 + Lookup。新增芯片只需在 data/devices/<chip>/ 放 JSON 并在此注册导入。
import type {
  ChipData,
  ClockData,
  DeviceData,
  DmaData,
  ExtiData,
  InterruptsData,
  PeripheralsData,
  RemapData,
  RemapEntry,
} from '@/model/types'

import v003chip from '../../data/devices/ch32v003f4p6/chip.json'
import v003remap from '../../data/devices/ch32v003f4p6/remap.json'
import v003exti from '../../data/devices/ch32v003f4p6/exti.json'
import v003clock from '../../data/devices/ch32v003f4p6/clock.json'
import v003peripherals from '../../data/devices/ch32v003f4p6/peripherals.json'
import v003interrupts from '../../data/devices/ch32v003f4p6/interrupts.json'
import v003dma from '../../data/devices/ch32v003f4p6/dma.json'

// CH32V203C8T6（LQFP48）：V4B 内核，走 rcc v3 / adc_v3 实现
import v203chip from '../../data/devices/ch32v203c8t6/chip.json'
import v203remap from '../../data/devices/ch32v203c8t6/remap.json'
import v203exti from '../../data/devices/ch32v203c8t6/exti.json'
import v203clock from '../../data/devices/ch32v203c8t6/clock.json'
import v203peripherals from '../../data/devices/ch32v203c8t6/peripherals.json'
import v203interrupts from '../../data/devices/ch32v203c8t6/interrupts.json'
import v203dma from '../../data/devices/ch32v203c8t6/dma.json'

// CH32H417QEU6（QFN128）：双核 V3F(hart0)+V5F(hart1)，每引脚 AF，H4 RCC 配方；代码生成产出 workspace
import h417chip from '../../data/devices/ch32h417qeu6/chip.json'
import h417remap from '../../data/devices/ch32h417qeu6/remap.json'
import h417exti from '../../data/devices/ch32h417qeu6/exti.json'
import h417clock from '../../data/devices/ch32h417qeu6/clock.json'
import h417peripherals from '../../data/devices/ch32h417qeu6/peripherals.json'
import h417interrupts from '../../data/devices/ch32h417qeu6/interrupts.json'
import h417dma from '../../data/devices/ch32h417qeu6/dma.json'

// CH582M（QFN48）：BLE5.3，HAL 后端为 ch58x-hal（代码生成暂未接入，导出被守卫阻止）
import ch582chip from '../../data/devices/ch582m/chip.json'
import ch582remap from '../../data/devices/ch582m/remap.json'
import ch582exti from '../../data/devices/ch582m/exti.json'
import ch582clock from '../../data/devices/ch582m/clock.json'
import ch582peripherals from '../../data/devices/ch582m/peripherals.json'
import ch582interrupts from '../../data/devices/ch582m/interrupts.json'
import ch582dma from '../../data/devices/ch582m/dma.json'

const registry = new Map<string, DeviceData>()

function register(chip: ChipData, remap: RemapData, exti: ExtiData, clock: ClockData, peripherals: PeripheralsData, interrupts: InterruptsData, dma?: DmaData) {
  registry.set(chip.chip, { chip, remap, exti, clock, peripherals, interrupts, dma })
}

register(
  v003chip as ChipData,
  v003remap as RemapData,
  v003exti as ExtiData,
  v003clock as unknown as ClockData,
  v003peripherals as unknown as PeripheralsData,
  v003interrupts as InterruptsData,
  v003dma as DmaData,
)

register(
  v203chip as ChipData,
  v203remap as RemapData,
  v203exti as ExtiData,
  v203clock as unknown as ClockData,
  v203peripherals as unknown as PeripheralsData,
  v203interrupts as InterruptsData,
  v203dma as DmaData,
)

register(
  h417chip as ChipData,
  h417remap as RemapData,
  h417exti as ExtiData,
  h417clock as unknown as ClockData,
  h417peripherals as unknown as PeripheralsData,
  h417interrupts as InterruptsData,
  h417dma as DmaData,
)

register(
  ch582chip as ChipData,
  ch582remap as RemapData,
  ch582exti as ExtiData,
  ch582clock as unknown as ClockData,
  ch582peripherals as unknown as PeripheralsData,
  ch582interrupts as InterruptsData,
  ch582dma as DmaData,
)

export function listDevices(): ChipData[] {
  return [...registry.values()].map((d) => d.chip)
}

export function getDeviceData(chip: string): DeviceData {
  const d = registry.get(chip)
  if (!d) throw new Error(`未注册的芯片：${chip}`)
  return d
}

export function hasDevice(chip: string): boolean {
  return registry.has(chip)
}

// ---------- Lookup ----------

export function pinByName(data: DeviceData, name: string) {
  return data.chip.pins.find((p) => p.name === name)
}

/** 引脚可承载的全部 (signal, remap) */
export function remapsOfPin(data: DeviceData, pin: string): RemapEntry[] {
  return data.remap.entries.filter((e) => e.pin === pin)
}

/** 某信号的全部可选 (pin, remap) */
export function pinsOfSignal(data: DeviceData, signal: string): RemapEntry[] {
  return data.remap.entries.filter((e) => e.signal === signal)
}

/** 引脚是否支持某信号（任意 remap） */
export function pinSupportsSignal(data: DeviceData, pin: string, signal: string): boolean {
  return data.remap.entries.some((e) => e.pin === pin && e.signal === signal)
}

/** 取引脚承载某信号时的 remap 值（可能多档，返回列表） */
export function remapValuesFor(data: DeviceData, pin: string, signal: string): number[] {
  return [...new Set(data.remap.entries.filter((e) => e.pin === pin && e.signal === signal).map((e) => e.remap))]
}

export function extiOfPin(data: DeviceData, pin: string) {
  return data.exti.entries.find((e) => e.pin === pin)
}

export function irqByName(data: DeviceData, name: string) {
  return data.interrupts.irqs.find((i) => i.name === name)
}

/** 信号 → 外设实例 id（USART1_TX → USART1；ADC_IN0 → ADC1） */
export function peripheralOfSignal(signal: string): string | null {
  if (signal.startsWith('ADC_')) return 'ADC1'
  const i = signal.lastIndexOf('_')
  if (i <= 0) return null
  return signal.slice(0, i)
}

/** 外设实例 → 类别 */
export function categoryOfPeripheral(id: string): 'usart' | 'spi' | 'i2c' | 'adc' | 'timer' | 'other' {
  if (id.startsWith('USART') || id.startsWith('UART')) return 'usart'
  if (id.startsWith('SPI')) return 'spi'
  if (id.startsWith('I2C')) return 'i2c'
  if (id.startsWith('ADC')) return 'adc'
  if (id.startsWith('TIM')) return 'timer'
  return 'other'
}