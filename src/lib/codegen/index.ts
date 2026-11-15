// 代码生成入口：generateProject(config, data, selection?) → CodegenResult。
// 契约：有 error 级冲突或生成期错误时返回 { files: [], errors }，阻止导出。
// 所有 HAL 签名均核对过 docs/HAL_API_NOTES.md 与 reference/ch32-hal 源码（rev a0863eb…）。
import * as ejs from 'ejs'
import type {
  CodegenResult,
  CodegenSelection,
  Conflict,
  DeviceData,
  GeneratedFile,
  PinAssignment,
  ProjectConfig,
} from '../../types'
import { DEFAULT_SELECTION } from '../../types'
import { checkConflicts, labelToIdent } from '../conflicts'
import { computeClock, matchPreset, mergeClockConfig } from '../clock'
import { derivePeripheralUsage, enabledUsage } from '../peripherals'
import type { PeripheralUsage } from '../peripherals'
import { HAL_GIT, HAL_REV } from './halRev'
import * as T from './templates'

// ---------- EJS 编译缓存（同一模板字符串只编译一次） ----------

type CompiledTpl = (data: Record<string, unknown>) => string
const compileCache = new Map<string, CompiledTpl>()

function render(tpl: string, data: Record<string, unknown>): string {
  let fn = compileCache.get(tpl)
  if (!fn) {
    fn = ejs.compile(tpl, { client: true }) as CompiledTpl
    compileCache.set(tpl, fn)
  }
  return fn(data)
}

// ---------- 小工具（确定性输出：无时间戳/随机） ----------

/** 工程名 → 合法 cargo 包名（小写连字符；空/数字开头兜底） */
export function sanitizePackageName(name: string): string {
  let s = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!s) s = 'ch32-project'
  if (/^[0-9]/.test(s)) s = `app-${s}`
  return s
}

/** Hz 数值 → 下划线分组字符串（24000000 → 24_000_000） */
function fmtHz(hz: number): string {
  return Math.round(hz)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '_')
}

/** MHz 数值 → 整数或小数（48 → '48MHz'，10.6667 → '10.67MHz'） */
function fmtMhz(mhz: number): string {
  if (!Number.isFinite(mhz)) return '0MHz'
  if (Number.isInteger(mhz)) return `${mhz}MHz`
  return `${parseFloat(mhz.toFixed(2))}MHz`
}

/** 外设实例 id → Rust 类型名（USART1 → Usart1，ADC1 → Adc1） */
function typeNameOf(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
}

/** 引脚名 → 小写标识符（PD6 → pd6） */
function pinIdent(pin: string): string {
  return pin.toLowerCase()
}

/** 配置模型 pull → ch32-hal 枚举变体名 */
function pullVariant(pull: string | undefined): 'Up' | 'Down' | 'None' {
  if (pull === 'UP') return 'Up'
  if (pull === 'DOWN') return 'Down'
  return 'None'
}

/** 引脚单例参数类型（PD6 → hal::Peri<'static, hal::peripherals::PD6>） */
function periType(pin: string): string {
  return `hal::Peri<'static, hal::peripherals::${pin}>`
}

/** 数据层 DMA 请求 → DMA 通道外设名（USART1_TX → DMA1_CH4）；缺映射返回 null */
function dmaChannelPeriph(data: DeviceData, request: string): string | null {
  const e = data.dma?.requests.find((r) => r.request === request)
  return e ? `DMA1_CH${e.channel}` : null
}

/** 标签/引脚标识符加用户前缀（snake_case：prefix + '_' + ident） */
function identWithPrefix(config: ProjectConfig, base: string): string {
  const prefix = config.naming?.prefix?.trim() ?? ''
  return prefix ? `${prefix}_${base}` : base
}

// mod.rs 聚合信息
interface ModField {
  name: string // 字段名（实例小写）
  type: string // 字段类型
  call: string // init 调用表达式（不含字段名与冒号）
}
interface IrqBinding {
  irq: string
  handler: string
}
interface PeriModule {
  file: GeneratedFile
  module: string // 'usart' | 'spi' | 'i2c' | 'adc'
  fields: ModField[]
  irqs: IrqBinding[]
}

// ---------- 生成期检查（补充 checkConflicts 之外的 error 级规则） ----------

