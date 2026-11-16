// 引脚统一过滤与状态模型（M2）：图形/表格/详情共用的单一真相。
// 纯函数、无 UI 依赖。搜索语义是「过滤引脚集合」而非「过滤已配置集合」。
import type { ChipPin, PinAssignment } from '@/model/types'

/** 搜索类型（对齐 CubeMX2：All/Pin/Signal/Label/Position）。 */
export type PinSearchType = 'all' | 'pin' | 'signal' | 'label' | 'position'

/** 引脚九态（对齐 CubeMX2 Show 过滤）。pinned/excluded 依赖每引脚标志（M2 先以派生值呈现）。 */
export type PinStateId =
  | 'configured'
  | 'reserved'
  | 'unassigned'
  | 'notConfigurable'
  | 'pinned'
  | 'excluded'
  | 'error'
  | 'warning'

export interface PinFilter {
  searchType: PinSearchType
  text: string
  /** 选中的状态（空 = 全部） */
  states: PinStateId[]
  /** 选中的引脚类型（空 = 全部），如 IO/POWER/NC */
  types: string[]
}

export const DEFAULT_PIN_FILTER: PinFilter = { searchType: 'all', text: '', states: [], types: [] }

/** 派生单个引脚状态所需的上下文（由调用方从冲突/外设使用/引脚标志预计算）。 */
export interface PinStateContext {
  assignment?: PinAssignment
  /** 被已启用外设的 AF 需求占用 */
  reserved: boolean
  pinned: boolean
  excluded: boolean
  hasError: boolean
  hasWarning: boolean
}

/** 派生引脚状态（优先级：不可配置 > 排除 > 错误 > 警告 > 已配置 > 保留 > 图钉 > 未分配）。 */
export function derivePinState(pin: ChipPin, ctx: PinStateContext): PinStateId {
  if (pin.type !== 'IO') return 'notConfigurable'
  if (ctx.excluded) return 'excluded'
  if (ctx.hasError) return 'error'
  if (ctx.hasWarning) return 'warning'
  if (ctx.assignment) return 'configured'
  if (ctx.reserved) return 'reserved'
  if (ctx.pinned) return 'pinned'
  return 'unassigned'
}

/** 搜索匹配（大小写不敏感）。position 用引脚物理编号。 */
export function pinMatchesSearch(
  pin: ChipPin,
  assignment: PinAssignment | undefined,
  filter: PinFilter,
): boolean {
  const q = filter.text.trim().toLowerCase()
  if (!q) return true
  const has = (s: string | undefined | null) => (s ?? '').toLowerCase().includes(q)
  switch (filter.searchType) {
    case 'pin':
      return has(pin.name)
    case 'signal':
      return has(assignment?.function)
    case 'label':
      return has(assignment?.label)
    case 'position':
      return String(pin.number).includes(q)
    case 'all':
    default:
      return has(pin.name) || has(assignment?.function) || has(assignment?.label) || String(pin.number).includes(q)
  }
}

/** 状态/类型过滤（空数组 = 不过滤该维度）。 */
export function pinMatchesFacets(pin: ChipPin, state: PinStateId, filter: PinFilter): boolean {
  if (filter.states.length > 0 && !filter.states.includes(state)) return false
  if (filter.types.length > 0 && !filter.types.includes(pin.type)) return false
  return true
}

/** 九态展示顺序与中文标签（Show 下拉/图例共用）。 */
export const PIN_STATE_META: { id: PinStateId; label: string }[] = [
  { id: 'configured', label: '已配置' },
  { id: 'reserved', label: '保留' },
  { id: 'unassigned', label: '未分配' },
  { id: 'notConfigurable', label: '不可配置' },
  { id: 'pinned', label: '图钉' },
  { id: 'excluded', label: '已排除' },
  { id: 'error', label: '错误' },
  { id: 'warning', label: '警告' },
]
