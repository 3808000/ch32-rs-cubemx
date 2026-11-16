<script setup lang="ts">
// 冲突规则表（纯视图）：为每个 conflict 文件逐个选择 skip/overwrite/backup/base-merge。
// 默认值由上层（CodegenDialog）从 plan.resolution 初始化；本组件只上报选择结果。
import type { ConflictResolution, ExportPlanEntry } from '@/model/types'
import type { ConflictResolutions } from '@/services/projectExport'

const props = defineProps<{
  conflicts: ExportPlanEntry[]
  modelValue: ConflictResolutions
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: ConflictResolutions): void
}>()

const options: { value: ConflictResolution; label: string }[] = [
  { value: 'skip', label: '跳过（保留现状）' },
  { value: 'overwrite', label: '覆盖（写入生成内容）' },
  { value: 'backup', label: '备份后覆盖（生成 .bak）' },
  { value: 'base-merge', label: '标记区合并（Cargo.toml）' },
]

function current(entry: ExportPlanEntry): ConflictResolution {
  return props.modelValue[entry.path] ?? entry.resolution ?? 'skip'
}

function change(path: string, value: string | number | boolean | undefined): void {
  if (value !== 'skip' && value !== 'overwrite' && value !== 'backup' && value !== 'base-merge') {
    return
  }
  emit('update:modelValue', { ...props.modelValue, [path]: value })
}
</script>

<template>
  <div v-if="conflicts.length > 0" class="conflict-rules">
    <div class="rules-title">冲突处理（默认跳过，不覆盖你的改动）</div>
    <div v-for="entry in conflicts" :key="entry.path" class="conflict-row">
      <div class="conflict-meta">
        <code class="conflict-path">{{ entry.path }}</code>
        <span class="conflict-group">{{ entry.group }}</span>
      </div>
      <el-tag v-if="entry.group === 'user_code'" type="info" size="small">用户区永不覆盖</el-tag>
      <el-select
        v-else
        :model-value="current(entry)"
        size="small"
        class="conflict-select"
        @change="(v: string) => change(entry.path, v)"
      >
        <el-option v-for="opt in options" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
    </div>
    <p class="rules-hint">
      「标记区合并」只替换 Cargo.toml 中 <code># &gt;&gt;&gt; ch32-cubemx generated &gt;&gt;&gt;</code> 到
      <code># &lt;&lt;&lt; ch32-cubemx generated &lt;&lt;&lt;</code> 之间的内容；其它文件没有标记区时按覆盖处理。
    </p>
  </div>
</template>

<style scoped>
.conflict-rules {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  background: var(--mx-surface);
  padding: 12px;
  margin-bottom: 12px;
  min-width: 0;
}
.rules-title {
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
  margin-bottom: 8px;
}
.conflict-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid var(--mx-border);
}
.conflict-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.conflict-path {
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  overflow-wrap: anywhere;
}
.conflict-group {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--mx-text-muted);
}
.conflict-select {
  flex-shrink: 0;
  width: 190px;
}
.rules-hint {
  margin: 8px 0 0;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  line-height: 1.5;
}
.rules-hint code {
  font-family: var(--mx-font-mono);
  font-size: 11px;
}
</style>