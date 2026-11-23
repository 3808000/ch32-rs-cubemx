<script setup lang="ts">
// Clock 视图：页头 + 工具栏（搜索 / Resolve clock issues / Reset clock）+ 分段 Graphic/Table
// + 画布或表格 + 右侧 Detail view + Code preview。
// M15：外设时钟树（periCtx）、问题合并校验、画布/表格写回同一路由、路径高亮、右键菜单、
// Reset 确认（可「不再询问」）、Shortcuts 浮层。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowRight, CircleCheck, Close, Connection, Grid, List, RefreshLeft, Search, WarningFilled } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { getPreference, setPreference } from '@/services/uiPreferences'
import PanelResizer, {
  CODE_WIDTH_RANGE,
  DETAIL_WIDTH_RANGE,
  clampPanelWidth,
} from '@/components/common/PanelResizer.vue'
import { computeClock, resolveClockIssues, validateClock } from '@/model/clock'
import { computePeripheralClocks } from '@/model/clock/peripheral'
import { applyClockControl, applyPeripheralClockControl, buildClockTree, formatMhz } from '@/model/clock/tree'
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
import { derivePeripheralUsage, peripheralClockState } from '@/model/peripherals'
import { clampNumber, resolveSelectValue } from '@/components/clock/inlineEdit'

const store = useProjectStore()
const spec = computed(() => store.deviceData.clock)
const cfg = computed(() => store.clockConfig)
const freqs = computed(() => computeClock(spec.value, cfg.value))

