<script setup lang="ts">
// 单个时钟树节点：上限/徽标 / 输入-输出两栏频率 / 标题 / 内嵌控件行。
// M15：问题标记（右上圆点 + title 全量消息）、badge（fixed/derived/raw）、
// 源选择 radio 组、分频 stepper（- 值 +）、外设节点 requested/actual 双行。
// 其余控件保持既有「单击原位 foreignObject 内联编辑」语义；锁定后所有控件置灰。
// 右键向父级抛 contextmenu（由 ClockView 打开菜单）；锁定图标单击仍是快捷开关。
import type { ClockNodeControl, ClockTreeNode } from '@/model/clock/tree'
import { formatMhz } from '@/model/clock/tree'
import {
  canEditControl,
  editKeyAction,
  isRadioControl,
  isStepperControl,
  parseNumberInput,
  resolveSelectValue,
  stepControlValue,
} from '@/components/clock/inlineEdit'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ node: ClockTreeNode; selected?: boolean; dimmed?: boolean; pulse?: boolean; editing?: boolean }>(),
  {
    selected: false,
    dimmed: false,
    pulse: false,
    editing: false,
  },
)

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'control-change', control: ClockNodeControl, value: string | number): void
  (e: 'edit-start', nodeId: string): void
  (e: 'edit-end', nodeId: string): void
  (e: 'toggle-lock', nodeId: string): void
  (e: 'contextmenu', nodeId: string, x: number, y: number): void
}>()

/** 控件行在节点内的矩形（SVG 坐标）：节点底部留 10px 内边距，高 28px */
const ctrlRect = computed(() => ({ x: props.node.x + 10, y: props.node.y + props.node.h - 38, w: props.node.w - 20, h: 28 }))

function ctrlText(c: ClockNodeControl): string {
  if (c.kind === 'number') return `${c.value} ${c.unit ?? ''}`.trim()
  const opt = c.options?.find((o) => String(o.value) === String(c.value))
  return opt?.label ?? String(c.value)
}

const controlText = computed(() => (props.node.control ? ctrlText(props.node.control) : ''))

/** 控件可编辑（fixed/锁定置灰）且父级把本节点标记为编辑态时，渲染内联编辑器 */
const editable = computed(() => canEditControl(props.node.control, props.node.locked))
/** radio / stepper 常驻渲染（非点击编辑），其余控件沿用内联编辑 */
const radioMode = computed(() => isRadioControl(props.node.control))
const stepperMode = computed(() => isStepperControl(props.node.control))
const inlineMode = computed(() => !radioMode.value && !stepperMode.value)
const switchDisabled = computed(() => !editable.value)
const inlineEditing = computed(() => props.editing && editable.value && inlineMode.value)

/** stepper 单步是否可用（首尾/唯一档位/锁定 → 置灰） */
function canStep(dir: -1 | 1): boolean {
  return editable.value && stepControlValue(props.node.control, dir) !== null
}

function onStep(dir: -1 | 1) {
  const v = stepControlValue(props.node.control, dir)
  if (v !== null) emit('control-change', props.node.control!, v)
}

/** radio 值变更：按 options 匹配保留原始类型后提交 */
function onRadioChange(raw: string) {
  const c = props.node.control
  if (!c) return
  const v = resolveSelectValue(raw, c)
  if (v !== null) emit('control-change', c, v)
}

const badgeLabel = computed(() => {
  switch (props.node.badge) {
    case 'fixed':
      return '固定'
    case 'derived':
      return '派生'
    case 'raw':
      return 'raw'
    default:
      return ''
  }
})

/** 问题 hover 提示：全量消息逐行拼接（无问题时不渲染 title） */
const issueText = computed(() => (props.node.issues ?? []).map((i) => i.message).join('\n'))
const isPeripheral = computed(() => !!props.node.periId)
const hasPeriLabels = computed(() => !!(props.node.requestedLabel || props.node.actualLabel))

// ---------- 内联编辑状态 ----------
const draft = ref('')
const invalid = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const selectEl = ref<HTMLSelectElement | null>(null)
let invalidTimer: number | null = null

function clearInvalidTimer() {
  if (invalidTimer !== null) {
    window.clearTimeout(invalidTimer)
    invalidTimer = null
  }
}

