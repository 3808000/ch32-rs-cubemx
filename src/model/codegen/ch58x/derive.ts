// ch58x 生成上下文派生：引脚归类、外设 usage、生成期错误、时钟决策与字段命名。
// 契约：只做纯计算，不渲染模板、不写文件（docs/CH58X_BACKEND_CONTRACT.md §1）。
import type { ClockPreset, Conflict, DeviceData, GeneratedFile, PinAssignment, ProjectConfig } from '@/model/types'
import { labelToIdent } from '@/model/conflicts'
import { computeClock, matchPreset, mergeClockConfig } from '@/model/clock'
import { enabledUsage, type PeripheralUsage } from '@/model/peripherals'
import { identWithPrefix, pinIdent } from '../util'

/** Generated 聚合字段：名字 / 类型 / init 表达式（不含字段名与冒号）。 */
export interface ModField {
  name: string
  type: string
  init: string
}

/** 单个生成区模块（usart/spi/i2c/adc）：文件 + 聚合字段。 */
export interface PeriModule {
  file: GeneratedFile
  module: string
  fields: ModField[]
}

/** 时钟生成决策：预设方法或显式 ClockSrc::PLL(div)；两者都不成立时带 error。 */
export interface ClockPlan {
  error?: Conflict
  /** 命中预设时数据层 presetConstMap 的原样语句（不含结尾分号） */
  presetConst?: string
  presetLabel?: string
  /** 非预设 PLL 的 VCO 分频（480MHz ÷ div） */
  div?: number
  sysclkMhz: number
}

/** ch58x-hal 只实现 SPI0（CH583 的 SPI1 未在 HAL 中启用）。 */
export const CH58X_SPI_ID = 'SPI0'

/** 引脚单例类型（ch58x-hal 无 ch32 的 hal::Peri 包装，直接用具名单例）。 */
export function pinType(pin: string): string {
  return `hal::peripherals::${pin}`
}

export function validPinFilter(data: DeviceData): (a: PinAssignment) => boolean {
  const valid = new Set(data.chip.pins.map((p) => p.name))
  return (a) => valid.has(a.pin)
}

/**
 * 可生成 GPIO 的引脚：INPUT/OUTPUT（AF 由外设构造器消费；ANALOG 归 ADC；RESERVED 跳过）。
 * ch58x 不生成 EXTI 模块（HAL 无 pin→EXTI 通道模型）：INPUT/OUTPUT 一律按普通 GPIO 生成，
 * 避免静默丢失引脚；带 EXTI 开关的引脚会先被共享冲突规则（无通道）拦截。
 */
export function gpioPins(config: ProjectConfig, data: DeviceData): PinAssignment[] {
  const valid = validPinFilter(data)
  return (config.pins ?? []).filter((a) => (a.mode === 'INPUT' || a.mode === 'OUTPUT') && valid(a))
}

export function gpioCount(config: ProjectConfig, data: DeviceData): number {
  return gpioPins(config, data).length
}

/** GPIO 字段名：标签优先，其次引脚名；统一加工程前缀并 snake_case（与 ch32 pins.ts 一致）。 */
export function fieldIdent(config: ProjectConfig, a: PinAssignment): string {
  return identWithPrefix(config, a.label ? labelToIdent(a.label) : pinIdent(a.pin))
}

/** SPI0 的 NSS 引脚（若分配）：HAL 不消费 NSS，生成独立软件片选 Output。 */
export interface NssPin {
  pin: string
  field: string
  typeName: string
  initFn: string
}

export function spiNssPin(config: ProjectConfig, usages: PeripheralUsage[]): NssPin | null {
  const u = enabledUsage(usages, 'spi').find((x) => x.id === CH58X_SPI_ID)
  const nss = u?.pins.find((p) => p.role === 'nss')
  if (!u || !nss) return null
  const base = `${u.id.toLowerCase()}_nss`
  const label = (config.pins ?? []).find((a) => a.pin === nss.pin)?.label
  return {
    pin: nss.pin,
    field: identWithPrefix(config, label ? labelToIdent(label) : base),
    typeName: `${u.id.charAt(0).toUpperCase()}${u.id.slice(1).toLowerCase()}Nss`,
    initFn: `init_${u.id.toLowerCase()}_nss`,
  }
}

