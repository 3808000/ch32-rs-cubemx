<script lang="ts">
// 芯片选择器的纯函数（M6 建表 / M9 对齐 MX2 第一步）：行构建、全列排序、逐列过滤、
// 分页、列可见性、CSV 导出与 Continue 门禁。
// 随组件导出，供 tests/chipPicker.test.ts 直接验证；数据全部来自已注册芯片的 chip.json，不引入任何外部数据。
import type { ChipData } from '@/model/types'

/** 生成器当前支持的 HAL 后端（M11 ch58x-hal、M17 ch5xx-hal）；其余后端诚实标注但不禁止选择。 */
export const SUPPORTED_HAL_BACKENDS: readonly string[] = ['ch32-hal', 'ch58x-hal', 'ch5xx-hal']

/** halBackend 缺省时的后端（与 ChipData 注释一致）。 */
const DEFAULT_HAL_BACKEND = 'ch32-hal'

/** 对比表一行：字段全部派生自 ChipData，不做任何臆造。 */
export interface ChipRow {
  chip: string
  package: string
  pinCount: number
  flash: string
  sram: string
  core: string
  target: string
  toolchain: 'stable' | 'nightly'
  halBackend: string
  /** 生成器是否支持该芯片的 HAL 后端（徽标判定） */
  supported: boolean
}

/** 表格列 id（与 ChipRow 字段一一对应；操作列已移除，行点击即选中）。 */
export type ChipColumnId =
  | 'chip'
  | 'package'
  | 'pinCount'
  | 'flash'
  | 'sram'
  | 'core'
  | 'target'
  | 'toolchain'
  | 'supported'

export interface ChipColumnMeta {
  id: ChipColumnId
  label: string
}

/** 列顺序即表格/CSV 的默认顺序；芯片名列禁止隐藏。 */
export const CHIP_COLUMNS: ChipColumnMeta[] = [
  { id: 'chip', label: '芯片' },
  { id: 'package', label: '封装' },
  { id: 'pinCount', label: '引脚数' },
  { id: 'flash', label: 'Flash' },
  { id: 'sram', label: 'RAM' },
  { id: 'core', label: '内核' },
  { id: 'target', label: '目标 triple' },
  { id: 'toolchain', label: '工具链' },
  { id: 'supported', label: '生成支持' },
]

/** 分页可选页大小（对齐 MX2 Rows per page）。 */
export const CHIP_PAGE_SIZES = [5, 10, 20] as const

/** 排序方向：null 表示回到默认芯片名升序。 */
export type ChipSortDir = 'asc' | 'desc' | null

/** 生成支持判定：halBackend 缺省视为 ch32-hal（与 ChipData 注释一致）。 */
export function chipGenerationSupported(chip: ChipData): boolean {
  return SUPPORTED_HAL_BACKENDS.includes(chip.halBackend ?? DEFAULT_HAL_BACKEND)
}

/** 构建对比行，并按芯片名做确定性排序（码点序，与输入顺序无关）。 */
export function buildChipRows(devices: readonly ChipData[]): ChipRow[] {
  return devices
    .map((d) => {
      const halBackend = d.halBackend ?? DEFAULT_HAL_BACKEND
      // M17：工具链以默认后端的 nightlyByBackend 为准（CH582 默认 ch5xx → nightly）
      const nightly = d.nightlyByBackend?.[halBackend] ?? d.nightly
      return {
        chip: d.chip,
        package: d.package,
        pinCount: d.pins.length,
        flash: d.flash,
        sram: d.sram,
        core: d.core,
        target: d.target,
        toolchain: nightly ? ('nightly' as const) : ('stable' as const),
        halBackend,
        supported: chipGenerationSupported(d),
      }
    })
    .sort((a, b) => (a.chip < b.chip ? -1 : a.chip > b.chip ? 1 : 0))
}

/** 搜索：按芯片名 / 封装 / 内核做大小写不敏感子串匹配；空（含纯空白）查询返回全量。 */
export function filterChipRows(rows: readonly ChipRow[], query: string): ChipRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...rows]
  return rows.filter(
    (r) =>
      r.chip.toLowerCase().includes(q) ||
      r.package.toLowerCase().includes(q) ||
      r.core.toLowerCase().includes(q),
  )
}

