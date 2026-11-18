<script setup lang="ts">
// 时钟详情面板（右侧，宽度由宿主视图持久化控制）：选中节点参数控件 + 外设时钟详情 +
// 问题列表 + 预设快捷 + 目标频率解算。
// M15：能力判断改为节点元数据驱动（control.field / badge / periId），删除 ID 硬编码表；
// 外设节点展示源总线/输入/请求/实际/分频/误差，并提供「在外设视图配置」跳转。
import { computed, ref } from 'vue'
import { useProjectStore } from '@/controllers/project'
import {
  applyClockPreset,
  isClockNodeLocked,
  matchPreset,
  mergeClockConfig,
  solvePll,
  validateClock,
} from '@/model/clock'
import { formatMhz } from '@/model/clock/tree'
import { resolveSelectValue } from '@/components/clock/inlineEdit'
import type { ClockNodeControl, ClockTreeNode } from '@/model/clock/tree'
import type { ClockConfig, ClockIssue, ClockPreset, PeripheralClockFreq } from '@/model/types'
import { requestPeripheralFocus } from '@/components/peripherals/peripheralFocus'

const props = withDefaults(
  defineProps<{
    node: ClockTreeNode | null
    periFreq?: PeripheralClockFreq | null
    /** 合并问题列表（validateClock + validatePeripheralClocks）；缺省回退核心校验 */
    issues?: ClockIssue[]
  }>(),
  { periFreq: null, issues: undefined },
)

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'control-change', control: ClockNodeControl, value: string | number): void
}>()

const store = useProjectStore()
const spec = computed(() => store.deviceData.clock)
const cfg = computed(() => store.clockConfig)

function update(patch: Partial<ClockConfig>) {
  store.setClock(mergeClockConfig(spec.value, { ...cfg.value, ...patch }))
}

// ---------- 节点元数据 ----------
const control = computed(() => props.node?.control ?? null)
const field = computed(() => control.value?.field ?? null)
const nodeId = computed(() => props.node?.id ?? null)
const nodeLabel = computed(() => props.node?.label ?? null)
const lockable = computed(() => !!props.node?.lockable)
const locked = computed(() => (nodeId.value ? isClockNodeLocked(cfg.value, nodeId.value) : false))

function toggleLock() {
  if (!nodeId.value) return
  const next = new Set(cfg.value.locked ?? [])
  if (next.has(nodeId.value)) next.delete(nodeId.value)
  else next.add(nodeId.value)
  store.setClock({ ...cfg.value, locked: [...next] })
}

// 能力全部由节点元数据推导（不按节点 ID 硬编码）
const showHxtal = computed(() => field.value === 'hxtalMhz')
const showPll = computed(() => field.value === 'pll')
const showSysSource = computed(() => field.value === 'source')
const showAdcSource = computed(() => field.value === 'adc')
const showAdcDiv = computed(() => field.value === 'adcClkDiv')
const showPeriParam = computed(() => field.value === 'periParam')
const showTim = computed(() => props.node?.group === 'g-tim' && !control.value)
const busKey = computed<'ahb' | 'apb1' | 'apb2' | null>(() => {
  const f = field.value
  return f === 'ahb' || f === 'apb1' || f === 'apb2' ? f : null
})
const busSpec = computed(() => (busKey.value ? spec.value[busKey.value] : null))
const hasConfigControl = computed(
  () =>
    showHxtal.value ||
    showPll.value ||
    showSysSource.value ||
    showAdcSource.value ||
    showAdcDiv.value ||
    showPeriParam.value ||
    busKey.value !== null,
)

const hse = computed(() => spec.value.sources.find((s) => s.id === 'HSE'))
const sourceOptions = computed(() => spec.value.sources.map((s) => ({ value: s.id, label: s.label })))
const pllSourceOptions = computed(() =>
  (spec.value.pll?.sourceOptions ?? []).map((id) => {
    const s = spec.value.sources.find((x) => x.id === id)
    return { value: id, label: s?.label ?? id }
  }),
)
const adcOptions = computed(() => spec.value.adc.options.map((o) => ({ value: o.id, label: o.label })))

