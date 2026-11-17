// BLE 协议栈生成（M12，契约 docs/CH58X_BLE_CONTRACT.md D4/D6/D12）。
// 产出 src/generated/ble.rs：config()（MAC 三来源）+ run(spawner)（init 顺序 + 角色任务 + TMOS 泵）。
//
// 生成模板遵守的硬约束（逐条来自 reference/ch58x-hal @611954e）：
// - TmosEvent 单订阅者：只在 peripheral GAP 任务消费一次，取到即独占、本轮 drop（Clone 会 double free）；
// - 禁止 core::sync::atomic（imc target 无原子）：跨任务状态一律走 embassy_sync Channel；
// - GATT 6 属性表 + CCCD + GATT_bm_alloc/free（读写回调、notify 任务）；
// - 广播/扫描响应 TLV 每段 ≤31 字节，设备名 TLV 长度字节 = 1 + UTF-8 字节数（自动计算）；
// - 间隔换算：广播/扫描 0.625ms 单位（四舍五入 + 规范区间钳制），连接间隔 1.25ms 单位。
import type { GeneratedFile, ProjectConfig } from '@/model/types'
import { DEFAULT_BLE_CONFIG, type BleConfig } from '@/model/types'
import { render } from '../render'
import * as T from './templates'

export type BleRole = BleConfig['role']
export type BleMacSource = BleConfig['macSource']

/** BLE 广播/扫描间隔单位（ms）：TGAP_DISC_ADV_INT_MIN/MAX、TGAP_DISC_SCAN 均为 0.625ms。 */
export const BLE_ADV_UNIT_MS = 0.625
/** 广播间隔规范区间（ticks）：0x0020=20ms .. 0x4000=10.24s。 */
export const BLE_ADV_TICKS_MIN = 0x0020
export const BLE_ADV_TICKS_MAX = 0x4000
/** 扫描窗口规范区间（ticks）：0x0004=2.5ms .. 0x4000=10.24s。 */
export const BLE_SCAN_TICKS_MIN = 0x0004
export const BLE_SCAN_TICKS_MAX = 0x4000
/** 连接间隔缺省（1.25ms 单位）：6=7.5ms / 100=125ms，对齐上游 ble-peripheral 示例。 */
export const BLE_CONN_INTERVAL_MIN = 6
export const BLE_CONN_INTERVAL_MAX = 100
/** 广播/扫描响应负载上限（含 TLV 头）。 */
export const BLE_ADV_PAYLOAD_MAX = 31
/** GAP 设备名上限（GAP_DEVICE_NAME_LEN）。 */
export const BLE_NAME_MAX_BYTES = 248

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** ms → 广播间隔 ticks（0.625ms 单位，四舍五入；钳制 20ms..=10.24s）。 */
export function advIntervalTicks(ms: number): number {
  const raw = Number.isFinite(ms) ? Math.round((ms * 8) / 5) : 0
  return clamp(raw, BLE_ADV_TICKS_MIN, BLE_ADV_TICKS_MAX)
}

/** ms → 扫描窗口 ticks（0.625ms 单位，四舍五入；钳制 2.5ms..=10.24s）。 */
export function scanWindowTicks(ms: number): number {
  const raw = Number.isFinite(ms) ? Math.round((ms * 8) / 5) : 0
  return clamp(raw, BLE_SCAN_TICKS_MIN, BLE_SCAN_TICKS_MAX)
}

/** 广播间隔是否被钳制（用于生成注释，不静默改值）。 */
export function advIntervalClamped(ms: number): boolean {
  const raw = Number.isFinite(ms) ? Math.round((ms * 8) / 5) : 0
  return raw < BLE_ADV_TICKS_MIN || raw > BLE_ADV_TICKS_MAX
}

/** 扫描窗口是否被钳制。 */
export function scanWindowClamped(ms: number): boolean {
  const raw = Number.isFinite(ms) ? Math.round((ms * 8) / 5) : 0
  return raw < BLE_SCAN_TICKS_MIN || raw > BLE_SCAN_TICKS_MAX
}

/** UTF-8 字节序列（设备名 TLV 长度按字节，不按字符）。 */
export function utf8Bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s))
}

/**
 * 短名（GAP_ADTYPE_LOCAL_NAME_SHORT）截断：最多 max 字节，且不切断 UTF-8 码点。
 * 广播包空间有限，短名仅用于扫描预览；完整名在扫描响应里。
 */
export function shortNameBytes(s: string, max = 8): number[] {
  const out: number[] = []
  for (const ch of s) {
    const b = Array.from(new TextEncoder().encode(ch))
    if (out.length + b.length > max) break
    out.push(...b)
  }
  return out
}

