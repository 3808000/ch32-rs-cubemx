// 引脚覆盖确认 + 撤回。所有覆盖已有配置的操作必须走这里。
import { ElMessageBox, ElMessage } from 'element-plus'
import type { PinAssignment } from '../types'
import { useProjectStore } from '../stores/project'

interface UndoEntry {
  pin: string
  prev: PinAssignment | null
}

const undoStack: UndoEntry[] = []

/** 清空撤回栈。破坏性批量操作（如 Reset pinout）后调用，避免恢复出与当前状态不一致的配置。 */
export function clearUndo(): void {
  undoStack.length = 0
}

export function usePinOverwrite() {
  const store = useProjectStore()

  /** 请求覆盖引脚配置：已有配置时弹确认；执行后压入撤回栈。 */
  async function requestOverwrite(pin: string, apply: () => void, actionText = '覆盖'): Promise<boolean> {
    const existing = store.assignmentOf(pin)
    if (existing) {
      try {
        await ElMessageBox.confirm(
          `引脚 ${pin} 已配置为 ${existing.mode}${existing.function ? ` / ${existing.function}` : ''}${existing.label ? `（${existing.label}）` : ''}。确定${actionText}？`,
          '覆盖引脚配置',
          { confirmButtonText: '覆盖', cancelButtonText: '取消', type: 'warning' },
        )
      } catch {
        return false
      }
    }
    undoStack.push({ pin, prev: existing ? { ...existing, params: { ...existing.params } } : null })
    if (undoStack.length > 100) undoStack.shift()
    apply()
    return true
  }

  /** 撤回上一步覆盖/清除。 */
  function undo(): boolean {
    const entry = undoStack.pop()
    if (!entry) {
      ElMessage.info('没有可撤回的操作')
      return false
    }
    if (entry.prev) {
      store.setPinAssignment(entry.pin, entry.prev.mode, {
        label: entry.prev.label,
        function: entry.prev.function,
        remap: entry.prev.remap,
        params: entry.prev.params,
      })
    } else {
      store.clearPin(entry.pin)
    }
    ElMessage.success(`已撤回 ${entry.pin} 的配置变更`)
    return true
  }

  function canUndo(): boolean {
    return undoStack.length > 0
  }

  return { requestOverwrite, undo, canUndo, clearUndo }
}