// M4.7/M8 信号选择器纯函数测试：分组结构 / 多 remap 档 / 当前徽标 / 搜索过滤 / 确定性。
import { describe, it, expect } from 'vitest'
import { buildSignalGroups, filterSignalGroups, type SignalGroup } from '@/components/pinout/SignalsSelector.vue'
import { getDeviceData } from '@/model/device'
import type { ChipPin, PinAssignment } from '@/model/types'

const data = getDeviceData('CH32V203C8T6')
const pinOf = (name: string): ChipPin => {
  const p = data.chip.pins.find((x) => x.name === name)
  if (!p) throw new Error(`测试数据缺少引脚 ${name}`)
  return p
}
const pa9 = pinOf('PA9')
const pa0 = pinOf('PA0')

const groupOf = (groups: SignalGroup[], id: string) => groups.find((g) => g.id === id)
const entryKeys = (g: SignalGroup | undefined) => (g?.entries ?? []).map((e) => e.key)

function asg(over: Partial<PinAssignment>): PinAssignment {
  return { pin: 'PA9', mode: 'AF', params: {}, ...over }
}

describe('buildSignalGroups：分组结构', () => {
  it('分组顺序为 GPIO → AF 实例（字母序）→ Analog → Reserved', () => {
    const groups = buildSignalGroups(pa9, data)
    expect(groups.map((g) => g.id)).toEqual(['gpio', 'TIM1', 'USART1', 'reserved'])
    expect(groups[0].label).toBe('GPIO')
    expect(groups[groups.length - 1].label).toBe('Reserved')
  })

  it('GPIO 组含 INPUT / OUTPUT 两个入口', () => {
    const gpio = groupOf(buildSignalGroups(pa9, data), 'gpio')
    expect(gpio!.entries.map((e) => e.mode)).toEqual(['INPUT', 'OUTPUT'])
  })

  it('AF 按外设实例分组：PA9 的 USART1 含 TX/RTS', () => {
    const usart1 = groupOf(buildSignalGroups(pa9, data), 'USART1')
    expect(usart1!.entries.map((e) => e.signal)).toEqual(['USART1_RTS', 'USART1_TX'])
    expect(usart1!.entries.map((e) => e.remap)).toEqual([2, 0])
  })

  it('多 remap 档并列且 key 唯一（PA9 TIM1_CH2 remap 0/1）', () => {
    const tim1 = groupOf(buildSignalGroups(pa9, data), 'TIM1')
    const ch2 = tim1!.entries.filter((e) => e.signal === 'TIM1_CH2')
    expect(ch2.map((e) => e.remap)).toEqual([0, 1])
    expect(new Set(entryKeys(tim1)).size).toBe(tim1!.entries.length)
  })

  it('Analog 组列出 pin.adc 通道（PA0 → ADC_IN0）', () => {
    const groups = buildSignalGroups(pa0, data)
    const analog = groupOf(groups, 'analog')
    expect(analog).toBeDefined()
    expect(analog!.entries.map((e) => e.signal)).toEqual(['ADC_IN0'])
  })

  it('Reserved 组始终存在且 mode=RESERVED', () => {
    const reserved = groupOf(buildSignalGroups(pa0, data), 'reserved')
    expect(reserved!.entries).toHaveLength(1)
    expect(reserved!.entries[0].mode).toBe('RESERVED')
  })
})

describe('buildSignalGroups：当前徽标', () => {
  it('AF 当前档：function + remap 精确匹配（USART1_TX remap 0）', () => {
    const groups = buildSignalGroups(pa9, data, asg({ function: 'USART1_TX', remap: 0 }))
    const current = groups.flatMap((g) => g.entries).filter((e) => e.current)
    expect(current.map((e) => e.key)).toEqual(['af:USART1_TX#0'])
  })

  it('AF 未指定 remap 时视作该信号最小 remap 档为当前', () => {
    const groups = buildSignalGroups(pa9, data, asg({ function: 'TIM1_CH2' }))
    const current = groups
      .flatMap((g) => g.entries)
      .filter((e) => e.current)
      .map((e) => e.key)
    expect(current).toEqual(['af:TIM1_CH2#0'])
  })

  it('GPIO 当前档：INPUT / OUTPUT 各自命中', () => {
    const input = buildSignalGroups(pa9, data, asg({ mode: 'INPUT' }))
    expect(input.flatMap((g) => g.entries).filter((e) => e.current).map((e) => e.mode)).toEqual(['INPUT'])
    const output = buildSignalGroups(pa9, data, asg({ mode: 'OUTPUT' }))
    expect(output.flatMap((g) => g.entries).filter((e) => e.current).map((e) => e.mode)).toEqual(['OUTPUT'])
  })

  it('Reserved 当前档', () => {
    const groups = buildSignalGroups(pa9, data, asg({ mode: 'RESERVED' }))
    const current = groups.flatMap((g) => g.entries).filter((e) => e.current)
    expect(current.map((e) => e.key)).toEqual(['reserved:RESERVED'])
  })

  it('无 assignment 时无任何当前档', () => {
    const groups = buildSignalGroups(pa9, data)
    expect(groups.flatMap((g) => g.entries).some((e) => e.current)).toBe(false)
  })
})

describe('filterSignalGroups：搜索', () => {
  const groups = buildSignalGroups(pa9, data)

  it('空查询返回全量（条目数不变）', () => {
    const out = filterSignalGroups(groups, '   ')
    expect(out).toEqual(groups)
  })

  it('信号名大小写不敏感', () => {
    const out = filterSignalGroups(groups, 'usart1_tx')
    expect(out.map((g) => g.id)).toEqual(['USART1'])
    expect(out[0].entries.map((e) => e.signal)).toEqual(['USART1_TX'])
  })

  it('外设名命中整个实例分组', () => {
    const out = filterSignalGroups(groups, 'tim1')
    expect(out.map((g) => g.id)).toEqual(['TIM1'])
    expect(out[0].entries).toHaveLength(2)
  })

  it('引脚别名参与搜索', () => {
    const aliasPin: ChipPin = { ...pa9, aliases: ['PA9_ALT_FN'] }
    const withAlias = buildSignalGroups(aliasPin, data)
    const out = filterSignalGroups(withAlias, 'pa9_alt_fn')
    expect(out).toEqual(withAlias)
  })

  it('无匹配返回空数组', () => {
    expect(filterSignalGroups(groups, 'NO_SUCH_SIGNAL')).toEqual([])
  })

  it('确定性：两次构建结果深度相等', () => {
    expect(buildSignalGroups(pa9, data)).toEqual(buildSignalGroups(pa9, data))
  })
})
