<script setup lang="ts">
// 左侧图标栏：56px 白底 + 右侧浅灰分隔线（M8 对齐 MX2），深灰图标、当前模块黄色圆角方块 + 深色图标，底部帮助/设置
// M10.1b 空态门禁：未打开/创建工程时 Pinout/Clock/Peripherals 禁用（Home 始终可用）
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

/** 空态禁用提示（MX2 空态：只有 Home 可用）。 */
const LOCKED_HINT = '先创建或打开工程'

/** 非 Home 入口在工程打开前禁用。 */
function locked(id: ViewId): boolean {
  return !store.projectOpened && id !== 'home'
}
</script>

<template>
  <aside class="iconrail">
    <div class="rail-items">
      <!-- 禁用按钮不触发鼠标事件，故包一层 span 承载标题与 tooltip；锁定时用原生 title 提示 -->
      <el-tooltip
        v-for="it in items"
        :key="it.id"
        :content="it.label"
        placement="right"
        :disabled="locked(it.id)"
      >
        <span class="rail-btn-holder" :title="locked(it.id) ? LOCKED_HINT : undefined">
          <button
            class="rail-btn"
            :class="{ active: store.activeView === it.id }"
            :disabled="locked(it.id)"
            :aria-disabled="locked(it.id)"
            @click="store.setView(it.id)"
          >
            <el-icon :size="20"><component :is="it.icon" /></el-icon>
          </button>
        </span>
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
.rail-btn-holder {
  display: flex;
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
/* 空态禁用（M10.1b）：视觉降级且不响应 hover */
.rail-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.rail-btn:disabled:hover {
  background: transparent;
  color: var(--mx-iconrail-fg);
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