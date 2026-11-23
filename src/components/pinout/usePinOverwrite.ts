// 引脚覆盖确认与撤回提示。具体状态修改和历史归属由工程 store 管理。
import { ElMessage, ElMessageBox } from 'element-plus'
import type { useProjectStore } from '@/controllers/project'

export function usePinOverwrite(store: ReturnType<typeof useProjectStore>) {
  async function requestOverwrite(pin: string, apply: () => void, actionText = '覆盖'): Promise<boolean> {
    const existing = store.assignmentOf(pin)
    if (existing) {
      const history = store.pinOverwriteHistory
      const snapshot = JSON.stringify(existing)
      try {
        await ElMessageBox.confirm(
          `引脚 ${pin} 已配置为 ${existing.mode}${existing.function ? ` / ${existing.function}` : ''}${existing.label ? `（${existing.label}）` : ''}。确定${actionText}？`,
          '覆盖引脚配置',
          { confirmButtonText: '覆盖', cancelButtonText: '取消', type: 'warning' },
        )
      } catch {
        return false
      }
      // 等待期间工程或引脚配置可能已变化，之前的确认已失效。
      if (history !== store.pinOverwriteHistory || snapshot !== JSON.stringify(store.assignmentOf(pin))) return false
    }
    store.applyPinOverwrite(pin, apply)
    return true
  }

  function undo(): boolean {
    const pin = store.undoPinOverwrite()
    if (pin === null) {
      ElMessage.info('没有可撤回的操作')
      return false
    }
    ElMessage.success(`已撤回 ${pin} 的配置变更`)
    return true
  }

  return { requestOverwrite, undo }
}
