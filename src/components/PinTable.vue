<script lang="ts">
// 引脚表格的纯函数与常量（M5）：Used only、分页、列可见性。
// 随组件导出，供 tests/pinTable.test.ts 直接验证；过滤语义始终与 PinoutView 的 PinFilter 一致。
import { pinMatchesFilter, type PinFilter, type PinStateId } from '@/model/pins/pinFilter'
import type { ChipPin, PinAssignment } from '@/model/types'

/** 分页可选页大小（默认 25）。 */
export const PIN_TABLE_PAGE_SIZES = [25, 50, 100] as const
export type PinTablePageSize = (typeof PIN_TABLE_PAGE_SIZES)[number]

/** 可切换可见性的列（对齐 CubeMX2 引脚表的 Columns 菜单）。 */
export type PinTableColumnId =
  | 'number'
  | 'name'
  | 'type'
  | 'state'
  | 'side'
  | 'mode'
  | 'function'
  | 'remap'
  | 'label'
  | 'signals'
  | 'special'
  | 'assign'

export interface PinTableColumnMeta {
  id: PinTableColumnId
  label: string
}

/** 默认全部可见（保持 M2 表格的既有信息密度），用户可逐列关闭。 */
export const PIN_TABLE_COLUMNS: PinTableColumnMeta[] = [
  { id: 'number', label: '位号' },
  { id: 'name', label: '引脚' },
  { id: 'type', label: '类型' },
  { id: 'state', label: '状态' },
  { id: 'side', label: '边' },
  { id: 'mode', label: '模式' },
  { id: 'function', label: '信号' },
  { id: 'remap', label: 'Remap' },
  { id: 'label', label: '标签' },
  { id: 'signals', label: '可用信号数' },
  { id: 'special', label: '特殊' },
  { id: 'assign', label: '操作' },
]

export function defaultPinTableColumnVisibility(): Record<PinTableColumnId, boolean> {
  const out = {} as Record<PinTableColumnId, boolean>
  for (const col of PIN_TABLE_COLUMNS) out[col.id] = true
  return out
}

/** Used only 命中态：已配置 / 保留 / 冲突（错误、警告）。 */
export const PIN_TABLE_USED_STATES: PinStateId[] = ['configured', 'reserved', 'error', 'warning']

export function isUsedPinState(state: PinStateId): boolean {
  return PIN_TABLE_USED_STATES.includes(state)
}

/** 表格行可见性 = 统一 PinFilter 命中 &&（Used only 关闭或状态属于已使用）。 */
export function pinVisibleInTable(
  pin: ChipPin,
  assignment: PinAssignment | undefined,
  state: PinStateId,
  filter: PinFilter,
  usedOnly: boolean,
): boolean {
  if (!pinMatchesFilter(pin, assignment, state, filter)) return false
  return !usedOnly || isUsedPinState(state)
}

/** 总页数（至少 1，空表也显示第 1 页）。 */
export function pinTablePageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, Math.floor(pageSize))))
}

/** 页码（1 起）→ 当前页切片；页码越界夹到有效范围。 */
export function pinTablePageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, Math.floor(pageSize))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pinTablePageCount(rows.length, size))
  const start = (current - 1) * size
  return rows.slice(start, start + size)
}

/** 行下标 → 所在页码（1 起）；负下标视为第 1 页。 */
export function pinTablePageOfIndex(index: number, pageSize: number): number {
  if (index < 0) return 1
  return Math.floor(index / Math.max(1, Math.floor(pageSize))) + 1
}
</script>

<script setup lang="ts">
// 引脚表格视图：与封装图共用 PinoutView 的 PinFilter / 九态，不再维护独立搜索。
// M5 升级：Used only、25/50/100 分页、Columns 列可见性、未配置行内 Assign signal。
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { TableInstance } from 'element-plus'
import { useProjectStore } from '@/controllers/project'
import { remapsOfPin } from '@/model/device'
import { pinStateColors, pinStateLabel } from '@/model/pins/pinFilter'
import { getPreference, setPreference } from '@/services/uiPreferences'

const props = defineProps<{
  /** 统一过滤条件（搜索 + Show 状态 + Type），与 PackageCanvas 同一份数据 */
  filter: PinFilter
  /** 引脚名 → 九态（由 PinoutView 统一派生） */
  pinStates: Record<string, PinStateId>
}>()