function generationErrors(usages: PeripheralUsage[], embassy: boolean, data: DeviceData): Conflict[] {
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

// ---------- 各模块渲染 ----------

function renderClock(config: ProjectConfig, data: DeviceData, base = ''): GeneratedFile {
  const spec = data.clock
  const cfg = mergeClockConfig(spec, config.clock)
  const preset = matchPreset(spec, cfg)
  const f = computeClock(spec, cfg)
  const usesHse = cfg.source === 'HSE' || (cfg.source === 'PLL' && cfg.pllSource === 'HSE')

  // 该芯片是否有独立 APB1 分频（V003 无：apb1 options=[1]，HAL Config 无 apb1_pre 字段）
  const hasApb1 = spec.apb1.options.length > 1 || spec.apb1.options[0] !== 1

  const assignments: string[] = []
  if (usesHse) {
    assignments.push(
      [
        'cfg.hse = Some(hal::rcc::Hse {',
        `    freq: hal::time::Hertz(${fmtHz((cfg.hxtalMhz ?? 24) * 1_000_000)}),`,
        '    mode: hal::rcc::HseMode::Oscillator,',
        '});',
      ].join('\n    '),
    )
  }
  assignments.push(`cfg.sys = hal::pac::rcc::vals::Sw::${cfg.source};`)
  if (cfg.source === 'PLL') {
    assignments.push(`cfg.pll_src = hal::pac::rcc::vals::Pllsrc::${cfg.pllSource ?? 'HSI'};`)
  }
  assignments.push(`cfg.ahb_pre = hal::pac::rcc::vals::Hpre::DIV${cfg.ahb};`)
  if (hasApb1) assignments.push(`cfg.apb1_pre = hal::pac::rcc::vals::Ppre::DIV${cfg.apb1};`)
  assignments.push(`cfg.apb2_pre = hal::pac::rcc::vals::Ppre::DIV${cfg.apb2};`)

  const presetConst = preset ? (spec.codegen.presetConstMap[preset.id] ?? null) : null
  const content = render(T.CLOCK_TPL, {
    sysclk: fmtMhz(f.sysclkMhz),
    hclk: fmtMhz(f.hclkMhz),
    pclk1: fmtMhz(f.pclk1Mhz),
    pclk2: fmtMhz(f.pclk2Mhz),
    presetConst,
    presetLabel: preset?.label ?? '',
    assignments,
  })
  return { path: `${base}src/generated/clock.rs`, content }
}

function validPinFilter(data: DeviceData): (a: PinAssignment) => boolean {
  const valid = new Set(data.chip.pins.map((p) => p.name))
  return (a) => valid.has(a.pin)
}

/**
 * 纯 GPIO 引脚：INPUT/OUTPUT 且未启用 EXTI。
 * 启用 EXTI 的引脚由 exti.rs 独占（ExtiInput 构造时消费引脚单例），
 * 若同时进 pins.rs 会导致 p.PIN 被移动两次，编译必失败。
 */
function isPlainGpio(a: PinAssignment): boolean {
  return (a.mode === 'INPUT' || a.mode === 'OUTPUT') && !a.params?.exti?.enabled
}

function plainGpioPins(config: ProjectConfig, data: DeviceData): PinAssignment[] {
  return (config.pins ?? []).filter((a) => isPlainGpio(a) && validPinFilter(data)(a))
}

function renderPins(config: ProjectConfig, data: DeviceData, base = ''): GeneratedFile {
  const models: {
    pin: string
    ident: string
    kind: 'Output' | 'Input' | 'OutputOpenDrain'
    comment: string
    expr: string
  }[] = []

  for (const a of plainGpioPins(config, data)) {
    const base = a.label ? labelToIdent(a.label) : pinIdent(a.pin)
    const ident = identWithPrefix(config, base)
    const openDrain = a.params?.outputType === 'OPEN_DRAIN'
    const speed = a.params?.speed ?? 'HIGH'
    // V003 家族仅 Low/Medium/High 三档；VERY_HIGH 无对应，映射 High
    const speedName = speed === 'LOW' ? 'Low' : speed === 'MEDIUM' ? 'Medium' : 'High'
    if (a.mode === 'OUTPUT') {
      const level = a.params?.level ?? 'LOW'
      const levelName = level === 'HIGH' ? 'High' : 'Low'
      models.push({
        pin: a.pin,
        ident,
        kind: openDrain ? 'OutputOpenDrain' : 'Output',
        comment: `输出${openDrain ? '，开漏' : '，推挽'}，初始 ${levelName}，速度 ${speedName}`,
        expr: `${openDrain ? 'OutputOpenDrain' : 'Output'}::new(${pinIdent(a.pin)}, Level::${levelName}, Speed::${speedName})`,
      })
    } else {
      const pull = a.params?.pull ?? 'NONE'
      models.push({
        pin: a.pin,
        ident,
        kind: 'Input',
        comment: `输入，${pull === 'UP' ? '上拉' : pull === 'DOWN' ? '下拉' : '浮空'}`,
        expr: `Input::new(${pinIdent(a.pin)}, Pull::${pullVariant(pull)})`,
      })
    }
  }

  // use 语句按需收集（无 GPIO 时不引入任何 use，避免未使用告警）
  const useSet = new Set<string>()
  for (const m of models) {
    useSet.add(m.kind)
    if (m.kind === 'Input') useSet.add('Pull')
    else {
      useSet.add('Level')
      useSet.add('Speed')
    }
  }
  const useOrder = ['Input', 'Level', 'Output', 'OutputOpenDrain', 'Pull', 'Speed']
  const useList = useOrder.filter((u) => useSet.has(u)).join(', ')

  const params = models.map((m) => `${pinIdent(m.pin)}: ${periType(m.pin)}`).join(', ')
  const content = render(T.PINS_TPL, { pins: models, useList, params })
  return { path: `${base}src/generated/pins.rs`, content }
}

function extiItems(config: ProjectConfig, data: DeviceData) {
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

function renderExti(config: ProjectConfig, data: DeviceData, base = ''): { file: GeneratedFile; fields: ModField[] } | null {
  const items = extiItems(config, data)
  if (items.length === 0) return null

  const params = items
    .flatMap((e) => [
      `${e.pinParam}: ${periType(e.pin)}`,
      `${e.chParam}: hal::Peri<'static, hal::peripherals::EXTI${e.channel}>`,
    ])
    .join(', ')
  const content = render(T.EXTI_TPL, { items, params })
  const callArgs = items.map((e) => `p.${e.pin}, p.EXTI${e.channel}`).join(', ')
  return {
    file: { path: `${base}src/generated/exti.rs`, content },
    fields: [{ name: 'exti', type: 'exti::Exti', call: `exti::init(${callArgs})` }],
  }
}

// ---------- USART ----------

/** usart 参数键 → cfg 赋值行（参数值来自数据层，逐字拼接 HAL 枚举变体名） */
function usartCfgLines(params: Record<string, string | number | boolean>): string[] {
  const lines: string[] = []
  if (params.baudrate !== undefined) lines.push(`cfg.baudrate = ${params.baudrate};`)
  if (params.wordLength !== undefined) lines.push(`cfg.data_bits = hal::usart::DataBits::${params.wordLength};`)
  if (params.stopBits !== undefined) lines.push(`cfg.stop_bits = hal::usart::StopBits::${params.stopBits};`)
  if (params.parity !== undefined) lines.push(`cfg.parity = hal::usart::Parity::${params.parity};`)
  return lines
}

/** "115200 8N1" 风格参数描述 */
function usartParamDesc(params: Record<string, string | number | boolean>): string {
  const bits = params.wordLength === 'DataBits9' ? '9' : '8'
  const par = params.parity === 'ParityEven' ? 'E' : params.parity === 'ParityOdd' ? 'O' : 'N'
  const stop = params.stopBits === 'STOP2' ? '2' : '1'
  return `${params.baudrate ?? 115200} ${bits}${par}${stop}`
}

function renderUsart(config: ProjectConfig, usages: PeripheralUsage[], embassy: boolean, data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'usart')
  if (insts.length === 0) return null
  // per_pin_af（H4）：构造函数没有 REMAP const 泛型，AF 由引脚 trait 的 af_num() 写入 AFR
  const perPinAf = data.chip.remapModel === 'per_pin_af'
  const afOf = (pinName: string) => (config.pins ?? []).find((a) => a.pin === pinName)?.remap

  const instances = insts.map((u) => {
    const rx = u.pins.find((p) => p.role === 'rx')!.pin
    const tx = u.pins.find((p) => p.role === 'tx')!.pin
    const remap = u.remap ?? 0
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const params: string[] = [`peri: ${periType(u.id)}`, `rx: ${periType(rx)}`, `tx: ${periType(tx)}`]
    const callArgs: string[] = [`p.${u.id}`, `p.${rx}`, `p.${tx}`]
    if (embassy) {
      params.push('irqs: super::Irqs')
      const txDma = dmaChannelPeriph(data, `${u.id}_TX`)!
      const rxDma = dmaChannelPeriph(data, `${u.id}_RX`)!
      params.push(`tx_dma: ${periType(txDma)}`, `rx_dma: ${periType(rxDma)}`)
      callArgs.push('Irqs', `p.${txDma}`, `p.${rxDma}`)
    }
    return {
      id: u.id,
      remap,
      remapSyntax: perPinAf ? '' : `::<${remap}>`,
      remapDesc: perPinAf
        ? `TX=${tx}(AF${afOf(tx) ?? '?'}) RX=${rx}(AF${afOf(rx) ?? '?'})`
        : `remap ${remap}：TX=${tx} RX=${rx}`,
      tx,
      rx,
      typeName,
      initFn,
      params: params.join(', '),
      cfgLines: usartCfgLines(u.params),
      paramDesc: usartParamDesc(u.params),
      modeType: embassy ? 'Async' : 'Blocking',
      asyncMode: embassy,
    }
  })

  const content = render(T.USART_TPL, { instances })
  return {
    file: { path: `${base}src/generated/usart.rs`, content },
    module: 'usart',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `usart::${i.typeName}`,
      call: `usart::${i.initFn}(${instanceCallArgs(i.id, 'usart', usages, embassy, data)})`,
    })),
    // 中断名与向量表核对（ Embassy Binding：USART 单中断）
    irqs: embassy
      ? insts.map((u) => ({
          irq: u.id,
          handler: `hal::usart::InterruptHandler<hal::peripherals::${u.id}>`,
        }))
      : [],
  }
}

