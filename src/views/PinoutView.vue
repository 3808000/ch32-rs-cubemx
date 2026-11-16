<script setup lang="ts">
// Pinout 视图：页头 + 工具栏 + 分段控件 + 封装图/表格 + Detail view + Code preview
import { computed, ref } from 'vue'
import { Document, RefreshLeft, Search, Download } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import PackageCanvas from '../components/PackageCanvas.vue'
import PinTable from '../components/PinTable.vue'
import PinConfigPanel from '../components/PinConfigPanel.vue'
import ConflictsPanel from '../components/ConflictsPanel.vue'
import CodePreviewPanel from '../components/CodePreviewPanel.vue'
import CodegenDialog from '../components/CodegenDialog.vue'
import { usePinOverwrite, clearUndo } from '@/model/pins/pinOverwrite'

const store = useProjectStore()
const { undo } = usePinOverwrite()
const showExport = ref(false)

const viewMode = ref<'graphic' | 'table'>('graphic')
const showDetail = ref(true)
const showCode = ref(false)
const search = ref('')
/** Show 下拉（保持原有占位选项） */
const showFilter = ref('All')
/** Type 下拉：按 pin.type 过滤封装图与表格 */
const typeFilter = ref<'All' | 'IO' | 'POWER' | 'NC'>('All')

const filterTypes = computed<string[] | undefined>(() => (typeFilter.value === 'All' ? undefined : [typeFilter.value]))

const ioCount = computed(() => store.deviceData.chip.pins.filter((p) => p.type === 'IO').length)
const typeFilterCount = computed(() => {
  const pins = store.deviceData.chip.pins
  return typeFilter.value === 'All' ? pins.length : pins.filter((p) => p.type === typeFilter.value).length
})
const configuredCount = computed(() => store.assignments.length)

function resetPinout() {
  store.resetPinout()
  // Reset 是破坏性批量操作：清空撤回栈，避免撤回恢复出与 unlocked 不一致的旧配置
  clearUndo()
  store.notify('配置已重置', 'info')
}

