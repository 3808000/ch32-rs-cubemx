// 冲突检查：提示词 §7 全部规则。纯函数，无芯片名分支。
// checkConflicts(config, deviceData, unlocked?) → Conflict[]
import type { Conflict, DeviceData, ProjectConfig } from '@/model/types'
import { computeClock, nearestPreset, validateClock } from '@/model/clock'
import { categoryOfPeripheral, peripheralOfSignal, remapValuesFor } from '@/model/device'

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

function parseSizeKb(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([KM])?/i.exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  return (m[2]?.toUpperCase() === 'M' ? n * 1024 : n) * 1024
}

export function checkConflicts(config: ProjectConfig, data: DeviceData, unlocked: string[] = []): Conflict[] {
  const out: Conflict[] = []
  const push = (c: Conflict) => out.push(c)
  const pinByName = new Map(data.chip.pins.map((p) => [p.name, p]))
  const pins = config.pins ?? []

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

  // ---- EXTI 规则 ----
  const extiLineOwners = new Map<number, string[]>()
  for (const a of pins) {
    if (!a.params.exti?.enabled) continue
    if (a.mode !== 'INPUT') {
      push({ code: 'EXTI_ON_NON_INPUT', level: 'warning', message: `${a.pin} 启用了 EXTI 但模式是 ${a.mode}（建议 INPUT）`, pins: [a.pin] })
    }
    const e = data.exti.entries.find((x) => x.pin === a.pin)
    if (!e) {
      push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${a.pin} 无 EXTI 通道（数据层未定义）`, pins: [a.pin] })
      continue
    }
    const arr = extiLineOwners.get(e.channel) ?? []
    arr.push(a.pin)
    extiLineOwners.set(e.channel, arr)
  }
  for (const [ch, owners] of extiLineOwners) {
    if (owners.length > 1) {
      push({ code: 'EXTI_LINE_CONFLICT', level: 'error', message: `EXTI 通道 ${ch} 被多个引脚占用：${owners.join('、')}`, pins: owners })
    }
  }

  // ---- OSC 引脚与时钟 ----
  const clockCfg = config.clock
  if (clockCfg) {
    const usesHse = clockCfg.source === 'HSE' || (clockCfg.source === 'PLL' && clockCfg.pllSource === 'HSE')
    if (usesHse) {
      for (const a of pins) {
        const chipPin = pinByName.get(a.pin)
        if (chipPin?.special === 'osc') {
          push({ code: 'SPECIAL_PIN_OSC', level: 'warning', message: `${a.pin} 是晶振引脚，但时钟树使用了 HSE，硬件上会冲突`, pins: [a.pin] })
        }
      }
    }

    // ---- 时钟合法性 ----
    const issues = validateClock(data.clock, clockCfg)
    for (const i of issues) {
      if (i.level === 'error') {
        push({ code: 'PERIPHERAL_CLOCK_INVALID', level: 'error', message: `时钟配置非法：${i.message}` })
      }
    }
    // 仅当配置存在 error（HAL 不支持该组合）时提示最近合法档位；
    // 合法但无预设的配置由生成器按显式 Config 兜底，不再发警告噪音（首屏默认 HSI 直连即属此类）。
    if (issues.some((i) => i.level === 'error')) {
      const f = computeClock(data.clock, clockCfg)
      const near = nearestPreset(data.clock, f.sysclkMhz || data.clock.sysclkMaxMhz)
      push({
        code: 'CLOCK_PRESET_UNAVAILABLE',
        level: 'warning',
        message: near ? `当前时钟组合不被 HAL 支持，最接近的合法档位：${near.label}` : '当前时钟组合不被 HAL 支持，且无可用预设',
      })
    }
  }

  // ---- 外设级规则 ----
  const peripherals = config.peripherals ?? {}
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

  // ---- DMA 通道冲突（embassy 异步外设） ----
  if (config.features?.embassy && data.dma) {
    const channelUsers = new Map<number, string[]>()
    for (const [id, state] of Object.entries(peripherals)) {
      if (!state.enabled) continue
      const cat = categoryOfPeripheral(id)
      const reqs: string[] = []
      if (cat === 'usart') reqs.push(`${id}_TX`, `${id}_RX`)
      else if (cat === 'spi') reqs.push(`${id}_TX`, `${id}_RX`)
      else if (cat === 'i2c') reqs.push(`${id}_TX`, `${id}_RX`)
      else if (cat === 'adc') reqs.push(id)
      for (const r of reqs) {
        const entry = data.dma.requests.find((x) => x.request === r)
        if (!entry) continue
        const arr = channelUsers.get(entry.channel) ?? []
        arr.push(r)
        channelUsers.set(entry.channel, arr)
      }
    }
    for (const [ch, users] of channelUsers) {
      if (users.length > 1) {
        push({ code: 'DMA_CHANNEL_CONFLICT', level: 'error', message: `DMA 通道 ${ch} 被多个请求占用：${users.join('、')}` })
      }
    }
  }

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

  return out
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