/** 外设参数 ParamSpec（number 控件的 min/max/unit 回退来源） */
const periSpec = computed(() => {
  const id = props.node?.periId
  const key = control.value?.paramKey
  if (!id || !key) return null
  const data = store.deviceData.peripherals
  const all = [...data.usart, ...data.spi, ...data.i2c, ...data.adc]
  const inst = all.find((i) => i.id === id)
  return inst?.params[key] ?? null
})

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
function setPllParam(key: string, v: number | undefined) {
  update({ pll: { ...cfg.value.pll, [key]: v ?? 0 } })
}
/** 节点 control 通用写回（adcClkDiv / periParam 与画布同一路由） */
function emitControl(v: string | number) {
  const c = control.value
  if (c) emit('control-change', c, v)
}
/** select 原始字符串 → 选项原值（保留 number 类型）后提交 */
function emitSelect(raw: string) {
  const c = control.value
  if (!c) return
  const v = resolveSelectValue(raw, c)
  if (v !== null) emitControl(v)
}
/** periParam number → ParamSpec min/max 回退 */
const periMin = computed(() => control.value?.min ?? periSpec.value?.min)
const periMax = computed(() => control.value?.max ?? periSpec.value?.max)

// ---------- 外设时钟详情（节点 periId + 派生频率） ----------
const periId = computed(() => props.node?.periId ?? null)
const periInfo = computed(() => {
  const f = props.periFreq
  if (!periId.value) return null
  return {
    category: f?.category ?? null,
    sourceBus: f?.sourceBus ?? '—',
    input: f ? formatMhz(f.inMhz) : '—',
    requested: props.node?.requestedLabel ?? (f?.requested !== null && f?.requested !== undefined ? String(f.requested) : '—'),
    actual: props.node?.actualLabel ?? (f?.actualMhz !== null && f?.actualMhz !== undefined ? formatMhz(f.actualMhz) : '—'),
    divider: f?.dividerLabel ?? '—',
    errorPct: f?.errorPct,
  }
})

function openPeripheral() {
  if (!periId.value) return
  requestPeripheralFocus(periId.value)
  store.setView('peripherals')
}

// ---------- 问题列表 ----------
const issues = computed(() => props.issues ?? validateClock(spec.value, cfg.value))

// ---------- 预设 ----------
// UI 高亮：锁定字段视为通配；生成代码仍走 matchPreset 的严格模式
const currentPreset = computed(() => matchPreset(spec.value, cfg.value, { skipLocked: true }))
function applyPreset(p: ClockPreset) {
  // 预设应用跳过锁定节点（保留锁定节点当前值）
  store.setClock(applyClockPreset(spec.value, cfg.value, p))
}

