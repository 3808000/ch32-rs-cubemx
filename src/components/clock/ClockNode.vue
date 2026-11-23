<script setup lang="ts">
// 单个时钟树节点：M16 按 node.kind 渲染 MX2 分离图元簇（契约 D1）。
//   osc    = 标题行 + 值格（HSE number 内联编辑；固定源静态值，<1MHz 自适应 kHz）
//   mux    = 左竖块（输入小 label + radio 点列，radio 行即控件）+ 读数卡
//   div    = stepper 块（- N +）+ 读数卡
//   pll    = mux(pllSource 行) + 参数 stepper（当前模型仅首参数）+ hint 静态补充 + 读数卡
//   readout= 单读数卡（out + max + 可选 hint 行）
//   peri   = 独立外设卡：名称和状态 / 时钟来源 / 参数控件 / 请求与实际频率
// 逻辑节点 props/emits、编辑态机、锁定、问题标记、右键菜单全部沿用 M15；
// 簇外包仍为 <g class="node">，ClockCanvas 的 pan 守卫形状不变。
import type { ClockNodeControl, ClockTreeNode } from '@/model/clock/tree'
import ClockLabel from '@/components/clock/ClockLabel.vue'
import { formatMhz, PRIM } from '@/model/clock/tree'
import type { ClockNodeKind } from '@/model/types'
import {
  canEditControl,
  editKeyAction,
  isStepperControl,
  parseNumberInput,
  resolveSelectValue,
  stepControlValue,
} from '@/components/clock/inlineEdit'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    node: ClockTreeNode
    selected?: boolean
    searchHit?: boolean
    primary?: boolean
    signalName?: string
    hideTitle?: boolean
    dimmed?: boolean
    pulse?: boolean
    editing?: boolean
    /** 当前生效入边的来源 id（PLL 源选择无独立控件值，用激活边点亮 mux 行） */
    activeInput?: string | null
    /** 仅显示源节点 id（PLL mux 灰行判定；SYSCLK/ADC 由 control.options 缺失判定） */
    displayOnlyInputs?: string[]
  }>(),
  {
    selected: false,
    dimmed: false,
    pulse: false,
    editing: false,
    activeInput: null,
    displayOnlyInputs: () => [],
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

/** 兼容无 kind 的旧布局（M15 回退）：按逻辑内容推断图元种类 */
function fallbackKind(n: ClockTreeNode): ClockNodeKind {
  if (n.periId) return 'peri'
  if (n.control?.field === 'pll') return 'pll'
  if (n.control && (n.control.field === 'ahb' || n.control.field === 'apb1' || n.control.field === 'apb2')) return 'div'
  if (n.control && (n.control.field === 'source' || n.control.field === 'adc')) return 'mux'
  if (n.inMhz === null) return 'osc'
  return 'readout'
}

const kind = computed<ClockNodeKind>(() => props.node.kind ?? fallbackKind(props.node))

// ---------- 通用判定 / 格式化 ----------
/** 控件可编辑（fixed/锁定/displayOnly 置灰）→ 所有常驻控件与编辑态机共用 */
const editable = computed(() => canEditControl(props.node.control, props.node.locked) && !props.node.displayOnly)
const stepperMode = computed(() => isStepperControl(props.node.control))
const inlineMode = computed(() => props.node.control?.kind === 'number')
const inlineEditing = computed(() => props.editing && editable.value && inlineMode.value)

function trimNumber(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/** 源频率显示：<1 MHz 自适应 kHz（如 LSI 0.128MHz → 128 kHz） */
function formatAdaptiveMhz(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (v > 0 && v < 1) return `${trimNumber(v * 1000)} kHz`
  return `${trimNumber(v)} MHz`
}

function ctrlText(c: ClockNodeControl): string {
  if (c.kind === 'number') return `${c.value} ${c.unit ?? ''}`.trim()
  const opt = c.options?.find((o) => String(o.value) === String(c.value))
  return opt?.label ?? String(c.value)
}

// ---------- SVG 文本截断（text 无 ellipsis：按字号估宽计算截断，全文交给 <title>） ----------
const controlText = computed(() => (props.node.control ? ctrlText(props.node.control) : ''))

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

/** 问题 hover 提示：全量消息 + note/hint + 外设请求/实际（截断行全文都在这里） */
const issueText = computed(() => (props.node.issues ?? []).map((i) => i.message).join('\n'))
const hoverText = computed(
  () =>
    [
      props.node.label,
      issueText.value,
      cardCaption.value,
      props.node.hint,
      kind.value === 'peri' ? periSourceText.value : '',
      props.node.requestedLabel ? `请求 ${props.node.requestedLabel}` : '',
      props.node.actualLabel,
    ]
      .filter(Boolean)
      .join('\n'),
)
const nodeClass = computed(() => ({
  selected: props.selected,
  primary: props.primary,
  'search-hit': props.searchHit,
  dimmed: props.dimmed,
  inactive: !props.node.active,
  pulse: props.pulse,
  locked: props.node.locked,
  'display-only': !!props.node.displayOnly,
  'peripheral-node': kind.value === 'peri',
  'issue-error': props.node.issueLevel === 'error',
  'issue-warning': props.node.issueLevel === 'warning',
}))

// ---------- mux 输入行（radio 行即控件） ----------
interface MuxRow {
  id: string
  label: string
  /** 提交值：control.options 命中时保留原始类型，否则=节点 id */
  value: string | number
  /** 未进 control.options 的仅显示源（灰行，不可点） */
  displayOnly: boolean
  selected: boolean
  disabled: boolean
}

const muxRows = computed<MuxRow[]>(() => {
  const c = props.node.control
  const sourceControl = !!c && (c.field === 'source' || c.field === 'adc' || c.field === 'pllSource')
  const ids = props.node.muxInputs ?? []
  const list = ids.length ? ids : sourceControl ? (c?.options?.map((o) => String(o.value)) ?? []) : []
  const selectedValue = sourceControl && c ? String(c.value) : null
  return list.map((id, i) => {
    const opt = sourceControl ? c?.options?.find((o) => String(o.value) === id) : undefined
    const displayOnly = (sourceControl && !opt) || props.displayOnlyInputs.includes(id)
    // 标签优先级：M16 RM 文案（aux inputs[].label）→ control option label → 节点 id
    const label = props.node.muxLabels?.[i] ?? opt?.label ?? id
    return {
      id,
      label,
      value: opt ? opt.value : id,
      displayOnly,
      selected: selectedValue !== null ? selectedValue === id : props.activeInput === id,
      // 源控件：不在 options 的仅显示源灰行不可点；PLL 源选择无 options，按可编辑性判定
      disabled: displayOnly || !muxEditable.value,
    }
  })
})

/**
 * mux 行可点：锁定/仅显示禁用；源控件还要求非 fixed。
 * PLL 的 control 是参数档位（可能 fixed），但 pllSource 选择独立，不因参数 fixed 禁用。
 */
const muxEditable = computed(() => {
  if (props.node.displayOnly || props.node.locked) return false
  const c = props.node.control
  const sourceControl = !!c && (c.field === 'source' || c.field === 'adc' || c.field === 'pllSource')
  if (sourceControl) return !c.fixed
  // 仅 PLL 的 mux 行可写 pllSource；其它被 diagram 覆盖成 mux 的节点无写回路由 → 置灰
  return kind.value === 'pll' && !!c
})

/** radio 行中心 y（MUX_PAD 顶部留白 + 固定行高） */
function muxRowCenter(i: number): number {
  return props.node.y + PRIM.MUX_PAD + i * PRIM.MUX_ROW + PRIM.MUX_ROW / 2
}

function onMuxRowClick(row: MuxRow) {
  emit('focus', props.node.id)
  if (row.disabled || !muxEditable.value) return
  const c = props.node.control
  if (c && (c.field === 'source' || c.field === 'adc' || c.field === 'pllSource')) {
    emit('control-change', c, row.value)
    return
  }
  // PLL 源选择：模型暂无独立 pllSource 控件，按写回契约构造同形控件（applyClockControl 已支持）
  if (kind.value === 'pll') {
    const control: ClockNodeControl = {
      kind: 'select',
      field: 'pllSource',
      label: 'PLL 源',
      value: row.value,
      options: muxRows.value.map((r) => ({ value: r.value, label: r.label })),
    }
    emit('control-change', control, row.value)
  }
}

// ---------- 几何（簇内块偏移全部来自 PRIM） ----------
interface CardGeom {
  x: number
  y: number
  w: number
  h: number
}

/** 在簇内居中放置读数卡，使左右端口保持同一水平线。 */
function cardGeom(x: number): CardGeom {
  return {
    x,
    y: props.node.y + (props.node.h - PRIM.READOUT_H) / 2,
    w: PRIM.READOUT_W,
    h: PRIM.READOUT_H,
  }
}

const muxCard = computed(() => cardGeom(props.node.x + PRIM.MUX_W + PRIM.CLUSTER_GAP))
const divCard = computed(() => cardGeom(props.node.x + PRIM.DIV_W + PRIM.CLUSTER_GAP))
const pllCard = computed(() => cardGeom(props.node.x + props.node.w - PRIM.READOUT_W))
const readoutCard = computed(() => cardGeom(props.node.x))

/** osc 值格：标题基线下方 ≥14px，格高 14~18px（OSC_H=44 时 16px） */
const oscCell = computed(() => {
  const h = Math.max(14, Math.min(18, props.node.h - 28))
  return {
    x: props.node.x + 6,
    y: props.node.y + props.node.h - h - 2,
    w: Math.max(24, props.node.w - 12),
    h,
  }
})
const oscValueText = computed(() => formatAdaptiveMhz(props.node.outMhz))

interface StepGeom {
  x: number
  y: number
  w: number
  h: number
  btnW: number
}

function stepGeom(x: number, y: number, w: number, h: number): StepGeom {
  return { x, y, w, h, btnW: Math.max(18, Math.min(24, Math.round(w * 0.25))) }
}

const divStep = computed(() => stepGeom(props.node.x, props.node.y, PRIM.DIV_W, PRIM.DIV_H))
/** PLL 完整参数链：node.pllControls（缺省回退 [node.control]），每参数一槽 STEP_W×STEP_H */
const pllSteps = computed<{ control: ClockNodeControl; geom: StepGeom }[]>(() => {
  if (kind.value !== 'pll') return []
  const list = props.node.pllControls?.length ? props.node.pllControls : props.node.control ? [props.node.control] : []
  if (!list.length) return []
  const h = Math.min(PRIM.STEP_H, props.node.h)
  const y = props.node.y + (props.node.h - h) / 2
  const x0 = props.node.x + (muxRows.value.length ? PRIM.MUX_W + PRIM.CLUSTER_GAP : 0)
  return list.map((control, i) => {
    return { control, geom: stepGeom(x0 + i * (PRIM.STEP_W + PRIM.CLUSTER_GAP), y, PRIM.STEP_W, h) }
  })
})
const periStep = computed(() => stepGeom(props.node.x + 9, props.node.y + 23, props.node.w - 18, 22))

const divValue = computed(() => props.node.control ? `÷${props.node.control.value}` : '—')

/** 簇内 1px 连接线：mux/div → 读数卡 */
const muxLink = computed(() => {
  const c = muxCard.value
  return `M ${props.node.x + PRIM.MUX_W} ${c.y + PRIM.READOUT_H / 2} H ${c.x}`
})
const divLink = computed(() => {
  const c = divCard.value
  return `M ${props.node.x + PRIM.DIV_W} ${c.y + PRIM.READOUT_H / 2} H ${c.x}`
})

/** pll 参数链 → 读数卡的正交连接线（mux → 各 stepper → 读数卡） */
const pllLinks = computed<string[]>(() => {
  const card = pllCard.value
  const cy = card.y + PRIM.READOUT_H / 2
  const steps = pllSteps.value
  const links: string[] = []
  if (muxRows.value.length) {
    const muxRight = props.node.x + PRIM.MUX_W
    const first = steps[0]
    links.push(first ? `M ${muxRight} ${first.geom.y + first.geom.h / 2} H ${first.geom.x}` : `M ${muxRight} ${cy} H ${card.x}`)
  }
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1]!.geom
    const b = steps[i]!.geom
    links.push(`M ${a.x + a.w} ${a.y + a.h / 2} H ${b.x}`)
  }
  const last = steps[steps.length - 1]?.geom
  if (last) {
    const sy = last.y + last.h / 2
    const mx = last.x + last.w + 6
    links.push(`M ${last.x + last.w} ${sy} H ${mx} V ${cy} H ${card.x}`)
  }
  return links
})

