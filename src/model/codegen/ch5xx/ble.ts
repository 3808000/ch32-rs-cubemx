// BLE 生成（ch5xx + ch5xx-ble shim）：广播/扫描/设备名/MAC 计划沿用 legacy 的纯计算（单一真相），
// 仅模板与运行时初始化改为 ch5xx shim（src/generated/ble.rs，见 templates/bleRs.ts）。
import type { GeneratedFile, ProjectConfig } from '@/model/types'
import {
  BLE_CONN_INTERVAL_MAX,
  BLE_CONN_INTERVAL_MIN,
  advDataItems,
  buildBlePlan,
  scanRspDataItems,
  type BlePlan,
  type BleMacSource,
} from '../ch58x/ble'
import { render } from '../render'
import * as T from './templates'

export type { BlePlan, BleMacSource } from '../ch58x/ble'
export { buildBlePlan } from '../ch58x/ble'

function hex8(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, '0')}`
}

function hex16(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`
}

/** Rust 数组字面量条目 → 多行文本（每行最多 8 项）。 */
function rustArrayLines(items: string[], indent = '    '): string {
  const lines: string[] = []
  for (let i = 0; i < items.length; i += 8) {
    lines.push(indent + items.slice(i, i + 8).join(', ') + ',')
  }
  return lines.join('\n')
}

function nameComment(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').slice(0, 60)
}

function macLiteral(bytes: number[]): string {
  return `[${bytes.map((b) => hex8(b)).join(', ')}]`
}

interface BleTplData {
  role: BlePlan['role']
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
  /** 协议栈序（LSB first）MAC 字面量：ble::Config.mac_lsb */
  macBytesLsbLiteral: string
  /** bleConfig_t.SelRTCClock：0=LSE 32768Hz / 1=LSI 32000Hz */
  selRtcClock: number
  logSerial: boolean
  connIntervalMin: number
  connIntervalMax: number
}

/** 生成 src/generated/ble.rs。logSerial=false 时不生成 UartTx/set_default_serial。 */
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
    macBytesLsbLiteral: plan.macBytes ? macLiteral([...plan.macBytes].reverse()) : '',
    selRtcClock: (config.ble?.clock32k ?? 'lse') === 'lsi' ? 1 : 0,
    logSerial,
    connIntervalMin: BLE_CONN_INTERVAL_MIN,
    connIntervalMax: BLE_CONN_INTERVAL_MAX,
  }
  return {
    path: 'src/generated/ble.rs',
    content: render(T.BLE_RS_TPL, data as unknown as Record<string, unknown>),
  }
}