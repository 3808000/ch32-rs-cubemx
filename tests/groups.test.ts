// 引脚分组单元测试：单归属约束（一个引脚只能属于一个组）。
import { describe, it, expect } from 'vitest'
import { GROUP_COLORS, addToGroup, removeFromGroup, groupOfPin, createGroup } from '../src/lib/groups'
import type { PinGroup } from '../src/types'

function groups(...defs: [string, string[]][]): PinGroup[] {
  return defs.map(([name, pins], i) => ({ name, pins, color: GROUP_COLORS[i % GROUP_COLORS.length] }))
}

describe('addToGroup', () => {
  it('把引脚加入指定组', () => {
    const out = addToGroup(groups(['A', []]), 'A', 'PA1')
    expect(out[0].pins).toEqual(['PA1'])
  })

  it('单归属：从其它组移出后再加入目标组', () => {
    const out = addToGroup(groups(['A', ['PA1']], ['B', []]), 'B', 'PA1')
    expect(out.find((g) => g.name === 'A')!.pins).toEqual([])
    expect(out.find((g) => g.name === 'B')!.pins).toEqual(['PA1'])
  })

  it('已在目标组时不重复添加', () => {
    const out = addToGroup(groups(['A', ['PA1']]), 'A', 'PA1')
    expect(out[0].pins).toEqual(['PA1'])
  })

  it('目标组不存在时仅从其它组移除（引脚脱组）', () => {
    const out = addToGroup(groups(['A', ['PA1']]), 'Z', 'PA1')
    expect(out[0].pins).toEqual([])
  })

  it('不影响其它引脚的归属', () => {
    const out = addToGroup(groups(['A', ['PA1', 'PA2']], ['B', ['PC0']]), 'B', 'PA1')
    expect(out[0].pins).toEqual(['PA2'])
    expect(out[1].pins).toEqual(['PC0', 'PA1'])
  })

  it('返回新数组，不修改入参（纯函数）', () => {
    const src = groups(['A', ['PA1']], ['B', []])
    const snapshot = JSON.stringify(src)
    addToGroup(src, 'B', 'PA1')
    expect(JSON.stringify(src)).toBe(snapshot)
  })
})

describe('removeFromGroup', () => {
  it('从所属组移除引脚', () => {
    const out = removeFromGroup(groups(['A', ['PA1', 'PA2']]), 'PA1')
    expect(out[0].pins).toEqual(['PA2'])
  })

  it('引脚不在任何组时无变化', () => {
    const src = groups(['A', ['PA1']])
    const out = removeFromGroup(src, 'PD5')
    expect(out[0].pins).toEqual(['PA1'])
  })

  it('所有组都会被检查（同名引脚只可能存在一处）', () => {
    const out = removeFromGroup(groups(['A', ['PA1']], ['B', ['PD5']]), 'PD5')
    expect(out.find((g) => g.name === 'B')!.pins).toEqual([])
  })

  it('不修改入参（纯函数）', () => {
    const src = groups(['A', ['PA1']])
    const snapshot = JSON.stringify(src)
    removeFromGroup(src, 'PA1')
    expect(JSON.stringify(src)).toBe(snapshot)
  })
})

describe('groupOfPin', () => {
  it('返回引脚所属组', () => {
    const gs = groups(['A', ['PA1']], ['B', ['PD5']])
    expect(groupOfPin(gs, 'PD5')?.name).toBe('B')
  })

  it('未分组引脚返回 null', () => {
    expect(groupOfPin(groups(['A', ['PA1']]), 'PD5')).toBeNull()
  })

  it('空组列表返回 null', () => {
    expect(groupOfPin([], 'PA1')).toBeNull()
  })
})

describe('createGroup', () => {
  it('追加新组（空引脚、分配调色板颜色）', () => {
    const out = createGroup([], 'A')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ name: 'A', pins: [], color: GROUP_COLORS[0] })
  })

  it('同名组不重复创建（返回原数组引用）', () => {
    const src = groups(['A', []])
    expect(createGroup(src, 'A')).toBe(src)
  })

  it('颜色循环：第 7 个组回到第 1 个颜色', () => {
    let out: PinGroup[] = []
    for (let i = 0; i < 7; i++) out = createGroup(out, `G${i}`)
    expect(out).toHaveLength(7)
    expect(out[6].color).toBe(GROUP_COLORS[0])
    expect(out[5].color).toBe(GROUP_COLORS[5])
  })

  it('新组保持组序', () => {
    const out = createGroup(groups(['A', []]), 'B')
    expect(out.map((g) => g.name)).toEqual(['A', 'B'])
  })
})

describe('单归属不变量', () => {
  it('任意操作序列后每个引脚至多归属一个组', () => {
    let gs = groups(['A', []], ['B', []], ['C', []])
    const seq: [string, string][] = [
      ['A', 'PA1'], ['B', 'PA1'], ['C', 'PA1'], ['B', 'PD5'], ['A', 'PD5'],
      ['C', 'PC0'], ['A', 'PC0'], ['A', 'PA2'], ['B', 'PA2'],
    ]
    for (const [g, p] of seq) gs = addToGroup(gs, g, p)
    for (const p of ['PA1', 'PD5', 'PC0', 'PA2']) {
      expect(gs.filter((g) => g.pins.includes(p))).toHaveLength(1)
    }
  })
})