const emit = defineEmits<{
  /** 行内 Assign signal…：选中引脚并请父视图打开 Detail view（复用现有配置面板） */
  (e: 'configure', pin: string): void
}>()

const store = useProjectStore()
const tableRef = ref<TableInstance>()

function stateOf(pinName: string): PinStateId {
  return props.pinStates[pinName] ?? 'unassigned'
}

const totalPins = computed(() => store.deviceData.chip.pins.length)

const selectedInfo = computed(() => {
  if (!store.selectedPin) return null
  return store.deviceData.chip.pins.find((p) => p.name === store.selectedPin) ?? null
})

// Used only / Columns（默认全部显示，只有命中已配置/保留/冲突的引脚才在 Used only 下保留）
const usedOnly = ref(getPreference('pinout.table.usedOnly'))
const columnVisible = reactive(defaultPinTableColumnVisibility())
// 从偏好恢复列可见性（visibleColumns 为「可见列 id 数组」）
{
  const visible = new Set(getPreference('pinout.table.visibleColumns'))
  for (const col of PIN_TABLE_COLUMNS) columnVisible[col.id] = visible.has(col.id)
}
// 持久化 Used only / 列可见性
watch(usedOnly, (v) => setPreference('pinout.table.usedOnly', v))
watch(
  () => PIN_TABLE_COLUMNS.filter((c) => columnVisible[c.id]).map((c) => c.id),
  (ids) => {
    if (ids.length > 0) setPreference('pinout.table.visibleColumns', ids)
  },
)

const rows = computed(() =>
  store.deviceData.chip.pins
    .filter((p) => {
      const assignment = store.assignmentOf(p.name)
      const state = stateOf(p.name)
      return pinVisibleInTable(p, assignment, state, props.filter, usedOnly.value)
    })
    .map((p) => {
      const a = store.assignmentOf(p.name)
      const state = stateOf(p.name)
      const color = pinStateColors(state, a?.mode)
      return {
        ...p,
        mode: a?.mode ?? '—',
        function: a?.function ?? '—',
        remap: a?.remap ?? '—',
        label: a?.label ?? '',
        signals: remapsOfPin(store.deviceData, p.name).length,
        state,
        stateLabel: pinStateLabel(state),
        stateBg: color.bg,
        stateBorder: color.border,
      }
    }),
)

type PinRow = (typeof rows.value)[number]

// ---------- 分页 ----------
const page = ref(1)
const pageSize = ref<number>(getPreference('pinout.table.pageSize'))
const pageSizes = [...PIN_TABLE_PAGE_SIZES]
watch(pageSize, (v) => setPreference('pinout.table.pageSize', v))
const pageCount = computed(() => pinTablePageCount(rows.value.length, pageSize.value))
const pagedRows = computed(() => pinTablePageSlice(rows.value, page.value, pageSize.value))

// 过滤条件 / Used only / 页大小变化后回到第一页（PinoutView 每次 patch 都会替换 filter 对象）
watch([() => props.filter, usedOnly, pageSize], () => {
  page.value = 1
})
watch(pageCount, (n) => {
  if (page.value > n) page.value = n
})

function select(name: string) {
  store.selectPin(name)
}

/** 行内 Assign：选中该引脚，并让 PinoutView 打开 Detail view（不新建弹窗）。 */
function assignRow(row: PinRow) {
  store.selectPin(row.name)
  emit('configure', row.name)
}

function rowClassName({ row }: { row: PinRow }): string {
  if (row.state === 'error') return 'conflict-row'
  if (row.state === 'warning') return 'warning-row'
  if (row.name === store.selectedPin) return 'selected-row'
  return ''
}

function onRowClick(row: PinRow) {
  select(row.name)
}

/** 搜索建议/图形选中联动：跳到选中行所在页、滚动到可视区域并高亮。 */
async function revealSelected(name: string) {
  const index = rows.value.findIndex((r) => r.name === name)
  if (index < 0) return
  const targetPage = pinTablePageOfIndex(index, pageSize.value)
  if (page.value !== targetPage) page.value = targetPage
  await nextTick()
  const localIndex = pagedRows.value.findIndex((r) => r.name === name)
  if (localIndex < 0) return
  tableRef.value?.setCurrentRow(pagedRows.value[localIndex])
  tableRef.value?.scrollTo({ top: Math.max(0, localIndex * 40 - 80) })
}

