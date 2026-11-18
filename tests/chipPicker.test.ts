// M6 芯片对比选择器（ChipPicker）纯函数契约测试：
// 行构建字段 / 确定性排序 / 搜索匹配（名/封装/内核）/ 生成支持徽标判定。
// 数据全部来自仓库已注册芯片（listDevices），合成数据仅用于边界验证。
import { describe, it, expect } from 'vitest'
import {
  CHIP_COLUMNS,
  CHIP_PAGE_SIZES,
  SUPPORTED_HAL_BACKENDS,
  buildChipCsv,
  buildChipRows,
  canContinueSelection,
  chipGenerationSupported,
  chipPageCount,
  csvCell,
  defaultChipColumnFilters,
  defaultChipColumnVisibility,
  filterChipRows,
  filterChipRowsByColumn,
  memoryValue,
  paginateRows,
  selectionLineCount,
  setChipColumnVisible,
  sortChipRows,
  type ChipColumnId,
  type ChipRow,
} from '@/components/home/ChipPicker.vue'
import { listDevices } from '@/model/device'
import type { ChipData } from '@/model/types'

/** 最小合成 ChipData：仅填测试关心的字段，其余给合法缺省。 */
const mkChip = (over: Partial<ChipData> = {}): ChipData => ({
  chip: 'CH32X000A0A0',
  family: 'CH32X000',
  core: 'QingKe V0 (RV32)',
  package: 'SOP8',
  packageKind: 'dual',
  pinsPerSide: 4,
  flash: '8K',
  sram: '1K',
  deviceId: '0x00000000',
  halFeature: 'ch32x000a0a0',
  target: 'riscv32ec-unknown-none-elf',
  nightly: false,
  remapModel: 'afio_v1',
  source: 'synthetic',
  pins: [],
  ...over,
})

const registeredRows = buildChipRows(listDevices())
const rowOf = (chip: string): ChipRow => {
  const row = registeredRows.find((r) => r.chip === chip)
  if (!row) throw new Error(`注册表缺少 ${chip}`)
  return row
}

describe('buildChipRows：行构建', () => {
  it('覆盖全部已注册芯片（当前 4 颗），不引入外部数据', () => {
    const chips = listDevices().map((d) => d.chip)
    expect(registeredRows.map((r) => r.chip).sort()).toEqual([...chips].sort())
    expect(registeredRows.length).toBeGreaterThanOrEqual(4)
  })

  it('CH32V003F4P6 行字段与 chip.json 一致', () => {
    const row = rowOf('CH32V003F4P6')
    expect(row.package).toBe('TSSOP20')
    expect(row.pinCount).toBe(20)
    expect(row.flash).toBe('16K')
    expect(row.sram).toBe('2K')
    expect(row.core).toContain('V2A')
    expect(row.target).toBe('riscv32ec-unknown-none-elf')
    expect(row.toolchain).toBe('nightly')
    expect(row.halBackend).toBe('ch32-hal')
    expect(SUPPORTED_HAL_BACKENDS).toContain(row.halBackend)
    expect(row.supported).toBe(true)
  })

  it('CH32V203C8T6 为 stable 工具链、48 引脚', () => {
    const row = rowOf('CH32V203C8T6')
    expect(row.toolchain).toBe('stable')
    expect(row.pinCount).toBe(48)
    expect(row.flash).toBe('64K')
    expect(row.sram).toBe('20K')
    expect(row.supported).toBe(true)
  })

  it('CH32H417QEU6 为 128 引脚、imafc triple', () => {
    const row = rowOf('CH32H417QEU6')
    expect(row.pinCount).toBe(128)
    expect(row.target).toBe('riscv32imafc-unknown-none-elf')
    expect(row.core).toContain('dual-core')
    expect(row.supported).toBe(true)
  })

  it('pinCount 派生自 pins.length（合成数据验证）', () => {
    const pins = [1, 2, 3].map((n) => ({ number: n, name: `P${n}`, type: 'IO' as const, side: 'left' as const }))
    const [row] = buildChipRows([mkChip({ pins })])
    expect(row.pinCount).toBe(3)
  })

  it('排序确定性：与输入顺序无关，按芯片名升序', () => {
    const devices = listDevices()
    const shuffled = [...devices].reverse()
    expect(buildChipRows(shuffled)).toEqual(registeredRows)
    const names = registeredRows.map((r) => r.chip)
    expect(names).toEqual([...names].sort())
  })

  it('不修改输入数组', () => {
    const devices = listDevices()
    const snapshot = devices.map((d) => d.chip)
    buildChipRows(devices)
    expect(devices.map((d) => d.chip)).toEqual(snapshot)
  })
})