/** 自定义 MAC：人读序 AA:BB:CC:DD:EE:FF（也接受 '-' 分隔）→ 6 字节；非法返回 null。 */
export function parseMacAddress(mac: string | undefined): number[] | null {
  if (!mac) return null
  const text = mac.trim()
  const m = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.exec(text)
  if (!m) return null
  return text.split(/[:-]/).map((x) => parseInt(x, 16))
}

/** BLE 生成计划：缺省值与部分字段合并（导入旧工程时 ble 可能只有部分字段）。 */
export interface BlePlan {
  role: BleRole
  deviceName: string
  nameBytes: number[]
  shortNameBytes: number[]
  advIntervalMs: number
  advTicks: number
  advClamped: boolean
  scanMs: number
  scanTicks: number
  scanClamped: boolean
  activeScan: boolean
  macSource: BleMacSource
  macBytes: number[] | null
  serviceUuid: number
  notifyUuid: number
  writeUuid: number
}

function asUuid16(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.trunc(v) & 0xffff
}

function asRole(v: string | undefined): BleRole {
  return v === 'broadcaster' || v === 'observer' ? v : 'peripheral'
}

function asMacSource(v: string | undefined): BleMacSource {
  return v === 'factory' || v === 'custom' ? v : 'default'
}

export function buildBlePlan(config: ProjectConfig): BlePlan {
  const cfg: BleConfig = { ...DEFAULT_BLE_CONFIG, ...(config.ble ?? {}) }
  const deviceName = typeof cfg.deviceName === 'string' ? cfg.deviceName : DEFAULT_BLE_CONFIG.deviceName
  const advIntervalMs = Number.isFinite(cfg.advIntervalMs) ? cfg.advIntervalMs : DEFAULT_BLE_CONFIG.advIntervalMs
  const scanMs = Number.isFinite(cfg.scanMs) ? cfg.scanMs : DEFAULT_BLE_CONFIG.scanMs
  const macSource = asMacSource(cfg.macSource)
  return {
    role: asRole(cfg.role),
    deviceName,
    nameBytes: utf8Bytes(deviceName),
    shortNameBytes: shortNameBytes(deviceName),
    advIntervalMs,
    advTicks: advIntervalTicks(advIntervalMs),
    advClamped: advIntervalClamped(advIntervalMs),
    scanMs,
    scanTicks: scanWindowTicks(scanMs),
    scanClamped: scanWindowClamped(scanMs),
    activeScan: cfg.activeScan === true,
    macSource,
    macBytes: macSource === 'custom' ? parseMacAddress(cfg.mac) : null,
    serviceUuid: asUuid16(cfg.serviceUuid16, DEFAULT_BLE_CONFIG.serviceUuid16),
    notifyUuid: asUuid16(cfg.notifyUuid16, DEFAULT_BLE_CONFIG.notifyUuid16),
    writeUuid: asUuid16(cfg.writeUuid16, DEFAULT_BLE_CONFIG.writeUuid16),
  }
}

/** 广播包总字节数（含各 TLV 头与长度字节；用于 31 字节上限校验）。 */
export function bleAdvPayloadBytes(plan: BlePlan): number {
  const short = plan.shortNameBytes.length
  switch (plan.role) {
    case 'broadcaster':
      // flags(3) + manufacturer(5) + short name(2+s) + power(3)
      return 13 + short
    case 'observer':
      return 0
    default:
      // flags(3) + manufacturer(5) + service uuid(4) + short name(2+s)
      return 14 + short
  }
}

/** 扫描响应总字节数（含 TLV 头与长度字节）。 */
export function bleScanRspPayloadBytes(plan: BlePlan): number {
  const n = plan.nameBytes.length
  switch (plan.role) {
    case 'broadcaster':
      // 完整名 TLV only
      return 2 + n
    case 'observer':
      return 0
    default:
      // 完整名 TLV + power(3)
      return n + 5
  }
}

function hex8(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, '0')}`
}

function hex16(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`
}

/** Rust 数组字面量条目 → 多行文本（每行最多 8 项，保持生成物可读）。 */
function rustArrayLines(items: string[], indent = '    '): string {
  const lines: string[] = []
  for (let i = 0; i < items.length; i += 8) {
    lines.push(indent + items.slice(i, i + 8).join(', ') + ',')
  }
  return lines.join('\n')
}

function logoU16(name: string): string[] {
  return [`lo_u16(${name})`, `hi_u16(${name})`]
}

function u16Bytes(name: string): string[] {
  // 广播 TLV 需要 little-endian；lo_u16/hi_u16 是生成的 const fn
  return logoU16(name)
}

