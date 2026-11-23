// M6 全局 Undo/Redo：useHistory 接线测试。
// vitest 环境为 node（无 DOM）：用 effectScope + Pinia 驱动响应式，快捷键判定走纯函数。
// 用假时钟控制 Date.now，从而精确控制合并窗口。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessageBox } from 'element-plus'
import { useProjectStore } from '@/controllers/project'
import { useHistory, resolveHistoryShortcut } from '@/components/common/useHistory'
import { usePinOverwrite } from '@/components/pinout/usePinOverwrite'
import type { ProjectConfig } from '@/model/types'

let scope: EffectScope | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  setActivePinia(createPinia())
})

afterEach(() => {
  scope?.stop()
  scope = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 在 effectScope 内创建 useHistory（无组件实例，node 下不注册 window 监听）。 */
function setup() {
  scope = effectScope()
  const history = scope.run(() => useHistory())!
  const store = useProjectStore()
  return { history, store }
}

/** 推进时钟越过合并窗口，保证下一次变更独立入栈。 */
function tickPastCoalesce() {
  vi.advanceTimersByTime(1000)
}

describe('useHistory 初始与基本撤回', () => {
  it('挂载后压入初始快照：不可撤回/重做', () => {
    const { history } = setup()
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
    expect(history.undo()).toBe(false)
    expect(history.redo()).toBe(false)
  })

  it('编辑后 sync 立即可撤回（无需等待异步 flush）', () => {
    const { history, store } = setup()
    store.setProjectName('renamed')
    expect(history.canUndo.value).toBe(true)
  })

  it('undo 恢复旧值并标脏；redo 恢复新值', () => {
    const { history, store } = setup()
    const before = JSON.stringify(store.config)
    tickPastCoalesce()
    store.setProjectName('renamed')
    expect(store.projectName).toBe('renamed')

    expect(history.undo()).toBe(true)
    expect(store.projectName).toBe('ch32-project')
    expect(store.dirty).toBe(true) // loadConfig 置 dirty=false 后必须 markDirty
    expect(JSON.stringify(store.config)).toBe(before)
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(true)

    expect(history.redo()).toBe(true)
    expect(store.projectName).toBe('renamed')
    expect(history.canUndo.value).toBe(true)
    expect(history.canRedo.value).toBe(false)
  })

  it('undo/redo 写回不自我入栈（抑制标志有效）', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    store.setProjectName('a')
    tickPastCoalesce()
    store.setProjectName('b')
    // 两步历史：undo 两次到底，redo 两次到顶；若写回入栈会多出条目。
    expect(history.undo()).toBe(true)
    expect(history.undo()).toBe(true)
    expect(history.undo()).toBe(false)
    expect(history.redo()).toBe(true)
    expect(history.redo()).toBe(true)
    expect(history.redo()).toBe(false)
    expect(store.projectName).toBe('b')
  })

  it('深层字段变化（引脚 params）也被捕获', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    store.setPinAssignment('PA0', 'OUTPUT')
    tickPastCoalesce()
    store.updatePinParams('PA0', { pull: 'UP' })
    expect(store.assignmentOf('PA0')?.params.pull).toBe('UP')
    expect(history.undo()).toBe(true)
    expect(store.assignmentOf('PA0')?.params.pull).toBeUndefined()
    expect(store.assignmentOf('PA0')?.mode).toBe('OUTPUT')
  })

  it('窗口内连续编辑合并为一步撤回', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    store.setProjectName('a')
    vi.advanceTimersByTime(100)
    store.setProjectName('ab')
    vi.advanceTimersByTime(100)
    store.setProjectName('abc')
    expect(history.undo()).toBe(true)
    expect(store.projectName).toBe('ch32-project') // 一步回到突发前
    expect(history.canUndo.value).toBe(false)
  })

  it('reset 丢弃历史，以当前态为基线', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    store.setProjectName('x')
    expect(history.canUndo.value).toBe(true)
    history.reset()
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
    tickPastCoalesce()
    store.setProjectName('y')
    expect(history.undo()).toBe(true)
    expect(store.projectName).toBe('x')
  })
})

describe('useHistory 芯片切换与导入', () => {
  it('切芯片重置历史，新芯片上的编辑可撤回', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    store.setProjectName('old-chip-name')
    expect(history.canUndo.value).toBe(true)

    store.switchDevice('CH32V203C8T6')
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
    expect(store.assignments).toEqual([])

    tickPastCoalesce()
    store.setProjectName('new-chip-name')
    expect(history.undo()).toBe(true)
    expect(store.chip).toBe('CH32V203C8T6') // 撤回不跨芯片
    expect(store.projectName).not.toBe('new-chip-name')
  })

  it('同芯片 loadConfig 导入产生的变化正常入栈、可撤回', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    const imported: ProjectConfig = {
      ...store.config,
      projectName: 'imported',
      pins: [{ pin: 'PA0', mode: 'OUTPUT', params: {} }],
    }
    store.loadConfig(imported)
    expect(store.dirty).toBe(false) // loadConfig 本身置净
    expect(history.canUndo.value).toBe(true)
    expect(history.undo()).toBe(true)
    expect(store.projectName).toBe('ch32-project')
    expect(store.assignments).toEqual([])
    expect(store.dirty).toBe(true)
  })

  it('openConfig 跨芯片导入：历史重置为新芯片当前态', () => {
    const { history, store } = setup()
    tickPastCoalesce()
    store.setProjectName('before')
    const cfg: ProjectConfig = {
      ...store.config,
      chip: 'CH32V203C8T6',
      projectName: 'cross-chip',
      pins: [],
    }
    store.openConfig(cfg)
    expect(store.chip).toBe('CH32V203C8T6')
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
  })
})

