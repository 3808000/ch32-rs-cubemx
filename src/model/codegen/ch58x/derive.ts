// ch58x 生成上下文派生：引脚归类、外设 usage、生成期错误、时钟决策与字段命名。
// 契约：只做纯计算，不渲染模板、不写文件（docs/CH58X_BACKEND_CONTRACT.md §1）。
import type { ClockPreset, Conflict, DeviceData, GeneratedFile, PinAssignment, ProjectConfig } from '@/model/types'
import { labelToIdent } from '@/model/conflicts'
import { computeClock, matchPreset, mergeClockConfig } from '@/model/clock'
import { enabledUsage, type PeripheralUsage } from '@/model/peripherals'
import { identWithPrefix, pinIdent } from '../util'
import { BLE_ADV_PAYLOAD_MAX, BLE_NAME_MAX_BYTES, bleAdvPayloadBytes, bleScanRspPayloadBytes, buildBlePlan } from './ble'

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
  /** BLE 档 32K 域走 LSE（M14：ble.clock32k 缺省 lse → config.clock.enable_lse()；
   * 与 stack_init SelRTCClock=0 一致；实机连接建立已验证。lsi 选项不追加） */
  enableLse?: boolean
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

// ---------- BLE 生成期校验（M12，契约 D2/D3/D5/D7） ----------
//
// B2 的 bleRules 是冲突链的第一道闸；这里是 codegen 侧的纵深防御（按 code 去重，
// 规则已报过的不重复报），保证即使规则链未注册也不会生成非法 BLE 工程。

/** BLE 日志串口：上游 5 个示例固定 UART1/PA9（ble-blinky.rs:692-695）。 */
export const BLE_LOG_UART = 'UART1'
export const BLE_LOG_PIN = 'PA9'
/** LSE 32.768kHz 晶振引脚（X32KI/X32KO）：BLE 强制 LSE，不可被用户占用。 */
export const BLE_LSE_PINS = ['PA10', 'PA11'] as const

/**
 * BLE 日志串口是否可用（D5）：UART1 未启用且 PA9 未被任何引脚配置占用。
 * 不可用时 BLE 功能不受影响（hal::println 在无默认串口时静默），只是没有日志输出。
 */
export function bleLogSerialAvailable(config: ProjectConfig, usages: PeripheralUsage[]): boolean {
  if (!(config.features?.ble ?? false)) return false
  const uart1Used = enabledUsage(usages, 'usart').some((u) => u.id === BLE_LOG_UART)
  const pa9Used = (config.pins ?? []).some((a) => a.pin === BLE_LOG_PIN)
  return !uart1Used && !pa9Used
}

/**
 * BLE 生成期错误兜底（D2/D3/D7）：
 * - BLE 必须 embassy（src/ble/mod.rs:5-6 无条件 use embassy_sync）；
 * - 设备名 UTF-8 >248 或广播/扫描响应负载 >31 字节 → BLE_NAME_TOO_LONG（不截断，直接阻止）；
 * - custom MAC 非 6 段 hex → BLE_MAC_INVALID；
 * - PA10/PA11（LSE 晶振）被占用 → BLE_LSE_PIN_IN_USE。
 * @param existingCodes 冲突链已报出的 code 集合（避免重复条目）
 */