/** 广播包 TLV（peripheral：flags + WCH 厂商 + 服务 UUID + 短名；broadcaster：flags + WCH + 短名 + power）。 */
export function advDataItems(plan: BlePlan): string[] {
  const shortName = plan.shortNameBytes.map(hex8)
  // M13 实机修复：必须带 discoverable 位（GENERAL=0x02），否则 bluez StartDiscovery 等
  // 发现流程按 BLE 规范过滤掉非 discoverable 广播——实机对照 C 固件（带 discoverable 位可见、
  // 仅 BREDR_NOT_SUPPORTED=0x04 不可见）证实。GENERAL=持续广播（LIMITED 仅 30s 窗口）。
  const flags = ['0x02', 'GAP_ADTYPE_FLAGS', 'GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED']
  const manufacturer = ['0x04', 'GAP_ADTYPE_MANUFACTURER_SPECIFIC', '0xD7', '0x07', '0x01']
  if (plan.role === 'broadcaster') {
    return [
      ...flags,
      ...manufacturer,
      hex8(1 + shortName.length),
      'GAP_ADTYPE_LOCAL_NAME_SHORT',
      ...shortName,
      '0x02',
      'GAP_ADTYPE_POWER_LEVEL',
      '0',
    ]
  }
  return [
    ...flags,
    ...manufacturer,
    '0x03',
    'GAP_ADTYPE_16BIT_MORE',
    ...u16Bytes('SERVICE_UUID'),
    hex8(1 + shortName.length),
    'GAP_ADTYPE_LOCAL_NAME_SHORT',
    ...shortName,
  ]
}

/** 扫描响应 TLV：完整设备名（长度字节 = 1 + UTF-8 字节数）；peripheral 追加 Tx power。 */
export function scanRspDataItems(plan: BlePlan): string[] {
  const items = [hex8(1 + plan.nameBytes.length), 'GAP_ADTYPE_LOCAL_NAME_COMPLETE', ...plan.nameBytes.map(hex8)]
  if (plan.role === 'peripheral') items.push('0x02', 'GAP_ADTYPE_POWER_LEVEL', '0')
  return items
}

/** 设备名注释（防止换行破坏生成物注释）。 */
function nameComment(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').slice(0, 60)
}

function macLiteral(bytes: number[]): string {
  return `[${bytes.map((b) => hex8(b)).join(', ')}]`
}

interface BleTplData {
  role: BleRole
  deviceNameComment: string
  nameBytesLines: string
  nameLen: number
  advertLines: string
  scanRspLines: string
  advTicks: number
  advIntervalMs: number
  advClampNote: string
  scanTicks: number
  scanMs: number
  scanClampNote: string
  activeScan: number
  serviceUuid: string
  notifyUuid: string
  writeUuid: string
  macSource: BleMacSource
  macBytesLiteral: string
  logSerial: boolean
  connIntervalMin: number
  connIntervalMax: number
}

/** 生成 src/generated/ble.rs。logSerial=false 时不生成 UartTx/set_default_serial（D5）。 */
export function renderBle(config: ProjectConfig, logSerial: boolean): GeneratedFile {
  const plan = buildBlePlan(config)
  const data: BleTplData = {
    role: plan.role,
    deviceNameComment: nameComment(plan.deviceName),
    nameBytesLines: rustArrayLines(plan.nameBytes.map(hex8)),
    nameLen: plan.nameBytes.length,
    advertLines: rustArrayLines(advDataItems(plan)),
    scanRspLines: rustArrayLines(scanRspDataItems(plan)),
    advTicks: plan.advTicks,
    advIntervalMs: plan.advIntervalMs,
    advClampNote: plan.advClamped ? `（配置值 ${plan.advIntervalMs}ms 超出 20ms..=10.24s，已钳制）` : '',
    scanTicks: plan.scanTicks,
    scanMs: plan.scanMs,
    scanClampNote: plan.scanClamped ? `（配置值 ${plan.scanMs}ms 超出 2.5ms..=10.24s，已钳制）` : '',
    activeScan: plan.activeScan ? 1 : 0,
    serviceUuid: hex16(plan.serviceUuid),
    notifyUuid: hex16(plan.notifyUuid),
    writeUuid: hex16(plan.writeUuid),
    macSource: plan.macSource,
    macBytesLiteral: plan.macBytes ? macLiteral(plan.macBytes) : '',
    logSerial,
    connIntervalMin: BLE_CONN_INTERVAL_MIN,
    connIntervalMax: BLE_CONN_INTERVAL_MAX,
  }
  return {
    path: 'src/generated/ble.rs',
    content: render(T.BLE_RS_TPL, data as unknown as Record<string, unknown>),
  }
}