describe('生成支持徽标判定', () => {
  it('halBackend 缺省视为 ch32-hal（可生成）', () => {
    const chip = mkChip()
    delete chip.halBackend
    expect(chipGenerationSupported(chip)).toBe(true)
    expect(buildChipRows([chip])[0].halBackend).toBe('ch32-hal')
  })

  it('显式 ch32-hal 与 ch58x-hal 均可生成（M11）；未知后端不支持', () => {
    expect(chipGenerationSupported(mkChip({ halBackend: 'ch32-hal' }))).toBe(true)
    expect(chipGenerationSupported(mkChip({ halBackend: 'ch58x-hal' }))).toBe(true)
    expect(chipGenerationSupported(mkChip({ halBackend: 'other-hal' }))).toBe(false)
    expect(SUPPORTED_HAL_BACKENDS).toEqual(['ch32-hal', 'ch58x-hal'])
  })

  it('CH582M（ch58x-hal）标注「可生成」且仍保留在列表中', () => {
    const row = rowOf('CH582M')
    expect(row.halBackend).toBe('ch58x-hal')
    expect(row.supported).toBe(true)
    expect(registeredRows.some((r) => r.chip === 'CH582M')).toBe(true)
  })
})

describe('filterChipRows：搜索', () => {
  it('空查询返回全量', () => {
    expect(filterChipRows(registeredRows, '')).toEqual(registeredRows)
  })

  it('纯空白查询返回全量（trim 后为空）', () => {
    expect(filterChipRows(registeredRows, '   ')).toEqual(registeredRows)
  })

  it('按芯片名匹配，大小写不敏感', () => {
    expect(filterChipRows(registeredRows, 'ch32v003').map((r) => r.chip)).toEqual(['CH32V003F4P6'])
    expect(filterChipRows(registeredRows, 'V203').map((r) => r.chip)).toEqual(['CH32V203C8T6'])
    expect(filterChipRows(registeredRows, 'ch582').map((r) => r.chip)).toEqual(['CH582M'])
  })

  it('按封装匹配，大小写不敏感', () => {
    expect(filterChipRows(registeredRows, 'tssop20').map((r) => r.chip)).toEqual(['CH32V003F4P6'])
    expect(filterChipRows(registeredRows, 'QFN48').map((r) => r.chip)).toEqual(['CH582M'])
    expect(filterChipRows(registeredRows, 'lqfp').map((r) => r.chip)).toEqual([
      'CH32V103C8T6',
      'CH32V203C8T6',
      'CH32V307VCT6',
      'CH32X035C8T6',
    ])
  })

  it('按内核匹配，大小写不敏感', () => {
    expect(filterChipRows(registeredRows, 'v4b').map((r) => r.chip)).toEqual(['CH32V203C8T6'])
    expect(filterChipRows(registeredRows, 'RV32EC').map((r) => r.chip)).toEqual(['CH32V003F4P6'])
    expect(filterChipRows(registeredRows, 'dual-core').map((r) => r.chip)).toEqual(['CH32H417QEU6'])
  })

  it('无匹配返回空表', () => {
    expect(filterChipRows(registeredRows, 'STM32')).toEqual([])
    expect(filterChipRows(registeredRows, '不存在的封装')).toEqual([])
  })

  it('保持原有排序且不修改输入', () => {
    const before = registeredRows.map((r) => r.chip)
    const filtered = filterChipRows(registeredRows, 'ch32')
    expect(filtered.map((r) => r.chip)).toEqual(before.filter((c) => c.toLowerCase().includes('ch32')))
    expect(registeredRows.map((r) => r.chip)).toEqual(before)
  })
})

