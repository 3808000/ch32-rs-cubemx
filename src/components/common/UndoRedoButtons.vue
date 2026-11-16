<script setup lang="ts">
// 全局 Undo/Redo 按钮（M6）：纯展示组件，不 import store。
// 状态与回调由父级（AppShell 标题栏）从 useHistory() 注入。样式对齐标题栏 win-btn。
import { RefreshLeft, RefreshRight } from '@element-plus/icons-vue'

defineProps<{ canUndo: boolean; canRedo: boolean }>()
const emit = defineEmits<{ (e: 'undo'): void; (e: 'redo'): void }>()
</script>

<template>
  <div class="undo-redo">
    <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom">
      <button
        class="hist-btn"
        type="button"
        :disabled="!canUndo"
        aria-label="撤销 (Ctrl+Z)"
        @click="emit('undo')"
      >
        <el-icon :size="14"><RefreshLeft /></el-icon>
      </button>
    </el-tooltip>
    <el-tooltip content="重做 (Ctrl+Shift+Z)" placement="bottom">
      <button
        class="hist-btn"
        type="button"
        :disabled="!canRedo"
        aria-label="重做 (Ctrl+Shift+Z)"
        @click="emit('redo')"
      >
        <el-icon :size="14"><RefreshRight /></el-icon>
      </button>
    </el-tooltip>
  </div>
</template>

<style scoped>
.undo-redo {
  display: flex;
  align-items: center;
  gap: 4px;
  /* 标题栏为拖拽区，按钮需豁免 */
  -webkit-app-region: no-drag;
}
.hist-btn {
  background: none;
  border: none;
  color: var(--mx-titlebar-fg);
  width: 30px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hist-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.hist-btn:focus-visible {
  outline: 2px solid var(--mx-highlight);
  outline-offset: 1px;
}
.hist-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>