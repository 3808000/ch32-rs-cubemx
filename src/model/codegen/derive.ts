// 生成上下文派生：从 config + data 归并出引脚分类、外设使用与聚合结构。
// 契约：只做纯计算，不渲染模板、不写文件。
import type { Conflict, DeviceData, DmaRequest, GeneratedFile, PinAssignment, ProjectConfig } from '@/model/types'
import { labelToIdent } from '@/model/conflicts'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import { identWithPrefix, pinIdent, pullVariant } from './util'

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
        // 只校验请求是否在 dma.json 中；fixed 通道/ DMAMUX 物理通道由 buildDmaPlan 解析
        if (!dmaRequestOf(data, req)) {
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

    // DMAMUX 容量：每个请求需要独占一个物理通道（buildDmaPlan 不复用通道）
    if (dmaModelOf(data) === 'dmamux') {
      const requests = new Set<string>()
      for (const u of usages.filter((x) => x.enabled && x.category !== 'adc')) {
        for (const req of [`${u.id}_TX`, `${u.id}_RX`]) {
          if (dmaRequestOf(data, req)) requests.add(req)
        }
      }
      const channelCount = dmaChannelsOf(data).length
      if (requests.size > 0 && channelCount === 0) {
        out.push({
          code: 'DMA_CHANNEL_CONFLICT',
          level: 'error',
          message: `数据层 dma.json 未提供 ${data.chip.chip} 的物理 DMA 通道（channels），无法生成异步外设代码`,
        })
      } else if (requests.size > channelCount) {
        out.push({
          code: 'DMA_CHANNEL_CONFLICT',
          level: 'error',
          message: `DMA 物理通道不足：${requests.size} 个请求需要独占通道，${data.chip.chip} 仅有 ${channelCount} 个可用`,
        })
      }
    }
  }
  return out
}

// ---------- DMA 通道规划（M3.2） ----------
//
// 数据契约：dma.json 的 requests[] 给出「请求 → 通道/请求号」。两种芯片建模：
//  - fixed：请求硬件固定在某个 DMA 通道（V003/V203）。ch32-hal 的 TxDma/RxDma 只为
//    对应 DMA1_CHn 类型实现，改道会编译失败，因此生成器始终采用数据层通道；
//  - dmamux：dma.json 的 channel 是 DMAMUX 请求号，物理通道可任选（H417 的
//    DMA1_CH1..8 / DMA2_CH1..8）。ch32-hal 为全部通道 blanket 实现信号 trait，
//    请求号由通道类型的 request() 返回，生成代码只需传通道单例。
//
// model/channels 是 dma.json 的可选扩展字段；旧数据缺失时按 fixed + requests 最大
// 通道号回退，保证历史输出不变。

export type DmaModel = 'fixed' | 'dmamux'

export interface DmaChannelOption {
  /** 工程配置 DmaConfig.channel 使用的通道号（dmamux 芯片 1..16 依次对应通道单例） */
  number: number
  /** 传给 HAL 的通道外设名（DMA1_CHn / DMA2_CHn） */
  name: string
}

export interface DmaAssignment {
  request: string
  channel: number
  /** 生成代码实际传入的通道单例名 */
  channelPeripheral: string
  /** DMAMUX 请求号（fixed 芯片为 undefined） */
  requestNumber?: number
  /** true = 工程配置显式指定；false = 数据层固定映射或自动分配 */
  explicit: boolean
}

interface DmaDataExt {
  model?: DmaModel
  channels?: DmaChannelOption[]
}

function dmaExt(data: DeviceData): DmaDataExt {
  return (data.dma ?? {}) as DmaDataExt
}

/** 芯片 DMA 建模：dma.json 显式声明优先；未声明按历史行为（固定通道）。 */
export function dmaModelOf(data: DeviceData): DmaModel {
  return dmaExt(data).model === 'dmamux' ? 'dmamux' : 'fixed'
}

/** 可用物理 DMA 通道（通道选项唯一来源：dma.json channels）。 */
export function dmaChannelsOf(data: DeviceData): DmaChannelOption[] {
  const ext = dmaExt(data)
  if (Array.isArray(ext.channels)) return ext.channels
  // 旧数据兜底：requests 里出现的最大通道号 → DMA1_CH1..max
  const max = (data.dma?.requests ?? []).reduce((m, r) => Math.max(m, r.channel), 0)
  return Array.from({ length: max }, (_, i) => ({ number: i + 1, name: `DMA1_CH${i + 1}` }))
}

