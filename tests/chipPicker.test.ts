// M6 芯片对比选择器（ChipPicker）纯函数契约测试：
// 行构建字段 / 确定性排序 / 搜索匹配（名/封装/内核）/ 生成支持徽标判定。
// 数据全部来自仓库已注册芯片（listDevices），合成数据仅用于边界验证。
import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_HAL_BACKEND,
  buildChipRows,
  chipGenerationSupported,
  filterChipRows,
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
    expect(row.halBackend).toBe(SUPPORTED_HAL_BACKEND)
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
    expect(buildChipRows([chip])[0].halBackend).toBe(SUPPORTED_HAL_BACKEND)
  })

  it('显式 ch32-hal 可生成；ch58x-hal 不支持', () => {
    expect(chipGenerationSupported(mkChip({ halBackend: 'ch32-hal' }))).toBe(true)
    expect(chipGenerationSupported(mkChip({ halBackend: 'ch58x-hal' }))).toBe(false)
  })

  it('CH582M 标注「生成器暂不支持」但仍保留在列表中（不禁止选择）', () => {
    const row = rowOf('CH582M')
    expect(row.halBackend).toBe('ch58x-hal')
    expect(row.supported).toBe(false)
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
    expect(filterChipRows(registeredRows, 'lqfp').map((r) => r.chip)).toEqual(['CH32V203C8T6'])
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
