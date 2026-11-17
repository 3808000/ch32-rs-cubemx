// 工程配置模型：引脚分配、分组、时钟引用与外设开关（ProjectConfig）。
import type { ClockConfig } from './clock'
import type { ConflictResolution, FileGroup } from './codegen'

// ---------- 配置模型（ProjectConfig） ----------

/** RESERVED = 用户标记保留（M4.7/M8）：不做电气配置、生成器跳过、外设占用报冲突。 */
export type PinMode = 'INPUT' | 'OUTPUT' | 'AF' | 'ANALOG' | 'RESERVED'
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

export interface PeripheralState {
  enabled: boolean
  params: Record<string, string | number | boolean>
  remap?: number
}

/** 中断配置（M3 NVIC/PFIC）。irq 名取自 data/devices/<chip>/interrupts.json；priority 0..15。 */
export interface InterruptConfig {
  irq: string
  enabled: boolean
  priority: number
}

/** DMA 通道分配（M3，embassy/H417 场景）。channel/request 合法性由 dma.json 校验。 */
export interface DmaConfig {
  peripheral: string
  channel: number
  request?: number
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
  features: { embassy: boolean; debugPrint: boolean; ble?: boolean }
  hal: { rev: string }
  /** BLE 协议栈配置（M12，仅 ch58x-hal 后端）。可选，向后兼容；features.ble 为启用开关。 */
  ble?: BleConfig
  /** 显式解锁的特殊引脚（NRST/SWD/OSC）。可选，向后兼容；导入/导出往返保留。 */
  unlockedPins?: string[]
  /** 中断配置（M3）。可选，向后兼容。 */
  interrupts?: InterruptConfig[]
  /** DMA 通道分配（M3）。可选，向后兼容。 */
  dma?: DmaConfig[]
  /** 生成该配置的工具信息（M4.6 迁移基础设施）。可选，向后兼容。 */
  generator?: { name: string; version: string }
  /** 类别级冲突策略（M8，对齐 CubeMX2 Automatic Conflict Handling Rules）。可选，缺省=safe 安全网。 */
  conflictPolicy?: ConflictPolicy
}

/**
 * BLE 协议栈配置（M12，ch58x-hal @611954e 逐字核实，见 docs/CH58X_BLE_CONTRACT.md）。
 * 约束：BLE 必须 embassy 运行时 + LSE 32.768kHz 晶振（HAL SelRTCClock=0 硬编码）；
 * central 角色上游无示例，本期不开放。
 */
export interface BleConfig {
  /** GAP 角色：peripheral 含生成的简单 GATT 服务（read/notify + write 特征） */
  role: 'peripheral' | 'broadcaster' | 'observer'
  /** 设备名：GGS 特征 + 扫描响应 + 广播 TLV 三处同步（adv/rsp ≤31 字节，GAP ≤248） */
  deviceName: string
  /** 广播间隔 ms（生成换算 0.625ms 单位，TGAP_DISC_ADV_INT_MIN/MAX） */
  advIntervalMs: number
  /** MAC 来源：factory=出厂 ROM（use_factory_mac_address）/ custom / default=HAL 固定 11:22:33:44:55:66 */
  macSource: 'factory' | 'custom' | 'default'
  /** 自定义 MAC，人读序 AA:BB:CC:DD:EE:FF（生成 MacAddress::from_msb） */
  mac?: string
  /** peripheral 简单 GATT 服务 UUID16（服务 / notify 特征 / write 特征） */
  serviceUuid16: number
  notifyUuid16: number
  writeUuid16: number
  /** observer 扫描窗口 ms（0.625ms 单位，TGAP_DISC_SCAN）与主动扫描开关 */
  scanMs: number
  activeScan: boolean
}

/** BLE 缺省配置（M12）：peripheral + 出厂 MAC + 100ms 广播 + FFE0/FFE1/FFE2 服务（对齐上游 ble-blinky 示例 UUID）。 */
export const DEFAULT_BLE_CONFIG: BleConfig = {
  role: 'peripheral',
  deviceName: 'CH582M',
  advIntervalMs: 100,
  macSource: 'factory',
  serviceUuid16: 0xffe0,
  notifyUuid16: 0xffe1,
  writeUuid16: 0xffe2,
  scanMs: 3000,
  activeScan: false,
}

/** 冲突策略模式：safe=M1 安全网默认；update=Update files on change（冲突默认覆盖）；custom=逐组自定义。 */
export type ConflictPolicyMode = 'safe' | 'update' | 'custom'

/** 类别级冲突决议默认值（仅影响 conflict 条目的默认 resolution；user_code 永不写盘不受影响）。 */
export interface ConflictPolicy {
  mode: ConflictPolicyMode
  /** mode=custom 时逐组覆盖；缺省组回退 safe 默认。 */
  groups?: Partial<Record<FileGroup, ConflictResolution>>
}