export function bleGenerationErrors(
  config: ProjectConfig,
  existingCodes: ReadonlySet<string> = new Set(),
): Conflict[] {
  const out: Conflict[] = []
  if (!(config.features?.ble ?? false)) return out
  const push = (c: Conflict) => {
    if (!existingCodes.has(c.code)) out.push(c)
  }

  if (!(config.features?.embassy ?? false)) {
    push({
      code: 'BLE_REQUIRES_EMBASSY',
      level: 'error',
      message:
        'BLE 协议栈要求 embassy 运行时：ch58x-hal 的 ble 模块无条件使用 embassy_sync（src/ble/mod.rs:5-6），' +
        'Cargo features 必须是 ["embassy", "ble"]。请启用 embassy 运行时或关闭 BLE',
    })
  }

  const plan = buildBlePlan(config)
  const nameLen = plan.nameBytes.length
  const advLen = bleAdvPayloadBytes(plan)
  const rspLen = bleScanRspPayloadBytes(plan)
  if (nameLen > BLE_NAME_MAX_BYTES || advLen > BLE_ADV_PAYLOAD_MAX || rspLen > BLE_ADV_PAYLOAD_MAX) {
    const roleHint =
      plan.role === 'peripheral'
        ? 'peripheral 的扫描响应还需携带 Tx power 段，完整名最多 26 字节'
        : plan.role === 'broadcaster'
          ? 'broadcaster 的扫描响应只放完整名，最多 29 字节'
          : ''
    push({
      code: 'BLE_NAME_TOO_LONG',
      level: 'error',
      message:
        `BLE 设备名超出广播包容量：UTF-8 ${nameLen} 字节（GAP 上限 ${BLE_NAME_MAX_BYTES}），` +
        `广播负载 ${advLen}/31 字节、扫描响应负载 ${rspLen}/31 字节。${roleHint}；` +
        '广播/扫描响应 TLV 不会截断生成（避免设备名三处不一致），请缩短设备名',
    })
  }

  if (plan.macSource === 'custom' && !plan.macBytes) {
    push({
      code: 'BLE_MAC_INVALID',
      level: 'error',
      message: `自定义 BLE MAC 格式非法："${config.ble?.mac ?? ''}"；需要 6 段十六进制（人读序，如 AA:BB:CC:DD:EE:FF）`,
    })
  }

  for (const pin of BLE_LSE_PINS) {
    if ((config.pins ?? []).some((a) => a.pin === pin)) {
      push({
        code: 'BLE_LSE_PIN_IN_USE',
        level: 'error',
        pins: [pin],
        message:
          `${pin} 是 LSE 32.768kHz 晶振引脚（X32KI/X32KO）；BLE 强制 LSE（ble/init 硬编码 SelRTCClock=0，` +
          'src/ble/mod.rs:190），启用 BLE 时该引脚不能用作 GPIO 或其他外设',
      })
    }
  }

  return out
}

// ---------- 警告（不阻止导出；供 README / HTML 报告展示） ----------
//
// 注意：CodegenResult.errors 的任何条目都会阻止导出（services/projectExport 按 length 判定），
// 因此 warning 级提示不放进 errors（verify-build 默认 debugPrint:true，绝不能阻断构建），
// 而是通过本函数交给 README/报告做诚实标注。

/** featureWarnings 的上下文：usages/logSerial 仅在 BLE 工程里有意义（可选，保持旧调用兼容）。 */
export interface FeatureWarningContext {
  usages?: PeripheralUsage[]
  /** BLE 日志串口是否可用（bleLogSerialAvailable）；undefined=不评估 */
  logSerial?: boolean
}

export function featureWarnings(config: ProjectConfig, ctx: FeatureWarningContext = {}): Conflict[] {
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
  // D5：BLE 日志串口被占用 → 不生成 UartTx/set_default_serial，BLE 功能不受影响
  if ((config.features?.ble ?? false) && ctx.logSerial === false) {
    out.push({
      code: 'BLE_LOG_SERIAL_UNAVAILABLE',
      level: 'warning',
      message:
        `BLE 日志串口不可用：UART1 已启用或 ${BLE_LOG_PIN} 已被占用，未生成 UartTx/set_default_serial；` +
        'BLE 功能不受影响，hal::println 在无默认串口时静默',
    })
  }
  // D7：BLE 温度采样回调会临时借用 ADC（ble/mod.rs:230-254 temperature_raw）
  if ((config.features?.ble ?? false) && ctx.usages && enabledUsage(ctx.usages, 'adc').length > 0) {
    out.push({
      code: 'BLE_ADC_SHARED',
      level: 'warning',
      message:
        'BLE 的温度采样回调（temperature_raw）会临时 steal ADC 并恢复寄存器，与用户 ADC 共享外设；' +
        'BLE 开启时 ADC 读数可能被短暂抢占，请评估采样时序',
    })
  }
  return out
}
