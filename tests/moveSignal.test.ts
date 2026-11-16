// 拖拽移动信号候选纯函数测试（M6）。
// 真实数据冒烟：CH32V203C8T6 USART1_TX = PA6(remap 3, 位号16) / PA9(remap 0, 位号30) /
// PB15(remap 2, 位号28) / PB6(remap 1, 位号42)；GPIO 候选用 CH32V003F4P6（18 个 IO 脚）。
// 多档位 remap 场景用合成最小数据（moveCandidates 只读 chip.pins 与 remap.entries）。
import { describe, it, expect } from 'vitest'
import { moveCandidates, canMoveTo } from '@/model/pins/moveSignal'
import { getDeviceData } from '@/model/device'
import type { ChipPin, DeviceData, PinAssignment, RemapEntry } from '@/model/types'

const v203 = getDeviceData('CH32V203C8T6')
const v003 = getDeviceData('CH32V003F4P6')

/** 快速构造 assignment（默认纯 GPIO OUTPUT） */
const asg = (pin: string, extra: Partial<PinAssignment> = {}): PinAssignment => ({
  pin,
  mode: 'OUTPUT',
  params: {},
  ...extra,
})

/** 合成最小 DeviceData：仅填充 moveCandidates 依赖的 chip.pins / remap.entries */
function fakeData(pins: Array<Pick<ChipPin, 'number' | 'name' | 'type'>>, entries: RemapEntry[]): DeviceData {
  return { chip: { pins }, remap: { entries } } as unknown as DeviceData
}

describe('AF 信号候选（真实 V203 数据冒烟）', () => {
  it('PA9 配 USART1_TX(remap 0)：候选为 PA6/PB15/PB6，remap 取各脚承载档位，按位号排序', () => {
    const candidates = moveCandidates(v203, [asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 })], 'PA9')
    // 位号：PA6=16、PB15=28、PB6=42（升序）；remap 来自 remap.json 实测值
    expect(candidates).toEqual([
      { pin: 'PA6', remap: 3 },
      { pin: 'PB15', remap: 2 },
      { pin: 'PB6', remap: 1 },
    ])
  })

  it('候选排除源引脚自身（PA9 不在结果中）', () => {
    const candidates = moveCandidates(v203, [asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 })], 'PA9')
    expect(candidates.some((c) => c.pin === 'PA9')).toBe(false)
  })

  it('已有任何 assignment 的同信号脚被排除（PB6 配 GPIO → 只剩 PA6/PB15）', () => {
    const assignments = [asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 }), asg('PB6')]
    const candidates = moveCandidates(v203, assignments, 'PA9')
    expect(candidates.map((c) => c.pin)).toEqual(['PA6', 'PB15'])
  })

  it('占用排除与模式无关（PB15 配 INPUT 同样被排除）', () => {
    const assignments = [asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 }), asg('PB15', { mode: 'INPUT' })]
    const candidates = moveCandidates(v203, assignments, 'PA9')
    expect(candidates.map((c) => c.pin)).toEqual(['PA6', 'PB6'])
  })

  it('全部同信号脚被占用时候选为空', () => {
    const assignments = [
      asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 }),
      asg('PA6'),
      asg('PB6'),
      asg('PB15'),
    ]
    expect(moveCandidates(v203, assignments, 'PA9')).toEqual([])
  })
})

describe('remap 档位策略（合成多档位数据）', () => {
  // PA0(位号1) 承载 SIG 档位 0/1/2；PA1(位号2) 承载 SIG 档位 0/1/2；PB0(位号3) 仅档位 2
  const data = fakeData(
    [
      { number: 1, name: 'PA0', type: 'IO' },
      { number: 2, name: 'PA1', type: 'IO' },
      { number: 3, name: 'PB0', type: 'IO' },
    ],
    [
      { pin: 'PA0', signal: 'SIG', remap: 0 },
      { pin: 'PA0', signal: 'SIG', remap: 1 },
      { pin: 'PA0', signal: 'SIG', remap: 2 },
      { pin: 'PA1', signal: 'SIG', remap: 0 },
      { pin: 'PA1', signal: 'SIG', remap: 1 },
      { pin: 'PA1', signal: 'SIG', remap: 2 },
      { pin: 'PB0', signal: 'SIG', remap: 2 },
    ],
  )
  const src = (remap?: number) => [asg('PA0', { mode: 'AF', function: 'SIG', remap })]

  it('目标脚支持原 remap 时优先保留（remap 1 → PA1 仍取 1）', () => {
    const candidates = moveCandidates(data, src(1), 'PA0')
    expect(candidates.find((c) => c.pin === 'PA1')?.remap).toBe(1)
  })

  it('目标脚不支持原 remap 时取第一个可用档位（remap 1 → PB0 只有 2）', () => {
    const candidates = moveCandidates(data, src(1), 'PA0')
    expect(candidates.find((c) => c.pin === 'PB0')?.remap).toBe(2)
  })

  it('源 remap 缺省时取目标脚第一个档位（entries 顺序 0 在前）', () => {
    const candidates = moveCandidates(data, src(undefined), 'PA0')
    expect(candidates.find((c) => c.pin === 'PA1')?.remap).toBe(0)
    expect(candidates.find((c) => c.pin === 'PB0')?.remap).toBe(2)
  })

  it('多档位目标按 remapValuesFor 去重后的首项兜底（首项为 2 时取 2）', () => {
    const reordered = fakeData(
      [
        { number: 1, name: 'PA0', type: 'IO' },
        { number: 2, name: 'PA1', type: 'IO' },
      ],
      [
        { pin: 'PA0', signal: 'SIG', remap: 3 },
        { pin: 'PA1', signal: 'SIG', remap: 2 },
        { pin: 'PA1', signal: 'SIG', remap: 0 },
        { pin: 'PA1', signal: 'SIG', remap: 2 }, // 重复档位应去重
      ],
    )
    const candidates = moveCandidates(reordered, [asg('PA0', { mode: 'AF', function: 'SIG', remap: 3 })], 'PA0')
    expect(candidates).toEqual([{ pin: 'PA1', remap: 2 }])
  })
})

