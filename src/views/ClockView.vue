<script setup lang="ts">
// Clock 视图：页头 + 工具栏（搜索 / Resolve clock issues / Reset clock）+ 分段 Graphic/Table
// + 画布或表格 + 右侧 Detail view + Code preview。
// M15：外设时钟树（periCtx）、问题合并校验、画布/表格写回同一路由、路径高亮、右键菜单、
// Reset 确认（可「不再询问」）、Shortcuts 浮层。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, RefreshLeft, WarningFilled, CircleCheck } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { getPreference, setPreference } from '@/services/uiPreferences'
import PanelResizer, {
  CODE_WIDTH_RANGE,
  DETAIL_WIDTH_RANGE,
  clampPanelWidth,
} from '@/components/common/PanelResizer.vue'
import { computeClock, resolveClockIssues, validateClock } from '@/model/clock'
import { computePeripheralClocks, validatePeripheralClocks } from '@/model/clock/peripheral'
import { applyClockControl, buildClockTree, formatMhz } from '@/model/clock/tree'
import type { ClockNodeControl, ClockTreeLayout, ClockTreeNode, PeripheralClockContext } from '@/model/clock/tree'
import type { PeripheralClockFreq } from '@/model/types'
import ClockCanvas from '../components/ClockCanvas.vue'
import ClockDetail from '../components/ClockDetail.vue'
import ClockContextMenu from '@/components/clock/ClockContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import CodePreviewPanel from '../components/CodePreviewPanel.vue'
import { subscribeClockFocus, takeClockFocus } from '@/components/clock/clockFocus'
import { requestPeripheralFocus } from '@/components/peripherals/peripheralFocus'
import { computeHighlightSet, type HighlightMode } from '@/components/clock/graph'
import { clampNumber, resolveSelectValue } from '@/components/clock/inlineEdit'

const store = useProjectStore()
const spec = computed(() => store.deviceData.clock)
const cfg = computed(() => store.clockConfig)
const freqs = computed(() => computeClock(spec.value, cfg.value))

// ---------- 外设时钟域（M15）：实例派生频率 + 合并问题 ----------
const periCtx = computed<PeripheralClockContext>(() => ({
  peripherals: store.deviceData.peripherals,
  state: store.peripherals,
  periFreqs: computePeripheralClocks(
    spec.value,
    cfg.value,
    freqs.value,
    store.deviceData.peripherals,
    store.peripherals,
  ),
}))
const issues = computed(() => [
  ...validateClock(spec.value, cfg.value),
  ...validatePeripheralClocks(
    spec.value,
    cfg.value,
    freqs.value,
    store.deviceData.peripherals,
    store.peripherals,
  ),
])

/** 布局兜底：构建异常时回退空布局并展示错误信息，避免整页空白 */
const EMPTY_LAYOUT: ClockTreeLayout = { width: 960, height: 520, nodes: [], edges: [], groups: [] }
const layoutState = computed<{ layout: ClockTreeLayout; error: string | null }>(() => {
  try {
    return {
      layout: buildClockTree(spec.value, cfg.value, freqs.value, issues.value, periCtx.value),
      error: null,
    }
  } catch (e) {
    return { layout: EMPTY_LAYOUT, error: e instanceof Error ? e.message : String(e) }
  }
})
const layout = computed(() => layoutState.value.layout)
const layoutError = computed(() => layoutState.value.error)
const layoutReady = computed(() => layout.value.nodes.length > 0)

const viewMode = ref<'graphic' | 'table'>('graphic')

