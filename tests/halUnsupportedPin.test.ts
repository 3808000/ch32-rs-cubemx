// 通用冲突规则 HAL_PIN_UNSUPPORTED：数据层标记 halUnsupported 的引脚一旦被分配即 error。
// 数据：真实 CH582M（PB17 在 ch58x-hal 无 Pin impl）与 CH32V003F4P6（无 halUnsupported 标记）。
import { describe, it, expect } from 'vitest'
import type { Conflict, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { checkConflicts } from '@/model/conflicts'
import { getDeviceData } from '@/model/device'

const ch582 = getDeviceData('CH582M')
const v003 = getDeviceData('CH32V003F4P6')

function makeConfig(pins: PinAssignment[], chip = 'CH582M'): ProjectConfig {
  return {
    version: 1,
    chip,
    projectName: 'test-project',
    pins,
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: true },
    hal: { rev: 'test' },
  }
}

function pin(name: string, mode: PinMode, function_?: string): PinAssignment {
  return { pin: name, mode, function: function_, params: {} }
}

function halUnsupported(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.code === 'HAL_PIN_UNSUPPORTED')
}

describe('HAL_PIN_UNSUPPORTED（PB17）', () => {
  it('正：PB17 分配为 OUTPUT → error，message 含引脚名与原因，pins 归属正确', () => {
    const out = checkConflicts(makeConfig([pin('PB17', 'OUTPUT')]), ch582)
    const hits = halUnsupported(out)
    expect(hits).toHaveLength(1)
    expect(hits[0].level).toBe('error')
    expect(hits[0].pins).toEqual(['PB17'])
    expect(hits[0].message).toContain('PB17')
    expect(hits[0].message).toContain('ch58x-hal 未实现 PB17 的 Pin trait')
  })

  it('反：未分配 PB17（只配置 PA7）→ 无 HAL_PIN_UNSUPPORTED', () => {
    const out = checkConflicts(makeConfig([pin('PA7', 'OUTPUT')]), ch582)
    expect(halUnsupported(out)).toEqual([])
  })

  it('反：其它芯片无 halUnsupported 数据 → 分配引脚不受影响', () => {
    expect(v003.chip.pins.every((p) => !p.halUnsupported)).toBe(true)
    const out = checkConflicts(makeConfig([pin('PC0', 'OUTPUT')], 'CH32V003F4P6'), v003)
    expect(halUnsupported(out)).toEqual([])
  })

  it('与现有规则链共存：PB17 重复分配 → HAL_PIN_UNSUPPORTED 只报一次且仍有 DUPLICATE_PIN', () => {
    const out = checkConflicts(makeConfig([pin('PB17', 'OUTPUT'), pin('PB17', 'INPUT')]), ch582)
    expect(halUnsupported(out)).toHaveLength(1)
    expect(out.filter((c) => c.code === 'DUPLICATE_PIN')).toHaveLength(1)
  })

  it('合法引脚与 PB17 混合配置：除 HAL_PIN_UNSUPPORTED 外无其它 error', () => {
    const out = checkConflicts(makeConfig([pin('PA7', 'OUTPUT'), pin('PB17', 'OUTPUT')]), ch582)
    expect(halUnsupported(out)).toHaveLength(1)
    expect(out.filter((c) => c.level === 'error')).toHaveLength(1)
  })

  it('halUnsupported 为空字符串视为未标记（非空才报）', () => {
    const synthetic = {
      ...ch582,
      chip: { ...ch582.chip, pins: ch582.chip.pins.map((p) => (p.name === 'PB17' ? { ...p, halUnsupported: '' } : p)) },
    }
    const out = checkConflicts(makeConfig([pin('PB17', 'OUTPUT')]), synthetic)
    expect(halUnsupported(out)).toEqual([])
  })
})
