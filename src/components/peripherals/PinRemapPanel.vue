<script setup lang="ts">
// Connectivity（USART/SPI/I2C）的 Remap 档位切换 + 核心 AF 引脚状态行：
// 缺失引脚标黄，无核心角色时提示切换档位。
import CollapsiblePanel from '@/components/common/CollapsiblePanel.vue'
import type { PinStatusRow, RemapOption } from '@/components/peripherals/types'

defineProps<{
  options: RemapOption[]
  remap: number | null
  rows: PinStatusRow[]
  disabled?: boolean
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  (e: 'remap-change', value: number): void
}>()
</script>

<template>
  <CollapsiblePanel v-model:open="open" title="引脚与 Remap">
    <div class="pc-form">
      <div class="pc-form-row">
        <label class="pc-form-label">Remap 档位</label>
        <el-select
          :model-value="remap"
          size="small"
          class="pc-control pc-remap-select"
          :disabled="disabled"
          @change="(v: number) => emit('remap-change', v)"
        >
          <el-option v-for="o in options" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
    </div>
    <div class="pc-pin-status">
      <div v-for="row in rows" :key="row.label" class="pc-pin-row" :class="{ missing: !row.ok }">
        <span class="pc-pin-role">{{ row.label }}</span>
        <span class="pc-pin-val">{{ row.pin ?? '未分配' }}</span>
      </div>
      <div v-if="rows.length === 0" class="pc-empty-note">切换 Remap 档位即可自动分配核心引脚。</div>
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
.pc-remap-select {
  width: 300px;
}
.pc-remap-select :deep(.el-select__wrapper) {
  min-height: 28px;
}
.pc-pin-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0 2px;
}
.pc-pin-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mx-fz-label);
  border-radius: 6px;
  padding: 3px 8px;
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.pc-pin-row .pc-pin-role {
  font-weight: 600;
}
.pc-pin-row.missing {
  background: #fff4e0;
  color: var(--mx-warning);
}
.pc-empty-note {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  padding: 4px 0;
}
</style>