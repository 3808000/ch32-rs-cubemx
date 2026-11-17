// BLE 冲突规则单元测试（M12，契约 D2/D3/D7）：
// 覆盖各冲突码的触发/不触发、设备名 UTF-8 字节边界、MAC 格式与"BLE 未启用零冲突"。
import { describe, expect, it } from 'vitest'
import type { BleConfig, Conflict, PinAssignment, ProjectConfig, PeripheralState } from '@/model/types'
import { DEFAULT_BLE_CONFIG } from '@/model/types/project'
import { checkConflicts } from '@/model/conflicts'
import { getDeviceData } from '@/model/device'

const data = getDeviceData('CH582M')

function ble(overrides: Partial<BleConfig> = {}): BleConfig {
  return { ...DEFAULT_BLE_CONFIG, ...overrides }
}

function pin(name: string, mode: PinAssignment['mode'] = 'INPUT'): PinAssignment {
  return { pin: name, mode, params: {} }
}

function makeConfig(
  opts: {
    pins?: PinAssignment[]
    features?: ProjectConfig['features']
    bleConfig?: BleConfig
    peripherals?: Record<string, PeripheralState>
  } = {},
): ProjectConfig {
  return {
    version: 1,
    chip: 'CH582M',
    projectName: 'ble-test',
    pins: opts.pins ?? [],
    naming: { prefix: '' },
    peripherals: opts.peripherals ?? {},
    features: opts.features ?? { embassy: true, debugPrint: false, ble: true },
    hal: { rev: 'test' },
    ble: opts.bleConfig ?? ble(),
  }
}

function byCode(out: Conflict[], code: string): Conflict[] {
  return out.filter((c) => c.code === code)
}

function bleCodes(out: Conflict[]): string[] {
  return out.filter((c) => c.code.startsWith('BLE_')).map((c) => c.code)
}

describe('BLE 未启用', () => {
  it('features.ble=false → 即使 embassy 关闭、PA10 被占、自定义 MAC 非法也零 BLE 冲突', () => {
    const out = checkConflicts(
      makeConfig({
        pins: [pin('PA10')],
        features: { embassy: false, debugPrint: false, ble: false },
        bleConfig: ble({ macSource: 'custom', mac: 'not-a-mac' }),
      }),
      data,
    )
    expect(bleCodes(out)).toEqual([])
  })

  it('无 ble 字段（旧工程）→ 零 BLE 冲突', () => {
    const cfg = makeConfig({ features: { embassy: false, debugPrint: true } })
    delete cfg.ble
    const out = checkConflicts(cfg, data)
    expect(bleCodes(out)).toEqual([])
  })
})

describe('BLE_REQUIRES_EMBASSY', () => {
  it('正：ble 开、embassy 关 → error', () => {
    const out = checkConflicts(makeConfig({ features: { embassy: false, debugPrint: false, ble: true } }), data)
    const c = byCode(out, 'BLE_REQUIRES_EMBASSY')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].message).toContain('embassy')
  })

  it('反：ble + embassy 同开 → 无该错误', () => {
    const out = checkConflicts(makeConfig(), data)
    expect(byCode(out, 'BLE_REQUIRES_EMBASSY')).toHaveLength(0)
  })
})

describe('BLE_LSE_PIN_IN_USE', () => {
  it('正：PA10 有任何 assignment → error，pins 含 PA10', () => {
    const out = checkConflicts(makeConfig({ pins: [pin('PA10')] }), data)
    const c = byCode(out, 'BLE_LSE_PIN_IN_USE')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].pins).toEqual(['PA10'])
    expect(c[0].message).toContain('X32KI')
  })

  it('正：PA10 + PA11 同时被占 → pins 按 PA10/PA11 顺序列出', () => {
    const out = checkConflicts(makeConfig({ pins: [pin('PA11', 'OUTPUT'), pin('PA10')] }), data)
    expect(byCode(out, 'BLE_LSE_PIN_IN_USE')[0].pins).toEqual(['PA10', 'PA11'])
  })

  it('正：RESERVED 标记也算 assignment（仍然占用）', () => {
    const out = checkConflicts(makeConfig({ pins: [pin('PA11', 'RESERVED')] }), data)
    expect(byCode(out, 'BLE_LSE_PIN_IN_USE')).toHaveLength(1)
  })

  it('反：未分配 PA10/PA11 → 无该错误', () => {
    const out = checkConflicts(makeConfig({ pins: [pin('PA4', 'ANALOG'), pin('PA9')] }), data)
    expect(byCode(out, 'BLE_LSE_PIN_IN_USE')).toHaveLength(0)
  })
})

describe('BLE_ADC_SHARED', () => {
  it('正：BLE 开 + ADC 启用 → warning，说明 temperature_raw 抢占', () => {
    const out = checkConflicts(
      makeConfig({ peripherals: { ADC: { enabled: true, params: {} } } }),
      data,
    )
    const c = byCode(out, 'BLE_ADC_SHARED')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('warning')
    expect(c[0].peripheral).toBe('ADC')
    expect(c[0].message).toContain('temperature_raw')
  })

  it('反：ADC 未启用 → 无 warning', () => {
    const out = checkConflicts(
      makeConfig({ peripherals: { ADC: { enabled: false, params: {} } } }),
      data,
    )
    expect(byCode(out, 'BLE_ADC_SHARED')).toHaveLength(0)
  })
})

