<script lang="ts">
// 外设分类推导（PeripheralList / QuickMenu / PeripheralsView 共用）：
// 可配置实例来自 peripherals.json（USART/SPI/I2C/ADC），
// 定时器等其余实例从 remap 信号推导（数据驱动，禁止芯片名分支）。
import type { DeviceData } from '../types'
import { categoryOfPeripheral, peripheralOfSignal } from '../data/device'

export interface PeriCategory {
  key: string
  label: string
  ids: string[]
}

export function derivePeriCategories(data: DeviceData): PeriCategory[] {
  const connectivity = [
    ...data.peripherals.usart.map((i) => i.id),
    ...data.peripherals.spi.map((i) => i.id),
    ...data.peripherals.i2c.map((i) => i.id),
  ]
  const analog = data.peripherals.adc.map((i) => i.id)
  const known = new Set([...connectivity, ...analog])

  // 其余实例（TIM/RCC 等）按类别归类
  const extras = new Map<string, string[]>()
  for (const e of data.remap.entries) {
    const id = peripheralOfSignal(e.signal)
    if (!id || known.has(id)) continue
    const key = categoryOfPeripheral(id) === 'timer' ? 'timers' : 'system'
    const arr = extras.get(key) ?? []
    if (!arr.includes(id)) arr.push(id)
    extras.set(key, arr)
  }

  const out: PeriCategory[] = []
  if (connectivity.length) out.push({ key: 'connectivity', label: 'Connectivity', ids: connectivity })
  if (analog.length) out.push({ key: 'analog', label: 'Analog', ids: analog })
  const timers = extras.get('timers') ?? []
  if (timers.length) out.push({ key: 'timers', label: 'Timers', ids: [...timers].sort() })
  const system = extras.get('system') ?? []
  if (system.length) out.push({ key: 'system', label: 'System', ids: [...system].sort() })
  return out
}
</script>

<script setup lang="ts">
// 外设列表（左 320px）：搜索 + Filter by Category + Show All + 手风琴分类 + 计数徽标
import { computed, reactive, ref } from 'vue'
import { Search, Box } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'
import { derivePeripheralUsage } from '../lib/peripherals'
import EmptyState from './common/EmptyState.vue'

const props = defineProps<{ selectedId?: string | null }>()
const emit = defineEmits<{ select: [id: string] }>()

const store = useProjectStore()
const search = ref('')
const categoryFilter = ref('All')
const showAll = ref(true)
const openMap = reactive<Record<string, boolean>>({})

const categories = computed(() => derivePeriCategories(store.deviceData))

// 启用状态（来自 AF/ANALOG 引脚 + 显式启用）
const enabledMap = computed(() => {
  const m = new Map<string, boolean>()
  for (const u of derivePeripheralUsage(store.config, store.deviceData)) m.set(u.id, u.enabled)
  return m
})

const categoryOptions = computed(() => [
  { value: 'All', label: `All (${totalCount.value})` },
  ...categories.value.map((c) => ({ value: c.label, label: `${c.label} (${c.ids.length})` })),
])

const totalCount = computed(() => categories.value.reduce((n, c) => n + c.ids.length, 0))

const visibleCategories = computed(() => {
  const q = search.value.trim().toLowerCase()
  return categories.value
    .filter((c) => categoryFilter.value === 'All' || c.label === categoryFilter.value)
    .map((c) => ({
      ...c,
      ids: c.ids.filter(
        (id) => (!q || id.toLowerCase().includes(q)) && (showAll.value || enabledMap.value.get(id) === true),
      ),
    }))
    .filter((c) => c.ids.length > 0)
})

function isOpen(key: string) {
  return openMap[key] ?? true
}

function toggleCategory(key: string) {
  openMap[key] = !isOpen(key)
}

function onClickItem(id: string) {
  emit('select', id)
}
</script>

<template>
  <div class="peripheral-list">
    <!-- 过滤行 -->
    <div class="pl-filters">
      <el-input v-model="search" placeholder="搜索外设" :prefix-icon="Search" size="small" clearable />
      <div class="pl-filter-row">
        <span class="pl-filter-label">Filter by Category</span>
        <el-select v-model="categoryFilter" size="small" style="width: 130px">
          <el-option v-for="o in categoryOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
      <div class="pl-filter-row">
        <span class="pl-filter-label">Show</span>
        <el-select :model-value="showAll ? 'all' : 'enabled'" size="small" style="width: 130px" @change="(v: string) => (showAll = v === 'all')">
          <el-option label="All" value="all" />
          <el-option label="已启用" value="enabled" />
        </el-select>
        <span class="pl-count">{{ totalCount }}</span>
      </div>
    </div>

    <!-- 手风琴分类 -->
    <div class="pl-tree">
      <div v-for="cat in visibleCategories" :key="cat.key" class="pl-category">
        <button type="button" class="pl-cat-head" @click="toggleCategory(cat.key)">
          <span class="pl-caret" :class="{ expanded: isOpen(cat.key) }">▸</span>
          <span class="pl-cat-label">{{ cat.label }}</span>
          <span class="pl-cat-badge">{{ cat.ids.length }}</span>
        </button>
        <div v-show="isOpen(cat.key)" class="pl-items">
          <button
            v-for="id in cat.ids"
            :key="id"
            type="button"
            class="pl-item"
            :class="{ selected: props.selectedId === id }"
            @click="onClickItem(id)"
          >
            <span class="pl-item-dot" :class="{ on: enabledMap.get(id) === true }" />
            <span class="pl-item-name">{{ id }}</span>
          </button>
        </div>
      </div>

      <EmptyState
        v-if="visibleCategories.length === 0"
        :icon="Box"
        title="没有匹配的外设"
        description="调整搜索词或分类过滤条件"
      />
    </div>
  </div>
</template>

<style scoped>
.peripheral-list {
  width: var(--mx-list-panel-w);
  flex-shrink: 0;
  background: var(--mx-surface);
  border-right: 1px solid var(--mx-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pl-filters {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--mx-border);
}
.pl-filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pl-filter-label {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-secondary);
  flex-shrink: 0;
  white-space: nowrap;
}
.pl-count {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin-left: auto;
}
.pl-tree {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}
.pl-cat-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 7px 12px;
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
  cursor: pointer;
  text-align: left;
}
.pl-cat-head:hover {
  background: var(--mx-accent-soft);
}
.pl-caret {
  font-size: 10px;
  color: var(--mx-text-muted);
  transition: transform 0.15s;
  display: inline-block;
}
.pl-caret.expanded {
  transform: rotate(90deg);
}
.pl-cat-badge {
  margin-left: auto;
  font-size: 11px;
  color: var(--mx-text-muted);
  background: #f2f4f7;
  border-radius: 8px;
  padding: 1px 8px;
}
.pl-items {
  display: flex;
  flex-direction: column;
}
.pl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 5px 12px 5px 30px;
  font-size: var(--mx-fz-body);
  font-family: var(--mx-font-mono);
  color: var(--mx-text-secondary);
  cursor: pointer;
  text-align: left;
}
.pl-item:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.pl-item.selected {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--mx-accent);
}
.pl-item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d0d5dd;
  flex-shrink: 0;
}
.pl-item-dot.on {
  background: var(--mx-success);
}
</style>
