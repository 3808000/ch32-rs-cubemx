<script setup lang="ts">
// ADC 通道分配面板（右面板 tab）：全通道分配状态 + ANALOG 分配/清除。
import { computed } from 'vue'
import { Histogram } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'
import { adcChannels } from '../lib/allocation'
import { usePinOverwrite } from '../lib/pinOverwrite'
import StatusBadge from './common/StatusBadge.vue'
import EmptyState from './common/EmptyState.vue'

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite()

interface AdcRow {
  channel: string
  pin: string
  assignedPin: string | null
  duplicate: boolean
}

const rows = computed<AdcRow[]>(() =>
  adcChannels(store.deviceData).map((ch) => {
    const owners = store.assignments.filter((a) => a.mode === 'ANALOG' && a.function === ch.channel)
    return {
      channel: ch.channel,
      pin: ch.pin,
      assignedPin: owners[0]?.pin ?? null,
      duplicate: owners.length > 1 || (owners.length > 0 && owners[0].pin !== ch.pin),
    }
  }),
)

/** 分配：把通道对应引脚写为 ANALOG + 通道名（覆盖确认）。 */
async function assign(row: AdcRow) {
  await requestOverwrite(
    row.pin,
    () => store.setPinAssignment(row.pin, 'ANALOG', { function: row.channel }),
    `分配为 ${row.channel} 模拟输入`,
  )
}

/** 清除：清掉当前占用该通道的引脚配置（覆盖确认）。 */
async function clear(row: AdcRow) {
  if (!row.assignedPin) return
  const pin = row.assignedPin
  await requestOverwrite(pin, () => store.clearPin(pin), '清除 ADC 通道')
}
</script>

<template>
  <div class="adc-panel">
    <div v-for="row in rows" :key="row.channel" class="adc-row" :class="{ dup: row.duplicate }">
      <div class="adc-main">
        <span class="adc-channel">{{ row.channel }}</span>
        <span class="adc-pin">{{ row.pin }}</span>
      </div>
      <div class="adc-side">
        <StatusBadge :active="!!row.assignedPin" active-text="已分配" inactive-text="未分配" />
        <div class="adc-actions">
          <el-button size="small" :disabled="row.assignedPin === row.pin && !row.duplicate" @click="assign(row)">分配</el-button>
          <el-button size="small" :disabled="!row.assignedPin" @click="clear(row)">清除</el-button>
        </div>
      </div>
    </div>
    <EmptyState v-if="rows.length === 0" :icon="Histogram" title="无 ADC 通道" description="该芯片数据层未定义 ADC 通道" />
  </div>
</template>

<style scoped>
.adc-panel {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adc-row {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-button);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.adc-row.dup {
  border-color: var(--mx-error);
}
.adc-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.adc-channel {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-text);
}
.adc-pin {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.adc-side {
  display: flex;
  align-items: center;
  gap: 8px;
}
.adc-actions {
  display: flex;
  gap: 4px;
}
.adc-actions .el-button {
  margin: 0;
}
</style>
