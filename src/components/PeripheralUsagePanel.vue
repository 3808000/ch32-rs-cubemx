<script setup lang="ts">
// 外设使用汇总（右面板 tab）：pinUsageSummary → 引脚 / 占用驱动表。
import { computed } from 'vue'
import { Odometer } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { pinUsageSummary } from '@/model/pins/usage'
import EmptyState from './common/EmptyState.vue'

const store = useProjectStore()

const rows = computed(() => pinUsageSummary(store.config, store.deviceData))
</script>

<template>
  <div class="usage-panel">
    <table v-if="rows.length" class="usage-table">
      <thead>
        <tr>
          <th style="width: 72px">引脚</th>
          <th>占用</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.pin">
          <td class="u-pin">{{ r.pin }}</td>
          <td>
            <span v-for="d in r.drivers" :key="d" class="u-driver" :class="{ exti: d === 'EXTI' }">{{ d }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-else :icon="Odometer" title="暂无引脚占用" description="启用外设或配置 GPIO 后在此汇总" />
  </div>
</template>

<style scoped>
.usage-panel {
  padding: 8px 12px;
}
.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--mx-fz-label);
}
.usage-table th {
  text-align: left;
  font-weight: 600;
  color: var(--mx-text-muted);
  padding: 4px 6px;
  border-bottom: 1px solid var(--mx-border);
  position: sticky;
  top: 0;
  background: var(--mx-surface);
}
.usage-table td {
  padding: 5px 6px;
  border-bottom: 1px solid var(--mx-border);
  vertical-align: top;
}
.u-pin {
  font-family: var(--mx-font-mono);
  color: var(--mx-text);
  font-weight: 600;
}
.u-driver {
  display: inline-block;
  font-size: 11px;
  border-radius: 5px;
  padding: 1px 7px;
  margin: 1px 4px 1px 0;
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.u-driver.exti {
  background: #e6f4ea;
  color: var(--mx-success);
}
</style>
