<script setup lang="ts">
// 卡片底部的冲突警告列表（启用但缺引脚等），按级别着色。
import type { Conflict } from '@/model/types'

defineProps<{ conflicts: Conflict[] }>()
</script>

<template>
  <div class="pc-conflicts">
    <div v-for="(c, i) in conflicts" :key="i" class="pc-conflict" :class="c.level">
      <span class="pc-conflict-code">{{ c.code }}</span>
      <span>{{ c.message }}</span>
    </div>
  </div>
</template>

<style scoped>
.pc-conflicts {
  padding: 0 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pc-conflict {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: var(--mx-fz-label);
  border-radius: 6px;
  padding: 5px 10px;
}
.pc-conflict.warning {
  background: #fff4e0;
  color: var(--mx-warning);
}
.pc-conflict.error {
  background: #fde7e7;
  color: var(--mx-error);
}
.pc-conflict-code {
  font-family: var(--mx-font-mono);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
</style>