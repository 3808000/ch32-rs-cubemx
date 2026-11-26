// BLE 协议栈规则（M12，契约 D2/D3/D7）：运行时耦合 / LSE 引脚 / ADC 抢占 / 设备名长度 / MAC 格式。
// 纯函数：只在 features.ble 开启时输出；未启用时零冲突（数据驱动，不做芯片名分支）。
import { categoryOfPeripheral } from '@/model/device'
import { DEFAULT_BLE_CONFIG, type BleConfig } from '@/model/types/project'
import type { ConflictContext } from './context'

/** 广播/扫描响应负载上限 31 字节（含 TLV 头），对齐 A2 模板（codegen/ch58x/ble.ts）。 */
const BLE_PAYLOAD_MAX = 31
/** 广播包 TLV 组成（按 A2 模板逐字）：flags 3 + manufacturer 5 + 名称 TLV 头 2 + power 3。 */
const ADV_FLAGS = 3
const ADV_MANUFACTURER = 5 // 0x04 + type + 0xD7 0x07 0x01
const ADV_SERVICE_UUID = 4 // 0x03 + type + uuid16（仅 peripheral）
const ADV_POWER = 3 // 0x02 + type + 0dBm（仅 broadcaster）
const TLV_HEADER = 2
/** 广播短名截断上限（模板 shortNameBytes 默认 8 字节，不切断 UTF-8 码点）。 */
const SHORT_NAME_MAX_BYTES = 8
const SCAN_RSP_POWER = 3
/** GAP 设备名硬上限（GAP_DEVICE_NAME_LEN / 模板 BLE_NAME_MAX_BYTES）。 */
const GAP_NAME_MAX = 248

/** 广播包/扫描响应中设备名的有效字节预算（完整名在扫描响应：31 - TLV 头 - power；observer 不广播名字）。 */
export const BLE_NAME_BUDGET: Record<BleConfig['role'], number> = {
  peripheral: BLE_PAYLOAD_MAX - TLV_HEADER - SCAN_RSP_POWER, // 26
  broadcaster: BLE_PAYLOAD_MAX - TLV_HEADER, // 29
  observer: GAP_NAME_MAX, // 不占用广播包
}

/** LSE 晶振引脚（CH58x 板级约定 X32KI/X32KO；HAL 无复用映射，契约核实事实）。 */
const LSE_PINS = ['PA10', 'PA11'] as const

/** UTF-8 字节数（设备名三处同步均按字节计长度）。 */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 广播短名的实际字节数（模板按 8 字节截断且不切断 UTF-8 码点）。 */
function shortNameBytes(text: string, max = SHORT_NAME_MAX_BYTES): number {
  let used = 0
  for (const ch of text) {
    const b = new TextEncoder().encode(ch).length
    if (used + b > max) break
    used += b
  }
  return used
}

/** 广播包总长（含 TLV 头；observer 不广播名字 → 0）。 */
function advPayloadBytes(role: BleConfig['role'], shortBytes: number): number {
  if (role === 'broadcaster') return ADV_FLAGS + ADV_MANUFACTURER + TLV_HEADER + shortBytes + ADV_POWER
  if (role === 'peripheral') return ADV_FLAGS + ADV_MANUFACTURER + ADV_SERVICE_UUID + TLV_HEADER + shortBytes
  return 0
}

/** 扫描响应总长（含 TLV 头；observer 不发扫描响应 → 0）。 */
function scanRspPayloadBytes(role: BleConfig['role'], nameBytes: number): number {
  if (role === 'broadcaster') return TLV_HEADER + nameBytes
  if (role === 'peripheral') return TLV_HEADER + nameBytes + SCAN_RSP_POWER
  return 0
}

/** 自定义 MAC 校验：6 段十六进制，允许 `:` 或 `-` 分隔（人读序 AA:BB:CC:DD:EE:FF）。 */
export function isValidBleMac(mac: string | undefined): boolean {
  if (typeof mac !== 'string') return false
  return /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(mac.trim())
}

