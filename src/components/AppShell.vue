<script setup lang="ts">
// 标题栏：应用标识 + 工程/视图/帮助真实下拉菜单 + 工程名·芯片/封装 + 设置/帮助图标按钮。
// 菜单只发射命令 key（由 App.vue onMenu 统一处理）；View 菜单直接切 store.activeView。
import { computed, ref, watch } from 'vue'
import { useProjectStore, type ViewId } from '@/controllers/project'
import { listRecent, type RecentProject } from '@/services/recentProjects'
import { useHotkeys } from '@/components/common/useHotkeys'
import UndoRedoButtons from '@/components/common/UndoRedoButtons.vue'
import {
  ArrowRight,
  Check,
  Clock,
  Connection,
  Cpu,
  Document,
  Download,
  FolderOpened,
  HomeFilled,
  InfoFilled,
  MagicStick,
  Monitor,
  Plus,
  QuestionFilled,
  Reading,
  Setting,
  Timer,
} from '@element-plus/icons-vue'

const store = useProjectStore()
const subtitle = computed(() => `${store.projectName} • ${store.deviceData.chip.chip} / ${store.deviceData.chip.package}`)

// 全局 Undo/Redo 状态由 App.vue 的 useHistory() 单例下发（M6）；本组件只展示与转发。
withDefaults(defineProps<{ canUndo?: boolean; canRedo?: boolean }>(), { canUndo: false, canRedo: false })

const emit = defineEmits<{ (e: 'menu', key: string): void; (e: 'undo'): void; (e: 'redo'): void }>()

// 全局快捷键挂在常驻的标题栏组件上（Ctrl+S 仍由 App.vue 处理）
useHotkeys()

type MenuId = 'project' | 'view' | 'help'
const openMenu = ref<MenuId | null>(null)

/** 每个菜单的 v-model:visible：同一时刻只允许打开一个菜单。 */
function menuVisible(id: MenuId) {
  return computed({
    get: () => openMenu.value === id,
    set: (visible: boolean) => {
      if (visible) openMenu.value = id
      else if (openMenu.value === id) openMenu.value = null
    },
  })
}
const projectOpen = menuVisible('project')
const viewOpen = menuVisible('view')
const helpOpen = menuVisible('help')

// 最近工程：每次打开 Project 菜单时从 localStorage 重新读取，保证列表新鲜
const recentProjects = ref<RecentProject[]>([])
const recentExpanded = ref(false)
watch(projectOpen, (open) => {
  if (!open) return
  recentProjects.value = listRecent()
  recentExpanded.value = false
})

const views: { id: ViewId; label: string; icon: unknown }[] = [
  { id: 'home', label: 'Home', icon: HomeFilled },
  { id: 'pinout', label: 'Pinout', icon: Cpu },
  { id: 'clock', label: 'Clock', icon: Timer },
  { id: 'peripherals', label: 'Peripherals', icon: Connection },
  { id: 'project-settings', label: 'Project settings', icon: Setting },
]

/** 发射菜单命令并收起菜单。 */
function run(key: string): void {
  emit('menu', key)
  openMenu.value = null
}

/** View 菜单直接切视图（App 未接线 pinout/clock/peripherals 视图 key）。 */
function switchView(id: ViewId): void {
  store.setView(id)
  openMenu.value = null
}

function openRecent(id: string): void {
  run(`open-recent:${id}`)
}

