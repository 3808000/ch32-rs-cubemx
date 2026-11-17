// BLE 配置的 cube.json 往返与 store 挂载测试（M12，契约 D1/D2）：
// 覆盖合法往返、features.ble 保留、宽松丢弃非法结构、缺省补全、数值边界与 store 互锁。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ProjectConfig } from '@/model/types'
import { DEFAULT_BLE_CONFIG } from '@/model/types/project'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'
import { useProjectStore } from '@/controllers/project'

function expectConfig(raw: Record<string, unknown>): ProjectConfig {
  const result = parseProjectFile(JSON.stringify(raw))
  if ('error' in result) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.config
}

function baseConfig(): ProjectConfig {
  return {
    version: 1,
    chip: 'CH582M',
    projectName: 'ble-demo',
    pins: [],
    groups: [],
    naming: { prefix: '' },
    peripherals: {},
    features: { embassy: true, debugPrint: true, ble: true },
    hal: { rev: 'test' },
    unlockedPins: [],
    ble: {
      ...DEFAULT_BLE_CONFIG,
      role: 'broadcaster',
      deviceName: 'MySensor',
      advIntervalMs: 250,
      macSource: 'custom',
      mac: 'AA:BB:CC:DD:EE:FF',
      serviceUuid16: 0xffe0,
      notifyUuid16: 0xffe1,
      writeUuid16: 0xffe2,
      scanMs: 500,
      activeScan: true,
    },
  }
}

describe('ble cube.json 往返', () => {
  it('完整 BLE 配置 serialize → parse 深度一致', () => {
    const config = baseConfig()
    expect(expectConfig(JSON.parse(serializeProjectFile(config)))).toEqual(config)
  })

  it('serialize 输出包含 ble 与 features.ble', () => {
    const text = serializeProjectFile(baseConfig())
    expect(text).toContain('"ble": {')
    expect(text).toContain('"ble": true')
    expect(text).toContain('"role": "broadcaster"')
  })

  it('features.ble 与自定义 MAC 原样保留', () => {
    const cfg = expectConfig(JSON.parse(serializeProjectFile(baseConfig())))
    expect(cfg.features.ble).toBe(true)
    expect(cfg.ble?.macSource).toBe('custom')
    expect(cfg.ble?.mac).toBe('AA:BB:CC:DD:EE:FF')
  })

  it('旧工程（无 ble 字段、features 无 ble）→ 不写 ble/features.ble，保持形状不变', () => {
    const cfg = expectConfig({
      version: 1,
      chip: 'CH582M',
      projectName: 'legacy',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: false, debugPrint: true },
      hal: { rev: 'test' },
    })
    expect('ble' in cfg).toBe(false)
    expect('ble' in cfg.features).toBe(false)
  })
})

