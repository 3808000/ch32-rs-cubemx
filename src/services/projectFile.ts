// 工程配置文件（cube.json）的解析、序列化、下载与文件读取。
// cube.json 是本工具的配置快照（等价于 STM32CubeMX 的 .ioc）：
// - 导出 ZIP 内的文件名固定为 cube.json；
// - 单独下载时使用 <projectName>.cube.json，便于与普通 JSON 区分。
import type {
  BleConfig,
  ClockConfig,
  ConflictResolution,
  FileGroup,
  InterruptConfig,
  PeripheralState,
  PinAssignment,
  PinGroup,
  ProjectConfig,
} from '@/model/types'
import { DEFAULT_BLE_CONFIG } from '@/model/types/project'
import { hasDevice } from '@/model/device'
import { HAL_REV } from '@/model/codegen/halRev'
import { isDesktopApp, saveFileNative } from '@/services/desktop'

export type ProjectFileParseResult = { config: ProjectConfig } | { error: string }

/** 当前 cube.json 版本。M4.6 先建迁移通路，暂不升版。 */
export const CONFIG_VERSION = 1

/** 单级迁移：version n → n+1，返回新的原始对象（不修改入参）。 */
export type ConfigMigration = (raw: Record<string, unknown>) => Record<string, unknown>

/**
 * 迁移链表：键为源版本号。当前只有 version 1，暂无迁移项。
 * 将来升到 version 2 时：增加 MIGRATIONS[1]，并把 CONFIG_VERSION 改为 2。
 */
export const MIGRATIONS: Record<number, ConfigMigration> = {}

export type MigrateResult = { raw: Record<string, unknown> } | { error: string }

/**
 * 逐级迁移原始 cube.json 对象（未做字段补全）。
 * - version ≤ targetVersion：按 MIGRATIONS 链逐级升级；
 * - version > targetVersion：明确拒绝（调用方保留原文件，不覆盖）；
 * - 缺 version / 非正整数 / 迁移链缺失：返回中文错误。
 */
export function migrateConfig(
  raw: Record<string, unknown>,
  migrations: Record<number, ConfigMigration> = MIGRATIONS,
  targetVersion: number = CONFIG_VERSION,
): MigrateResult {
  const version = raw.version
  if (version === undefined) {
    return { error: '工程配置缺少 version 字段（应为 1）' }
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { error: `不支持的工程配置版本：${String(version)}（version 必须为正整数）` }
  }
  if (version > targetVersion) {
    return {
      error: `不支持的工程配置版本：${version}（当前工具支持到 version ${targetVersion}，原文件未修改）`,
    }
  }

  let current: Record<string, unknown> = { ...raw }
  for (let v = version; v < targetVersion; v++) {
    const migrate = migrations[v]
    if (typeof migrate !== 'function') {
      return { error: `工程配置迁移链缺失：version ${v} → ${v + 1}` }
    }
    current = { ...migrate(current), version: v + 1 }
  }
  return { raw: current }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 冲突策略的合法枚举（与 types 的 FileGroup / ConflictResolution 保持一致）。 */
const FILE_GROUP_KEYS: readonly FileGroup[] = ['generated', 'project_file', 'user_code', 'pack']
const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] = ['skip', 'overwrite', 'backup', 'base-merge']

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** BLE 配置的合法枚举（与 types 的 BleConfig 保持一致）。 */
const BLE_ROLES: readonly BleConfig['role'][] = ['peripheral', 'broadcaster', 'observer']
const BLE_MAC_SOURCES: readonly BleConfig['macSource'][] = ['factory', 'custom', 'default']

/** BLE 数值边界（广播间隔按 BLE 规范 20..10240ms；UUID16 为 0..0xFFFF）。 */
export const BLE_ADV_INTERVAL_MIN_MS = 20
export const BLE_ADV_INTERVAL_MAX_MS = 10240
export const BLE_SCAN_MIN_MS = 1
export const BLE_SCAN_MAX_MS = 10240

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/**
 * 宽松解析 cube.json 的 ble 节（M12，契约 D1）。
 * - 结构性非法（role/macSource 不在枚举内）→ 丢弃整个 ble，保留其余配置；
 * - 单字段缺失/越界 → 回退 DEFAULT_BLE_CONFIG 对应值（不拒绝导入）；
 * - mac 仅在字符串时保留（格式合法性与 custom 约束由 BLE_MAC_INVALID 冲突规则负责）。
 */