describe('sortChipRows：全列排序三态', () => {
  it('key/dir 为 null 时回到默认芯片名升序（与输入顺序无关）', () => {
    const reversed = [...registeredRows].reverse()
    expect(sortChipRows(reversed)).toEqual(registeredRows)
    expect(sortChipRows(reversed, null, null).map((r) => r.chip)).toEqual(
      [...registeredRows].map((r) => r.chip),
    )
  })

  it('数值列 asc/desc：引脚数排序且不修改输入', () => {
    const snapshot = registeredRows.map((r) => r.chip)
    const asc = sortChipRows(registeredRows, 'pinCount', 'asc')
    const desc = sortChipRows(registeredRows, 'pinCount', 'desc')
    expect(asc[0].chip).toBe('CH32V003F4P6')
    expect(asc[asc.length - 1].chip).toBe('CH32H417QEU6')
    expect(desc[0].chip).toBe('CH32H417QEU6')
    expect(asc.map((r) => r.pinCount)).toEqual([...asc.map((r) => r.pinCount)].sort((a, b) => a - b))
    expect(desc.map((r) => r.pinCount)).toEqual([...desc.map((r) => r.pinCount)].sort((a, b) => b - a))
    expect(registeredRows.map((r) => r.chip)).toEqual(snapshot)
  })

  it('字符串列大小写不敏感，同值用芯片名升序兜底', () => {
    const byPackage = sortChipRows(registeredRows, 'package', 'asc')
    const expected = [...registeredRows]
      .sort((a, b) => {
        const sa = a.package.toLowerCase()
        const sb = b.package.toLowerCase()
        if (sa !== sb) return sa < sb ? -1 : 1
        return a.chip < b.chip ? -1 : a.chip > b.chip ? 1 : 0
      })
      .map((r) => r.chip)
    expect(byPackage.map((r) => r.chip)).toEqual(expected)
    // 48 引脚的四颗芯片同值时按芯片名升序（M14：V103/V203/X035/CH582M）
    const byPins = sortChipRows(registeredRows, 'pinCount', 'asc')
    expect(byPins.map((r) => r.chip)).toEqual([
      'CH32V003F4P6',
      'CH32V103C8T6',
      'CH32V203C8T6',
      'CH32X035C8T6',
      'CH582M',
      'CH32V307VCT6',
      'CH32H417QEU6',
    ])
  })

  it('布尔列按 false < true 排序（合成不支持后端验证；注册芯片 M11 起全部 supported）', () => {
    expect(registeredRows.every((r) => r.supported)).toBe(true)
    const rows = [...registeredRows, ...buildChipRows([mkChip({ chip: 'CH58X0000000', halBackend: 'other-hal' })])]
    const asc = sortChipRows(rows, 'supported', 'asc')
    expect(asc[0].supported).toBe(false)
    expect(asc[0].chip).toBe('CH58X0000000')
    expect(asc[asc.length - 1].supported).toBe(true)
  })
})