/** 各实例在 mod.rs 里的 init 调用实参（peri + 引脚 + embassy 时的 Irqs/DMA） */
function instanceCallArgs(
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

// ---------- SPI ----------

function spiCfgLines(params: Record<string, string | number | boolean>): string[] {
  const lines: string[] = []
  // ch32-hal 的 src/spi.rs 只私用 `embedded_hal::spi::{Mode, MODE_0}`，未 re-export；
  // 生成代码必须走 embedded-hal 的公开路径，否则 `hal::spi::MODE_0` 是私有符号（E0603）。
  if (params.mode !== undefined) lines.push(`cfg.mode = embedded_hal::spi::${params.mode};`)
  if (params.bitOrder !== undefined) lines.push(`cfg.bit_order = hal::spi::BitOrder::${params.bitOrder};`)
  if (typeof params.frequency === 'number') lines.push(`cfg.frequency = hal::time::Hertz::hz(${fmtHz(params.frequency)});`)
  return lines
}

function renderSpi(config: ProjectConfig, usages: PeripheralUsage[], embassy: boolean, data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'spi')
  if (insts.length === 0) return null
  const perPinAf = data.chip.remapModel === 'per_pin_af'
  const afOf = (pinName: string) => (config.pins ?? []).find((a) => a.pin === pinName)?.remap

  const instances = insts.map((u) => {
    const sck = u.pins.find((p) => p.role === 'sck')!.pin
    const mosi = u.pins.find((p) => p.role === 'mosi')!.pin
    const miso = u.pins.find((p) => p.role === 'miso')!.pin
    const remap = u.remap ?? 0
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const params: string[] = [`peri: ${periType(u.id)}`, `sck: ${periType(sck)}`, `mosi: ${periType(mosi)}`, `miso: ${periType(miso)}`]
    if (embassy) {
      const txDma = dmaChannelPeriph(data, `${u.id}_TX`)!
      const rxDma = dmaChannelPeriph(data, `${u.id}_RX`)!
      params.push(`tx_dma: ${periType(txDma)}`, `rx_dma: ${periType(rxDma)}`)
    }
    return {
      id: u.id,
      remap,
      remapSyntax: perPinAf ? '' : `::<${remap}>`,
      remapDesc: perPinAf
        ? `SCK=${sck}(AF${afOf(sck) ?? '?'}) MOSI=${mosi}(AF${afOf(mosi) ?? '?'}) MISO=${miso}(AF${afOf(miso) ?? '?'})`
        : `remap ${remap}：SCK=${sck} MOSI=${mosi} MISO=${miso}`,
      sck,
      mosi,
      miso,
      typeName,
      initFn,
      params: params.join(', '),
      cfgLines: spiCfgLines(u.params),
      paramDesc: `模式 ${u.params.mode ?? 'MODE_0'}，位序 ${u.params.bitOrder ?? 'MsbFirst'}，${fmtHz(Number(u.params.frequency ?? 1_000_000))}Hz`,
      modeType: embassy ? 'Async' : 'Blocking',
      asyncMode: embassy,
    }
  })

  const content = render(T.SPI_TPL, { instances })
  return {
    file: { path: `${base}src/generated/spi.rs`, content },
    module: 'spi',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `spi::${i.typeName}`,
      call: `spi::${i.initFn}(${instanceCallArgs(i.id, 'spi', usages, embassy, data)})`,
    })),
    irqs: [],
  }
}

