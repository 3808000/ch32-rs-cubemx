// 冲突检查：提示词 §7 全部规则。纯函数，无芯片名分支。
// checkConflicts(config, deviceData, unlocked?) → Conflict[]
// 规则按家族拆分到 ./rules/*；本文件只保留规则注册表与对外 API。
import type { Conflict, DeviceData, ProjectConfig } from '@/model/types'
import type { ConflictContext, ConflictRule } from './rules/context'
import { labelToIdent, runPinRules } from './rules/pinRules'
import { runExtiRules } from './rules/extiRules'
import { runClockRules } from './rules/clockRules'
import { runPeripheralRules } from './rules/peripheralRules'
import { runDmaRules } from './rules/dmaRules'
import { runDeviceRules } from './rules/deviceRules'

export { labelToIdent }

/** 规则注册表：按固定顺序执行，保证冲突输出顺序稳定（引脚 → EXTI → 时钟 → 外设 → DMA → 芯片）。 */
const RULES: ConflictRule[] = [
  runPinRules,
  runExtiRules,
  runClockRules,
  runPeripheralRules,
  runDmaRules,
  runDeviceRules,
]

export function checkConflicts(config: ProjectConfig, data: DeviceData, unlocked: string[] = []): Conflict[] {
  const out: Conflict[] = []
  const ctx: ConflictContext = {
    config,
    data,
    pins: config.pins ?? [],
    pinByName: new Map(data.chip.pins.map((p) => [p.name, p])),
    peripherals: config.peripherals ?? {},
    unlocked,
    push: (c) => out.push(c),
  }
  for (const rule of RULES) rule(ctx)
  return out
}