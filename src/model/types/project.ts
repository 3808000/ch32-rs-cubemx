// 工程配置模型：引脚分配、分组、时钟引用与外设开关（ProjectConfig）。
import type { ClockConfig } from './clock'

// ---------- 配置模型（ProjectConfig） ----------

export type PinMode = 'INPUT' | 'OUTPUT' | 'AF' | 'ANALOG'
export type OutputType = 'PUSH_PULL' | 'OPEN_DRAIN'
export type SpeedGrade = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
export type Level = 'HIGH' | 'LOW'
export type Pull = 'NONE' | 'UP' | 'DOWN'
export type ExtiEdge = 'RISING' | 'FALLING' | 'BOTH'

export interface PinParams {
  outputType?: OutputType
  speed?: SpeedGrade
  level?: Level
  pull?: Pull
  exti?: { enabled: boolean; edge: ExtiEdge }
}

export interface PinAssignment {
  pin: string // 'PD5'
  label?: string // 'LED_RUN'
  mode: PinMode
  function?: string // AF/ANALOG 时的信号名，如 'USART1_TX' / 'ADC_IN4'
  remap?: number // AF 时锁定的 remap 值（const 泛型）
  params: PinParams
}

export interface PinGroup {
  name: string
  pins: string[]
  color?: string
}

export interface PeripheralState {
  enabled: boolean
  params: Record<string, string | number | boolean>
  remap?: number
}

/** 中断配置（M3 NVIC/PFIC）。irq 名取自 data/devices/<chip>/interrupts.json；priority 0..15。 */
export interface InterruptConfig {
  irq: string
  enabled: boolean
  priority: number
}

/** DMA 通道分配（M3，embassy/H417 场景）。channel/request 合法性由 dma.json 校验。 */
export interface DmaConfig {
  peripheral: string
  channel: number
  request?: number
}

export interface ProjectConfig {
  version: 1
  chip: string // 'CH32V003F4P6'
  projectName: string
  pins: PinAssignment[]
  groups?: PinGroup[]
  naming: { prefix: string }
  clock?: ClockConfig
  peripherals?: Record<string, PeripheralState>
  features: { embassy: boolean; debugPrint: boolean }
  hal: { rev: string }
  /** 显式解锁的特殊引脚（NRST/SWD/OSC）。可选，向后兼容；导入/导出往返保留。 */
  unlockedPins?: string[]
  /** 中断配置（M3）。可选，向后兼容。 */
  interrupts?: InterruptConfig[]
  /** DMA 通道分配（M3）。可选，向后兼容。 */
  dma?: DmaConfig[]
}