<script setup lang="ts">
// 导出计划预览（纯视图）：展示「将新建/更新/删除/保留/冲突」计数与关键文件清单。
// plan 由 services/projectExport 的 inspect() 构建；本组件不做任何 IO 或决策。
import { computed } from 'vue'
import type { ExportPlanEntry } from '@/model/types'
import type { ExportPlanSummary } from '@/services/exportPlan'

const props = defineProps<{
  plan: ExportPlanEntry[]
  summary: ExportPlanSummary
  /** 目标目录是否可读；false 表示退化为全量写入 */
  readable: boolean
  /** 是否读到上次导出 manifest */
  manifestFound?: boolean
}>()

const creates = computed(() => props.plan.filter((e) => e.action === 'create'))
const updates = computed(() => props.plan.filter((e) => e.action === 'update'))
const deletes = computed(() => props.plan.filter((e) => e.action === 'delete'))
const writes = computed(() => [...creates.value, ...updates.value])
const conflictCount = computed(() => props.summary.conflict)
</script>

<template>
  <div class="plan-preview">
    <el-alert
      v-if="!readable"
      type="warning"
      :closable="false"
      show-icon
      title="无法读取目标目录内容，将退化为全量写入：无法检测冲突，也不会保留已有的 project_file / vendor 文件。"
      class="plan-alert"
    />
    <div class="plan-summary">
      <el-tag type="success" effect="plain">将新建 {{ summary.create }}</el-tag>
      <el-tag type="primary" effect="plain">更新 {{ summary.update }}</el-tag>
      <el-tag type="danger" effect="plain">删除 {{ summary.delete }}</el-tag>
      <el-tag type="info" effect="plain">保留 {{ summary.unchanged }}</el-tag>
      <el-tag type="warning" effect="plain">冲突 {{ conflictCount }}</el-tag>
    </div>
    <p v-if="!manifestFound && readable" class="plan-hint">
      目标目录没有上次导出清单：已有且内容不同的文件会按冲突处理（默认跳过，不覆盖）。
    </p>
    <p v-else-if="conflictCount > 0" class="plan-hint">
      冲突文件默认跳过；请在下方向导中逐个选择处理方式后再确认写入。
    </p>

    <el-collapse v-if="deletes.length > 0" class="plan-collapse">
      <el-collapse-item :title="`将删除的生成文件（${deletes.length}，仅 generated 组）`" name="delete">
        <code v-for="item in deletes" :key="item.path" class="plan-path">{{ item.path }}</code>
      </el-collapse-item>
    </el-collapse>
    <el-collapse v-if="writes.length > 0" class="plan-collapse">
      <el-collapse-item
        :title="`将写入的文件（新建 ${creates.length} / 更新 ${updates.length}）`"
        name="write"
      >
        <code v-for="item in writes" :key="item.path" class="plan-path">{{ item.path }}</code>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.plan-preview {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-surface);
  padding: 12px;
  margin-bottom: 12px;
  min-width: 0;
}
.plan-alert {
  margin-bottom: 10px;
}
.plan-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.plan-hint {
  margin: 8px 0 0;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  line-height: 1.5;
}
.plan-collapse {
  margin-top: 6px;
}
.plan-path {
  display: block;
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  padding: 2px 0;
  overflow-wrap: anywhere;
}
</style>