const clusterTitle = computed(() => !props.node.outputLabel && props.signalName && props.signalName !== props.node.label
  ? `${props.node.label} · ${props.signalName}`
  : props.node.label)

const cardOutText = computed(() => props.node.readoutText ?? formatAdaptiveMhz(props.node.outMhz))
const cardCaption = computed(() => props.node.maxMhz !== null ? `上限 ${formatMhz(props.node.maxMhz)}` : props.node.displayOnly ? '仅显示' : '')
const visibleCaption = computed(() => props.selected || props.node.issueLevel ? cardCaption.value : '')
const hasMarker = computed(() => props.node.lockable || !!props.node.issueLevel)
const readout = computed(() => {
  switch (kind.value) {
    case 'mux': return { card: muxCard.value, label: props.node.outputLabel }
    case 'div': return { card: divCard.value }
    case 'pll': return { card: pllCard.value }
    case 'readout': return { card: readoutCard.value, label: clusterTitle.value }
    default: return null
  }
})
const marker = computed(() => {
  const card = readout.value?.card ?? props.node
  return { x: card.x + card.w - 10, y: card.y + 10 }
})
const periSourceText = computed(() =>
  [props.node.inputClockLabel, formatAdaptiveMhz(props.node.inMhz)].filter(Boolean).join(' · '),
)
const periResult = computed(() => {
  if (!props.node.active) return '未启用'
  const out = props.node.outMhz
  if (out === null) return props.node.actualLabel ?? badgeLabel.value
  const value = props.node.requestedLabel?.endsWith(' baud')
    ? `${Math.round(out * 1_000_000)} baud`
    : formatAdaptiveMhz(out)
  return `实际 ${value}`
})

