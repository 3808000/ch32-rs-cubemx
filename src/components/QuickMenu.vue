<script setup lang="ts">
// Quick menu（§8.6）：右侧浮出目录树（分类 → 实例），点击 scrollIntoView 定位卡片。
import { computed } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'
import { derivePeripheralUsage } from '../lib/peripherals'
import { derivePeriCategories } from './PeripheralList.vue'
import { cardDomId } from './PeripheralConfigCard.vue'

const emit = defineEmits<{ select: [id: string]; close: [] }>()

const store = useProjectStore()

const categories = computed(() => derivePeriCategories(store.deviceData))

const enabledMap = computed(() => {
  const m = new Map<string, boolean>()
  for (const u of derivePeripheralUsage(store.config, store.deviceData)) m.set(u.id, u.enabled)
  return m
})

function go(id: string) {
  emit('select', id)
  const el = document.getElementById(cardDomId(id))
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="quick-menu">
    <div class="qm-head">
      <span class="qm-title">Quick menu</span>
      <button type="button" class="qm-close" @click="emit('close')">
        <el-icon :size="12"><Close /></el-icon>
      </button>
    </div>
    <div class="qm-tree">
      <div v-for="cat in categories" :key="cat.key" class="qm-cat">
        <div class="qm-cat-label">{{ cat.label }}</div>
        <button
          v-for="id in cat.ids"
          :key="id"
          type="button"
          class="qm-item"
          @click="go(id)"
        >
          <span class="qm-dot" :class="{ on: enabledMap.get(id) === true }" />
          <span>{{ id }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-menu {
  position: absolute;
  top: 8px;
  right: 372px;
  width: 230px;
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-popover);
  box-shadow: var(--mx-shadow-popover);
  z-index: 30;
  display: flex;
  flex-direction: column;
  max-height: 70%;
  overflow: hidden;
}
.qm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mx-border);
}
.qm-title {
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.qm-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--mx-text-muted);
  display: flex;
  align-items: center;
  padding: 2px;
}
.qm-close:hover {
  color: var(--mx-text);
}
.qm-tree {
  overflow-y: auto;
  padding: 4px 0 8px;
}
.qm-cat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--mx-text-muted);
  padding: 6px 12px 2px;
}
.qm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 4px 12px;
  font-size: var(--mx-fz-label);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-secondary);
  cursor: pointer;
  text-align: left;
}
.qm-item:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.qm-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d0d5dd;
  flex-shrink: 0;
}
.qm-dot.on {
  background: var(--mx-success);
}
</style>