// ---------- 面板可见性 / 宽度持久化（M6） ----------
// 初始化即从偏好恢复（刷新后还原），读取时夹取到合法范围；可见性变化经 watch 写回。
// 宽度刻意不 watch：拖拽中 resize 只更新本地 ref，松手 commit 时才 setPreference，
// 避免 mousemove 每帧写 localStorage。
const showDetail = ref(getPreference('clock.detailVisible'))
const showCode = ref(getPreference('clock.codeVisible'))
const detailWidth = ref(clampPanelWidth(getPreference('clock.detailWidth'), DETAIL_WIDTH_RANGE.min, DETAIL_WIDTH_RANGE.max))
const codeWidth = ref(clampPanelWidth(getPreference('clock.codeWidth'), CODE_WIDTH_RANGE.min, CODE_WIDTH_RANGE.max))
watch(showDetail, (v) => setPreference('clock.detailVisible', v))
watch(showCode, (v) => setPreference('clock.codeVisible', v))

function onDetailResize(w: number) {
  detailWidth.value = w
}
function onDetailCommit(w: number) {
  detailWidth.value = w
  setPreference('clock.detailWidth', w)
}
function onCodeResize(w: number) {
  codeWidth.value = w
}
function onCodeCommit(w: number) {
  codeWidth.value = w
  setPreference('clock.codeWidth', w)
}

const search = ref('')
const selectedId = ref<string | null>(null)
const showIssues = ref(false)

/** 画布/表格统一写回路由：periParam 写外设参数，其余走 ClockConfig */
function onControlChange(control: ClockNodeControl, value: string | number) {
  if (control.field === 'periParam') {
    const periId = control.periId
    if (!periId) return
    const cur = store.peripherals[periId] ?? { enabled: false, params: {} }
    const paramKey = control.paramKey
    if (!paramKey) return
    store.setPeripheral(periId, { ...cur, params: { ...cur.params, [paramKey]: value } })
    return
  }
  store.setClock(applyClockControl(cfg.value, control, value))
}

// ---------- Reset 确认（M15）：可勾选「不再询问」写入 uiPreferences ----------
const resetDialog = ref(false)
function doReset() {
  store.resetClock()
  store.notify('时钟已重置为芯片默认档', 'info')
}
function requestReset() {
  if (getPreference('clock.resetConfirmSkip')) {
    doReset()
    return
  }
  resetDialog.value = true
}
function onConfirmReset(skip: boolean) {
  if (skip) setPreference('clock.resetConfirmSkip', true)
  doReset()
}

// ---------- 路径高亮（M15）：右键菜单触发 BFS，上游 / 上下游闭包 ----------
const highlightIds = ref<Set<string>>(new Set())
const hasHighlight = computed(() => highlightIds.value.size > 0)
function highlightPath(nodeId: string, mode: HighlightMode) {
  highlightIds.value = computeHighlightSet(layout.value.edges, nodeId, mode)
}
function clearHighlight() {
  highlightIds.value = new Set()
}

// ---------- 节点右键菜单 ----------
const menuState = ref<{ x: number; y: number; nodeId: string } | null>(null)
const menuNode = computed<ClockTreeNode | null>(() => {
  const id = menuState.value?.nodeId
  return id ? (layout.value.nodes.find((n) => n.id === id) ?? null) : null
})
function openContextMenu(nodeId: string, x: number, y: number) {
  selectedId.value = nodeId
  menuState.value = { x, y, nodeId }
}
function closeContextMenu() {
  menuState.value = null
}
/** 仅 peripherals.json 中真实存在的实例可跳转配置（USB 域节点只有 periId 标签，无对象页） */
const menuConfigureId = computed<string | null>(() => {
  const id = menuNode.value?.periId
  if (!id) return null
  const p = store.deviceData.peripherals
  const exists = [...p.usart, ...p.spi, ...p.i2c, ...p.adc].some((i) => i.id === id)
  return exists ? id : null
})
function configurePeripheral(periId: string) {
  requestPeripheralFocus(periId)
  store.setView('peripherals')
}