// ---------- I2C ----------

function renderI2c(config: ProjectConfig, usages: PeripheralUsage[], embassy: boolean, data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'i2c')
  if (insts.length === 0) return null
  const perPinAf = data.chip.remapModel === 'per_pin_af'
  const afOf = (pinName: string) => (config.pins ?? []).find((a) => a.pin === pinName)?.remap

  const instances = insts.map((u) => {
    const scl = u.pins.find((p) => p.role === 'scl')!.pin
    const sda = u.pins.find((p) => p.role === 'sda')!.pin
    const remap = u.remap ?? 0
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const params: string[] = [`peri: ${periType(u.id)}`, `scl: ${periType(scl)}`, `sda: ${periType(sda)}`]
    if (embassy) {
      params.push('irqs: super::Irqs')
      const txDma = dmaChannelPeriph(data, `${u.id}_TX`)!
      const rxDma = dmaChannelPeriph(data, `${u.id}_RX`)!
      params.push(`tx_dma: ${periType(txDma)}`, `rx_dma: ${periType(rxDma)}`)
    }
    const cfgLines: string[] = []
    if (u.params.duty !== undefined) cfgLines.push(`cfg.duty = hal::i2c::Duty::${u.params.duty};`)
    const freqHz = fmtHz(Number(u.params.speed ?? 100_000))
    return {
      id: u.id,
      remap,
      remapSyntax: perPinAf ? '' : `::<${remap}>`,
      remapDesc: perPinAf
        ? `SCL=${scl}(AF${afOf(scl) ?? '?'}) SDA=${sda}(AF${afOf(sda) ?? '?'})`
        : `remap ${remap}：SCL=${scl} SDA=${sda}`,
      scl,
      sda,
      typeName,
      initFn,
      params: params.join(', '),
      cfgLines,
      paramDesc: `速率 ${freqHz}Hz，占空比 ${u.params.duty ?? 'Duty2_1'}`,
      modeType: embassy ? 'Async' : 'Blocking',
      asyncMode: embassy,
      freq: freqHz,
    }
  })

  const content = render(T.I2C_TPL, { instances })
  const irqs: IrqBinding[] = []
  if (embassy) {
    for (const u of insts) {
      // I2C 需双中断 handler（Event/Error），名称核对 ch32-hal src/i2c.rs
      irqs.push(
        { irq: `${u.id}_EV`, handler: `hal::i2c::EventInterruptHandler<hal::peripherals::${u.id}>` },
        { irq: `${u.id}_ER`, handler: `hal::i2c::ErrorInterruptHandler<hal::peripherals::${u.id}>` },
      )
    }
  }
  return {
    file: { path: `${base}src/generated/i2c.rs`, content },
    module: 'i2c',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `i2c::${i.typeName}`,
      call: `i2c::${i.initFn}(${instanceCallArgs(i.id, 'i2c', usages, embassy, data)})`,
    })),
    irqs,
  }
}

