// 时钟领域类型：配置模型（ClockConfig）与数据层 schema（ClockData）及频率计算结果。
import type { ConflictLevel } from './conflict'

export interface ClockConfig {
  source: string // 'HSI' | 'HSE' | 'PLL'
  hxtalMhz?: number // HSE 晶振频率
  pllSource?: string // 'HSI' | 'HSE'
  pll?: Record<string, number> // PLL 参数（V003 固定 mul=2）
  ahb: number
  apb1: number
  apb2: number
  adc?: string // ADC 时钟源 id
  /** ADC CTLR3.CLK_DIV 原始寄存器值（M15，仅 peripheralClocks.adc.clkDiv.programmable 芯片）：
   *  缺省=HAL 0b11；全局单值作用于所有启用 ADC 实例；raw 语义未核实芯片 UI 带警告。
   *  不进 solvePll/resolveClockIssues 搜索空间；预设应用重置为缺省（除非 ADC 节点锁定）。 */
  adcClkDiv?: number
  /** 锁定的时钟节点 id（M3）：预设/解算跳过这些节点，UI 控件置灰。可选，向后兼容。 */
  locked?: string[]
}

export interface ClockSource {
  id: string
  label: string
  freqMhz?: number
  hxtal?: { min: number; max: number; default: number }
  pll?: boolean
}

export interface ClockParamSpec {
  key: string
  label: string
  kind: 'select'
  options: number[]
  default: number
  fixed?: boolean // 固定值（如 V003 PLL ×2），UI 置灰
  /** 参数按 PLL 源的上限（M14，可选）：如 V307 prediv 在 HSI 源下最大 2（HSE 源 16） */
  maxBySource?: Record<string, number>
}

export interface ClockDividerSpec {
  options: number[]
  maxMhz: number
  default: number
}

export interface ClockPreset {
  id: string
  label: string
  match: {
    source: string
    pllSource?: string
    hxtalMhz?: number
    mul?: number
    div?: number
    /** prediv 等其余 PLL 参数键也可出现在预设 match 中（V103/V307） */
    prediv?: number
    ahb: number
    apb1: number
    apb2: number
  }
}

export interface ClockData {
  chip: string
  sysclkMaxMhz: number
  sources: ClockSource[]
  /** 默认时钟源（M12）：缺省=第一个非 PLL 源；CH582M 等「仅 PLL 可生成」芯片显式指定 PLL，避免新建工程默认落在不可生成源 */
  defaultSource?: string
  /** PLL 模型；可选——无 PLL 的芯片（如 CH32X035）省略。缺省时 PLL 相关校验/解算跳过。 */
  pll?: {
    outMaxMhz: number
    sourceOptions: string[]
    params: ClockParamSpec[]
    /** 固定 VCO 输出（MHz）：存在时 PLL 为「fixedOutMhz ÷ div」模型（如 CH582 480MHz），否则为输入×倍频模型 */
    fixedOutMhz?: number
  }
  ahb: ClockDividerSpec
  apb1: ClockDividerSpec
  apb2: ClockDividerSpec
  adc: {
    options: { id: string; label: string; source: string; div: number }[]
    default: string
    maxMhz?: number
  }
  /** 定时器时钟域：'sysclk'=直接 SYSCLK（V003）；'apb_x2'=APB 分频>1 时 ×2（V1/V3） */
  timerClock?: 'sysclk' | 'apb_x2'
  /** 外设时钟域（M15，可选）：每类外设的固定源总线 + 真实旋钮 + 分频链描述。
   *  实例清单来自 peripherals.json；WCH 芯片 I2C/SPI/USART 无内核 mux，源为固定总线（诚实徽标）。 */
  peripheralClocks?: PeripheralClocksData
  presets: ClockPreset[]
  codegen: {
    presetConstMap: Record<string, string>
    /** explicit：无匹配预设时逐字段拼 Config；preset_only：HAL 只提供配方（如 H4），无匹配预设时阻止导出 */
    fallback: 'explicit' | 'preset_only'
  }
}

// ---------- 时钟计算 ----------

export interface ClockFrequencies {
  pllInMhz: number | null
  pllOutMhz: number | null
  sysclkMhz: number
  hclkMhz: number
  pclk1Mhz: number
  pclk2Mhz: number
  adcMhz: number
  pclk1TimMhz: number
  pclk2TimMhz: number
}

