// 芯片/目标级规则：target 不支持的特性拦截 / SRAM 预算粗估。
import { categoryOfPeripheral } from '@/model/device'
import type { ConflictContext } from './context'

function parseSizeKb(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([KM])?/i.exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  return (m[2]?.toUpperCase() === 'M' ? n * 1024 : n) * 1024
}

export function runDeviceRules(ctx: ConflictContext): void {
  const { config, data, pins, peripherals, push } = ctx

  // ---- 目标特性支持 ----
  const unsupported = data.chip.unsupportedFeatures ?? []
  if (config.features?.embassy && unsupported.includes('embassy')) {
    push({ code: 'TARGET_FEATURE_UNSUPPORTED', level: 'error', message: `${data.chip.chip} 的 target 不支持 embassy` })
  }

  // ---- SRAM 预算粗估 ----
  const sramBytes = parseSizeKb(data.chip.sram)
  if (sramBytes > 0) {
    let used = 256 // 栈/静态基础
    if (config.features?.embassy) used += 1024
    for (const [id, state] of Object.entries(peripherals)) {
      if (!state.enabled) continue
      const cat = categoryOfPeripheral(id)
      if (cat === 'adc') used += 64
      else if (cat !== 'other') used += 128
    }
    used += pins.filter((p) => p.params.exti?.enabled).length * 32
    if (used > sramBytes) {
      push({ code: 'SRAM_BUDGET_EXCEEDED', level: 'warning', message: `启用模块粗估 RAM ${used}B 超过芯片 SRAM ${sramBytes}B（${data.chip.sram}），建议精简外设或关闭 embassy` })
    }
  }
}