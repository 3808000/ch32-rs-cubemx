<script setup lang="ts">
// 引脚配置面板（右侧 Detail view）：模式/参数/信号/remap/标签/EXTI。
import { computed } from 'vue'
import { Delete, Unlock } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { remapsOfPin, remapValuesFor } from '@/model/device'
import { usePinOverwrite } from '@/model/pins/pinOverwrite'
import type { PinMode } from '@/model/types'

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite()

const pin = computed(() => {
  if (!store.selectedPin) return null
  return store.deviceData.chip.pins.find((p) => p.name === store.selectedPin) ?? null
})
const assignment = computed(() => (store.selectedPin ? store.assignmentOf(store.selectedPin) : undefined))

const signals = computed(() => {
  if (!store.selectedPin) return []
  const entries = remapsOfPin(store.deviceData, store.selectedPin)
  return [...new Set(entries.map((e) => e.signal))]
})

const remapOptions = computed(() => {
  if (!store.selectedPin || !assignment.value?.function) return []
  return remapValuesFor(store.deviceData, store.selectedPin, assignment.value.function)
})

const isLocked = computed(() => {
  const p = pin.value
  return p?.special && p.special !== 'osc' && !store.unlocked.includes(p.name)
})

const modeOptions: { value: PinMode; label: string }[] = [
  { value: 'INPUT', label: 'GPIO 输入' },
  { value: 'OUTPUT', label: 'GPIO 输出' },
  { value: 'AF', label: '复用功能' },
  { value: 'ANALOG', label: '模拟' },
]

