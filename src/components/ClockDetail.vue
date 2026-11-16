<script setup lang="ts">
// 时钟详情面板（右侧 360px）：选中节点参数控件 + 问题列表 + 预设快捷 + 目标频率解算。
// 修改即 store.setClock(mergeClockConfig(spec, {...cfg, ...patch}))；锁定节点的控件禁用且不会被预设/解算覆盖。
import { computed, ref } from 'vue'
import { useProjectStore } from '@/controllers/project'
import {
  applyClockPreset,
  isClockNodeLockable,
  isClockNodeLocked,
  matchPreset,
  mergeClockConfig,
  solvePll,
  validateClock,
} from '@/model/clock'
import type { PllCandidate } from '@/model/clock'
import type { ClockConfig, ClockPreset } from '@/model/types'

const props = defineProps<{ nodeId: string | null }>()
const emit = defineEmits<{ (e: 'focus', nodeId: string): void }>()

const store = useProjectStore()
const spec = computed(() => store.deviceData.clock)
const cfg = computed(() => store.clockConfig)

function update(patch: Partial<ClockConfig>) {
  store.setClock(mergeClockConfig(spec.value, { ...cfg.value, ...patch }))
}

function setHxtal(v: number | undefined) {
  if (v !== undefined) update({ hxtalMhz: v })
}

function setSource(v: string) {
  update({ source: v })
}

function setPllSource(v: string) {
  update({ pllSource: v })
}

function setAdcSource(v: string) {
  update({ adc: v })
}

function setBusDivider(v: number | undefined) {
  if (v === undefined) return
  const k = busKey.value
  if (k === 'ahb') update({ ahb: v })
  else if (k === 'apb1') update({ apb1: v })
  else if (k === 'apb2') update({ apb2: v })
}

// ---------- 选中节点 ----------
const NODE_LABELS: Record<string, string> = {
  SYSCLK: 'SYSCLK 系统时钟',
  AHB: 'AHB 总线 (HCLK)',
  APB1: 'APB1 总线 (PCLK1)',
  APB2: 'APB2 总线 (PCLK2)',
  ADC: 'ADC 时钟',
  TIM1: 'TIM1 定时器域',
  TIM2: 'TIM2 定时器域',
}
const nodeLabel = computed(() => {
  if (!props.nodeId) return null
  const s = spec.value.sources.find((x) => x.id === props.nodeId)
  return s ? s.label : (NODE_LABELS[props.nodeId] ?? props.nodeId)
})

// ---------- 锁定 ----------
const lockable = computed(() => (props.nodeId ? isClockNodeLockable(spec.value, props.nodeId) : false))
const locked = computed(() => (props.nodeId ? isClockNodeLocked(cfg.value, props.nodeId) : false))
function toggleLock() {
  if (!props.nodeId) return
  const next = new Set(cfg.value.locked ?? [])
  if (next.has(props.nodeId)) next.delete(props.nodeId)
  else next.add(props.nodeId)
  store.setClock({ ...cfg.value, locked: [...next] })
}

const hse = computed(() => spec.value.sources.find((s) => s.id === 'HSE'))
const showHxtal = computed(() => props.nodeId === 'HSE' && !!hse.value?.hxtal)
const showPll = computed(() => props.nodeId === 'PLL')
const showSysSource = computed(() => props.nodeId === 'SYSCLK')
const busKey = computed<'ahb' | 'apb1' | 'apb2' | null>(() => {
  if (props.nodeId === 'AHB') return 'ahb'
  if (props.nodeId === 'APB1') return 'apb1'
  if (props.nodeId === 'APB2') return 'apb2'
  return null
})
const busSpec = computed(() => (busKey.value ? spec.value[busKey.value] : null))
const showAdc = computed(() => props.nodeId === 'ADC')
const showTim = computed(() => props.nodeId === 'TIM1' || props.nodeId === 'TIM2')

const sourceOptions = computed(() => spec.value.sources.map((s) => ({ value: s.id, label: s.label })))
const pllSourceOptions = computed(() =>
  spec.value.pll.sourceOptions.map((id) => {
    const s = spec.value.sources.find((x) => x.id === id)
    return { value: id, label: s?.label ?? id }
  }),
)
const adcOptions = computed(() => spec.value.adc.options.map((o) => ({ value: o.id, label: o.label })))

function setPllParam(key: string, v: number | undefined) {
  update({ pll: { ...cfg.value.pll, [key]: v ?? 0 } })
}

// ---------- 问题列表 ----------
const issues = computed(() => validateClock(spec.value, cfg.value))

// ---------- 预设 ----------
// UI 高亮：锁定字段视为通配；生成代码仍走 matchPreset 的严格模式
const currentPreset = computed(() => matchPreset(spec.value, cfg.value, { skipLocked: true }))
function applyPreset(p: ClockPreset) {
  // 预设应用跳过锁定节点（保留锁定节点当前值）
  store.setClock(applyClockPreset(spec.value, cfg.value, p))
}

