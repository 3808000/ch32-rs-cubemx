<script lang="ts">
// Export pinout 的纯函数与选项（M5）：含/不含 AF 两种 CSV 粒度。
// 随组件导出，供 PinoutView 调用与 tests/pinTable.test.ts 验证。
import type { ChipPin, PinAssignment } from '@/model/types'

export type PinoutExportFlavor = 'without-af' | 'with-af'

export interface PinoutExportFlavorMeta {
  id: PinoutExportFlavor
  label: string
}

/** 菜单顺序对齐 CubeMX2：简化版在前，完整版在后。 */
export const PINOUT_EXPORT_FLAVORS: PinoutExportFlavorMeta[] = [
  { id: 'without-af', label: 'Without Alternate Functions' },
  { id: 'with-af', label: 'With Alternate Functions' },
]

/** CSV 单元格转义：含逗号/引号/换行时加引号并双写内部引号。 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 生成 Export pinout CSV（全部芯片引脚，按数据层顺序）。
 * without-af：number,name,mode,label；
 * with-af：追加 function/remap 与可用信号（用 | 连接，避免与逗号分隔符冲突）。
 */
export function buildPinoutCsv(
  pins: readonly ChipPin[],
  assignmentOf: (pin: string) => PinAssignment | undefined,
  flavor: PinoutExportFlavor,
  signalsOf: (pin: string) => string[] = () => [],
): string {
  const withAf = flavor === 'with-af'
  const header = withAf
    ? ['number', 'name', 'mode', 'function', 'remap', 'label', 'signals']
    : ['number', 'name', 'mode', 'label']
  const lines = [header.join(',')]
  for (const pin of pins) {
    const a = assignmentOf(pin.name)
    const cells: (string | number | undefined)[] = withAf
      ? [pin.number, pin.name, a?.mode, a?.function, a?.remap, a?.label, signalsOf(pin.name).join('|')]
      : [pin.number, pin.name, a?.mode, a?.label]
    lines.push(cells.map(csvCell).join(','))
  }
  return lines.join('\n')
}

