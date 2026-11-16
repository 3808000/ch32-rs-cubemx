// irq.rs 渲染：按 cube.json 的 interrupts 生成 PFIC 中断使能与优先级设置。
// HAL 签名核对（reference/ch32-hal/src/interrupt_ext.rs）：
//   unsafe fn enable(self)；fn set_priority(self, prio: Priority)；
//   Priority 由 qingke::interrupt 重导出，变体 P0..P15。
import type { DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { render } from './render'
import { IRQ_TPL } from './templates/irqRs'

export interface IrqItem {
  /** 数据层 IRQ 名（cube.json 里使用，如 USART1 / USBPDWakeUP） */
  irq: string
  /** 目标芯片 PAC 的 Interrupt 枚举变体名（全大写，如 USBPDWAKEUP） */
  pac: string
  number: number
  priority: number
}

/** 优先级夹取到 PFIC 支持的 0..15；非整数取整，非法值回落 P0。 */
export function clampIrqPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 0
  return Math.max(0, Math.min(15, Math.trunc(priority)))
}

/**
 * 解析出应写入 irq.rs 的中断项：
 * - 只保留 enabled=true；
 * - 只保留 data.interrupts.irqs 中存在的 IRQ（目标芯片向量表）；
 * - PAC 枚举名取数据层 IRQ 名的大写形式。已逐芯片核对 ch32-metapac 的 Interrupt 枚举：
 *   V003/V203 的 JSON 名本身全大写；H417 的 WakeUP/Alarm 等在 PAC 中为全大写
 *   （USBPDWakeUP → USBPDWAKEUP、RTCAlarm → RTCALARM），且 IRQ 编号一致。
 * 按 IRQ 号排序，保证重新导出逐字节稳定。
 */
export function enabledIrqs(config: ProjectConfig, data: DeviceData): IrqItem[] {
  const table = new Map(data.interrupts.irqs.map((i) => [i.name.toUpperCase(), i]))
  const out: IrqItem[] = []
  const seen = new Set<string>()
  for (const cfg of config.interrupts ?? []) {
    if (!cfg || cfg.enabled !== true || typeof cfg.irq !== 'string') continue
    const key = cfg.irq.toUpperCase()
    if (seen.has(key)) continue
    const entry = table.get(key)
    if (!entry) continue
    seen.add(key)
    out.push({
      irq: entry.name,
      pac: key,
      number: entry.number,
      priority: clampIrqPriority(cfg.priority),
    })
  }
  return out.sort((a, b) => a.number - b.number || a.pac.localeCompare(b.pac))
}

/** 有启用中断时生成 src/generated/irq.rs；否则返回 null（不生成该文件）。 */
export function renderIrq(config: ProjectConfig, data: DeviceData, base = ''): GeneratedFile | null {
  const items = enabledIrqs(config, data)
  if (items.length === 0) return null
  return {
    path: `${base}src/generated/irq.rs`,
    content: render(IRQ_TPL, { items }),
  }
}