// ---------- 外设时钟域（M15）：实例派生频率 + 合并问题 ----------
const clockPeripherals = computed(() => peripheralClockState(derivePeripheralUsage(store.config, store.deviceData)))
const periCtx = computed<PeripheralClockContext>(() => ({
  peripherals: store.deviceData.peripherals,
  state: clockPeripherals.value,
  halBackend: store.effectiveHalBackend,
  periFreqs: computePeripheralClocks(
    spec.value,
    cfg.value,
    freqs.value,
    store.deviceData.peripherals,
    clockPeripherals.value,
    store.effectiveHalBackend,
  ),
}))
const issues = computed(() => [
  ...validateClock(spec.value, cfg.value, store.effectiveHalBackend),
  ...(periCtx.value.periFreqs ?? []).flatMap((rate) => rate.issues),
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
const canvas = ref<InstanceType<typeof ClockCanvas> | null>(null)
const hasPeripherals = computed(() => layout.value.nodes.some((node) => node.kind === 'peri'))
const clockReadouts = computed(() => [
  { id: 'SYSCLK', label: 'SYSCLK', value: formatMhz(freqs.value.sysclkMhz) },
  { id: 'AHB', label: 'HCLK', value: formatMhz(freqs.value.hclkMhz) },
  { id: 'APB1', label: 'PCLK1', value: formatMhz(freqs.value.pclk1Mhz) },
  { id: 'APB2', label: 'PCLK2', value: formatMhz(freqs.value.pclk2Mhz) },
].filter(({ id }) => layout.value.nodes.some((node) => node.id === id)))

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
const searchQuery = computed(() => search.value.trim().toLowerCase())
const matchingNodes = computed(() => layout.value.nodes.filter((node) =>
  [node.id, node.label, node.inputClockLabel, node.outputLabel].some((value) => value?.toLowerCase().includes(searchQuery.value)),
))
const searchMatches = computed(() => searchQuery.value ? new Set(matchingNodes.value.map((node) => node.id)) : null)

/** 画布/表格统一写回路由：periParam 写外设参数，其余走 ClockConfig */
function onControlChange(control: ClockNodeControl, value: string | number) {
  if (control.field === 'periParam') {
    const periId = control.periId
    if (!periId) return
    const cur = store.peripherals[periId] ?? { enabled: false, params: {} }
    const next = applyPeripheralClockControl(cur, control, value)
    if (next !== cur) store.setPeripheral(periId, next)
    return
  }
  const next = applyClockControl(cfg.value, control, value)
  if (next !== cfg.value) store.setClock(next)
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

// 可配置节点追踪生效来源，仅显示节点追踪硬件候选输入。
const highlightedPath = ref<{ nodeId: string; mode: HighlightMode } | null>(null)
const traceActiveOnly = computed(() => {
  const path = highlightedPath.value
  return path?.mode === 'upstream' && !layout.value.nodes.find((node) => node.id === path.nodeId)?.displayOnly
})
const highlightIds = computed(() => {
  const path = highlightedPath.value
  if (!path) return new Set<string>()
  const edges = traceActiveOnly.value ? layout.value.edges.filter((edge) => edge.active) : layout.value.edges
  return computeHighlightSet(edges, path.nodeId, path.mode)
})
const hasHighlight = computed(() => highlightedPath.value !== null)
function highlightPath(nodeId: string, mode: HighlightMode) {
  highlightedPath.value = { nodeId, mode }
}
function clearHighlight() {
  highlightedPath.value = null
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
    const path = highlightedPath.value
    if (path && !nodes.some((n) => n.id === path.nodeId)) clearHighlight()
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
    title: '平移',
    items: [
      ['空白处拖动', '平移画布'],
      ['抓手模式 / 按住 Space', '任意位置拖动平移'],
      ['画布聚焦时按方向键', '滚动画布'],
    ],
  },
  {
    title: '滚动',
    items: [
      ['滚轮', '上下滚动画布'],
      ['Shift + 滚轮', '水平滚动画布'],
    ],
  },
  {
    title: '缩放',
    items: [
      ['Ctrl / ⌘ + 滚轮', '以光标为锚点缩放'],
      ['缩放条 +/-', '以视图中心缩放'],
      ['回到主干 / 全图总览', '切换阅读比例或查看完整时钟树'],
    ],
  },
  {
    title: '选择',
    items: [
      ['单击节点', '查看节点详情'],
      ['右键节点', '锁定 / 路径高亮 / 配置外设'],
    ],
  },
  {
    title: '编辑',
    items: [
      ['Enter / Esc', '提交 / 取消内联数字编辑'],
      ['Esc', '关闭右键菜单'],
    ],
  },
]

function focusNode(nodeId: string) {
  selectedId.value = nodeId
}

/** 按需揭示画布位置，避免普通点选或编辑时画面跳动。 */
async function revealNode(nodeId: string) {
  focusNode(nodeId)
  await nextTick()
  await canvas.value?.revealNode(nodeId)
}

function focusNodeFromOutside(nodeId: string) {
  viewMode.value = 'graphic'
  showDetail.value = true
  void revealNode(nodeId)
}

function focusNextMatch() {
  if (!searchQuery.value || !matchingNodes.value.length) return
  const index = matchingNodes.value.findIndex((node) => node.id === selectedId.value)
  const node = matchingNodes.value[(index + 1) % matchingNodes.value.length]!
  void revealNode(node.id)
}

/** 锁定/解锁节点：写回 ClockConfig.locked（预设/解算/自动修复会跳过锁定节点） */
/** Resolve clock issues：约束求解自动修复（尊重锁定节点）；无解时回退到问题列表 */
const solving = ref(false)
async function resolveIssues() {
  if (!issues.value.length || solving.value) return
  solving.value = true
  try {
    // 求解为同步纯函数；让按钮 loading 至少渲染一帧
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const result = resolveClockIssues(spec.value, cfg.value, store.effectiveHalBackend)
    if (!result) {
      showIssues.value = true
      store.notify('未找到满足锁定约束的合法时钟配置，已打开问题列表', 'warning')
      return
    }
    store.setClock(result.config)
    if (issues.value.length > 0) {
      showIssues.value = true
      store.notify(`已应用自动解算，仍有 ${issues.value.length} 个时钟问题需确认`, 'warning')
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
  showIssues.value = false
  focusNodeFromOutside(nodeId)
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
  const matches = searchMatches.value
  return matches ? tableRows.value.filter((row) => matches.has(row.id)) : tableRows.value
})
</script>

<template>
  <div class="clock-view">
    <header class="clock-header">
      <div class="page-head">
        <div class="page-heading">
          <el-icon class="page-icon" :size="20"><Connection /></el-icon>
          <div>
            <h1 class="page-title">时钟树</h1>
            <div class="page-sub">{{ store.deviceData.chip.chip }} · {{ store.deviceData.chip.package }}</div>
          </div>
        </div>
        <div class="clock-readouts" role="group" aria-label="主要时钟频率">
          <button
            v-for="readout in clockReadouts"
            :key="readout.id"
            type="button"
            class="clock-readout"
            :class="{ 'readout-selected': selectedId === readout.id }"
            :title="`定位 ${readout.label}`"
            :disabled="!layoutReady"
            @click="focusNodeFromOutside(readout.id)"
          >
            <span>{{ readout.label }}</span>
            <strong>{{ readout.value }}</strong>
          </button>
        </div>
        <div class="toolbar-actions">
          <span v-if="!issues.length" class="clock-ok" role="status"><el-icon><CircleCheck /></el-icon> 时钟正常</span>
          <template v-else>
            <el-button
              plain
              :type="issues.some((issue) => issue.level === 'error') ? 'danger' : 'warning'"
              :icon="WarningFilled"
              @click="showIssues = true"
            >{{ issues.length }} 个问题</el-button>
            <el-button :loading="solving" @click="resolveIssues">自动修复</el-button>
          </template>
          <el-button :icon="RefreshLeft" @click="requestReset">重置时钟</el-button>
        </div>
      </div>
    </header>

    <div class="view-controls">
      <div class="segmented" role="group" aria-label="时钟视图">
        <button type="button" class="seg-btn" :class="{ active: viewMode === 'graphic' }" :aria-pressed="viewMode === 'graphic'" @click="viewMode = 'graphic'"><el-icon><Connection /></el-icon>图形视图</button>
        <button type="button" class="seg-btn" :class="{ active: viewMode === 'table' }" :aria-pressed="viewMode === 'table'" @click="viewMode = 'table'"><el-icon><Grid /></el-icon>表格视图</button>
      </div>
      <div class="clock-search">
        <el-input
          v-model="search"
          placeholder="搜索节点或外设"
          aria-label="搜索节点或外设"
          :prefix-icon="Search"
          clearable
          @keydown.enter="focusNextMatch"
        />
        <button
          v-if="searchQuery && matchingNodes.length"
          type="button"
          class="search-match"
          :title="`定位下一个匹配（${matchingNodes.length} 项，Enter）`"
          @click="focusNextMatch"
        >
          {{ matchingNodes.length }} 项 <el-icon><ArrowRight /></el-icon>
        </button>
        <span v-else-if="searchQuery" class="search-match no-match" role="status">无匹配</span>
      </div>
      <el-button v-if="viewMode === 'graphic' && hasPeripherals" @click="canvas?.revealPeripherals()">定位外设</el-button>
      <el-button v-if="hasHighlight" @click="clearHighlight">清除高亮</el-button>
      <div class="toolbar-fill"></div>
      <el-button :type="showCode ? 'primary' : 'default'" plain :aria-pressed="showCode" @click="showCode = !showCode">代码预览</el-button>
      <el-button :type="showDetail ? 'primary' : 'default'" :icon="List" plain :aria-pressed="showDetail" @click="showDetail = !showDetail">节点详情</el-button>
    </div>

    <!-- 工作区 -->
    <div class="work-area" :class="{ 'both-panels': showDetail && showCode }">
      <!-- 最小渲染兜底：布局异常或无节点时给出空状态，避免 <main> 整页空白 -->
      <div v-if="!layoutReady" class="layout-empty">
        <div class="layout-empty-title">时钟树布局不可用</div>
        <div class="layout-empty-msg">
          {{ layoutError ?? '未生成任何时钟节点，请重置时钟或检查芯片数据。' }}
        </div>
      </div>
      <ClockCanvas
        v-else-if="viewMode === 'graphic'"
        ref="canvas"
        :layout="layout"
        :selected-id="selectedId"
        :search-matches="searchMatches"
        :highlight-ids="highlightIds"
        :trace-active-only="traceActiveOnly"
        @focus="focusNode"
        @locate="focusNodeFromOutside"
        @control-change="onControlChange"
        @toggle-lock="store.toggleClockLock"
        @contextmenu="openContextMenu"
      >
        <template #actions>
          <el-button :aria-expanded="showShortcuts" @click="showShortcuts = !showShortcuts">快捷键</el-button>
        </template>
      </ClockCanvas>
      <div v-else class="table-wrap">
        <el-table :data="filteredRows" row-key="id" :current-row-key="selectedId ?? ''" size="small" highlight-current-row @row-click="onRowClick">
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
                @click.stop="store.toggleClockLock(row.id)"
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
        class="clock-panel-resizer"
        @resize="onDetailResize"
        @commit="onDetailCommit"
      />
      <aside v-if="showDetail" class="detail-col" :style="{ width: detailWidth + 'px' }" aria-labelledby="clock-detail-title">
        <header class="detail-header">
          <el-icon><List /></el-icon>
          <h2 id="clock-detail-title">节点详情</h2>
          <button type="button" class="detail-close" aria-label="关闭节点详情" @click="showDetail = false">
            <el-icon><Close /></el-icon>
          </button>
        </header>
        <div v-if="selectedNode && viewMode === 'graphic'" class="detail-paths" role="group" aria-label="时钟路径">
          <el-button size="small" @click="highlightPath(selectedNode.id, 'upstream')">追踪来源</el-button>
          <el-button size="small" @click="highlightPath(selectedNode.id, 'both')">关联路径</el-button>
        </div>
        <ClockDetail
          :node="selectedNode"
          :peri-freq="selectedPeriFreq"
          :issues="issues"
          @focus="revealNode"
          @control-change="onControlChange"
        />
      </aside>

      <!-- Code 预览：外层容器持有持久化宽度，PanelResizer 在面板左缘 -->
      <template v-if="showCode">
        <PanelResizer
          :width="codeWidth"
          :min="CODE_WIDTH_RANGE.min"
          :max="CODE_WIDTH_RANGE.max"
          side="right"
          class="clock-panel-resizer"
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
      @toggle-lock="store.toggleClockLock"
      @highlight-source="(id: string) => highlightPath(id, 'upstream')"
      @highlight-all="(id: string) => highlightPath(id, 'both')"
      @clear-highlight="clearHighlight"
      @configure="configurePeripheral"
    />

    <!-- Reset 确认（可「不再询问」） -->
    <ConfirmDialog
      v-model="resetDialog"
      title="重置时钟"
      message="将时钟配置恢复为芯片默认档，当前时钟修改不会保留（外设参数不受影响）。是否继续？"
      confirm-text="重置"
      show-checkbox
      checkbox-label="不再询问（以后直接重置）"
      @confirm="onConfirmReset"
    />

    <!-- Shortcuts 浮层（静态分组） -->
    <div v-if="showShortcuts && viewMode === 'graphic'" class="shortcuts-pop">
      <div class="shortcuts-head">
        <span>画布快捷键</span>
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
    <el-dialog v-model="showIssues" title="时钟问题" width="min(520px, calc(100% - 24px))">
      <div v-if="!issues.length" class="no-issue">当前时钟配置没有问题</div>
      <button v-for="(i, idx) in issues" :key="idx" type="button" class="issue-row" @click="locateIssue(i.node)">
        <el-tag :type="i.level === 'error' ? 'danger' : 'warning'" size="small">
          {{ i.level === 'error' ? '错误' : '警告' }}
        </el-tag>
        <span class="issue-msg">{{ i.message }}</span>
        <span class="issue-node">{{ i.node }}</span>
      </button>
      <template #footer>
        <el-button size="small" @click="showIssues = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.clock-view {
  --clock-ink: var(--mx-titlebar-bg);
  --clock-muted: #51627a;
  --clock-border: #d5deeb;
  --clock-paper: var(--mx-bg);
  --clock-subtle: #edf3fb;
  --clock-field: #f7f9fc;
  --clock-wire: #778ba4;
  --clock-active-wire: var(--mx-accent);
  --clock-radius: var(--mx-radius-card);
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--clock-paper);
}
.clock-header {
  padding: 12px 20px;
  background: var(--mx-surface);
  border-bottom: 1px solid var(--clock-border);
}
.page-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
  justify-content: space-between;
}
.page-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.page-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--clock-radius);
  color: var(--mx-accent);
  background: var(--mx-accent-soft);
}
.page-title {
  font-size: 19px;
  font-weight: 700;
  line-height: 1.18;
  margin: 0 0 3px;
  color: var(--clock-ink);
}
.page-sub {
  font-size: 12px;
  color: var(--clock-muted);
}
.clock-readouts {
  display: flex;
  flex-wrap: wrap;
  max-width: 100%;
  border: 1px solid var(--clock-border);
  background: var(--clock-field);
  border-radius: var(--clock-radius);
}
.clock-readout {
  display: grid;
  gap: 3px;
  min-width: 88px;
  padding: 6px 12px;
  border: 0;
  background: transparent;
  border-radius: 0;
  color: var(--clock-ink);
  font: inherit;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  text-align: left;
  cursor: pointer;
}
.clock-readout + .clock-readout {
  border-inline-start: 1px solid var(--clock-border);
}
.clock-readout:first-child {
  border-start-start-radius: 7px;
  border-end-start-radius: 7px;
}
.clock-readout:last-child {
  border-start-end-radius: 7px;
  border-end-end-radius: 7px;
}
.clock-readout span {
  color: var(--clock-muted);
  font: 11px var(--mx-font-mono);
}
.clock-readout strong {
  font-size: 14px;
  font-weight: 650;
}
.clock-readout:enabled:hover,
.clock-readout.readout-selected {
  background: var(--mx-accent-soft);
}
.toolbar-actions,
.view-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.toolbar-actions :deep(.el-button + .el-button),
.view-controls :deep(.el-button + .el-button) {
  margin-left: 0;
}
.toolbar-fill {
  flex: 1;
}
.clock-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 295px;
  min-width: 180px;
}
.search-match {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  white-space: nowrap;
  border: 0;
  background: transparent;
  color: var(--mx-accent);
  font: inherit;
  cursor: pointer;
}
.search-match.no-match {
  color: var(--clock-muted);
  cursor: default;
}
.clock-ok {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--clock-field);
  color: var(--mx-success);
  font-size: 12px;
}
.view-controls {
  padding: 10px 20px;
}
.segmented {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--clock-radius);
  border: 1px solid var(--clock-border);
  background: var(--clock-subtle);
}
.seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  min-height: 27px;
  padding: 4px 11px;
  font: inherit;
  color: var(--clock-muted);
  cursor: pointer;
  border-radius: 4px;
  white-space: nowrap;
}
.seg-btn.active {
  background: var(--mx-surface);
  color: var(--mx-accent);
  box-shadow: var(--mx-shadow-card);
}
.work-area {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  padding: 0 20px 14px;
}
.table-wrap {
  flex: 1;
  min-width: 0;
  background: var(--mx-surface);
  overflow: auto;
  padding: 12px 16px;
  border: 1px solid var(--clock-border);
  border-radius: var(--clock-radius);
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
.detail-col,
.code-col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
}
.detail-col {
  border: 1px solid var(--clock-border);
  border-radius: var(--clock-radius);
  overflow: hidden;
  background: var(--mx-surface);
}
.detail-header {
  padding: 10px 10px 10px 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--clock-ink);
  background: var(--clock-subtle);
  border-bottom: 1px solid var(--clock-border);
}
.detail-header h2 {
  margin: 0;
  font-size: 14px;
  flex: 1;
  font-weight: 700;
}
.detail-close {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--clock-muted);
  cursor: pointer;
}
.detail-close:hover {
  background: var(--mx-accent-soft);
}
.detail-paths {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--clock-border);
}
.detail-paths :deep(.el-button + .el-button) {
  margin-left: 0;
}
.code-col {
  overflow: hidden;
}
@media (min-width: 761px) {
  .detail-col, .code-col {
    max-width: 44%;
  }
  .both-panels .detail-col, .both-panels .code-col {
    max-width: 34%;
  }
}
@media (max-width: 760px) {
  .work-area {
    flex-direction: column;
    padding: 0 12px 8px;
  }
  .clock-panel-resizer {
    display: none;
  }
  .detail-col, .code-col {
    width: 100% !important;
    margin-top: 4px;
    flex-basis: min(34%, 220px);
  }
  .both-panels .detail-col, .both-panels .code-col {
    flex-basis: min(28%, 180px);
  }
  .clock-header, .view-controls {
    padding-inline: 12px;
  }
}
@media (max-width: 550px) {
  .clock-readouts {
    order: 1;
    width: 100%;
  }
  .clock-readout {
    flex: 1 1 0;
    min-width: 0;
    padding-inline: 6px;
  }
  .clock-readout strong {
    font-size: 12px;
  }
  .view-controls .toolbar-fill {
    display: none;
  }
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
  width: 100%;
  padding: 8px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: start;
  cursor: pointer;
}
.issue-row:hover {
  background: var(--mx-accent-soft);
}
.issue-msg {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
  color: var(--clock-muted);
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

.shortcuts-pop {
  position: absolute;
  right: 20px;
  bottom: 66px;
  width: min(320px, calc(100% - 32px));
  max-height: min(420px, 75%);
  overflow-y: auto;
  background: var(--mx-surface);
  border: 1px solid var(--clock-border);
  border-radius: var(--clock-radius);
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
  border-bottom: 1px solid var(--clock-border);
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
  max-width: 55%;
  font-family: var(--mx-font-mono);
  overflow-wrap: anywhere;
  font-size: 11px;
  color: var(--mx-text);
  background: var(--clock-field);
  border: 1px solid var(--clock-border);
  border-radius: 4px;
  padding: 1px 6px;
}
.shortcuts-desc {
  color: var(--mx-text-secondary);
  text-align: right;
}
</style>