/** 请求名 → dma.json 条目（无映射返回 undefined）。 */
export function dmaRequestOf(data: DeviceData, request: string): DmaRequest | undefined {
  return data.dma?.requests.find((r) => r.request === request)
}

/** 已启用 USART/SPI/I2C 实例用到的 DMA 请求（ADC 阻塞转换不占 DMA 通道）。 */
export function dmaRequestsOf(usages: PeripheralUsage[]): string[] {
  const out: string[] = []
  for (const u of usages) {
    if (!u.enabled || u.category === 'adc') continue
    out.push(`${u.id}_TX`, `${u.id}_RX`)
  }
  return out
}

/**
 * 计算工程实际使用的 DMA 分配（渲染器与 DMA 面板共用，保证两侧一致）。
 * - fixed：始终采用数据层固定通道；用户填写的不同值只用于冲突提示（规则会阻止导出）。
 * - dmamux：显式通道优先；未指定的请求按声明顺序占用最低空闲通道。
 *   显式通道非法/重复时该条目不落表，交由 DMA 冲突规则报错并阻止导出。
 */
export function buildDmaPlan(config: ProjectConfig, data: DeviceData, usages: PeripheralUsage[]): Map<string, DmaAssignment> {
  const plan = new Map<string, DmaAssignment>()
  if (!data.dma) return plan
  const model = dmaModelOf(data)
  const channels = dmaChannelsOf(data)
  const byNumber = new Map(channels.map((c) => [c.number, c]))
  const explicitOf = (request: string) => config.dma?.find((e) => e.peripheral === request)

  if (model === 'fixed') {
    for (const request of dmaRequestsOf(usages)) {
      const entry = dmaRequestOf(data, request)
      if (!entry) continue
      plan.set(request, {
        request,
        channel: entry.channel,
        channelPeripheral: byNumber.get(entry.channel)?.name ?? `DMA1_CH${entry.channel}`,
        explicit: !!explicitOf(request),
      })
    }
    return plan
  }

  const requests = dmaRequestsOf(usages).filter((request) => !!dmaRequestOf(data, request))
  const used = new Set<number>()
  // 1) 显式分配：通道必须在 dma.json 的 channels 内且不重复
  for (const request of requests) {
    const entry = explicitOf(request)
    if (!entry) continue
    const ch = byNumber.get(entry.channel)
    if (!ch || used.has(ch.number)) continue
    used.add(ch.number)
    plan.set(request, {
      request,
      channel: ch.number,
      channelPeripheral: ch.name,
      requestNumber: dmaRequestOf(data, request)!.channel,
      explicit: true,
    })
  }
  // 2) 其余请求自动占用最低空闲通道（确定性：同一输入顺序 → 同一分配）
  for (const request of requests) {
    if (plan.has(request)) continue
    const free = channels.find((c) => !used.has(c.number))
    if (!free) continue
    used.add(free.number)
    plan.set(request, {
      request,
      channel: free.number,
      channelPeripheral: free.name,
      requestNumber: dmaRequestOf(data, request)!.channel,
      explicit: false,
    })
  }
  return plan
}

/** 渲染器用：取某请求实际通道单例名；数据层缺映射时说明原因（导出前已被生成期错误拦截）。 */
export function dmaPeripheralOf(config: ProjectConfig, data: DeviceData, usages: PeripheralUsage[], request: string): string {
  const assignment = buildDmaPlan(config, data, usages).get(request)
  if (!assignment) {
    throw new Error(`缺少 DMA 通道映射：${request}（数据层 dma.json 或 DMA 面板配置不完整）`)
  }
  return assignment.channelPeripheral
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
    // 用户保留引脚不做任何电气配置（冲突规则已阻止导出，此处纵深防御）
    if (a.mode === 'RESERVED') continue
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
  config: ProjectConfig,
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
    // DMA 通道来自工程配置（config.dma）或数据层默认/自动分配，见 buildDmaPlan
    args.push(`p.${dmaPeripheralOf(config, data, usages, `${id}_TX`)}`, `p.${dmaPeripheralOf(config, data, usages, `${id}_RX`)}`)
  }
  return args.join(', ')
}