/** 芯片名比较（码点序，作为所有排序的最终稳定键）。 */
function compareChipName(a: ChipRow, b: ChipRow): number {
  return a.chip < b.chip ? -1 : a.chip > b.chip ? 1 : 0
}

/** 容量字符串 → 字节数（'16K' / '896K' / '1M' / 纯数字），供 Flash/RAM 数值排序（MX2 按数值而非字典序）。 */
export function memoryValue(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)/i.exec(text.trim())
  if (!m) return Number.NaN
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  return unit === 'm' ? n * 1024 * 1024 : unit === 'k' ? n * 1024 : n
}

/**
 * 全列排序：key/dir 为空时回到默认芯片名升序；数值列按数值、布尔列按 0/1、
 * Flash/RAM 按容量字节数、其余按小写字符串比较。同值时始终用芯片名升序兜底，保证确定性且不修改输入。
 */
export function sortChipRows(
  rows: readonly ChipRow[],
  key: ChipColumnId | null = null,
  dir: ChipSortDir = null,
): ChipRow[] {
  const copy = [...rows]
  if (!key || !dir) return copy.sort(compareChipName)
  const sign = dir === 'desc' ? -1 : 1
  return copy.sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    let cmp: number
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
      cmp = Number(va) - Number(vb)
    } else if (key === 'flash' || key === 'sram') {
      const na = memoryValue(String(va))
      const nb = memoryValue(String(vb))
      cmp = (Number.isNaN(na) ? 0 : na) - (Number.isNaN(nb) ? 0 : nb)
    } else {
      const sa = String(va).toLowerCase()
      const sb = String(vb).toLowerCase()
      cmp = sa < sb ? -1 : sa > sb ? 1 : 0
    }
    return cmp === 0 ? compareChipName(a, b) : sign * cmp
  })
}

/** 逐列过滤：每列大小写不敏感子串，多列同时命中（AND）；空串视为不过滤。 */
export function filterChipRowsByColumn(
  rows: readonly ChipRow[],
  filters: Partial<Record<ChipColumnId, string>>,
): ChipRow[] {
  const active = Object.entries(filters)
    .map(([key, value]) => [key as ChipColumnId, (value ?? '').trim().toLowerCase()] as const)
    .filter(([, q]) => q !== '')
  if (active.length === 0) return [...rows]
  return rows.filter((row) =>
    active.every(([key, q]) => String(row[key]).toLowerCase().includes(q)),
  )
}

/** 全部列过滤输入的初始值（空串）。 */
export function defaultChipColumnFilters(): Record<ChipColumnId, string> {
  const out = {} as Record<ChipColumnId, string>
  for (const col of CHIP_COLUMNS) out[col.id] = ''
  return out
}

/** 默认全部可见（与 MX2 Columns 菜单一致），用户可逐列关闭。 */
export function defaultChipColumnVisibility(): Record<ChipColumnId, boolean> {
  const out = {} as Record<ChipColumnId, boolean>
  for (const col of CHIP_COLUMNS) out[col.id] = true
  return out
}

/** 列可见性变更：芯片名列是识别行的最小信息，禁止隐藏（返回未变更副本）。 */
export function setChipColumnVisible(
  visibility: Record<ChipColumnId, boolean>,
  id: ChipColumnId,
  visible: boolean,
): Record<ChipColumnId, boolean> {
  if (id === 'chip' && !visible) return { ...visibility }
  return { ...visibility, [id]: visible }
}

/** 总页数（至少 1，空表也显示第 1 页）。 */
export function chipPageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, Math.floor(size) || 1)))
}