describe('BLE_NAME_TOO_LONG', () => {
  it('peripheral 边界：26 字节（扫描响应恰好 31）→ 无错误', () => {
    const name = 'A'.repeat(26)
    const out = checkConflicts(makeConfig({ bleConfig: ble({ deviceName: name }) }), data)
    expect(byCode(out, 'BLE_NAME_TOO_LONG')).toHaveLength(0)
  })

  it('peripheral 边界：27 字节（扫描响应 32）→ error，提示 31/26 字节', () => {
    const name = 'A'.repeat(27)
    const out = checkConflicts(makeConfig({ bleConfig: ble({ deviceName: name }) }), data)
    const c = byCode(out, 'BLE_NAME_TOO_LONG')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].message).toContain('27 字节')
    expect(c[0].message).toContain('31')
    expect(c[0].message).toContain('26')
  })

  it('broadcaster 边界：29 字节无错误 / 30 字节 error（上限 29）', () => {
    const ok = checkConflicts(
      makeConfig({ bleConfig: ble({ role: 'broadcaster', deviceName: 'A'.repeat(29) }) }),
      data,
    )
    expect(byCode(ok, 'BLE_NAME_TOO_LONG')).toHaveLength(0)

    const bad = checkConflicts(
      makeConfig({ bleConfig: ble({ role: 'broadcaster', deviceName: 'A'.repeat(30) }) }),
      data,
    )
    const c = byCode(bad, 'BLE_NAME_TOO_LONG')
    expect(c).toHaveLength(1)
    expect(c[0].message).toContain('29')
  })

  it('observer：不广播名字，200 字节（<248）→ 无错误', () => {
    const out = checkConflicts(
      makeConfig({ bleConfig: ble({ role: 'observer', deviceName: 'A'.repeat(200) }) }),
      data,
    )
    expect(byCode(out, 'BLE_NAME_TOO_LONG')).toHaveLength(0)
  })

  it('多字节：9 个汉字 = 27 UTF-8 字节 → error（按字节而非字符计数）', () => {
    const out = checkConflicts(makeConfig({ bleConfig: ble({ deviceName: '蓝牙设备名称啊测试' }) }), data)
    const c = byCode(out, 'BLE_NAME_TOO_LONG')
    expect(c).toHaveLength(1)
    expect(c[0].message).toContain('27 字节')
  })

  it('GAP 上限：249 字节 → error，提示 248 字节上限', () => {
    const out = checkConflicts(makeConfig({ bleConfig: ble({ deviceName: 'A'.repeat(249) }) }), data)
    const c = byCode(out, 'BLE_NAME_TOO_LONG')
    expect(c).toHaveLength(1)
    expect(c[0].message).toContain('249 字节')
    expect(c[0].message).toContain('248')
  })

  it('反：缺省名 CH582M → 无错误', () => {
    const out = checkConflicts(makeConfig(), data)
    expect(byCode(out, 'BLE_NAME_TOO_LONG')).toHaveLength(0)
  })
})

describe('BLE_MAC_INVALID', () => {
  it('正：custom + 只有 5 段 → error，message 给出格式示例', () => {
    const out = checkConflicts(
      makeConfig({ bleConfig: ble({ macSource: 'custom', mac: 'AA:BB:CC:DD:EE' }) }),
      data,
    )
    const c = byCode(out, 'BLE_MAC_INVALID')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].message).toContain('AA:BB:CC:DD:EE:FF')
  })

  it('正：custom 但 mac 缺失 → error', () => {
    const out = checkConflicts(makeConfig({ bleConfig: ble({ macSource: 'custom' }) }), data)
    expect(byCode(out, 'BLE_MAC_INVALID')).toHaveLength(1)
  })

  it('正：custom + 非 hex 字符 → error', () => {
    const out = checkConflicts(
      makeConfig({ bleConfig: ble({ macSource: 'custom', mac: 'GG:BB:CC:DD:EE:FF' }) }),
      data,
    )
    expect(byCode(out, 'BLE_MAC_INVALID')).toHaveLength(1)
  })

  it('反：custom + AA:BB:CC:DD:EE:FF → 无错误', () => {
    const out = checkConflicts(
      makeConfig({ bleConfig: ble({ macSource: 'custom', mac: 'AA:BB:CC:DD:EE:FF' }) }),
      data,
    )
    expect(byCode(out, 'BLE_MAC_INVALID')).toHaveLength(0)
  })

  it('反：custom + 小写/短横线格式 aa-bb-cc-dd-ee-ff → 无错误', () => {
    const out = checkConflicts(
      makeConfig({ bleConfig: ble({ macSource: 'custom', mac: 'aa-bb-cc-dd-ee-ff' }) }),
      data,
    )
    expect(byCode(out, 'BLE_MAC_INVALID')).toHaveLength(0)
  })

  it('反：factory/default 来源即使 mac 字段有垃圾 → 无错误', () => {
    for (const macSource of ['factory', 'default'] as const) {
      const out = checkConflicts(
        makeConfig({ bleConfig: ble({ macSource, mac: 'garbage' }) }),
        data,
      )
      expect(byCode(out, 'BLE_MAC_INVALID')).toHaveLength(0)
    }
  })
})
