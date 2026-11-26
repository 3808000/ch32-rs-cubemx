// M19：BLE 作为数据驱动的片上外设入口（列表/工作区/冲突）。
import { describe, expect, it } from 'vitest'
import type { BleConfig, ProjectConfig } from '@/model/types'
import { DEFAULT_BLE_CONFIG } from '@/model/types/project'
import { getDeviceData } from '@/model/device'
import { derivePeriCategories } from '@/components/PeripheralList.vue'
import { checkConflicts } from '@/model/conflicts'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'

const ch582 = getDeviceData('CH582M')
const v003 = getDeviceData('CH32V003F4P6')

function config(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH582M',
    projectName: 'ble-entry',
    pins: [],
    naming: { prefix: '' },
    peripherals: {},
    features: { embassy: true, debugPrint: false, ble: true },
    hal: { rev: 'test' },
    ble: { ...DEFAULT_BLE_CONFIG },
    ...overrides,
  }
}

function bleConfig(patch: Partial<BleConfig>): BleConfig {
  return { ...DEFAULT_BLE_CONFIG, ...patch }
}

describe('BLE 外设数据声明', () => {
  it('CH582M 声明 BLE 实例、后端与资源', () => {
    const cap = ch582.peripherals.ble
    expect(cap?.instance).toBe('BLE')
    expect(cap?.category).toBe('Wireless')
    expect(cap?.roles).toEqual(['peripheral', 'broadcaster', 'observer'])
    expect(cap?.backends.map((b) => b.id)).toEqual(['shim', 'wchble'])
    expect(cap?.interrupts).toEqual(['BLEB', 'BLEL'])
    expect(cap?.requires?.lse).toBe(true)
  })

  it('无 BLE 能力的芯片不显示入口', () => {
    expect(v003.peripherals.ble).toBeUndefined()
  })
})

describe('Peripherals 列表', () => {
  it('CH582M 分类包含 Wireless/BLE', () => {
    const cats = derivePeriCategories(ch582)
    const wireless = cats.find((c) => c.key === 'wireless')
    expect(wireless).toBeTruthy()
    expect(wireless?.label).toBe('Wireless')
    expect(wireless?.ids).toEqual(['BLE'])
  })

  it('非 BLE 芯片分类不含 Wireless', () => {
    expect(derivePeriCategories(v003).some((c) => c.key === 'wireless')).toBe(false)
  })
})

describe('BLE 后端字段往返', () => {
  it('缺省不写 backend；显式 wchble 可往返，非法值忽略', () => {
    const base = config()
    expect(serializeProjectFile(base)).not.toContain('"backend"')
    const wch = { ...base, ble: { ...DEFAULT_BLE_CONFIG, backend: 'wchble' as const } }
    const parsed = parseProjectFile(serializeProjectFile(wch))
    expect('config' in parsed && parsed.config.ble?.backend).toBe('wchble')
    const raw = JSON.parse(serializeProjectFile(base))
    raw.ble.backend = 'bogus'
    const invalid = parseProjectFile(JSON.stringify(raw))
    expect('config' in invalid && invalid.config.ble?.backend).toBeUndefined()
  })
})

describe('BLE 资源冲突', () => {
  it('BLE 开启但 BLEL 中断被禁用 → BLE_IRQ_DISABLED error', () => {
    const out = checkConflicts(
      config({ interrupts: [{ irq: 'BLEL', enabled: false, priority: 0 }] }),
      ch582,
    )
    const c = out.filter((x) => x.code === 'BLE_IRQ_DISABLED')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].message).toContain('BLEL')
  })

  it('BLE 中断保持启用 → 无 BLE_IRQ_DISABLED', () => {
    const out = checkConflicts(
      config({ interrupts: [{ irq: 'BLEL', enabled: true, priority: 0 }] }),
      ch582,
    )
    expect(out.filter((x) => x.code === 'BLE_IRQ_DISABLED')).toHaveLength(0)
  })

  it('角色不在数据声明内 → BLE_ROLE_UNSUPPORTED error', () => {
    const data = {
      ...ch582,
      peripherals: { ...ch582.peripherals, ble: { ...ch582.peripherals.ble!, roles: ['peripheral'] } },
    }
    const out = checkConflicts(config({ ble: bleConfig({ role: 'observer' }) }), data)
    const c = out.filter((x) => x.code === 'BLE_ROLE_UNSUPPORTED')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].message).toContain('observer')
  })

  it('LSI 32K → BLE_LSI_CLOCK warning；LSE 缺省无该项', () => {
    const lsi = checkConflicts(config({ ble: bleConfig({ clock32k: 'lsi' }) }), ch582)
    expect(lsi.filter((x) => x.code === 'BLE_LSI_CLOCK')).toHaveLength(1)
    const lse = checkConflicts(config(), ch582)
    expect(lse.filter((x) => x.code === 'BLE_LSI_CLOCK')).toHaveLength(0)
  })

  it('backend=wchble（未开放导出）→ BLE_BACKEND_UNSUPPORTED error', () => {
    const out = checkConflicts(config({ ble: bleConfig({ backend: 'wchble' }) }), ch582)
    const c = out.filter((x) => x.code === 'BLE_BACKEND_UNSUPPORTED')
    expect(c).toHaveLength(1)
    expect(c[0].level).toBe('error')
    expect(c[0].message).toContain('wchble')
  })

  it('backend=shim 或缺省 → 无 BLE_BACKEND_UNSUPPORTED', () => {
    expect(checkConflicts(config({ ble: bleConfig({ backend: 'shim' }) }), ch582).filter((x) => x.code === 'BLE_BACKEND_UNSUPPORTED')).toHaveLength(0)
    expect(checkConflicts(config(), ch582).filter((x) => x.code === 'BLE_BACKEND_UNSUPPORTED')).toHaveLength(0)
  })

  it('BLE 关闭时资源规则不触发', () => {
    const out = checkConflicts(
      config({
        features: { embassy: false, debugPrint: false, ble: false },
        interrupts: [{ irq: 'BLEL', enabled: false, priority: 0 }],
        ble: bleConfig({ clock32k: 'lsi', role: 'observer' }),
      }),
      ch582,
    )
    expect(out.filter((x) => x.code.startsWith('BLE_'))).toEqual([])
  })
})