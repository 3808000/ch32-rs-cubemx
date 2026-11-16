<script setup lang="ts">
// Pinout 视图：页头 + 工具栏 + 分段控件 + 封装图/表格 + Detail view + Code preview
// 统一过滤（M2.5/M2.6）：本视图持有唯一 PinFilter 与九态派生，图形/表格/图例共同消费。
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
import PinLegend from '@/components/pinout/PinLegend.vue'
import { usePinOverwrite, clearUndo } from '@/model/pins/pinOverwrite'
import { derivePeripheralUsage } from '@/model/peripherals'
import {
  DEFAULT_PIN_FILTER,
  buildPinSuggestions,
  conflictPinSets,
  countPinStates,
  derivePinStates,
  pinMatchesFilter,
  type PinFilter,
  type PinStateId,
} from '@/model/pins/pinFilter'

const store = useProjectStore()
const { undo } = usePinOverwrite(store)
const showExport = ref(false)

const viewMode = ref<'graphic' | 'table'>('graphic')
const showDetail = ref(true)
const showCode = ref(false)

/** 单一真相：图形、表格、Show 计数、搜索建议都从这份过滤状态派生。 */
const filter = ref<PinFilter>({ ...DEFAULT_PIN_FILTER, states: [], types: [] })

const pins = computed(() => store.deviceData.chip.pins)

/** 已启用外设占用的 AF/ANALOG 引脚（reserved 状态来源）。 */
const reservedPins = computed(() => {
  const set = new Set<string>()
  for (const usage of derivePeripheralUsage(store.config, store.deviceData)) {
    if (!usage.enabled) continue
    for (const p of usage.pins) set.add(p.pin)
  }
  return set
})

/** 冲突 → 错误/警告引脚集合（同一引脚可能同时出现，derivePinState 内 error 优先）。 */
const conflictPins = computed(() => conflictPinSets(store.conflicts))

const pinStates = computed<Record<string, PinStateId>>(() =>
  derivePinStates(pins.value, {
    assignments: store.assignments,
    reservedPins: reservedPins.value,
    errorPins: conflictPins.value.errors,
    warningPins: conflictPins.value.warnings,
  }),
)

const stateCounts = computed(() => countPinStates(pins.value, pinStates.value))

const typeCounts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const p of pins.value) out[p.type] = (out[p.type] ?? 0) + 1
  return out
})

const filteredPins = computed(() =>
  pins.value.filter((p) =>
    pinMatchesFilter(p, store.assignmentOf(p.name), pinStates.value[p.name] ?? 'unassigned', filter.value),
  ),
)

/** 建议列表基于当前过滤结果，保证点击建议一定能定位到可见引脚。 */
const suggestions = computed(() => buildPinSuggestions(filteredPins.value, store.assignmentOf, filter.value))

function applyFilterPatch(patch: Partial<PinFilter>) {
  filter.value = { ...filter.value, ...patch }
}

/** 建议点击 / 右键 Assign：选中引脚并打开 Detail view。 */
function focusPin(pin: string) {
  store.selectPin(pin)
  showDetail.value = true
}

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
      :filter="filter"
      :state-counts="stateCounts"
      :type-counts="typeCounts"
      :visible-count="filteredPins.length"
      :total-count="pins.length"
      :suggestions="suggestions"
      @update:filter="applyFilterPatch"
      @locate="focusPin"
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

    <!-- 状态图例（可折叠持久化；图形/表格/悬停共用同一状态色） -->
    <PinLegend :counts="stateCounts" />

    <!-- 工作区 -->
    <div class="work-area">
      <PackageCanvas
        v-if="viewMode === 'graphic'"
        :chip="store.deviceData.chip"
        :assignments="store.assignments"
        :selected-pin="store.selectedPin"
        :filter="filter"
        :pin-states="pinStates"
        @select="store.selectPin"
        @configure="store.selectPin"
        @assign="focusPin"
      />
      <PinTable v-else :filter="filter" :pin-states="pinStates" />

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