/** 控件行单击：请求进入编辑态（父级协调同一时刻仅一个节点编辑） */
function onControlClick(e: MouseEvent) {
  e.stopPropagation()
  if (!editable.value || !inlineMode.value) return
  emit('edit-start', props.node.id)
}

// 进入编辑态：按当前控件值初始化草稿，聚焦并全选（number）；退出时清理红框提示
watch(
  () => props.editing,
  (on) => {
    clearInvalidTimer()
    invalid.value = false
    if (!on) return
    const c = props.node.control
    draft.value = c ? String(c.value) : ''
    void nextTick(() => {
      const el = inputEl.value ?? selectEl.value
      el?.focus()
      if (el instanceof HTMLInputElement) el.select()
    })
  },
)

// 编辑期间被锁定/置灰（如右键锁定、预设写回）：立即退出编辑态
watch(editable, (ok) => {
  if (!ok && props.editing) emit('edit-end', props.node.id)
})

onBeforeUnmount(clearInvalidTimer)

/** 非法输入：回退原值 + 短暂红框，随后关闭编辑态（红框可见后再退出） */
function flashInvalid() {
  const c = props.node.control
  draft.value = c ? String(c.value) : ''
  invalid.value = true
  clearInvalidTimer()
  invalidTimer = window.setTimeout(() => {
    invalidTimer = null
    invalid.value = false
    emit('edit-end', props.node.id)
  }, 500)
}

/** number 提交：Enter / blur 触发；非法回退原值并红框提示 */
function commitNumber() {
  if (!props.editing) return
  // 红框提示期间草稿已回退原值：此时 blur 直接关闭，不再重复提交
  if (invalid.value) {
    cancelEdit()
    return
  }
  const c = props.node.control
  if (!c || c.kind !== 'number') return
  const r = parseNumberInput(draft.value, c)
  if (!r.ok || r.value === undefined) {
    flashInvalid()
    return
  }
  clearInvalidTimer()
  emit('control-change', c, r.value)
  emit('edit-end', props.node.id)
}

/** select 提交：change 立即提交（值按 options 匹配，保留原始类型） */
function onSelectChange(e: Event) {
  if (!props.editing) return
  const c = props.node.control
  const raw = e.target instanceof HTMLSelectElement ? e.target.value : ''
  if (!c || c.kind !== 'select') return
  const v = resolveSelectValue(raw, c)
  if (v !== null) emit('control-change', c, v)
  emit('edit-end', props.node.id)
}

/** Esc 取消 / select blur 关闭：不提交，直接退出编辑态 */
function cancelEdit() {
  if (!props.editing) return
  clearInvalidTimer()
  invalid.value = false
  emit('edit-end', props.node.id)
}

/** number 按键：Enter 提交 / Esc 取消（其余按键交还原生输入） */
function onNumberKeydown(e: KeyboardEvent) {
  const action = editKeyAction(e.key)
  if (action === 'commit') {
    e.preventDefault()
    commitNumber()
  } else if (action === 'cancel') {
    e.preventDefault()
    cancelEdit()
  }
}

/** 节点右键：交给父级打开上下文菜单（锁定/路径高亮/配置外设）。 */
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  emit('contextmenu', props.node.id, e.clientX, e.clientY)
}

function onToggleLock(e: MouseEvent) {
  e.stopPropagation()
  emit('toggle-lock', props.node.id)
}
</script>

