// 用户保留引脚规则（M4.7/M8）：mode=RESERVED 的引脚不做电气配置，
// 若仍被已启用外设占用或启用 EXTI → error 阻止导出（生成器侧另有纵深防御跳过）。
import { derivePeripheralUsage } from '@/model/peripherals'
import type { ConflictContext } from './context'

export function runReservedRules(ctx: ConflictContext): void {
  const { config, data, pins, push } = ctx
  const reserved = pins.filter((a) => a.mode === 'RESERVED')
  if (reserved.length === 0) return

  const occupied = new Map<string, string>()
  for (const usage of derivePeripheralUsage(config, data)) {
    if (!usage.enabled) continue
    for (const p of usage.pins) occupied.set(p.pin, usage.id)
  }

  for (const a of reserved) {
    const peri = occupied.get(a.pin)
    if (peri) {
      push({
        code: 'RESERVED_PIN_IN_USE',
        level: 'error',
        message: `${a.pin} 已标记 Reserved（用户保留），但仍被已启用外设 ${peri} 占用；请解除保留或停用外设`,
        pins: [a.pin],
        peripheral: peri,
      })
    }
    if (a.params?.exti?.enabled) {
      push({
        code: 'RESERVED_PIN_IN_USE',
        level: 'error',
        message: `${a.pin} 已标记 Reserved（用户保留），不能同时启用 EXTI；请解除保留或关闭 EXTI`,
        pins: [a.pin],
      })
    }
  }
}