// 布局变化（切芯片/外设实例增删）后清理失效的菜单与高亮节点
watch(
  () => layout.value.nodes,
  (nodes) => {
    if (menuState.value && !nodes.some((n) => n.id === menuState.value!.nodeId)) menuState.value = null
    if (highlightIds.value.size > 0) {
      const keep = new Set([...highlightIds.value].filter((id) => nodes.some((n) => n.id === id)))
      if (keep.size !== highlightIds.value.size) highlightIds.value = keep
    }
  },
)

// ---------- 选中节点 / 外设详情 ----------
const selectedNode = computed<ClockTreeNode | null>(
  () => layout.value.nodes.find((n) => n.id === selectedId.value) ?? null,
)
const selectedPeriFreq = computed<PeripheralClockFreq | null>(() => {
  const periId = selectedNode.value?.periId
  return periId ? (periCtx.value.periFreqs.find((f) => f.periId === periId) ?? null) : null
})

// ---------- Shortcuts 浮层（静态分组） ----------
const showShortcuts = ref(false)
const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Move / pan',
    items: [
      ['空白处拖动', '平移画布'],
      ['抓手模式 / 按住 Space', '任意位置拖动平移'],
      ['方向键', '滚动画布'],
    ],
  },
  {
    title: 'Scroll',
    items: [
      ['滚轮', '上下滚动画布'],
      ['Shift + 滚轮', '水平滚动画布'],
    ],
  },
  {
    title: 'Zoom',
    items: [
      ['Ctrl / ⌘ + 滚轮', '以光标为锚点缩放'],
      ['缩放条 +/-', '以视图中心缩放'],
      ['缩放条「适合窗口」', '恢复自适应比例'],
    ],
  },
  {
    title: 'Select',
    items: [
      ['单击节点', '在 Detail view 查看'],
      ['右键节点', '锁定 / 路径高亮 / 配置外设'],
    ],
  },
  {
    title: 'Other',
    items: [
      ['Enter / Esc', '提交 / 取消内联数字编辑'],
      ['Esc', '关闭右键菜单'],
    ],
  },
]

function focusNode(nodeId: string) {
  selectedId.value = nodeId
}

/** 外部定位（CheckDialog / 生成前检查）：切回图形视图并聚焦节点 */
function focusNodeFromOutside(nodeId: string) {
  viewMode.value = 'graphic'
  showDetail.value = true
  focusNode(nodeId)
}

/** 锁定/解锁节点：写回 ClockConfig.locked（预设/解算/自动修复会跳过锁定节点） */
function toggleLock(nodeId: string) {
  const locked = new Set(cfg.value.locked ?? [])
  if (locked.has(nodeId)) locked.delete(nodeId)
  else locked.add(nodeId)
  store.setClock({ ...cfg.value, locked: [...locked] })
}

/** Resolve clock issues：约束求解自动修复（尊重锁定节点）；无解时回退到问题列表 */
const solving = ref(false)
async function resolveIssues() {
  if (!issues.value.length || solving.value) return
  solving.value = true
  try {
    // 求解为同步纯函数；让按钮 loading 至少渲染一帧
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const result = resolveClockIssues(spec.value, cfg.value)
    if (!result) {
      showIssues.value = true
      store.notify('未找到满足锁定约束的合法时钟配置，已打开问题列表', 'warning')
      return
    }
    store.setClock(result.config)
    if (result.issues.length > 0) {
      showIssues.value = true
      store.notify(`已修复时钟错误，仍有 ${result.issues.length} 个警告需确认`, 'warning')
    } else {
      store.notify('时钟问题已自动修复', 'info')
    }
  } finally {
    solving.value = false
  }
}

// 跨视图定位：CheckDialog 先 setView('clock')，ClockView 挂载时消费 pending，或在已挂载时直接响应
let unsubscribeClockFocus: (() => void) | null = null
onMounted(() => {
  const pending = takeClockFocus()
  if (pending) focusNodeFromOutside(pending)
  unsubscribeClockFocus = subscribeClockFocus(focusNodeFromOutside)
})
onBeforeUnmount(() => {
  unsubscribeClockFocus?.()
  unsubscribeClockFocus = null
})