// ---------- ADC ----------

function renderAdc(usages: PeripheralUsage[], data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'adc')
  if (insts.length === 0) return null
  // H4/V4x7：Adc::new 返回 Result，读通道用 blocking_read（v1/v3 用 convert）
  const adcApi = data.peripherals.adcApi ?? 'convert'

  const instances = insts.map((u) => {
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const channels = u.pins.map((p) => ({
      channel: p.role, // 'ADC_IN1'
      field: p.role.replace(/^ADC_/i, '').toLowerCase(), // 'in1'
      pin: p.pin,
      param: pinIdent(p.pin),
    }))
    const params = [`adc_peri: ${periType(u.id)}`, ...channels.map((c) => `${c.param}: ${periType(c.pin)}`)].join(', ')
    return {
      id: u.id,
      typeName,
      initFn,
      fieldName: u.id.toLowerCase(),
      channels,
      params,
      sampleTime: u.params.sampleTime ?? 'CYCLES73',
    }
  })

  const content = render(T.ADC_TPL, { instances, adcApi })
  return {
    file: { path: `${base}src/generated/adc.rs`, content },
    module: 'adc',
    fields: instances.map((i) => ({
      name: i.fieldName,
      type: `adc::${i.typeName}`,
      call: `adc::${i.initFn}(${['p.' + i.id, ...i.channels.map((c) => `p.${c.pin}`)].join(', ')})`,
    })),
    irqs: [],
  }
}

// ---------- 单核生成区（可带目录前缀，供双核 workspace 复用） ----------

/**
 * 生成一个核的 src/generated/**（clock/pins/exti/usart/spi/i2c/adc + mod.rs）。
 * base 为目录前缀（单核 ''，双核 'v3f/'）。单核输出与历史逐字节一致。
 */
function renderCoreGenerated(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  usages: PeripheralUsage[],
  embassy: boolean,
  base = '',
): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const modules: string[] = []
  const fields: ModField[] = []
  const irqs: IrqBinding[] = []

  if (sel.clock) {
    files.push(renderClock(config, data, base))
    modules.push('clock')
  }
  let pinsFile: GeneratedFile | null = null
  if (sel.pins) {
    pinsFile = renderPins(config, data, base)
    files.push(pinsFile)
    modules.push('pins')
  }
  let extiMod: { file: GeneratedFile; fields: ModField[] } | null = null
  if (sel.exti) {
    extiMod = renderExti(config, data, base)
    if (extiMod) {
      files.push(extiMod.file)
      modules.push('exti')
    }
  }
  const addPeri = (m: PeriModule | null) => {
    if (!m) return
    files.push(m.file)
    modules.push(m.module)
    fields.push(...m.fields)
    irqs.push(...m.irqs)
  }
  if (sel.usart) addPeri(renderUsart(config, usages, embassy, data, base))
  if (sel.spi) addPeri(renderSpi(config, usages, embassy, data, base))
  if (sel.i2c) addPeri(renderI2c(config, usages, embassy, data, base))
  if (sel.adc) addPeri(renderAdc(usages, data, base))

  // mod.rs 聚合
  const hasGpio = pinsFile !== null && gpioCount(config, data) > 0
  const modFields: { name: string; type: string }[] = []
  const modInits: { field: string; call: string }[] = []
  if (sel.pins) {
    modFields.push({ name: 'pins', type: hasGpio ? "pins::Pins<'static>" : 'pins::Pins' })
    modInits.push({ field: 'pins', call: `pins::init(${gpioArgs(config, data)})` })
  }
  if (extiMod) {
    modFields.push({ name: 'exti', type: 'exti::Exti' })
    modInits.push({ field: 'exti', call: extiMod.fields[0].call })
  }
  for (const f of fields) {
    modFields.push({ name: f.name, type: f.type })
    modInits.push({ field: f.name, call: f.call })
  }
  files.push({
    path: `${base}src/generated/mod.rs`,
    content: render(T.MOD_TPL, {
      modules,
      irqs,
      fields: modFields,
      inits: modInits,
    }),
  })
  return files
}

// ---------- 双核 workspace ----------

/** 双核 target → 自定义 target json 模板。未知 target 直接报错，不猜。 */
function targetTemplateOf(target: string): string | null {
  if (target === 'riscv32imafc-unknown-none-elf') return T.TARGET_RISCV32IMAFC_TPL
  if (target === 'riscv32imafbc-unknown-none-elf') return T.TARGET_RISCV32IMAFCB_TPL
  return null
}

