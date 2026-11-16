// 冲突规则上下文：一次冲突检查共享的输入与结果通道。
import type { ChipPin, Conflict, DeviceData, PeripheralState, PinAssignment, ProjectConfig } from '@/model/types'

/** 单次冲突检查的共享上下文：规则只读输入、通过 push 追加结果，保证输出顺序与调用顺序一致。 */
export interface ConflictContext {
  config: ProjectConfig
  data: DeviceData
  pins: PinAssignment[]
  pinByName: Map<string, ChipPin>
  peripherals: Record<string, PeripheralState>
  unlocked: string[]
  push: (c: Conflict) => void
}

/** 单条规则家族：接收上下文，不返回值。 */
export type ConflictRule = (ctx: ConflictContext) => void