<script setup lang="ts">
// Pinout 视图：页头 + 工具栏 + 分段控件 + 封装图/表格 + Detail view + Code preview
// 工具栏与分段控件拆到 components/pinout/，本视图保留页头、工作区与数据动作。
import { computed, ref } from 'vue'
import { Document } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import PackageCanvas from '@/components/PackageCanvas.vue'
import PinTable from '@/components/PinTable.vue'
import PinConfigPanel from '@/components/PinConfigPanel.vue'
import ConflictsPanel from '@/components/ConflictsPanel.vue'
import CodePreviewPanel from '@/components/CodePreviewPanel.vue'
import CodegenDialog from '@/components/CodegenDialog.vue'
import PinoutToolbar from '@/components/pinout/PinoutToolbar.vue'
import PinoutViewBar from '@/components/pinout/PinoutViewBar.vue'
import { usePinOverwrite, clearUndo } from '@/model/pins/pinOverwrite'

const store = useProjectStore()
const { undo } = usePinOverwrite(store)
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
/** 页头文档链接：优先芯片数据里的 docUrl，缺省回退 WCH 官网首页 */
const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

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
      <a class="doc-link" :href="docUrl" target="_blank" rel="noopener">
        <el-icon :size="13"><Document /></el-icon> Open documentation
      </a>
    </div>

    <!-- 工具栏 -->
    <PinoutToolbar
      v-model:search="search"
      v-model:show-filter="showFilter"
      v-model:type-filter="typeFilter"
      :io-count="ioCount"
      :type-filter-count="typeFilterCount"
      :configured-count="configuredCount"
      @undo="undo"
      @export-pins="exportPins"
      @export-project="showExport = true"
      @reset="resetPinout"
    />

    <CodegenDialog v-model="showExport" />

    <!-- 分段控件 + 右侧面板开关 -->
    <PinoutViewBar
      v-model:view-mode="viewMode"
      :show-code="showCode"
      :show-detail="showDetail"
      @toggle-code="showCode = !showCode"
      @toggle-detail="showDetail = !showDetail"
    />

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