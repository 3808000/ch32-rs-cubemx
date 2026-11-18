// UI 偏好持久化服务（M5）：localStorage 单槽 JSON，按视图/面板 key 存取。
// - getPreference / getPreferences：读取有效值（缺失、损坏、类型不符时回退默认值）
// - setPreference：校验后写回并通知订阅者
// - subscribe / subscribePreference：订阅偏好变化，返回取消函数
// 依赖方向：services 层不 import Vue/Pinia/组件；localStorage 不可用时静默降级，不影响主流程。

export const UI_PREF_STORAGE_KEY = 'ch32-rs-cubemx:ui-prefs'

/** 引脚表全部列（默认全可见；顺序即渲染顺序，对齐 PinTable 的 12 列）。 */
export const PIN_TABLE_COLUMNS = [
  'number',
  'name',
  'type',
  'state',
  'side',
  'mode',
  'function',
  'remap',
  'label',
  'signals',
  'special',
  'assign',
] as const
export type PinTableColumn = (typeof PIN_TABLE_COLUMNS)[number]

/** 引脚表可选页大小（默认 25，与 PinTable 的分页下拉对齐）。 */
export const PIN_TABLE_PAGE_SIZES = [25, 50, 100] as const
export type PinTablePageSize = (typeof PIN_TABLE_PAGE_SIZES)[number]

/** 问题/通知抽屉的标签。 */
export type InboxTab = 'problems' | 'notifications'

/**
 * UI 偏好表：按视图/面板分组，key 使用点分命名。
 * 面板宽度默认值与 src/styles/tokens.css 的 --mx-detail-panel-w / --mx-code-preview-w 对齐。
 */
export interface UiPreferences {
  'pinout.detailVisible': boolean
  'pinout.codeVisible': boolean
  'pinout.detailWidth': number
  'pinout.codeWidth': number
  'pinout.legendCollapsed': boolean
  'pinout.table.pageSize': number
  'pinout.table.visibleColumns': string[]
  'pinout.table.usedOnly': boolean
  'clock.detailVisible': boolean
  'clock.codeVisible': boolean
  'clock.detailWidth': number
  'clock.codeWidth': number
  /** Reset clock 确认对话框「不再询问」（M15）：为 true 时直接重置 */
  'clock.resetConfirmSkip': boolean
  'peripherals.codeVisible': boolean
  'peripherals.codeWidth': number
  'inbox.tab': InboxTab
  'tabs.healthBadges': boolean
  'notifications.lastReadId': number | null
}

export type UiPrefKey = keyof UiPreferences
export type UiPrefValue<K extends UiPrefKey> = UiPreferences[K]

export const UI_PREF_DEFAULTS: UiPreferences = {
  'pinout.detailVisible': true,
  'pinout.codeVisible': false,
  'pinout.detailWidth': 360,
  'pinout.codeWidth': 480,
  'pinout.legendCollapsed': false,
  'pinout.table.pageSize': 25,
  'pinout.table.visibleColumns': [...PIN_TABLE_COLUMNS],
  'pinout.table.usedOnly': false,
  'clock.detailVisible': true,
  'clock.codeVisible': false,
  'clock.detailWidth': 360,
  'clock.codeWidth': 480,
  'clock.resetConfirmSkip': false,
  'peripherals.codeVisible': false,
  'peripherals.codeWidth': 480,
  'inbox.tab': 'problems',
  'tabs.healthBadges': true,
  'notifications.lastReadId': null,
}

const PREF_KEYS = Object.keys(UI_PREF_DEFAULTS) as UiPrefKey[]

