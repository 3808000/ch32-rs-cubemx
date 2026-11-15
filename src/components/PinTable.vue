<script setup lang="ts">
// 引脚表格视图
import { computed, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import { remapsOfPin } from '../data/device'

const store = useProjectStore()
const search = ref('')

const props = defineProps<{
  /** 按引脚类型过滤（空/缺省 = 全部显示），与 PackageCanvas 同名同义 */
  filterTypes?: string[]
}>()

const rows = computed(() => {
  const q = search.value.toLowerCase()
  const types = props.filterTypes
  return store.deviceData.chip.pins
    .filter((p) => !types || types.length === 0 || types.includes(p.type))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.number).includes(q))
    .map((p) => {
      const a = store.assignmentOf(p.name)
      return {
        ...p,
        mode: a?.mode ?? '—',
        function: a?.function ?? '—',
        remap: a?.remap ?? '—',
        label: a?.label ?? '',
        signals: remapsOfPin(store.deviceData, p.name).length,
        conflict: store.conflicts.some((c) => c.level === 'error' && c.pins?.includes(p.name)),
      }
    })
})

function select(name: string) {
  store.selectPin(name)
}

interface TableRow {
  name: string
  conflict: boolean
}

function rowClassName({ row }: { row: TableRow }): string {
  if (row.conflict) return 'conflict-row'
  if (row.name === store.selectedPin) return 'selected-row'
  return ''
}

function onRowClick(row: TableRow) {
  select(row.name)
}
</script>

<template>
  <div class="pin-table-wrap">
    <div class="table-toolbar">
      <el-input v-model="search" placeholder="搜索引脚…" size="small" style="width: 220px" clearable />
      <span class="count">{{ rows.length }} 个引脚</span>
    </div>
    <el-table :data="rows" size="small" height="100%" :row-class-name="rowClassName" @row-click="onRowClick">
      <el-table-column prop="number" label="#" width="50" />
      <el-table-column prop="name" label="引脚" width="80" />
      <el-table-column prop="type" label="类型" width="70" />
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
:deep(.conflict-row) {
  background: #fde7e7 !important;
}
:deep(.selected-row) {
  background: var(--mx-accent-soft) !important;
}
:deep(.el-table__row) {
  cursor: pointer;
}
</style>