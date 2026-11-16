// ch32-rs-CubeMX 核心类型定义
// 配置模型见提示词 §5；数据层 schema 见 §4。所有芯片差异靠数据字段表达，禁止组件内硬编码芯片分支。

// ---------- 配置模型（ProjectConfig） ----------

export type PinMode = 'INPUT' | 'OUTPUT' | 'AF' | 'ANALOG'
export type RemapModel = 'afio_v1' | 'afio_v2' | 'per_pin_af'
export type OutputType = 'PUSH_PULL' | 'OPEN_DRAIN'
export type SpeedGrade = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
export type Level = 'HIGH' | 'LOW'
export type Pull = 'NONE' | 'UP' | 'DOWN'
export type ExtiEdge = 'RISING' | 'FALLING' | 'BOTH'

export interface PinParams {
  outputType?: OutputType
  speed?: SpeedGrade
  level?: Level
  pull?: Pull
  exti?: { enabled: boolean; edge: ExtiEdge }
}

export interface PinAssignment {
  pin: string // 'PD5'
  label?: string // 'LED_RUN'
  mode: PinMode
  function?: string // AF/ANALOG 时的信号名，如 'USART1_TX' / 'ADC_IN4'
  remap?: number // AF 时锁定的 remap 值（const 泛型）
  params: PinParams
}

export interface PinGroup {
  name: string
  pins: string[]
  color?: string
}

export interface ClockConfig {
  source: string // 'HSI' | 'HSE' | 'PLL'
  hxtalMhz?: number // HSE 晶振频率
  pllSource?: string // 'HSI' | 'HSE'
  pll?: Record<string, number> // PLL 参数（V003 固定 mul=2）
  ahb: number
  apb1: number
  apb2: number
  adc?: string // ADC 时钟源 id
}

export interface PeripheralState {
  enabled: boolean
  params: Record<string, string | number | boolean>
  remap?: number
}

export interface ProjectConfig {
  version: 1
  chip: string // 'CH32V003F4P6'
  projectName: string
  pins: PinAssignment[]
  groups?: PinGroup[]
  naming: { prefix: string }
  clock?: ClockConfig
  peripherals?: Record<string, PeripheralState>
  features: { embassy: boolean; debugPrint: boolean }
  hal: { rev: string }
}

// ---------- 数据层 schema ----------

export type PinType = 'IO' | 'POWER' | 'NC'
export type PinSide = 'left' | 'right' | 'top' | 'bottom'
export type SpecialKind = 'nrst' | 'boot' | 'swd' | 'osc' | null

export interface PinRemapEntry {
  signal: string
  /** 复用档位：remapModel=per_pin_af 时为该引脚的 AF 号（0..15），否则为 PCFR 分组号 */
  remap: number
}

export interface ChipPin {
  number: number
  name: string
  type: PinType
  side: PinSide
  aliases?: string[]
  special?: SpecialKind
  ft?: boolean // 5V 容忍
  adc?: string[] // 可用 ADC 通道（原始通道名 ADC_INn）
}

/** 多核芯片的单核描述（单核芯片不填 ChipData.cores） */
export interface ChipCore {
  id: string // 'v3f' / 'v5f'
  label: string
  /** 该核的 ch32-hal Cargo feature（完整小写型号 + 核后缀） */
  halFeature: string
  target: string
  /** 启动核：reset 后首先运行、负责 RCC/GPIO 等共享初始化 */
  mainCore?: boolean
}

export interface ChipData {
  chip: string
  family: string
  core: string
  /** 多核芯片的核列表；存在时代码生成产出 workspace（每个核一个 crate） */
  cores?: ChipCore[]
  package: string
  packageKind: 'dual' | 'quad'
  pinsPerSide: number
  flash: string
  sram: string
  deviceId: string
  halFeature: string // ch32-hal Cargo feature（完整小写型号）
  /** HAL 后端 crate：缺省 'ch32-hal'；CH58x 系列为 'ch58x-hal'（代码生成后端尚未接入时阻止导出） */
  halBackend?: string
  target: string
  nightly: boolean
  remapModel: RemapModel
  /** 该芯片 target 不支持的特性（如 embassy），数据驱动拦截 */
  unsupportedFeatures?: string[]
  source: string
  pins: ChipPin[]
}

export interface RemapEntry {
  pin: string
  signal: string
  remap: number
}

export interface RemapData {
  chip: string
  entries: RemapEntry[]
  notes?: string
}

export interface ExtiEntry {
  pin: string
  channel: number
  irq: string
}

