<script setup lang="ts">
// 生成前检查面板（M7 决议入页）：原 CheckDialog 的列表本体改为页内常驻组件。
// errors 阻止生成、warnings 需页内勾选确认（确认 checkbox 由父视图持有）；
// 点击条目按 target 定位：引脚 → selectPin + Pinout；外设 → openPeripheral；
// 时钟节点 → setView('clock') + requestClockFocus（跨视图聚焦）。
import { computed } from 'vue'
import { useProjectStore } from '@/controllers/project'
import type { PreflightItem, PreflightReport, PreflightTarget } from '@/model/preflight'
import { requestClockFocus } from '@/components/clock/clockFocus'

const props = defineProps<{ report: PreflightReport }>()

const store = useProjectStore()
const hasErrors = computed(() => props.report.errors.length > 0)
const hasWarnings = computed(() => props.report.warnings.length > 0)
const empty = computed(() => !hasErrors.value && !hasWarnings.value)

function targetLabel(t: PreflightTarget): string {
  if (t.view === 'clock') return t.node ? `时钟 · ${t.node}` : '时钟'
  if (t.view === 'peripherals') return t.peripheral ? `外设 · ${t.peripheral}` : '外设 / NVIC / DMA'
  if (t.view === 'project-settings') return '工程设置'
  return t.pin ? `引脚 · ${t.pin}` : '引脚'
}

/** 定位：切视图/选中目标（页内面板无需关闭自身，跳转即露出目标）。 */
function locate(item: PreflightItem) {
  const t = item.target
  if (t.pin) store.selectPin(t.pin)
  if (t.view === 'clock') {
    store.setView('clock')
    if (t.node) requestClockFocus(t.node)
  } else if (t.view === 'peripherals') {
    if (t.peripheral) store.openPeripheral(t.peripheral)
    else store.setView('peripherals')
  } else if (t.view === 'project-settings') {
    store.setView('project-settings')
  } else {
    store.setView('pinout')
  }
}
</script>

<template>
  <div class="preflight-panel">
    <div v-if="empty" class="check-ok">检查通过：没有发现错误或警告。</div>

    <section v-if="hasErrors" class="check-group">
      <div class="check-title error">错误（{{ report.errors.length }}）· 必须修复后才能生成</div>
      <button v-for="(item, i) in report.errors" :key="'e' + i" class="check-row error" @click="locate(item)">
        <el-tag type="danger" size="small">错误</el-tag>
        <span class="check-code">{{ item.code }}</span>
        <span class="check-msg">{{ item.message }}</span>
        <span class="check-loc">{{ targetLabel(item.target) }}</span>
      </button>
    </section>

    <section v-if="hasWarnings" class="check-group">
      <div class="check-title warning">警告（{{ report.warnings.length }}）· 勾选确认后可继续生成</div>
      <button v-for="(item, i) in report.warnings" :key="'w' + i" class="check-row warning" @click="locate(item)">
        <el-tag type="warning" size="small">警告</el-tag>
        <span class="check-code">{{ item.code }}</span>
        <span class="check-msg">{{ item.message }}</span>
        <span class="check-loc">{{ targetLabel(item.target) }}</span>
      </button>
    </section>
  </div>
</template>

<style scoped>
.preflight-panel {
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: #f7f9fc;
}
.check-ok {
  padding: 4px 2px;
  font-size: 13px;
  color: var(--mx-success);
}
.check-group {
  margin-bottom: 6px;
}
.check-group:last-child {
  margin-bottom: 0;
}
.check-title {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 2px 6px;
}
.check-title.error {
  color: var(--mx-error);
}
.check-title.warning {
  color: var(--mx-warning);
}
.check-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 7px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.check-row:hover {
  background: var(--mx-accent-soft);
}
.check-code {
  font-family: var(--mx-font-mono);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  color: var(--mx-text-secondary);
}
.check-msg {
  flex: 1;
  color: var(--mx-text-secondary);
  line-height: 1.5;
}
.check-loc {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--mx-accent);
}
</style>