// 生成上下文派生：从 config + data 归并出引脚分类、外设使用与聚合结构。
// 契约：只做纯计算，不渲染模板、不写文件。
import type { Conflict, DeviceData, GeneratedFile, PinAssignment, ProjectConfig } from '@/model/types'
import { labelToIdent } from '@/model/conflicts'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import { dmaChannelPeriph, identWithPrefix, pinIdent, pullVariant } from './util'

// mod.rs 聚合信息
export interface ModField {
  name: string // 字段名（实例小写）
  type: string // 字段类型
  call: string // init 调用表达式（不含字段名与冒号）
}
export interface IrqBinding {
  irq: string
  handler: string
}
export interface PeriModule {
  file: GeneratedFile
  module: string // 'usart' | 'spi' | 'i2c' | 'adc'
  fields: ModField[]
  irqs: IrqBinding[]
}

// ---------- 生成期检查（补充 checkConflicts 之外的 error 级规则） ----------

export function generationErrors(usages: PeripheralUsage[], embassy: boolean, data: DeviceData): Conflict[] {
  const out: Conflict[] = []

  for (const u of enabledUsage(usages, 'usart')) {
    if (!u.pins.some((p) => p.role === 'tx')) {
      out.push({ code: 'USART_TX_MISSING', level: 'error', message: `${u.id} 已启用但未分配 TX 引脚，无法生成初始化代码`, peripheral: u.id })
    }
    if (!u.pins.some((p) => p.role === 'rx')) {
      out.push({ code: 'USART_RX_MISSING', level: 'error', message: `${u.id} 已启用但未分配 RX 引脚，无法生成初始化代码`, peripheral: u.id })
    }
  }
  for (const u of enabledUsage(usages, 'spi')) {
    for (const role of ['sck', 'mosi', 'miso'] as const) {
      if (!u.pins.some((p) => p.role === role)) {
        out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${u.id} 已启用但缺 ${role.toUpperCase()} 引脚，无法生成初始化代码`, peripheral: u.id })
      }
    }
  }
  for (const u of enabledUsage(usages, 'i2c')) {
    for (const role of ['scl', 'sda'] as const) {
      if (!u.pins.some((p) => p.role === role)) {
        out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${u.id} 已启用但缺 ${role.toUpperCase()} 引脚，无法生成初始化代码`, peripheral: u.id })
      }
    }
  }

  // embassy 异步外设需要 TX/RX DMA 请求映射；数据层缺失时兜底报错（阻止导出）
  if (embassy) {
    for (const u of usages.filter((x) => x.enabled && x.category !== 'adc')) {
      for (const req of [`${u.id}_TX`, `${u.id}_RX`]) {
        if (!dmaChannelPeriph(data, req)) {
          out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `数据层缺少 DMA 请求 ${req} 的通道映射，无法生成异步 ${u.id} 初始化代码`, peripheral: u.id })
        }
      }
    }
    // 中断绑定所需的 IRQ 必须在芯片向量表内（USART 单中断；I2C 双中断 EV/ER）
    const irqExists = (name: string) => data.interrupts.irqs.some((i) => i.name === name)
    for (const u of enabledUsage(usages, 'usart')) {
      if (!irqExists(u.id)) {
        out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `中断表缺少 ${u.id} 中断，无法生成异步 USART 初始化代码`, peripheral: u.id })
      }
    }
    for (const u of enabledUsage(usages, 'i2c')) {
      for (const suffix of ['EV', 'ER']) {
        if (!irqExists(`${u.id}_${suffix}`)) {
          out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `中断表缺少 ${u.id}_${suffix} 中断，无法生成异步 I2C 初始化代码`, peripheral: u.id })
        }
      }
    }
  }
  return out
}

// ---------- 引脚归类 ----------

export function validPinFilter(data: DeviceData): (a: PinAssignment) => boolean {
  const valid = new Set(data.chip.pins.map((p) => p.name))
  return (a) => valid.has(a.pin)
}

/**
 * 纯 GPIO 引脚：INPUT/OUTPUT 且未启用 EXTI。
 * 启用 EXTI 的引脚由 exti.rs 独占（ExtiInput 构造时消费引脚单例），
 * 若同时进 pins.rs 会导致 p.PIN 被移动两次，编译必失败。
 */
export function isPlainGpio(a: PinAssignment): boolean {
  return (a.mode === 'INPUT' || a.mode === 'OUTPUT') && !a.params?.exti?.enabled
}

export function plainGpioPins(config: ProjectConfig, data: DeviceData): PinAssignment[] {
  return (config.pins ?? []).filter((a) => isPlainGpio(a) && validPinFilter(data)(a))
}

export function gpioCount(config: ProjectConfig, data: DeviceData): number {
  return plainGpioPins(config, data).length
}

export function gpioArgs(config: ProjectConfig, data: DeviceData): string {
  return plainGpioPins(config, data)
    .map((a) => `p.${a.pin}`)
    .join(', ')
}

// ---------- EXTI 项 ----------

export function extiItems(config: ProjectConfig, data: DeviceData) {
  const items: {
    ident: string
    pin: string
    channel: number
    edge: string
    waitFn: string
    pull: string
    pinParam: string
    chParam: string
  }[] = []
  for (const a of (config.pins ?? []).filter(validPinFilter(data))) {
    if (!a.params?.exti?.enabled) continue
    const entry = data.exti.entries.find((e) => e.pin === a.pin)
    if (!entry) continue // 缺通道已由冲突检查拦截，到不了这里
    const base = a.label ? labelToIdent(a.label) : pinIdent(a.pin)
    const edge = a.params.exti.edge
    items.push({
      ident: identWithPrefix(config, base),
      pin: a.pin,
      channel: entry.channel,
      edge,
      waitFn:
        edge === 'RISING' ? 'wait_for_rising_edge' : edge === 'FALLING' ? 'wait_for_falling_edge' : 'wait_for_any_edge',
      pull: pullVariant(a.params.pull),
      pinParam: pinIdent(a.pin),
      chParam: `exti${entry.channel}`,
    })
  }
  return items
}

// ---------- 各实例在 mod.rs 里的 init 调用实参 ----------

/** 各实例在 mod.rs 里的 init 调用实参（peri + 引脚 + embassy 时的 Irqs/DMA） */
export function instanceCallArgs(
  id: string,
  category: 'usart' | 'spi' | 'i2c',
  usages: PeripheralUsage[],
  embassy: boolean,
  data: DeviceData,
): string {
  const u = usages.find((x) => x.id === id && x.category === category)!
  const pinOf = (role: string) => u.pins.find((p) => p.role === role)!.pin
  const args: string[] = [`p.${id}`]
  if (category === 'usart') args.push(`p.${pinOf('rx')}`, `p.${pinOf('tx')}`)
  else if (category === 'spi') args.push(`p.${pinOf('sck')}`, `p.${pinOf('mosi')}`, `p.${pinOf('miso')}`)
  else args.push(`p.${pinOf('scl')}`, `p.${pinOf('sda')}`)
  if (embassy) {
    if (category !== 'spi') args.push('Irqs') // SPI 异步构造无中断绑定参数（已核对 src/spi.rs）
    args.push(`p.${dmaChannelPeriph(data, `${id}_TX`)!}`, `p.${dmaChannelPeriph(data, `${id}_RX`)!}`)
  }
  return args.join(', ')
}