/** 读取整槽原始 JSON；不存在/损坏/非对象时返回空表（未知 key 保留，写回时原样带回）。 */
function readStored(): Record<string, unknown> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(UI_PREF_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 值是否符合对应 key 的类型/范围约束（用于过滤损坏或被手改的 localStorage 数据）。 */
function isValidValue(key: UiPrefKey, value: unknown): boolean {
  switch (key) {
    // ---- 布尔开关 ----
    case 'pinout.detailVisible':
    case 'pinout.codeVisible':
    case 'pinout.legendCollapsed':
    case 'pinout.table.usedOnly':
    case 'clock.detailVisible':
    case 'clock.codeVisible':
    case 'clock.resetConfirmSkip':
    case 'peripherals.codeVisible':
    case 'tabs.healthBadges':
      return typeof value === 'boolean'
    // ---- 面板宽度（正有限数；具体 min/max 由面板自身夹取） ----
    case 'pinout.detailWidth':
    case 'pinout.codeWidth':
    case 'clock.detailWidth':
    case 'clock.codeWidth':
    case 'peripherals.codeWidth':
      return typeof value === 'number' && Number.isFinite(value) && value > 0
    // ---- 引脚表分页（只接受 PinTable 提供的档位） ----
    case 'pinout.table.pageSize':
      return typeof value === 'number' && (PIN_TABLE_PAGE_SIZES as readonly number[]).includes(value)
    // ---- 列可见性（非空、无重复、全部是已知列名） ----
    case 'pinout.table.visibleColumns':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          (v): v is string => typeof v === 'string' && (PIN_TABLE_COLUMNS as readonly string[]).includes(v),
        ) &&
        new Set(value).size === value.length
      )
    // ---- 抽屉标签 ----
    case 'inbox.tab':
      return value === 'problems' || value === 'notifications'
    // ---- 通知已读水位（null = 全部未读） ----
    case 'notifications.lastReadId':
      return value === null || (typeof value === 'number' && Number.isFinite(value))
  }
  return false
}

/** 复制数组值，避免调用方修改返回值时污染默认偏好。 */
function cloneValue<K extends UiPrefKey>(value: UiPrefValue<K>): UiPrefValue<K> {
  return (Array.isArray(value) ? [...value] : value) as UiPrefValue<K>
}

/** 读取单个偏好；存储缺失/非法时回退默认值（数组返回副本）。 */
export function getPreference<K extends UiPrefKey>(key: K): UiPrefValue<K> {
  const stored = readStored()
  const value = stored[key]
  if (isValidValue(key, value)) return cloneValue(value as UiPrefValue<K>)
  return cloneValue(UI_PREF_DEFAULTS[key])
}

/** 读取全部偏好（已合并默认值；未知 key 不返回）。 */
export function getPreferences(): UiPreferences {
  const stored = readStored()
  const out = {} as Record<UiPrefKey, unknown>
  for (const key of PREF_KEYS) {
    const value = stored[key]
    const valid = isValidValue(key, value) ? (value as UiPrefValue<UiPrefKey>) : UI_PREF_DEFAULTS[key]
    out[key] = Array.isArray(valid) ? [...valid] : valid
  }
  return out as UiPreferences
}

/** 偏好变化监听器：收到变更 key、新值与写入后的完整偏好快照。 */
export type UiPreferenceListener = (
  key: UiPrefKey,
  value: UiPrefValue<UiPrefKey>,
  preferences: UiPreferences,
) => void

const listeners = new Set<UiPreferenceListener>()

/**
 * 订阅偏好变化，返回取消函数。
 * 监听器在 localStorage 写入后同步调用；通知期间取消订阅不会影响本轮遍历。
 */
export function subscribe(listener: UiPreferenceListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 只订阅指定 key 的变化（比 subscribe 手动过滤更方便）。 */
export function subscribePreference<K extends UiPrefKey>(
  key: K,
  listener: (value: UiPrefValue<K>, preferences: UiPreferences) => void,
): () => void {
  return subscribe((changedKey, value, preferences) => {
    if (changedKey === key) listener(value as UiPrefValue<K>, preferences)
  })
}

/**
 * 写入单个偏好并通知订阅者。
 * 值非法时抛 TypeError（调用方类型错误应尽早暴露）；localStorage 写入失败（隐私模式/配额满）
 * 不阻塞当前会话，仍通知订阅者以保持 UI 一致。
 */
export function setPreference<K extends UiPrefKey>(key: K, value: UiPrefValue<K>): void {
  if (!isValidValue(key, value)) {
    throw new TypeError(`无效的 UI 偏好值：${key}`)
  }
  const stored = readStored()
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UI_PREF_STORAGE_KEY, JSON.stringify({ ...stored, [key]: value }))
    }
  } catch {
    // 存储不可用：静默失败，不阻塞主流程。
  }
  const preferences = getPreferences()
  for (const listener of [...listeners]) listener(key, value, preferences)
}

/** 恢复全部默认值：删除存储槽，并按 key 通知订阅者。 */
export function resetPreferences(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(UI_PREF_STORAGE_KEY)
  } catch {
    // 忽略存储异常
  }
  const preferences = getPreferences()
  for (const key of PREF_KEYS) {
    for (const listener of [...listeners]) listener(key, UI_PREF_DEFAULTS[key], preferences)
  }
}