// ---------- stepper 单步（复用 inlineEdit 纯函数） ----------
/** 单个参数控件可编辑（fixed/锁定/displayOnly 置灰） */
function controlEditable(c: ClockNodeControl | null | undefined): boolean {
  return canEditControl(c, props.node.locked) && !props.node.displayOnly
}

function canStepControl(c: ClockNodeControl | null | undefined, dir: -1 | 1): boolean {
  return controlEditable(c) && stepControlValue(c, dir) !== null
}

function onStepControl(c: ClockNodeControl, dir: -1 | 1) {
  emit('focus', props.node.id)
  if (!controlEditable(c)) return
  const v = stepControlValue(c, dir)
  if (v !== null) emit('control-change', c, v)
}

function canStep(dir: -1 | 1): boolean {
  return canStepControl(props.node.control, dir)
}

function onStep(dir: -1 | 1) {
  if (props.node.control) onStepControl(props.node.control, dir)
}

// ---------- 内联编辑状态（仅 number：HSE 值格 / 外设数字旋钮） ----------
const draft = ref('')
const invalid = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
let invalidTimer: number | null = null

function clearInvalidTimer() {
  if (invalidTimer !== null) {
    window.clearTimeout(invalidTimer)
    invalidTimer = null
  }
}

/** 值格单击：请求进入编辑态（父级协调同一时刻仅一个节点编辑） */
function onControlClick(e: Event) {
  e.stopPropagation()
  emit('focus', props.node.id)
  if (!editable.value || !inlineMode.value) return
  emit('edit-start', props.node.id)
}

