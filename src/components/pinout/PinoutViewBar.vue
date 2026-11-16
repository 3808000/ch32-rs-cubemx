<script setup lang="ts">
// Pinout 视图分段切换（Graphic / Table）+ 右侧 Code preview / Detail view 开关。
defineProps<{
  showCode: boolean
  showDetail: boolean
}>()

const viewMode = defineModel<'graphic' | 'table'>('viewMode', { required: true })

const emit = defineEmits<{
  (e: 'toggle-code'): void
  (e: 'toggle-detail'): void
}>()
</script>

<template>
  <div class="view-controls">
    <div class="segmented">
      <button class="seg-btn" :class="{ active: viewMode === 'graphic' }" @click="viewMode = 'graphic'">Graphic view</button>
      <button class="seg-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">Table view</button>
    </div>
    <div class="toolbar-fill"></div>
    <el-button size="small" :type="showCode ? 'primary' : 'default'" @click="emit('toggle-code')">&lt;/&gt; Code preview</el-button>
    <el-button size="small" :type="showDetail ? 'primary' : 'default'" @click="emit('toggle-detail')">Detail view</el-button>
  </div>
</template>

<style scoped>
.view-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 20px 10px;
}
.segmented {
  display: flex;
  background: transparent;
  border-radius: 0;
  padding: 0;
}
.seg-btn {
  border: none;
  background: transparent;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--mx-text-secondary);
  cursor: pointer;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  position: relative;
  /* 分段切换：颜色/下划线 140ms 过渡（与视图切换节奏一致） */
  transition:
    color var(--mx-dur-view) var(--mx-ease-out),
    background-color var(--mx-dur-view) var(--mx-ease-out),
    border-color var(--mx-dur-view) var(--mx-ease-out);
}
.seg-btn.active {
  background: var(--mx-surface);
  color: var(--mx-accent);
  font-weight: 600;
  border-bottom: 2px solid var(--mx-accent);
}
.toolbar-fill {
  flex: 1;
}
</style>