/** 双核 README 的文件说明（按路径模式匹配） */
function dualFileDesc(path: string): string {
  if (path === 'Cargo.toml') return 'workspace 清单 + 共享 ch32-hal 依赖'
  if (path === 'rust-toolchain.toml') return 'nightly + rust-src（自定义 target / build-std）'
  if (path === '.cargo/config.toml') return 'xtask 别名'
  if (path === '.gitignore') return '构建产物忽略规则'
  if (path === 'cube.json') return 'ch32-rs-CubeMX 配置回读（可重新导入）'
  if (path === 'xtask/Cargo.toml') return '双核编排工具清单'
  if (path === 'xtask/src/main.rs') return '双核构建 / 烧录 / 合并（cargo xtask）'

  const m = path.match(/^([a-z][a-z0-9_]*)\/(.*)$/)
  if (m) {
    const sub = m[2]
    if (sub === 'Cargo.toml') return `${m[1]} 核 crate（HAL feature / 运行时依赖）`
    if (sub === 'build.rs') return '注入 -Tlink.x，并提供该核 memory.x'
    if (sub === 'memory.x') return '该核的 flash/RAM 布局'
    if (sub === 'link.x') return '启动核 highcode 链接脚本（零等待共享 SRAM）'
    if (sub.endsWith('.json')) return '自定义 target 描述（+xwchc / +b）'
    if (sub === '.cargo/config.toml') return '该核 target + wlink runner'
    if (sub === 'src/main.rs') return '该核用户代码入口（不会被重新导出覆盖）'
    if (sub === 'src/generated/mod.rs') return '生成模块聚合（init 返回 Generated）'
    if (sub === 'src/generated/clock.rs') return '时钟树 → RCC 配方'
    if (sub === 'src/generated/pins.rs') return 'GPIO 引脚初始化'
    if (sub === 'src/generated/exti.rs') return 'EXTI 输入初始化'
    if (sub === 'src/generated/usart.rs') return 'USART 初始化'
    if (sub === 'src/generated/spi.rs') return 'SPI 初始化'
    if (sub === 'src/generated/i2c.rs') return 'I2C 初始化'
    if (sub === 'src/generated/adc.rs') return 'ADC 初始化（通道=引脚字段）'
  }
  return ''
}

/**
 * 双核工程：Cargo workspace + 每核一个 crate + xtask（构建/烧录/合并）。
 * 主核生成完整 generated/**；从核按当前数据模型只生成 clock 快照与空 init。
 */
