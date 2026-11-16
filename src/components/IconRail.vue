<script setup lang="ts">
// 左侧图标栏：56px 白底 + 右侧浅灰分隔线（M8 对齐 MX2），深灰图标、当前模块黄色圆角方块 + 深色图标，底部帮助/设置
import { HomeFilled, Cpu, Timer, Connection, QuestionFilled, Setting } from '@element-plus/icons-vue'
import { useProjectStore, type ViewId } from '@/controllers/project'

const store = useProjectStore()
const emit = defineEmits<{ (e: 'action', key: string): void }>()

const items: { id: ViewId; label: string; icon: unknown }[] = [
  { id: 'home', label: 'Home', icon: HomeFilled },
  { id: 'pinout', label: 'Pinout', icon: Cpu },
  { id: 'clock', label: 'Clock', icon: Timer },
  { id: 'peripherals', label: 'Peripherals', icon: Connection },
]
</script>

<template>
  <aside class="iconrail">
    <div class="rail-items">
      <el-tooltip v-for="it in items" :key="it.id" :content="it.label" placement="right">
        <button class="rail-btn" :class="{ active: store.activeView === it.id }" @click="store.setView(it.id)">
          <el-icon :size="20"><component :is="it.icon" /></el-icon>
        </button>
      </el-tooltip>
    </div>
    <div class="rail-bottom">
      <!-- 组间细分隔线（MX2 白栏横线分组） -->
      <div class="rail-divider" role="separator"></div>
      <el-tooltip content="帮助" placement="right">
        <button class="rail-btn" @click="emit('action', 'help')"><el-icon :size="18"><QuestionFilled /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="设置" placement="right">
        <button class="rail-btn" @click="emit('action', 'settings')"><el-icon :size="18"><Setting /></el-icon></button>
      </el-tooltip>
    </div>
  </aside>
</template>

<style scoped>
.iconrail {
  width: var(--mx-iconrail-w);
  background: var(--mx-iconrail-bg);
  border-right: 1px solid var(--mx-iconrail-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 0;
  flex-shrink: 0;
}
.rail-items,
.rail-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
/* 组间横线（底部帮助/设置组上方） */
.rail-divider {
  width: 32px;
  height: 1px;
  margin: 4px 0 6px;
  background: var(--mx-iconrail-divider);
  flex-shrink: 0;
}
.rail-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--mx-iconrail-fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.rail-btn:hover {
  background: var(--mx-iconrail-hover-bg);
  color: var(--mx-iconrail-fg-hover);
}
.rail-btn:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}
.rail-btn.active {
  color: var(--mx-iconrail-active-fg);
}
.rail-btn.active:hover {
  background: transparent;
  color: var(--mx-iconrail-active-fg);
}
.rail-btn.active::before {
  content: '';
  position: absolute;
  inset: 2px;
  background: var(--mx-highlight);
  border-radius: 8px;
  z-index: 0;
}
.rail-btn :deep(svg) {
  position: relative;
  z-index: 1;
}
</style>