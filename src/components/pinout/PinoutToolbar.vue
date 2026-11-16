<script setup lang="ts">
// Pinout 工具栏：搜索 / Show 与 Type 过滤（含计数）/ 已配置计数，以及撤回、导出引脚、导出工程、重置操作。
import { Search, Download, RefreshLeft } from '@element-plus/icons-vue'

defineProps<{
  ioCount: number
  typeFilterCount: number
  configuredCount: number
}>()

const search = defineModel<string>('search', { required: true })
const showFilter = defineModel<string>('showFilter', { required: true })
const typeFilter = defineModel<'All' | 'IO' | 'POWER' | 'NC'>('typeFilter', { required: true })

const emit = defineEmits<{
  (e: 'undo'): void
  (e: 'export-pins'): void
  (e: 'export-project'): void
  (e: 'reset'): void
}>()
</script>

<template>
  <div class="toolbar">
    <el-input v-model="search" placeholder="搜索" :prefix-icon="Search" size="small" style="width: 180px" clearable />
    <div class="filter-item">
      <span class="filter-label">Show</span>
      <el-select v-model="showFilter" size="small" style="width: 80px">
        <el-option label="All" value="All" />
        <el-option label="IO" value="IO" />
        <el-option label="POWER" value="POWER" />
      </el-select>
      <span class="filter-count">{{ ioCount }}</span>
    </div>
    <div class="filter-item">
      <span class="filter-label">Type</span>
      <el-select v-model="typeFilter" size="small" style="width: 90px">
        <el-option label="All" value="All" />
        <el-option label="IO" value="IO" />
        <el-option label="POWER" value="POWER" />
        <el-option label="NC" value="NC" />
      </el-select>
      <span class="filter-count">{{ typeFilterCount }}</span>
    </div>
    <div class="filter-item">
      <span class="filter-label">已配置</span>
      <span class="filter-count">{{ configuredCount }}</span>
    </div>
    <div class="toolbar-fill"></div>
    <el-button size="small" @click="emit('undo')">撤回</el-button>
    <el-button size="small" @click="emit('export-pins')">Export pin…</el-button>
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
.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label {
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.filter-count {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.toolbar-fill {
  flex: 1;
}
</style>