function exportPins() {
  const lines = ['number,name,mode,function,remap,label']
  for (const p of store.deviceData.chip.pins) {
    const a = store.assignmentOf(p.name)
    lines.push([p.number, p.name, a?.mode ?? '', a?.function ?? '', a?.remap ?? '', a?.label ?? ''].join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a')
  el.href = url
  el.download = `${store.chip}-pinout.csv`
  el.click()
  URL.revokeObjectURL(url)
}

const filteredAssignments = computed(() => {
  if (!search.value) return store.assignments
  const q = search.value.toLowerCase()
  return store.assignments.filter((a) => a.pin.toLowerCase().includes(q) || (a.function ?? '').toLowerCase().includes(q) || (a.label ?? '').toLowerCase().includes(q))
})
</script>

<template>
  <div class="pinout-view">
    <!-- 页头 -->
    <div class="page-head">
      <div>
        <h1 class="page-title">Pinout</h1>
        <div class="page-sub">{{ store.deviceData.chip.chip }} {{ store.deviceData.chip.package }}</div>
      </div>
      <a class="doc-link" href="https://www.wch.cn/products/CH32V003.html" target="_blank" rel="noopener">
        <el-icon :size="13"><Document /></el-icon> Open documentation
      </a>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input v-model="search" placeholder="搜索" :prefix-icon="Search" size="small" style="width: 180px" clearable />
      <div class="filter-item">
        <span class="filter-label">Show</span>
        <el-select v-model="showFilter" size="small" style="width: 80px">
          <el-option label="All" value="All" />
          <el-option label="IO" value="IO" />
          <el-option label="POWER" value="POWER" />
        </el-select>
        <span class="filter-count">{{ ioCount }}</span>
      </div>
      <div class="filter-item">
        <span class="filter-label">Type</span>
        <el-select v-model="typeFilter" size="small" style="width: 90px">
          <el-option label="All" value="All" />
          <el-option label="IO" value="IO" />
          <el-option label="POWER" value="POWER" />
          <el-option label="NC" value="NC" />
        </el-select>
        <span class="filter-count">{{ typeFilterCount }}</span>
      </div>
      <div class="filter-item">
        <span class="filter-label">已配置</span>
        <span class="filter-count">{{ configuredCount }}</span>
      </div>
      <div class="toolbar-fill"></div>
      <el-button size="small" @click="undo">撤回</el-button>
      <el-button size="small" @click="exportPins">Export pin…</el-button>
      <el-button size="small" type="primary" :icon="Download" @click="showExport = true">导出工程</el-button>
      <el-button size="small" type="primary" :icon="RefreshLeft" @click="resetPinout">Reset pinout</el-button>
    </div>

    <CodegenDialog v-model="showExport" />

    <!-- 分段控件 + 右侧面板开关 -->
    <div class="view-controls">
      <div class="segmented">
        <button class="seg-btn" :class="{ active: viewMode === 'graphic' }" @click="viewMode = 'graphic'">Graphic view</button>
        <button class="seg-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">Table view</button>
      </div>
      <div class="toolbar-fill"></div>
      <el-button size="small" :type="showCode ? 'primary' : 'default'" @click="showCode = !showCode">&lt;/&gt; Code preview</el-button>
      <el-button size="small" :type="showDetail ? 'primary' : 'default'" @click="showDetail = !showDetail">Detail view</el-button>
    </div>

    <!-- 工作区 -->
    <div class="work-area">
      <PackageCanvas
        v-if="viewMode === 'graphic'"
        :chip="store.deviceData.chip"
        :assignments="filteredAssignments"
        :conflicts="store.conflicts"
        :selected-pin="store.selectedPin"
        :filter-types="filterTypes"
        @select="store.selectPin"
        @configure="store.selectPin"
      />
      <PinTable v-else :filter-types="filterTypes" />

      <div v-if="showDetail" class="detail-col">
        <PinConfigPanel />
        <div class="conflicts-section">
          <div class="conflicts-head">冲突检查</div>
          <ConflictsPanel />
        </div>
      </div>

      <CodePreviewPanel v-if="showCode" context="pinout" />
    </div>
  </div>
</template>

<style scoped>
.pinout-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 14px 20px 8px;
}
.page-title {
  font-size: var(--mx-fz-page-title);
  font-weight: 600;
  margin: 0;
}
.page-sub {
  font-size: 12px;
  color: var(--mx-text-muted);
  margin-top: 2px;
}
.doc-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--mx-accent);
  text-decoration: none;
}
.doc-link:hover {
  text-decoration: underline;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 20px;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label {
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.filter-count {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.toolbar-fill {
  flex: 1;
}
.view-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 20px 10px;
}
.segmented {
  display: flex;
  background: transparent;
  border-radius: 0;
  padding: 0;
}
.seg-btn {
  border: none;
  background: transparent;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--mx-text-secondary);
  cursor: pointer;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  position: relative;
  /* 分段切换：颜色/下划线 140ms 过渡（与视图切换节奏一致） */
  transition:
    color var(--mx-dur-view) var(--mx-ease-out),
    background-color var(--mx-dur-view) var(--mx-ease-out),
    border-color var(--mx-dur-view) var(--mx-ease-out);
}
.seg-btn.active {
  background: var(--mx-surface);
  color: var(--mx-accent);
  font-weight: 600;
  border-bottom: 2px solid var(--mx-accent);
}
.work-area {
  flex: 1;
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--mx-border);
}
.detail-col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-left: 1px solid var(--mx-border);
  max-height: 100%;
}
.detail-col :deep(.pin-panel) {
  border-left: none;
  flex: 1;
  min-height: 0;
}
.conflicts-section {
  border-top: 1px solid var(--mx-border);
  max-height: 240px;
  overflow-y: auto;
  background: var(--mx-surface);
  width: var(--mx-detail-panel-w);
}
.conflicts-head {
  font-size: 12px;
  font-weight: 600;
  padding: 8px 16px 0;
  color: var(--mx-text-secondary);
}
</style>