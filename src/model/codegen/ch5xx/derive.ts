// ch5xx 生成上下文派生：引脚归类、外设 usage、生成期错误、时钟决策与字段命名。
// 契约：docs/CH5XX_BACKEND_CONTRACT.md D1/D2/D4/D5/D6；只做纯计算，不渲染模板、不写文件。
//
// 与 legacy ch58x/derive.ts 的关键差异（全部来自 reference/ch5xx-hal @ 875651b6）：
// - 时钟 API 是 `hal::rcc::Config`（预设为 `Config::PLL_60MHZ` 关联常量，**不存在** `rcc::presets::*` 模块）；
//   PLL 分频 6..=32（480MHz ÷ div），Fsys 15..80MHz；CH582 无 20MHz 预设 → 显式 Sys::Pll(24)。
// - UART：DL=round(Fsys/(8*baud))，HAL 拒绝 DL==0/>65535 与 >2% 误差 → 生成期 error。
// - SPI：只有全双工 new_blocking；MODE_1/2 与半双工（txonly/rxonly）HAL 均不支持 → 生成期 error；
//   freq==0/>Fsys/2/div>255 时 HAL timing() 返回 Err → 生成期 error。
// - I2C：Fsys 必须 2..=36MHz（CTRL2.FREQ 整 MHz）、freq≤400kHz，否则 HAL 返回 Err → 生成期 error。
// - ADC：SamplingClock/Gain 与旧枚举判别值同序（_3_2MHz→Divide1 … GAIN1_2→Div2）。
import type {
  ClockPreset,
  Conflict,
  DeviceData,
  GeneratedFile,
  PinAssignment,
  ProjectConfig,
} from '@/model/types'
import { labelToIdent } from '@/model/conflicts'
import { computeClock, matchPreset, mergeClockConfig } from '@/model/clock'
import { enabledUsage, type PeripheralUsage } from '@/model/peripherals'
import { identWithPrefix, pinIdent } from '../util'
import {
  BLE_ADV_PAYLOAD_MAX,
  BLE_NAME_MAX_BYTES,
  bleAdvPayloadBytes,
  bleScanRspPayloadBytes,
  buildBlePlan,
} from '../ch58x/ble'

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

/** ch5xx-hal 时钟配方：预设关联常量 / 显式 PLL(div) / HSE 直连（32MHz）。 */
export interface ClockPlan {
  error?: Conflict
  /** 命中预设时数据层 backends['ch5xx-hal'].presetConstMap 的原样语句（不含结尾分号） */
  presetConst?: string
  presetLabel?: string
  /** 非预设 PLL 的 480MHz VCO 分频（6..=32） */
  div?: number
  /** HSE 直连 32MHz（Sys::Direct；CH582 允许 15..80MHz） */
  hseDirect?: boolean
  sysclkMhz: number
  /** BLE 32K 时钟源：lse → enable_lse()（hal::init 后、ble::init 前） */
  clock32k?: 'lse' | 'lsi'
}

/** 数据层 clock.json codegen.backends 的单后端条目（D6）。 */
export interface ClockBackendCodegen {
  presetConstMap?: Record<string, string>
  pllDivRange?: [number, number]
}

/** 读取 ch5xx-hal 的时钟生成数据；缺省时回退 legacy 顶层 presetConstMap（仅作兼容，不推荐）。 */
export function clockBackendCodegen(data: DeviceData): ClockBackendCodegen | undefined {
  const codegen = data.clock.codegen as unknown as {
    backends?: Record<string, ClockBackendCodegen>
  }
  return codegen.backends?.['ch5xx-hal']
}

/** 引脚类型（仅用于类型别名/Generated 字段以外的具名位置）。 */
export function pinType(pin: string): string {
  return `hal::peripherals::${pin}`
}

/**
 * 驱动构造参数/字段的引脚所有权类型。
 * ch5xx-hal 的构造函数全部接收 `Peri<'d, T>`（embassy-hal-internal），而 `hal::Peripherals`
 * 的字段本身就是 `Peri<'static, peripherals::PAx>`——生成函数的形参必须是 Peri，
 * 不能写成具名单例（否则 p.PAx 传入时类型不匹配）。
 */