// ---------- 目标频率解算 ----------
const targetMhz = ref(48)
const candidates = ref<ReturnType<typeof solvePll> | null>(null)
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
function applyCandidate(c: ReturnType<typeof solvePll>[number]) {
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

      <div v-if="!node" class="empty-state">
        <div class="empty-title">未选择节点</div>
        <div class="empty-msg">在时钟树上选择一个节点查看详情</div>
      </div>

      <template v-else>
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
            :min="control?.min ?? hse?.hxtal?.min"
            :max="control?.max ?? hse?.hxtal?.max"
            size="small"
            :step="1"
            :disabled="locked"
            @update:model-value="setHxtal"
          />
          <div v-if="hse?.hxtal" class="form-hint">范围 {{ hse.hxtal.min }}~{{ hse.hxtal.max }} MHz</div>
        </div>

        <!-- PLL 源 + 参数 -->
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
          <div v-for="p in spec.pll?.params ?? []" :key="p.key" class="form-row">
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

        <!-- ADC 时钟源（核心 ADC 节点） -->
        <div v-if="showAdcSource" class="form-row">
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

        <!-- ADC CTLR3.CLK_DIV（raw 寄存器值，外设 ADC 实例节点） -->
        <div v-if="showAdcDiv && control" class="form-row">
          <span class="form-label">{{ control.label }}</span>
          <el-select
            :model-value="String(control.value)"
            size="small"
            :disabled="control.fixed || locked"
            style="width: 160px"
            @update:model-value="emitSelect"
          >
            <el-option v-for="o in control.options ?? []" :key="String(o.value)" :label="o.label" :value="String(o.value)" />
          </el-select>
          <div class="form-hint">raw 寄存器值：语义未核实，全局单值作用于所有 ADC 实例</div>
        </div>

        <!-- 外设参数（periParam：USART baudrate / SPI frequency / I2C speed / ADC samplingClock） -->
        <template v-if="showPeriParam && control">
          <div class="form-row">
            <span class="form-label">{{ control.label }}</span>
            <el-select
              v-if="control.kind === 'select'"
              :model-value="String(control.value)"
              size="small"
              :disabled="control.fixed || locked"
              style="width: 160px"
              @update:model-value="emitSelect"
            >
              <el-option v-for="o in control.options ?? []" :key="String(o.value)" :label="o.label" :value="String(o.value)" />
            </el-select>
            <el-input-number
              v-else
              :model-value="Number(control.value)"
              :min="periMin"
              :max="periMax"
              size="small"
              :disabled="control.fixed || locked"
              @update:model-value="(v: number | undefined) => v !== undefined && v !== null && emitControl(v)"
            />
            <div class="form-hint">{{ control.unit ? `单位 ${control.unit}` : '写入外设参数（与画布控件同一路由）' }}</div>
          </div>
        </template>

        <!-- TIM 域说明 -->
        <div v-if="showTim" class="tim-info">
          定时器时钟由定时器域模式决定（{{ spec.timerClock === 'sysclk' ? 'SYSCLK 直通' : 'APB 分频 &gt; 1 时 ×2' }}），无需手动配置。
        </div>

        <div v-if="!hasConfigControl && !showTim" class="tim-info">
          该节点无可配置参数<template v-if="node.badge">（{{ node.badge }}）</template>。
        </div>
      </template>
    </div>

    <!-- 外设时钟详情（periId 元数据驱动） -->
    <div v-if="periInfo" class="section">
      <div class="section-title">外设时钟</div>
      <div class="kv-row"><span class="kv-label">源总线</span><span class="kv-value">{{ periInfo.sourceBus }}</span></div>
      <div class="kv-row"><span class="kv-label">输入频率</span><span class="kv-value">{{ periInfo.input }}</span></div>
      <div class="kv-row"><span class="kv-label">请求值</span><span class="kv-value">{{ periInfo.requested }}</span></div>
      <div class="kv-row"><span class="kv-label">实际频率</span><span class="kv-value">{{ periInfo.actual }}</span></div>
      <div class="kv-row"><span class="kv-label">分频</span><span class="kv-value">{{ periInfo.divider }}</span></div>
      <div v-if="periInfo.errorPct !== undefined" class="kv-row">
        <span class="kv-label">误差</span>
        <span class="kv-value" :class="{ warn: Math.abs(periInfo.errorPct) > 3 }">{{ periInfo.errorPct.toFixed(2) }}%</span>
      </div>
      <el-button
        v-if="periInfo.category !== 'usb'"
        class="peri-jump"
        size="small"
        type="primary"
        plain
        @click="openPeripheral"
      >
        在外设视图配置
      </el-button>
      <div v-else class="peri-note">USB 时钟由 HAL 按 PLL 输出自动分频，无独立配置项。</div>
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
/* 宽度由宿主 detail-col 决定（M6）：填满父容器，保留内部滚动 */
.clock-detail {
  width: 100%;
  min-width: 0;
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
.empty-state {
  padding: 18px 8px 22px;
  text-align: center;
}
.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.empty-msg {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mx-text-muted);
}
/* 外设时钟详情 */
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
  font-size: 12px;
}
.kv-label {
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}
.kv-value {
  color: var(--mx-text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.kv-value.warn {
  color: var(--mx-warning);
}
.peri-jump {
  margin-top: 10px;
  width: 100%;
}
.peri-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--mx-text-muted);
  line-height: 1.6;
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
