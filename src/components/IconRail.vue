<script setup lang="ts">
// 左侧图标栏：56px 深藏青底，当前模块黄色方块高亮，底部帮助/设置
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
.rail-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #aebadb;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.rail-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.rail-btn.active {
  color: #03234b;
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