export function parseBleConfig(raw: unknown): BleConfig | undefined {
  if (!isRecord(raw)) return undefined
  if (!BLE_ROLES.includes(raw.role as BleConfig['role'])) return undefined
  if (!BLE_MAC_SOURCES.includes(raw.macSource as BleConfig['macSource'])) return undefined

  const d = DEFAULT_BLE_CONFIG
  const ble: BleConfig = {
    role: raw.role as BleConfig['role'],
    deviceName: typeof raw.deviceName === 'string' ? raw.deviceName : d.deviceName,
    advIntervalMs: intInRange(raw.advIntervalMs, BLE_ADV_INTERVAL_MIN_MS, BLE_ADV_INTERVAL_MAX_MS, d.advIntervalMs),
    macSource: raw.macSource as BleConfig['macSource'],
    serviceUuid16: intInRange(raw.serviceUuid16, 0, 0xffff, d.serviceUuid16),
    notifyUuid16: intInRange(raw.notifyUuid16, 0, 0xffff, d.notifyUuid16),
    writeUuid16: intInRange(raw.writeUuid16, 0, 0xffff, d.writeUuid16),
    scanMs: intInRange(raw.scanMs, BLE_SCAN_MIN_MS, BLE_SCAN_MAX_MS, d.scanMs),
    activeScan: typeof raw.activeScan === 'boolean' ? raw.activeScan : d.activeScan,
    // M14：32K 时钟源；旧 cube.json 无此字段 → 缺省 lse（实机连接验证配置）
    clock32k: raw.clock32k === 'lsi' ? 'lsi' : 'lse',
  }
  if (typeof raw.mac === 'string') ble.mac = raw.mac
  return ble
}

/**
 * 解析 cube.json 文本。
 * 兼容旧工程：仅校验 version 与 chip，其余字段缺失时按 store.loadConfig 的默认策略补全。
 * 未知芯片返回包含芯片名的中文错误，避免用户拿到难以定位的异常。
 * M4.6：先走迁移链；未知字段通过 `{...raw, ...known}` 保留，保证向后兼容。
 */
