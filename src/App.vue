<script setup lang="ts">
// 应用外壳：标题栏 +（图标栏 | 标签页条 + 工作区）+ 状态栏（M10.1a 对齐 MX2 左栏贯通布局）
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheck, CircleCloseFilled, InfoFilled, WarningFilled } from '@element-plus/icons-vue'
import type { Conflict } from '@/model/types'
import { getPreference, setPreference, type InboxTab } from '@/services/uiPreferences'
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
import { startAutosave } from '@/services/projectStorage'
import { useHistory } from '@/components/common/useHistory'

const store = useProjectStore()
// 全局 Undo/Redo（M6）：全应用只在此挂载一次（每次调用都会新建独立栈）；
// 快捷键 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 由 composable 内部注册，按钮经 AppShell 展示。
const { canUndo, canRedo, undo, redo } = useHistory()
const showInbox = ref(false)
/** 问题/通知抽屉的当前标签（M5：持久化到 uiPreferences）。 */
const inboxTab = ref<InboxTab>(getPreference('inbox.tab'))
/** 标签页健康徽标开关（M5：持久化并下发给 TabStrip）。 */
const healthBadges = ref(getPreference('tabs.healthBadges'))
/** 最后已读通知 id（铃铛未读数由此水位计算）。 */
const lastReadId = ref<number | null>(getPreference('notifications.lastReadId'))
const showAbout = ref(false)
const showShortcuts = ref(false)
const draggingFile = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
/** 当前芯片的文档链接（chip.json.docUrl），缺省回退 WCH 官网首页 */
const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

// ---------------- Problems / Notifications 分离（M5） ----------------

/** 时钟树问题：无 pins/peripheral 时点击定位到 Clock 视图。 */
const CLOCK_CONFLICT_CODES = new Set<Conflict['code']>([
  'CLOCK_PRESET_UNAVAILABLE',
  'PERIPHERAL_CLOCK_INVALID',
  'SPECIAL_PIN_OSC',
])

/** 芯片/工程级问题：点击定位到 Project settings。 */
const DEVICE_CONFLICT_CODES = new Set<Conflict['code']>([
  'TARGET_FEATURE_UNSUPPORTED',
  'SRAM_BUDGET_EXCEEDED',
])

/** Problems 面板按 error / warning 分组（空组不渲染）。 */
const problemGroups = computed(() => {
  const errors = store.conflicts.filter((c) => c.level === 'error')
  const warnings = store.conflicts.filter((c) => c.level === 'warning')
  return [
    { level: 'error' as const, title: '错误', items: errors },
    { level: 'warning' as const, title: '警告', items: warnings },
  ].filter((group) => group.items.length > 0)
})

/** Notifications 面板最新在上。 */
const notificationsNewestFirst = computed(() => [...store.notifications].reverse())

/** 最新一条通知 id；同长度但内容变化（达到 50 条上限后 shift）也能触发 watcher。 */
const latestNotificationId = computed(
  () => store.notifications[store.notifications.length - 1]?.id ?? null,
)

/** 铃铛未读数：从最后已读通知之后开始计数；水位丢失时视为全部未读。 */
const unreadNotifications = computed(() => {
  const list = store.notifications
  if (lastReadId.value === null) return list.length
  const index = list.findIndex((n) => n.id === lastReadId.value)
  return index < 0 ? list.length : list.length - index - 1
})

function markNotificationsRead() {
  const latest = latestNotificationId.value
  if (latest === null || latest === lastReadId.value) return
  lastReadId.value = latest
  setPreference('notifications.lastReadId', latest)
}

function openProblems() {
  inboxTab.value = 'problems'
  showInbox.value = true
}

function openNotifications() {
  inboxTab.value = 'notifications'
  showInbox.value = true
  markNotificationsRead()
}

/** 冲突是否可定位（无目标的问题保持可读但不可跳转）。 */
function canLocateConflict(conflict: Conflict): boolean {
  return Boolean(
    conflict.pins?.length ||
      conflict.peripheral ||
      CLOCK_CONFLICT_CODES.has(conflict.code) ||
      DEVICE_CONFLICT_CODES.has(conflict.code),
  )
}

