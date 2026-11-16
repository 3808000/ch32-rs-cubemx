// M5 引脚表升级（Used only / 分页 / 列可见性 / 行内 Assign）与 Export pinout 含/不含 AF 的纯函数契约测试。
import { describe, it, expect } from 'vitest'
import {
  PIN_TABLE_COLUMNS,
  PIN_TABLE_PAGE_SIZES,
  defaultPinTableColumnVisibility,
  isUsedPinState,
  pinTablePageCount,
  pinTablePageOfIndex,
  pinTablePageSlice,
  pinVisibleInTable,
} from '@/components/PinTable.vue'
import {
  PINOUT_EXPORT_FLAVORS,
  buildPinoutCsv,
  csvCell,
  pinoutCsvFileName,
} from '@/components/pinout/PinoutToolbar.vue'
import { DEFAULT_PIN_FILTER, type PinFilter, type PinStateId } from '@/model/pins/pinFilter'
import type { ChipPin, PinAssignment } from '@/model/types'

const mkPin = (name: string, number: number, type: ChipPin['type'] = 'IO'): ChipPin => ({
  name,
  number,
  type,
  side: 'left',
})

const pins = [mkPin('PA0', 1), mkPin('PA1', 2), mkPin('PA2', 3), mkPin('VDD', 4, 'POWER')]
const filter = (over: Partial<PinFilter> = {}): PinFilter => ({ ...DEFAULT_PIN_FILTER, ...over })

const gpioOut: PinAssignment = { pin: 'PA0', mode: 'OUTPUT', label: 'LED', params: {} }
const afTx: PinAssignment = {
  pin: 'PA1',
  mode: 'AF',
  function: 'USART1_TX',
  remap: 2,
  label: 'TX',
  params: {},
}

describe('Used only（默认关；只保留已配置/保留/冲突）', () => {
  it('命中态为 configured/reserved/error/warning，其余全部隐藏', () => {
    const all: PinStateId[] = [
      'configured',
      'reserved',
      'unassigned',
      'notConfigurable',
      'pinned',
      'excluded',
      'error',
      'warning',
    ]
    expect(all.filter(isUsedPinState)).toEqual(['configured', 'reserved', 'error', 'warning'])
  })

  it('关闭时未配置引脚仍显示；开启时只保留已使用引脚', () => {
    expect(pinVisibleInTable(pins[2], undefined, 'unassigned', filter(), false)).toBe(true)

    expect(pinVisibleInTable(pins[0], gpioOut, 'configured', filter(), true)).toBe(true)
    expect(pinVisibleInTable(pins[1], afTx, 'reserved', filter(), true)).toBe(true)
    expect(pinVisibleInTable(pins[1], afTx, 'error', filter(), true)).toBe(true)
    expect(pinVisibleInTable(pins[1], afTx, 'warning', filter(), true)).toBe(true)
    expect(pinVisibleInTable(pins[2], undefined, 'unassigned', filter(), true)).toBe(false)
    expect(pinVisibleInTable(pins[3], undefined, 'notConfigurable', filter(), true)).toBe(false)
  })

  it('仍叠加统一 PinFilter 的搜索与 Show 条件', () => {
    const byLabel = filter({ searchType: 'label', text: 'led' })
    expect(pinVisibleInTable(pins[0], gpioOut, 'configured', byLabel, true)).toBe(true)
    expect(pinVisibleInTable(pins[1], afTx, 'configured', byLabel, true)).toBe(false)

    const onlyReserved = filter({ states: ['reserved'] })
    expect(pinVisibleInTable(pins[0], gpioOut, 'configured', onlyReserved, false)).toBe(false)
    expect(pinVisibleInTable(pins[1], afTx, 'reserved', onlyReserved, true)).toBe(true)
  })
})