export function parseProjectFile(text: string): ProjectFileParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: '无法解析工程配置：文件不是合法的 JSON' }
  }
  if (!isRecord(parsed)) {
    return { error: '无法解析工程配置：顶层应为 JSON 对象' }
  }

  // 版本守卫 + 逐级迁移（> 当前版本明确拒绝；原文件由调用方保留，不覆盖）
  const migrated = migrateConfig(parsed)
  if ('error' in migrated) return { error: migrated.error }
  const raw = migrated.raw

  const chip = asString(raw.chip).trim()
  if (!chip) return { error: '工程配置缺少芯片型号（chip）' }
  if (!hasDevice(chip)) {
    return { error: `未知芯片：${chip}（本工具未内置该芯片的数据，请检查型号或升级工具）` }
  }

  // 旧工程可能缺少 naming/groups/clock/peripherals/features/hal：保持宽容，不拒绝导入。
  const naming = isRecord(raw.naming) ? raw.naming : {}
  const features = isRecord(raw.features) ? raw.features : {}
  const hal = isRecord(raw.hal) ? raw.hal : {}

  const pins = (Array.isArray(raw.pins) ? raw.pins : [])
    .filter(isRecord)
    .map((p) => ({ ...p, params: isRecord(p.params) ? p.params : {} })) as unknown as PinAssignment[]

  const groups = (Array.isArray(raw.groups) ? raw.groups : []).filter(isRecord) as unknown as PinGroup[]

  // 中断配置：仅接受 { irq: 非空字符串, enabled: boolean, priority: 0..15 整数 }；
  // 非数组/非法项静默过滤（宽容导入）；旧工程无该字段时不添加属性，保持向后兼容。
  const interrupts: InterruptConfig[] = []
  if (Array.isArray(raw.interrupts)) {
    for (const item of raw.interrupts) {
      if (!isRecord(item)) continue
      if (typeof item.irq !== 'string' || item.irq.trim() === '') continue
      if (typeof item.enabled !== 'boolean') continue
      if (
        typeof item.priority !== 'number' ||
        !Number.isInteger(item.priority) ||
        item.priority < 0 ||
        item.priority > 15
      ) {
        continue
      }
      interrupts.push({ irq: item.irq.trim(), enabled: item.enabled, priority: item.priority })
    }
  }

  // features：ble 仅在显式 true 时写出，保持旧工程（无 BLE）的 features 形状不变。
  const featuresOut: ProjectConfig['features'] = {
    embassy: features.embassy === true,
    // 与 store.loadConfig 一致：debugPrint 缺省为 true
    debugPrint: features.debugPrint !== false,
  }
  if (features.ble === true) featuresOut.ble = true

  // 已知字段覆盖规范化结果；未知字段（未来版本新增）原样保留。
  const config = {
    ...raw,
    version: 1 as const,
    chip,
    projectName: asString(raw.projectName).trim() || 'ch32-project',
    pins,
    groups,
    naming: { prefix: asString(naming.prefix) },
    clock: isRecord(raw.clock) ? (raw.clock as unknown as ClockConfig) : undefined,
    peripherals: isRecord(raw.peripherals)
      ? (raw.peripherals as Record<string, PeripheralState>)
      : {},
    features: featuresOut,
    hal: { rev: asString(hal.rev).trim() || HAL_REV },
    // 旧工程无该字段时为空数组；非数组/混入非字符串时忽略非法项（宽容导入，不报错）
    unlockedPins: (Array.isArray(raw.unlockedPins) ? raw.unlockedPins : []).filter(
      (p): p is string => typeof p === 'string',
    ),
  } as unknown as ProjectConfig

  // 中断：仅接受合法项；非数组（含历史坏值）时删除，避免从 raw 展开时泄漏。
  if (Array.isArray(raw.interrupts)) config.interrupts = interrupts
  else delete config.interrupts

  // 生成器信息：仅在 name/version 都为非空字符串时保留（M4.6）。
  const generatorRaw = isRecord(raw.generator) ? raw.generator : undefined
  const generatorName = asString(generatorRaw?.name).trim()
  const generatorVersion = asString(generatorRaw?.version).trim()
  if (generatorName && generatorVersion) {
    config.generator = { name: generatorName, version: generatorVersion }
  } else {
    delete config.generator
  }

  // 类别级冲突策略（M8）：宽容校验。
  // - mode 必须是 safe/update/custom，否则视为非法 → 丢弃整个字段；
  // - groups 仅接受已知 FileGroup key 与已知 ConflictResolution value，非法项静默过滤；
  // - 旧工程无该字段时删除（保持 cube.json 往返不变）。
  const policyRaw = isRecord(raw.conflictPolicy) ? raw.conflictPolicy : undefined
  const policyMode =
    policyRaw?.mode === 'safe' || policyRaw?.mode === 'update' || policyRaw?.mode === 'custom'
      ? policyRaw.mode
      : undefined
  if (policyRaw && policyMode) {
    const groups: Partial<Record<FileGroup, ConflictResolution>> = {}
    if (isRecord(policyRaw.groups)) {
      for (const [key, value] of Object.entries(policyRaw.groups)) {
        if (!FILE_GROUP_KEYS.includes(key as FileGroup)) continue
        if (!CONFLICT_RESOLUTIONS.includes(value as ConflictResolution)) continue
        groups[key as FileGroup] = value as ConflictResolution
      }
    }
    config.conflictPolicy =
      Object.keys(groups).length > 0 ? { mode: policyMode, groups } : { mode: policyMode }
  } else {
    delete config.conflictPolicy
  }

  // BLE 配置（M12）：宽松解析。
  // - features.ble=true 但缺 ble 节 → 补 DEFAULT_BLE_CONFIG（手工编辑/旧版本工程的兜底）；
  // - ble 节结构非法（role/macSource 非枚举）→ 丢弃该节，其余配置照常导入；
  // - features.ble 未开启且无 ble 节 → 不写该字段（旧工程往返逐字节不变）。
  const bleRaw = raw.ble
  const ble =
    bleRaw === undefined && features.ble === true
      ? { ...DEFAULT_BLE_CONFIG }
      : parseBleConfig(bleRaw)
  if (ble) config.ble = ble
  else delete config.ble

  return { config }
}

/** 配置 → 格式化 JSON（2 空格缩进，与导出的 cube.json 一致；包含 generator 等全部字段）。 */
export function serializeProjectFile(config: ProjectConfig): string {
  return JSON.stringify(config, null, 2)
}

/** 单独保存配置文件：<projectName>.cube.json。
 *  浏览器：Blob + 临时 <a>；桌面端：原生“另存为”对话框。返回是否已保存（取消为 false）。 */
export async function downloadProjectFile(config: ProjectConfig): Promise<boolean> {
  const name = config.projectName?.trim() || 'ch32-project'
  const text = serializeProjectFile(config)
  if (isDesktopApp()) {
    return saveFileNative(`${name}.cube.json`, text, [
      { name: 'CH32 Cube 配置', extensions: ['json'] },
    ])
  }
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.cube.json`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 等浏览器开始下载后再释放对象 URL
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}

/** 读取用户选择的文件为文本（FileReader，兼容本地文件与拖拽）。 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsText(file)
  })
}