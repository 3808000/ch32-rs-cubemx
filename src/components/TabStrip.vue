<script setup lang="ts">
// 浏览器式标签页条：固定视图 + Project settings + 可关闭的外设对象页（M2）。
import { computed } from 'vue'
import { HomeFilled, Cpu, Timer, Connection, Setting, Close } from '@element-plus/icons-vue'
import { useProjectStore, type ViewId } from '@/controllers/project'

const store = useProjectStore()

const tabs: { id: ViewId; label: string; icon: unknown }[] = [
  { id: 'home', label: 'Home', icon: HomeFilled },
  { id: 'pinout', label: 'Pinout', icon: Cpu },
  { id: 'clock', label: 'Clock', icon: Timer },
  { id: 'peripherals', label: 'Peripherals', icon: Connection },
  { id: 'project-settings', label: 'Project settings', icon: Setting },
]

/** 当前打开的外设对象页标签（可关闭）。 */
const peripheralTab = computed(() => {
  const id = store.activePeripheralId
  if (!id) return null
  return { id, label: id }
})

function closePeripheralTab() {
  store.closePeripheral()
}
</script>

<template>
  <div class="tabstrip">
    <button
      v-for="t in tabs"
      :key="t.id"
      class="tab"
      :class="{ active: store.activeView === t.id && !(t.id === 'peripherals' && peripheralTab) }"
      @click="store.setView(t.id)"
    >
      <el-icon :size="14"><component :is="t.icon" /></el-icon>
      <span>{{ t.label }}</span>
      <span v-if="store.dirty && store.activeView === t.id" class="dirty-dot" title="有未保存改动"></span>
    </button>

    <!-- 外设对象页标签（可关闭） -->
    <button
      v-if="peripheralTab"
      class="tab object-tab"
      :class="{ active: store.activeView === 'peripherals' }"
      @click="store.setView('peripherals')"
    >
      <el-icon :size="14"><Connection /></el-icon>
      <span>{{ peripheralTab.label }}</span>
      <span
        class="tab-close"
        title="关闭外设页"
        @click.stop="closePeripheralTab"
      >
        <el-icon :size="12"><Close /></el-icon>
      </span>
    </button>

    <div class="tabstrip-fill"></div>
  </div>
</template>

<style scoped>
.tabstrip {
  height: var(--mx-tabstrip-h);
  background: #e9edf5;
  display: flex;
  align-items: flex-end;
  padding: 0 8px;
  gap: 2px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--mx-border);
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--mx-text-secondary);
  font-size: 13px;
  cursor: pointer;
  border-radius: var(--mx-radius-tab) var(--mx-radius-tab) 0 0;
  position: relative;
  white-space: nowrap;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.6);
}
.tab.active {
  background: var(--mx-surface);
  color: var(--mx-accent);
  font-weight: 600;
}
.tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--mx-accent);
}
.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mx-error);
}
.tabstrip-fill {
  flex: 1;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--mx-text-muted);
}
.tab-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--mx-text);
}
</style>