export function pinPeriType(pin: string): string {
  return `hal::Peri<'static, hal::peripherals::${pin}>`
}

/**
 * 数据层外设 id → ch5xx-hal 的 peripheral 单例名。
 * CH582 的 I2C 在 HAL/metapac 中叫 `I2C0`（数据层沿用 ch58x 的 `I2C`）；UART0-3/SPI0/ADC 同名。
 */
export function halInstance(id: string): string {
  return id === 'I2C' ? 'I2C0' : id
}

export function validPinFilter(data: DeviceData): (a: PinAssignment) => boolean {
  const valid = new Set(data.chip.pins.map((p) => p.name))
  return (a) => valid.has(a.pin)
}

/**
 * 可生成 GPIO 的引脚：INPUT/OUTPUT（AF 由外设构造器消费；ANALOG 归 ADC；RESERVED 跳过）。
 * ch5xx 的模拟引脚由 adc.rs 的 impl_channel 直接接管，**不生成 Input/Output**（D4）。
 */
export function gpioPins(config: ProjectConfig, data: DeviceData): PinAssignment[] {
  const valid = validPinFilter(data)
  return (config.pins ?? []).filter((a) => (a.mode === 'INPUT' || a.mode === 'OUTPUT') && valid(a))
}

export function gpioCount(config: ProjectConfig, data: DeviceData): number {
  return gpioPins(config, data).length
}

/** GPIO 字段名：标签优先，其次引脚名；统一加工程前缀并 snake_case（与 ch32/ch58x pins 一致）。 */
export function fieldIdent(config: ProjectConfig, a: PinAssignment): string {
  return identWithPrefix(config, a.label ? labelToIdent(a.label) : pinIdent(a.pin))
}

/** SPI0 的 NSS 引脚（若分配）：HAL 不消费 NSS，生成独立软件片选 Output（D4）。 */
export interface NssPin {
  pin: string
  field: string
  typeName: string
  initFn: string
}

export const CH5XX_SPI_ID = 'SPI0'

export function spiNssPin(config: ProjectConfig, usages: PeripheralUsage[]): NssPin | null {
  const u = enabledUsage(usages, 'spi').find((x) => x.id === CH5XX_SPI_ID)
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

/** remap 编号 → const 泛型实参（ch5xx 的 REMAP 是 u8：0/1）。 */
export function remapConst(remap: number | null | undefined): string {
  const n = typeof remap === 'number' && Number.isFinite(remap) ? Math.trunc(remap) : 0
  return String(Math.max(0, Math.min(255, n)))
}

// ---------- 参数映射（数据层字符串 → ch5xx-hal 枚举变体） ----------

export function dataBitsVariant(v: string | number | boolean | undefined): string {
  const s = String(v ?? 'DataBits8')
  return /^DataBits[5-8]$/.test(s) ? s : 'DataBits8'
}

export function stopBitsVariant(v: string | number | boolean | undefined): 'Stop1' | 'Stop2' {
  return String(v ?? 'STOP1').toUpperCase() === 'STOP2' ? 'Stop2' : 'Stop1'
}

export function parityVariant(v: string | number | boolean | undefined): 'None' | 'Even' | 'Odd' | 'Mark' | 'Space' {
  const s = String(v ?? 'ParityNone').replace(/^Parity/, '')
  return s === 'Even' || s === 'Odd' || s === 'Mark' || s === 'Space' ? s : 'None'
}

/** SPI 模式 → embedded-hal MODE_0/MODE_3（ch5xx 只支持这两个模式）。
 *  M17 主控修正：与生成期校验同源 spiModeNumber（显式 mode/clockPhase 优先），
 *  避免「校验放行 mode3 但渲染按极性出 MODE_0」的错码（S3 发现）。mode1/2 已由校验报错。 */
export function spiModeVariant(params: Record<string, string | number | boolean>): 'MODE_0' | 'MODE_3' {
  return spiModeNumber(params) === 3 ? 'MODE_3' : 'MODE_0'
}

/** 参数里显式 mode（MODE_1 / 1 / MODE_2…）或 clockPhase 组合 → 0..3；无信息时按极性。 */
export function spiModeNumber(params: Record<string, string | number | boolean>): number {
  const explicit = params.mode
  if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 0 && explicit <= 3) return explicit
  if (typeof explicit === 'string') {
    const m = /^MODE_([0-3])$/i.exec(explicit.trim())
    if (m) return Number(m[1])
  }
  const polarity = String(params.clockPolarity ?? 'IdleLow') === 'IdleHigh' ? 1 : 0
  const phase = String(params.clockPhase ?? 'CaptureOnFirstTransition')
  const second = phase === 'CaptureOnSecondTransition' || phase === '2' || phase === 'Second'
  return polarity * 2 + (second ? 1 : 0)
}