/** remap 编号 → const 泛型实参（0→false，1→true；数据层只有 0/1 两档）。 */
export function remapConst(remap: number | null | undefined): 'false' | 'true' {
  return remap === 1 ? 'true' : 'false'
}

// ---------- 时钟决策（D3） ----------

const PLL_DIV_MIN = 2
const PLL_DIV_MAX = 31

function presetConstOf(data: DeviceData, preset: ClockPreset): string | undefined {
  const raw = data.clock.codegen.presetConstMap[preset.id]
  if (!raw) return undefined
  return raw.trim().replace(/;\s*$/, '')
}

/**
 * 时钟 → 生成配方：
 * 1) 命中预设且 presetConstMap 有方法名 → config.clock.use_pll_XXmhz()；
 * 2) 否则 source=PLL 且 div 合法（2..=31）→ config.clock.mux = ClockSrc::PLL(div)；
 * 3) 其余（HSE/CK32K 源、非法 div）→ CLOCK_PRESET_UNAVAILABLE error。
 * div=32 会被 5 位寄存器截断为 0（等同关闭 HCLK），数据层已移除，这里再做纵深防御。
 */
export function resolveClock(config: ProjectConfig, data: DeviceData): ClockPlan {
  const spec = data.clock
  const cfg = mergeClockConfig(spec, config.clock)
  const f = computeClock(spec, cfg)
  const preset = matchPreset(spec, cfg)
  if (preset) {
    const presetConst = presetConstOf(data, preset)
    if (presetConst) {
      return { presetConst, presetLabel: preset.label, sysclkMhz: f.sysclkMhz }
    }
  }

  if (cfg.source === 'PLL') {
    const div = cfg.pll?.div
    if (typeof div !== 'number' || div < PLL_DIV_MIN || div > PLL_DIV_MAX) {
      return {
        error: {
          code: 'CLOCK_PRESET_UNAVAILABLE',
          level: 'error',
          message: `ch58x-hal 的 PLL 分频必须为 ${PLL_DIV_MIN}..=${PLL_DIV_MAX}（5 位寄存器，32 会截断为 0 等同关闭 HCLK）；当前 div=${String(div ?? '未配置')}，无法生成时钟初始化`,
        },
        sysclkMhz: f.sysclkMhz,
      }
    }
    return { div, sysclkMhz: f.sysclkMhz }
  }

  return {
    error: {
      code: 'CLOCK_PRESET_UNAVAILABLE',
      level: 'error',
      message:
        `ch58x-hal 后端仅生成 PLL 时钟（固定 480MHz VCO ÷ div，或 use_pll_XXmhz 预设）：` +
        `当前时钟源为 ${cfg.source}。HSE 直连 32MHz 需要 div=1，HAL 明确 assert 拒绝（src/sysctl.rs）；` +
        `CK32K 直连未建模。请在时钟页选择 PLL 预设或显式 PLL 分频`,
    },
    sysclkMhz: f.sysclkMhz,
  }
}

// ---------- 生成期错误（补充 checkConflicts 之外的 ch58x 专属规则） ----------