function onRowClick(row: { id: string }) {
  focusNode(row.id)
}

/** 问题列表点击定位：选中节点并关闭对话框 */
function locateIssue(nodeId: string) {
  focusNode(nodeId)
  showIssues.value = false
}

// 表格视图数据：Value 列复用节点 control（与画布同一写回路由）
const tableRows = computed(() =>
  layout.value.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    input: formatMhz(n.inMhz),
    output: formatMhz(n.outMhz),
    max: n.maxMhz !== null ? formatMhz(n.maxMhz) : '—',
    level: n.issueLevel,
    active: n.active,
    locked: n.locked,
    lockable: n.lockable,
    control: n.control,
    badge: n.badge ?? '',
    periId: n.periId ?? '',
  })),
)

/** 表格控件写回：select 走 resolveSelectValue（保留原类型），number 走 clampNumber */
function onTableControlChange(row: { control: ClockNodeControl | null }, v: string | number) {
  const c = row.control
  if (!c) return
  if (c.kind === 'number') {
    onControlChange(c, clampNumber(Number(v), c.min, c.max))
    return
  }
  const val = resolveSelectValue(String(v), c)
  if (val !== null) onControlChange(c, val)
}
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return tableRows.value
  return tableRows.value.filter((r) => r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
})
</script>

