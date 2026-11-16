<script setup lang="ts">
// Home：动作卡 + 最近工程（localStorage）+ 工程配置导入
import { computed, ref } from 'vue'
import { Cpu, Folder, FolderOpened, Search, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '@/controllers/project'
import { listDevices } from '@/model/device'
import { parseProjectFile, readFileAsText } from '@/services/projectFile'

const store = useProjectStore()
const search = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

const devices = computed(() =>
  listDevices().filter((d) => d.chip.toLowerCase().includes(search.value.toLowerCase())),
)

function newProject(chip: string) {
  store.switchDevice(chip)
  store.setView('pinout')
  store.notify(`已创建 ${chip} 工程`, 'info')
}

function openProject() {
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

/** 导入 cube.json：解析 → 切换芯片并载入配置 → 跳到 Pinout。 */
async function importProjectFile(file: File) {
  if (importing.value) return
  importing.value = true
  try {
    const result = parseProjectFile(await readFileAsText(file))
    if ('error' in result) {
      ElMessage.error(result.error)
      return
    }
    // 先 switchDevice 清理旧芯片状态，再 loadConfig 写入文件内容
    store.switchDevice(result.config.chip)
    store.loadConfig(result.config)
    store.setView('pinout')
    const text = `已导入 ${result.config.projectName}（${result.config.chip}）`
    store.notify(text, 'info')
    ElMessage.success(text)
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
        <button class="action-card yellow" @click="newProject('CH32V003F4P6')">
          <el-icon :size="30"><Cpu /></el-icon>
          <span class="action-title">从 MCU 开始</span>
          <span class="action-desc">选择芯片，配置引脚与时钟</span>
        </button>
        <button class="action-card yellow disabled" title="即将推出">
          <el-icon :size="30"><Folder /></el-icon>
          <span class="action-title">从开发板开始</span>
          <span class="action-desc">板级预设（即将推出）</span>
        </button>
        <button class="action-card blue" @click="openProject">
          <el-icon :size="30"><FolderOpened /></el-icon>
          <span class="action-title">打开当前工程</span>
          <span class="action-desc">{{ store.projectName }} · {{ store.chip }}</span>
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

      <div class="recent-card mx-card">
        <div class="recent-head">
          <span class="recent-title">可用芯片</span>
          <el-input v-model="search" placeholder="搜索芯片" :prefix-icon="Search" size="small" style="width: 220px" clearable />
        </div>
        <div v-for="d in devices" :key="d.chip" class="recent-row">
          <div class="recent-thumb">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <rect x="8" y="8" width="24" height="24" rx="4" fill="#173564" />
              <rect x="12" y="12" width="16" height="16" rx="2" fill="#2a62b7" />
            </svg>
          </div>
          <div class="recent-info">
            <div class="recent-name">{{ d.chip }}</div>
            <div class="recent-meta">{{ d.package }} · {{ d.core }} · Flash {{ d.flash }} / SRAM {{ d.sram }}</div>
          </div>
          <el-button type="primary" size="small" @click="newProject(d.chip)">新建工程</el-button>
        </div>
        <div v-if="devices.length === 0" class="empty-note">没有匹配的芯片</div>
        <p class="import-hint">导出的工程内 cube.json 可随时导入本工具继续配置</p>
      </div>
    </div>
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
.recent-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 8px;
  border-radius: 8px;
}
.recent-row:hover {
  background: var(--mx-accent-soft);
}
.recent-info {
  flex: 1;
}
.recent-name {
  font-weight: 600;
  font-size: 13px;
}
.recent-meta {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.empty-note {
  color: var(--mx-text-muted);
  text-align: center;
  padding: 20px;
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