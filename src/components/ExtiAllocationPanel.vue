<script setup lang="ts">
// EXTI 分配面板（右面板 tab）：每条 EXTI 线下拉选引脚 + 边沿；
// 分配走 requestOverwrite 确认，写 INPUT 模式 + exti params。
import { computed } from 'vue'
import { Bell } from '@element-plus/icons-vue'
import type { ExtiEdge } from '../types'
import { useProjectStore } from '../stores/project'
import { extiLines } from '../lib/allocation'
import type { ExtiLineOption } from '../lib/allocation'
import { usePinOverwrite } from '../lib/pinOverwrite'
import EmptyState from './common/EmptyState.vue'

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite()

const lines = computed(() => extiLines(store.deviceData))

// 每条线当前占用：扫描启用 EXTI 的引脚，按其通道归位
const lineAssign = computed(() => {
  const m = new Map<number, { pin: string; edge: ExtiEdge }>()
  for (const a of store.assignments) {
    const ex = a.params.exti
    if (!ex?.enabled) continue
    const e = store.deviceData.exti.entries.find((x) => x.pin === a.pin)
    if (e) m.set(e.channel, { pin: a.pin, edge: ex.edge })
  }
  return m
})

/** 选择引脚（null = 清除该线）。覆盖已有配置需确认。 */
async function selectPin(line: ExtiLineOption, pin: string | null) {
  const cur = lineAssign.value.get(line.channel)
  if (pin && cur?.pin === pin) return
  if (pin === null) {
    if (cur) store.updatePinParams(cur.pin, { exti: { enabled: false, edge: cur.edge } })
    return
  }
  const ok = await requestOverwrite(
    pin,
    () => store.setPinAssignment(pin, 'INPUT', { params: { pull: 'UP', exti: { enabled: true, edge: 'RISING' } } }),
    '分配为 EXTI 输入',
  )
  // 分配成功后关闭旧引脚的 EXTI，避免同线双占用
  if (ok && cur) store.updatePinParams(cur.pin, { exti: { enabled: false, edge: cur.edge } })
}

function setEdge(line: ExtiLineOption, edge: ExtiEdge) {
  const cur = lineAssign.value.get(line.channel)
  if (!cur) return
  store.updatePinParams(cur.pin, { exti: { enabled: true, edge } })
}

const edgeOptions: { value: ExtiEdge; label: string }[] = [
  { value: 'RISING', label: '上升沿' },
  { value: 'FALLING', label: '下降沿' },
  { value: 'BOTH', label: '双边沿' },
]
</script>

<template>
  <div class="exti-panel">
    <div v-for="line in lines" :key="line.channel" class="exti-row">
      <div class="exti-line">
        <span class="exti-name">EXTI{{ line.channel }}</span>
        <span class="exti-irq">{{ line.irq }}</span>
      </div>
      <div class="exti-ctrls">
        <el-select
          :model-value="lineAssign.get(line.channel)?.pin ?? ''"
          size="small"
          class="exti-pin-select"
          @change="(v: string) => selectPin(line, v === '' ? null : v)"
        >
          <el-option label="未分配" value="" />
          <el-option v-for="p in line.pins" :key="p" :label="p" :value="p" />
        </el-select>
        <el-select
          :model-value="lineAssign.get(line.channel)?.edge ?? 'RISING'"
          size="small"
          class="exti-edge-select"
          :disabled="!lineAssign.get(line.channel)"
          @change="(v: ExtiEdge) => setEdge(line, v)"
        >
          <el-option v-for="o in edgeOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
    </div>
    <EmptyState v-if="lines.length === 0" :icon="Bell" title="无 EXTI 数据" description="该芯片数据层未定义 EXTI 通道" />
  </div>
</template>

<style scoped>
.exti-panel {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.exti-row {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-button);
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.exti-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.exti-name {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-text);
}
.exti-irq {
  font-size: 11px;
  color: var(--mx-text-muted);
  background: #f2f4f7;
  border-radius: 6px;
  padding: 1px 6px;
}
.exti-ctrls {
  display: flex;
  gap: 8px;
}
.exti-pin-select,
.exti-edge-select {
  flex: 1;
  min-width: 0;
}
</style>