describe('ble 宽松解析', () => {
  it('role 非枚举（central）→ 丢弃 ble 节，其余配置保留', () => {
    const raw = JSON.parse(serializeProjectFile(baseConfig()))
    raw.ble.role = 'central'
    raw.projectName = 'keep-me'
    const cfg = expectConfig(raw)
    expect(cfg.ble).toBeUndefined()
    expect(cfg.projectName).toBe('keep-me')
    expect(cfg.features.ble).toBe(true) // 开关保留，缺配置由 store 回退缺省
  })

  it('macSource 非枚举 → 丢弃 ble 节', () => {
    const raw = JSON.parse(serializeProjectFile(baseConfig()))
    raw.ble.macSource = 'rom'
    expect(expectConfig(raw).ble).toBeUndefined()
  })

  it('ble 非对象（字符串/数字/数组）→ 丢弃该节', () => {
    for (const bad of ['x', 42, [1, 2]]) {
      const raw = JSON.parse(serializeProjectFile(baseConfig()))
      raw.ble = bad
      expect(expectConfig(raw).ble).toBeUndefined()
    }
  })

  it('缺字段 → 用 DEFAULT_BLE_CONFIG 补全', () => {
    const cfg = expectConfig({
      version: 1,
      chip: 'CH582M',
      projectName: 'minimal-ble',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: true, debugPrint: true, ble: true },
      hal: { rev: 'test' },
      ble: { role: 'broadcaster', macSource: 'factory' },
    })
    expect(cfg.ble).toEqual({ ...DEFAULT_BLE_CONFIG, role: 'broadcaster' })
  })

  it('数值越界/类型错误 → 各字段回退缺省值', () => {
    const cfg = expectConfig({
      version: 1,
      chip: 'CH582M',
      projectName: 'bad-numbers',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: true, debugPrint: true, ble: true },
      hal: { rev: 'test' },
      ble: {
        role: 'observer',
        macSource: 'default',
        advIntervalMs: 0,
        scanMs: 999999,
        serviceUuid16: -1,
        notifyUuid16: 0x10000,
        writeUuid16: 1.5,
        activeScan: 'yes',
        deviceName: 7,
      },
    })
    expect(cfg.ble?.advIntervalMs).toBe(DEFAULT_BLE_CONFIG.advIntervalMs)
    expect(cfg.ble?.scanMs).toBe(DEFAULT_BLE_CONFIG.scanMs)
    expect(cfg.ble?.serviceUuid16).toBe(DEFAULT_BLE_CONFIG.serviceUuid16)
    expect(cfg.ble?.notifyUuid16).toBe(DEFAULT_BLE_CONFIG.notifyUuid16)
    expect(cfg.ble?.writeUuid16).toBe(DEFAULT_BLE_CONFIG.writeUuid16)
    expect(cfg.ble?.activeScan).toBe(DEFAULT_BLE_CONFIG.activeScan)
    expect(cfg.ble?.deviceName).toBe(DEFAULT_BLE_CONFIG.deviceName)
  })

  it('features.ble=true 但缺 ble 节 → 补 DEFAULT_BLE_CONFIG', () => {
    const cfg = expectConfig({
      version: 1,
      chip: 'CH582M',
      projectName: 'switch-on',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: true, debugPrint: true, ble: true },
      hal: { rev: 'test' },
    })
    expect(cfg.ble).toEqual(DEFAULT_BLE_CONFIG)
  })

  it('custom MAC 格式非法仍保留（交给 BLE_MAC_INVALID 规则提示，不在导入期吞掉）', () => {
    const raw = JSON.parse(serializeProjectFile(baseConfig()))
    raw.ble.mac = 'ZZ:ZZ'
    expect(expectConfig(raw).ble?.mac).toBe('ZZ:ZZ')
  })
})

describe('store BLE 状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始 ble=DEFAULT_BLE_CONFIG、features.ble=false，config 不写 BLE 字段', () => {
    const store = useProjectStore()
    expect(store.ble).toEqual(DEFAULT_BLE_CONFIG)
    expect(store.features.ble).toBe(false)
    expect('ble' in store.config).toBe(false)
    expect('ble' in store.config.features).toBe(false)
  })

  it('setFeatures({ble:true}) 强制 embassy=true 并标记 dirty', () => {
    const store = useProjectStore()
    store.setFeatures({ ble: true })
    expect(store.features.ble).toBe(true)
    expect(store.features.embassy).toBe(true)
    expect(store.dirty).toBe(true)
  })

  it('setBle 合并 partial，config 组装 ble 与 features.ble', () => {
    const store = useProjectStore()
    store.setFeatures({ ble: true })
    store.setBle({ role: 'observer', deviceName: 'ScanNode', scanMs: 1200 })
    expect(store.ble.role).toBe('observer')
    expect(store.ble.deviceName).toBe('ScanNode')
    expect(store.ble.scanMs).toBe(1200)
    expect(store.config.features.ble).toBe(true)
    expect(store.config.ble).toEqual(store.ble)
  })

  it('loadConfig 深合并 ble 缺省；switchDevice 重置 ble 与开关', () => {
    const store = useProjectStore()
    store.loadConfig({
      chip: 'CH582M',
      features: { embassy: true, debugPrint: true, ble: true },
      ble: { ...DEFAULT_BLE_CONFIG, role: 'observer', deviceName: 'Loaded' },
    })
    expect(store.ble.deviceName).toBe('Loaded')
    expect(store.ble.scanMs).toBe(DEFAULT_BLE_CONFIG.scanMs)

    store.switchDevice('CH32V003F4P6')
    expect(store.ble).toEqual(DEFAULT_BLE_CONFIG)
    expect(store.features.ble).toBe(false)
  })
})
