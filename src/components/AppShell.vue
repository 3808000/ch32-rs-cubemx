<script setup lang="ts">
// 标题栏：应用标识 + 工程/视图/帮助菜单 + 工程名·芯片/封装 + 窗口控制（Web 形态仅装饰）
import { computed } from 'vue'
import { useProjectStore } from '../stores/project'
import { Monitor, QuestionFilled, Setting } from '@element-plus/icons-vue'

const store = useProjectStore()
const subtitle = computed(() => `${store.projectName} • ${store.deviceData.chip.chip} / ${store.deviceData.chip.package}`)

const emit = defineEmits<{ (e: 'menu', key: string): void }>()
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-left">
      <div class="app-logo" title="ch32-rs-CubeMX">
        <svg width="26" height="26" viewBox="0 0 26 26">
          <rect x="1" y="1" width="24" height="24" rx="5" fill="#FFD100" />
          <text x="13" y="17.5" text-anchor="middle" font-size="10" font-weight="700" fill="#03234B" font-family="system-ui">MX</text>
        </svg>
      </div>
      <nav class="menus">
        <button class="menu-btn" @click="emit('menu', 'project')">工程</button>
        <button class="menu-btn" @click="emit('menu', 'view')">视图</button>
        <button class="menu-btn" @click="emit('menu', 'help')">帮助</button>
      </nav>
    </div>
    <div class="titlebar-center">{{ subtitle }}</div>
    <div class="titlebar-right">
      <el-tooltip content="设置" placement="bottom">
        <button class="win-btn" @click="emit('menu', 'settings')"><el-icon :size="14"><Setting /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="帮助" placement="bottom">
        <button class="win-btn" @click="emit('menu', 'help')"><el-icon :size="14"><QuestionFilled /></el-icon></button>
      </el-tooltip>
      <span class="win-deco"><el-icon :size="13"><Monitor /></el-icon></span>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--mx-titlebar-h);
  background: var(--mx-titlebar-bg);
  color: var(--mx-titlebar-fg);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
}
.titlebar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  -webkit-app-region: no-drag;
}
.app-logo {
  display: flex;
  align-items: center;
}
.menus {
  display: flex;
  gap: 2px;
}
.menu-btn {
  background: none;
  border: none;
  color: var(--mx-titlebar-fg);
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.menu-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.titlebar-center {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: #b9c4da;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.titlebar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.win-btn {
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
.win-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.win-deco {
  display: flex;
  align-items: center;
  padding: 0 6px;
  color: #7d8cab;
}
</style>