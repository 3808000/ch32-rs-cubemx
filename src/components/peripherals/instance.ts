// 外设实例查找与激活引脚推导（PeripheralConfigCard / PeripheralWorkspaceView 共用）。
// 纯视图模型：只读取 peripherals.json 数据，不引入 store 或 IO。
import type { AdcChannel, ParamSpec, PeripheralsData } from '@/model/types'
import { modesOf, type PeripheralMode } from './modes'

export type PeriKind = 'usart' | 'spi' | 'i2c' | 'adc'

/** 各类别激活时自动分配的核心角色（ADC 不自动分配）。 */
export const CORE_ROLES: Record<PeriKind, string[]> = {
  usart: ['tx', 'rx'],
  spi: ['sck', 'mosi', 'miso'],
  i2c: ['scl', 'sda'],
  adc: [],
}

/** 数据层 remap 行里可能出现的角色键（用于规整为 role → pin）。 */
export const ROLE_KEYS: Record<PeriKind, string[]> = {
  usart: ['tx', 'rx', 'cts', 'rts', 'ck'],
  spi: ['sck', 'mosi', 'miso', 'nss'],
  i2c: ['scl', 'sda'],
  adc: [],
}

export interface RoleMap {
  remap: number
  roles: Record<string, string> // role → pin
}

export interface InstanceInfo {
  id: string
  kind: PeriKind
  categoryLabel: string
  remaps: RoleMap[]
  params: Record<string, ParamSpec>
  channels: AdcChannel[]
  modes: PeripheralMode[]
}

const KIND_CATEGORY_LABEL: Record<PeriKind, string> = {
  usart: 'Connectivity',
  spi: 'Connectivity',
  i2c: 'Connectivity',
  adc: 'Analog',
}

/** 把数据层的 remap 行（接口类型，无索引签名）规整为 role → pin 映射。 */
export function rolesOf(entry: object, keys: string[]): Record<string, string> {
  const rec = entry as Record<string, string | undefined>
  const out: Record<string, string> = {}
  for (const k of keys) if (rec[k]) out[k] = rec[k]
  return out
}

/** 按 id 在 USART/SPI/I2C/ADC 实例表中查找；定时器等仅展示实例返回 null。 */
export function findPeripheralInstance(data: PeripheralsData, id: string): InstanceInfo | null {
  const usart = data.usart.find((i) => i.id === id)
  if (usart) {
    return {
      id: usart.id,
      kind: 'usart',
      categoryLabel: KIND_CATEGORY_LABEL.usart,
      remaps: usart.remaps.map((r) => ({ remap: r.remap, roles: rolesOf(r, ROLE_KEYS.usart) })),
      params: usart.params,
      channels: [],
      modes: modesOf(usart),
    }
  }
  const spi = data.spi.find((i) => i.id === id)
  if (spi) {
    return {
      id: spi.id,
      kind: 'spi',
      categoryLabel: KIND_CATEGORY_LABEL.spi,
      remaps: spi.remaps.map((r) => ({ remap: r.remap, roles: rolesOf(r, ROLE_KEYS.spi) })),
      params: spi.params,
      channels: [],
      modes: modesOf(spi),
    }
  }
  const i2c = data.i2c.find((i) => i.id === id)
  if (i2c) {
    return {
      id: i2c.id,
      kind: 'i2c',
      categoryLabel: KIND_CATEGORY_LABEL.i2c,
      remaps: i2c.remaps.map((r) => ({ remap: r.remap, roles: rolesOf(r, ROLE_KEYS.i2c) })),
      params: i2c.params,
      channels: [],
      modes: modesOf(i2c),
    }
  }
  const adc = data.adc.find((i) => i.id === id)
  if (adc) {
    return {
      id: adc.id,
      kind: 'adc',
      categoryLabel: KIND_CATEGORY_LABEL.adc,
      remaps: [],
      params: adc.params,
      channels: adc.channels,
      modes: modesOf(adc),
    }
  }
  return null
}

/** PeripheralConfigCard 通过 defineExpose 暴露的激活/停用 API（供工作区页头调用）。 */
export interface PeripheralConfigCardApi {
  activate(modeId?: string): Promise<void>
  /** confirmEachPin=false 供已自带确认对话框的工作区使用，避免逐引脚重复确认。 */
  deactivate(releasePins?: boolean, confirmEachPin?: boolean): Promise<void>
  setActive(active: boolean): Promise<void>
}

export interface ActivationPin {
  role: string
  pin: string
  signal: string
}

/**
 * 激活外设时按当前 remap 档推导待分配的核心 AF 引脚（ADC 不自动分配）。
 * roleKeys 缺省按类别核心角色；传入 mode 的 pins 可只分配该 mode 需要的引脚。
 * 纯函数，便于单测；实际写入仍由调用方逐个走覆盖确认。
 */
export function planActivationPins(
  kind: PeriKind,
  id: string,
  roles: Record<string, string>,
  roleKeys: string[] = CORE_ROLES[kind],
): ActivationPin[] {
  if (kind === 'adc') return []
  const out: ActivationPin[] = []
  for (const role of roleKeys) {
    const pin = roles[role]
    if (pin) out.push({ role, pin, signal: `${id}_${role.toUpperCase()}` })
  }
  return out
}