// 引脚与信号级规则：引脚存在性 / 可配置性 / 特殊引脚锁定 / 重复配置 /
// 标签重名 / AF 信号重复与 remap 合法性 / ADC 通道重复。
import { peripheralOfSignal, remapValuesFor } from '@/model/device'
import type { ConflictContext } from './context'

/** 标签 → Rust 标识符（snake_case），用于重名判定 */
export function labelToIdent(label: string): string {
  const s = label
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
  return /^[0-9]/.test(s) ? `_${s}` : s
}

export function runPinRules(ctx: ConflictContext): void {
  const { data, pins, pinByName, unlocked, push } = ctx

  // ---- 引脚级基础规则 ----
  const seenPins = new Map<string, number>()
  for (const a of pins) {
    const chipPin = pinByName.get(a.pin)
    if (!chipPin) {
      push({ code: 'UNKNOWN_PIN', level: 'error', message: `引脚 ${a.pin} 不存在于 ${data.chip.chip}`, pins: [a.pin] })
      continue
    }
    seenPins.set(a.pin, (seenPins.get(a.pin) ?? 0) + 1)
    if (chipPin.type !== 'IO') {
      push({ code: 'PIN_NOT_CONFIGURABLE', level: 'error', message: `${a.pin} 是 ${chipPin.type} 引脚，不可配置`, pins: [a.pin] })
    }
    if (chipPin.special && chipPin.special !== 'osc' && !unlocked.includes(a.pin)) {
      const kindText = chipPin.special === 'nrst' ? 'NRST' : chipPin.special === 'swd' ? 'SWD 调试' : 'BOOT'
      push({
        code: 'SPECIAL_PIN_LOCKED',
        level: 'error',
        message: `${a.pin} 默认用作 ${kindText}，需显式解锁后才能配置（NRST 由选项字节控制）`,
        pins: [a.pin],
      })
    }
  }
  for (const [pin, n] of seenPins) {
    if (n > 1) push({ code: 'DUPLICATE_PIN', level: 'error', message: `引脚 ${pin} 被配置了 ${n} 次`, pins: [pin] })
  }

  // ---- 标签重名 ----
  const labelSeen = new Map<string, string[]>()
  for (const a of pins) {
    if (!a.label) continue
    const ident = labelToIdent(a.label)
    if (!ident) continue
    const arr = labelSeen.get(ident) ?? []
    arr.push(a.pin)
    labelSeen.set(ident, arr)
  }
  for (const [ident, owners] of labelSeen) {
    if (owners.length > 1) {
      push({ code: 'DUPLICATE_LABEL', level: 'warning', message: `标签归一化后重名（${ident}）：${owners.join('、')}，生成的 Rust 标识符会冲突`, pins: owners })
    }
  }

  // ---- AF / ANALOG 信号规则 ----
  const signalOwners = new Map<string, string[]>()
  const adcOwners = new Map<string, string[]>()
  for (const a of pins) {
    if (a.mode === 'AF' && a.function) {
      const arr = signalOwners.get(a.function) ?? []
      arr.push(a.pin)
      signalOwners.set(a.function, arr)

      const values = remapValuesFor(data, a.pin, a.function)
      if (values.length === 0) {
        push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${a.pin} 不支持信号 ${a.function}（数据层无 remap 记录）`, pins: [a.pin], peripheral: peripheralOfSignal(a.function) ?? undefined })
      } else if (a.remap !== undefined && !values.includes(a.remap)) {
        push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${a.pin} 承载 ${a.function} 的 remap 只能是 ${values.join('/')}，当前 ${a.remap}`, pins: [a.pin] })
      }
    }
    if (a.mode === 'ANALOG' && a.function) {
      const arr = adcOwners.get(a.function) ?? []
      arr.push(a.pin)
      adcOwners.set(a.function, arr)
      const chipPin = pinByName.get(a.pin)
      if (chipPin && !(chipPin.adc ?? []).includes(a.function)) {
        push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${a.pin} 没有 ADC 通道 ${a.function}`, pins: [a.pin] })
      }
    }
  }
  for (const [sig, owners] of signalOwners) {
    if (owners.length > 1) push({ code: 'AF_SIGNAL_DUPLICATE', level: 'error', message: `信号 ${sig} 被分配到多个引脚：${owners.join('、')}`, pins: owners })
  }
  for (const [ch, owners] of adcOwners) {
    if (owners.length > 1) push({ code: 'ANALOG_DUPLICATE', level: 'error', message: `ADC 通道 ${ch} 被多次分配：${owners.join('、')}`, pins: owners })
  }
}