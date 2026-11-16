// M2.5/M2.6 UI 契约测试：九态派生、Show 计数、统一过滤、搜索建议与状态色。
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PIN_FILTER,
  PIN_SEARCH_TYPE_META,
  PIN_STATE_META,
  buildPinSuggestions,
  conflictPinSets,
  countPinStates,
  derivePinStates,
  pinMatchesFilter,
  pinStateColors,
  pinStateLabel,
  type PinFilter,
} from '@/model/pins/pinFilter'
import { getDeviceData } from '@/model/device'
import { derivePeripheralUsage } from '@/model/peripherals'
import type { ChipPin, Conflict, PinAssignment, ProjectConfig } from '@/model/types'

const mkPin = (name: string, number: number, type: ChipPin['type'] = 'IO'): ChipPin => ({
  name,
  number,
  type,
  side: 'left',
})

const pa0 = mkPin('PA0', 1)
const pa1 = mkPin('PA1', 2)
const pa2 = mkPin('PA2', 3)
const pa3 = mkPin('PA3', 4)
const vdd = mkPin('VDD', 5, 'POWER')
const pins = [pa0, pa1, pa2, pa3, vdd]

const gpioInput: PinAssignment = { pin: 'PA0', mode: 'INPUT', params: { pull: 'NONE' } }
const afTx: PinAssignment = { pin: 'PA2', mode: 'AF', function: 'USART1_TX', params: {} }

const filter = (over: Partial<PinFilter> = {}): PinFilter => ({ ...DEFAULT_PIN_FILTER, ...over })

describe('derivePinStates（批量九态优先级）', () => {
  it('一次派生五种来源：configured/reserved/error/warning/notConfigurable', () => {
    const states = derivePinStates(pins, {
      assignments: [gpioInput, afTx],
      reservedPins: ['PA1', 'PA2'],
      pinnedPins: ['PA1'],
      warningPins: ['PA3'],
      errorPins: ['PA2'],
    })
    expect(states).toEqual({
      PA0: 'configured',
      PA1: 'reserved',
      PA2: 'error',
      PA3: 'warning',
      VDD: 'notConfigurable',
    })
  })

  it('excluded 优先于已配置；pinned 仅在无分配/预留时生效', () => {
    expect(derivePinStates([pa0], { assignments: [gpioInput], excludedPins: ['PA0'] }).PA0).toBe('excluded')
    expect(derivePinStates([pa0], { assignments: [], pinnedPins: ['PA0'] }).PA0).toBe('pinned')
  })

  it('真实芯片：所有引脚都有状态，非 IO 均为 notConfigurable，计数总和等于引脚数', () => {
    const chip = getDeviceData('CH32V003F4P6').chip
    const states = derivePinStates(chip.pins, { assignments: [] })
    expect(Object.keys(states)).toHaveLength(chip.pins.length)
    expect(chip.pins.filter((p) => p.type !== 'IO').every((p) => states[p.name] === 'notConfigurable')).toBe(true)
    const counts = countPinStates(chip.pins, states)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(chip.pins.length)
  })

  it('已启用外设 AF 引脚进入 reserved 来源；已有分配时按既有优先级显示 configured', () => {
    const data = getDeviceData('CH32V003F4P6')
    const config: ProjectConfig = {
      version: 1,
      chip: 'CH32V003F4P6',
      projectName: 'test',
      pins: [{ pin: 'PD5', mode: 'AF', function: 'USART1_TX', params: {} }],
      naming: { prefix: '' },
      features: { embassy: false, debugPrint: true },
      hal: { rev: 'test' },
    }
    const reserved = new Set<string>()
    for (const usage of derivePeripheralUsage(config, data)) {
      if (!usage.enabled) continue
      for (const p of usage.pins) reserved.add(p.pin)
    }
    expect(reserved.has('PD5')).toBe(true)
    const states = derivePinStates(data.chip.pins, { assignments: config.pins, reservedPins: reserved })
    expect(states.PD5).toBe('configured')
    expect(states.PA2).toBe('unassigned')
  })
})

describe('conflictPinSets / countPinStates', () => {
  it('冲突按 level 归集引脚，同引脚可同时出现在 error 与 warning', () => {
    const conflicts: Conflict[] = [
      { code: 'DUPLICATE_PIN', level: 'error', message: '', pins: ['PA1', 'PA2'] },
      { code: 'REMAP_MISMATCH', level: 'warning', message: '', pins: ['PA2', 'PA3'] },
      { code: 'USART_TX_MISSING', level: 'warning', message: '', peripheral: 'USART1' },
    ]
    const { errors, warnings } = conflictPinSets(conflicts)
    expect([...errors].sort()).toEqual(['PA1', 'PA2'])
    expect([...warnings].sort()).toEqual(['PA2', 'PA3'])
  })

  it('计数覆盖全部八态，未出现状态为 0', () => {
    const states = {
      PA0: 'configured',
      PA1: 'unassigned',
      PA2: 'error',
      PA3: 'unassigned',
      VDD: 'notConfigurable',
    } as const
    const counts = countPinStates(pins, states)
    expect(counts.configured).toBe(1)
    expect(counts.unassigned).toBe(2)
    expect(counts.error).toBe(1)
    expect(counts.notConfigurable).toBe(1)
    expect(counts.reserved).toBe(0)
    expect(counts.pinned).toBe(0)
    expect(counts.excluded).toBe(0)
    expect(counts.warning).toBe(0)
    expect(PIN_STATE_META.every((m) => typeof counts[m.id] === 'number')).toBe(true)
  })
})

