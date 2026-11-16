// 数据层 schema：芯片 / 引脚 / remap / EXTI / 外设 / 中断 / DMA 的数据文件结构。
import type { ClockData } from './clock'

// ---------- 数据层 schema ----------

export type PinType = 'IO' | 'POWER' | 'NC'
export type PinSide = 'left' | 'right' | 'top' | 'bottom'
export type SpecialKind = 'nrst' | 'boot' | 'swd' | 'osc' | null
export type RemapModel = 'afio_v1' | 'afio_v2' | 'per_pin_af'

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