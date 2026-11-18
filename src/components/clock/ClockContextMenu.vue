<script setup lang="ts">
// 时钟节点右键菜单（M15，仿 pinout/PinContextMenu.vue）：锁定/解锁、路径高亮、清空高亮、
// 配置外设（经 peripheralFocus 桥跳转 Peripherals 对象页）。
// 定位使用 viewport 坐标（ClockNode 抛 clientX/clientY）；菜单 position: fixed。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ClockTreeNode } from '@/model/clock/tree'

const props = defineProps<{
  x: number
  y: number
  node: ClockTreeNode
  hasHighlight?: boolean
  /** 可打开的 peripherals.json 实例 id（USB 等非实例节点为 null，不显示 Configure） */
  configureId?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-lock', nodeId: string): void
  (e: 'highlight-source', nodeId: string): void
  (e: 'highlight-all', nodeId: string): void
  (e: 'clear-highlight'): void
  (e: 'configure', periId: string): void
}>()

const root = ref<HTMLElement | null>(null)

/** 视口边界夹取：右侧/下方空间不足时向左/上偏移，避免菜单出屏 */
const style = computed(() => {
  const w = 230
  const h = 210
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(4, Math.min(props.x, vw - w - 8))
  const top = Math.max(4, Math.min(props.y, vh - h - 8))
  return { left: `${left}px`, top: `${top}px` }
})

function act(fn: () => void) {
  fn()
  emit('close')
}

function onDocumentMouseDown(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) emit('close')
}
function onDocumentKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown)
  document.addEventListener('keydown', onDocumentKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  document.removeEventListener('keydown', onDocumentKey)
})
</script>

<template>
  <div ref="root" class="clock-menu" :style="style" role="menu" @contextmenu.prevent @mousedown.stop>
    <div class="menu-head">
      <span class="menu-title">{{ node.label }}</span>
      <span v-if="node.badge" class="menu-badge">{{ node.badge }}</span>
      <span v-if="node.locked" class="menu-badge locked">已锁定</span>
    </div>

    <button v-if="node.lockable" type="button" class="menu-item" role="menuitem" @click="act(() => emit('toggle-lock', node.id))">
      {{ node.locked ? '解锁节点' : '锁定节点' }}
    </button>

    <div class="menu-sep"></div>
    <button type="button" class="menu-item" role="menuitem" @click="act(() => emit('highlight-source', node.id))">
      高亮源路径（仅上游）
    </button>
    <button type="button" class="menu-item" role="menuitem" @click="act(() => emit('highlight-all', node.id))">
      高亮全部路径（上下游）
    </button>
    <button
      v-if="hasHighlight"
      type="button"
      class="menu-item"
      role="menuitem"
      @click="act(() => emit('clear-highlight'))"
    >
      清除高亮
    </button>

    <template v-if="configureId">
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" role="menuitem" @click="act(() => emit('configure', configureId!))">
        Configure {{ configureId }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.clock-menu {
  position: fixed;
  width: 230px;
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  padding: 5px;
  z-index: 40;
  font-size: 12px;
}
.menu-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px 7px;
  border-bottom: 1px solid var(--mx-border);
  margin-bottom: 4px;
}
.menu-title {
  font-weight: 600;
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-badge {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--mx-text-muted);
  border: 1px solid var(--mx-border);
  border-radius: 7px;
  padding: 0 5px;
  line-height: 15px;
  margin-left: auto;
}
.menu-badge.locked {
  color: var(--mx-accent);
  border-color: var(--mx-accent);
  background: var(--mx-accent-soft);
  margin-left: 0;
}
.menu-item {
  display: block;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 6px 7px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--mx-text);
  cursor: pointer;
}
.menu-item:hover:not(:disabled),
.menu-item:focus-visible:not(:disabled) {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
  outline: none;
}
.menu-item:disabled {
  cursor: default;
  color: var(--mx-text-muted);
}
.menu-sep {
  height: 1px;
  background: var(--mx-border);
  margin: 4px 3px;
}
</style>