function generateDualCoreProject(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  usages: PeripheralUsage[],
  embassy: boolean,
  debugPrint: boolean,
): CodegenResult {
  const cores = data.chip.cores ?? []
  const errors: Conflict[] = []

  if (embassy) {
    errors.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'error',
      message: '双核 embassy 代码生成待完成：当前 DMA 模型按固定通道建模，H4/DMAMUX 需要按通道 + 请求号生成',
    })
  }
  if (cores.length !== 2) {
    errors.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'error',
      message: `双核 workspace 生成目前只支持 2 个核心（当前 ${cores.length} 个）`,
    })
  }
  const mains = cores.filter((c) => c.mainCore === true)
  if (mains.length !== 1) {
    errors.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'error',
      message: `cores 必须恰有一个 mainCore=true（当前 ${mains.length} 个）`,
    })
  }
  for (const core of cores) {
    if (!targetTemplateOf(core.target)) {
      errors.push({
        code: 'TARGET_FEATURE_UNSUPPORTED',
        level: 'error',
        message: `${core.id} 核 target ${core.target} 没有内置的自定义 target json 模板，无法生成双核工程`,
      })
    }
  }
  if (errors.length > 0) return { files: [], errors }

  const mainCore = mains[0]
  const packageName = sanitizePackageName(config.projectName)
  const halRev = config.hal?.rev || HAL_REV
  const files: GeneratedFile[] = []

  // ---------- workspace 骨架 ----------
  if (sel.projectSkeleton) {
    const halDependency = sel.vendorHal
      ? 'path = "vendor/ch32-hal", default-features = false'
      : `git = "${HAL_GIT}", rev = "${halRev}", default-features = false`
    files.push({
      path: 'Cargo.toml',
      content: render(T.DUAL_ROOT_CARGO_TPL, {
        members: [...cores.map((c) => `"${c.id}"`), '"xtask"'].join(', '),
        halDependency,
      }),
    })
    files.push({ path: 'rust-toolchain.toml', content: T.DUAL_RUST_TOOLCHAIN_TPL })
    files.push({ path: '.cargo/config.toml', content: T.DUAL_CARGO_CONFIG_TPL })
    files.push({ path: '.gitignore', content: T.GITIGNORE_TPL })
  }

  // ---------- 每核 crate ----------
  for (const core of cores) {
    const main = core === mainCore
    const coreName = `${packageName}-${core.id}`
    const halFeatures = [core.halFeature, 'rt', ...(main ? ['exti'] : []), 'memory-x']
      .map((f) => `"${f}"`)
      .join(', ')
    const rtFeatures = main ? '"highcode"' : `"${core.id}"`
    const qingkeFeatures = main
      ? '"unsafe-trust-wch-atomics", "dual-core"'
      : `"${core.id}", "dual-core", "unsafe-trust-wch-atomics"`

    if (sel.projectSkeleton) {
      files.push({
        path: `${core.id}/Cargo.toml`,
        content: render(T.CORE_CARGO_TPL, { coreName, halFeatures, rtFeatures, qingkeFeatures, mainCore: main }),
      })
      files.push({
        path: `${core.id}/build.rs`,
        content: render(T.CORE_BUILD_RS_TPL, { mainCore: main }),
      })
      files.push({
        path: `${core.id}/memory.x`,
        content: main ? T.H417_V3F_MEMORY_X : T.H417_V5F_MEMORY_X,
      })
      if (main) files.push({ path: `${core.id}/link.x`, content: T.H417_V3F_LINK_X })
      files.push({ path: `${core.id}/${core.target}.json`, content: targetTemplateOf(core.target)! })
      files.push({
        path: `${core.id}/.cargo/config.toml`,
        content: render(T.CORE_CARGO_CONFIG_TPL, { target: core.target }),
      })
    }

    if (main) {
      files.push(...renderCoreGenerated(config, data, sel, usages, embassy, `${core.id}/`))
      files.push({
        path: `${core.id}/src/main.rs`,
        content: render(T.DUAL_V3F_MAIN_TPL, { clockUsed: sel.clock, debugPrint }),
      })
    } else {
      if (sel.clock) files.push(renderClock(config, data, `${core.id}/`))
      files.push({
        path: `${core.id}/src/generated/mod.rs`,
        content: render(T.V5F_GENERATED_MOD_TPL, { clockUsed: sel.clock }),
      })
      files.push({
        path: `${core.id}/src/main.rs`,
        content: render(T.DUAL_V5F_MAIN_TPL, { clockUsed: sel.clock }),
      })
    }
  }

  // ---------- xtask（双核构建/烧录/合并） ----------
  if (sel.projectSkeleton) {
    const flashK = Number.parseInt(data.chip.flash, 10)
    const totalK = Number.isFinite(flashK) ? flashK : 960
    const xtaskCores = cores.map((c) => {
      const main = c === mainCore
      return {
        id: c.id,
        target: c.target,
        bin: `${packageName}-${c.id}`,
        flashBase: main ? '0x0000_0000' : '0x0001_0000',
        flashLimit: main ? '64 * 1024' : `${totalK} * 1024 - 64 * 1024`,
      }
    })
    files.push({ path: 'xtask/Cargo.toml', content: T.XTASK_CARGO_TPL })
    files.push({ path: 'xtask/src/main.rs', content: render(T.XTASK_MAIN_TPL, { cores: xtaskCores }) })
  }

  // ---------- cube.json（工程根，配置回读） ----------
  files.push({ path: 'cube.json', content: JSON.stringify(config, null, 2) + '\n' })

  // ---------- README ----------
  if (sel.readme) {
    const cfg = mergeClockConfig(data.clock, config.clock)
    const f = computeClock(data.clock, cfg)
    files.push({
      path: 'README.md',
      content: render(T.DUAL_README_TPL, {
        projectName: config.projectName,
        chip: data.chip.chip,
        chipPackage: data.chip.package,
        coreSummary: cores.map((c) => c.label).join(' + '),
        cores: cores.map((c) => ({
          id: c.id,
          label: c.label,
          halFeature: c.halFeature,
          target: c.target,
          mainCore: c === mainCore,
        })),
        clockSummary: `当前配置：SYSCLK ${f.sysclkMhz}MHz，HCLK ${f.hclkMhz}MHz，PCLK1 ${f.pclk1Mhz}MHz，PCLK2 ${f.pclk2Mhz}MHz。`,
        vendorHal: sel.vendorHal,
        files: files.map((x) => ({ path: x.path, desc: dualFileDesc(x.path) })),
      }),
    })
  }

  return { files, errors: [] }
}

// ---------- 入口 ----------