// ---------- 目标频率解算 ----------
const targetMhz = ref(48)
const candidates = ref<PllCandidate[] | null>(null)
/** SYSCLK 锁定在非 PLL 源：解算无候选，给出明确提示 */
const sysclkLockedToNonPll = computed(
  () => isClockNodeLocked(cfg.value, 'SYSCLK') && cfg.value.source !== 'PLL',
)
function solve() {
  candidates.value = solvePll(spec.value, targetMhz.value, undefined, {
    locked: cfg.value.locked,
    current: cfg.value,
  })
}
function applyCandidate(c: PllCandidate) {
  const next: ClockConfig = { ...cfg.value, pll: { ...(cfg.value.pll ?? {}) } }
  if (!isClockNodeLocked(cfg.value, 'SYSCLK')) next.source = 'PLL'
  if (!isClockNodeLocked(cfg.value, 'PLL')) {
    next.pllSource = c.source
    next.pll = { ...(cfg.value.pll ?? {}), ...c.params }
  }
  if (!isClockNodeLocked(cfg.value, 'HSE') && c.hxtalMhz !== undefined) next.hxtalMhz = c.hxtalMhz
  store.setClock(next)
}
function sourceLabel(id: string): string {
  return spec.value.sources.find((s) => s.id === id)?.label ?? id
}
</script>

