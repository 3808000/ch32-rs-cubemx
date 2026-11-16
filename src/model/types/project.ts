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
}