describe('纯 GPIO 候选（真实 V003 数据）', () => {
  it('PD5 配 OUTPUT：候选 = 其余 17 个未占用 IO 脚，remap 均为 undefined', () => {
    const candidates = moveCandidates(v003, [asg('PD5')], 'PD5')
    const ioCount = v003.chip.pins.filter((p) => p.type === 'IO').length
    expect(ioCount).toBe(18)
    expect(candidates).toHaveLength(17)
    expect(candidates.some((c) => c.pin === 'PD5')).toBe(false)
    for (const c of candidates) expect(c.remap).toBeUndefined()
  })

  it('已占用 IO 脚被排除（PA1 INPUT + PC0 AF → 15 个候选）', () => {
    const assignments = [asg('PD5'), asg('PA1', { mode: 'INPUT' }), asg('PC0', { mode: 'AF', function: 'USART1_TX', remap: 3 })]
    const candidates = moveCandidates(v003, assignments, 'PD5')
    expect(candidates).toHaveLength(15)
    expect(candidates.some((c) => c.pin === 'PA1' || c.pin === 'PC0')).toBe(false)
  })

  it('候选只含 IO 脚：电源/NC/特殊非 IO 脚不出现（V203 PA0 OUTPUT）', () => {
    const candidates = moveCandidates(v203, [asg('PA0')], 'PA0')
    const ioNames = new Set(v203.chip.pins.filter((p) => p.type === 'IO').map((p) => p.name))
    for (const c of candidates) expect(ioNames.has(c.pin)).toBe(true)
    expect(candidates.some((c) => c.pin === 'VSS_1' || c.pin === 'VDD_IO_1' || c.pin === 'BOOT0')).toBe(false)
  })

  it('带 label 但无 function 仍走 GPIO 分支（候选为空闲 IO 而非同信号脚）', () => {
    const candidates = moveCandidates(v003, [asg('PD5', { label: 'LED_RUN' })], 'PD5')
    expect(candidates).toHaveLength(17)
    expect(candidates.every((c) => c.remap === undefined)).toBe(true)
  })
})

describe('边界与确定性', () => {
  it('fromPin 无配置 → []', () => {
    expect(moveCandidates(v203, [asg('PA0')], 'PA9')).toEqual([])
    expect(moveCandidates(v203, [], 'PA9')).toEqual([])
  })

  it('fromPin 不存在于芯片 → []', () => {
    expect(moveCandidates(v203, [asg('PX99', { mode: 'AF', function: 'USART1_TX' })], 'PX99')).toEqual([])
  })

  it('排序确定性：assignments 顺序打乱不影响结果，候选按位号升序', () => {
    const a1 = [asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 }), asg('PB6'), asg('PA0')]
    const a2 = [asg('PA0'), asg('PB6'), asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 })]
    const r1 = moveCandidates(v203, a1, 'PA9')
    const r2 = moveCandidates(v203, a2, 'PA9')
    expect(r1).toEqual(r2)
    const numberOf = (name: string) => v203.chip.pins.find((p) => p.name === name)!.number
    const numbers = r1.map((c) => numberOf(c.pin))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })

  it('ANALOG 带 function 走 AF 分支（合成 ADC 信号）', () => {
    const data = fakeData(
      [
        { number: 1, name: 'PA0', type: 'IO' },
        { number: 2, name: 'PA1', type: 'IO' },
      ],
      [
        { pin: 'PA0', signal: 'ADC_IN0', remap: 0 },
        { pin: 'PA1', signal: 'ADC_IN0', remap: 0 },
      ],
    )
    const candidates = moveCandidates(data, [asg('PA0', { mode: 'ANALOG', function: 'ADC_IN0', remap: 0 })], 'PA0')
    expect(candidates).toEqual([{ pin: 'PA1', remap: 0 }])
  })
})

describe('canMoveTo 命中判断辅助', () => {
  const assignments = [asg('PA9', { mode: 'AF', function: 'USART1_TX', remap: 0 }), asg('PB6')]

  it('合法目标返回候选（含 remap）', () => {
    expect(canMoveTo(v203, assignments, 'PA9', 'PA6')).toEqual({ pin: 'PA6', remap: 3 })
  })

  it('已占用目标 / 源脚自身 / 无关脚均返回 null', () => {
    expect(canMoveTo(v203, assignments, 'PA9', 'PB6')).toBeNull()
    expect(canMoveTo(v203, assignments, 'PA9', 'PA9')).toBeNull()
    expect(canMoveTo(v203, assignments, 'PA9', 'PA0')).toBeNull()
  })

  it('GPIO 搬移：空闲 IO 命中、电源脚不命中', () => {
    expect(canMoveTo(v003, [asg('PD5')], 'PD5', 'PD4')).toEqual({ pin: 'PD4' })
    expect(canMoveTo(v003, [asg('PD5')], 'PD5', 'VSS')).toBeNull()
  })
})