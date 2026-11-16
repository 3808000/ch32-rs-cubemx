<script lang="ts">
// 面板拖拽调宽的纯函数与常量（M6）：随组件导出，供 tests/panelResize.test.ts 直接验证。
// 本组件是纯展示组件：不 import store / uiPreferences，宽度持久化由宿主视图负责。

/** 面板宽度夹取范围（单位 px）：detail 面板与 code 预览面板各一档。 */
export const DETAIL_WIDTH_RANGE = { min: 280, max: 560 } as const
export const CODE_WIDTH_RANGE = { min: 320, max: 760 } as const

/** 键盘左右方向键的单步步进（px）。 */
export const PANEL_KEYBOARD_STEP = 10

/**
 * 把宽度夹取到 [min, max]；非有限数（NaN / Infinity）兜底返回 min，
 * 避免损坏的偏好值或异常事件坐标把面板拖成非法宽度。
 */
export function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, width))
}

/**
 * 拖动位移 → 宽度增量 的方向语义：
 * - side='left'：面板在分隔条左侧，向右拖（dx>0）增宽，增量 = dx；
 * - side='right'：面板在分隔条右侧（右缘固定），向左拖（dx<0）增宽，增量 = -dx。
 * 非有限位移兜底为 0（不产生宽度变化）。
 */
export function resizeDelta(dx: number, side: 'left' | 'right'): number {
  if (!Number.isFinite(dx)) return 0
  const delta = side === 'left' ? dx : -dx
  // 归一化 -0 → 0，保证零位移语义稳定
  return delta === 0 ? 0 : delta
}
</script>

<script setup lang="ts">
// 竖直拖拽分隔条（M6）：放在面板左缘（side='right'）或右缘（side='left'）。
// - 鼠标拖动：实时 emit('resize', width)，松手 emit('commit', width)（宿主在 commit 时才写偏好）
// - 键盘：聚焦后 ArrowLeft / ArrowRight 步进 ±10px，同样夹取并 emit resize + commit
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  /** 当前面板宽度（px），由宿主视图持有 */
  width: number
  /** 允许的最小宽度（px） */
  min: number
  /** 允许的最大宽度（px） */
  max: number
  /** 面板相对分隔条的位置：决定拖动方向语义 */
  side: 'left' | 'right'
}>()

const emit = defineEmits<{
  /** 拖动过程中实时触发（每帧可能多次），宿主只更新本地宽度 */
  (e: 'resize', width: number): void
  /** 松手 / 键盘步进结束时触发，宿主在此持久化 */
  (e: 'commit', width: number): void
}>()

const dragging = ref(false)
let startX = 0
let startW = 0
let lastW = 0
/** 拖动期间禁用文本选中，松手恢复原值 */
let prevUserSelect = ''

function onDragMove(e: MouseEvent) {
  if (!dragging.value) return
  const next = clampPanelWidth(startW + resizeDelta(e.clientX - startX, props.side), props.min, props.max)
  if (next !== lastW) {
    lastW = next
    emit('resize', next)
  }
}

function stopDrag(commit: boolean) {
  if (!dragging.value) return
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.body.style.userSelect = prevUserSelect
  if (commit) emit('commit', lastW)
}

function onDragEnd() {
  stopDrag(true)
}

function onDragStart(e: MouseEvent) {
  if (e.button !== 0 || dragging.value) return
  dragging.value = true
  startX = e.clientX
  startW = props.width
  lastW = props.width
  prevUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  e.preventDefault()
}

/** 键盘步进：方向语义与鼠标一致（side='right' 时 ArrowLeft 增宽）。 */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const dx = e.key === 'ArrowRight' ? PANEL_KEYBOARD_STEP : -PANEL_KEYBOARD_STEP
  const next = clampPanelWidth(props.width + resizeDelta(dx, props.side), props.min, props.max)
  if (next === props.width) return
  emit('resize', next)
  emit('commit', next)
}

// 组件卸载时兜底清理全局监听（拖动中被 v-if 移除的场景）
onBeforeUnmount(() => stopDrag(false))
</script>

<template>
  <div
    class="panel-resizer"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    aria-label="调整面板宽度"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="width"
    tabindex="0"
    @mousedown="onDragStart"
    @keydown="onKeydown"
  ></div>
</template>

<style scoped>
.panel-resizer {
  width: 5px;
  flex-shrink: 0;
  align-self: stretch;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  touch-action: none;
}
.panel-resizer:hover,
.panel-resizer.dragging,
.panel-resizer:focus-visible {
  background: var(--mx-accent);
}
.panel-resizer:focus-visible {
  outline: none;
}
</style>
