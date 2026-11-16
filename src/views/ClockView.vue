<script setup lang="ts">
// Clock 视图：页头 + 工具栏（搜索 / Resolve clock issues / Reset clock）+ 分段 Graphic/Table
// + 画布或表格 + 右侧 Detail view + Code preview。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Search, RefreshLeft, WarningFilled, CircleCheck } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { computeClock, resolveClockIssues, validateClock } from '@/model/clock'
import { applyClockControl, buildClockTree, formatMhz } from '@/model/clock/tree'
import type { ClockNodeControl, ClockTreeLayout } from '@/model/clock/tree'
import ClockCanvas from '../components/ClockCanvas.vue'
import ClockDetail from '../components/ClockDetail.vue'
import CodePreviewPanel from '../components/CodePreviewPanel.vue'
import { subscribeClockFocus, takeClockFocus } from '@/components/clock/clockFocus'

const store = useProjectStore()
const spec = computed(() => store.deviceData.clock)
const cfg = computed(() => store.clockConfig)
const freqs = computed(() => computeClock(spec.value, cfg.value))
const issues = computed(() => validateClock(spec.value, cfg.value))
/** 布局兜底：构建异常时回退空布局并展示错误信息，避免整页空白 */
const EMPTY_LAYOUT: ClockTreeLayout = { width: 960, height: 520, nodes: [], edges: [], groups: [] }
const layoutState = computed<{ layout: ClockTreeLayout; error: string | null }>(() => {
  try {
    return { layout: buildClockTree(spec.value, cfg.value, freqs.value, issues.value), error: null }
  } catch (e) {
    return { layout: EMPTY_LAYOUT, error: e instanceof Error ? e.message : String(e) }
  }
})
const layout = computed(() => layoutState.value.layout)
const layoutError = computed(() => layoutState.value.error)
const layoutReady = computed(() => layout.value.nodes.length > 0)

const viewMode = ref<'graphic' | 'table'>('graphic')
const showDetail = ref(true)
const showCode = ref(false)
const search = ref('')
const selectedId = ref<string | null>(null)
const showIssues = ref(false)

function onControlChange(control: ClockNodeControl, value: string | number) {
  store.setClock(applyClockControl(cfg.value, control, value))
}

function resetClock() {
  store.resetClock()
  store.notify('时钟已重置为芯片默认档', 'info')
}

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

// 表格视图数据
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
  })),
)
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
      <el-button size="small" type="primary" :icon="RefreshLeft" @click="resetClock">Reset clock</el-button>
    </div>

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
        @focus="focusNode"
        @control-change="onControlChange"
        @toggle-lock="toggleLock"
      />
      <div v-else class="table-wrap">
        <el-table :data="filteredRows" size="small" highlight-current-row @row-click="onRowClick">
          <el-table-column prop="label" label="节点" min-width="140" />
          <el-table-column prop="id" label="ID" width="90" />
          <el-table-column prop="input" label="输入频率" width="110" />
          <el-table-column prop="output" label="输出频率" width="110" />
          <el-table-column prop="max" label="上限" width="100" />
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

      <div v-if="showDetail" class="detail-col">
        <ClockDetail :node-id="selectedId" @focus="focusNode" />
      </div>

      <CodePreviewPanel v-if="showCode" context="clock" />
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
</style>
