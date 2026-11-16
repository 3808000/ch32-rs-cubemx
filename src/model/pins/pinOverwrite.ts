// 引脚覆盖确认 + 撤回。所有覆盖已有配置的操作必须走这里。
// 注意：本模块属于 model 层，不得反向依赖 controllers（Pinia store）。
// 所需的“读当前配置 / 写回配置 / 清除配置”能力由调用方以参数注入（见 PinOverwriteDeps）。
import { ElMessageBox, ElMessage } from 'element-plus'
import type { PinAssignment, PinMode, PinParams } from '@/model/types'

/**
 * 覆盖确认与撤回所需的最小宿主接口。
 * 调用方（views/components）传入自己的 store；model 只依赖这个纯接口，不知道 Pinia 存在。
 */
export interface PinOverwriteDeps {
  /** 查询某个引脚当前配置（用于覆盖确认文案与撤回占位）。 */
  assignmentOf: (pin: string) => PinAssignment | undefined
  /** 写入/覆盖一条引脚配置（撤回旧配置时使用）。 */
  setPinAssignment: (
    pin: string,
    mode: PinMode,
    opts?: { label?: string; function?: string; remap?: number; params?: PinParams },
  ) => void
  /** 清除引脚配置（撤回“本次新增”的配置时使用）。 */
  clearPin: (pin: string) => void
}

interface UndoEntry {
  pin: string
  prev: PinAssignment | null
}

const undoStack: UndoEntry[] = []

/** 清空撤回栈。破坏性批量操作（如 Reset pinout）后调用，避免恢复出与当前状态不一致的配置。 */
export function clearUndo(): void {
  undoStack.length = 0
}

/**
 * 创建引脚覆盖处理器。
 * @param deps 状态读写能力（通常直接传 Pinia store），由调用方负责注入。
 */
export function usePinOverwrite(deps: PinOverwriteDeps) {
  /** 请求覆盖引脚配置：已有配置时弹确认；执行后压入撤回栈。 */
  async function requestOverwrite(pin: string, apply: () => void, actionText = '覆盖'): Promise<boolean> {
    const existing = deps.assignmentOf(pin)
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
      deps.setPinAssignment(entry.pin, entry.prev.mode, {
        label: entry.prev.label,
        function: entry.prev.function,
        remap: entry.prev.remap,
        params: entry.prev.params,
      })
    } else {
      deps.clearPin(entry.pin)
    }
    ElMessage.success(`已撤回 ${entry.pin} 的配置变更`)
    return true
  }

  function canUndo(): boolean {
    return undoStack.length > 0
  }

  return { requestOverwrite, undo, canUndo, clearUndo }
}