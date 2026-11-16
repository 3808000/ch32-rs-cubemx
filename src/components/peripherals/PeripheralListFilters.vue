<script setup lang="ts">
// 外设列表过滤区：搜索 + Filter by Category + Show(All/已启用) + 实例总数。
import { Search } from '@element-plus/icons-vue'

defineProps<{
  categoryOptions: { value: string; label: string }[]
  totalCount: number
}>()

const search = defineModel<string>('search', { required: true })
const categoryFilter = defineModel<string>('categoryFilter', { required: true })
const showAll = defineModel<boolean>('showAll', { required: true })
</script>

<template>
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
</template>

<style scoped>
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
</style>