watch(
  () => store.selectedPin,
  (name) => {
    if (name) void revealSelected(name)
  },
  { immediate: true },
)
</script>

<template>
  <div class="pin-table-wrap">
    <div class="table-toolbar">
      <span class="selected-info">
        <template v-if="selectedInfo">Selected: #{{ selectedInfo.number }} - {{ selectedInfo.name }}</template>
        <template v-else>Selected: —</template>
      </span>
      <span class="count">{{ rows.length }} / {{ totalPins }} 个引脚</span>
      <span class="hint">过滤条件与 Graphic view 共用</span>
      <div class="toolbar-fill"></div>
      <el-checkbox v-model="usedOnly" size="small" class="used-only">Used only</el-checkbox>
      <el-dropdown trigger="click" :hide-on-click="false">
        <el-button size="small">Columns</el-button>
        <template #dropdown>
          <el-dropdown-menu class="columns-menu">
            <el-dropdown-item v-for="col in PIN_TABLE_COLUMNS" :key="col.id">
              <el-checkbox v-model="columnVisible[col.id]" size="small">{{ col.label }}</el-checkbox>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="table-body">
      <el-table
        ref="tableRef"
        :data="pagedRows"
        size="small"
        height="100%"
        row-key="name"
        :row-class-name="rowClassName"
        @row-click="onRowClick"
      >
        <el-table-column v-if="columnVisible.number" prop="number" label="#" width="50" />
        <el-table-column v-if="columnVisible.name" prop="name" label="引脚" width="80" />
        <el-table-column v-if="columnVisible.type" prop="type" label="类型" width="70" />
        <el-table-column v-if="columnVisible.state" label="状态" width="96">
          <template #default="{ row }">
            <span class="state-cell">
              <span class="state-dot" :style="{ background: row.stateBg, borderColor: row.stateBorder }"></span>
              {{ row.stateLabel }}
            </span>
          </template>
        </el-table-column>
        <el-table-column v-if="columnVisible.side" prop="side" label="边" width="70" />
        <el-table-column v-if="columnVisible.mode" prop="mode" label="模式" width="90" />
        <el-table-column v-if="columnVisible.function" prop="function" label="信号" min-width="120" />
        <el-table-column v-if="columnVisible.remap" prop="remap" label="Remap" width="70" />
        <el-table-column v-if="columnVisible.label" prop="label" label="标签" min-width="100" />
        <el-table-column v-if="columnVisible.signals" prop="signals" label="可用信号数" width="90" />
        <el-table-column v-if="columnVisible.special" label="特殊" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.special" size="small" type="info">{{ row.special }}</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="columnVisible.assign" label="操作" width="128" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.state === 'unassigned' && row.type === 'IO'"
              link
              type="primary"
              size="small"
              class="assign-btn"
              @click.stop="assignRow(row)"
            >
              Assign signal…
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span class="empty">没有匹配当前过滤条件的引脚</span>
        </template>
      </el-table>
    </div>

    <div class="table-footer">
      <span class="page-of">第 {{ page }} / {{ pageCount }} 页</span>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="pageSizes"
        :total="rows.length"
        layout="total, sizes, prev, pager, next"
        size="small"
        background
      />
    </div>
  </div>
</template>

<style scoped>
.pin-table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mx-surface);
  padding: 12px;
}
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.selected-info {
  font-size: 12px;
  font-weight: 600;
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
}
.count,
.hint,
.page-of {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.toolbar-fill {
  flex: 1;
}
.used-only {
  margin-right: 2px;
}
.table-body {
  flex: 1;
  min-height: 0;
}
.state-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.state-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid var(--mx-border);
  flex-shrink: 0;
}
.empty {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 8px;
}
.assign-btn {
  padding: 0;
}
:deep(.conflict-row) {
  background: #fde7e7 !important;
}
:deep(.warning-row) {
  background: #fff4e5 !important;
}
:deep(.selected-row) {
  background: var(--mx-accent-soft) !important;
}
:deep(.el-table__row) {
  cursor: pointer;
}
</style>