describe('filterChipRowsByColumn：逐列过滤', () => {
  it('单列子串匹配，大小写不敏感', () => {
    expect(filterChipRowsByColumn(registeredRows, { package: 'qfn48' }).map((r) => r.chip)).toEqual([
      'CH582M',
    ])
    expect(filterChipRowsByColumn(registeredRows, { package: 'QFN' }).map((r) => r.chip)).toEqual([
      'CH32H417QEU6',
      'CH582M',
    ])
    expect(filterChipRowsByColumn(registeredRows, { package: 'LQFP' }).map((r) => r.chip)).toEqual([
      'CH32V103C8T6',
      'CH32V203C8T6',
      'CH32V307VCT6',
      'CH32X035C8T6',
    ])
    expect(filterChipRowsByColumn(registeredRows, { chip: 'v003' }).map((r) => r.chip)).toEqual([
      'CH32V003F4P6',
    ])
  })

  it('多列同时命中（AND），空白过滤视为不过滤', () => {
    expect(
      filterChipRowsByColumn(registeredRows, { core: 'v4b', package: 'lqfp' }).map((r) => r.chip),
    ).toEqual(['CH32V203C8T6'])
    expect(filterChipRowsByColumn(registeredRows, { core: 'v4b', package: 'qfn' })).toEqual([])
    expect(filterChipRowsByColumn(registeredRows, { chip: '  ', core: '' })).toEqual(registeredRows)
    expect(filterChipRowsByColumn(registeredRows, {})).toEqual(registeredRows)
  })

  it('与全局搜索叠加（先全局、再逐列）', () => {
    const global = filterChipRows(registeredRows, 'ch32')
    expect(filterChipRowsByColumn(global, { package: 'lqfp' }).map((r) => r.chip)).toEqual([
      'CH32V103C8T6',
      'CH32V203C8T6',
      'CH32V307VCT6',
      'CH32X035C8T6',
    ])
    expect(filterChipRowsByColumn(global, { package: 'qfn48' })).toEqual([])
  })

  it('数值/布尔列也参与逐列过滤（M11 起注册芯片均 supported=true）', () => {
    expect(filterChipRowsByColumn(registeredRows, { pinCount: '128' }).map((r) => r.chip)).toEqual([
      'CH32H417QEU6',
    ])
    expect(filterChipRowsByColumn(registeredRows, { supported: 'false' })).toEqual([])
    expect(filterChipRowsByColumn(registeredRows, { supported: 'true' })).toEqual(registeredRows)
  })

  it('不修改输入行数组', () => {
    const before = registeredRows.map((r) => r.chip)
    filterChipRowsByColumn(registeredRows, { core: 'rv32' })
    expect(registeredRows.map((r) => r.chip)).toEqual(before)
  })
})

describe('paginateRows / chipPageCount：分页', () => {
  it('按页大小切片，页码越界夹到有效范围', () => {
    expect(paginateRows(registeredRows, 1, 2).map((r) => r.chip)).toEqual([
      'CH32H417QEU6',
      'CH32V003F4P6',
    ])
    expect(paginateRows(registeredRows, 2, 2).map((r) => r.chip)).toEqual([
      'CH32V103C8T6',
      'CH32V203C8T6',
    ])
    expect(paginateRows(registeredRows, 0, 2).map((r) => r.chip)).toEqual([
      'CH32H417QEU6',
      'CH32V003F4P6',
    ])
    // 7 颗芯片 size=2 → 4 页，末页单行（M14）
    expect(paginateRows(registeredRows, 99, 2).map((r) => r.chip)).toEqual(['CH582M'])
  })

  it('总页数至少 1；空表返回空切片', () => {
    expect(chipPageCount(0, 5)).toBe(1)
    expect(chipPageCount(4, 5)).toBe(1)
    expect(chipPageCount(4, 3)).toBe(2)
    expect(chipPageCount(514, 10)).toBe(52)
    expect(paginateRows([], 1, 5)).toEqual([])
  })

  it('页大小非法时回退为 1，保持确定性', () => {
    expect(paginateRows(registeredRows, 1, 0)).toEqual([registeredRows[0]])
    expect(paginateRows(registeredRows, 1, Number.NaN)).toEqual([registeredRows[0]])
    expect([...CHIP_PAGE_SIZES]).toEqual([5, 10, 20])
  })

  it('分页切片：size=3 时第 2 页为第 4–6 行，末页单行（M14：7 颗芯片）', () => {
    expect(paginateRows(registeredRows, 2, 3).map((r) => r.chip)).toEqual([
      'CH32V203C8T6',
      'CH32V307VCT6',
      'CH32X035C8T6',
    ])
    expect(paginateRows(registeredRows, 3, 3).map((r) => r.chip)).toEqual(['CH582M'])
  })
})