export function i2cDutyVariant(v: string | number | boolean | undefined): 'Ratio2to1' | 'Ratio16to9' {
  return String(v ?? 'Duty2_1') === 'Duty16_9' ? 'Ratio16to9' : 'Ratio2to1'
}

/** ADC SamplingClock（旧枚举判别值同序：_3_2MHz=0→Divide1、_8MHz=1→Divide2、_5_33MHz=2→Divide3、_4MHz=3→Divide4）。 */
export function sampleClockVariant(v: string | number | boolean | undefined): string {
  switch (String(v ?? '_3_2MHz')) {
    case '_8MHz':
      return 'Divide2'
    case '_5_33MHz':
      return 'Divide3'
    case '_4MHz':
      return 'Divide4'
    default:
      return 'Divide1'
  }
}

export function adcGainVariant(v: string | number | boolean | undefined): string {
  switch (String(v ?? 'GAIN1_2')) {
    case 'GAIN1_4':
      return 'Div4'
    case 'GAIN1':
      return 'Unity'
    case 'GAIN2':
      return 'X2'
    default:
      return 'Div2'
  }
}

// ---------- 时钟决策（D4/D5） ----------

const DEFAULT_PLL_DIV: [number, number] = [6, 32]
const FSYSTEM_MIN_MHZ = 15
const FSYSTEM_MAX_MHZ = 80

function presetConstOf(data: DeviceData, preset: ClockPreset): string | undefined {
  const raw = clockBackendCodegen(data)?.presetConstMap?.[preset.id]
  if (!raw) return undefined
  return raw.trim().replace(/;\s*$/, '')
}

function pllDivRange(data: DeviceData): [number, number] {
  const r = clockBackendCodegen(data)?.pllDivRange
  return Array.isArray(r) && r.length === 2 && r[0] <= r[1] ? [r[0], r[1]] : DEFAULT_PLL_DIV
}

function fsysError(fsysMhz: number): Conflict | undefined {
  if (!(fsysMhz >= FSYSTEM_MIN_MHZ && fsysMhz <= FSYSTEM_MAX_MHZ)) {
    return {
      code: 'CLOCK_PRESET_UNAVAILABLE',
      level: 'error',
      message:
        `ch5xx-hal 的 Fsys 必须落在 ${FSYSTEM_MIN_MHZ}..=${FSYSTEM_MAX_MHZ}MHz（数据手册 6.3）：` +
        `当前为 ${fsysMhz}MHz，无法生成时钟初始化`,
    }
  }
  return undefined
}

/**
 * 时钟 → 生成配方（ch5xx D4）：
 * 1) 命中预设且 backends['ch5xx-hal'].presetConstMap 有常量 → `hal::rcc::Config::PLL_xxMHZ`；
 * 2) 预设无常量（CH582 无 20MHz 预设）→ 用预设的 div 走显式 `Config::new(Osc::Hse32, Sys::Pll(div))`；
 * 3) source=PLL 且 div 在 6..=32、Fsys 15..=80 → 显式 PLL(div)；
 * 4) source=HSE（32MHz 直连）→ `Sys::Direct`（Fsys 15..=80 允许）；
 * 5) 其余（CK32K 仅显示源等）→ CLOCK_PRESET_UNAVAILABLE。
 */