// 进入编辑态：按当前控件值初始化草稿，聚焦并全选
watch(
  () => props.editing,
  (on) => {
    clearInvalidTimer()
    invalid.value = false
    if (!on) return
    const c = props.node.control
    draft.value = c ? String(c.value) : ''
    void nextTick(() => {
      const el = inputEl.value
      el?.focus({ preventScroll: true })
      el?.select()
    })
  },
)

// 编辑期间被锁定/置灰（如右键锁定、预设写回）：立即退出编辑态
watch(editable, (ok) => {
  if (!ok && props.editing) emit('edit-end', props.node.id)
})

onBeforeUnmount(clearInvalidTimer)

/** 非法输入：回退原值 + 短暂红框，随后关闭编辑态 */
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

function commitNumber() {
  if (!props.editing) return
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

/** select 变更：periparam 常驻下拉直接提交（保留选项原始类型） */
function onSelectChange(e: Event) {
  const c = props.node.control
  if (!c || c.kind !== 'select' || !editable.value) return
  const raw = e.target instanceof HTMLSelectElement ? e.target.value : ''
  const v = resolveSelectValue(raw, c)
  if (v !== null) {
    emit('focus', props.node.id)
    emit('control-change', c, v)
  }
  if (props.editing) emit('edit-end', props.node.id)
}

/** Esc 取消 / blur 关闭：不提交，直接退出编辑态 */
function cancelEdit() {
  if (!props.editing) return
  clearInvalidTimer()
  invalid.value = false
  emit('edit-end', props.node.id)
}

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

function onToggleLock(e: Event) {
  e.stopPropagation()
  emit('toggle-lock', props.node.id)
}
</script>

<template>
  <g
    class="node"
    :class="nodeClass"
    :data-node-id="node.id"
    tabindex="0"
    role="group"
    :aria-label="node.label"
    @click="emit('focus', node.id)"
    @keydown.enter.self.prevent="emit('focus', node.id)"
    @contextmenu="onContextMenu"
  >
    <title>{{ hoverText }}</title>

    <ClockLabel
      v-if="!hideTitle && (kind === 'mux' || kind === 'div' || kind === 'pll')"
      :x="node.x" :y="node.y - 15" :width="node.w" :height="13"
      :text="clusterTitle" class="cluster-title"
    />

    <!-- ===== osc：标题行 + 值格 ===== -->
    <template v-if="kind === 'osc'">
      <rect :x="node.x" :y="node.y" :width="node.w" :height="node.h" rx="6" class="prim-block osc-card" />
      <ClockLabel
        :x="node.x + 8" :y="node.y + 4" :width="node.w - (hasMarker ? 27 : 16)" :height="14"
        :text="node.label" class="osc-title"
      />
      <rect
        :x="oscCell.x"
        :y="oscCell.y"
        :width="oscCell.w"
        :height="oscCell.h"
        rx="4"
        class="osc-cell"
        :class="{ fixed: !editable }"
        :role="editable ? 'button' : undefined"
        :tabindex="editable ? 0 : undefined"
        :aria-label="editable ? `编辑 ${node.label} 频率` : undefined"
        @click.stop="onControlClick"
        @keydown.enter.space.stop.prevent="onControlClick"
      />
      <ClockLabel
        v-if="!inlineEditing"
        :x="oscCell.x + 3" :y="oscCell.y" :width="oscCell.w - 6" :height="oscCell.h"
        :text="oscValueText" align="center" class="osc-value"
      />
      <foreignObject
        v-else
        :x="oscCell.x"
        :y="oscCell.y"
        :width="oscCell.w"
        :height="oscCell.h"
        class="ctrl-inline"
        @click.stop
        @mousedown.stop
        @contextmenu.stop
      >
        <input
          ref="inputEl"
          v-model="draft"
          type="text"
          inputmode="decimal"
          class="inline-input"
          :class="{ invalid }"
          :aria-label="node.control?.label"
          @keydown="onNumberKeydown"
          @blur="commitNumber"
        />
      </foreignObject>
    </template>

    <!-- ===== mux：左竖块（radio 行即控件）+ 读数卡 ===== -->
    <template v-else-if="kind === 'mux'">
      <rect
        :x="node.x"
        :y="node.y"
        :width="PRIM.MUX_W"
        :height="node.h"
        rx="6"
        class="prim-block mux-box"
      />
      <g
        v-for="(row, i) in muxRows"
        :key="`${row.id}-${i}`"
        class="mux-row"
        :class="{ disabled: row.disabled }"
        :role="row.disabled ? undefined : 'button'"
        :tabindex="row.disabled ? undefined : 0"
        :aria-pressed="row.disabled ? undefined : row.selected"
        :aria-label="row.disabled ? undefined : row.label"
        @click.stop="onMuxRowClick(row)"
        @keydown.enter.space.stop.prevent="onMuxRowClick(row)"
      >
        <rect :x="node.x + 3" :y="muxRowCenter(i) - 7" :width="PRIM.MUX_W - 6" height="14" rx="3" class="mux-row-hit" :class="{ on: row.selected }" />
        <ClockLabel
          :x="node.x + 8" :y="muxRowCenter(i) - 7" :width="PRIM.MUX_W - 26" :height="14"
          :text="row.label" class="mux-label" :class="{ muted: row.displayOnly || !muxEditable }"
        />
        <circle
          :cx="node.x + PRIM.MUX_W - 12"
          :cy="muxRowCenter(i)"
          r="4"
          class="mux-dot"
          :class="{ on: row.selected, disabled: row.disabled }"
        />
      </g>
      <path :d="muxLink" class="cluster-link" :class="{ 'output-link': node.outputLabel }" />
      <path
        v-if="node.outputLabel"
        :d="`M ${muxCard.x} ${muxCard.y + muxCard.h / 2} l -5 -2.5 v 5 z`"
        class="output-arrow"
      />
    </template>

    <!-- ===== div：stepper(- N +) + 读数卡 ===== -->
    <template v-else-if="kind === 'div'">
      <g class="stepper" :class="{ disabled: !editable }">
        <rect :x="divStep.x" :y="divStep.y" :width="divStep.w" :height="divStep.h" rx="6" class="prim-block step-box" />
        <rect
          v-if="editable"
          :x="divStep.x + 2"
          :y="divStep.y + 2"
          :width="divStep.btnW"
          :height="divStep.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStep(-1) }"
          :role="canStep(-1) ? 'button' : undefined"
          :tabindex="canStep(-1) ? 0 : undefined"
          :aria-label="canStep(-1) ? `减小 ${node.control?.label || node.label}` : undefined"
          @click.stop="onStep(-1)"
          @keydown.enter.space.stop.prevent="onStep(-1)"
          @contextmenu.stop
        />
        <text
          v-if="editable"
          :x="divStep.x + 2 + divStep.btnW / 2"
          :y="divStep.y + divStep.h / 2 + 5"
          class="step-btn-text"
          :class="{ disabled: !canStep(-1) }"
        >
          −
        </text>
        <ClockLabel
          :x="divStep.x + divStep.btnW + 3" :y="divStep.y + (divStep.h - 15) / 2"
          :width="divStep.w - 2 * divStep.btnW - 6" :height="15"
          :text="divValue" align="center" class="step-val"
        />
        <rect
          v-if="editable"
          :x="divStep.x + divStep.w - 2 - divStep.btnW"
          :y="divStep.y + 2"
          :width="divStep.btnW"
          :height="divStep.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStep(1) }"
          :role="canStep(1) ? 'button' : undefined"
          :tabindex="canStep(1) ? 0 : undefined"
          :aria-label="canStep(1) ? `增大 ${node.control?.label || node.label}` : undefined"
          @click.stop="onStep(1)"
          @keydown.enter.space.stop.prevent="onStep(1)"
          @contextmenu.stop
        />
        <text
          v-if="editable"
          :x="divStep.x + divStep.w - 2 - divStep.btnW / 2"
          :y="divStep.y + divStep.h / 2 + 5"
          class="step-btn-text"
          :class="{ disabled: !canStep(1) }"
        >
          +
        </text>
      </g>
      <path :d="divLink" class="cluster-link" />
    </template>

    <!-- PLL 的说明随节点详情和悬停提示展示。 -->
    <template v-else-if="kind === 'pll'">
      <template v-if="muxRows.length">
        <rect
          :x="node.x"
          :y="node.y"
          :width="PRIM.MUX_W"
          :height="node.h"
          rx="6"
          class="prim-block mux-box"
        />
        <g
          v-for="(row, i) in muxRows"
          :key="`${row.id}-${i}`"
          class="mux-row"
          :class="{ disabled: row.disabled }"
          :role="row.disabled ? undefined : 'button'"
          :tabindex="row.disabled ? undefined : 0"
          :aria-pressed="row.disabled ? undefined : row.selected"
          :aria-label="row.disabled ? undefined : row.label"
          @click.stop="onMuxRowClick(row)"
          @keydown.enter.space.stop.prevent="onMuxRowClick(row)"
        >
          <rect :x="node.x + 3" :y="muxRowCenter(i) - 7" :width="PRIM.MUX_W - 6" height="14" rx="3" class="mux-row-hit" :class="{ on: row.selected }" />
          <ClockLabel
            :x="node.x + 8" :y="muxRowCenter(i) - 7" :width="PRIM.MUX_W - 26" :height="14"
            :text="row.label" class="mux-label" :class="{ muted: row.displayOnly || !muxEditable }"
          />
          <circle
            :cx="node.x + PRIM.MUX_W - 12"
            :cy="muxRowCenter(i)"
            r="4"
            class="mux-dot"
            :class="{ on: row.selected, disabled: row.disabled }"
          />
        </g>
      </template>
      <g
        v-for="(slot, i) in pllSteps"
        :key="slot.control.pllKey ?? i"
        class="stepper"
        :class="{ disabled: !controlEditable(slot.control) }"
      >
        <rect
          :x="slot.geom.x"
          :y="slot.geom.y"
          :width="slot.geom.w"
          :height="slot.geom.h"
          rx="6"
          class="prim-block step-box"
        />
        <rect
          :x="slot.geom.x + 2"
          :y="slot.geom.y + 2"
          :width="slot.geom.btnW"
          :height="slot.geom.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStepControl(slot.control, -1) }"
          :role="canStepControl(slot.control, -1) ? 'button' : undefined"
          :tabindex="canStepControl(slot.control, -1) ? 0 : undefined"
          :aria-label="canStepControl(slot.control, -1) ? `减小 ${slot.control.label}` : undefined"
          @click.stop="onStepControl(slot.control, -1)"
          @keydown.enter.space.stop.prevent="onStepControl(slot.control, -1)"
          @contextmenu.stop
        />
        <text
          :x="slot.geom.x + 2 + slot.geom.btnW / 2"
          :y="slot.geom.y + slot.geom.h / 2 + 5"
          class="step-btn-text"
          :class="{ disabled: !canStepControl(slot.control, -1) }"
        >
          −
        </text>
        <ClockLabel
          :x="slot.geom.x + (controlEditable(slot.control) ? slot.geom.btnW + 3 : 4)" :y="slot.geom.y + (slot.geom.h - 15) / 2"
          :width="slot.geom.w - (controlEditable(slot.control) ? 2 * slot.geom.btnW + 6 : 8)" :height="15"
          :text="ctrlText(slot.control)" align="center" class="step-val"
        />
        <rect
          :x="slot.geom.x + slot.geom.w - 2 - slot.geom.btnW"
          :y="slot.geom.y + 2"
          :width="slot.geom.btnW"
          :height="slot.geom.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStepControl(slot.control, 1) }"
          :role="canStepControl(slot.control, 1) ? 'button' : undefined"
          :tabindex="canStepControl(slot.control, 1) ? 0 : undefined"
          :aria-label="canStepControl(slot.control, 1) ? `增大 ${slot.control.label}` : undefined"
          @click.stop="onStepControl(slot.control, 1)"
          @keydown.enter.space.stop.prevent="onStepControl(slot.control, 1)"
          @contextmenu.stop
        />
        <text
          :x="slot.geom.x + slot.geom.w - 2 - slot.geom.btnW / 2"
          :y="slot.geom.y + slot.geom.h / 2 + 5"
          class="step-btn-text"
          :class="{ disabled: !canStepControl(slot.control, 1) }"
        >
          +
        </text>
      </g>
      <path v-for="(d, i) in pllLinks" :key="i" :d="d" class="cluster-link" />
    </template>

    <!-- 外设：来源、可编辑参数和生效结果。 -->
    <template v-else-if="kind === 'peri'">
      <rect :x="node.x" :y="node.y" :width="node.w" :height="node.h" rx="5" class="prim-block peri-card" />
      <ClockLabel
        :x="node.x + 9" :y="node.y + 5" :width="node.w - (hasMarker ? 28 : 18)" :height="15"
        :text="node.label" class="peri-title"
      />
      <!-- 旋钮行：adcClkDiv stepper / periParam select 常驻 / number 内联 -->
      <template v-if="node.control">
        <g v-if="stepperMode" class="stepper" :class="{ disabled: !editable }">
          <rect :x="periStep.x" :y="periStep.y" :width="periStep.w" :height="periStep.h" rx="6" class="prim-block step-box" />
          <rect
            :x="periStep.x + 2"
            :y="periStep.y + 2"
            :width="periStep.btnW"
            :height="periStep.h - 4"
            rx="4"
            class="step-btn-bg"
            :class="{ disabled: !canStep(-1) }"
            :role="canStep(-1) ? 'button' : undefined"
            :tabindex="canStep(-1) ? 0 : undefined"
            :aria-label="canStep(-1) ? `减小 ${node.control?.label || node.label}` : undefined"
            @click.stop="onStep(-1)"
            @keydown.enter.space.stop.prevent="onStep(-1)"
            @contextmenu.stop
          />
          <text
            :x="periStep.x + 2 + periStep.btnW / 2"
            :y="periStep.y + periStep.h / 2 + 5"
            class="step-btn-text"
            :class="{ disabled: !canStep(-1) }"
          >
            −
          </text>
          <ClockLabel
            :x="periStep.x + periStep.btnW + 3" :y="periStep.y + (periStep.h - 15) / 2"
            :width="periStep.w - 2 * periStep.btnW - 6" :height="15"
            :text="controlText" align="center" class="step-val"
          />
          <rect
            :x="periStep.x + periStep.w - 2 - periStep.btnW"
            :y="periStep.y + 2"
            :width="periStep.btnW"
            :height="periStep.h - 4"
            rx="4"
            class="step-btn-bg"
            :class="{ disabled: !canStep(1) }"
            :role="canStep(1) ? 'button' : undefined"
            :tabindex="canStep(1) ? 0 : undefined"
            :aria-label="canStep(1) ? `增大 ${node.control?.label || node.label}` : undefined"
            @click.stop="onStep(1)"
            @keydown.enter.space.stop.prevent="onStep(1)"
            @contextmenu.stop
          />
          <text
            :x="periStep.x + periStep.w - 2 - periStep.btnW / 2"
            :y="periStep.y + periStep.h / 2 + 5"
            class="step-btn-text"
            :class="{ disabled: !canStep(1) }"
          >
            +
          </text>
        </g>
        <foreignObject
          v-else-if="node.control.kind === 'select'"
          :x="periStep.x"
          :y="periStep.y"
          :width="periStep.w"
          :height="periStep.h"
          class="ctrl-inline"
          @click.stop
          @mousedown.stop
          @contextmenu.stop
        >
          <select
            class="peri-select"
            :value="String(node.control.value)"
            :disabled="!editable"
            :aria-label="node.control.label"
            @change="onSelectChange"
          >
            <option v-for="opt in node.control.options" :key="String(opt.value)" :value="String(opt.value)">
              {{ opt.label }}
            </option>
          </select>
        </foreignObject>
        <template v-else>
          <rect
            :x="periStep.x"
            :y="periStep.y"
            :width="periStep.w"
            :height="periStep.h"
            rx="4"
            class="ctrl-hit"
            :class="{ fixed: !editable }"
            :role="editable ? 'button' : undefined"
            :tabindex="editable ? 0 : undefined"
            :aria-label="editable ? `编辑 ${node.label} ${node.control.label}` : undefined"
            @click.stop="onControlClick"
            @keydown.enter.space.stop.prevent="onControlClick"
          />
          <ClockLabel
            v-if="!inlineEditing"
            :x="periStep.x + 8" :y="periStep.y + (periStep.h - 15) / 2" :width="periStep.w - 16" :height="15"
            :text="controlText" class="peri-value"
          />
          <foreignObject
            v-else
            :x="periStep.x"
            :y="periStep.y"
            :width="periStep.w"
            :height="periStep.h"
            class="ctrl-inline"
            @click.stop
            @mousedown.stop
            @contextmenu.stop
          >
            <input
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
          </foreignObject>
        </template>
      </template>

      <ClockLabel
        v-if="periResult"
        :x="node.x + 9" :y="node.y + (node.control ? 48 : 27)" :width="node.w - 18" :height="15"
        :text="periResult" :title="node.actualLabel || periResult" class="peri-result"
        :class="{ enabled: node.active, warning: node.issueLevel === 'warning', error: node.issueLevel === 'error' }"
      />
    </template>

    <template v-if="readout">
      <rect
        :x="readout.card.x" :y="readout.card.y"
        :width="readout.card.w" :height="readout.card.h"
        rx="6" class="prim-block readout-card"
      />
      <ClockLabel
        v-if="readout.label"
        :x="readout.card.x + 8" :y="readout.card.y + 3"
        :width="readout.card.w - (hasMarker ? 28 : 16)" :height="14"
        :text="readout.label" class="readout-label"
      />
      <ClockLabel
        :x="readout.card.x + 8" :y="readout.card.y + (readout.label ? 17 : 10)"
        :width="readout.card.w - (hasMarker ? 28 : 16)" :height="16"
        :text="cardOutText" class="readout-out" :class="node.issueLevel"
      />
      <ClockLabel
        v-if="visibleCaption"
        :x="readout.card.x + 8" :y="readout.card.y + (readout.label ? 32 : 27)"
        :width="readout.card.w - (hasMarker && !readout.label ? 28 : 16)" :height="11"
        :text="visibleCaption" class="readout-max"
      />
    </template>

    <!-- 问题标记：簇右上小圆点（error 红 / warning 橙），hover 见 <title> -->
    <circle
      v-if="node.issueLevel"
      :cx="marker.x"
      :cy="marker.y + (node.lockable ? 16 : 0)"
      r="3"
      class="issue-marker"
      :class="node.issueLevel"
    />
    <!-- 锁定开关：簇右上角（SVG 绘制，点击/右键切换；锁定后控件置灰） -->
    <g
      v-if="node.lockable"
      class="lock-btn"
      :class="{ on: node.locked }"
      role="button"
      tabindex="0"
      :aria-label="`${node.locked ? '解锁' : '锁定'} ${node.label}`"
      :aria-pressed="node.locked"
      @click="onToggleLock"
      @keydown.enter.space.stop.prevent="onToggleLock"
      @contextmenu.stop.prevent="onToggleLock"
    >
      <title>{{ node.locked ? '解锁该节点（预设/自动修复可再次修改）' : '锁定该节点（预设/自动修复保留当前值）' }}</title>
      <rect :x="marker.x - 8" :y="marker.y - 8" width="16" height="16" rx="4" class="lock-hit" />
      <path
        :d="`M ${marker.x - 3} ${marker.y} v-2 a 3 3 0 0 1 6 0 v2`"
        class="lock-shackle"
        fill="none"
        stroke-linecap="round"
      />
      <rect :x="marker.x - 4" :y="marker.y" width="8" height="6" rx="1.5" class="lock-body" />
    </g>
  </g>
</template>

<style scoped src="./primitives.css"></style>
<style scoped>
.node {
  cursor: pointer;
}
.node:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 3px;
}
.node.dimmed {
  opacity: 0.3;
}
.issue-marker {
  stroke: var(--mx-surface);
  stroke-width: 1.5;
}
.issue-marker.error {
  fill: var(--mx-error);
}
.issue-marker.warning {
  fill: var(--mx-warning);
}
/* 锁定开关图标：默认低透明度，悬停/锁定后高亮 */
.lock-btn {
  opacity: 0.35;
  transition: opacity var(--mx-dur-node) linear;
}
.node:hover .lock-btn,
.lock-btn:focus-visible,
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
</style>