<template>
  <div class="clock-view">
    <!-- 页头 -->
    <div class="page-head">
      <div>
        <h1 class="page-title">Clock</h1>
        <div class="page-sub">{{ store.deviceData.chip.chip }} {{ store.deviceData.chip.package }}</div>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input v-model="search" placeholder="搜索节点" :prefix-icon="Search" size="small" style="width: 180px" clearable />
      <div class="toolbar-fill"></div>
      <el-button
        size="small"
        :type="!issues.length ? 'success' : issues.some((i) => i.level === 'error') ? 'danger' : 'warning'"
        :icon="issues.length ? WarningFilled : CircleCheck"
        :loading="solving"
        :disabled="!issues.length"
        @click="resolveIssues"
      >
        <template v-if="solving">求解中…</template>
        <template v-else-if="issues.length">Resolve clock issues ({{ issues.length }})</template>
        <template v-else>No clock issues</template>
      </el-button>
      <el-button size="small" :type="issues.length ? 'warning' : 'default'" @click="showIssues = true">
        问题列表<template v-if="issues.length"> ({{ issues.length }})</template>
      </el-button>
      <el-button size="small" :disabled="!hasHighlight" @click="clearHighlight">Clear highlight</el-button>
      <el-button size="small" type="primary" :icon="RefreshLeft" @click="requestReset">Reset clock</el-button>
    </div>

    <!-- 分段控件 + 右侧面板开关 -->
    <div class="view-controls">
      <div class="segmented">
        <button class="seg-btn" :class="{ active: viewMode === 'graphic' }" @click="viewMode = 'graphic'">Graphic view</button>
        <button class="seg-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">Table view</button>
      </div>
      <div class="toolbar-fill"></div>
      <el-button size="small" :type="showShortcuts ? 'primary' : 'default'" @click="showShortcuts = !showShortcuts">
        Shortcuts
      </el-button>
      <el-button size="small" :type="showCode ? 'primary' : 'default'" @click="showCode = !showCode">&lt;/&gt; Code preview</el-button>
      <el-button size="small" :type="showDetail ? 'primary' : 'default'" @click="showDetail = !showDetail">Detail view</el-button>
    </div>

    <!-- 工作区 -->
    <div class="work-area">
      <!-- 最小渲染兜底：布局异常或无节点时给出空状态，避免 <main> 整页空白 -->
      <div v-if="!layoutReady" class="layout-empty">
        <div class="layout-empty-title">时钟树布局不可用</div>
        <div class="layout-empty-msg">
          {{ layoutError ?? '未生成任何时钟节点，请尝试 Reset clock 或检查芯片数据。' }}
        </div>
      </div>
      <ClockCanvas
        v-else-if="viewMode === 'graphic'"
        :layout="layout"
        :selected-id="selectedId"
        :search="search"
        :highlight-ids="highlightIds"
        @focus="focusNode"
        @control-change="onControlChange"
        @toggle-lock="toggleLock"
        @contextmenu="openContextMenu"
      />
      <div v-else class="table-wrap">
        <el-table :data="filteredRows" size="small" highlight-current-row @row-click="onRowClick">
          <el-table-column prop="label" label="节点" min-width="130" />
          <el-table-column prop="id" label="ID" width="100" />
          <el-table-column label="当前值" min-width="180">
            <template #default="{ row }">
              <el-select
                v-if="row.control && row.control.kind === 'select'"
                :model-value="String(row.control.value)"
                size="small"
                class="table-control"
                :disabled="row.locked || row.control.fixed"
                @change="(v: string) => onTableControlChange(row, v)"
                @click.stop
              >
                <el-option v-for="o in row.control.options" :key="String(o.value)" :label="o.label" :value="String(o.value)" />
              </el-select>
              <el-input-number
                v-else-if="row.control && row.control.kind === 'number'"
                :model-value="Number(row.control.value)"
                size="small"
                class="table-control"
                :min="row.control.min"
                :max="row.control.max"
                :disabled="row.locked || row.control.fixed"
                @change="(v: number | undefined) => v !== undefined && v !== null && onTableControlChange(row, v)"
                @click.stop
              />
              <span v-else class="table-na">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="input" label="输入频率" width="105" />
          <el-table-column prop="output" label="输出频率" width="105" />
          <el-table-column prop="max" label="上限" width="95" />
          <el-table-column label="锁定" width="78">
            <template #default="{ row }">
              <el-button
                link
                size="small"
                :type="row.locked ? 'primary' : 'default'"
                :disabled="!row.lockable"
                @click.stop="toggleLock(row.id)"
              >
                {{ row.locked ? '已锁定' : row.lockable ? '锁定' : '—' }}
              </el-button>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.level === 'error'" type="danger" size="small">越界</el-tag>
              <el-tag v-else-if="row.level === 'warning'" type="warning" size="small">警告</el-tag>
              <el-tag v-else-if="!row.active" type="info" size="small">未使用</el-tag>
              <el-tag v-else type="success" size="small">正常</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- Detail 面板：左缘分隔条拖拽调宽（宽度持久化到 clock.detailWidth） -->
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
        <ClockDetail
          :node="selectedNode"
          :peri-freq="selectedPeriFreq"
          :issues="issues"
          @focus="focusNode"
          @control-change="onControlChange"
        />
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
          <CodePreviewPanel context="clock" />
        </div>
      </template>
    </div>

    <!-- 节点右键菜单 -->
    <ClockContextMenu
      v-if="menuState && menuNode"
      :x="menuState.x"
      :y="menuState.y"
      :node="menuNode"
      :has-highlight="hasHighlight"
      :configure-id="menuConfigureId"
      @close="closeContextMenu"
      @toggle-lock="toggleLock"
      @highlight-source="(id: string) => highlightPath(id, 'upstream')"
      @highlight-all="(id: string) => highlightPath(id, 'both')"
      @clear-highlight="clearHighlight"
      @configure="configurePeripheral"
    />

    <!-- Reset 确认（可「不再询问」） -->
    <ConfirmDialog
      v-model="resetDialog"
      title="Reset clock"
      message="将时钟配置恢复为芯片默认档，当前时钟修改不会保留（外设参数不受影响）。是否继续？"
      confirm-text="重置"
      show-checkbox
      checkbox-label="不再询问（以后直接重置）"
      @confirm="onConfirmReset"
    />

    <!-- Shortcuts 浮层（静态分组） -->
    <div v-if="showShortcuts" class="shortcuts-pop">
      <div class="shortcuts-head">
        <span>Shortcuts</span>
        <button class="shortcuts-close" title="关闭" @click="showShortcuts = false">×</button>
      </div>
      <div v-for="g in SHORTCUT_GROUPS" :key="g.title" class="shortcuts-group">
        <div class="shortcuts-title">{{ g.title }}</div>
        <div v-for="[key, desc] in g.items" :key="key" class="shortcuts-row">
          <span class="shortcuts-key">{{ key }}</span>
          <span class="shortcuts-desc">{{ desc }}</span>
        </div>
      </div>
    </div>

    <!-- 问题定位对话框 -->
    <el-dialog v-model="showIssues" title="时钟问题" width="520px">
      <div v-if="!issues.length" class="no-issue">当前时钟配置没有问题</div>
      <div v-for="(i, idx) in issues" :key="idx" class="issue-row" @click="locateIssue(i.node)">
        <el-tag :type="i.level === 'error' ? 'danger' : 'warning'" size="small">
          {{ i.level === 'error' ? '错误' : '警告' }}
        </el-tag>
        <span class="issue-msg">{{ i.message }}</span>
        <span class="issue-node">{{ i.node }}</span>
      </div>
      <template #footer>
        <el-button size="small" @click="showIssues = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.clock-view {
  position: relative;
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
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 20px;
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
  background: #e9edf5;
  border-radius: 8px;
  padding: 2px;
}
.seg-btn {
  border: none;
  background: transparent;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--mx-text-secondary);
  cursor: pointer;
  border-radius: 6px;
  position: relative;
}
.seg-btn.active {
  background: var(--mx-surface);
  color: var(--mx-accent);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
}
.work-area {
  flex: 1;
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--mx-border);
}
.table-wrap {
  flex: 1;
  min-width: 0;
  background: var(--mx-surface);
  overflow: auto;
  padding: 12px 16px;
}
.layout-empty {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  background: var(--mx-surface);
  text-align: center;
}
.layout-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.layout-empty-msg {
  font-size: 12px;
  color: var(--mx-text-muted);
  max-width: 480px;
  line-height: 1.6;
}
.detail-col {
  display: flex;
  min-height: 0;
  flex-shrink: 0;
  max-height: 100%;
}
.code-col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  max-height: 100%;
}
.no-issue {
  color: var(--mx-success);
  font-size: 13px;
  padding: 8px 4px;
}
.issue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.issue-row:hover {
  background: var(--mx-accent-soft);
}
.issue-msg {
  flex: 1;
  font-size: 13px;
  color: var(--mx-text-secondary);
}
.issue-node {
  font-size: 11px;
  color: var(--mx-text-muted);
  font-family: var(--mx-font-mono);
}
.table-control {
  width: 150px;
}
.table-na {
  color: var(--mx-text-muted);
}

/* Shortcuts 浮层：右下角（对齐 MX2） */
.shortcuts-pop {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 300px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: 10px;
  box-shadow: var(--mx-shadow-popover);
  padding: 10px 12px 12px;
  z-index: 25;
}
.shortcuts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--mx-text);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--mx-border);
}
.shortcuts-close {
  border: none;
  background: none;
  font-size: 16px;
  line-height: 1;
  color: var(--mx-text-muted);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
}
.shortcuts-close:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.shortcuts-group {
  margin-top: 10px;
}
.shortcuts-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--mx-text-muted);
  margin-bottom: 4px;
}
.shortcuts-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 12px;
}
.shortcuts-key {
  flex-shrink: 0;
  font-family: var(--mx-font-mono);
  font-size: 11px;
  color: var(--mx-text);
  background: #f2f5fa;
  border: 1px solid var(--mx-border);
  border-radius: 4px;
  padding: 1px 6px;
}
.shortcuts-desc {
  color: var(--mx-text-secondary);
  text-align: right;
}
</style>