/** 导出文件名：<chip>-pinout-<YYYY-MM-DD>.csv（本地日期）。 */
export function pinoutCsvFileName(chip: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${chip}-pinout-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`
}
</script>

<script setup lang="ts">
// Pinout 工具栏：统一 PinFilter（搜索类型/文本/Show 九态/Type）+ 建议列表 + 撤回/导出/重置。
// 单一真相：本组件只发出 Partial<PinFilter> 补丁，由 PinoutView 持有并传给图形/表格。
import { computed, ref } from 'vue'
import { Search, Download, RefreshLeft } from '@element-plus/icons-vue'
import {
  PIN_SEARCH_TYPE_META,
  PIN_STATE_META,
  type PinFilter,
  type PinSearchType,
  type PinStateId,
  type PinSuggestion,
} from '@/model/pins/pinFilter'

const props = defineProps<{
  filter: PinFilter
  /** 全芯片实时状态计数（不随搜索变化，对齐 MX2 Show 下拉） */
  stateCounts: Record<PinStateId, number>
  typeCounts: Record<string, number>
  /** 当前过滤命中的引脚数 / 全芯片引脚数 */
  visibleCount: number
  totalCount: number
  suggestions: PinSuggestion[]
}>()

const emit = defineEmits<{
  (e: 'update:filter', patch: Partial<PinFilter>): void
  (e: 'locate', pin: string): void
  (e: 'undo'): void
  (e: 'export-pins', flavor: PinoutExportFlavor): void
  (e: 'export-project'): void
  (e: 'reset'): void
}>()

function patch(next: Partial<PinFilter>) {
  emit('update:filter', next)
}

type TypeOption = 'All' | 'IO' | 'POWER' | 'NC'

const searchType = computed<PinSearchType>({
  get: () => props.filter.searchType,
  set: (v) => patch({ searchType: v }),
})

const searchText = computed<string>({
  get: () => props.filter.text,
  set: (v) => patch({ text: v }),
})

const stateValues = computed<PinStateId[]>({
  get: () => props.filter.states,
  set: (v) => patch({ states: v }),
})

const typeValue = computed<TypeOption>({
  get: () => (props.filter.types.length === 1 ? (props.filter.types[0] as TypeOption) : 'All'),
  set: (v) => patch({ types: v === 'All' ? [] : [v] }),
})

const suggestOpen = ref(false)

/** 建议列表只在有搜索文本时展示；点击项定位并选中引脚。 */
function pickSuggestion(s: PinSuggestion) {
  emit('locate', s.pin)
  suggestOpen.value = false
}

function onInput() {
  // 注意：v-model 的 props 更新在父组件下一次渲染才可见，不能在此读取 searchText 判断
  suggestOpen.value = true
}

function onBlur() {
  suggestOpen.value = false
}

function typeCount(t: string): number {
  return props.typeCounts[t] ?? 0
}

/** el-dropdown 的 command 类型宽松；转成受控的导出粒度。 */
function onExportCommand(command: string | number | object) {
  if (command === 'without-af' || command === 'with-af') emit('export-pins', command)
}
</script>

<template>
  <div class="toolbar">
    <div class="search-wrap">
      <el-select v-model="searchType" size="small" class="search-type" aria-label="搜索类型">
        <el-option v-for="m in PIN_SEARCH_TYPE_META" :key="m.id" :label="m.label" :value="m.id" />
      </el-select>
      <el-input
        v-model="searchText"
        class="search-input"
        placeholder="搜索引脚 / 信号 / 标签 / 位置"
        :prefix-icon="Search"
        size="small"
        clearable
        @focus="suggestOpen = !!searchText.trim()"
        @input="onInput"
        @blur="onBlur"
        @keydown.esc="suggestOpen = false"
      />
      <div v-if="suggestOpen && searchText.trim()" class="suggestions" role="listbox">
        <button
          v-for="s in suggestions"
          :key="s.pin"
          type="button"
          class="suggestion"
          role="option"
          @mousedown.prevent="pickSuggestion(s)"
        >
          <span class="sg-pos">#{{ s.number }}</span>
          <span class="sg-pin">{{ s.pin }}</span>
          <span v-if="s.detail" class="sg-detail">{{ s.detail }}</span>
        </button>
        <div v-if="suggestions.length === 0" class="sg-empty">没有匹配的引脚</div>
      </div>
    </div>

    <div class="filter-item">
      <span class="filter-label">Show</span>
      <el-select
        v-model="stateValues"
        multiple
        collapse-tags
        clearable
        size="small"
        placeholder="All"
        class="show-select"
        aria-label="按引脚状态过滤"
      >
        <el-option
          v-for="m in PIN_STATE_META"
          :key="m.id"
          :label="`${m.label} (${stateCounts[m.id] ?? 0})`"
          :value="m.id"
        />
      </el-select>
      <span class="filter-count">{{ visibleCount }}/{{ totalCount }}</span>
    </div>

    <div class="filter-item">
      <span class="filter-label">Type</span>
      <el-select v-model="typeValue" size="small" style="width: 96px" aria-label="按引脚类型过滤">
        <el-option label="All" value="All" />
        <el-option :label="`IO (${typeCount('IO')})`" value="IO" />
        <el-option :label="`POWER (${typeCount('POWER')})`" value="POWER" />
        <el-option :label="`NC (${typeCount('NC')})`" value="NC" />
      </el-select>
      <span class="filter-count">{{ typeValue === 'All' ? totalCount : typeCount(typeValue) }}</span>
    </div>

    <div class="toolbar-fill"></div>
    <el-button size="small" @click="emit('undo')">撤回</el-button>
    <el-dropdown trigger="click" @command="onExportCommand">
      <el-button size="small">Export pin…</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="f in PINOUT_EXPORT_FLAVORS" :key="f.id" :command="f.id">
            {{ f.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-button size="small" type="primary" :icon="Download" @click="emit('export-project')">导出工程</el-button>
    <el-button size="small" type="primary" :icon="RefreshLeft" @click="emit('reset')">Reset pinout</el-button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 20px;
}
.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-type {
  width: 86px;
  flex-shrink: 0;
}
.search-type :deep(.el-select__wrapper) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.search-input {
  width: 210px;
}
.search-input :deep(.el-input__wrapper) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.suggestions {
  position: absolute;
  top: calc(100% + 2px);
  left: 86px;
  width: 300px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  padding: 4px;
  z-index: 40;
}
.suggestion {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--mx-text-primary);
}
.suggestion:hover,
.suggestion:focus-visible {
  background: var(--mx-accent-soft);
  outline: none;
}
.sg-pos {
  color: var(--mx-text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
}
.sg-pin {
  font-weight: 600;
}
.sg-detail {
  color: var(--mx-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sg-empty {
  padding: 8px;
  font-size: 12px;
  color: var(--mx-text-muted);
  text-align: center;
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
.show-select {
  width: 190px;
}
.filter-count {
  font-size: 12px;
  color: var(--mx-text-muted);
  font-variant-numeric: tabular-nums;
}
.toolbar-fill {
  flex: 1;
}
</style>