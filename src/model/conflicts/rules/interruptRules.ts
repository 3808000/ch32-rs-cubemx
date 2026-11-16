// 中断规则（M3 NVIC/PFIC）：
// 1) IRQ 名不在芯片中断表 → error（导出会被阻止）；
// 2) 多条启用中断使用相同优先级 → warning（同优先级之间不能互相抢占）；
// 3) embassy 异步外设所需 IRQ 未显式启用 → warning（驱动会自行使能，但不会设置优先级）。
import { categoryOfPeripheral } from '@/model/device'
import type { Conflict } from '@/model/types'
import type { ConflictContext } from './context'

/**
 * 中断规则新增的冲突代码。ConflictCode 是共享闭合联合，本域不修改共享类型文件
 * （并行子代理分域约束）；运行时 code 仍是字符串，UI/报告按字符串展示不受影响。
 */
type IrqConflictCode = 'IRQ_UNKNOWN' | 'IRQ_PRIORITY_DUPLICATE' | 'IRQ_EMBASSY_NOT_ENABLED'

function pushIrq(ctx: ConflictContext, code: IrqConflictCode, level: Conflict['level'], message: string, peripheral?: string): void {
  ctx.push({ code: code as Conflict['code'], level, message, peripheral })
}

export function runInterruptRules(ctx: ConflictContext): void {
  const { config, data, peripherals } = ctx
  const entries = config.interrupts ?? []
  // 按大小写不敏感匹配：PAC 枚举全大写，而数据层个别芯片（H417）保留 WakeUP/Alarm 写法
  const known = new Set(data.interrupts.irqs.map((i) => i.name.toUpperCase()))

  // ---- 1. 未知 IRQ ----
  for (const e of entries) {
    if (typeof e.irq !== 'string' || !known.has(e.irq.toUpperCase())) {
      pushIrq(
        ctx,
        'IRQ_UNKNOWN',
        'error',
        `中断 ${String(e.irq)} 不在 ${data.chip.chip} 的中断表中，无法生成 NVIC 配置`,
      )
    }
  }

  // ---- 2. 启用中断的优先级重复 ----
  const byPriority = new Map<number, string[]>()
  for (const e of entries) {
    if (!e.enabled || typeof e.irq !== 'string' || !known.has(e.irq.toUpperCase())) continue
    if (typeof e.priority !== 'number' || !Number.isFinite(e.priority)) continue
    const names = byPriority.get(e.priority) ?? []
    names.push(e.irq)
    byPriority.set(e.priority, names)
  }
  for (const [priority, names] of [...byPriority.entries()].sort((a, b) => a[0] - b[0])) {
    if (names.length > 1) {
      pushIrq(
        ctx,
        'IRQ_PRIORITY_DUPLICATE',
        'warning',
        `中断 ${names.join('、')} 使用相同优先级 P${priority}，彼此无法抢占（建议分配不同优先级）`,
      )
    }
  }

  // ---- 3. embassy 异步外设所需的 IRQ 未启用 ----
  // 与 derive.ts 的 embassy 生成期检查保持一致：USART 单中断、I2C 的 EV/ER 双中断。
  if (config.features?.embassy) {
    const enabled = new Set(
      entries
        .filter((e) => e.enabled && typeof e.irq === 'string')
        .map((e) => e.irq.toUpperCase()),
    )
    const required = new Map<string, string>() // IRQ 名 → 外设 id
    for (const [id, state] of Object.entries(peripherals)) {
      if (!state.enabled) continue
      const cat = categoryOfPeripheral(id)
      if (cat === 'usart') required.set(id, id)
      else if (cat === 'i2c') {
        required.set(`${id}_EV`, id)
        required.set(`${id}_ER`, id)
      }
    }
    for (const [irq, peripheral] of required) {
      // 芯片中断表里没有该 IRQ 时由 generationErrors 报 error，这里不重复
      if (!known.has(irq.toUpperCase()) || enabled.has(irq.toUpperCase())) continue
      pushIrq(
        ctx,
        'IRQ_EMBASSY_NOT_ENABLED',
        'warning',
        `embassy 异步 ${peripheral} 需要中断 ${irq}：NVIC 面板未启用（HAL 驱动会自动使能，但不会设置优先级，建议显式启用）`,
        peripheral,
      )
    }
  }
}