export function runBleRules(ctx: ConflictContext): void {
  const { config, data, pins, peripherals, push } = ctx

  // 未启用 BLE → 零冲突（所有 BLE 规则的前置条件）
  if (!config.features?.ble) return

  const ble = config.ble ?? DEFAULT_BLE_CONFIG
  const cap = data.peripherals.ble

  // ---- M19：数据声明的实例能力与资源 ----
  if (cap) {
    if (!cap.roles.includes(ble.role)) {
      push({
        code: 'BLE_ROLE_UNSUPPORTED',
        level: 'error',
        message: `${data.chip.chip} 的 BLE 后端不支持角色「${ble.role}」（可用：${cap.roles.join('、')}）`,
      })
    }
    const disabledIrqs = (config.interrupts ?? [])
      .filter((i) => cap.interrupts.includes(i.irq) && !i.enabled)
      .map((i) => i.irq)
    if (disabledIrqs.length > 0) {
      push({
        code: 'BLE_IRQ_DISABLED',
        level: 'error',
        message: `BLE 依赖 ${disabledIrqs.join('、')} 中断，但 NVIC 配置已将其禁用；请恢复中断或关闭 BLE`,
      })
    }
    if (ble.backend) {
      const backend = cap.backends.find((b) => b.id === ble.backend)
      if (!backend || !backend.exportable) {
        push({
          code: 'BLE_BACKEND_UNSUPPORTED',
          level: 'error',
          message: `BLE 后端「${ble.backend}」当前不可导出（${backend?.notes ?? '未在器件数据中声明'}）；请选择 shim 或等待接入完成`,
        })
      }
    }
    if (cap.requires?.lse && (ble.clock32k ?? 'lse') === 'lsi') {
      push({
        code: 'BLE_LSI_CLOCK',
        level: 'warning',
        message: 'BLE 32K 选择 LSI（内部 RC）：未移植 LSI 校准，连接稳定性未保证；建议改用 LSE 外部 32.768kHz 晶振',
      })
    }
  }

  // ---- D2 运行时耦合：ble ⇒ embassy（生成期兜底；导入不一致的工程会报错） ----
  if (!config.features.embassy) {
    push({
      code: 'BLE_REQUIRES_EMBASSY',
      level: 'error',
      message: 'BLE 协议栈依赖 embassy 运行时（features.ble 必须同时开启 features.embassy）',
    })
  }

  // ---- D3 LSE 引脚：BLE 强制 SelRTCClock=LSE（mod.rs 硬编码），PA10/PA11 不可再分配 ----
  const lseUsed = LSE_PINS.filter((name) => pins.some((a) => a.pin === name))
  if (lseUsed.length > 0) {
    push({
      code: 'BLE_LSE_PIN_IN_USE',
      level: 'error',
      message: `${lseUsed.join('、')} 是 LSE 32.768kHz 晶振引脚（X32KI/X32KO），BLE 强制使用 LSE 时钟，启用 BLE 后不可复用`,
      pins: lseUsed,
    })
  }

  // ---- 耦合警示：BLE temperature_raw 内部会抢占 ADC（与用户 ADC 采样冲突） ----
  for (const [id, state] of Object.entries(peripherals)) {
    if (!state.enabled) continue
    if (categoryOfPeripheral(id) !== 'adc') continue
    push({
      code: 'BLE_ADC_SHARED',
      level: 'warning',
      message: `${id} 已启用，但 BLE 的 temperature_raw 会 steal ADC（HAL 内部占用 ADC 采样温度），两者不能同时可靠工作`,
      peripheral: id,
    })
  }

  // ---- 设备名：GAP 名 ≤248 字节；扫描响应完整名 TLV / 广播包 ≤31 字节 ----
  // 广播包短名按模板截断为 8 字节（buf 不会因长名溢出），完整名走扫描响应，
  // 因此实际名称预算按角色不同：peripheral 26 / broadcaster 29 / observer 仅受 GAP 248 限制。
  const nameBytes = utf8Bytes(ble.deviceName ?? '')
  const advLen = advPayloadBytes(ble.role, shortNameBytes(ble.deviceName ?? ''))
  const rspLen = scanRspPayloadBytes(ble.role, nameBytes)
  const nameBudget = BLE_NAME_BUDGET[ble.role]
  if (nameBytes > GAP_NAME_MAX) {
    push({
      code: 'BLE_NAME_TOO_LONG',
      level: 'error',
      message: `设备名 UTF-8 共 ${nameBytes} 字节，超过 GAP 名上限 ${GAP_NAME_MAX} 字节；请缩短设备名（${ble.role} 的广播/扫描响应名称上限 ${nameBudget} 字节）`,
    })
  } else if (advLen > BLE_PAYLOAD_MAX || rspLen > BLE_PAYLOAD_MAX) {
    push({
      code: 'BLE_NAME_TOO_LONG',
      level: 'error',
      message: `设备名 UTF-8 共 ${nameBytes} 字节，超过 ${ble.role} 的 ${BLE_PAYLOAD_MAX} 字节广播/扫描响应上限（广播包 ${advLen} 字节 · 扫描响应 ${rspLen} 字节；本角色名称上限 ${nameBudget} 字节，广播短名截断为 ${SHORT_NAME_MAX_BYTES} 字节）；请缩短设备名`,
    })
  }

  // ---- 自定义 MAC：macSource=custom 时必须是 6 段十六进制 ----
  if (ble.macSource === 'custom' && !isValidBleMac(ble.mac)) {
    push({
      code: 'BLE_MAC_INVALID',
      level: 'error',
      message: `自定义 MAC「${ble.mac ?? ''}」格式非法：需 6 段十六进制（如 AA:BB:CC:DD:EE:FF）`,
    })
  }
}
