// 生成前检查（M3.7）：复用 checkConflicts + validateClock，把问题统一分级并附带可定位目标。
// target 是视图无关的描述（view/peripheral/pin/node），由 CheckDialog 负责转成 store 导航。
import { defaultClock, validateClock } from '@/model/clock'
import { checkConflicts } from '@/model/conflicts'
import type { Conflict, DeviceData, ProjectConfig } from '@/model/types'

/** 可定位视图（与 controllers/project 的 ViewId 对齐；model 层不直接依赖 controllers）。 */
export type PreflightView = 'pinout' | 'clock' | 'peripherals' | 'project-settings'

/** 问题定位目标：view 必填，其余按问题类型携带。 */
export interface PreflightTarget {
  view: PreflightView
  /** 目标外设实例 id（如 USART1） */
  peripheral?: string
  /** 目标引脚名（如 PD5） */
  pin?: string
  /** 目标时钟树节点 id（如 PLL / AHB / ADC） */
  node?: string
}

export interface PreflightItem {
  /** 冲突规则代码或时钟检查代码（CLOCK_WARNING 等） */
  code: string
  level: 'error' | 'warning'
  message: string
  target: PreflightTarget
}

export interface PreflightReport {
  errors: PreflightItem[]
  warnings: PreflightItem[]
}

/** 冲突 → 定位目标：时钟规则定位 Clock，外设规则定位 Peripherals，引脚规则定位 Pinout。 */
function conflictTarget(c: Conflict): PreflightTarget {
  if (c.code === 'PERIPHERAL_CLOCK_INVALID' || c.code === 'CLOCK_PRESET_UNAVAILABLE' || c.code === 'CLOCK_DISPLAY_ONLY_SOURCE')
    return { view: 'clock' }
  if (c.code === 'TARGET_FEATURE_UNSUPPORTED' || c.code === 'SRAM_BUDGET_EXCEEDED') return { view: 'project-settings' }
  if (c.peripheral) {
    return { view: 'peripherals', peripheral: c.peripheral, ...(c.pins?.[0] ? { pin: c.pins[0] } : {}) }
  }
  if (c.pins?.[0]) return { view: 'pinout', pin: c.pins[0] }
  // DMA 通道冲突无引脚/外设上下文，打开 Peripherals（NVIC/DMA 面板所在视图）
  if (c.code === 'DMA_CHANNEL_CONFLICT') return { view: 'peripherals' }
  return { view: 'pinout' }
}

/**
 * 生成前检查：返回 errors / warnings 分级列表。
 * - 引脚/外设/DMA/芯片规则来自 checkConflicts；
 * - 时钟合法性直接调用 validateClock 逐节点重建，避免与 checkConflicts 的时钟错误重复，
 *   同时获得 node 定位与 warning 级问题（如 ADC 超建议上限）。
 */
export function preflight(config: ProjectConfig, data: DeviceData): PreflightReport {
  const errors: PreflightItem[] = []
  const warnings: PreflightItem[] = []
  const push = (item: PreflightItem) => (item.level === 'error' ? errors : warnings).push(item)

  for (const c of checkConflicts(config, data, config.unlockedPins ?? [])) {
    // 时钟错误的 node 定位由下方 validateClock 统一生成，跳过冲突层重复项
    if (c.code === 'PERIPHERAL_CLOCK_INVALID') continue
    push({ code: c.code, level: c.level, message: c.message, target: conflictTarget(c) })
  }

  const clockCfg = config.clock ?? defaultClock(data.clock)
  for (const issue of validateClock(data.clock, clockCfg)) {
    push({
      code: issue.level === 'error' ? 'PERIPHERAL_CLOCK_INVALID' : 'CLOCK_WARNING',
      level: issue.level,
      message: issue.message,
      target: { view: 'clock', node: issue.node },
    })
  }

  return { errors, warnings }
}

/** 是否存在阻止导出的错误（供 UI 判断按钮状态）。 */
export function preflightBlocked(report: PreflightReport): boolean {
  return report.errors.length > 0
}