<script setup lang="ts">
// Home：动作卡 + 工程库/最近工程（localStorage）+ 工程配置导入 + 自动保存挂载
import { computed, onMounted, ref } from 'vue'
import {
  Clock,
  Close,
  Cpu,
  Delete,
  EditPen,
  FolderOpened,
  Plus,
  Upload,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ChipPicker from '@/components/home/ChipPicker.vue'
import CreateProjectWizard, {
  type CreateProjectPayload,
} from '@/components/home/CreateProjectWizard.vue'
import { useProjectStore } from '@/controllers/project'
import { isDesktopApp, readTextFileNative } from '@/services/desktop'
import { parseProjectFile, readFileAsText } from '@/services/projectFile'
import {
  getLibrary,
  getRecent,
  joinFsPath,
  libraryProjectId,
  LibraryConflictError,
  listLibrary,
  listLibraryDisk,
  listRecent,
  listRecentDisk,
  projectDirName,
  removeLibrary,
  removeLibraryDisk,
  removeRecent,
  removeRecentDisk,
  renameLibrary,
  renameLibraryDisk,
  saveToLibrary,
  touchRecent,
  touchRecentDisk,
  type DiskProjectEntry,
} from '@/services/recentProjects'
import {
  AUTOSAVE_DEBOUNCE_MS,
  currentProjectDir as activeProjectDir,
  saveProjectToDisk,
  setCurrentProjectDir,
  setProjectSaveErrorHandler,
  startAutosave,
} from '@/services/projectStorage'

/** 工程库/最近工程卡片视图模型：浏览器 localStorage 与桌面索引统一渲染。 */
interface ProjectCard {
  id: string
  projectName: string
  chip: string
  updatedAt: number
  /** 桌面端磁盘工程目录（浏览器为空） */
  dir?: string
}

const store = useProjectStore()
const isDesktop = isDesktopApp()
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const recentProjects = ref<ProjectCard[]>([])
const libraryProjects = ref<ProjectCard[]>([])

// 工程库保存/重命名对话框
const showSaveLibrary = ref(false)
const libraryName = ref('')
const savingLibrary = ref(false)
const showRenameLibrary = ref(false)
const renameId = ref('')
const renameOldName = ref('')
const renameName = ref('')

/** 自动保存状态文案（M4.1）：dirty 时提示等待，保存后显示时刻。 */
const autosaveStatus = computed(() => {
  if (store.dirty) return '等待自动保存…'
  if (store.lastSavedAt) return `已保存 ${formatClock(store.lastSavedAt)}`
  return '自动保存已开启'
})
const autosaveHint = isDesktop
  ? `配置变更后约 ${AUTOSAVE_DEBOUNCE_MS / 1000} 秒自动写入当前工程目录的 cube.json（未绑定目录时跳过）`
  : `配置变更后约 ${AUTOSAVE_DEBOUNCE_MS / 1000} 秒自动写入浏览器 localStorage`

// HomeView 由 v-if 控制，每次回到 Home 都会重新挂载并刷新列表。
// 自动保存订阅跨视图存活：startAutosave 幂等，组件卸载时不 stop（否则离开 Home 即失效）。
onMounted(() => {
  void refreshLists()
  // 磁盘异步写失败（目录不可写/索引损坏等）统一回到 store 通知
  setProjectSaveErrorHandler((e) => store.notify(`工程保存失败：${errorText(e)}`, 'error'))
  startAutosave(() => store.config, () => store.dirty, {
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    onSaved: (at) => {
      // 与控制器 save() 语义一致：自动落盘后清除 dirty 并记录时间。
      // 服务层不直接依赖 store，由接线方同步状态。
      store.$patch({ dirty: false, lastSavedAt: at })
    },
    onError: (e) => {
      store.notify(`自动保存失败：${errorText(e)}`, 'error')
    },
  })
})

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function toCard(entry: DiskProjectEntry): ProjectCard {
  return {
    id: entry.id,
    projectName: entry.name,
    chip: entry.chip,
    updatedAt: entry.updatedAt,
    dir: entry.dir,
  }
}

/** 刷新工程库/最近工程：桌面端异步读磁盘索引，浏览器读 localStorage（同步）。 */
async function refreshLists(): Promise<void> {
  if (isDesktop) {
    try {
      const [library, recent] = await Promise.all([listLibraryDisk(), listRecentDisk()])
      libraryProjects.value = library.map(toCard)
      recentProjects.value = recent.map(toCard)
    } catch (e) {
      ElMessage.error(`读取磁盘工程库失败：${errorText(e)}`)
    }
    return
  }
  recentProjects.value = listRecent()
  libraryProjects.value = listLibrary()
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 本地日期。 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (!Number.isFinite(diff) || diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(ts).toLocaleDateString()
}

/** 本地时刻（HH:mm:ss），自动保存状态用。 */
function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** 桌面端打开磁盘工程：读 cube.json → 解析 → openConfig → 刷新最近使用时间。 */
async function openDiskProject(card: ProjectCard): Promise<void> {
  if (!card.dir) {
    ElMessage.warning('该工程缺少磁盘目录信息')
    await refreshLists()
    return
  }
  try {
    const result = parseProjectFile(await readTextFileNative(joinFsPath(card.dir, 'cube.json')))
    if ('error' in result) {
      ElMessage.error(result.error)
      return
    }
    setCurrentProjectDir(card.dir)
    // openConfig → loadConfig 置 projectOpened 并跳转 Pinout
    store.openConfig(result.config)
    await touchRecentDisk(card.id)
    await refreshLists()
    ElMessage.success(`已打开 ${result.config.projectName}（${result.config.chip}）`)
  } catch (e) {
    ElMessage.error(`打开工程失败：${errorText(e)}`)
  }
}

/** 打开最近工程：桌面端走磁盘索引，浏览器重新读取完整 config。 */
async function openRecentProject(id: string): Promise<void> {
  if (isDesktop) {
    const recent = recentProjects.value.find((r) => r.id === id)
    if (!recent) {
      await refreshLists()
      ElMessage.warning('该最近工程已被移除')
      return
    }
    await openDiskProject(recent)
    return
  }
  const recent = getRecent(id)
  if (!recent) {
    await refreshLists()
    ElMessage.warning('该最近工程已被移除')
    return
  }
  store.openConfig(recent.config)
  touchRecent(recent.config)
  await refreshLists()
  ElMessage.success(`已打开 ${recent.projectName}（${recent.chip}）`)
}

/** 从最近列表移除：桌面端只清 lastOpened（保留工程库与磁盘目录）。 */
async function removeRecentProject(id: string): Promise<void> {
  if (isDesktop) await removeRecentDisk(id)
  else removeRecent(id)
  await refreshLists()
}

// ---------- 工程库（M4.1 浏览器版） ----------

/** 打开「保存当前工程到库」对话框，默认填入当前工程名。 */
function openSaveLibraryDialog(): void {
  libraryName.value = store.projectName
  showSaveLibrary.value = true
}

/** 保存当前工程到库：同名（chip+名称）先确认覆盖。 */
async function confirmSaveLibrary(): Promise<void> {
  if (savingLibrary.value) return
  const name = libraryName.value.trim()
  if (!name) {
    ElMessage.warning('请输入工程名称')
    return
  }
  const config = { ...store.config, projectName: name }
  const duplicate = libraryProjects.value.some(
    (p) => p.id === libraryProjectId(config.chip, name),
  )
  if (duplicate) {
    try {
      await ElMessageBox.confirm(
        `工程库中已存在「${name}」（${config.chip}）。覆盖后旧配置不可恢复，是否继续？`,
        '覆盖工程',
        { type: 'warning', confirmButtonText: '覆盖保存', cancelButtonText: '取消' },
      )
    } catch {
      return // 用户取消
    }
  }
  savingLibrary.value = true
  try {
    if (isDesktop) {
      // 桌面端：写当前工程目录（cube.json + 索引）；未绑定目录时提示先打开/新建
      const dir = activeProjectDir()
      if (!dir) {
        ElMessage.warning('当前工程未绑定磁盘目录，请先新建或从工程库打开工程')
        return
      }
      await saveProjectToDisk(config, dir)
    } else {
      saveToLibrary(config, { overwrite: duplicate })
    }
    // 库内名称与当前工程名保持一致（交给自动保存写入单槽/磁盘）
    if (store.projectName !== name) store.setProjectName(name)
    showSaveLibrary.value = false
    await refreshLists()
    ElMessage.success(duplicate ? `已覆盖工程「${name}」` : `已保存工程「${name}」`)
  } catch (e) {
    if (e instanceof LibraryConflictError) ElMessage.warning(e.message)
    else ElMessage.error(`保存到工程库失败：${errorText(e)}`)
  } finally {
    savingLibrary.value = false
  }
}

/** 从工程库打开：桌面端读磁盘 cube.json，浏览器重新读取完整 config。 */
async function openLibraryProject(project: ProjectCard): Promise<void> {
  if (isDesktop) {
    await openDiskProject(project)
    return
  }
  const entry = getLibrary(project.id)
  if (!entry) {
    await refreshLists()
    ElMessage.warning('该工程已从库中移除')
    return
  }
  store.openConfig(entry.config)
  touchRecent(entry.config)
  await refreshLists()
  ElMessage.success(`已打开 ${entry.projectName}（${entry.chip}）`)
}

/** 删除工程库条目：桌面端递归删目录（Rust 路径守卫）+ 索引移除。 */
async function deleteLibraryProject(project: ProjectCard): Promise<void> {
  const target = isDesktop ? '磁盘目录与工程库索引' : '工程库'
  try {
    await ElMessageBox.confirm(
      `从${target}删除「${project.projectName}」（${project.chip}）？此操作不可撤销。`,
      '删除工程',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  try {
    if (isDesktop) await removeLibraryDisk(project.id)
    else removeLibrary(project.id)
    await refreshLists()
    ElMessage.success(`已从工程库删除「${project.projectName}」`)
  } catch (e) {
    ElMessage.error(`删除工程失败：${errorText(e)}`)
  }
}

/** 打开重命名对话框。 */
function openRenameDialog(project: ProjectCard): void {
  renameId.value = project.id
  renameOldName.value = project.projectName
  renameName.value = project.projectName
  showRenameLibrary.value = true
}

/** 重命名工程库条目；若正是当前工程则同步标题栏名称。 */
async function confirmRenameLibrary(): Promise<void> {
  const name = renameName.value.trim()
  if (!name) {
    ElMessage.warning('请输入工程名称')
    return
  }
  try {
    const updated = isDesktop
      ? await renameLibraryDisk(renameId.value, name)
      : renameLibrary(renameId.value, name)
    const updatedName = 'name' in updated ? updated.name : updated.projectName
    if (store.chip === updated.chip && store.projectName === renameOldName.value) {
      store.setProjectName(updatedName)
    }
    showRenameLibrary.value = false
    await refreshLists()
    ElMessage.success(`已重命名工程「${updatedName}」`)
  } catch (e) {
    if (e instanceof LibraryConflictError) ElMessage.warning(e.message)
    else ElMessage.error(`重命名失败：${errorText(e)}`)
  }
}

// ---------- 新建 MCU：两步创建向导（M9，对齐 MX2） ----------
// MCU 卡 / 底部表格 Continue → 打开向导第一步；底部表格选中态受控于 HomeView。
const selectedChip = ref<string | null>(null)
const showCreateWizard = ref(false)
const wizardInitialChip = ref<string | null>(null)

function openCreateWizard(chip: string | null = null) {
  wizardInitialChip.value = chip
  showCreateWizard.value = true
}

/** 底部表格 Continue：带上已选芯片直接打开向导第一步。 */
function openWizardFromPicker(chip: string) {
  openCreateWizard(chip)
}

/**
 * 向导 Create project：纯本地秒建（无联网 setup 步），随后进入 Pinout。
 * 桌面端先落盘 cube.json + 索引，再绑定当前目录并置 projectOpened（空态契约）。
 */
async function createProject(payload: CreateProjectPayload): Promise<void> {
  store.setProjectName(payload.name)
  store.switchDevice(payload.chip)
  if (isDesktop) {
    const location = payload.location?.trim()
    if (!location) {
      ElMessage.error('缺少工程存储位置，请重新选择')
      return
    }
    const dir = joinFsPath(location, projectDirName(payload.name))
    try {
      await saveProjectToDisk(
        { ...store.config, projectName: payload.name, chip: payload.chip },
        dir,
      )
    } catch (e) {
      ElMessage.error(`创建工程失败：${errorText(e)}`)
      return
    }
    setCurrentProjectDir(dir)
  }
  store.markProjectOpened()
  store.setView('pinout')
  store.notify(`已创建 ${payload.name}（${payload.chip}）`, 'info')
  showCreateWizard.value = false
  if (isDesktop) await refreshLists()
}

function openProject() {
  if (!store.projectOpened) return // 空态守卫：没有已打开工程时不跳转
  store.setView('pinout')
}

function pickProjectFile() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 清空 value：同一个文件再次选择时也能触发 change
  input.value = ''
  if (!file) return
  await importProjectFile(file)
}

/** 导入 cube.json：解析 → openConfig（切芯片+载入+跳转，与拖拽导入共用）。 */
async function importProjectFile(file: File) {
  if (importing.value) return
  importing.value = true
  try {
    const result = parseProjectFile(await readFileAsText(file))
    if ('error' in result) {
      ElMessage.error(result.error)
      return
    }
    // 导入的配置没有磁盘工程目录：解绑，避免自动保存覆盖上一个工程
    setCurrentProjectDir(null)
    store.openConfig(result.config)
    touchRecent(result.config)
    if (isDesktop) await refreshLists()
    ElMessage.success(`已导入 ${result.config.projectName}（${result.config.chip}）`)
  } catch (err) {
    ElMessage.error(`读取工程配置失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="home">
    <div class="home-inner">
      <h1 class="home-title">开始你的 CH32 项目</h1>
      <p class="home-sub">纯本地配置器 · 生成可直接 cargo build 的 ch32-hal Rust 工程</p>

      <div class="action-cards">
        <button class="action-card yellow" @click="openCreateWizard()">
          <el-icon :size="30"><Cpu /></el-icon>
          <span class="action-title">从 MCU 开始</span>
          <span class="action-desc">选择芯片 → 填写工程详情，纯本地秒建</span>
        </button>
        <button
          class="action-card blue"
          :class="{ disabled: !store.projectOpened }"
          :disabled="!store.projectOpened"
          :title="store.projectOpened ? '回到当前工程的 Pinout' : '尚未打开工程：请先新建或从工程库打开'"
          @click="openProject"
        >
          <el-icon :size="30"><FolderOpened /></el-icon>
          <span class="action-title">打开当前工程</span>
          <span class="action-desc">
            {{
              store.projectOpened
                ? `${store.projectName} · ${store.chip}`
                : '尚未打开工程，请先新建或从工程库打开'
            }}
          </span>
        </button>
        <button class="action-card blue" :class="{ disabled: importing }" :disabled="importing" @click="pickProjectFile">
          <el-icon :size="30"><Upload /></el-icon>
          <span class="action-title">导入工程配置</span>
          <span class="action-desc">读取 cube.json / .cube.json 继续配置</span>
        </button>
      </div>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".json,.cube.json,application/json"
        @change="onFileChange"
      />

      <!-- 工程库（ROADMAP M4.1 浏览器版）：显式保存/打开/重命名/删除 + 自动保存状态 -->
      <div class="project-library mx-card">
        <div class="recent-head">
          <div class="lib-title-wrap">
            <span class="recent-title">工程库</span>
            <span v-if="libraryProjects.length > 0" class="rp-count">{{ libraryProjects.length }} 个</span>
          </div>
          <div class="lib-head-actions">
            <el-tooltip :content="autosaveHint" placement="top">
              <span class="autosave-badge" :class="{ pending: store.dirty }">
                <el-icon :size="12"><Clock /></el-icon>
                <span>{{ autosaveStatus }}</span>
              </span>
            </el-tooltip>
            <el-button size="small" type="primary" :icon="Plus" @click="openSaveLibraryDialog">
              保存当前工程
            </el-button>
          </div>
        </div>
        <p v-if="isDesktop" class="lib-hint">
          工程保存在本机磁盘 ~/.config/ch32-rs-cubemx/projects/&lt;工程目录&gt;/cube.json，
          索引为同级 projects.json；配置变更后约 {{ AUTOSAVE_DEBOUNCE_MS / 1000 }} 秒自动保存当前工程。
        </p>
        <p v-else class="lib-hint">
          显式保存完整配置到浏览器 localStorage；
          配置变更后约 {{ AUTOSAVE_DEBOUNCE_MS / 1000 }} 秒自动保存当前工程快照。
        </p>
        <div v-if="libraryProjects.length === 0" class="rp-empty">
          <el-icon :size="16"><FolderOpened /></el-icon>
          <span>工程库为空：点击「保存当前工程」把当前配置存入工程库</span>
        </div>
        <div v-else class="rp-grid">
          <div
            v-for="p in libraryProjects"
            :key="p.id"
            class="rp-card"
            role="button"
            tabindex="0"
            :title="`打开 ${p.projectName}（${p.chip}）`"
            @click="openLibraryProject(p)"
            @keydown.enter.prevent="openLibraryProject(p)"
            @keydown.space.prevent="openLibraryProject(p)"
          >
            <div class="rp-top">
              <span class="rp-name">{{ p.projectName }}</span>
              <span class="lib-actions">
                <el-tooltip content="重命名" placement="top">
                  <button
                    class="rp-remove"
                    type="button"
                    aria-label="重命名工程"
                    @click.stop="openRenameDialog(p)"
                  >
                    <el-icon :size="12"><EditPen /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip content="从工程库删除" placement="top">
                  <button
                    class="rp-remove lib-delete"
                    type="button"
                    aria-label="删除工程"
                    @click.stop="deleteLibraryProject(p)"
                  >
                    <el-icon :size="12"><Delete /></el-icon>
                  </button>
                </el-tooltip>
              </span>
            </div>
            <div class="rp-chip">{{ p.chip }}</div>
            <div class="rp-time">
              <el-icon :size="12"><Clock /></el-icon>
              <span>{{ formatRelativeTime(p.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 最近工程（ROADMAP M2.9）：点击重开，右上角可移除 -->
      <div class="recent-projects mx-card">
        <div class="recent-head">
          <span class="recent-title">最近工程</span>
          <span v-if="recentProjects.length > 0" class="rp-count">{{ recentProjects.length }} 个</span>
        </div>
        <div v-if="recentProjects.length === 0" class="rp-empty">
          <el-icon :size="16"><Clock /></el-icon>
          <span>暂无最近工程，新建或导入工程后会出现在这里</span>
        </div>
        <div v-else class="rp-grid">
          <div
            v-for="r in recentProjects"
            :key="r.id"
            class="rp-card"
            role="button"
            tabindex="0"
            :title="`打开 ${r.projectName}（${r.chip}）`"
            @click="openRecentProject(r.id)"
            @keydown.enter.prevent="openRecentProject(r.id)"
            @keydown.space.prevent="openRecentProject(r.id)"
          >
            <div class="rp-top">
              <span class="rp-name">{{ r.projectName }}</span>
              <el-tooltip content="从最近列表移除" placement="top">
                <button
                  class="rp-remove"
                  type="button"
                  aria-label="从最近列表移除"
                  @click.stop="removeRecentProject(r.id)"
                >
                  <el-icon :size="12"><Close /></el-icon>
                </button>
              </el-tooltip>
            </div>
            <div class="rp-chip">{{ r.chip }}</div>
            <div class="rp-time">
              <el-icon :size="12"><Clock /></el-icon>
              <span>{{ formatRelativeTime(r.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 新建 MCU（M9）：底部芯片表选中后 Continue 打开两步创建向导 -->
      <div class="recent-card mx-card">
        <div class="recent-head">
          <span class="recent-title">可用芯片</span>
        </div>
        <ChipPicker v-model="selectedChip" @continue="openWizardFromPicker" />
        <p class="import-hint">导出的工程内 cube.json 可随时导入本工具继续配置</p>
      </div>
    </div>

    <!-- 两步创建向导（M9，对齐 MX2：选芯片 → 工程详情；本地秒建，无联网 setup） -->
    <CreateProjectWizard
      v-model="showCreateWizard"
      :initial-chip="wizardInitialChip"
      @create="createProject"
    />

    <!-- 保存当前工程到库：命名 + 同名覆盖确认 -->
    <el-dialog v-model="showSaveLibrary" title="保存到工程库" width="440px" append-to-body>
      <div class="lib-form">
        <label class="lib-label" for="lib-save-name">工程名称</label>
        <el-input
          id="lib-save-name"
          v-model="libraryName"
          maxlength="60"
          show-word-limit
          placeholder="ch32-project"
          @keyup.enter="confirmSaveLibrary"
        />
        <p v-if="isDesktop" class="lib-form-hint">
          保存当前完整配置到当前工程目录的 cube.json 并刷新磁盘索引；
          同目录重名保存会直接覆盖。
        </p>
        <p v-else class="lib-form-hint">
          保存当前完整配置（引脚 / 时钟 / 外设 / 中断 / DMA）到浏览器 localStorage；
          同名（芯片 + 名称）工程会提示覆盖。
        </p>
      </div>
      <template #footer>
        <el-button @click="showSaveLibrary = false">取消</el-button>
        <el-button type="primary" :loading="savingLibrary" @click="confirmSaveLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重命名工程库条目 -->
    <el-dialog v-model="showRenameLibrary" title="重命名工程" width="420px" append-to-body>
      <div class="lib-form">
        <label class="lib-label" for="lib-rename-name">新名称</label>
        <el-input
          id="lib-rename-name"
          v-model="renameName"
          maxlength="60"
          show-word-limit
          @keyup.enter="confirmRenameLibrary"
        />
        <p class="lib-form-hint">
          仅修改工程库中的名称；若该工程正是当前工程，标题栏名称会同步更新。
          <template v-if="isDesktop">桌面端会同步改写 cube.json 内的 projectName（目录名保持不变）。</template>
        </p>
      </div>
      <template #footer>
        <el-button @click="showRenameLibrary = false">取消</el-button>
        <el-button type="primary" @click="confirmRenameLibrary">重命名</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.home {
  flex: 1;
  overflow: auto;
  padding: 32px 24px;
}
.home-inner {
  max-width: 1100px;
  margin: 0 auto;
}
.home-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 6px;
}
.home-sub {
  color: var(--mx-text-muted);
  margin: 0 0 24px;
}
.action-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.action-card {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-surface);
  box-shadow: var(--mx-shadow-card);
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  text-align: left;
  transition: transform 0.12s, box-shadow 0.12s;
}
.action-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--mx-shadow-popover);
}
.action-card.yellow {
  border-top: 4px solid var(--mx-highlight);
}
.action-card.blue {
  border-top: 4px solid var(--mx-accent);
}
.action-card.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.action-title {
  font-size: 15px;
  font-weight: 600;
}
.action-desc {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.recent-projects {
  padding: 16px 20px;
  margin-bottom: 24px;
}
.project-library {
  padding: 16px 20px;
  margin-bottom: 24px;
}
.lib-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.lib-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.autosave-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--mx-border);
  border-radius: 999px;
  background: var(--mx-bg);
  font-size: 11px;
  color: var(--mx-text-muted);
  white-space: nowrap;
}
.autosave-badge.pending {
  border-color: var(--mx-warning);
  color: var(--mx-warning);
}
.lib-hint {
  margin: -2px 0 12px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--mx-text-muted);
}
.lib-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.lib-actions .rp-remove:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.lib-actions .lib-delete:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--mx-error);
}
.lib-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lib-label {
  font-size: 13px;
  color: var(--mx-text-secondary);
}
.lib-form-hint {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--mx-text-muted);
}
.rp-count {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.rp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 8px;
  color: var(--mx-text-muted);
  font-size: 12px;
}
.rp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.rp-card {
  background: var(--mx-bg);
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, transform 0.12s;
}
.rp-card:hover {
  border-color: var(--mx-accent);
  background: var(--mx-accent-soft);
  transform: translateY(-1px);
}
.rp-card:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}
.rp-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.rp-remove {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--mx-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rp-remove:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--mx-error);
}
.rp-chip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.rp-time {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--mx-text-muted);
}
.recent-card {
  padding: 16px 20px;
}
.recent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.recent-title {
  font-size: 15px;
  font-weight: 600;
}
.file-input {
  display: none;
}
.import-hint {
  margin: 10px 8px 0;
  padding-top: 10px;
  border-top: 1px dashed var(--mx-border);
  font-size: 12px;
  color: var(--mx-text-muted);
}
</style>