export function resolveClock(config: ProjectConfig, data: DeviceData): ClockPlan {
  const spec = data.clock
  const cfg = mergeClockConfig(spec, config.clock)
  const f = computeClock(spec, cfg)
  const preset = matchPreset(spec, cfg)

  if (preset) {
    const presetConst = presetConstOf(data, preset)
    if (presetConst) {
      const err = fsysError(f.sysclkMhz)
      if (err) return { error: err, sysclkMhz: f.sysclkMhz }
      return { presetConst, presetLabel: preset.label, sysclkMhz: f.sysclkMhz }
    }
    // 无常量但有 match.div：20MHz（480÷24）等走显式路径
    if (cfg.source === 'PLL' && typeof preset.match.div === 'number') {
      const [lo, hi] = pllDivRange(data)
      const div = preset.match.div
      if (div < lo || div > hi) {
        return {
          error: {
            code: 'CLOCK_PRESET_UNAVAILABLE',
            level: 'error',
            message: `预设 ${preset.label} 的 PLL 分频 ${div} 超出 ch5xx-hal 合法范围 ${lo}..=${hi}（480MHz ÷ div）`,
          },
          sysclkMhz: f.sysclkMhz,
        }
      }
      const err = fsysError(f.sysclkMhz)
      if (err) return { error: err, sysclkMhz: f.sysclkMhz }
      return { div, presetLabel: preset.label, sysclkMhz: f.sysclkMhz }
    }
  }

  if (cfg.source === 'PLL') {
    const [lo, hi] = pllDivRange(data)
    const div = cfg.pll?.div
    if (typeof div !== 'number' || !Number.isFinite(div) || div < lo || div > hi) {
      return {
        error: {
          code: 'CLOCK_PRESET_UNAVAILABLE',
          level: 'error',
          message:
            `ch5xx-hal 的 PLL 分频必须为 ${lo}..=${hi}（480MHz VCO ÷ div → Fsys ${480 / hi}..=${480 / lo}MHz）：` +
            `当前 div=${String(div ?? '未配置')}，无法生成时钟初始化`,
        },
        sysclkMhz: f.sysclkMhz,
      }
    }
    const err = fsysError(f.sysclkMhz)
    if (err) return { error: err, sysclkMhz: f.sysclkMhz }
    return { div, sysclkMhz: f.sysclkMhz }
  }

  if (cfg.source === 'HSE') {
    const err = fsysError(f.sysclkMhz)
    if (err) return { error: err, sysclkMhz: f.sysclkMhz }
    return { hseDirect: true, sysclkMhz: f.sysclkMhz }
  }

  return {
    error: {
      code: 'CLOCK_PRESET_UNAVAILABLE',
      level: 'error',
      message:
        'ch5xx-hal 后端仅生成 PLL（480MHz ÷ 6..32）或 HSE 32MHz 直连：' +
        `当前时钟源为 ${cfg.source}（CK32K 仅为显示源，HAL 无 SYSCLK 预设）。请在时钟页选择 PLL 预设/分频或 HSE`,
    },
    sysclkMhz: f.sysclkMhz,
  }
}

/** 当前配置的 Fsys（Hz）；时钟非法时返回 0，调用方应跳过外设派生。 */
export function systemClockHz(config: ProjectConfig, data: DeviceData): number {
  const cfg = mergeClockConfig(data.clock, config.clock)
  const f = computeClock(data.clock, cfg)
  return Number.isFinite(f.sysclkMhz) && f.sysclkMhz > 0 ? Math.round(f.sysclkMhz * 1e6) : 0
}

// ---------- 生成期错误（D5） ----------

