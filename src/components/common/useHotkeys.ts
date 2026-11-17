// 全局快捷键（ROADMAP M2.10）：Ctrl+Tab 切换视图标签、Ctrl+W / Ctrl+Alt+P 关闭外设对象页、
// Esc 取消引脚选中。由常驻的 AppShell 挂载；Ctrl+S（保存）由 App.vue 处理，此处不重复注册。
import { onBeforeUnmount, onMounted } from 'vue'
import { useProjectStore, type ViewId } from '@/controllers/project'

/** 标签页固定循环顺序（历史默认序列，保留供旧调用/测试使用）。 */
export const VIEW_CYCLE_ORDER: readonly ViewId[] = [
  'home',
  'pinout',
  'clock',
  'peripherals',
  'project-settings',
]

/** 空态循环序列（M10.1b）：工程未打开时 TabStrip 只有 Home，Ctrl+Tab 不得循环到被门禁挡住的视图。 */
export const HOME_ONLY_CYCLE_ORDER: readonly ViewId[] = ['home']

/** 按门禁状态选择默认循环序列（保留兼容；运行时实际序列以 store.openViews 为准）。 */
export function cycleOrder(projectOpened: boolean): readonly ViewId[] {
  return projectOpened ? VIEW_CYCLE_ORDER : HOME_ONLY_CYCLE_ORDER
}

/**
 * 在给定视图序列中前进/后退（delta 为 +1/-1），越界时回绕。
 * current 为 null（所有标签已关闭）时从序列首项起算，保证 Ctrl+Tab 能重新打开标签。
 */
export function nextViewId(
  current: ViewId | null,
  delta: number,
  order: readonly ViewId[] = VIEW_CYCLE_ORDER,
): ViewId {
  const len = order.length
  if (len === 0) return 'home'
  if (current === null) return order[0] ?? 'home'
  const index = order.indexOf(current)
  // 未知视图（理论上不会发生）从第一项开始计算
  const from = index >= 0 ? index : 0
  const next = (((from + delta) % len) + len) % len
  return order[next] ?? 'home'
}

/** 焦点在可编辑控件（输入框/文本域/下拉/富文本/Monaco）时，Esc 不抢给全局。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 对话框/抽屉打开时（Element Plus 锁屏类），Esc 交给弹层自行处理。 */
function hasOpenModal(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.body.classList.contains('el-popup-parent--hidden')
  )
}

/** 兼容不同键盘布局：优先 e.key，再退回物理键位 e.code。 */
function isKey(e: KeyboardEvent, key: string, code: string): boolean {
  return e.key.toLowerCase() === key || e.code === code
}

export function useHotkeys() {
  const store = useProjectStore()

  function cycleView(delta: number): void {
    // 循环序列 = 当前已打开的标签（M10 文档模型）；无标签时回退 Home-only，setView 守卫兜底
    const order = store.openViews.length > 0 ? store.openViews : HOME_ONLY_CYCLE_ORDER
    store.setView(nextViewId(store.activeView, delta, order))
  }

  /** Ctrl+W / Ctrl+Alt+P：关闭外设对象页；未打开对象页时不拦截浏览器默认行为。 */
  function closeActivePeripheral(): void {
    if (store.activePeripheralId) store.closePeripheral()
  }

  function clearPinSelection(): void {
    if (store.selectedPin !== null) store.selectPin(null)
  }

  function onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey

    // Ctrl+Tab / Ctrl+Shift+Tab：按标签顺序切换视图
    if (mod && !e.altKey && e.key === 'Tab') {
      e.preventDefault()
      cycleView(e.shiftKey ? -1 : 1)
      return
    }

    // Ctrl+W：关闭当前外设对象页
    if (mod && !e.shiftKey && !e.altKey && isKey(e, 'w', 'KeyW')) {
      if (store.activePeripheralId) {
        e.preventDefault()
        closeActivePeripheral()
      }
      return
    }

    // Ctrl+Alt+P：Ctrl+W 的替代组合（部分宿主会占用 Ctrl+W）
    if (mod && e.altKey && !e.shiftKey && isKey(e, 'p', 'KeyP')) {
      if (store.activePeripheralId) {
        e.preventDefault()
        closeActivePeripheral()
      }
      return
    }

    // Esc：取消引脚选中；输入控件/已打开的弹层内不拦截
    if (
      e.key === 'Escape' &&
      !e.defaultPrevented &&
      !isEditableTarget(e.target) &&
      !hasOpenModal()
    ) {
      if (store.selectedPin !== null) {
        e.preventDefault()
        clearPinSelection()
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { cycleView, closeActivePeripheral, clearPinSelection }
}