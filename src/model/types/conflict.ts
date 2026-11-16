// 冲突检查结果类型：等级 / 规则代码 / 单条冲突。

export type ConflictLevel = 'error' | 'warning'

export type ConflictCode =
  | 'UNKNOWN_PIN'
  | 'DUPLICATE_PIN'
  | 'PIN_NOT_CONFIGURABLE'
  | 'SPECIAL_PIN_LOCKED'
  | 'SPECIAL_PIN_OSC'
  | 'EXTI_ON_NON_INPUT'
  | 'EXTI_LINE_CONFLICT'
  | 'DUPLICATE_LABEL'
  | 'AF_SIGNAL_DUPLICATE'
  | 'ANALOG_DUPLICATE'
  | 'USART_RX_MISSING'
  | 'USART_TX_MISSING'
  | 'PERIPHERAL_CLOCK_INVALID'
  | 'REMAP_MISMATCH'
  | 'REMAP_UNDEFINED'
  | 'PIN_CONSUMED_TWICE'
  | 'CLOCK_PRESET_UNAVAILABLE'
  | 'TARGET_FEATURE_UNSUPPORTED'
  | 'SRAM_BUDGET_EXCEEDED'
  | 'DMA_CHANNEL_CONFLICT'
  | 'IRQ_UNKNOWN'
  | 'IRQ_PRIORITY_DUPLICATE'
  | 'IRQ_EMBASSY_NOT_ENABLED'

export interface Conflict {
  code: ConflictCode
  level: ConflictLevel
  message: string
  pins?: string[]
  peripheral?: string
}