export interface ExtiData {
  chip?: string
  entries: ExtiEntry[]
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
    ahb: number
    apb1: number
    apb2: number
  }
}

export interface ClockData {
  chip: string
  sysclkMaxMhz: number
  sources: ClockSource[]
  pll: {
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

export interface ParamSpec {
  default: string | number | boolean
  options?: (string | number)[]
  min?: number
  max?: number
  kind?: 'number' | 'select' | 'boolean'
  label?: string
}

export interface UsartRemapPins {
  remap: number
  tx: string
  rx: string
  cts?: string
  rts?: string
  ck?: string
}

export interface UsartInstance {
  id: string
  remaps: UsartRemapPins[]
  params: Record<string, ParamSpec>
}

export interface SpiRemapPins {
  remap: number
  sck: string
  mosi: string
  miso: string
  nss?: string
}

export interface SpiInstance {
  id: string
  remaps: SpiRemapPins[]
  params: Record<string, ParamSpec>
}

export interface I2cRemapPins {
  remap: number
  scl: string
  sda: string
}

export interface I2cInstance {
  id: string
  remaps: I2cRemapPins[]
  params: Record<string, ParamSpec>
}

export interface AdcChannel {
  channel: string // 'ADC_IN0'
  pin: string
}

export interface AdcInstance {
  id: string
  channels: AdcChannel[]
  params: Record<string, ParamSpec>
}

export interface PeripheralsData {
  chip: string
  /** ADC 驱动 API 形态：缺省 convert（v1/v3）；v4x7 为 Adc::new -> Result + blocking_read（H4/V4x7） */
  adcApi?: 'convert' | 'v4x7'
  usart: UsartInstance[]
  spi: SpiInstance[]
  i2c: I2cInstance[]
  adc: AdcInstance[]
}

export interface IrqEntry {
  name: string
  number: number
  comment?: string
}

export interface InterruptsData {
  chip?: string
  irqs: IrqEntry[]
}

export interface DmaRequest {
  request: string
  channel: number
}

export interface DmaData {
  chip?: string
  requests: DmaRequest[]
  /** 语义说明（如 H4 的 channel 是 DMAMUX 请求号，非固定通道） */
  notes?: string
}

export interface DeviceData {
  chip: ChipData
  remap: RemapData
  exti: ExtiData
  clock: ClockData
  peripherals: PeripheralsData
  interrupts: InterruptsData
  dma?: DmaData
}

// ---------- 冲突检查 ----------

export type ConflictLevel = 'error' | 'warning'

export type ConflictCode =
  | 'UNKNOWN_PIN'
  | 'DUPLICATE_PIN'
  | 'PIN_NOT_CONFIGURABLE'
  | 'SPECIAL_PIN_LOCKED'
  | 'SPECIAL_PIN_OSC'
  | 'EXTI_ON_NON_INPUT'
  | 'EXTI_LINE_CONFLICT'
  | 'DUPLICATE_LABEL'
  | 'AF_SIGNAL_DUPLICATE'
  | 'ANALOG_DUPLICATE'
  | 'USART_RX_MISSING'
  | 'USART_TX_MISSING'
  | 'PERIPHERAL_CLOCK_INVALID'
  | 'REMAP_MISMATCH'
  | 'REMAP_UNDEFINED'
  | 'PIN_CONSUMED_TWICE'
  | 'CLOCK_PRESET_UNAVAILABLE'
  | 'TARGET_FEATURE_UNSUPPORTED'
  | 'SRAM_BUDGET_EXCEEDED'
  | 'DMA_CHANNEL_CONFLICT'

export interface Conflict {
  code: ConflictCode
  level: ConflictLevel
  message: string
  pins?: string[]
  peripheral?: string
}

// ---------- 代码生成 ----------

export interface CodegenSelection {
  projectSkeleton: boolean
  clock: boolean
  pins: boolean
  exti: boolean
  usart: boolean
  spi: boolean
  i2c: boolean
  adc: boolean
  readme: boolean
  /** 内嵌完整 ch32-hal 源码到 vendor/ch32-hal（path 依赖，便于查阅代码） */
  vendorHal: boolean
}

export const DEFAULT_SELECTION: CodegenSelection = {
  projectSkeleton: true,
  clock: true,
  pins: true,
  exti: true,
  usart: true,
  spi: true,
  i2c: true,
  adc: true,
  readme: true,
  vendorHal: true,
}

export interface GeneratedFile {
  path: string
  content: string
}

export interface CodegenResult {
  files: GeneratedFile[]
  errors: Conflict[] // 生成期错误（阻止导出）
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