export function generationErrors(config: ProjectConfig, data: DeviceData, usages: PeripheralUsage[]): Conflict[] {
  const out: Conflict[] = []
  const valid = validPinFilter(data)

  // D4：HAL 无开漏 API（gpio.rs 只有 OutputDrive::_5mA/_20mA 推挽）
  for (const a of config.pins ?? []) {
    if (!valid(a)) continue
    if (a.mode === 'OUTPUT' && a.params?.outputType === 'OPEN_DRAIN') {
      out.push({
        code: 'TARGET_FEATURE_UNSUPPORTED',
        level: 'error',
        message: `${a.pin} 配置为开漏输出（OPEN_DRAIN），但 ch58x-hal 没有开漏驱动 API（src/gpio.rs 只有 OutputDrive::_5mA/_20mA 推挽），无法生成；请改为推挽输出`,
        pins: [a.pin],
      })
    }
  }

  // D5：UART 构造需要 peri + TX + RX（缺任一无法调用 Uart::new）
  for (const u of enabledUsage(usages, 'usart')) {
    if (!u.pins.some((p) => p.role === 'tx')) {
      out.push({ code: 'USART_TX_MISSING', level: 'error', message: `${u.id} 已启用但未分配 TX 引脚，无法生成初始化代码`, peripheral: u.id })
    }
    if (!u.pins.some((p) => p.role === 'rx')) {
      out.push({ code: 'USART_RX_MISSING', level: 'error', message: `${u.id} 已启用但未分配 RX 引脚，无法生成初始化代码`, peripheral: u.id })
    }
  }

  // D6：SPI0 至少要 SCK + 一个数据方向（new / new_txonly / new_rxonly）
  for (const u of enabledUsage(usages, 'spi')) {
    const hasSck = u.pins.some((p) => p.role === 'sck')
    const hasMosi = u.pins.some((p) => p.role === 'mosi')
    const hasMiso = u.pins.some((p) => p.role === 'miso')
    if (!hasSck) {
      out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${u.id} 已启用但缺 SCK 引脚，无法生成初始化代码`, peripheral: u.id })
    }
    if (!hasMosi && !hasMiso) {
      out.push({
        code: 'REMAP_UNDEFINED',
        level: 'error',
        message: `${u.id} 已启用但 MOSI/MISO 都未分配（new_txonly/new_rxonly 至少需要一个数据引脚），无法生成初始化代码`,
        peripheral: u.id,
      })
    }
  }

  // D7：I2C 构造需要 SCL + SDA
  for (const u of enabledUsage(usages, 'i2c')) {
    for (const role of ['scl', 'sda'] as const) {
      if (!u.pins.some((p) => p.role === role)) {
        out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${u.id} 已启用但缺 ${role.toUpperCase()} 引脚，无法生成初始化代码`, peripheral: u.id })
      }
    }
  }

  return out
}

// ---------- 警告（不阻止导出；供 README / HTML 报告展示） ----------
//
// 注意：CodegenResult.errors 的任何条目都会阻止导出（services/projectExport 按 length 判定），
// 因此 warning 级提示不放进 errors（verify-build 默认 debugPrint:true，绝不能阻断构建），
// 而是通过本函数交给 README/报告做诚实标注。

export function featureWarnings(config: ProjectConfig): Conflict[] {
  const out: Conflict[] = []
  if (config.features?.debugPrint) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message:
        'ch58x-hal 后端不支持 SDI 调试打印（ch32-hal 的 hal::debug::SDIPrint 仅 CH32V 系），已忽略 debugPrint 设置；CH58x 调试请使用 WCH MRS',
    })
  }
  if ((config.interrupts ?? []).length > 0) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message: 'ch58x 后端不生成 NVIC/中断绑定（HAL 无 bind_interrupts），工程中的中断配置（含未启用条目）已忽略',
    })
  }
  if ((config.dma ?? []).length > 0) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message: 'ch58x-hal 无 DMA 驱动（src/dma.rs 仅 NoDma 占位），工程中的 DMA 配置已忽略',
    })
  }
  if ((config.pins ?? []).some((p) => p.params?.exti?.enabled)) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message: 'ch58x 不生成 EXTI 代码（GPIO 中断按端口聚合，data/exti.json 无 pin→通道映射）；请关闭引脚上的 EXTI 开关',
    })
  }
  return out
}
