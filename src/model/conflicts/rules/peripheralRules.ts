// 外设级规则：USART TX/RX 缺失 / remap 表与引脚组合校验 / 引脚被其它驱动占用（单例语义）。
import type { DeviceData } from '@/model/types'
import { categoryOfPeripheral, peripheralOfSignal } from '@/model/device'
import type { ConflictContext } from './context'

export function runPeripheralRules(ctx: ConflictContext): void {
  const { data, pins, peripherals, push } = ctx

  // ---- 外设级规则 ----
  const afByPeripheral = new Map<string, { pin: string; signal: string; remap?: number }[]>()
  for (const a of pins) {
    if (a.mode !== 'AF' || !a.function) continue
    const peri = peripheralOfSignal(a.function)
    if (!peri) continue
    const arr = afByPeripheral.get(peri) ?? []
    arr.push({ pin: a.pin, signal: a.function, remap: a.remap })
    afByPeripheral.set(peri, arr)
  }

  for (const [id, state] of Object.entries(peripherals)) {
    if (!state.enabled) continue
    const cat = categoryOfPeripheral(id)
    const afPins = afByPeripheral.get(id) ?? []

    if (cat === 'usart') {
      const inst = data.peripherals.usart.find((u) => u.id === id)
      const hasTx = afPins.some((p) => p.signal === `${id}_TX`)
      const hasRx = afPins.some((p) => p.signal === `${id}_RX`)
      if (!hasTx) push({ code: 'USART_TX_MISSING', level: 'warning', message: `${id} 已启用但未分配 TX 引脚`, peripheral: id })
      if (!hasRx) push({ code: 'USART_RX_MISSING', level: 'warning', message: `${id} 已启用但未分配 RX 引脚`, peripheral: id })

      // remap 表校验只适用于 PCFR 分组模型（const 泛型 REMAP 必须全组一致）。
      // per_pin_af（H4）的 AF 是每引脚独立的：合法性已由上方 remapValuesFor(pin, signal) 逐引脚校验，
      // TX/RX 可用不同 AF 号；peripherals.json 的 remaps 只是 UI 分组代表，不能用来限制组合。
      if (inst && afPins.length > 0 && data.chip.remapModel !== 'per_pin_af') {
        for (const p of afPins) {
          const sigShort = p.signal.slice(id.length + 1).toLowerCase() as 'tx' | 'rx' | 'cts' | 'rts' | 'ck'
          const candidates = inst.remaps.filter((r) => r[sigShort] === p.pin)
          if (candidates.length === 0) {
            push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${id} 的 ${p.signal} 不在 ${p.pin} 的任何 remap 档`, pins: [p.pin], peripheral: id })
          }
        }
        {
          // 取交集：每个引脚的候选 remap 集合必须有公共值
          let common: Set<number> | null = null
          for (const p of afPins) {
            const sigShort = p.signal.slice(id.length + 1).toLowerCase() as 'tx' | 'rx' | 'cts' | 'rts' | 'ck'
            const s = new Set<number>(inst.remaps.filter((r) => r[sigShort] === p.pin).map((r) => r.remap))
            if (common === null) {
              common = s
            } else {
              const prev: Set<number> = common
              common = new Set<number>([...prev].filter((x) => s.has(x)))
            }
          }
          if (common !== null && common.size === 0 && afPins.length > 1) {
            push({
              code: 'REMAP_MISMATCH',
              level: 'error',
              message: `${id} 各引脚的 remap 档无交集（${afPins.map((p) => `${p.pin}:${p.signal}`).join('、')}），Uart::new::<N> 无法同时满足`,
              pins: afPins.map((p) => p.pin),
              peripheral: id,
            })
          }
          // 用户锁定的 remap 与数据不一致
          for (const p of afPins) {
            if (p.remap !== undefined && common !== null && !common.has(p.remap)) {
              push({ code: 'REMAP_MISMATCH', level: 'error', message: `${id} 锁定 remap=${p.remap} 与引脚组合不兼容`, pins: [p.pin], peripheral: id })
            }
          }
        }
      }
    }

    // PIN_CONSUMED_TWICE：启用的外设所需引脚被其它驱动/GPIO 占用。
    // ADC 只占用实际分配为 ANALOG 的通道（未分配的通道不进生成代码，不构成单例冲突）。
    if (cat !== 'adc' && inst_pinsNeeded(data, id, state.remap)) {
      const needed = inst_pinsNeeded(data, id, state.remap)!
      for (const need of needed) {
        const a = pins.find((x) => x.pin === need.pin)
        if (!a) continue // 未配置 → 缺引脚警告已覆盖
        const ownsIt = a.mode === 'AF' && a.function === need.signal
        if (!ownsIt) {
          push({
            code: 'PIN_CONSUMED_TWICE',
            level: 'error',
            message: `${need.pin} 已被 ${a.mode}${a.function ? `/${a.function}` : ''} 占用，${id} 无法再取得该引脚（Rust 单例语义）`,
            pins: [need.pin],
            peripheral: id,
          })
        }
      }
    }
  }
}

/** 外设实例在指定 remap 下需要的引脚（未指定 remap 时取第一档）。 */
function inst_pinsNeeded(data: DeviceData, id: string, remap?: number): { pin: string; signal: string }[] | null {
  const cat = categoryOfPeripheral(id)
  if (cat === 'usart') {
    const inst = data.peripherals.usart.find((u) => u.id === id)
    const r = inst?.remaps.find((x) => x.remap === (remap ?? inst?.remaps[0]?.remap))
    return r ? [{ pin: r.tx, signal: `${id}_TX` }, { pin: r.rx, signal: `${id}_RX` }] : null
  }
  if (cat === 'spi') {
    const inst = data.peripherals.spi.find((u) => u.id === id)
    const r = inst?.remaps.find((x) => x.remap === (remap ?? inst?.remaps[0]?.remap))
    return r ? [{ pin: r.sck, signal: `${id}_SCK` }, { pin: r.mosi, signal: `${id}_MOSI` }, { pin: r.miso, signal: `${id}_MISO` }] : null
  }
  if (cat === 'i2c') {
    const inst = data.peripherals.i2c.find((u) => u.id === id)
    const r = inst?.remaps.find((x) => x.remap === (remap ?? inst?.remaps[0]?.remap))
    return r ? [{ pin: r.scl, signal: `${id}_SCL` }, { pin: r.sda, signal: `${id}_SDA` }] : null
  }
  if (cat === 'adc') {
    const inst = data.peripherals.adc.find((u) => u.id === id)
    return inst ? inst.channels.map((c) => ({ pin: c.pin, signal: c.channel })) : null
  }
  return null
}