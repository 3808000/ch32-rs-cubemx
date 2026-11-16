<script setup lang="ts">
// 应用外壳：标题栏 + 标签页条 + 图标栏 + 工作区 + 状态栏
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppShell from './components/AppShell.vue'
import TabStrip from './components/TabStrip.vue'
import IconRail from './components/IconRail.vue'
import StatusBar from './components/StatusBar.vue'
import HomeView from './views/HomeView.vue'
import PinoutView from './views/PinoutView.vue'
import ClockView from './views/ClockView.vue'
import PeripheralsView from './views/PeripheralsView.vue'
import ProjectSettingsView from './views/ProjectSettingsView.vue'
import { useProjectStore } from '@/controllers/project'
import { HAL_REV } from '@/model/codegen/halRev'
import { parseProjectFile, readFileAsText, downloadProjectFile } from '@/services/projectFile'
import { touchRecent, getRecent } from '@/services/recentProjects'

const store = useProjectStore()
const showNotifications = ref(false)
const showAbout = ref(false)
const showShortcuts = ref(false)
const draggingFile = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
/** 当前芯片的文档链接（chip.json.docUrl），缺省回退 WCH 官网首页 */
const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

/** 只有拖入真实文件时才接管事件，避免干扰 Monaco/画布内的文本或元素拖动。 */
function hasFiles(e: DragEvent): boolean {
  return (e.dataTransfer?.files?.length ?? 0) > 0
}

function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  // 阻止浏览器默认「打开文件」行为
  e.preventDefault()
  draggingFile.value = true
}

function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  draggingFile.value = true
}

function onDragLeave(e: DragEvent) {
  // 子元素间移动会连续触发 dragleave/dragenter，仅在真正离开根容器时收起提示
  const related = e.relatedTarget as Node | null
  if (related && (e.currentTarget as HTMLElement).contains(related)) return
  draggingFile.value = false
}

async function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  draggingFile.value = false
  const file = e.dataTransfer?.files[0]
  if (!file) return
  try {
    const result = parseProjectFile(await readFileAsText(file))
    if ('error' in result) {
      ElMessage.error(result.error)
      return
    }
    store.openConfig(result.config)
    touchRecent(result.config)
    ElMessage.success(`已导入 ${result.config.projectName}（${result.config.chip}）`)
  } catch (err) {
    ElMessage.error(`读取工程配置失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

onMounted(() => {
  store.restore()
})

function onMenu(key: string) {
  // Project 菜单
  if (key === 'new-mcu') store.setView('home')
  else if (key === 'open-file') openFilePicker()
  else if (key === 'save') { store.save(); touchRecent(store.config) }
  else if (key === 'save-as') downloadProjectFile(store.config)
  else if (key === 'project-settings') store.setView('project-settings')
  else if (key.startsWith('open-recent:')) {
    const r = getRecent(key.slice('open-recent:'.length))
    if (r) { store.openConfig(r.config); touchRecent(r.config) }
  }
  // View / Help / 其它
  else if (key === 'help' || key === 'about') showAbout.value = true
  else if (key === 'settings' || key === 'preferences' || key === 'shortcuts') showShortcuts.value = true
  else if (key === 'documentation') window.open(docUrl.value, '_blank', 'noopener')
  else if (key === 'project') store.setView('project-settings')
}

function openFilePicker() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const result = parseProjectFile(await readFileAsText(file))
    if ('error' in result) { ElMessage.error(result.error); return }
    store.openConfig(result.config)
    touchRecent(result.config)
    ElMessage.success(`已导入 ${result.config.projectName}（${result.config.chip}）`)
  } catch (err) {
    ElMessage.error(`读取工程配置失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    store.save()
    touchRecent(store.config)
  }
  if (e.key === '?' && !(e.target instanceof HTMLInputElement)) {
    showShortcuts.value = !showShortcuts.value
  }
}
</script>