<template>
  <g
    class="node"
    :class="{ selected, dimmed, inactive: !node.active, pulse, locked: node.locked }"
    @click="emit('focus', node.id)"
    @contextmenu="onContextMenu"
  >
    <title v-if="issueText">{{ issueText }}</title>
    <rect
      :x="node.x"
      :y="node.y"
      :width="node.w"
      :height="node.h"
      rx="8"
      class="node-box"
      :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }"
    />
    <!-- 问题标记：右上小圆点（error 红 / warning 橙），hover 见 <title> -->
    <circle
      v-if="node.issueLevel"
      :cx="node.x + node.w - 7"
      :cy="node.y + 7"
      r="4"
      class="issue-marker"
      :class="node.issueLevel"
    />
    <!-- 锁定开关：右上角锁图标（点击/右键切换；锁定后控件置灰） -->
    <g
      v-if="node.lockable"
      class="lock-btn"
      :class="{ on: node.locked }"
      role="button"
      @click="onToggleLock"
      @contextmenu.stop.prevent="onToggleLock"
    >
      <title>{{ node.locked ? '解锁该节点（预设/自动修复可再次修改）' : '锁定该节点（预设/自动修复保留当前值）' }}</title>
      <rect :x="node.x + node.w - 28" :y="node.y + 4" width="20" height="20" rx="5" class="lock-hit" />
      <path
        :d="`M ${node.x + node.w - 22} ${node.y + 15} v-2 a 4 4 0 0 1 8 0 v2`"
        class="lock-shackle"
        fill="none"
        stroke-linecap="round"
      />
      <rect :x="node.x + node.w - 23" :y="node.y + 15" width="10" height="7" rx="1.5" class="lock-body" />
    </g>
    <!-- 顶部上限小标签 -->
    <text v-if="node.maxMhz !== null" :x="node.x + 8" :y="node.y + 15" class="node-max">
      上限 {{ formatMhz(node.maxMhz) }}
    </text>
    <!-- 徽标：fixed / derived / raw -->
    <text v-if="badgeLabel" :x="node.x + node.w - 8" :y="node.y + 64" text-anchor="end" class="node-badge">
      {{ badgeLabel }}
    </text>
    <!-- 外设节点：请求值 / 实际派生双行 -->
    <template v-if="isPeripheral && hasPeriLabels">
      <text v-if="node.requestedLabel" :x="node.x + 8" :y="node.y + 34" class="peri-line">
        请求 {{ node.requestedLabel }}
      </text>
      <text v-if="node.actualLabel" :x="node.x + 8" :y="node.y + 49" class="peri-line actual">
        {{ node.actualLabel }}
      </text>
    </template>
    <!-- 主体两栏：输入 | 输出 -->
    <template v-else-if="node.inMhz !== null">
      <text
        :x="node.x + node.w * 0.25"
        :y="node.y + 38"
        text-anchor="middle"
        class="freq"
        :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }"
      >
        {{ formatMhz(node.inMhz) }}
      </text>
      <line :x1="node.x + node.w / 2" :y1="node.y + 26" :x2="node.x + node.w / 2" :y2="node.y + 48" class="freq-divider" />
      <text
        :x="node.x + node.w * 0.75"
        :y="node.y + 38"
        text-anchor="middle"
        class="freq"
        :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }"
      >
        {{ formatMhz(node.outMhz) }}
      </text>
    </template>
    <text
      v-else
      :x="node.x + node.w / 2"
      :y="node.y + 38"
      text-anchor="middle"
      class="freq"
      :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }"
    >
      {{ formatMhz(node.outMhz) }}
    </text>
    <!-- 节点标题 -->
    <text :x="node.x + 8" :y="node.y + 64" class="node-title">{{ node.label }}</text>
    <!-- 内嵌控件行：radio / stepper 常驻；其余编辑态原位替换为 foreignObject 内联 input/select -->
    <g v-if="node.control" class="ctrl" :class="{ fixed: node.control.fixed || node.locked }" @click="onControlClick">
      <rect :x="ctrlRect.x" :y="ctrlRect.y" :width="ctrlRect.w" :height="ctrlRect.h" rx="4" class="ctrl-box" />

      <!-- 源选择：radio 组（选项 ≤4） -->
      <foreignObject
        v-if="radioMode"
        :x="ctrlRect.x"
        :y="ctrlRect.y"
        :width="ctrlRect.w"
        :height="ctrlRect.h"
        class="ctrl-inline"
        @click.stop
        @mousedown.stop
        @contextmenu.stop
      >
        <div class="radio-row" :class="{ multi: (node.control.options?.length ?? 0) > 2, disabled: switchDisabled }">
          <label v-for="opt in node.control.options" :key="String(opt.value)" class="radio-opt">
            <input
              type="radio"
              :name="`radio-${node.id}`"
              :value="String(opt.value)"
              :checked="String(node.control.value) === String(opt.value)"
              :disabled="switchDisabled"
              @change="onRadioChange(String(opt.value))"
            />
            <span class="radio-dot"></span>
            <span class="radio-label" :title="opt.label">{{ opt.label }}</span>
          </label>
        </div>
      </foreignObject>

      <!-- 分频：stepper「- 值 +」（按 options 索引 ±1） -->
      <foreignObject
        v-else-if="stepperMode"
        :x="ctrlRect.x"
        :y="ctrlRect.y"
        :width="ctrlRect.w"
        :height="ctrlRect.h"
        class="ctrl-inline"
        @click.stop
        @mousedown.stop
        @contextmenu.stop
      >
        <div class="stepper" :class="{ disabled: switchDisabled }">
          <button
            type="button"
            class="step-btn"
            :disabled="!canStep(-1)"
            aria-label="减小分频档位"
            @click.stop="onStep(-1)"
          >
            −
          </button>
          <span class="step-val" :title="controlText">{{ controlText }}</span>
          <button type="button" class="step-btn" :disabled="!canStep(1)" aria-label="增大分频档位" @click.stop="onStep(1)">
            +
          </button>
        </div>
      </foreignObject>

      <template v-else-if="inlineEditing">
        <!-- 编辑态点击不冒泡到节点（不触发 focus）；尺寸与控件行一致 -->
        <foreignObject
          :x="ctrlRect.x"
          :y="ctrlRect.y"
          :width="ctrlRect.w"
          :height="ctrlRect.h"
          class="ctrl-inline"
          @click.stop
          @mousedown.stop
          @contextmenu.stop
        >
          <input
            v-if="node.control.kind === 'number'"
            ref="inputEl"
            v-model="draft"
            type="text"
            inputmode="decimal"
            class="inline-input"
            :class="{ invalid }"
            :aria-label="node.control.label"
            @keydown="onNumberKeydown"
            @blur="commitNumber"
          />
          <select
            v-else
            ref="selectEl"
            class="inline-select"
            :value="String(node.control.value)"
            :aria-label="node.control.label"
            @change="onSelectChange"
            @keydown.esc.prevent="cancelEdit"
            @blur="cancelEdit"
          >
            <option v-for="opt in node.control.options" :key="String(opt.value)" :value="String(opt.value)">
              {{ opt.label }}
            </option>
          </select>
        </foreignObject>
      </template>
      <template v-else>
        <text :x="ctrlRect.x + 8" :y="ctrlRect.y + 19" class="ctrl-text">{{ controlText }}</text>
        <path
          v-if="node.control.kind === 'select'"
          :d="`M ${ctrlRect.x + ctrlRect.w - 16} ${ctrlRect.y + 11} l 5 6 l 5 -6 z`"
          class="ctrl-caret"
        />
      </template>
    </g>
    <text v-else-if="node.hint" :x="node.x + 10" :y="ctrlRect.y + 19" class="node-hint">{{ node.hint }}</text>
  </g>