/** 点击「最近工程」展开/收起子菜单（hover 由 CSS 处理，兼容触屏）。 */
function toggleRecent(): void {
  if (recentProjects.value.length > 0) recentExpanded.value = !recentExpanded.value
}
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
        <!-- 工程 -->
        <el-popover
          v-model:visible="projectOpen"
          trigger="click"
          placement="bottom-start"
          :width="252"
          :show-arrow="false"
          :offset="8"
          popper-class="mx-menu-popover"
        >
          <template #reference>
            <button class="menu-btn" :class="{ open: projectOpen }" aria-haspopup="menu">工程</button>
          </template>
          <div class="mx-menu" role="menu" aria-label="工程菜单">
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('new-mcu')">
              <el-icon :size="15" class="mx-menu-icon"><Plus /></el-icon>
              <span class="mx-menu-label">从 MCU 新建</span>
            </button>
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('open-file')">
              <el-icon :size="15" class="mx-menu-icon"><FolderOpened /></el-icon>
              <span class="mx-menu-label">从文件系统打开…</span>
            </button>

            <!-- 最近工程子菜单：空则置灰，动态生成 open-recent:<id> -->
            <div
              class="mx-menu-sub"
              :class="{ 'is-open': recentExpanded, 'is-disabled': recentProjects.length === 0 }"
              @mouseleave="recentExpanded = false"
            >
              <button
                class="mx-menu-item"
                role="menuitem"
                type="button"
                aria-haspopup="menu"
                :aria-expanded="recentExpanded"
                :disabled="recentProjects.length === 0"
                @click="toggleRecent"
              >
                <el-icon :size="15" class="mx-menu-icon"><Clock /></el-icon>
                <span class="mx-menu-label">最近工程</span>
                <el-icon :size="12" class="mx-menu-caret"><ArrowRight /></el-icon>
              </button>
              <div class="mx-submenu" role="menu" aria-label="最近工程">
                <div v-if="recentProjects.length === 0" class="mx-menu-empty">暂无最近工程</div>
                <button
                  v-for="r in recentProjects"
                  :key="r.id"
                  class="mx-menu-item mx-recent-item"
                  role="menuitem"
                  type="button"
                  :title="`${r.projectName}（${r.chip}）`"
                  @click="openRecent(r.id)"
                >
                  <span class="mx-recent-main">
                    <span class="mx-recent-name">{{ r.projectName }}</span>
                    <span class="mx-recent-meta">{{ r.chip }}</span>
                  </span>
                </button>
              </div>
            </div>

            <div class="mx-menu-divider" role="separator"></div>
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('save')">
              <el-icon :size="15" class="mx-menu-icon"><Document /></el-icon>
              <span class="mx-menu-label">保存工程</span>
              <span class="mx-menu-key">Ctrl+S</span>
            </button>
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('save-as')">
              <el-icon :size="15" class="mx-menu-icon"><Download /></el-icon>
              <span class="mx-menu-label">另存为…</span>
            </button>
            <div class="mx-menu-divider" role="separator"></div>
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('project-settings')">
              <el-icon :size="15" class="mx-menu-icon"><Setting /></el-icon>
              <span class="mx-menu-label">工程设置</span>
            </button>
          </div>
        </el-popover>

        <!-- 视图 -->
        <el-popover
          v-model:visible="viewOpen"
          trigger="click"
          placement="bottom-start"
          :width="220"
          :show-arrow="false"
          :offset="8"
          popper-class="mx-menu-popover"
        >
          <template #reference>
            <button class="menu-btn" :class="{ open: viewOpen }" aria-haspopup="menu">视图</button>
          </template>
          <div class="mx-menu" role="menu" aria-label="视图菜单">
            <button
              v-for="v in views"
              :key="v.id"
              class="mx-menu-item"
              :class="{ 'is-active': store.activeView === v.id }"
              role="menuitem"
              type="button"
              @click="switchView(v.id)"
            >
              <el-icon :size="15" class="mx-menu-icon"><component :is="v.icon" /></el-icon>
              <span class="mx-menu-label">{{ v.label }}</span>
              <el-icon v-if="store.activeView === v.id" :size="13" class="mx-menu-check"><Check /></el-icon>
            </button>
          </div>
        </el-popover>

        <!-- 帮助 -->
        <el-popover
          v-model:visible="helpOpen"
          trigger="click"
          placement="bottom-start"
          :width="220"
          :show-arrow="false"
          :offset="8"
          popper-class="mx-menu-popover"
        >
          <template #reference>
            <button class="menu-btn" :class="{ open: helpOpen }" aria-haspopup="menu">帮助</button>
          </template>
          <div class="mx-menu" role="menu" aria-label="帮助菜单">
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('about')">
              <el-icon :size="15" class="mx-menu-icon"><InfoFilled /></el-icon>
              <span class="mx-menu-label">关于 ch32-rs-CubeMX</span>
            </button>
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('documentation')">
              <el-icon :size="15" class="mx-menu-icon"><Reading /></el-icon>
              <span class="mx-menu-label">文档</span>
            </button>
            <div class="mx-menu-divider" role="separator"></div>
            <button class="mx-menu-item" role="menuitem" type="button" @click="run('shortcuts')">
              <el-icon :size="15" class="mx-menu-icon"><MagicStick /></el-icon>
              <span class="mx-menu-label">快捷键</span>
              <span class="mx-menu-key">?</span>
            </button>
          </div>
        </el-popover>
      </nav>
    </div>
    <div class="titlebar-center">{{ subtitle }}</div>
    <div class="titlebar-right">
      <UndoRedoButtons :can-undo="canUndo" :can-redo="canRedo" @undo="emit('undo')" @redo="emit('redo')" />
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
.menu-btn.open {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.menu-btn:focus-visible {
  outline: 2px solid var(--mx-highlight);
  outline-offset: 1px;
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

<!-- 下拉菜单内容被 teleport 到 body，样式不能用 scoped；用 popper-class 限定作用域。 -->
<style>
.mx-menu-popover.el-popover.el-popper {
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--mx-border);
  box-shadow: var(--mx-shadow-popover);
}
.mx-menu-popover .mx-menu {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mx-menu-popover .mx-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--mx-text);
  font-family: var(--mx-font);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.mx-menu-popover .mx-menu-item:hover:not(:disabled) {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.mx-menu-popover .mx-menu-item:disabled {
  color: var(--mx-text-muted);
  opacity: 0.6;
  cursor: not-allowed;
}
.mx-menu-popover .mx-menu-item:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}
.mx-menu-popover .mx-menu-icon {
  flex-shrink: 0;
  color: var(--mx-text-muted);
}
.mx-menu-popover .mx-menu-item:hover:not(:disabled) .mx-menu-icon,
.mx-menu-popover .mx-menu-item.is-active .mx-menu-icon {
  color: var(--mx-accent);
}
.mx-menu-popover .mx-menu-label {
  flex: 1;
}
.mx-menu-popover .mx-menu-item.is-active {
  color: var(--mx-accent);
  font-weight: 600;
}
.mx-menu-popover .mx-menu-check {
  color: var(--mx-accent);
}
.mx-menu-popover .mx-menu-key {
  margin-left: 18px;
  color: var(--mx-text-muted);
  font-family: var(--mx-font-mono);
  font-size: 11px;
}
.mx-menu-popover .mx-menu-divider {
  height: 1px;
  margin: 5px 6px;
  background: var(--mx-border);
}
.mx-menu-popover .mx-menu-empty {
  padding: 10px 12px;
  color: var(--mx-text-muted);
  font-size: 12px;
}
/* 最近工程子菜单：hover / focus / 点击展开；作为 popover 内容的子元素不触发点击外关闭 */
.mx-menu-popover .mx-menu-sub {
  position: relative;
}
.mx-menu-popover .mx-menu-caret {
  margin-left: 18px;
  color: var(--mx-text-muted);
  transition: transform 0.12s;
}
.mx-menu-popover .mx-menu-sub:hover > .mx-menu-item .mx-menu-caret,
.mx-menu-popover .mx-menu-sub.is-open > .mx-menu-item .mx-menu-caret {
  transform: rotate(90deg);
}
.mx-menu-popover .mx-submenu {
  display: none;
  position: absolute;
  top: -6px;
  left: calc(100% + 4px);
  z-index: 1;
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: 10px;
  box-shadow: var(--mx-shadow-popover);
}
.mx-menu-popover .mx-menu-sub:hover > .mx-submenu,
.mx-menu-popover .mx-menu-sub:focus-within > .mx-submenu,
.mx-menu-popover .mx-menu-sub.is-open > .mx-submenu {
  display: block;
}
.mx-menu-popover .mx-recent-item {
  height: auto;
  padding: 7px 10px;
}
.mx-menu-popover .mx-recent-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mx-menu-popover .mx-recent-name {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
}
.mx-menu-popover .mx-recent-meta {
  color: var(--mx-text-muted);
  font-size: 11px;
}
</style>