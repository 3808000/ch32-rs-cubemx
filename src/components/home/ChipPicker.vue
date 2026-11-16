<script lang="ts">
// 芯片对比选择器的纯函数（M6）：行构建 / 搜索过滤 / 生成支持判定。
// 随组件导出，供 tests/chipPicker.test.ts 直接验证；数据全部来自已注册芯片的 chip.json，不引入任何外部数据。
import type { ChipData } from '@/model/types'

/** 生成器当前支持的 HAL 后端；其余后端（如 ch58x-hal）尚未接入，诚实标注但不禁止选择。 */
export const SUPPORTED_HAL_BACKEND = 'ch32-hal'

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

/** 生成支持判定：halBackend 缺省视为 ch32-hal（与 ChipData 注释一致）。 */
export function chipGenerationSupported(chip: ChipData): boolean {
  return (chip.halBackend ?? SUPPORTED_HAL_BACKEND) === SUPPORTED_HAL_BACKEND
}

/** 构建对比行，并按芯片名做确定性排序（码点序，与输入顺序无关）。 */
export function buildChipRows(devices: readonly ChipData[]): ChipRow[] {
  return devices
    .map((d) => ({
      chip: d.chip,
      package: d.package,
      pinCount: d.pins.length,
      flash: d.flash,
      sram: d.sram,
      core: d.core,
      target: d.target,
      toolchain: d.nightly ? ('nightly' as const) : ('stable' as const),
      halBackend: d.halBackend ?? SUPPORTED_HAL_BACKEND,
      supported: chipGenerationSupported(d),
    }))
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
</script>

<script setup lang="ts">
// 可搜索的芯片对比选择器：点击行或「新建工程」按钮 → emit('pick', chipId)，由父视图走现有新建流程。
import { computed, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { InputInstance } from 'element-plus'
import { listDevices } from '@/model/device'

const emit = defineEmits<{
  /** 选中芯片：交由 HomeView 的 newProject 走既有流程（switchDevice + 跳 Pinout + 通知） */
  (e: 'pick', chip: string): void
}>()

const query = ref('')
const searchInput = ref<InputInstance>()

const rows = computed(() => filterChipRows(buildChipRows(listDevices()), query.value))

function onRowClick(row: ChipRow): void {
  emit('pick', row.chip)
}

/** 供父视图在「从 MCU 开始」时聚焦搜索框。 */
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
      <span class="picker-hint">点击行即可新建工程；数据来自仓库已注册芯片</span>
    </div>
    <el-table
      :data="rows"
      size="small"
      row-key="chip"
      class="picker-table"
      @row-click="onRowClick"
    >
      <el-table-column prop="chip" label="芯片" min-width="130" show-overflow-tooltip />
      <el-table-column prop="package" label="封装" width="90" />
      <el-table-column prop="pinCount" label="引脚数" width="70" align="right" />
      <el-table-column prop="flash" label="Flash" width="70" align="right" />
      <el-table-column prop="sram" label="RAM" width="70" align="right" />
      <el-table-column prop="core" label="内核" min-width="170" show-overflow-tooltip />
      <el-table-column prop="target" label="目标 triple" min-width="210" show-overflow-tooltip />
      <el-table-column label="工具链" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.toolchain === 'nightly' ? 'warning' : 'info'">
            {{ row.toolchain }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="生成支持" width="140">
        <template #default="{ row }">
          <el-tag v-if="row.supported" size="small" type="success">可生成</el-tag>
          <el-tooltip v-else content="该芯片的 HAL 后端尚未接入代码生成，仍可配置引脚与时钟" placement="top">
            <el-tag size="small" type="warning">生成器暂不支持</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="onRowClick(row)">
            新建工程
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <span class="picker-empty">没有匹配的芯片</span>
      </template>
    </el-table>
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
  gap: 12px;
  flex-wrap: wrap;
}
.picker-hint {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.picker-table :deep(.el-table__row) {
  cursor: pointer;
}
.picker-empty {
  color: var(--mx-text-muted);
  font-size: 12px;
}
</style>
