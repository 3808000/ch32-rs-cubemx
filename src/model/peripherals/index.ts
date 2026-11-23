// 外设实例推导：从 AF/ANALOG 引脚配置 + 显式启用状态归并出外设使用情况。
// 契约：derivePeripheralUsage(config, data) → PeripheralUsage[]（codegen 与 UI 共用）。
import type { DeviceData, PeripheralState, ProjectConfig } from '@/model/types'
import { categoryOfPeripheral } from '@/model/device'

export interface PeripheralPinUsage {
  role: string // 'tx' | 'rx' | 'sck' | ... | 'ADC_IN0'
  pin: string
  signal: string
}

export interface PeripheralUsage {
  id: string
  category: 'usart' | 'spi' | 'i2c' | 'adc'
  enabled: boolean
  remap: number | null
  pins: PeripheralPinUsage[]
  params: Record<string, string | number | boolean>
}

function mergeParams(defaults: Record<string, { default: string | number | boolean }>, override?: PeripheralState): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(defaults)) out[k] = v.default
  if (override?.params) Object.assign(out, override.params)
  return out
}

/** 从引脚配置推导各外设实例的启用状态、remap、引脚与参数。 */
export function derivePeripheralUsage(config: ProjectConfig, data: DeviceData): PeripheralUsage[] {
  const out: PeripheralUsage[] = []
  const pins = config.pins ?? []
  const periState = config.peripherals ?? {}

  // USART
  for (const inst of data.peripherals.usart) {
    const af = pins.filter((p) => p.mode === 'AF' && p.function?.startsWith(`${inst.id}_`))
    const state = periState[inst.id]
    const enabled = af.length > 0 || !!state?.enabled
    const roles = ['tx', 'rx', 'cts', 'rts', 'ck'] as const
    const pinUsage: PeripheralPinUsage[] = []
    for (const role of roles) {
      const sig = `${inst.id}_${role.toUpperCase()}`
      const a = af.find((x) => x.function === sig)
      if (a) pinUsage.push({ role, pin: a.pin, signal: sig })
    }
    // remap：显式指定 > 引脚公共档 > 第一档
    let remap: number | null = state?.remap ?? null
    if (remap === null && pinUsage.length > 0) {
      const sets = pinUsage.map((u) => {
        const r = u.role as (typeof roles)[number]
        return new Set(inst.remaps.filter((x) => x[r] === u.pin).map((x) => x.remap))
      })
      const common = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))))
      remap = common.size > 0 ? Math.min(...common) : inst.remaps[0]?.remap ?? 0
    }
    if (remap === null) remap = inst.remaps[0]?.remap ?? 0
    out.push({ id: inst.id, category: 'usart', enabled, remap, pins: pinUsage, params: mergeParams(inst.params, state) })
  }

  // SPI
  for (const inst of data.peripherals.spi) {
    const af = pins.filter((p) => p.mode === 'AF' && p.function?.startsWith(`${inst.id}_`))
    const state = periState[inst.id]
    const enabled = af.length > 0 || !!state?.enabled
    const roles = ['sck', 'mosi', 'miso', 'nss'] as const
    const pinUsage: PeripheralPinUsage[] = []
    for (const role of roles) {
      const sig = `${inst.id}_${role.toUpperCase()}`
      const a = af.find((x) => x.function === sig)
      if (a) pinUsage.push({ role, pin: a.pin, signal: sig })
    }
    let remap: number | null = state?.remap ?? null
    if (remap === null && pinUsage.length > 0) {
      const sets = pinUsage.map((u) => {
        const r = u.role as (typeof roles)[number]
        return new Set(inst.remaps.filter((x) => x[r] === u.pin).map((x) => x.remap))
      })
      const common = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))))
      remap = common.size > 0 ? Math.min(...common) : inst.remaps[0]?.remap ?? 0
    }
    if (remap === null) remap = inst.remaps[0]?.remap ?? 0
    out.push({ id: inst.id, category: 'spi', enabled, remap, pins: pinUsage, params: mergeParams(inst.params, state) })
  }

  // I2C
  for (const inst of data.peripherals.i2c) {
    const af = pins.filter((p) => p.mode === 'AF' && p.function?.startsWith(`${inst.id}_`))
    const state = periState[inst.id]
    const enabled = af.length > 0 || !!state?.enabled
    const roles = ['scl', 'sda'] as const
    const pinUsage: PeripheralPinUsage[] = []
    for (const role of roles) {
      const sig = `${inst.id}_${role.toUpperCase()}`
      const a = af.find((x) => x.function === sig)
      if (a) pinUsage.push({ role, pin: a.pin, signal: sig })
    }
    let remap: number | null = state?.remap ?? null
    if (remap === null && pinUsage.length > 0) {
      const sets = pinUsage.map((u) => {
        const r = u.role as (typeof roles)[number]
        return new Set(inst.remaps.filter((x) => x[r] === u.pin).map((x) => x.remap))
      })
      const common = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))))
      remap = common.size > 0 ? Math.min(...common) : inst.remaps[0]?.remap ?? 0
    }
    if (remap === null) remap = inst.remaps[0]?.remap ?? 0
    out.push({ id: inst.id, category: 'i2c', enabled, remap, pins: pinUsage, params: mergeParams(inst.params, state) })
  }

  // ADC：ANALOG 引脚推导。
  // 双 ADC 芯片（如 V203 的 ADC1/ADC2）多个实例可能共享同一通道引脚；
  // Rust 单例语义下一次只能被一个 Adc 结构持有，故按实例顺序单归属（先到先得）。
  const claimedAnalogPins = new Set<string>()
  for (const inst of data.peripherals.adc) {
    const analog = pins.filter(
      (p) =>
        p.mode === 'ANALOG' &&
        p.function &&
        inst.channels.some((c) => c.channel === p.function) &&
        !claimedAnalogPins.has(p.pin),
    )
    const state = periState[inst.id]
    const enabled = analog.length > 0 || !!state?.enabled
    const pinUsage: PeripheralPinUsage[] = analog.map((a) => {
      claimedAnalogPins.add(a.pin)
      return { role: a.function!, pin: a.pin, signal: a.function! }
    })
    out.push({ id: inst.id, category: 'adc', enabled, remap: null, pins: pinUsage, params: mergeParams(inst.params, state) })
  }

  return out
}

/** 按类别过滤已启用实例 */
export function enabledUsage(usages: PeripheralUsage[], category: PeripheralUsage['category']): PeripheralUsage[] {
  return usages.filter((u) => u.category === category && u.enabled)
}

export { categoryOfPeripheral }

/** 将生成器实际消费的启用状态和参数投影到时钟树。 */
export function peripheralClockState(usages: PeripheralUsage[]): Record<string, PeripheralState> {
  return Object.fromEntries(usages.map(({ id, enabled, params }) => [id, { enabled, params }]))
}