describe('buildChipCsv：Export list', () => {
  it('带 BOM，表头/行按可见列顺序输出（不分页由调用方保证）', () => {
    const csv = buildChipCsv([rowOf('CH32V003F4P6'), rowOf('CH32V203C8T6')], ['chip', 'pinCount'])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('芯片,引脚数')
    expect(lines[1]).toBe('CH32V003F4P6,20')
    expect(lines[2]).toBe('CH32V203C8T6,48')
  })

  it('逗号/双引号/换行按 CSV 规则转义', () => {
    const synthetic: ChipRow = {
      ...rowOf('CH32V003F4P6'),
      package: 'LQFP,48 "x"',
      core: 'line1\nline2',
    }
    const csv = buildChipCsv([synthetic], ['chip', 'package', 'core'])
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toBe('CH32V003F4P6,"LQFP,48 ""x""","line1\nline2"')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(1)).toBe('1')
    expect(csvCell(null)).toBe('')
  })

  it('隐藏列不出现在表头与数据行，未知列被忽略', () => {
    const csv = buildChipCsv([rowOf('CH32V003F4P6')], [
      'chip',
      'supported',
      'bogus' as ChipColumnId,
    ])
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('芯片,生成支持')
    expect(lines[1]).toBe('CH32V003F4P6,true')
    expect(csv).not.toContain('封装')
    expect(csv).not.toContain('LQFP')
  })

  it('可见列顺序即导出顺序', () => {
    const csv = buildChipCsv([rowOf('CH32V003F4P6')], ['flash', 'chip'])
    expect(csv.slice(1).split('\r\n')[0]).toBe('Flash,芯片')
  })
})

describe('选中门禁与 Columns 菜单', () => {
  it('未选/空串/空白不可 Continue，选中芯片可 Continue', () => {
    expect(canContinueSelection(null)).toBe(false)
    expect(canContinueSelection('')).toBe(false)
    expect(canContinueSelection('   ')).toBe(false)
    expect(canContinueSelection('CH32V003F4P6')).toBe(true)
    expect(selectionLineCount(null)).toBe(0)
    expect(selectionLineCount('CH32V003F4P6')).toBe(1)
  })

  it('Columns 默认全显，芯片名列是保留列不可隐藏', () => {
    const visibility = defaultChipColumnVisibility()
    expect(Object.values(visibility).every(Boolean)).toBe(true)
    expect(Object.keys(visibility)).toEqual(CHIP_COLUMNS.map((c) => c.id))
    const hiddenChip = setChipColumnVisible(visibility, 'chip', false)
    expect(hiddenChip.chip).toBe(true)
    const hiddenPackage = setChipColumnVisible(visibility, 'package', false)
    expect(hiddenPackage.package).toBe(false)
    expect(visibility.package).toBe(true) // 不修改输入
  })

  it('逐列过滤初始值全部为空串', () => {
    const filters = defaultChipColumnFilters()
    expect(Object.keys(filters)).toEqual(CHIP_COLUMNS.map((c) => c.id))
    expect(Object.values(filters).every((v) => v === '')).toBe(true)
  })
})

describe('ChipPicker 容量列数值排序（M9 验收修复：MX2 按数值而非字典序）', () => {
  const rows = buildChipRows(listDevices())

  it('memoryValue 解析 K/M/纯数字', () => {
    expect(memoryValue('16K')).toBe(16 * 1024)
    expect(memoryValue('896K')).toBe(896 * 1024)
    expect(memoryValue('1M')).toBe(1024 * 1024)
    expect(memoryValue('2048')).toBe(2048)
    expect(Number.isNaN(memoryValue('abc'))).toBe(true)
  })

  it('Flash 升序按数值（M14：16K < 62K < 64K=64K < 256K < 448K < 960K）', () => {
    const sorted = sortChipRows(rows, 'flash', 'asc')
    expect(sorted.map((r) => r.flash)).toEqual(['16K', '62K', '64K', '64K', '256K', '448K', '960K'])
  })

  it('Flash 降序反向且同值芯片名兜底', () => {
    const sorted = sortChipRows(rows, 'flash', 'desc')
    expect(sorted.map((r) => r.flash)).toEqual(['960K', '448K', '256K', '64K', '64K', '62K', '16K'])
  })

  it('RAM 升序按数值（M14：2K < 20K×3 < 32K < 64K < 896K）', () => {
    const sorted = sortChipRows(rows, 'sram', 'asc')
    expect(sorted.map((r) => r.sram)).toEqual(['2K', '20K', '20K', '20K', '32K', '64K', '896K'])
  })

  it('引脚数升序仍按数值（20 < 48×4 < 100 < 128，同值芯片名序）', () => {
    const sorted = sortChipRows(rows, 'pinCount', 'asc')
    expect(sorted.map((r) => r.pinCount)).toEqual([20, 48, 48, 48, 48, 100, 128])
    expect(sorted[1].chip < sorted[2].chip).toBe(true)
  })
})
