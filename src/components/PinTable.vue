<script setup lang="ts">
// 引脚表格视图：与封装图共用 PinoutView 的 PinFilter / 九态，不再维护独立搜索。
import { computed, nextTick, ref, watch } from 'vue'
import type { TableInstance } from 'element-plus'
import { useProjectStore } from '@/controllers/project'
import { remapsOfPin } from '@/model/device'
import {
  pinMatchesFilter,
  pinStateColors,
  pinStateLabel,
  type PinFilter,
  type PinStateId,
} from '@/model/pins/pinFilter'

const props = defineProps<{
  /** 统一过滤条件（搜索 + Show 状态 + Type），与 PackageCanvas 同一份数据 */
  filter: PinFilter
  /** 引脚名 → 九态（由 PinoutView 统一派生） */
  pinStates: Record<string, PinStateId>
}>()

const store = useProjectStore()
const tableRef = ref<TableInstance>()

function stateOf(pinName: string): PinStateId {
  return props.pinStates[pinName] ?? 'unassigned'
}

const rows = computed(() =>
  store.deviceData.chip.pins
    .filter((p) => pinMatchesFilter(p, store.assignmentOf(p.name), stateOf(p.name), props.filter))
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

function select(name: string) {
  store.selectPin(name)
}

interface TableRow {
  name: string
  state: PinStateId
}

function rowClassName({ row }: { row: TableRow }): string {
  if (row.state === 'error') return 'conflict-row'
  if (row.state === 'warning') return 'warning-row'
  if (row.name === store.selectedPin) return 'selected-row'
  return ''
}

function onRowClick(row: TableRow) {
  select(row.name)
}

/** 搜索建议/图形选中联动：把当前选中行滚动到可视区域并高亮。 */
watch(
  () => store.selectedPin,
  async (name) => {
    if (!name) return
    await nextTick()
    const index = rows.value.findIndex((r) => r.name === name)
    if (index < 0) return
    tableRef.value?.setCurrentRow(rows.value[index])
    tableRef.value?.scrollTo({ top: Math.max(0, index * 40 - 80) })
  },
  { immediate: true },
)
</script>

<template>
  <div class="pin-table-wrap">
    <div class="table-toolbar">
      <span class="count">{{ rows.length }} / {{ store.deviceData.chip.pins.length }} 个引脚</span>
      <span class="hint">过滤条件与 Graphic view 共用</span>
    </div>
    <el-table ref="tableRef" :data="rows" size="small" height="100%" :row-class-name="rowClassName" @row-click="onRowClick">
      <el-table-column prop="number" label="#" width="50" />
      <el-table-column prop="name" label="引脚" width="80" />
      <el-table-column prop="type" label="类型" width="70" />
      <el-table-column label="状态" width="96">
        <template #default="{ row }">
          <span class="state-cell">
            <span class="state-dot" :style="{ background: row.stateBg, borderColor: row.stateBorder }"></span>
            {{ row.stateLabel }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="side" label="边" width="70" />
      <el-table-column prop="mode" label="模式" width="90" />
      <el-table-column prop="function" label="信号" min-width="120" />
      <el-table-column prop="remap" label="Remap" width="70" />
      <el-table-column prop="label" label="标签" min-width="100" />
      <el-table-column prop="signals" label="可用信号数" width="90" />
      <el-table-column label="特殊" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.special" size="small" type="info">{{ row.special }}</el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <template #empty>
        <span class="empty">没有匹配当前过滤条件的引脚</span>
      </template>
    </el-table>
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
.count {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.hint {
  font-size: 12px;
  color: var(--mx-text-muted);
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