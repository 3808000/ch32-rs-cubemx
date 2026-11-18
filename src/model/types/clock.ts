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