</template>

<style scoped>
.node {
  cursor: pointer;
}
.node.dimmed {
  opacity: 0.3;
}
.node-box {
  fill: #fff;
  stroke: var(--mx-border);
  stroke-width: 1;
  transition:
    stroke var(--mx-dur-node) linear,
    fill var(--mx-dur-node) linear;
}
.node-box.error {
  stroke: var(--mx-error);
}
.node-box.warning {
  stroke: var(--mx-warning);
}
.node.selected .node-box {
  stroke: var(--mx-accent);
  stroke-width: 2;
  filter: drop-shadow(0 0 4px rgba(42, 98, 183, 0.45));
}
/* 预设应用/配置变化：目标节点一次 240ms 高亮脉冲（描边光晕淡入淡出） */
.node.pulse .node-box {
  animation: node-pulse var(--mx-dur-pulse) var(--mx-ease-out);
}
@keyframes node-pulse {
  0% {
    filter: drop-shadow(0 0 0 rgba(42, 98, 183, 0));
  }
  35% {
    filter: drop-shadow(0 0 8px rgba(42, 98, 183, 0.65));
  }
  100% {
    filter: drop-shadow(0 0 0 rgba(42, 98, 183, 0));
  }
}
.node.inactive .freq,
.node.inactive .node-title,
.node.inactive .peri-line {
  fill: var(--mx-text-muted);
}
.node-max {
  font-size: 10px;
  fill: var(--mx-text-muted);
}
.node-badge {
  font-size: 9px;
  fill: var(--mx-text-muted);
}
.peri-line {
  font-size: 10.5px;
  fill: var(--mx-text-secondary);
}
.peri-line.actual {
  fill: var(--mx-text-muted);
}
.issue-marker {
  stroke: #fff;
  stroke-width: 1.5;
}
.issue-marker.error {
  fill: var(--mx-error);
}
.issue-marker.warning {
  fill: var(--mx-warning);
}
.freq {
  font-size: 13px;
  font-weight: 600;
  fill: var(--mx-text);
  transition: fill var(--mx-dur-node) linear;
}
.freq.error {
  fill: var(--mx-error);
}
.freq.warning {
  fill: var(--mx-warning);
}
.freq-divider {
  stroke: var(--mx-border);
  stroke-width: 1;
}
.node-title {
  font-size: 12px;
  font-weight: 600;
  fill: var(--mx-text-secondary);
}
.node-hint {
  font-size: 11px;
  fill: var(--mx-text-muted);
}

