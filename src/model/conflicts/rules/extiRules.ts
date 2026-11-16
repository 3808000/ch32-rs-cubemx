// EXTI 规则：非输入模式下启用 EXTI / 数据层无 EXTI 通道 / 同一 EXTI 通道被多引脚占用。
import type { ConflictContext } from './context'

export function runExtiRules(ctx: ConflictContext): void {
  const { data, pins, push } = ctx

  // ---- EXTI 规则 ----
  const extiLineOwners = new Map<number, string[]>()
  for (const a of pins) {
    if (!a.params.exti?.enabled) continue
    if (a.mode !== 'INPUT') {
      push({ code: 'EXTI_ON_NON_INPUT', level: 'warning', message: `${a.pin} 启用了 EXTI 但模式是 ${a.mode}（建议 INPUT）`, pins: [a.pin] })
    }
    const e = data.exti.entries.find((x) => x.pin === a.pin)
    if (!e) {
      push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${a.pin} 无 EXTI 通道（数据层未定义）`, pins: [a.pin] })
      continue
    }
    const arr = extiLineOwners.get(e.channel) ?? []
    arr.push(a.pin)
    extiLineOwners.set(e.channel, arr)
  }
  for (const [ch, owners] of extiLineOwners) {
    if (owners.length > 1) {
      push({ code: 'EXTI_LINE_CONFLICT', level: 'error', message: `EXTI 通道 ${ch} 被多个引脚占用：${owners.join('、')}`, pins: owners })
    }
  }
}