describe('useHistory 与引脚覆盖撤回栈联动', () => {
  it('全局 undo 会清空 pinOverwrite 的单步撤回栈', async () => {
    const { history, store } = setup()
    const overwrite = usePinOverwrite(store)
    tickPastCoalesce()
    // 新引脚无已有配置 → 不弹确认框，直接入覆盖撤回栈
    await overwrite.requestOverwrite('PA0', () => store.setPinAssignment('PA0', 'OUTPUT'))
    expect(store.pinOverwriteHistory).toHaveLength(1)
    expect(history.canUndo.value).toBe(true)

    history.undo()
    expect(store.pinOverwriteHistory).toEqual([])
    expect(store.assignments).toEqual([])
  })

  it('打开同型号的另一个工程后，旧工程的引脚撤回记录已失效', () => {
    const { store } = setup()
    store.setPinAssignment('PA0', 'INPUT', { label: 'old' })
    store.applyPinOverwrite('PA0', () => store.setPinAssignment('PA0', 'OUTPUT'))

    store.openConfig({ ...store.config, projectName: 'other', pins: [{ pin: 'PA0', mode: 'OUTPUT', params: {} }] })

    expect(store.undoPinOverwrite()).toBeNull()
    expect(store.assignmentOf('PA0')).toMatchObject({ mode: 'OUTPUT' })
    expect(store.assignmentOf('PA0')?.label).toBeUndefined()
  })

  it('确认框等待期间如果加载了另一个工程，确认结果不能写入新工程', async () => {
    const { store } = setup()
    store.setPinAssignment('PA0', 'INPUT')
    // 故意在确认返回前载入相同的引脚值，确认跨工程仍会失效。
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(async () => {
      store.openConfig({ ...store.config, projectName: 'other' })
      // 无输入框时，Element Plus 运行时直接返回 action 字符串。
      return 'confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>
    })

    const overwrite = usePinOverwrite(store)
    expect(await overwrite.requestOverwrite('PA0', () => store.setPinAssignment('PA0', 'OUTPUT'))).toBe(false)
    expect(store.assignmentOf('PA0')?.mode).toBe('INPUT')
    expect(store.pinOverwriteHistory).toEqual([])
  })
})

describe('resolveHistoryShortcut 快捷键判定', () => {
  const base = { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

  it('Ctrl+Z / Cmd+Z → undo', () => {
    expect(resolveHistoryShortcut({ ...base, key: 'z', ctrlKey: true })).toBe('undo')
    expect(resolveHistoryShortcut({ ...base, key: 'z', metaKey: true })).toBe('undo')
    expect(resolveHistoryShortcut({ ...base, key: 'Z', ctrlKey: true })).toBe('undo')
    expect(resolveHistoryShortcut({ ...base, key: 'z', code: 'KeyZ', ctrlKey: true })).toBe('undo')
  })

  it('Ctrl+Shift+Z / Cmd+Shift+Z → redo', () => {
    expect(resolveHistoryShortcut({ ...base, key: 'z', ctrlKey: true, shiftKey: true })).toBe('redo')
    expect(resolveHistoryShortcut({ ...base, key: 'Z', metaKey: true, shiftKey: true })).toBe('redo')
  })

  it('Ctrl+Y / Cmd+Y → redo', () => {
    expect(resolveHistoryShortcut({ ...base, key: 'y', ctrlKey: true })).toBe('redo')
    expect(resolveHistoryShortcut({ ...base, key: 'y', metaKey: true })).toBe('redo')
  })

  it('无修饰键 / Alt 参与 / 其他键 → null（不与 useHotkeys 冲突）', () => {
    expect(resolveHistoryShortcut({ ...base, key: 'z' })).toBeNull()
    expect(resolveHistoryShortcut({ ...base, key: 'z', ctrlKey: true, altKey: true })).toBeNull()
    expect(resolveHistoryShortcut({ ...base, key: 'w', ctrlKey: true })).toBeNull()
    expect(resolveHistoryShortcut({ ...base, key: 'Tab', ctrlKey: true })).toBeNull()
    expect(resolveHistoryShortcut({ ...base, key: 'Escape' })).toBeNull()
    expect(resolveHistoryShortcut({ ...base, key: 's', ctrlKey: true })).toBeNull()
    expect(resolveHistoryShortcut({ ...base, key: 'y', ctrlKey: true, shiftKey: true })).toBeNull()
  })
})
