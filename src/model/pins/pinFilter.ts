// 引脚统一过滤与状态模型（M2）：图形/表格/详情共用的单一真相。
// 纯函数、无 UI 依赖。搜索语义是「过滤引脚集合」而非「过滤已配置集合」。
import type { ChipPin, Conflict, PinAssignment } from '@/model/types'
import { pinColors } from '@/model/package'

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

/** 搜索类型下拉选项（工具栏渲染用，保证与 PinSearchType 同步）。 */
export const PIN_SEARCH_TYPE_META: { id: PinSearchType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pin', label: 'Pin' },
  { id: 'signal', label: 'Signal' },
  { id: 'label', label: 'Label' },
  { id: 'position', label: 'Position' },
]

/** 九态中文标签查询（表格/图例/悬停共用，未知态回退 id）。 */
export function pinStateLabel(state: PinStateId): string {
  return PIN_STATE_META.find((m) => m.id === state)?.label ?? state
}

/** 引脚状态色块（图形/表格状态点/图例共用同一组颜色）。 */
export interface PinStateColor {
  bg: string
  fg: string
  border: string
}

/**
 * 状态 → 配色。
 * 已配置态按模式细分：AF/ANALOG 沿用蓝色（与既有封装图一致），GPIO 用绿色；
 * 图例「已配置」色块用绿/蓝双色渐变，因此图形、表格、悬停、图例仍然同源。
 */
const PIN_STATE_COLORS: Record<PinStateId, PinStateColor> = {
  configured: pinColors('gpio'),
  reserved: { bg: '#FFF2CC', fg: '#8A6100', border: '#EFD48F' },
  unassigned: pinColors('unassigned'),
  notConfigurable: pinColors('power'),
  pinned: { bg: '#EEE7FA', fg: '#5B3FA0', border: '#D3C2EF' },
  excluded: { bg: '#E7EAEE', fg: '#475467', border: '#C4CAD3' },
  error: pinColors('conflict'),
  warning: { bg: '#FFF4E5', fg: '#A85400', border: '#F2C98F' },
}

/** 取状态色；configured 可按 GPIO / AF(ANALOG) 细分。 */
export function pinStateColors(state: PinStateId, mode?: PinAssignment['mode']): PinStateColor {
  if (state === 'configured') return mode === 'AF' || mode === 'ANALOG' ? pinColors('af') : PIN_STATE_COLORS.configured
  return PIN_STATE_COLORS[state]
}

/** 派生每引脚状态所需的来源集合（由调用方从 store 预计算）。 */
export interface PinStateSources {
  assignments: Iterable<PinAssignment>
  /** 已启用外设（derivePeripheralUsage）占用的 AF/ANALOG 引脚 */
  reservedPins?: Iterable<string>
  pinnedPins?: Iterable<string>
  excludedPins?: Iterable<string>
  errorPins?: Iterable<string>
  warningPins?: Iterable<string>
}

/** 批量派生引脚状态：返回 `引脚名 → 状态`（图形/表格/计数共用的单一真相）。 */
export function derivePinStates(pins: ChipPin[], src: PinStateSources): Record<string, PinStateId> {
  const assignmentMap = new Map<string, PinAssignment>()
  for (const a of src.assignments) assignmentMap.set(a.pin, a)
  const toSet = (it: Iterable<string> | undefined) => new Set(it ?? [])
  const reserved = toSet(src.reservedPins)
  const pinned = toSet(src.pinnedPins)
  const excluded = toSet(src.excludedPins)
  const errors = toSet(src.errorPins)
  const warnings = toSet(src.warningPins)

  const out: Record<string, PinStateId> = {}
  for (const pin of pins) {
    out[pin.name] = derivePinState(pin, {
      assignment: assignmentMap.get(pin.name),
      reserved: reserved.has(pin.name),
      pinned: pinned.has(pin.name),
      excluded: excluded.has(pin.name),
      hasError: errors.has(pin.name),
      hasWarning: warnings.has(pin.name),
    })
  }
  return out
}

/** 从冲突列表归集 error/warning 引脚；同一引脚多级别时两侧都保留（derivePinState 内 error 优先）。 */
export function conflictPinSets(conflicts: Iterable<Conflict>): { errors: Set<string>; warnings: Set<string> } {
  const errors = new Set<string>()
  const warnings = new Set<string>()
  for (const c of conflicts) {
    const target = c.level === 'error' ? errors : warnings
    for (const p of c.pins ?? []) target.add(p)
  }
  return { errors, warnings }
}

/** 各状态实时计数（键覆盖 PIN_STATE_META 全部状态，未出现的状态为 0）。 */
export function countPinStates(pins: ChipPin[], states: Record<string, PinStateId>): Record<PinStateId, number> {
  const out = {} as Record<PinStateId, number>
  for (const m of PIN_STATE_META) out[m.id] = 0
  for (const pin of pins) {
    const state = states[pin.name]
    if (state) out[state] += 1
  }
  return out
}

/** 组合过滤：搜索（名称/信号/标签/位置）+ Show 状态 + Type 类型。图形/表格共用。 */
export function pinMatchesFilter(
  pin: ChipPin,
  assignment: PinAssignment | undefined,
  state: PinStateId,
  filter: PinFilter,
): boolean {
  return pinMatchesSearch(pin, assignment, filter) && pinMatchesFacets(pin, state, filter)
}

/** 搜索建议项：引脚名 + 物理位置 + 附加信息（标签/功能）。 */
export interface PinSuggestion {
  pin: string
  number: number
  detail: string
}

/** 生成搜索建议（空文本返回空；最多 limit 条，用于工具栏下拉定位）。 */
export function buildPinSuggestions(
  pins: ChipPin[],
  assignmentOf: (pin: string) => PinAssignment | undefined,
  filter: PinFilter,
  limit = 8,
): PinSuggestion[] {
  if (!filter.text.trim()) return []
  const out: PinSuggestion[] = []
  for (const pin of pins) {
    const assignment = assignmentOf(pin.name)
    if (!pinMatchesSearch(pin, assignment, filter)) continue
    const detail = [assignment?.label, assignment?.function].filter(Boolean).join(' · ')
    out.push({ pin: pin.name, number: pin.number, detail })
    if (out.length >= limit) break
  }
  return out
}
