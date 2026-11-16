<script setup lang="ts">
// Analog（ADC）的通道分配面板：每通道显示已分配引脚或数据层默认引脚，未分配标黄。
import CollapsiblePanel from '@/components/common/CollapsiblePanel.vue'
import type { AdcChannelRow } from '@/components/peripherals/types'

defineProps<{ rows: AdcChannelRow[] }>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <CollapsiblePanel v-model:open="open" title="通道分配">
    <div class="pc-pin-status">
      <div v-for="row in rows" :key="row.channel" class="pc-pin-row" :class="{ missing: !row.assignedPin }">
        <span class="pc-pin-role">{{ row.channel }}</span>
        <span class="pc-pin-val">{{ row.assignedPin ?? row.pin }}</span>
        <span class="pc-pin-note">{{ row.assignedPin ? '已分配' : '未分配' }}</span>
      </div>
      <div class="pc-empty-note">在右侧「ADC 通道」面板中分配或清除通道。</div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
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
.pc-pin-note {
  font-size: 11px;
  color: var(--mx-text-muted);
}
.pc-empty-note {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  padding: 4px 0;
}
</style>