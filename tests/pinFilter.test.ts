// M2 引脚过滤/状态模型契约测试（纯函数）。
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PIN_FILTER,
  derivePinState,
  pinMatchesSearch,
  pinMatchesFacets,
  PIN_STATE_META,
  type PinStateContext,
} from '@/model/pins/pinFilter'
import type { ChipPin, PinAssignment } from '@/model/types'

const io: ChipPin = { name: 'PA0', number: 10, type: 'IO', side: 'left' } as ChipPin
const power: ChipPin = { name: 'VDD', number: 9, type: 'POWER', side: 'left' } as ChipPin
const asg: PinAssignment = { pin: 'PA0', mode: 'AF', function: 'USART1_TX', label: 'TX', params: {} }
const ctx = (over: Partial<PinStateContext> = {}): PinStateContext => ({
  reserved: false,
  pinned: false,
  excluded: false,
  hasError: false,
  hasWarning: false,
  ...over,
})

describe('derivePinState（九态优先级）', () => {
  it('非 IO → notConfigurable', () => {
    expect(derivePinState(power, ctx())).toBe('notConfigurable')
  })
  it('错误优先于已配置', () => {
    expect(derivePinState(io, ctx({ assignment: asg, hasError: true }))).toBe('error')
  })
  it('警告优先于已配置', () => {
    expect(derivePinState(io, ctx({ assignment: asg, hasWarning: true }))).toBe('warning')
  })
  it('有分配 → configured', () => {
    expect(derivePinState(io, ctx({ assignment: asg }))).toBe('configured')
  })
  it('外设占用 → reserved', () => {
    expect(derivePinState(io, ctx({ reserved: true }))).toBe('reserved')
  })
  it('无分配无占用 → unassigned', () => {
    expect(derivePinState(io, ctx())).toBe('unassigned')
  })
  it('excluded 优先', () => {
    expect(derivePinState(io, ctx({ excluded: true, assignment: asg }))).toBe('excluded')
  })
})

describe('pinMatchesSearch（按类型搜索引脚集合）', () => {
  it('空文本全匹配', () => {
    expect(pinMatchesSearch(io, undefined, { ...DEFAULT_PIN_FILTER, text: '' })).toBe(true)
  })
  it('pin 类型按名', () => {
    expect(pinMatchesSearch(io, undefined, { ...DEFAULT_PIN_FILTER, searchType: 'pin', text: 'pa0' })).toBe(true)
    expect(pinMatchesSearch(io, undefined, { ...DEFAULT_PIN_FILTER, searchType: 'pin', text: 'PB' })).toBe(false)
  })
  it('signal 类型按功能（未配置引脚不匹配信号）', () => {
    expect(pinMatchesSearch(io, asg, { ...DEFAULT_PIN_FILTER, searchType: 'signal', text: 'usart1' })).toBe(true)
    expect(pinMatchesSearch(io, undefined, { ...DEFAULT_PIN_FILTER, searchType: 'signal', text: 'usart1' })).toBe(false)
  })
  it('label / position', () => {
    expect(pinMatchesSearch(io, asg, { ...DEFAULT_PIN_FILTER, searchType: 'label', text: 'tx' })).toBe(true)
    expect(pinMatchesSearch(io, undefined, { ...DEFAULT_PIN_FILTER, searchType: 'position', text: '10' })).toBe(true)
  })
  it('all 跨 name/function/label/position', () => {
    expect(pinMatchesSearch(io, asg, { ...DEFAULT_PIN_FILTER, searchType: 'all', text: 'usart' })).toBe(true)
    expect(pinMatchesSearch(io, undefined, { ...DEFAULT_PIN_FILTER, searchType: 'all', text: '10' })).toBe(true)
  })
})

describe('pinMatchesFacets + 元数据', () => {
  it('空 states/types 不过滤', () => {
    expect(pinMatchesFacets(io, 'configured', DEFAULT_PIN_FILTER)).toBe(true)
  })
  it('states 过滤', () => {
    expect(pinMatchesFacets(io, 'configured', { ...DEFAULT_PIN_FILTER, states: ['configured'] })).toBe(true)
    expect(pinMatchesFacets(io, 'unassigned', { ...DEFAULT_PIN_FILTER, states: ['configured'] })).toBe(false)
  })
  it('types 过滤', () => {
    expect(pinMatchesFacets(power, 'notConfigurable', { ...DEFAULT_PIN_FILTER, types: ['POWER'] })).toBe(true)
    expect(pinMatchesFacets(io, 'configured', { ...DEFAULT_PIN_FILTER, types: ['POWER'] })).toBe(false)
  })
  it('PIN_STATE_META 覆盖八态（含标签）', () => {
    expect(PIN_STATE_META.length).toBe(8)
    expect(PIN_STATE_META.every((m) => m.label.length > 0)).toBe(true)
  })
})