export function generateProject(
  config: ProjectConfig,
  data: DeviceData,
  selection?: Partial<CodegenSelection>,
): CodegenResult {
  const sel: CodegenSelection = { ...DEFAULT_SELECTION, ...(selection ?? {}) }

  // 数据驱动后端守卫：仅支持 ch32-hal（如 CH58x 芯片会标其它 halBackend）
  const backend = (data.chip as { halBackend?: string }).halBackend
  if (backend && backend !== 'ch32-hal') {
    return {
      files: [],
      errors: [
        {
          code: 'TARGET_FEATURE_UNSUPPORTED',
          level: 'error',
          message: `该芯片使用 ${backend} 后端，当前代码生成仅支持 ch32-hal`,
        },
      ],
    }
  }

  // 1. 配置期冲突：error 级直接阻止（unlocked 传 []，与导出一致）
  const conflicts = checkConflicts(config, data, [])
  const errors = conflicts.filter((c) => c.level === 'error')

  // 2. 生成期错误：缺引脚/DMA 映射 → error 级 Conflict，阻止导出
  const usages = derivePeripheralUsage(config, data)
  errors.push(...generationErrors(usages, config.features?.embassy ?? false, data))

  // 3. 时钟预设守卫：HAL 只提供时钟配方时（H4），无匹配预设不能用显式字段拼装
  if (sel.clock && data.clock.codegen?.fallback === 'preset_only') {
    const clockCfg = mergeClockConfig(data.clock, config.clock)
    const preset = matchPreset(data.clock, clockCfg)
    const presetConst = preset ? data.clock.codegen.presetConstMap[preset.id] : undefined
    if (!preset || !presetConst) {
      const f = computeClock(data.clock, clockCfg)
      errors.push({
        code: 'CLOCK_PRESET_UNAVAILABLE',
        level: 'error',
        message: `${data.chip.chip} 的 HAL 只提供预置时钟方案（clock.codegen.fallback=preset_only）：当前配置 SYSCLK ${f.sysclkMhz}MHz、AHB÷${clockCfg.ahb} 无匹配预设，请选择预设时钟或调整分频`,
      })
    }
  }
  if (errors.length > 0) return { files: [], errors }

  const embassy = config.features?.embassy ?? false
  const debugPrint = config.features?.debugPrint ?? false

  // 4. 双核芯片（ChipData.cores）→ workspace；单核芯片保持原有输出
  if ((data.chip.cores?.length ?? 0) > 0) {
    return generateDualCoreProject(config, data, sel, usages, embassy, debugPrint)
  }

  const files: GeneratedFile[] = []

  // ---------- 骨架文件（selection.projectSkeleton） ----------
  const packageName = sanitizePackageName(config.projectName)
  const nightly = data.chip.nightly
  const jsonTarget = nightly && data.chip.target === 'riscv32ec-unknown-none-elf'
  const feats = [data.chip.halFeature]
  if (embassy) feats.push('embassy', 'time-driver-tim2')
  feats.push('rt', 'exti', 'memory-x')

  if (sel.projectSkeleton) {
    files.push({
      path: 'Cargo.toml',
      content: render(T.CARGO_TOML_TPL, {
        packageName,
        vendorHal: sel.vendorHal,
        halGit: HAL_GIT,
        halRev: config.hal?.rev || HAL_REV,
        halFeatures: feats.map((f) => `"${f}"`).join(', '),
        embassy,
      }),
    })
    files.push({
      path: 'rust-toolchain.toml',
      content: render(T.RUST_TOOLCHAIN_TPL, { nightly, target: data.chip.target }),
    })
    files.push({
      path: '.cargo/config.toml',
      content: render(T.CARGO_CONFIG_TPL, {
        target: data.chip.target,
        jsonTarget,
        jsonTargetFile: 'riscv32ec-unknown-none-elf.json',
      }),
    })
    files.push({ path: 'build.rs', content: render(T.BUILD_RS_TPL, {}) })
    files.push({ path: '.gitignore', content: T.GITIGNORE_TPL })
    if (jsonTarget) files.push({ path: 'riscv32ec-unknown-none-elf.json', content: T.TARGET_RISCV32EC_TPL })
  }

  // ---------- src/generated/* ----------
  files.push(...renderCoreGenerated(config, data, sel, usages, embassy))

  // ---------- main.rs（始终生成，用户区） ----------
  files.push({
    path: 'src/main.rs',
    content: render(T.MAIN_TPL, {
      embassy,
      debugPrint,
      clockUsed: sel.clock,
    }),
  })

  // ---------- cube.json（始终生成，配置回读） ----------
  files.push({ path: 'cube.json', content: JSON.stringify(config, null, 2) + '\n' })

  // ---------- README ----------
  if (sel.readme) {
    const desc: Record<string, string> = {
      'Cargo.toml': '工程清单与依赖（ch32-hal 及运行时 crate）',
      'rust-toolchain.toml': '工具链锁定（nightly/stable 由芯片 target 决定）',
      '.cargo/config.toml': '构建目标与 wlink runner',
      'build.rs': '注入 -Tlink.x 链接参数',
      '.gitignore': 'Git 忽略规则（构建产物 target/）',
      'riscv32ec-unknown-none-elf.json': 'tier-3 自定义 target 描述',
      'cube.json': 'ch32-rs-CubeMX 配置回读（可重新导入）',
      'src/main.rs': '用户代码入口（不会被重新导出覆盖）',
      'src/generated/mod.rs': '生成模块聚合（init 返回 Generated）',
      'src/generated/clock.rs': '时钟树 → RCC 配置',
      'src/generated/pins.rs': 'GPIO 引脚初始化',
      'src/generated/exti.rs': 'EXTI 输入初始化',
      'src/generated/usart.rs': 'USART 初始化',
      'src/generated/spi.rs': 'SPI 初始化',
      'src/generated/i2c.rs': 'I2C 初始化',
      'src/generated/adc.rs': 'ADC 初始化（通道=引脚字段）',
    }
    files.push({
      path: 'README.md',
      content: render(T.README_TPL, {
        projectName: config.projectName,
        chip: data.chip.chip,
        chipPackage: data.chip.package,
        target: data.chip.target,
        packageName,
        halRev: config.hal?.rev || HAL_REV,
        nightly,
        embassy,
        vendorHal: sel.vendorHal,
        files: files.map((f) => ({ path: f.path, desc: desc[f.path] ?? '' })),
      }),
    })
  }

  return { files, errors: [] }
}

function gpioCount(config: ProjectConfig, data: DeviceData): number {
  return plainGpioPins(config, data).length
}

function gpioArgs(config: ProjectConfig, data: DeviceData): string {
  return plainGpioPins(config, data)
    .map((a) => `p.${a.pin}`)
    .join(', ')
}