/* 锁定开关图标：默认低透明度，悬停/锁定后高亮 */
.lock-btn {
  opacity: 0.35;
  transition: opacity var(--mx-dur-node) linear;
}
.node:hover .lock-btn,
.lock-btn.on {
  opacity: 1;
}
.lock-hit {
  fill: transparent;
  cursor: pointer;
}
.lock-shackle {
  stroke: var(--mx-text-muted);
  stroke-width: 1.5;
}
.lock-body {
  fill: var(--mx-text-muted);
}
.lock-btn.on .lock-shackle {
  stroke: var(--mx-accent);
}
.lock-btn.on .lock-body {
  fill: var(--mx-accent);
}

/* 内嵌控件 */
.ctrl .ctrl-box {
  fill: #f7f8fa;
  stroke: #d0d5dd;
  stroke-width: 1;
  cursor: pointer;
}
.ctrl.fixed .ctrl-box {
  cursor: default;
}
.ctrl:hover:not(.fixed) .ctrl-box {
  stroke: var(--mx-accent);
}
.ctrl.fixed {
  opacity: 0.55;
}
.ctrl-text {
  font-size: 11px;
  fill: var(--mx-text);
}
.ctrl-caret {
  fill: var(--mx-text-muted);
}

/* 内联编辑器：与控件行同尺寸，11px 字体；非法输入短暂红框 */
.ctrl-inline {
  overflow: visible;
}
.inline-input,
.inline-select {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 8px;
  font-size: 11px;
  font-family: inherit;
  color: var(--mx-text);
  background: #fff;
  border: 1px solid var(--mx-accent);
  border-radius: 4px;
  outline: none;
}
.inline-input.invalid {
  border-color: var(--mx-error);
  box-shadow: 0 0 0 2px rgba(217, 45, 32, 0.18);
}
.inline-select {
  cursor: pointer;
}

/* radio 源选择（MX2 mux 点）：选项 ≤2 单行，>2 两列网格 */
.radio-row {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  font-size: 10px;
  color: var(--mx-text);
}
.radio-row.multi {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 6px;
  align-items: center;
}
.radio-row.disabled {
  opacity: 0.55;
}
.radio-opt {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  cursor: pointer;
}
.radio-row.disabled .radio-opt {
  cursor: default;
}
.radio-opt input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.radio-dot {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border: 1.5px solid #98a2b3;
  border-radius: 50%;
  background: #fff;
}
.radio-opt input:checked + .radio-dot {
  border-color: var(--mx-accent);
  background: radial-gradient(circle, var(--mx-accent) 0 3px, #fff 3.5px);
}
.radio-opt input:focus-visible + .radio-dot {
  box-shadow: 0 0 0 2px var(--mx-accent-soft);
}
.radio-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* stepper 分频：「- 值 +」 */
.stepper {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  background: #f7f8fa;
  border-radius: 4px;
  overflow: hidden;
}
.stepper.disabled {
  opacity: 0.55;
}
.step-btn {
  width: 26px;
  flex-shrink: 0;
  border: none;
  background: #eef1f6;
  color: var(--mx-text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.step-btn:hover:not(:disabled) {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.step-btn:disabled {
  color: #c0c6d0;
  cursor: default;
}
.step-val {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
