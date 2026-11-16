// M6 全局 Undo/Redo：historyStack 纯快照栈单测。
// 全部用固定 now 驱动合并窗口，避免真实时钟带来的不确定性。
import { describe, expect, it } from 'vitest'
import { createHistoryStack } from '@/services/historyStack'

/** 简单快照工厂。 */
const mk = (v: number) => ({ v })

describe('historyStack 基础与边界', () => {
  it('空栈：不可撤回/重做，undo/redo 返回 null，size 为 0', () => {
    const s = createHistoryStack<{ v: number }>()
    expect(s.canUndo()).toBe(false)
    expect(s.canRedo()).toBe(false)
    expect(s.undo()).toBeNull()
    expect(s.redo()).toBeNull()
    expect(s.size()).toBe(0)
  })

  it('仅一个快照（基线）：不可撤回，undo 返回 null', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    expect(s.size()).toBe(1)
    expect(s.canUndo()).toBe(false)
    expect(s.canRedo()).toBe(false)
    expect(s.undo()).toBeNull()
  })

  it('两次间隔 push：undo 返回前一态，redo 返回后一态', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    expect(s.canUndo()).toBe(true)
    expect(s.undo()).toEqual(mk(1))
    expect(s.canRedo()).toBe(true)
    expect(s.redo()).toEqual(mk(2))
    expect(s.canRedo()).toBe(false)
  })

  it('撤到底后再 undo 返回 null 且停留在基线', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    expect(s.undo()).toEqual(mk(1))
    expect(s.undo()).toBeNull()
    expect(s.canUndo()).toBe(false)
    expect(s.redo()).toEqual(mk(2))
  })

  it('已在栈顶时 redo 返回 null', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    expect(s.redo()).toBeNull()
  })

  it('连续 undo→redo 往返一致', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.push(mk(3), 2000)
    expect(s.undo()).toEqual(mk(2))
    expect(s.undo()).toEqual(mk(1))
    expect(s.redo()).toEqual(mk(2))
    expect(s.redo()).toEqual(mk(3))
    expect(s.undo()).toEqual(mk(2))
    expect(s.canUndo()).toBe(true)
    expect(s.canRedo()).toBe(true)
  })
})

describe('historyStack equals 跳过', () => {
  it('默认 JSON 判等：相同快照不增长栈', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(1), 5000)
    expect(s.size()).toBe(1)
    expect(s.canUndo()).toBe(false)
  })

  it('自定义 equals 生效', () => {
    const s = createHistoryStack<{ v: number; tag: string }>({
      equals: (a, b) => a.v === b.v,
    })
    s.push({ v: 1, tag: 'x' }, 0)
    s.push({ v: 1, tag: 'y' }, 5000) // v 相同 → 视为相等跳过
    expect(s.size()).toBe(1)
    s.push({ v: 2, tag: 'z' }, 10000)
    expect(s.size()).toBe(2)
  })

  it('equals 跳过不刷新合并窗口', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(1), 100) // 相等跳过，lastPushTime 仍为 0
    s.push(mk(2), 850) // 850-0=850>=800 → 新条目而非合并
    expect(s.size()).toBe(2)
  })
})

describe('historyStack 合并窗口', () => {
  it('窗口内连续 push 合并为一条（替换栈顶）', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 100)
    s.push(mk(3), 200)
    expect(s.size()).toBe(1)
    expect(s.undo()).toBeNull()
  })

  it('基线 + 快速输入突发：突发合并为一条，undo 回到基线', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(0), 0) // 基线
    s.push(mk(1), 1000) // 距基线 >=800 → 新条目
    s.push(mk(2), 1100) // 窗口内合并
    s.push(mk(3), 1200) // 窗口内合并
    expect(s.size()).toBe(2)
    expect(s.undo()).toEqual(mk(0))
    expect(s.redo()).toEqual(mk(3))
  })

  it('恰好等于 coalesceMs 不合并（严格小于）', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 800)
    expect(s.size()).toBe(2)
  })

  it('窗口内边界 799ms 仍合并', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 799)
    expect(s.size()).toBe(1)
  })

  it('coalesceMs=0 禁用合并', () => {
    const s = createHistoryStack<{ v: number }>({ coalesceMs: 0 })
    s.push(mk(1), 0)
    s.push(mk(2), 0)
    expect(s.size()).toBe(2)
  })

  it('缺省 now 使用 Date.now：两次紧邻 push 合并', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1))
    s.push(mk(2))
    expect(s.size()).toBe(1)
  })

  it('undo 后不在栈顶：即便窗口内也不合并，且截断 redo', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.undo() // 回到 mk(1)，cursor=0
    s.push(mk(9), 1001) // 距上次 push 仅 1ms，但不在栈顶 → 新条目
    expect(s.size()).toBe(2)
    expect(s.canRedo()).toBe(false)
    expect(s.undo()).toEqual(mk(1))
  })
})

describe('historyStack redo 截断与容量', () => {
  it('undo 后新 push 截断 redo 分支', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.push(mk(3), 2000)
    s.undo() // mk(2)
    s.undo() // mk(1)
    s.push(mk(4), 3000)
    expect(s.size()).toBe(2)
    expect(s.canRedo()).toBe(false)
    expect(s.redo()).toBeNull()
    expect(s.undo()).toEqual(mk(1))
  })

  it('容量满丢最旧，cursor 正确下移', () => {
    const s = createHistoryStack<{ v: number }>({ capacity: 3 })
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.push(mk(3), 2000)
    s.push(mk(4), 3000) // 超容量，丢 mk(1)
    expect(s.size()).toBe(3)
    expect(s.undo()).toEqual(mk(3))
    expect(s.undo()).toEqual(mk(2))
    expect(s.undo()).toBeNull() // mk(1) 已被淘汰
  })

  it('capacity=1 仅保留当前态', () => {
    const s = createHistoryStack<{ v: number }>({ capacity: 1 })
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    expect(s.size()).toBe(1)
    expect(s.canUndo()).toBe(false)
  })

  it('size 含 redo 分支', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.push(mk(3), 2000)
    s.undo() // cursor 指向 mk(2)，mk(3) 仍在 redo 分支
    expect(s.size()).toBe(3)
    expect(s.canRedo()).toBe(true)
  })
})

describe('historyStack clear', () => {
  it('clear() 清空栈', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.clear()
    expect(s.size()).toBe(0)
    expect(s.canUndo()).toBe(false)
    expect(s.canRedo()).toBe(false)
    expect(s.undo()).toBeNull()
    expect(s.redo()).toBeNull()
  })

  it('clear(initial) 以 initial 为唯一当前态', () => {
    const s = createHistoryStack<{ v: number }>()
    s.push(mk(1), 0)
    s.push(mk(2), 1000)
    s.clear(mk(5))
    expect(s.size()).toBe(1)
    expect(s.canUndo()).toBe(false)
    expect(s.undo()).toBeNull()
    s.push(mk(6), 5000)
    expect(s.canUndo()).toBe(true)
    expect(s.undo()).toEqual(mk(5))
  })

  it('clear 后首次 push 不与基线合并（即便紧邻）', () => {
    const s = createHistoryStack<{ v: number }>()
    s.clear(mk(0)) // 基线，lastPushTime 复位
    s.push(mk(1), 10) // 距 clear 很近，但不应合并进基线
    expect(s.size()).toBe(2)
    expect(s.undo()).toEqual(mk(0))
  })
})