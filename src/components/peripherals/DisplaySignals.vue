<script setup lang="ts">
// 仅展示实例（定时器等）：说明文案 + 从 remap 数据推导的信号映射表。
import type { DisplaySignalRow } from '@/components/peripherals/types'

defineProps<{ rows: DisplaySignalRow[] }>()
</script>

<template>
  <div class="pc-display-note">该实例当前版本仅展示信号映射（来自 remap 数据），不支持参数配置。</div>
  <table v-if="rows.length" class="pc-display-table">
    <thead>
      <tr>
        <th>信号</th>
        <th>引脚（remap）</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.signal">
        <td class="pc-signal">{{ row.signal }}</td>
        <td>{{ row.list.map((x) => `${x.pin} (${x.remap})`).join('、') }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.pc-display-note {
  padding: 0 16px 8px;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.pc-display-table {
  width: calc(100% - 32px);
  margin: 0 16px 14px;
  border-collapse: collapse;
  font-size: var(--mx-fz-label);
}
.pc-display-table th {
  text-align: left;
  color: var(--mx-text-muted);
  font-weight: 600;
  padding: 4px 8px;
  border-bottom: 1px solid var(--mx-border);
}
.pc-display-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--mx-border);
  color: var(--mx-text-secondary);
}
.pc-signal {
  font-family: var(--mx-font-mono);
}
</style>