export interface ClockIssue {
  node: string
  message: string
  level: ConflictLevel
}

// ---------- 外设时钟域（M15） ----------

/** 外设时钟源总线 id：对应 ClockFrequencies 语义；CK32M=CH58x 固定 32MHz 域 */
export type PeripheralClockBus = 'SYSCLK' | 'HCLK' | 'APB1' | 'APB2' | 'CK32M'

/** 速率类外设（USART/SPI/I2C）公共描述：固定源 + 旋钮（外设参数 key，单一真相源） */
export interface PeripheralRateClockSpec {
  sourceDefault: PeripheralClockBus
  /** 实例级源覆盖（如 USART1/SPI1 挂 APB2，其余 APB1） */
  sourceOverrides?: Record<string, PeripheralClockBus>
  /** peripherals.json params 的 key（baudrate/frequency/speed）；时钟节点旋钮写回该参数 */
  knob: string
}

export interface UsartClockSpec extends PeripheralRateClockSpec {
  /** 实际波特率误差警告阈值（%），缺省 3 */
  baudErrorWarnPct?: number
}

export interface SpiClockSpec extends PeripheralRateClockSpec {
  /** BRG 分频：ch32 = 2 的幂档位列表；ch58x = 线性 div（linear.min..max，HAL clamp） */
  brg: { divs?: number[]; linear?: { min: number; max: number } }
}

export interface I2cClockSpec extends PeripheralRateClockSpec {
  /** SCL 上限（kHz）：超 = error（HAL timing() assert） */
  maxKhz: number
}

export interface AdcClockSpec {
  source: PeripheralClockBus
  /** 固定源频率 MHz（CK32M=32）；缺省按 source 总线派生 */
  fixedInMhz?: number
  /** RCC ADCPRE 级：programmable=本期代码生成会写（HAL 有 API 且非 preset_only）；否则仅显示徽标 */
  pre?: { programmable: boolean; note?: string }
  /** ADC CTLR3.CLK_DIV 级（raw 寄存器值） */
  clkDiv?: { programmable: boolean; bits: number; default: number; raw: boolean; note?: string }
  /** CH582：旋钮镜像外设参数（samplingClock），值→MHz 用 enumMhz（HAL 枚举标签） */
  knob?: string
  enumMhz?: Record<string, number>
  note?: string
}

export interface UsbClockSpec {
  /** HAL rcc::init 自动 USBPRE：PLL 输出 MHz → 分频（仅显示，无 API） */
  autoPre: Record<string, number>
  /** 合法 PLL 输出集合：之外 → warning（USB 时钟非法）；fixedMhz 存在时跳过该检查 */
  validPllMhz: number[]
  /** 固定 48M 域（X035 HSI 直连，无分频） */
  fixedMhz?: number
  note?: string
}

export interface PeripheralClocksData {
  usart?: UsartClockSpec
  spi?: SpiClockSpec
  i2c?: I2cClockSpec
  adc?: AdcClockSpec
  usb?: UsbClockSpec
}

/** 每外设实例的时钟派生结果（model/clock/peripheral.ts 计算，纯函数） */
export interface PeripheralClockFreq {
  /** 时钟树节点 id：'P-'+实例 id（P-USART1/P-SPI1/P-I2C1/P-ADC1）；USB 域节点='USB' */
  nodeId: string
  /** 外设实例 id（peripherals.json）；USB 节点='USB' */
  periId: string
  category: 'usart' | 'spi' | 'i2c' | 'adc' | 'usb'
  sourceBus: string
  /** 输入频率 MHz */
  inMhz: number
  /** 请求值（外设参数原生单位：baud/Hz；ADC raw 或枚举值）；未启用/无参数=null */
  requested: number | string | null
  /** 实际派生频率 MHz；ADC raw 级=null（不编造）；USB 非法=null */
  actualMhz: number | null
  /** 分频描述：'÷8 (BRG)' / 'raw 0b0101' / 'USBPRE ÷1.5 (HAL auto)' */
  dividerLabel: string | null
  /** 实际波特率误差 %（仅 USART） */
  errorPct?: number
  issues: ClockIssue[]
}