/** 点击问题定位：引脚 → Pinout；外设 → 对应对象页；时钟/工程级 → 固定视图。 */
function locateConflict(conflict: Conflict) {
  if (conflict.pins?.length) {
    store.selectPin(conflict.pins[0])
    store.setView('pinout')
  } else if (conflict.peripheral) {
    store.openPeripheral(conflict.peripheral)
  } else if (CLOCK_CONFLICT_CODES.has(conflict.code)) {
    store.setView('clock')
  } else if (DEVICE_CONFLICT_CODES.has(conflict.code)) {
    store.setView('project-settings')
  } else {
    return
  }
  showInbox.value = false
}

watch(inboxTab, (tab) => setPreference('inbox.tab', tab))
watch(healthBadges, (enabled) => setPreference('tabs.healthBadges', enabled))
// 打开通知标签或收到新通知时推进已读水位（Problems 标签不影响通知未读）。
watch([showInbox, inboxTab, latestNotificationId], () => {
  if (showInbox.value && inboxTab.value === 'notifications') markNotificationsRead()
})

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
  // M10：恢复成功 = 已打开工程，回到 Pinout 旧 UX；无存档则保持 Home 空态
  // （restore 内部 loadConfig 已置 projectOpened，故此处 setView 不会被守卫拦下）。
  if (store.restore()) store.setView('pinout')
  // 应用级自动保存（M4.1）：dirty 变化 2s 防抖写 localStorage；服务层幂等，HomeView 重复挂载无副作用。
  startAutosave(
    () => store.config,
    () => store.dirty,
    { onSaved: (at) => { store.dirty = false; store.lastSavedAt = at } },
  )
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
    <AppShell
      :can-undo="canUndo"
      :can-redo="canRedo"
      @undo="undo"
      @redo="redo"
      @menu="onMenu"
    />
    <input ref="fileInput" type="file" accept=".json,.cube.json,application/json" style="display: none" @change="onFileChange" />
    <!-- M10 对照原版特写修正：标签底板全宽（藏青覆盖左栏上方），左栏白底自标签栏下方开始；
         首标签缩进左栏宽度（TabStrip padding-left），标签不与左栏列相交 -->
    <TabStrip :health-badges="healthBadges" />
    <div class="app-body">
      <IconRail @action="onMenu" />
      <main class="workspace">
        <HomeView v-if="store.activeView === 'home'" />
        <PinoutView v-else-if="store.activeView === 'pinout'" />
        <ClockView v-else-if="store.activeView === 'clock'" />
        <PeripheralsView v-else-if="store.activeView === 'peripherals'" />
        <ProjectSettingsView v-else-if="store.activeView === 'project-settings'" />
        <!-- 文档模型：所有标签都关闭（activeView=null）时显示占位 -->
        <div v-else class="workspace-empty">没有打开的标签页——从左侧图标栏或菜单打开视图</div>
      </main>
    </div>
    <StatusBar
      :unread-notifications="unreadNotifications"
      @problems="openProblems"
      @notifications="openNotifications"
    />

    <!-- 拖拽导入提示（pointer-events:none 不影响 drop 落在根容器） -->
    <div v-if="draggingFile" class="drop-mask" aria-hidden="true">
      <div class="drop-mask-inner">松开以导入工程配置（cube.json）</div>
    </div>

    <!-- 问题 / 通知抽屉（M5）：两个标签分离，问题可定位，通知保留历史 -->
    <el-drawer v-model="showInbox" title="问题与通知" size="420px" :append-to-body="true">
      <div class="inbox-body">
        <el-tabs v-model="inboxTab" class="inbox-tabs">
          <el-tab-pane name="problems">
            <template #label>
              <span class="inbox-tab-label">
                问题 <span class="inbox-tab-count">{{ store.conflicts.length }}</span>
              </span>
            </template>
            <div class="pane-head">
              <span class="pane-title">配置检查</span>
              <span class="pane-hint">点击可定位到引脚 / 外设</span>
            </div>
            <div v-if="store.conflicts.length === 0" class="empty-note ok">
              <el-icon :size="16"><CircleCheck /></el-icon>
              <span>配置无冲突。</span>
            </div>
            <template v-else>
              <div v-for="group in problemGroups" :key="group.level" class="problem-group">
                <div class="problem-group-title" :class="group.level">
                  {{ group.title }}（{{ group.items.length }}）
                </div>
                <button
                  v-for="c in group.items"
                  :key="`${c.code}:${c.message}`"
                  type="button"
                  class="problem-row"
                  :class="[c.level, { locatable: canLocateConflict(c) }]"
                  :title="canLocateConflict(c) ? '点击定位问题' : '该问题没有可定位对象'"
                  @click="locateConflict(c)"
                >
                  <el-icon :size="13">
                    <CircleCloseFilled v-if="c.level === 'error'" />
                    <WarningFilled v-else />
                  </el-icon>
                  <span class="problem-code">{{ c.code }}</span>
                  <span class="problem-msg">{{ c.message }}</span>
                </button>
              </div>
            </template>
          </el-tab-pane>

          <el-tab-pane name="notifications">
            <template #label>
              <span class="inbox-tab-label">
                通知 <span class="inbox-tab-count">{{ store.notifications.length }}</span>
              </span>
            </template>
            <div class="pane-head">
              <span class="pane-title">历史通知</span>
              <span class="pane-hint">最新在上，最多保留 50 条</span>
            </div>
            <div v-if="store.notifications.length === 0" class="empty-note">暂无通知。</div>
            <div
              v-for="n in notificationsNewestFirst"
              :key="n.id"
              class="notification-row"
              :class="n.level"
            >
              <el-icon :size="14">
                <CircleCloseFilled v-if="n.level === 'error'" />
                <WarningFilled v-else-if="n.level === 'warning'" />
                <InfoFilled v-else />
              </el-icon>
              <span class="notification-text">{{ n.text }}</span>
            </div>
          </el-tab-pane>
        </el-tabs>

        <div class="inbox-footer">
          <div class="inbox-pref-copy">
            <span>标签健康徽标</span>
            <span class="inbox-pref-hint">在 Pinout / Clock / 外设标签显示错误·警告圆点</span>
          </div>
          <el-switch v-model="healthBadges" size="small" />
        </div>
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
        <tbody>
          <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>保存工程</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Tab</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd></td><td>切换下一个 / 上一个视图</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>W</kbd> 或 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd></td><td>关闭外设对象页</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>取消选中引脚（输入框 / 弹窗内不触发）</td></tr>
          <tr><td><kbd>?</kbd></td><td>打开 / 关闭快捷键面板</td></tr>
        </tbody>
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 文档模型空工作区：所有标签关闭后的居中提示 */
.workspace-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mx-text-muted);
  font-size: 13px;
  background: var(--mx-surface);
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
  font-size: 13px;
}
.empty-note.ok {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--mx-success);
}
/* 抽屉内两标签 + 底部偏好开关：内容区独立滚动，footer 常驻 */
.inbox-body {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.inbox-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.inbox-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inbox-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.inbox-tab-count {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: #e9edf5;
  color: var(--mx-text-secondary);
  font-size: 10px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pane-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 2px 10px;
}
.pane-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.pane-hint {
  font-size: 11px;
  color: var(--mx-text-muted);
}
.problem-group {
  margin-bottom: 12px;
}
.problem-group-title {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 6px;
}
.problem-group-title.error {
  color: var(--mx-error);
}
.problem-group-title.warning {
  color: var(--mx-warning);
}
.problem-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: default;
}
.problem-row.locatable {
  cursor: pointer;
}
.problem-row.locatable:hover {
  background: var(--mx-accent-soft);
}
.problem-row.error {
  color: var(--mx-error);
}
.problem-row.warning {
  color: var(--mx-warning);
}
.problem-code {
  font-family: var(--mx-font-mono);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}
.problem-msg {
  color: var(--mx-text-secondary);
  line-height: 1.5;
}
.notification-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.notification-row.warning {
  background: #fff4e0;
  color: var(--mx-warning);
}
.notification-row.error {
  background: #fde7e7;
  color: var(--mx-error);
}
.notification-text {
  color: var(--mx-text-secondary);
  line-height: 1.5;
}
.inbox-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--mx-border);
  margin-top: 8px;
  padding: 12px 2px 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.inbox-pref-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.inbox-pref-hint {
  font-size: 11px;
  color: var(--mx-text-muted);
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