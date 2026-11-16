// 外设工作模式（Mode）数据访问：peripherals.json 的 modes[] 由本模块统一解析。
// mode id 存放在 PeripheralState.params.opMode（不是 params.mode）：SPI 已用 params.mode
// 表示 CPOL/CPHA（MODE_0..MODE_3），复用会破坏现有代码生成参数。
import type { ParamSpec } from '@/model/types'

/** peripherals.json 中单个 mode 的描述（仅 UI/配置层，运行时保存在 params.opMode）。 */
export interface PeripheralMode {
  id: string
  label: string
  /** 该 mode 下可配置的参数键（对应实例 params 的键）；缺省表示全部参数。 */
  params?: string[]
  /** 该 mode 需要分配的核心引脚角色；缺省回退到外设类别的核心角色。 */
  pins?: string[]
  /** 代码生成是否已支持该 mode（缺省 true）。false 时 UI 禁止激活，避免导出不可编译的代码。 */
  codegen?: boolean
}

/** PeripheralState.params 中保存当前 mode id 的键。 */
export const MODE_PARAM_KEY = 'opMode'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

/** 读取实例上的 modes（容忍数据缺省/畸形，保持向后兼容）。 */
export function modesOf(instance: unknown): PeripheralMode[] {
  if (!isRecord(instance)) return []
  const raw = instance.modes
  if (!Array.isArray(raw)) return []
  const out: PeripheralMode[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string') continue
    const params = stringList(item.params)
    const pins = stringList(item.pins)
    const mode: PeripheralMode = { id: item.id, label: item.label }
    if (params) mode.params = params
    if (pins) mode.pins = pins
    if (item.codegen === false) mode.codegen = false
    out.push(mode)
  }
  return out
}

/** 当前 mode：params.opMode 命中优先，否则回退到第一个 mode。 */
export function selectedMode(
  modes: PeripheralMode[],
  params: Record<string, string | number | boolean> | null | undefined,
): PeripheralMode | null {
  if (modes.length === 0) return null
  const raw = params?.[MODE_PARAM_KEY]
  if (typeof raw === 'string') {
    const hit = modes.find((m) => m.id === raw)
    if (hit) return hit
  }
  return modes[0]
}

/** 按 mode 声明的参数键过滤参数表；未声明 params 时返回全部。 */
export function filterParamsForMode(
  entries: [string, ParamSpec][],
  mode: PeripheralMode | null,
): [string, ParamSpec][] {
  if (!mode?.params?.length) return entries
  const keys = new Set(mode.params)
  return entries.filter(([key]) => keys.has(key))
}

/** mode 需要的核心角色：过滤掉不属于该外设类别的键；空集回退到 fallback。 */
export function rolesForMode(mode: PeripheralMode | null, fallback: string[]): string[] {
  if (!mode?.pins?.length) return fallback
  const allowed = new Set(fallback)
  const roles = mode.pins.filter((role) => allowed.has(role))
  return roles.length > 0 ? roles : fallback
}

/** 该 mode 能否被代码生成器处理（缺省 true）。 */
export function isCodegenSupported(mode: PeripheralMode | null): boolean {
  return mode?.codegen !== false
}