describe('分页（25/50/100，页码从 1 起）', () => {
  it('页大小选项为 25/50/100', () => {
    expect([...PIN_TABLE_PAGE_SIZES]).toEqual([25, 50, 100])
  })

  it('总页数至少为 1，并按页大小向上取整', () => {
    expect(pinTablePageCount(0, 25)).toBe(1)
    expect(pinTablePageCount(25, 25)).toBe(1)
    expect(pinTablePageCount(26, 25)).toBe(2)
    expect(pinTablePageCount(100, 25)).toBe(4)
    expect(pinTablePageCount(101, 50)).toBe(3)
  })

  it('按页切片，页码越界时夹到有效范围', () => {
    const rows = Array.from({ length: 30 }, (_, i) => i)
    expect(pinTablePageSlice(rows, 1, 25)).toEqual(rows.slice(0, 25))
    expect(pinTablePageSlice(rows, 2, 25)).toEqual(rows.slice(25))
    expect(pinTablePageSlice(rows, 99, 25)).toEqual(rows.slice(25))
    expect(pinTablePageSlice(rows, 0, 25)).toEqual(rows.slice(0, 25))
    expect(pinTablePageSlice([], 3, 25)).toEqual([])
  })

  it('行下标映射到所在页码（联动选中行跨页定位）', () => {
    expect(pinTablePageOfIndex(0, 25)).toBe(1)
    expect(pinTablePageOfIndex(24, 25)).toBe(1)
    expect(pinTablePageOfIndex(25, 25)).toBe(2)
    expect(pinTablePageOfIndex(50, 50)).toBe(2)
    expect(pinTablePageOfIndex(-1, 25)).toBe(1)
  })
})

describe('Columns 列可见性', () => {
  it('覆盖位号/引脚/状态/信号/标签/类型/remap 等列', () => {
    const ids = PIN_TABLE_COLUMNS.map((c) => c.id)
    for (const id of ['number', 'name', 'state', 'function', 'label', 'type', 'remap']) {
      expect(ids).toContain(id)
    }
  })

  it('默认全部可见，每列都有中文标签，可见性键与列定义一致', () => {
    const visibility = defaultPinTableColumnVisibility()
    expect(Object.keys(visibility).sort()).toEqual(PIN_TABLE_COLUMNS.map((c) => c.id).sort())
    expect(Object.values(visibility).every(Boolean)).toBe(true)
    expect(PIN_TABLE_COLUMNS.every((c) => c.label.length > 0)).toBe(true)
  })
})

describe('Export pinout（含/不含 AF）', () => {
  const chipPins = [mkPin('PA0', 1), mkPin('PA1', 2), mkPin('PA2', 3)]
  const assignmentOf = (pin: string) => (pin === 'PA0' ? gpioOut : pin === 'PA1' ? afTx : undefined)
  const signalsOf = (pin: string) => (pin === 'PA1' ? ['USART1_TX', 'USART1_RX'] : [])

  it('菜单提供 Without / With Alternate Functions 两项', () => {
    expect(PINOUT_EXPORT_FLAVORS.map((f) => f.id)).toEqual(['without-af', 'with-af'])
    expect(PINOUT_EXPORT_FLAVORS.map((f) => f.label)).toEqual([
      'Without Alternate Functions',
      'With Alternate Functions',
    ])
  })

  it('Without AF 输出 位号/引脚/模式/标签', () => {
    const lines = buildPinoutCsv(chipPins, assignmentOf, 'without-af').split('\n')
    expect(lines[0]).toBe('number,name,mode,label')
    expect(lines[1]).toBe('1,PA0,OUTPUT,LED')
    expect(lines[2]).toBe('2,PA1,AF,TX')
    expect(lines[3]).toBe('3,PA2,,')
  })

  it('With AF 输出 function/remap 与可用信号', () => {
    const lines = buildPinoutCsv(chipPins, assignmentOf, 'with-af', signalsOf).split('\n')
    expect(lines[0]).toBe('number,name,mode,function,remap,label,signals')
    expect(lines[1]).toBe('1,PA0,OUTPUT,,,LED,')
    expect(lines[2]).toBe('2,PA1,AF,USART1_TX,2,TX,USART1_TX|USART1_RX')
    expect(lines[3]).toBe('3,PA2,,,,,')
  })

  it('CSV 单元格转义逗号/引号/换行，空值输出空串', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(42)).toBe('42')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(null)).toBe('')
  })

  it('标签含逗号/引号/换行时整格加引号并双写引号', () => {
    const tricky: PinAssignment = { pin: 'PA0', mode: 'OUTPUT', label: 'LED, "RUN"\nOK', params: {} }
    expect(buildPinoutCsv([chipPins[0]], () => tricky, 'without-af')).toContain('"LED, ""RUN""\nOK"')
  })

  it('文件名带芯片与本地日期（月日补零）', () => {
    expect(pinoutCsvFileName('CH32V003F4P6', new Date(2026, 10, 16))).toBe(
      'CH32V003F4P6-pinout-2026-11-16.csv',
    )
    expect(pinoutCsvFileName('CH32V003F4P6', new Date(2026, 0, 5))).toBe(
      'CH32V003F4P6-pinout-2026-01-05.csv',
    )
  })
})