/**
 * ch5xx 专属生成期错误（在 checkConflicts 之外）：
 * - 开漏（HAL 无 API）；
 * - UART 缺 TX/RX、DL 不可表示/误差 >2%；
 * - SPI 缺 SCK、半双工/MODE_1/2、频率不可表示；
 * - I2C 缺 SCL/SDA、Fsys 不在 2..36MHz、SCL>400kHz。
 * 全部带 peripheral 字段，preflight/TabStrip 据此定位到外设页。
 */
export function generationErrors(config: ProjectConfig, data: DeviceData, usages: PeripheralUsage[]): Conflict[] {
  const out: Conflict[] = []
  const valid = validPinFilter(data)
  const fsys = systemClockHz(config, data)

  // 开漏：ch5xx gpio Output 只有推挽（Speed 是驱动电流，不是开漏）
  for (const a of config.pins ?? []) {
    if (!valid(a)) continue
    if (a.mode === 'OUTPUT' && a.params?.outputType === 'OPEN_DRAIN') {
      out.push({
        code: 'TARGET_FEATURE_UNSUPPORTED',
        level: 'error',
        message: `${a.pin} 配置为开漏输出（OPEN_DRAIN），但 ch5xx-hal 的 gpio::Output 只有推挽驱动（Speed::Low/High 表示 5/20mA），无法生成；请改为推挽输出`,
        pins: [a.pin],
      })
    }
  }

  // UART：peri + RX + TX 必填；DL=round(Fsys/(8*baud))，HAL 拒绝 0/超 16 位/误差>2%
  for (const u of enabledUsage(usages, 'usart')) {
    if (!u.pins.some((p) => p.role === 'tx')) {
      out.push({ code: 'USART_TX_MISSING', level: 'error', message: `${u.id} 已启用但未分配 TX 引脚，无法生成初始化代码`, peripheral: u.id })
    }
    if (!u.pins.some((p) => p.role === 'rx')) {
      out.push({ code: 'USART_RX_MISSING', level: 'error', message: `${u.id} 已启用但未分配 RX 引脚，无法生成初始化代码`, peripheral: u.id })
    }
    const baud = Number(u.params.baudrate ?? 115200)
    if (fsys > 0) {
      if (!(baud > 0) || !Number.isFinite(baud)) {
        out.push({
          code: 'BAUDRATE_UNREPRESENTABLE',
          level: 'error',
          peripheral: u.id,
          message: `${u.id} 的波特率必须大于 0（当前 ${String(u.params.baudrate)}）；ch5xx-hal 的 Uart 配置会返回 ConfigError`,
        })
      } else {
        const denom = 8 * baud
        const dl = Math.floor((fsys + denom / 2) / denom)
        const actual = dl > 0 ? fsys / (8 * dl) : 0
        const errorPct = Math.abs(actual - baud) / baud * 100
        if (dl === 0 || dl > 0xffff || errorPct > 2) {
          const reason =
            dl === 0
              ? `DL=${dl}（波特率过高）`
              : dl > 0xffff
                ? `DL=${dl} 超过 16 位上限 65535（波特率过低）`
                : `误差 ${errorPct.toFixed(2)}% 超过 HAL 的 2% 上限（实际 ${Math.round(actual)}）`
          out.push({
            code: 'BAUDRATE_UNREPRESENTABLE',
            level: 'error',
            peripheral: u.id,
            message: `${u.id} 在 Fsys=${Math.round(fsys / 1e6)}MHz 下无法表示波特率 ${baud}：${reason}；HAL configure() 会返回 ConfigError`,
          })
        }
      }
    }
  }

  // SPI：全双工 new_blocking 必需 SCK+MOSI+MISO；MODE_1/2 与半双工 HAL 明确不支持
  for (const u of enabledUsage(usages, 'spi')) {
    const hasSck = u.pins.some((p) => p.role === 'sck')
    const hasMosi = u.pins.some((p) => p.role === 'mosi')
    const hasMiso = u.pins.some((p) => p.role === 'miso')
    if (!hasSck) {
      out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${u.id} 已启用但缺 SCK 引脚，无法生成初始化代码`, peripheral: u.id })
    }
    if (!hasMosi || !hasMiso) {
      out.push({
        code: 'SPI_HALFDUPLEX_UNSUPPORTED',
        level: 'error',
        peripheral: u.id,
        message:
          `${u.id} 只分配了 ${hasMosi ? 'MOSI' : ''}${!hasMosi && hasMiso ? 'MISO' : ''}：` +
          'ch5xx-hal 只有全双工 Spi::new_blocking（无 txonly/rxonly 构造），请同时分配 MOSI 与 MISO',
      })
    }
    const mode = spiModeNumber(u.params)
    if (mode === 1 || mode === 2) {
      out.push({
        code: 'SPI_MODE_UNSUPPORTED',
        level: 'error',
        peripheral: u.id,
        message: `${u.id} 请求 SPI mode ${mode}；ch5xx-hal 控制器只实现 MODE_0/MODE_3（clock_mode() 对其它组合返回 ConfigError::Mode）`,
      })
    }
    const freq = Number(u.params.frequency ?? 1_000_000)
    if (fsys > 0) {
      const divisor = freq > 0 ? Math.floor(fsys / freq) : 0
      if (!(freq > 0) || freq > fsys / 2 || divisor > 255) {
        const why =
          !(freq > 0)
            ? '频率必须大于 0'
            : freq > fsys / 2
              ? `超过 Fsys/2（${Math.round(fsys / 2 / 1e3)}kHz）`
              : `分频 ${divisor} 超过 8 位上限 255（请求过低）`
        out.push({
          code: 'SPI_FREQUENCY_UNREPRESENTABLE',
          level: 'error',
          peripheral: u.id,
          message: `${u.id} 无法产生 ${String(u.params.frequency)}Hz：${why}；ch5xx-hal timing() 会返回 ConfigError::Frequency`,
        })
      }
    }
  }

  // I2C：SCL+SDA 必需；Fsys 2..36MHz、SCL≤400kHz（与 HAL timing() 一致）
  for (const u of enabledUsage(usages, 'i2c')) {
    for (const role of ['scl', 'sda'] as const) {
      if (!u.pins.some((p) => p.role === role)) {
        out.push({ code: 'REMAP_UNDEFINED', level: 'error', message: `${u.id} 已启用但缺 ${role.toUpperCase()} 引脚，无法生成初始化代码`, peripheral: u.id })
      }
    }
    if (fsys > 0) {
      const mhz = Math.floor(fsys / 1e6)
      const freq = Number(u.params.frequency ?? 100_000)
      if (mhz < 2 || mhz > 36) {
        out.push({
          code: 'I2C_CLOCK_OUT_OF_RANGE',
          level: 'error',
          peripheral: u.id,
          message: `${u.id} 的内核时钟 Fsys=${mhz}MHz 超出 ch5xx-hal 的 I2C CTRL2.FREQ 范围（2..=36MHz）`,
        })
      }
      if (!(freq > 0) || freq > 400_000) {
        out.push({
          code: 'I2C_CLOCK_OUT_OF_RANGE',
          level: 'error',
          peripheral: u.id,
          message: `${u.id} 的 SCL 请求 ${String(freq)}Hz 非法：ch5xx-hal 只接受 1..=400kHz（ConfigError::Frequency）`,
        })
      } else if (mhz >= 2 && mhz <= 36) {
        const fast = freq > 100_000
        const factor = !fast ? 2 : i2cDutyVariant(u.params.duty) === 'Ratio16to9' ? 25 : 3
        const ccr = Math.max(Math.floor(fsys / (freq * factor)), fast ? 1 : 4)
        if (ccr > 0x0fff) {
          out.push({
            code: 'I2C_CLOCK_OUT_OF_RANGE',
            level: 'error',
            peripheral: u.id,
            message: `${u.id} 的 SCL 请求 ${String(freq)}Hz 需要 CCR=${ccr}，超过 12 位上限 0xFFF（HAL ConfigError::Frequency）`,
          })
        }
      }
    }
  }

  return out
}

// ---------- BLE 生成期校验（D1/D3） ----------

/** BLE 日志串口：shim 的 set_default_serial 只接 UART1，示例固定 PA9。 */
export const BLE_LOG_UART = 'UART1'
export const BLE_LOG_PIN = 'PA9'
/** LSE 32.768kHz 晶振引脚（X32KI/X32KO）：BLE 强制 LSE，不可被用户占用。 */
export const BLE_LSE_PINS = ['PA10', 'PA11'] as const

/** BLE 日志串口是否可用：UART1 未启用且 PA9 未被占用。 */
export function bleLogSerialAvailable(config: ProjectConfig, usages: PeripheralUsage[]): boolean {
  if (!(config.features?.ble ?? false)) return false
  const uart1Used = enabledUsage(usages, 'usart').some((u) => u.id === BLE_LOG_UART)
  const pa9Used = (config.pins ?? []).some((a) => a.pin === BLE_LOG_PIN)
  return !uart1Used && !pa9Used
}

/**
 * BLE 生成期兜底：结构约束与 legacy 相同（embassy 配置开关、设备名/广播负载、MAC、LSE 引脚），
 * 但措辞指向 ch5xx shim（HAL 不提供 BLE；ch5xx-ble 是 busy-poll shim）。
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
        'BLE 协议栈在工程配置层仍要求 embassy 开关（store 互锁 ble⇒embassy）：ch5xx BLE 档以 busy-poll 运行时生成，' +
        '不启用 hal 的 embassy/time-driver feature。请启用 embassy 运行时或关闭 BLE',
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
          `${pin} 是 LSE 32.768kHz 晶振引脚（X32KI/X32KO）；BLE 强制 LSE（clock32k=lse 缺省时生成 ch5xx_ble::enable_lse() + SelRTCClock=0），` +
          '启用 BLE 时该引脚不能用作 GPIO 或其他外设',
      })
    }
  }

  return out
}

// ---------- 警告（不阻止导出；供 README/报告展示） ----------

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
        'ch5xx-hal 后端不支持 SDI 调试打印（ch32-hal 的 hal::debug::SDIPrint 仅 CH32V 系），已忽略 debugPrint 设置；CH58x 调试请使用 WCH MRS',
    })
  }
  if ((config.interrupts ?? []).length > 0) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message: 'ch5xx 后端不生成 NVIC/中断绑定（工程骨架不含 bind_interrupts），工程中的中断配置（含未启用条目）已忽略',
    })
  }
  if ((config.dma ?? []).length > 0) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message: 'ch5xx-hal 的 DMA 是 SPI0/ADC 外设本地引擎（无通用通道控制器），工程中的通用 DMA 配置已忽略',
    })
  }
  if ((config.pins ?? []).some((p) => p.params?.exti?.enabled)) {
    out.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'warning',
      message: 'ch5xx 不生成 EXTI 代码（GPIO 中断按端口聚合，data/exti.json 无 pin→通道映射）；请关闭引脚上的 EXTI 开关',
    })
  }
  if ((config.features?.ble ?? false) && ctx.logSerial === false) {
    out.push({
      code: 'BLE_LOG_SERIAL_UNAVAILABLE',
      level: 'warning',
      message:
        `BLE 日志串口不可用：UART1 已启用或 ${BLE_LOG_PIN} 已被占用，未生成 UartTx/set_default_serial；` +
        'BLE 功能不受影响，ble::println! 在无默认串口时静默',
    })
  }
  if ((config.features?.ble ?? false) && ctx.usages && enabledUsage(ctx.usages, 'adc').length > 0) {
    out.push({
      code: 'BLE_ADC_SHARED',
      level: 'warning',
      message:
        'BLE 的温度采样回调（ch5xx_ble::temperature_raw）会临时 steal ADC 并恢复寄存器，与用户 ADC 共享外设；' +
        'BLE 开启时 ADC 读数可能被短暂抢占，请评估采样时序',
    })
  }
  return out
}