<template>
  <div
    class="app"
    :class="{ 'drop-active': draggingFile }"
    @keydown="onKeydown"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <AppShell @menu="onMenu" />
    <input ref="fileInput" type="file" accept=".json,.cube.json,application/json" style="display: none" @change="onFileChange" />
    <TabStrip />
    <div class="app-body">
      <IconRail @action="onMenu" />
      <main class="workspace">
        <HomeView v-if="store.activeView === 'home'" />
        <PinoutView v-else-if="store.activeView === 'pinout'" />
        <ClockView v-else-if="store.activeView === 'clock'" />
        <PeripheralsView v-else-if="store.activeView === 'peripherals'" />
        <ProjectSettingsView v-else-if="store.activeView === 'project-settings'" />
      </main>
    </div>
    <StatusBar @notifications="showNotifications = true" />

    <!-- 拖拽导入提示（pointer-events:none 不影响 drop 落在根容器） -->
    <div v-if="draggingFile" class="drop-mask" aria-hidden="true">
      <div class="drop-mask-inner">松开以导入工程配置（cube.json）</div>
    </div>

    <!-- 通知抽屉 -->
    <el-drawer v-model="showNotifications" title="通知与问题" size="380px" :append-to-body="true">
      <div v-if="store.conflicts.length === 0 && store.notifications.length === 0" class="empty-note">
        暂无通知，配置无冲突。
      </div>
      <div v-for="c in store.conflicts" :key="c.code + c.message" class="conflict-item" :class="c.level">
        <span class="conflict-code">{{ c.code }}</span>
        <span>{{ c.message }}</span>
      </div>
      <div v-for="n in store.notifications" :key="n.id" class="conflict-item" :class="n.level === 'error' ? 'error' : 'warning'">
        {{ n.text }}
      </div>
    </el-drawer>

    <!-- 关于/帮助 -->
    <el-dialog v-model="showAbout" title="关于 ch32-rs-CubeMX" width="480px">
      <p>纯本地 CH32 RISC-V 引脚/时钟/外设配置器，一键生成可编译的 <code>ch32-hal</code> Rust 工程。</p>
      <p class="muted">HAL 锁定 rev：<code>{{ HAL_REV.slice(0, 12) }}</code></p>
      <p class="muted">
        当前芯片：<code>{{ store.deviceData.chip.chip }}</code>
        <a class="about-link" :href="docUrl" target="_blank" rel="noopener">Open documentation</a>
      </p>
      <p class="muted">技术栈：Vue 3 + Pinia + Element Plus + Monaco + EJS + JSZip</p>
    </el-dialog>

    <!-- 快捷键 -->
    <el-dialog v-model="showShortcuts" title="快捷键" width="420px">
      <table class="shortcut-table">
        <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>保存工程</td></tr>
        <tr><td><kbd>?</kbd></td><td>打开/关闭快捷键面板</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>取消选中引脚</td></tr>
      </table>
    </el-dialog>
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.drop-mask {
  position: absolute;
  inset: 8px;
  z-index: 3000;
  border: 3px dashed var(--mx-accent);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.drop-mask-inner {
  background: var(--mx-surface);
  border: 1px solid var(--mx-accent);
  color: var(--mx-accent);
  padding: 10px 18px;
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  font-weight: 600;
}
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 视图切换：根视图挂载时 140ms 淡入 + 4px 上移（v-if 切换即重新挂载） */
.workspace > * {
  animation: view-in var(--mx-dur-view) var(--mx-ease-out);
}
@keyframes view-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.empty-note {
  color: var(--mx-text-muted);
  text-align: center;
  padding: 24px;
}
.conflict-item {
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.conflict-item.error {
  background: #fde7e7;
  color: var(--mx-error);
}
.conflict-item.warning {
  background: #fff4e0;
  color: var(--mx-warning);
}
.conflict-item.info {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.conflict-code {
  font-family: var(--mx-font-mono);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.muted {
  color: var(--mx-text-muted);
  font-size: 12px;
}
.about-link {
  margin-left: 8px;
  color: var(--mx-accent);
  text-decoration: none;
}
.about-link:hover {
  text-decoration: underline;
}
.shortcut-table {
  width: 100%;
  border-collapse: collapse;
}
.shortcut-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--mx-border);
}
kbd {
  background: #f2f5fa;
  border: 1px solid var(--mx-border);
  border-radius: 4px;
  padding: 1px 6px;
  font-family: var(--mx-font-mono);
  font-size: 12px;
}
</style>