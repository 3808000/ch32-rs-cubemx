// M4.7/M8 Reserved（用户保留）模型契约测试：
// 状态派生 / 冲突规则两路径 / 生成器跳过 / projectFile 往返。
import { describe, it, expect } from 'vitest'
import type { ChipPin, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { derivePinState, type PinStateContext } from '@/model/pins/pinFilter'
import { checkConflicts } from '@/model/conflicts'
import { generateProject } from '@/model/codegen'
import { extiItems, plainGpioPins } from '@/model/codegen/derive'
import { HAL_REV } from '@/model/codegen/halRev'
import { getDeviceData } from '@/model/device'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'

const data = getDeviceData('CH32V003F4P6')
const chipPin = (name: string): ChipPin => {
  const p = data.chip.pins.find((x) => x.name === name)
  if (!p) throw new Error(`测试数据缺少引脚 ${name}`)
  return p
}

function makeConfig(pins: PinAssignment[], over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'reserved-test',
    pins,
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: HAL_REV },
    ...over,
  }
}

function pin(
  name: string,
  mode: PinMode,
  extra: { function?: string; remap?: number; label?: string; exti?: boolean } = {},
): PinAssignment {
  return {
    pin: name,
    mode,
    function: extra.function,
    remap: extra.remap,
    label: extra.label,
    params: extra.exti ? { exti: { enabled: true, edge: 'RISING' } } : {},
  }
}

function stateCtx(over: Partial<PinStateContext> = {}): PinStateContext {
  return {
    reserved: false,
    pinned: false,
    excluded: false,
    hasError: false,
    hasWarning: false,
    ...over,
  }
}

describe('derivePinState：RESERVED → reserved', () => {
  it('RESERVED assignment 派生为 reserved（而非 configured）', () => {
    const asg = pin('PD4', 'RESERVED')
    expect(derivePinState(chipPin('PD4'), stateCtx({ assignment: asg }))).toBe('reserved')
  })

  it('错误仍优先于用户保留', () => {
    const asg = pin('PD4', 'RESERVED')
    expect(derivePinState(chipPin('PD4'), stateCtx({ assignment: asg, hasError: true }))).toBe('error')
  })

  it('用户保留优先于外设占用/图钉（同态色由 mode 区分）', () => {
    const asg = pin('PD4', 'RESERVED')
    expect(derivePinState(chipPin('PD4'), stateCtx({ assignment: asg, reserved: true, pinned: true }))).toBe('reserved')
  })
})

describe('RESERVED_PIN_IN_USE 冲突规则', () => {
  it('EXTI 配置落在 RESERVED 引脚 → error（pins 带引脚）', () => {
    const conflicts = checkConflicts(makeConfig([pin('PD4', 'RESERVED', { exti: true })]), data)
    const hit = conflicts.filter((c) => c.code === 'RESERVED_PIN_IN_USE')
    expect(hit).toHaveLength(1)
    expect(hit[0].level).toBe('error')
    expect(hit[0].pins).toEqual(['PD4'])
  })

  it('已启用外设 usage 落在 RESERVED 引脚 → error（规则取 usage 引脚）', () => {
    // 同一引脚同时存在 AF 分配（外设 usage 来源）与 RESERVED 标记：
    // 外设已启用且 usage 覆盖 PD5 → 规则必须报冲突。
    const config = makeConfig([
      pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
      pin('PD5', 'RESERVED'),
    ])
    const conflicts = checkConflicts(config, data)
    const hit = conflicts.filter((c) => c.code === 'RESERVED_PIN_IN_USE')
    expect(hit).toHaveLength(1)
    expect(hit[0].level).toBe('error')
    expect(hit[0].pins).toEqual(['PD5'])
    expect(hit[0].peripheral).toBe('USART1')
  })

  it('无 RESERVED 引脚时规则零输出', () => {
    const config = makeConfig([
      pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
      pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
    ])
    const conflicts = checkConflicts(config, data)
    expect(conflicts.some((c) => c.code === 'RESERVED_PIN_IN_USE')).toBe(false)
  })

  it('RESERVED 引脚不会自行产生外设 usage（无 AF/ANALOG 不启用外设）', () => {
    const config = makeConfig([pin('PD4', 'RESERVED')])
    const conflicts = checkConflicts(config, data)
    expect(conflicts.filter((c) => c.code === 'RESERVED_PIN_IN_USE')).toHaveLength(0)
  })
})

describe('生成器：RESERVED 不产生任何电气初始化', () => {
  it('plainGpioPins 不收集 RESERVED', () => {
    const config = makeConfig([pin('PD5', 'OUTPUT', { label: 'LED' }), pin('PD4', 'RESERVED')])
    expect(plainGpioPins(config, data).map((a) => a.pin)).toEqual(['PD5'])
  })

  it('generateProject 的 pins.rs 不含 RESERVED 引脚 ident', () => {
    const config = makeConfig([
      pin('PD5', 'OUTPUT', { label: 'LED' }),
      pin('PD4', 'RESERVED', { label: 'KEEP' }),
    ])
    const result = generateProject(config, data)
    expect(result.errors).toEqual([])
    const pins = result.files.find((f) => f.path.endsWith('pins.rs'))
    expect(pins).toBeDefined()
    expect(pins!.content).toContain('led')
    expect(pins!.content).not.toContain('pd4')
    expect(pins!.content).not.toContain('keep')
  })

  it('extiItems 防御性跳过 RESERVED（即使 params.exti 被置位）', () => {
    const config = makeConfig([
      pin('PD5', 'INPUT', { exti: true }),
      pin('PD4', 'RESERVED', { exti: true }),
    ])
    expect(extiItems(config, data).map((i) => i.pin)).toEqual(['PD5'])
  })

  it('RESERVED + EXTI 被冲突规则阻止导出（generateProject 返回错误且无文件）', () => {
    const config = makeConfig([pin('PD4', 'RESERVED', { exti: true })])
    const result = generateProject(config, data)
    expect(result.files).toEqual([])
    expect(result.errors.some((c) => c.code === 'RESERVED_PIN_IN_USE')).toBe(true)
  })

  it('外设初始化（usart.rs）不含 RESERVED 引脚 ident', () => {
    const config = makeConfig([
      pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
      pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
      pin('PD4', 'RESERVED'),
    ])
    const result = generateProject(config, data)
    expect(result.errors).toEqual([])
    const usart = result.files.find((f) => f.path.endsWith('usart.rs'))
    expect(usart).toBeDefined()
    expect(usart!.content.toLowerCase()).toContain('usart1')
    expect(usart!.content).not.toContain('pd4')
  })
})

describe('projectFile 往返：RESERVED 保留', () => {
  it('serialize → parse 后 mode/params/label 不变，function/remap 为空', () => {
    const config = makeConfig([
      pin('PD4', 'RESERVED', { label: 'KEEP_OUT' }),
      pin('PD5', 'OUTPUT', { label: 'LED' }),
    ])
    const parsed = parseProjectFile(serializeProjectFile(config))
    expect('config' in parsed).toBe(true)
    if (!('config' in parsed)) return
    const reserved = parsed.config.pins.find((a) => a.pin === 'PD4')
    expect(reserved).toBeDefined()
    expect(reserved!.mode).toBe('RESERVED')
    expect(reserved!.label).toBe('KEEP_OUT')
    expect(reserved!.function).toBeUndefined()
    expect(reserved!.remap).toBeUndefined()
    expect(parsed.config.pins).toHaveLength(2)
  })
})