/** 页码（1 起）→ 当前页切片；页码越界夹到有效范围，页大小非法时回退 1。 */
export function paginateRows<T>(rows: readonly T[], page: number, size: number): T[] {
  const pageSize = Math.max(1, Math.floor(size) || 1)
  const current = Math.min(
    Math.max(1, Math.floor(page) || 1),
    chipPageCount(rows.length, pageSize),
  )
  const start = (current - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/** CSV 单元格转义：含逗号/双引号/换行时整体加引号，内部双引号翻倍。 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Export list：导出当前可见列 + 过滤后全部行（调用方传入未分页行）。
 * 带 UTF-8 BOM 便于 Excel 识别中文表头；列顺序按 visibleColumns 给定顺序，未知 id 忽略。
 */
export function buildChipCsv(
  rows: readonly ChipRow[],
  visibleColumns: readonly ChipColumnId[],
): string {
  const ids = visibleColumns.filter(
    (id, index) => visibleColumns.indexOf(id) === index && CHIP_COLUMNS.some((c) => c.id === id),
  )
  const labels = ids.map((id) => CHIP_COLUMNS.find((c) => c.id === id)?.label ?? id)
  const lines = [labels.map(csvCell).join(',')]
  for (const row of rows) lines.push(ids.map((id) => csvCell(row[id])).join(','))
  return '\uFEFF' + lines.join('\r\n')
}

/** Continue 门禁：必须选中一个非空芯片 id。类型谓词便于调用方收窄。 */
export function canContinueSelection(selected: string | null): selected is string {
  return typeof selected === 'string' && selected.trim() !== ''
}

/** 底部栏选中计数（MX2：Selected: N line(s)，单选模型只有 0/1）。 */
export function selectionLineCount(selected: string | null): number {
  return canContinueSelection(selected) ? 1 : 0
}
</script>

<script setup lang="ts">
// M9 芯片选择器（对齐 MX2 Select MCU）：行点击=选中（受控 modelValue），不再立即建工程；
// 全列排序 + 逐列过滤 + 分页 + Columns 菜单 + Export list（CSV）。
// 内嵌向导时（embedded）隐藏自身底部栏，由向导 footer 承担 Previous/Cancel/Continue。
import { computed, reactive, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Download, Grid, Search } from '@element-plus/icons-vue'
import type { InputInstance } from 'element-plus'
import { listDevices } from '@/model/device'

const props = withDefaults(
  defineProps<{
    /** 受控选中芯片（null = 未选） */
    modelValue: string | null
    /** 向导内嵌：隐藏自身底部栏 */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', chip: string | null): void
  /** 点击 Continue：仅在已选中时发出 */
  (e: 'continue', chip: string): void
}>()

const query = ref('')
const searchInput = ref<InputInstance>()
const columnFilters = reactive<Record<ChipColumnId, string>>(defaultChipColumnFilters())
const visibleColumns = reactive<Record<ChipColumnId, boolean>>(defaultChipColumnVisibility())
const sortKey = ref<ChipColumnId | null>(null)
const sortDir = ref<ChipSortDir>(null)
const page = ref(1)
const pageSize = ref<number>(CHIP_PAGE_SIZES[0])
const sortOrders: ('ascending' | 'descending' | null)[] = ['ascending', 'descending', null]

/** 全局搜索 → 逐列过滤 → 排序（分页前保留全量供 Export list）。 */
const filteredRows = computed(() =>
  filterChipRowsByColumn(filterChipRows(buildChipRows(listDevices()), query.value), columnFilters),
)
const sortedRows = computed(() => sortChipRows(filteredRows.value, sortKey.value, sortDir.value))
const pageCount = computed(() => chipPageCount(sortedRows.value.length, pageSize.value))
const pagedRows = computed(() => paginateRows(sortedRows.value, page.value, pageSize.value))

/** 分页范围文案（MX2：1-5 of 514）。 */
const rangeText = computed(() => {
  const total = sortedRows.value.length
  if (total === 0) return '0 of 0'
  const start = (page.value - 1) * pageSize.value + 1
  const end = Math.min(page.value * pageSize.value, total)
  return `${start}-${end} of ${total}`
})

/** 当前可见列（按 CHIP_COLUMNS 顺序），Export list 使用。 */
const visibleColumnIds = computed(() =>
  CHIP_COLUMNS.filter((c) => visibleColumns[c.id]).map((c) => c.id),
)

// 过滤/排序/页大小变化回到第一页；数据变少时夹取当前页。
watch([query, columnFilters, sortKey, sortDir, pageSize], () => {
  page.value = 1
})
watch(pageCount, (n) => {
  if (page.value > n) page.value = n
})

function selectRow(row: ChipRow): void {
  emit('update:modelValue', row.chip)
}

/** 行高亮：受控选中态（Element Plus 无单选高亮语义，用 row-class-name）。 */
function rowClassName({ row }: { row: ChipRow }): string {
  return row.chip === props.modelValue ? 'selected-row' : ''
}

/** el-table 自定义排序：ascending/descending → asc/desc；第三次点击 null 回默认芯片名序。 */
function onSortChange(payload: { prop: string | null; order: 'ascending' | 'descending' | null }): void {
  const meta = CHIP_COLUMNS.find((c) => c.id === payload.prop)
  if (!meta || !payload.order) {
    sortKey.value = null
    sortDir.value = null
    return
  }
  sortKey.value = meta.id
  sortDir.value = payload.order === 'ascending' ? 'asc' : 'desc'
}

function onColumnToggle(id: ChipColumnId, visible: boolean): void {
  Object.assign(visibleColumns, setChipColumnVisible(visibleColumns, id, visible))
}

function onContinue(): void {
  if (!canContinueSelection(props.modelValue)) return
  emit('continue', props.modelValue)
}

/** Export list：可见列 + 过滤后全部行（不分页）→ BOM CSV 浏览器下载。 */
function exportList(): void {
  const csv = buildChipCsv(sortedRows.value, visibleColumnIds.value)
  const fileName = `ch32-mcu-list-${new Date().toISOString().slice(0, 10)}.csv`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 供父视图聚焦搜索框（保留 M6 能力）。 */
function focusSearch(): void {
  searchInput.value?.focus()
}

defineExpose({ focusSearch })
</script>

<template>
  <div class="chip-picker">
    <div class="picker-head">
      <el-input
        ref="searchInput"
        v-model="query"
        placeholder="搜索芯片 / 封装 / 内核"
        :prefix-icon="Search"
        size="small"
        style="width: 260px"
        clearable
      />
      <span class="picker-hint">点击行选中芯片；数据来自仓库已注册芯片</span>
      <span class="picker-head-spacer" />
      <el-dropdown trigger="click" :hide-on-click="false">
        <el-button size="small" :icon="Grid">Columns</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <div class="columns-menu">
              <el-checkbox
                v-for="col in CHIP_COLUMNS"
                :key="col.id"
                :model-value="visibleColumns[col.id]"
                :disabled="col.id === 'chip'"
                @change="onColumnToggle(col.id, $event === true)"
              >
                {{ col.label }}
              </el-checkbox>
              <p class="columns-hint">芯片名为保留列，不可隐藏</p>
            </div>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button size="small" :icon="Download" @click="exportList">Export list</el-button>
    </div>

    <el-table
      :data="pagedRows"
      size="small"
      row-key="chip"
      class="picker-table"
      :max-height="embedded ? 340 : undefined"
      :row-class-name="rowClassName"
      @row-click="selectRow"
      @sort-change="onSortChange"
    >
      <el-table-column
        v-if="visibleColumns.chip"
        prop="chip"
        min-width="150"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">芯片</span>
            <el-input
              v-model="columnFilters.chip"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.package"
        prop="package"
        min-width="110"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">封装</span>
            <el-input
              v-model="columnFilters.package"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.pinCount"
        prop="pinCount"
        label="引脚数"
        width="96"
        align="right"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">引脚数</span>
            <el-input
              v-model="columnFilters.pinCount"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.flash"
        prop="flash"
        width="86"
        align="right"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">Flash</span>
            <el-input
              v-model="columnFilters.flash"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.sram"
        prop="sram"
        width="86"
        align="right"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">RAM</span>
            <el-input
              v-model="columnFilters.sram"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.core"
        prop="core"
        min-width="180"
        show-overflow-tooltip
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">内核</span>
            <el-input
              v-model="columnFilters.core"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.target"
        prop="target"
        min-width="210"
        show-overflow-tooltip
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">目标 triple</span>
            <el-input
              v-model="columnFilters.target"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.toolchain"
        prop="toolchain"
        width="100"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">工具链</span>
            <el-input
              v-model="columnFilters.toolchain"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
        <template #default="{ row }">
          <el-tag size="small" :type="row.toolchain === 'nightly' ? 'warning' : 'info'">
            {{ row.toolchain }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        v-if="visibleColumns.supported"
        prop="supported"
        width="150"
        sortable="custom"
        :sort-orders="sortOrders"
      >
        <template #header>
          <div class="col-head">
            <span class="col-label">生成支持</span>
            <el-input
              v-model="columnFilters.supported"
              class="col-filter"
              size="small"
              placeholder="Search"
              clearable
              @click.stop
              @mousedown.stop
            />
          </div>
        </template>
        <template #default="{ row }">
          <el-tag v-if="row.supported" size="small" type="success">可生成</el-tag>
          <el-tooltip v-else :content="`${row.halBackend} 后端尚未接入代码生成，仍可配置引脚与时钟`" placement="top">
            <el-tag size="small" type="warning">生成器暂不支持</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <template #empty>
        <span class="picker-empty">没有匹配的芯片</span>
      </template>
    </el-table>

    <!-- 独立使用时（Home 底部）的选中/分页/Continue 栏；内嵌向导时隐藏，由向导 footer 承担 -->
    <div v-if="!embedded" class="picker-foot">
      <span class="selected-count">Selected: {{ selectionLineCount(modelValue) }} line(s)</span>
      <span class="picker-foot-spacer" />
      <span class="picker-pager-label">Rows per page:</span>
      <el-select v-model="pageSize" size="small" class="picker-page-size">
        <el-option v-for="size in CHIP_PAGE_SIZES" :key="size" :label="String(size)" :value="size" />
      </el-select>
      <span class="picker-range">{{ rangeText }}</span>
      <el-button
        size="small"
        :icon="ArrowLeft"
        :disabled="page <= 1"
        aria-label="上一页"
        @click="page -= 1"
      />
      <el-button
        size="small"
        :icon="ArrowRight"
        :disabled="page >= pageCount"
        aria-label="下一页"
        @click="page += 1"
      />
      <el-button type="primary" size="small" :disabled="!canContinueSelection(modelValue)" @click="onContinue">
        Continue
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.chip-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.picker-hint {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.picker-head-spacer {
  flex: 1;
}
.columns-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 12px;
}
.columns-menu :deep(.el-checkbox) {
  height: 26px;
}
.columns-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--mx-text-muted);
}
.picker-table :deep(.el-table__row) {
  cursor: pointer;
}
.picker-table :deep(.el-table__header th.el-table__cell) {
  padding: 6px 0;
  vertical-align: top;
}
.picker-table :deep(.el-table__row.selected-row > td.el-table__cell) {
  background: var(--mx-accent-soft);
}
.picker-table :deep(.el-table__row.selected-row:hover > td.el-table__cell) {
  background: var(--mx-accent-soft);
}
/* 表头单元格：标签 + 逐列 Search 两行；排序箭头绝对定位到右上角，避免挤占输入框宽度 */
.picker-table :deep(.el-table__header th.el-table__cell .cell) {
  position: relative;
  padding-right: 30px;
}
.picker-table :deep(.el-table__header .caret-wrapper) {
  position: absolute;
  top: 8px;
  right: 4px;
}
.col-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}
.col-label {
  font-weight: 600;
  cursor: pointer;
}
.col-filter :deep(.el-input__wrapper) {
  padding: 0 6px;
  box-shadow: 0 0 0 1px var(--mx-border) inset;
}
.col-filter :deep(.el-input__inner) {
  height: 22px;
  font-size: 11px;
}
.picker-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 2px;
}
.selected-count {
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.picker-foot-spacer {
  flex: 1;
}
.picker-pager-label {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.picker-page-size {
  width: 78px;
}
.picker-range {
  font-size: 12px;
  color: var(--mx-text-muted);
  white-space: nowrap;
}
.picker-empty {
  color: var(--mx-text-muted);
  font-size: 12px;
}
</style>
