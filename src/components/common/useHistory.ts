// 全局 Undo/Redo 接线（M6）：把 historyStack 纯快照栈接到 project store。
// 由常驻组件（App.vue）在 setup 中调用；快捷键随组件挂载/卸载注册/移除。
// 注意：undo/redo 通过 loadConfig 整体写回，会触发 sync watcher，因此用抑制标志避免自我入栈。
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { useProjectStore } from '@/controllers/project'
import { createHistoryStack } from '@/services/historyStack'
import { isEditableTarget } from '@/components/common/useHotkeys'
import type { ProjectConfig } from '@/model/types'

/** useHistory 返回值。 */
export interface UseHistoryReturn {
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** 撤回一步；成功返回 true（无可撤回时 false）。 */
  undo(): boolean
  /** 重做一步；成功返回 true（无可重做时 false）。 */
  redo(): boolean
  /** 丢弃全部历史，以当前态为新基线（切芯片时内部自动调用）。 */
  reset(): void
}

/** 快捷键判定所需的最小事件形状（纯函数，便于 node 环境单测）。 */
export interface HistoryShortcutKey {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * 判定历史快捷键：Ctrl/Cmd+Z → undo；Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y → redo。
 * 其余组合（含 Alt 参与、Ctrl+W/Tab/Esc 等）返回 null，不与 useHotkeys 冲突。
 */
export function resolveHistoryShortcut(e: HistoryShortcutKey): 'undo' | 'redo' | null {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return null
  const key = e.key.toLowerCase()
  const isZ = key === 'z' || e.code === 'KeyZ'
  const isY = key === 'y' || e.code === 'KeyY'
  if (isZ) return e.shiftKey ? 'redo' : 'undo'
  if (isY && !e.shiftKey) return 'redo'
  return null
}

/** 深克隆配置快照。ProjectConfig 为纯 JSON 数据，JSON 往返即可安全脱离响应式引用。 */
function cloneConfig(cfg: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(cfg)) as ProjectConfig
}

/**
 * 全局历史 composable。内部使用 useProjectStore()，调用前需已安装 Pinia。
 * 挂载时压入初始快照；此后 sync 深监听 store.config，非抑制期的变化自动入栈。
 */
export function useHistory(): UseHistoryReturn {
  const store = useProjectStore()
  const stack = createHistoryStack<ProjectConfig>()

  // 栈本身非响应式：用版本号驱动 canUndo/canRedo 的 computed 重新求值。
  const version = ref(0)
  function bump(): void {
    version.value += 1
  }

  // undo/redo 写回期间的抑制标志：sync watcher 下置位→写回→复位是确定性顺序。
  let suppressing = false

  /** 以当前态为唯一基线重置历史（基线不参与合并窗口，首次编辑必然独立入栈）。 */
  function reset(): void {
    stack.clear(cloneConfig(store.config))
    bump()
  }

  // 初始快照。用 clear 而非 push：避免挂载后 800ms 内的首次编辑被合并进基线。
  reset()

  // 深监听 + sync：深层字段变化（如引脚 params）也会触发；重复变化由栈的 equals 跳过。
  watch(
    () => store.config,
    (cfg) => {
      if (suppressing) return
      stack.push(cloneConfig(cfg))
      bump()
    },
    { deep: true, flush: 'sync' },
  )

  // 芯片变化 → 历史重置。先清空栈，随后同批 sync 变更（switchDevice/loadConfig 的清理与写入）
  // 会在合并窗口内收敛为一条「新芯片当前态」基线；抑制期内（undo 跨芯片写回）不重置。
  watch(
    () => store.chip,
    () => {
      if (suppressing) return
      stack.clear()
      bump()
    },
    { flush: 'sync' },
  )

  /** 取快照 → 抑制 → 整体写回 → 标脏 → 清引脚覆盖撤回栈 → 解除抑制。 */
  function applySnapshot(snapshot: ProjectConfig): void {
    suppressing = true
    try {
      store.loadConfig(snapshot)
      store.markDirty()
    } finally {
      suppressing = false
    }
    bump()
  }

  function undo(): boolean {
    const snapshot = stack.undo()
    if (!snapshot) return false
    applySnapshot(snapshot)
    return true
  }

  function redo(): boolean {
    const snapshot = stack.redo()
    if (!snapshot) return false
    applySnapshot(snapshot)
    return true
  }

  const canUndo = computed(() => {
    void version.value
    return stack.canUndo()
  })
  const canRedo = computed(() => {
    void version.value
    return stack.canRedo()
  })

  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    // 输入框/文本域/下拉内不抢快捷键（原生编辑撤回优先）。
    if (isEditableTarget(e.target)) return
    const action = resolveHistoryShortcut(e)
    if (!action) return
    const ok = action === 'undo' ? undo() : redo()
    // 只有成功处理才拦截默认行为。
    if (ok) e.preventDefault()
  }

  function attach(): void {
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKeydown)
  }
  function detach(): void {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
  }

  if (getCurrentInstance()) {
    onMounted(attach)
    onBeforeUnmount(detach)
  } else {
    // 非组件上下文（测试/effectScope）：无生命周期可挂，直接注册（node 下无 window 则为空操作）。
    attach()
  }

  return { canUndo, canRedo, undo, redo, reset }
}
