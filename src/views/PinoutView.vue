<script setup lang="ts">
// Pinout 视图：页头 + 工具栏 + 分段控件 + 封装图/表格 + Detail view + Code preview
// 统一过滤（M2.5/M2.6）：本视图持有唯一 PinFilter 与九态派生，图形/表格/图例共同消费。
import { computed, ref, watch } from 'vue'
import { Document } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { isDesktopApp, saveFileNative } from '@/services/desktop'
import { getPreference, setPreference } from '@/services/uiPreferences'
import PanelResizer, {
  CODE_WIDTH_RANGE,
  DETAIL_WIDTH_RANGE,
  clampPanelWidth,
} from '@/components/common/PanelResizer.vue'
import { remapsOfPin, remapValuesFor } from '@/model/device'
import PackageCanvas from '@/components/PackageCanvas.vue'
import PinTable from '@/components/PinTable.vue'
import PinConfigPanel from '@/components/PinConfigPanel.vue'
import ConflictsPanel from '@/components/ConflictsPanel.vue'
import CodePreviewPanel from '@/components/CodePreviewPanel.vue'
import CodegenDialog from '@/components/CodegenDialog.vue'
import PinoutToolbar, {
  buildPinoutCsv,
  pinoutCsvFileName,
  type PinoutExportFlavor,
} from '@/components/pinout/PinoutToolbar.vue'
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

// ---------- 面板可见性 / 宽度持久化（M6） ----------
// 初始化即从偏好恢复（刷新后还原），读取时夹取到合法范围；可见性变化经 watch 写回。
// 宽度刻意不 watch：拖拽中 resize 只更新本地 ref，松手 commit 时才 setPreference，
// 避免 mousemove 每帧写 localStorage。
const showDetail = ref(getPreference('pinout.detailVisible'))
const showCode = ref(getPreference('pinout.codeVisible'))
const detailWidth = ref(clampPanelWidth(getPreference('pinout.detailWidth'), DETAIL_WIDTH_RANGE.min, DETAIL_WIDTH_RANGE.max))
const codeWidth = ref(clampPanelWidth(getPreference('pinout.codeWidth'), CODE_WIDTH_RANGE.min, CODE_WIDTH_RANGE.max))
watch(showDetail, (v) => setPreference('pinout.detailVisible', v))
watch(showCode, (v) => setPreference('pinout.codeVisible', v))

function onDetailResize(w: number) {
  detailWidth.value = w
}
function onDetailCommit(w: number) {
  detailWidth.value = w
  setPreference('pinout.detailWidth', w)
}
function onCodeResize(w: number) {
  codeWidth.value = w
}
function onCodeCommit(w: number) {
  codeWidth.value = w
  setPreference('pinout.codeWidth', w)
}

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

/** 拖拽移动信号（M4.8）：画布已保证目标脚可承载同一信号且未占用；这里执行配置搬移。
 *  AF 信号按目标脚的 remap 档位重映射（优先保留原档位）；纯 GPIO 配置直接搬移。 */
function onMoveSignal(payload: { from: string; to: string }) {
  const a = store.assignmentOf(payload.from)
  if (!a) return
  let remap = a.remap
  if (a.function) {
    const values = remapValuesFor(store.deviceData, payload.to, a.function)
    if (values.length === 0) return
    remap = values.includes(a.remap ?? 0) ? (a.remap ?? 0) : values[0]
  }
  const { mode, label, function: fn, params } = a
  store.clearPin(payload.from)
  store.setPinAssignment(payload.to, mode, { label, function: fn, remap, params })
  store.selectPin(payload.to)
  store.notify(`信号已移动：${payload.from} → ${payload.to}${fn ? `（${fn}）` : ''}`, 'info')
}

/** 页头文档链接：优先芯片数据里的 docUrl，缺省回退 WCH 官网首页 */
const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

function resetPinout() {
  store.resetPinout()
  // Reset 是破坏性批量操作：清空撤回栈，避免撤回恢复出与 unlocked 不一致的旧配置
  clearUndo()
  store.notify('配置已重置', 'info')
}

/** 浏览器下载：Blob + 临时 <a>（桌面端会先尝试原生保存）。 */
function downloadCsv(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 等浏览器开始下载后再释放对象 URL
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Export pinout（M5）：二选一 CSV 粒度；桌面端优先原生另存对话框。 */
async function exportPins(flavor: PinoutExportFlavor) {
  const csv = buildPinoutCsv(
    store.deviceData.chip.pins,
    store.assignmentOf,
    flavor,
    (pin) => [...new Set(remapsOfPin(store.deviceData, pin).map((e) => e.signal))],
  )
  const fileName = pinoutCsvFileName(store.chip, new Date())

  if (isDesktopApp()) {
    try {
      const saved = await saveFileNative(fileName, csv, [{ name: 'CSV', extensions: ['csv'] }])
      if (saved) store.notify(`已导出 ${fileName}`, 'info')
      return
    } catch (e) {
      store.notify(`原生保存失败，改用浏览器下载：${e instanceof Error ? e.message : String(e)}`, 'warning')
    }
  }

  downloadCsv(fileName, csv)
  store.notify(`已导出 ${fileName}`, 'info')
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
        :data="store.deviceData"
        @select="store.selectPin"
        @configure="store.selectPin"
        @assign="focusPin"
        @move-signal="onMoveSignal"
      />
      <PinTable v-else :filter="filter" :pin-states="pinStates" @configure="focusPin" />

      <!-- Detail 面板：左缘分隔条拖拽调宽，宽度与 conflicts-section 同源（detailWidth） -->
      <PanelResizer
        v-if="showDetail"
        :width="detailWidth"
        :min="DETAIL_WIDTH_RANGE.min"
        :max="DETAIL_WIDTH_RANGE.max"
        side="right"
        @resize="onDetailResize"
        @commit="onDetailCommit"
      />
      <div v-if="showDetail" class="detail-col" :style="{ width: detailWidth + 'px' }">
        <PinConfigPanel />
        <div class="conflicts-section">
          <div class="conflicts-head">冲突检查</div>
          <ConflictsPanel />
        </div>
      </div>

      <!-- Code 预览：外层容器持有持久化宽度，PanelResizer 在面板左缘 -->
      <template v-if="showCode">
        <PanelResizer
          :width="codeWidth"
          :min="CODE_WIDTH_RANGE.min"
          :max="CODE_WIDTH_RANGE.max"
          side="right"
          @resize="onCodeResize"
          @commit="onCodeCommit"
        />
        <div class="code-col" :style="{ width: codeWidth + 'px' }">
          <CodePreviewPanel context="pinout" />
        </div>
      </template>
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
/* 宽度跟随 detail-col（M6）：不再依赖 --mx-detail-panel-w，与 detailWidth 同源 */
.conflicts-section {
  border-top: 1px solid var(--mx-border);
  max-height: 240px;
  overflow-y: auto;
  background: var(--mx-surface);
  width: 100%;
  min-width: 0;
}
.code-col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  max-height: 100%;
}
.conflicts-head {
  font-size: 12px;
  font-weight: 600;
  padding: 8px 16px 0;
  color: var(--mx-text-secondary);
}
</style>