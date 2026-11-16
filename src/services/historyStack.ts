// 全局 Undo/Redo 的泛型快照栈（M6）。纯 TS，不依赖 Vue/Pinia/controllers。
// 语义：栈内保存「状态快照」，cursor 指向当前态。undo/redo 通过移动 cursor 返回应恢复的快照，
// 具体的「写回 store」由上层 composable 负责。本模块只做纯粹的栈运算，便于单测。

/** 创建快照栈的可选配置。 */
export interface HistoryStackOptions<T> {
  /** 容量上限（含当前态）。满时丢弃最旧快照。默认 100，最小夹取为 1。 */
  capacity?: number
  /** 合并窗口（毫秒）。距上次 push 小于该值则替换栈顶，避免一次输入产生几十条历史。默认 800。 */
  coalesceMs?: number
  /** 判等函数。相同则跳过 push。默认 JSON 序列化比较。 */
  equals?: (a: T, b: T) => boolean
}

/** 快照栈对外接口。 */
export interface HistoryStack<T> {
  /** 压入快照。now 缺省 Date.now()，测试可传固定值。 */
  push(snapshot: T, now?: number): void
  /** 撤回到上一态并返回该快照；无可撤回时返回 null。 */
  undo(): T | null
  /** 重做到下一态并返回该快照；无可重做时返回 null。 */
  redo(): T | null
  /** 是否可撤回（当前态之前还有快照）。 */
  canUndo(): boolean
  /** 是否可重做（当前态之后还有快照）。 */
  canRedo(): boolean
  /** 清空栈。传入 initial 时以其作为唯一当前态。 */
  clear(initial?: T): void
  /** 栈中快照总数（含 redo 分支）。 */
  size(): number
}

/** 默认判等：JSON 序列化比较（快照键序稳定时可靠）。 */
function defaultEquals<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 创建一个泛型快照栈。
 * 栈含「当前态」：cursor 指向当前态下标；初始为空（cursor = -1）。
 */
export function createHistoryStack<T>(opts: HistoryStackOptions<T> = {}): HistoryStack<T> {
  const capacity = Math.max(1, Math.floor(opts.capacity ?? 100))
  const coalesceMs = Math.max(0, opts.coalesceMs ?? 800)
  const equals = opts.equals ?? defaultEquals

  /** 快照数组（含 redo 分支）。 */
  let entries: T[] = []
  /** 当前态下标；-1 表示空栈。 */
  let cursor = -1
  /** 上次 push 的时间戳，用于合并窗口判定。 */
  let lastPushTime = Number.NEGATIVE_INFINITY

  function canUndo(): boolean {
    return cursor > 0
  }

  function canRedo(): boolean {
    return cursor >= 0 && cursor < entries.length - 1
  }

  function push(snapshot: T, now: number = Date.now()): void {
    // 与当前态相同则跳过，不产生历史也不刷新合并窗口。
    if (cursor >= 0 && equals(entries[cursor] as T, snapshot)) return

    const atTip = cursor === entries.length - 1
    const withinWindow = cursor >= 0 && now - lastPushTime < coalesceMs

    if (atTip && withinWindow) {
      // 合并：替换栈顶（当前态），不新增条目。
      entries[cursor] = snapshot
      lastPushTime = now
      return
    }

    // 新条目：先截断 redo 分支，再追加。
    entries = entries.slice(0, cursor + 1)
    entries.push(snapshot)
    cursor = entries.length - 1
    lastPushTime = now

    // 容量淘汰：丢最旧，cursor 随之下移。
    if (entries.length > capacity) {
      const drop = entries.length - capacity
      entries = entries.slice(drop)
      cursor -= drop
    }
  }

  function undo(): T | null {
    if (!canUndo()) return null
    cursor -= 1
    // 撤回后下一次 push 视为新编辑，不与历史合并。
    lastPushTime = Number.NEGATIVE_INFINITY
    return entries[cursor] as T
  }

  function redo(): T | null {
    if (!canRedo()) return null
    cursor += 1
    // 重做后下一次 push 视为新编辑，不与历史合并。
    lastPushTime = Number.NEGATIVE_INFINITY
    return entries[cursor] as T
  }

  function clear(initial?: T): void {
    if (initial === undefined) {
      entries = []
      cursor = -1
    } else {
      entries = [initial]
      cursor = 0
    }
    lastPushTime = Number.NEGATIVE_INFINITY
  }

  function size(): number {
    return entries.length
  }

  return { push, undo, redo, canUndo, canRedo, clear, size }
}