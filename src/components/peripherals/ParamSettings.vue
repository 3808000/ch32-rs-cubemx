<script setup lang="ts">
// Parameter Settings 面板：按数据层 ParamSpec 渲染 select / number / switch 控件。
// 所有外设类型的参数表单结构完全同构（由数据驱动），因此由本组件统一承担，避免按类别复制模板。
import type { ParamSpec } from '@/model/types'
import CollapsiblePanel from '@/components/common/CollapsiblePanel.vue'

defineProps<{
  entries: [string, ParamSpec][]
  params: Record<string, string | number | boolean>
  disabled?: boolean
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  (e: 'change', key: string, value: string | number | boolean): void
}>()
</script>

<template>
  <CollapsiblePanel v-model:open="open" title="Parameter Settings">
    <div class="pc-form">
      <div v-for="[key, spec] in entries" :key="key" class="pc-form-row">
        <label class="pc-form-label" :title="key">{{ spec.label ?? key }}</label>
        <el-select
          v-if="spec.kind === 'select'"
          :model-value="String(params[key])"
          size="small"
          class="pc-control"
          :disabled="disabled"
          @change="(v: string) => emit('change', key, v)"
        >
          <el-option v-for="o in spec.options ?? []" :key="String(o)" :label="String(o)" :value="String(o)" />
        </el-select>
        <el-input-number
          v-else-if="spec.kind === 'number'"
          :model-value="Number(params[key])"
          :min="spec.min"
          :max="spec.max"
          size="small"
          class="pc-control"
          :disabled="disabled"
          @change="(v: number | undefined) => v !== undefined && v !== null && emit('change', key, v)"
        />
        <el-switch
          v-else
          :model-value="Boolean(params[key])"
          size="small"
          :disabled="disabled"
          @change="(v: boolean) => emit('change', key, v)"
        />
      </div>
      <div v-if="entries.length === 0" class="pc-empty-note">该实例在数据层没有参数定义。</div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.pc-form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
}
.pc-form-label {
  font-size: var(--mx-fz-body);
  color: var(--mx-text-secondary);
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-control {
  width: 200px;
}
.pc-empty-note {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  padding: 4px 0;
}
</style>