<template>
  <div class="clock-detail">
    <!-- 选中节点参数 -->
    <div class="section">
      <div class="section-title">{{ nodeLabel ?? '未选择节点' }}</div>
      <template v-if="nodeLabel">
        <!-- 节点锁定：锁定后预设/解算/自动修复保留该节点值 -->
        <div v-if="lockable" class="form-row lock-row">
          <span class="form-label">节点锁定</span>
          <el-switch :model-value="locked" size="small" @update:model-value="toggleLock" />
          <div class="form-hint">
            {{ locked ? '已锁定：预设、解算与自动修复将保留当前值' : '锁定后预设/解算/自动修复不会修改该节点' }}
          </div>
        </div>
        <div v-else class="form-row">
          <span class="form-label">节点锁定</span>
          <span class="lock-na">该节点不可锁定</span>
        </div>

        <!-- HSE 晶振频率 -->
        <div v-if="showHxtal" class="form-row">
          <span class="form-label">晶振频率 (MHz)</span>
          <el-input-number
            :model-value="cfg.hxtalMhz ?? hse?.hxtal?.default"
            :min="hse?.hxtal?.min"
            :max="hse?.hxtal?.max"
            size="small"
            :step="1"
            :disabled="locked"
            @update:model-value="setHxtal"
          />
          <div v-if="hse?.hxtal" class="form-hint">范围 {{ hse.hxtal.min }}~{{ hse.hxtal.max }} MHz</div>
        </div>

        <!-- PLL 源 + 倍频 -->
        <template v-if="showPll">
          <div class="form-row">
            <span class="form-label">PLL 源</span>
            <el-select
              :model-value="cfg.pllSource"
              size="small"
              :disabled="locked"
              style="width: 160px"
              @update:model-value="setPllSource"
            >
              <el-option v-for="o in pllSourceOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </div>
          <div v-for="p in spec.pll.params" :key="p.key" class="form-row">
            <span class="form-label">{{ p.label }}</span>
            <el-select
              :model-value="cfg.pll?.[p.key] ?? p.default"
              size="small"
              :disabled="p.fixed || p.options.length <= 1 || locked"
              style="width: 160px"
              @update:model-value="(v: number) => setPllParam(p.key, v)"
            >
              <el-option v-for="o in p.options" :key="o" :label="`×${o}`" :value="o" />
            </el-select>
            <div v-if="p.fixed" class="form-hint">此芯片该参数固定不可调</div>
          </div>
        </template>

        <!-- SYSCLK 源选择 -->
        <div v-if="showSysSource" class="form-row">
          <span class="form-label">时钟源</span>
          <el-select
            :model-value="cfg.source"
            size="small"
            :disabled="locked"
            style="width: 160px"
            @update:model-value="setSource"
          >
            <el-option v-for="o in sourceOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </div>

        <!-- 总线分频 -->
        <div v-if="busKey && busSpec" class="form-row">
          <span class="form-label">分频</span>
          <el-select
            :model-value="cfg[busKey]"
            size="small"
            :disabled="busSpec.options.length <= 1 || locked"
            style="width: 160px"
            @update:model-value="setBusDivider"
          >
            <el-option v-for="o in busSpec.options" :key="o" :label="`÷${o}`" :value="o" />
          </el-select>
          <div class="form-hint">上限 {{ busSpec.maxMhz }} MHz</div>
        </div>

        <!-- ADC 时钟源 -->
        <div v-if="showAdc" class="form-row">
          <span class="form-label">时钟源</span>
          <el-select
            :model-value="cfg.adc ?? spec.adc.default"
            size="small"
            :disabled="spec.adc.options.length <= 1 || locked"
            style="width: 160px"
            @update:model-value="setAdcSource"
          >
            <el-option v-for="o in adcOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <div v-if="spec.adc.maxMhz !== undefined" class="form-hint">建议上限 {{ spec.adc.maxMhz }} MHz</div>
        </div>

        <!-- TIM 域说明 -->
        <div v-if="showTim" class="tim-info">
          定时器时钟由定时器域模式决定（{{ spec.timerClock === 'sysclk' ? 'SYSCLK 直通' : 'APB 分频 &gt; 1 时 ×2' }}），无需手动配置。
        </div>

        <div v-if="!showHxtal && !showPll && !showSysSource && !busKey && !showAdc && !showTim" class="tim-info">
          该节点无可配置参数。
        </div>
      </template>
    </div>

    <!-- 预设 -->
    <div class="section">
      <div class="section-title">预设</div>
      <div class="preset-list">
        <button
          v-for="p in spec.presets"
          :key="p.id"
          class="preset-btn"
          :class="{ active: currentPreset?.id === p.id }"
          @click="applyPreset(p)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- 目标频率解算 -->
    <div class="section">
      <div class="section-title">目标频率解算</div>
      <div class="solve-row">
        <el-input-number v-model="targetMhz" :min="1" :max="spec.sysclkMaxMhz" size="small" :step="1" />
        <span class="solve-unit">MHz</span>
        <el-button size="small" type="primary" plain @click="solve">解算</el-button>
      </div>
      <div v-if="sysclkLockedToNonPll" class="solve-empty">
          SYSCLK 已锁定在 {{ cfg.source }}，解算需要切换到 PLL（请先解锁 SYSCLK）
        </div>
        <div v-else-if="candidates !== null && candidates.length === 0" class="solve-empty">无可行 PLL 组合命中该频率</div>
      <div v-for="(c, i) in candidates" :key="i" class="cand" @click="applyCandidate(c)">
        <span class="cand-freq">{{ c.outMhz }} MHz</span>
        <span class="cand-src">源 {{ sourceLabel(c.source) }}<template v-if="c.hxtalMhz"> · 晶振 {{ c.hxtalMhz }} MHz</template></span>
      </div>
    </div>

    <!-- 问题列表 -->
    <div class="section issues">
      <div class="section-title">时钟问题</div>
      <div v-if="!issues.length" class="all-clear">配置无问题</div>
      <div v-for="(i, idx) in issues" :key="idx" class="issue" @click="emit('focus', i.node)">
        <span class="lvl" :class="i.level">{{ i.level === 'error' ? '错误' : '警告' }}</span>
        <span class="msg">{{ i.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clock-detail {
  width: var(--mx-detail-panel-w);
  flex-shrink: 0;
  background: var(--mx-surface);
  border-left: 1px solid var(--mx-border);
  overflow-y: auto;
  height: 100%;
}
.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--mx-border);
}
.section-title {
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-text-secondary);
  margin-bottom: 10px;
}
.form-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}
.form-label {
  font-size: var(--mx-fz-body);
  color: var(--mx-text-secondary);
  min-width: 120px;
}
.form-hint {
  width: 100%;
  font-size: 11px;
  color: var(--mx-text-muted);
  padding-left: 128px;
}
.lock-row {
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px dashed var(--mx-border);
}
.lock-na {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.tim-info {
  font-size: 12px;
  color: var(--mx-text-secondary);
  line-height: 1.7;
}
.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preset-btn {
  border: 1px solid var(--mx-border);
  background: var(--mx-surface);
  border-radius: var(--mx-radius-button);
  padding: 5px 12px;
  font-size: 12px;
  color: var(--mx-text-secondary);
  cursor: pointer;
}
.preset-btn:hover {
  border-color: var(--mx-accent);
  color: var(--mx-accent);
}
.preset-btn.active {
  background: var(--mx-accent-soft);
  border-color: var(--mx-accent);
  color: var(--mx-accent);
  font-weight: 600;
}
.solve-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.solve-unit {
  font-size: 12px;
  color: var(--mx-text-muted);
}
.solve-empty {
  margin-top: 8px;
  font-size: 12px;
  color: var(--mx-warning);
}
.cand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  margin-top: 6px;
  border: 1px solid var(--mx-border);
  border-radius: 6px;
  cursor: pointer;
}
.cand:hover {
  background: var(--mx-accent-soft);
  border-color: var(--mx-accent);
}
.cand-freq {
  font-size: 13px;
  font-weight: 600;
  color: var(--mx-accent);
}
.cand-src {
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.issues {
  border-bottom: none;
}
.all-clear {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--mx-success);
  padding: 4px 0;
}
.issue {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.issue:hover {
  background: var(--mx-accent-soft);
}
.lvl {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 5px;
}
.lvl.error {
  color: var(--mx-error);
  background: #fde7e7;
}
.lvl.warning {
  color: var(--mx-warning);
  background: #fdf3e3;
}
.msg {
  color: var(--mx-text-secondary);
}
</style>
