<script setup lang="ts">
// 生成前 Check 报告（M3.7）：errors 阻止继续，warnings 允许“我已知晓，继续”。
// 点击条目按 target 定位：引脚 → selectPin + Pinout；外设 → openPeripheral；
// 时钟节点 → setView('clock') + requestClockFocus（跨视图聚焦）；工程设置 → 对应视图。
import { computed } from 'vue'
import { useProjectStore } from '@/controllers/project'
import type { PreflightItem, PreflightReport, PreflightTarget } from '@/model/preflight'
import { requestClockFocus } from '@/components/clock/clockFocus'

const props = defineProps<{ report: PreflightReport }>()
const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{
  (e: 'locate', item: PreflightItem): void
  (e: 'continue'): void
}>()

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

/** 定位：先切视图/选中，再抛事件让父级（CodegenDialog）关闭自身以露出目标。 */
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
  emit('locate', item)
  visible.value = false
}

/** 警告确认：先通知父级继续（父级读取 pending 动作），再关闭自身。 */
function continueExport() {
  emit('continue')
  visible.value = false
}
</script>

<template>
  <el-dialog v-model="visible" title="生成前检查" width="600px" append-to-body>
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
      <div class="check-title warning">警告（{{ report.warnings.length }}）· 确认后可继续生成</div>
      <button v-for="(item, i) in report.warnings" :key="'w' + i" class="check-row warning" @click="locate(item)">
        <el-tag type="warning" size="small">警告</el-tag>
        <span class="check-code">{{ item.code }}</span>
        <span class="check-msg">{{ item.message }}</span>
        <span class="check-loc">{{ targetLabel(item.target) }}</span>
      </button>
    </section>

    <template #footer>
      <el-button size="small" @click="visible = false">{{ empty ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!hasErrors && !empty" size="small" type="warning" @click="continueExport">我已知晓，继续</el-button>
      <el-button v-else-if="hasErrors" size="small" type="danger" disabled>存在错误，无法继续</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.check-ok {
  padding: 12px 4px;
  font-size: 13px;
  color: var(--mx-success);
}
.check-group {
  margin-bottom: 14px;
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