describe('pinMatchesFilter（搜索 + Show + Type 组合）', () => {
  it('空条件匹配所有引脚（含未配置引脚）', () => {
    for (const p of pins) expect(pinMatchesFilter(p, undefined, 'unassigned', filter())).toBe(true)
  })

  it('Show 状态与 Type 同时生效', () => {
    expect(pinMatchesFilter(pa0, gpioInput, 'configured', filter({ states: ['configured'] }))).toBe(true)
    expect(pinMatchesFilter(pa2, afTx, 'error', filter({ states: ['configured'] }))).toBe(false)
    expect(pinMatchesFilter(vdd, undefined, 'notConfigurable', filter({ states: ['notConfigurable'], types: ['POWER'] }))).toBe(true)
    expect(pinMatchesFilter(pa0, gpioInput, 'configured', filter({ types: ['POWER'] }))).toBe(false)
  })

  it('搜索类型按 signal/label/position 过滤，并可与状态组合', () => {
    const bySignal = filter({ searchType: 'signal', text: 'usart1' })
    expect(pinMatchesFilter(pa2, afTx, 'configured', bySignal)).toBe(true)
    expect(pinMatchesFilter(pa0, gpioInput, 'configured', bySignal)).toBe(false)

    const byPosition = filter({ searchType: 'position', text: '3' })
    expect(pinMatchesFilter(pa2, undefined, 'unassigned', byPosition)).toBe(true)

    const labelFilter = filter({ searchType: 'label', text: 'led' })
    const led: PinAssignment = { pin: 'PA1', mode: 'OUTPUT', label: 'LED_RUN', params: {} }
    expect(pinMatchesFilter(pa1, led, 'configured', labelFilter)).toBe(true)
    expect(pinMatchesFilter(pa0, gpioInput, 'configured', labelFilter)).toBe(false)
    // 搜索命中但状态不匹配时仍被 Show 过滤掉
    const onlyConfigured = filter({ searchType: 'label', text: 'led', states: ['configured'] })
    expect(pinMatchesFilter(pa1, led, 'unassigned', onlyConfigured)).toBe(false)
  })
})

describe('buildPinSuggestions（搜索建议定位）', () => {
  const assignmentMap = new Map<string, PinAssignment>([
    ['PA0', gpioInput],
    ['PA2', afTx],
  ])
  const assignmentOf = (pin: string) => assignmentMap.get(pin)

  it('空文本不产生建议', () => {
    expect(buildPinSuggestions(pins, assignmentOf, filter())).toEqual([])
  })

  it('按 Pin/Position 匹配并带位置与附加信息', () => {
    const byPin = buildPinSuggestions(pins, assignmentOf, filter({ searchType: 'pin', text: 'pa' }))
    expect(byPin.map((s) => s.pin)).toEqual(['PA0', 'PA1', 'PA2', 'PA3'])
    expect(byPin[0]).toMatchObject({ number: 1, detail: '' })
    expect(byPin[2]).toMatchObject({ number: 3, detail: 'USART1_TX' })

    const byPos = buildPinSuggestions(pins, assignmentOf, filter({ searchType: 'position', text: '3' }))
    expect(byPos.map((s) => s.pin)).toEqual(['PA2'])
  })

  it('limit 截断建议数量', () => {
    expect(buildPinSuggestions(pins, assignmentOf, filter({ searchType: 'pin', text: 'pa' }), 2)).toHaveLength(2)
  })
})

describe('状态色与元数据（图例/表格/悬停共用）', () => {
  it('八态背景色互不相同，configured 按 GPIO/AF 细分', () => {
    const ids = PIN_STATE_META.map((m) => m.id)
    const bgs = ids.map((id) => pinStateColors(id).bg)
    expect(new Set(bgs).size).toBe(ids.length)
    expect(pinStateColors('configured').bg).toBe(pinStateColors('configured', 'INPUT').bg)
    expect(pinStateColors('configured', 'AF').bg).not.toBe(pinStateColors('configured').bg)
    expect(pinStateColors('configured', 'ANALOG').bg).toBe(pinStateColors('configured', 'AF').bg)
  })

  it('中文标签与搜索类型元数据完整', () => {
    expect(pinStateLabel('notConfigurable')).toBe('不可配置')
    expect(pinStateLabel('error')).toBe('错误')
    expect(PIN_STATE_META.map((m) => m.id)).toEqual([
      'configured',
      'reserved',
      'unassigned',
      'notConfigurable',
      'pinned',
      'excluded',
      'error',
      'warning',
    ])
    expect(PIN_SEARCH_TYPE_META.map((m) => m.id)).toEqual(['all', 'pin', 'signal', 'label', 'position'])
  })
})