function setMode(mode: PinMode) {
  if (!store.selectedPin) return
  const p = store.selectedPin
  requestOverwrite(p, () => {
    store.setPinAssignment(p, mode, { params: mode === 'INPUT' ? { pull: 'NONE' } : mode === 'OUTPUT' ? { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' } : {} })
  }, '切换模式')
}

function setFunction(signal: string) {
  if (!store.selectedPin) return
  const p = store.selectedPin
  const values = remapValuesFor(store.deviceData, p, signal)
  requestOverwrite(p, () => {
    store.setPinAssignment(p, 'AF', { function: signal, remap: values[0], label: assignment.value?.label })
  }, '切换复用信号')
}

function setRemap(v: number) {
  if (!store.selectedPin || !assignment.value?.function) return
  const p = store.selectedPin
  const fn = assignment.value.function
  const label = assignment.value.label
  requestOverwrite(p, () => {
    store.setPinAssignment(p, 'AF', { function: fn, remap: v, label })
  }, '切换 remap')
}

function setAdcChannel(ch: string) {
  if (!store.selectedPin) return
  const p = store.selectedPin
  requestOverwrite(p, () => {
    store.setPinAssignment(p, 'ANALOG', { function: ch, label: assignment.value?.label })
  }, '切换 ADC 通道')
}

function updateParams(key: string, value: unknown) {
  if (!store.selectedPin) return
  store.updatePinParams(store.selectedPin, { [key]: value })
}

function setExti(enabled: boolean) {
  if (!store.selectedPin) return
  store.updatePinParams(store.selectedPin, { exti: enabled ? { enabled: true, edge: 'RISING' } : { enabled: false, edge: 'RISING' } })
}
function setExtiEdge(edge: 'RISING' | 'FALLING' | 'BOTH') {
  if (!store.selectedPin) return
  store.updatePinParams(store.selectedPin, { exti: { enabled: true, edge } })
}

function clearPin() {
  if (!store.selectedPin) return
  const p = store.selectedPin
  requestOverwrite(p, () => store.clearPin(p), '清除配置')
}

function unlock() {
  if (!store.selectedPin) return
  store.unlockSpecial(store.selectedPin)
  store.notify(`${store.selectedPin} 已解锁（NRST 需同时修改选项字节）`, 'warning')
}

const speedOptions = [
  { value: 'LOW', label: 'Low (2MHz)' },
  { value: 'MEDIUM', label: 'Medium (10MHz)' },
  { value: 'HIGH', label: 'High (50MHz)' },
]
</script>

<template>
  <div class="pin-panel">
    <template v-if="pin">
      <div class="panel-head">
        <span class="panel-title">Detail view</span>
      </div>
      <div class="pin-hero">
        <div class="pin-name">{{ pin.name }}</div>
        <div class="pin-sub">Pin {{ pin.number }} · {{ pin.type }}{{ pin.ft ? ' · 5V 容忍' : '' }}</div>
      </div>

      <el-alert v-if="isLocked" type="warning" :closable="false" class="lock-alert">
        <template #title>
          特殊引脚（{{ pin.special?.toUpperCase() }}）默认锁定
        </template>
        <el-button size="small" :icon="Unlock" @click="unlock">显式解锁</el-button>
      </el-alert>

      <div class="form-block" :class="{ disabled: isLocked }">
        <div class="form-row">
          <label>模式</label>
          <el-select :model-value="assignment?.mode ?? ''" placeholder="未配置" size="small" @change="setMode">
            <el-option v-for="m in modeOptions" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
        </div>

        <template v-if="assignment?.mode === 'OUTPUT'">
          <div class="form-row">
            <label>输出类型</label>
            <el-select :model-value="assignment.params.outputType ?? 'PUSH_PULL'" size="small" @change="(v: string) => updateParams('outputType', v)">
              <el-option label="推挽" value="PUSH_PULL" />
              <el-option label="开漏" value="OPEN_DRAIN" />
            </el-select>
          </div>
          <div class="form-row">
            <label>速度</label>
            <el-select :model-value="assignment.params.speed ?? 'HIGH'" size="small" @change="(v: string) => updateParams('speed', v)">
              <el-option v-for="s in speedOptions" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </div>
          <div class="form-row">
            <label>初始电平</label>
            <el-select :model-value="assignment.params.level ?? 'LOW'" size="small" @change="(v: string) => updateParams('level', v)">
              <el-option label="低" value="LOW" />
              <el-option label="高" value="HIGH" />
            </el-select>
          </div>
        </template>

        <template v-if="assignment?.mode === 'INPUT'">
          <div class="form-row">
            <label>上下拉</label>
            <el-select :model-value="assignment.params.pull ?? 'NONE'" size="small" @change="(v: string) => updateParams('pull', v)">
              <el-option label="无" value="NONE" />
              <el-option label="上拉" value="UP" />
              <el-option label="下拉" value="DOWN" />
            </el-select>
          </div>
          <div class="form-row">
            <label>EXTI</label>
            <el-switch :model-value="assignment.params.exti?.enabled ?? false" size="small" @change="(v: boolean) => setExti(v)" />
          </div>
          <div v-if="assignment.params.exti?.enabled" class="form-row">
            <label>触发边沿</label>
            <el-select :model-value="assignment.params.exti?.edge ?? 'RISING'" size="small" @change="(v: 'RISING'|'FALLING'|'BOTH') => setExtiEdge(v)">
              <el-option label="上升沿" value="RISING" />
              <el-option label="下降沿" value="FALLING" />
              <el-option label="双边沿" value="BOTH" />
            </el-select>
          </div>
        </template>

        <template v-if="assignment?.mode === 'AF'">
          <div class="form-row">
            <label>信号</label>
            <el-select :model-value="assignment.function ?? ''" size="small" filterable @change="setFunction">
              <el-option v-for="s in signals" :key="s" :label="s" :value="s" />
            </el-select>
          </div>
          <div v-if="remapOptions.length" class="form-row">
            <label>Remap</label>
            <el-select :model-value="assignment.remap" size="small" @change="setRemap">
              <el-option v-for="r in remapOptions" :key="r" :label="`remap ${r}`" :value="r" />
            </el-select>
          </div>
        </template>

        <template v-if="assignment?.mode === 'ANALOG'">
          <div class="form-row">
            <label>ADC 通道</label>
            <el-select :model-value="assignment.function ?? ''" size="small" @change="setAdcChannel">
              <el-option v-for="c in pin.adc ?? []" :key="c" :label="c" :value="c" />
            </el-select>
          </div>
        </template>

        <div v-if="assignment" class="form-row">
          <label>标签</label>
          <el-input :model-value="assignment.label ?? ''" size="small" placeholder="如 LED_RUN" @change="(v: string) => store.setPinLabel(pin!.name, v)" />
        </div>

        <div v-if="assignment" class="form-actions">
          <el-button size="small" type="danger" plain :icon="Delete" @click="clearPin">清除配置</el-button>
        </div>
      </div>

      <div v-if="(pin.adc ?? []).length" class="info-block">
        <div class="info-title">可用 ADC 通道</div>
        <div class="info-tags">
          <el-tag v-for="c in pin.adc" :key="c" size="small" type="info">{{ c }}</el-tag>
        </div>
      </div>
      <div v-if="signals.length" class="info-block">
        <div class="info-title">可用复用信号（{{ signals.length }}）</div>
        <div class="info-tags">
          <el-tag v-for="s in signals" :key="s" size="small">{{ s }}</el-tag>
        </div>
      </div>
    </template>
    <div v-else class="empty-detail">
      <p>点击封装图上的引脚开始配置</p>
      <p class="muted">支持 GPIO 输入/输出、复用功能、模拟通道与 EXTI</p>
    </div>
  </div>
</template>

<style scoped>
.pin-panel {
  width: var(--mx-detail-panel-w);
  flex-shrink: 0;
  border-left: 1px solid var(--mx-border);
  background: var(--mx-surface);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.panel-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--mx-border);
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
}
.pin-hero {
  padding: 16px;
  border-bottom: 1px solid var(--mx-border);
}
.pin-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--mx-accent);
}
.pin-sub {
  font-size: 12px;
  color: var(--mx-text-muted);
  margin-top: 2px;
}
.lock-alert {
  margin: 12px 16px 0;
}
.form-block {
  padding: 12px 16px;
}
.form-block.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
}
.form-row label {
  font-size: 13px;
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}
.form-row .el-select,
.form-row .el-input {
  width: 180px;
}
.form-actions {
  margin-top: 10px;
}
.info-block {
  padding: 12px 16px;
  border-top: 1px solid var(--mx-border);
}
.info-title {
  font-size: 12px;
  color: var(--mx-text-muted);
  margin-bottom: 8px;
}
.info-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.empty-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--mx-text-secondary);
  padding: 24px;
  text-align: center;
}
.muted {
  color: var(--mx-text-muted);
  font-size: 12px;
}
</style>