// 外设卡片子组件共用的视图模型类型（仅 UI 层，不扩展数据层契约）。
export interface RemapOption {
  value: number
  label: string
}

/** Remap 引脚状态行：缺失（ok=false）标黄 */
export interface PinStatusRow {
  label: string
  pin: string | null
  ok: boolean
}

/** ADC 通道分配行：assignedPin 为空表示未分配 */
export interface AdcChannelRow {
  channel: string
  pin: string
  assignedPin: string | null
}

/** 仅展示实例（定时器等）的信号映射行 */
export interface DisplaySignalRow {
  signal: string
  list: { pin: string; remap: number }[]
}