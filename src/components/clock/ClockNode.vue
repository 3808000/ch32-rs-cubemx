<script setup lang="ts">
// 单个时钟树节点：M16 按 node.kind 渲染 MX2 分离图元簇（契约 D1）。
//   osc    = 标题行 + 值格（HSE number 内联编辑；固定源静态值，<1MHz 自适应 kHz）
//   mux    = 左竖块（输入小 label + radio 点列，radio 行即控件）+ 读数卡
//   div    = stepper 块（- N +）+ 读数卡
//   pll    = mux(pllSource 行) + 参数 stepper（当前模型仅首参数）+ hint 静态补充 + 读数卡
//   readout= 单读数卡（out + max + 可选 hint 行）
//   peri   = airy 卡：标题+徽标 / 旋钮（number 内联 / select 常驻 / adcClkDiv stepper）/ 请求 / 实际
// 逻辑节点 props/emits、编辑态机、锁定、问题标记、右键菜单全部沿用 M15；
// 簇外包仍为 <g class="node">，ClockCanvas 的 pan 守卫形状不变。
import type { ClockNodeControl, ClockTreeNode } from '@/model/clock/tree'
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
/** 单字符宽度估算（em）：CJK/全角≈1，窄字符≈0.3，大写/数字≈0.62，其余≈0.55 */
function charWidthEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x2e80) return 1
  if (ch === ' ' || /[ilI.,:;'!|]/.test(ch)) return 0.3
  if (/[A-Z0-9]/.test(ch)) return 0.62
  return 0.55
}

function textWidthEm(text: string): number {
  let w = 0
  for (const ch of text) w += charWidthEm(ch)
  return w
}

/** 超宽时按字符边界截断并追加 …；不改变布局/锚点，仅影响渲染文本 */
function truncateText(text: string | null | undefined, maxWidth: number, fontSize: number): string {
  const full = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!full || maxWidth <= 0) return ''
  if (textWidthEm(full) * fontSize <= maxWidth) return full
  const ellEm = charWidthEm('…')
  let out = ''
  let acc = 0
  for (const ch of full) {
    const cw = charWidthEm(ch)
    if ((acc + cw + ellEm) * fontSize > maxWidth) break
    out += ch
    acc += cw
  }
  return `${out.trimEnd()}…`
}

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
      issueText.value,
      props.node.hint,
      props.node.requestedLabel ? `请求 ${props.node.requestedLabel}` : '',
      props.node.actualLabel,
    ]
      .filter(Boolean)
      .join('\n') || props.node.label,
)
const nodeClass = computed(() => ({
  selected: props.selected,
  dimmed: props.dimmed,
  inactive: !props.node.active,
  pulse: props.pulse,
  locked: props.node.locked,
  'display-only': !!props.node.displayOnly,
  'issue-error': props.node.issueLevel === 'error',
  'issue-warning': props.node.issueLevel === 'warning',
}))

/** 徽标右对齐位置：避开右上锁定图标/问题圆点 */
const badgeX = computed(
  () => props.node.x + props.node.w - (props.node.lockable ? 34 : props.node.issueLevel ? 16 : 8),
)

// ---------- mux 输入行（radio 行即控件） ----------
interface MuxRow {
  id: string
  label: string
  /** 按竖块可用宽度截断后的渲染文本（全文在行级 <title>） */
  labelText: string
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
      labelText: truncateText(label, PRIM.MUX_W - 28, 10),
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

/** 读数卡：两行基线差固定 18px；hint 行额外 +16px */
function cardGeom(x: number, y: number, hint: boolean): CardGeom {
  return { x, y, w: PRIM.READOUT_W, h: PRIM.READOUT_H + (hint ? 16 : 0) }
}

const muxCard = computed(() =>
  cardGeom(
    props.node.x + PRIM.MUX_W + PRIM.CLUSTER_GAP,
    props.node.y + Math.max(0, (props.node.h - PRIM.READOUT_H) / 2),
    false,
  ),
)
const divCard = computed(() =>
  cardGeom(
    props.node.x + PRIM.DIV_W + PRIM.CLUSTER_GAP,
    props.node.y + Math.max(0, (props.node.h - PRIM.READOUT_H) / 2),
    false,
  ),
)
const pllCard = computed(() =>
  cardGeom(
    props.node.x + props.node.w - PRIM.READOUT_W,
    props.node.y + Math.max(0, (props.node.h - PRIM.READOUT_H) / 2),
    false,
  ),
)
const readoutCard = computed(() => cardGeom(props.node.x, props.node.y, !!props.node.hint))

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
const pllSteps = computed<{ control: ClockNodeControl; geom: StepGeom; valueText: string }[]>(() => {
  if (kind.value !== 'pll') return []
  const list = props.node.pllControls?.length ? props.node.pllControls : props.node.control ? [props.node.control] : []
  if (!list.length) return []
  const h = Math.min(PRIM.STEP_H, props.node.h)
  const y = props.node.y + (props.node.h - h) / 2
  const x0 = props.node.x + (muxRows.value.length ? PRIM.MUX_W + PRIM.CLUSTER_GAP : 0)
  return list.map((control, i) => {
    const geom = stepGeom(x0 + i * (PRIM.STEP_W + PRIM.CLUSTER_GAP), y, PRIM.STEP_W, h)
    return {
      control,
      geom,
      valueText: truncateText(ctrlText(control), geom.w - geom.btnW * 2 - 8, 11),
    }
  })
})
const periStep = computed(() => stepGeom(props.node.x + 10, props.node.y + 28, props.node.w - 20, 30))

const divValue = computed(() => `÷${props.node.control?.value ?? '—'}`)

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

const pllHintPos = computed(() => ({
  x: props.node.x + (muxRows.value.length ? PRIM.MUX_W + PRIM.CLUSTER_GAP : 0) + 8,
  y: props.node.y + props.node.h / 2 + 4,
}))

// ---------- 渲染文本（按所在块宽截断；全文由行级 <title> 承载） ----------
const clusterTitleText = computed(() => truncateText(props.node.label, props.node.w, 10))
const oscTitleText = computed(() => truncateText(props.node.label, props.node.w - 16, 11))
const oscValueDisplay = computed(() => truncateText(oscValueText.value, oscCell.value.w - 8, 12))
const readoutHintText = computed(() => truncateText(props.node.hint, readoutCard.value.w - 20, 10))
const pllHintText = computed(() => {
  const usable = Math.max(20, props.node.x + props.node.w - 8 - pllHintPos.value.x)
  return truncateText(props.node.hint, usable, 10)
})
const periRequestText = computed(() =>
  truncateText(props.node.requestedLabel ? `请求 ${props.node.requestedLabel}` : '', props.node.w - 20, 10.5),
)
const periActualText = computed(() => truncateText(props.node.actualLabel, props.node.w - 20, 10.5))
const divValueText = computed(() => truncateText(divValue.value, divStep.value.w - divStep.value.btnW * 2 - 8, 11))
const periStepValueText = computed(() =>
  truncateText(controlText.value, periStep.value.w - periStep.value.btnW * 2 - 8, 11),
)
const periValueText = computed(() => truncateText(controlText.value, periStep.value.w - 16, 11))
/** 读数卡两行（四类簇共用 READOUT_W） */
const cardOutText = computed(() => truncateText(formatMhz(props.node.outMhz), PRIM.READOUT_W - 20, 13))
const cardMaxText = computed(() => truncateText(`max ${formatMhz(props.node.maxMhz)}`, PRIM.READOUT_W - 20, 10))

// ---------- 外设卡片 geometry（行距硬约束：标题→控件 14、请求→实际 20） ----------
const periCard = computed(() => ({ x: props.node.x, y: props.node.y, w: PRIM.PERI_W, h: PRIM.PERI_H }))
const periTitleFo = computed(() => ({
  x: props.node.x + 10,
  y: props.node.y + 1,
  w: Math.max(40, props.node.w - 70),
  h: 16,
}))
/** peri 徽标右对齐；有问题圆点时左移避让 */
const periBadgeX = computed(() => props.node.x + props.node.w - (props.node.issueLevel ? 16 : 10))

// ---------- stepper 单步（复用 inlineEdit 纯函数） ----------
/** 单个参数控件可编辑（fixed/锁定/displayOnly 置灰） */
function controlEditable(c: ClockNodeControl | null | undefined): boolean {
  return canEditControl(c, props.node.locked) && !props.node.displayOnly
}

function canStepControl(c: ClockNodeControl | null | undefined, dir: -1 | 1): boolean {
  return controlEditable(c) && stepControlValue(c, dir) !== null
}

function onStepControl(c: ClockNodeControl, dir: -1 | 1) {
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
function onControlClick(e: MouseEvent) {
  e.stopPropagation()
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
      el?.focus()
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
  if (v !== null) emit('control-change', c, v)
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

function onToggleLock(e: MouseEvent) {
  e.stopPropagation()
  emit('toggle-lock', props.node.id)
}
</script>

<template>
  <g class="node" :class="nodeClass" @click="emit('focus', node.id)" @contextmenu="onContextMenu">
    <title>{{ hoverText }}</title>

    <!-- M16：簇外上方 10px muted 节点标题（osc/peri 已有内部标题，不重复） -->
    <text v-if="kind !== 'osc' && kind !== 'peri'" :x="node.x" :y="node.y - 6" class="cluster-title">
      {{ clusterTitleText }}<title>{{ node.label }}</title>
    </text>

    <!-- ===== osc：标题行 + 值格 ===== -->
    <template v-if="kind === 'osc'">
      <text :x="node.x + 8" :y="node.y + 12" class="osc-title">
        {{ oscTitleText }}<title>{{ node.label }}</title>
      </text>
      <rect
        :x="oscCell.x"
        :y="oscCell.y"
        :width="oscCell.w"
        :height="oscCell.h"
        rx="4"
        class="prim-block osc-cell"
        :class="{ fixed: !editable }"
        @click.stop="onControlClick"
      />
      <text
        v-if="!inlineEditing"
        :x="oscCell.x + oscCell.w / 2"
        :y="oscCell.y + oscCell.h - 4"
        text-anchor="middle"
        class="osc-value"
      >
        {{ oscValueDisplay }}<title>{{ oscValueText }}</title>
      </text>
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
        :key="row.id"
        class="mux-row"
        :class="{ disabled: row.disabled }"
        role="button"
        @click.stop="onMuxRowClick(row)"
        @contextmenu.stop
      >
        <text :x="node.x + 10" :y="muxRowCenter(i) + 3.5" class="mux-label" :class="{ muted: row.displayOnly || !muxEditable }">
          {{ row.labelText }}<title>{{ row.label }}</title>
        </text>
        <circle
          :cx="node.x + PRIM.MUX_W - 12"
          :cy="muxRowCenter(i)"
          r="4"
          class="mux-dot"
          :class="{ on: row.selected, disabled: row.disabled }"
        />
      </g>
      <path :d="muxLink" class="cluster-link" />
      <rect :x="muxCard.x" :y="muxCard.y" :width="muxCard.w" :height="muxCard.h" rx="6" class="prim-block readout-card" />
      <text :x="muxCard.x + 10" :y="muxCard.y + 20" class="readout-out" :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }">
        {{ cardOutText }}<title>{{ formatMhz(node.outMhz) }}</title>
      </text>
      <text :x="muxCard.x + 10" :y="muxCard.y + 38" class="readout-max">{{ cardMaxText }}<title>max {{ formatMhz(node.maxMhz) }}</title></text>
    </template>

    <!-- ===== div：stepper(- N +) + 读数卡 ===== -->
    <template v-else-if="kind === 'div'">
      <g class="stepper" :class="{ disabled: !editable }">
        <rect :x="divStep.x" :y="divStep.y" :width="divStep.w" :height="divStep.h" rx="6" class="prim-block step-box" />
        <rect
          :x="divStep.x + 2"
          :y="divStep.y + 2"
          :width="divStep.btnW"
          :height="divStep.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStep(-1) }"
          @click.stop="onStep(-1)"
          @contextmenu.stop
        />
        <text
          :x="divStep.x + 2 + divStep.btnW / 2"
          :y="divStep.y + divStep.h / 2 + 5"
          class="step-btn-text"
          :class="{ disabled: !canStep(-1) }"
        >
          −
        </text>
        <text :x="divStep.x + divStep.w / 2" :y="divStep.y + divStep.h / 2 + 4" class="step-val">
          {{ divValueText }}<title>{{ divValue }}</title>
        </text>
        <rect
          :x="divStep.x + divStep.w - 2 - divStep.btnW"
          :y="divStep.y + 2"
          :width="divStep.btnW"
          :height="divStep.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStep(1) }"
          @click.stop="onStep(1)"
          @contextmenu.stop
        />
        <text
          :x="divStep.x + divStep.w - 2 - divStep.btnW / 2"
          :y="divStep.y + divStep.h / 2 + 5"
          class="step-btn-text"
          :class="{ disabled: !canStep(1) }"
        >
          +
        </text>
      </g>
      <path :d="divLink" class="cluster-link" />
      <rect :x="divCard.x" :y="divCard.y" :width="divCard.w" :height="divCard.h" rx="6" class="prim-block readout-card" />
      <text :x="divCard.x + 10" :y="divCard.y + 20" class="readout-out" :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }">
        {{ cardOutText }}<title>{{ formatMhz(node.outMhz) }}</title>
      </text>
      <text :x="divCard.x + 10" :y="divCard.y + 38" class="readout-max">{{ cardMaxText }}<title>max {{ formatMhz(node.maxMhz) }}</title></text>
    </template>

    <!-- ===== pll：mux(pllSource) + 参数 stepper 链 + hint + 读数卡 ===== -->
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
          :key="row.id"
          class="mux-row"
          :class="{ disabled: row.disabled }"
          role="button"
          @click.stop="onMuxRowClick(row)"
          @contextmenu.stop
        >
          <text :x="node.x + 10" :y="muxRowCenter(i) + 3.5" class="mux-label" :class="{ muted: row.displayOnly || !muxEditable }">
            {{ row.labelText }}<title>{{ row.label }}</title>
          </text>
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
          @click.stop="onStepControl(slot.control, -1)"
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
        <text :x="slot.geom.x + slot.geom.w / 2" :y="slot.geom.y + slot.geom.h / 2 + 4" class="step-val">
          {{ slot.valueText }}<title>{{ ctrlText(slot.control) }}</title>
        </text>
        <rect
          :x="slot.geom.x + slot.geom.w - 2 - slot.geom.btnW"
          :y="slot.geom.y + 2"
          :width="slot.geom.btnW"
          :height="slot.geom.h - 4"
          rx="4"
          class="step-btn-bg"
          :class="{ disabled: !canStepControl(slot.control, 1) }"
          @click.stop="onStepControl(slot.control, 1)"
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
      <text v-if="node.hint && !pllSteps.length" :x="pllHintPos.x" :y="pllHintPos.y" class="pll-hint">
        {{ pllHintText }}<title>{{ node.hint }}</title>
      </text>
      <path v-for="(d, i) in pllLinks" :key="i" :d="d" class="cluster-link" />
      <rect :x="pllCard.x" :y="pllCard.y" :width="pllCard.w" :height="pllCard.h" rx="6" class="prim-block readout-card" />
      <text :x="pllCard.x + 10" :y="pllCard.y + 20" class="readout-out" :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }">
        {{ cardOutText }}<title>{{ formatMhz(node.outMhz) }}</title>
      </text>
      <text :x="pllCard.x + 10" :y="pllCard.y + 38" class="readout-max">{{ cardMaxText }}<title>max {{ formatMhz(node.maxMhz) }}</title></text>
    </template>

    <!-- ===== readout：单读数卡（out + max + 可选 hint） ===== -->
    <template v-else-if="kind === 'readout'">
      <rect
        :x="readoutCard.x"
        :y="readoutCard.y"
        :width="readoutCard.w"
        :height="readoutCard.h"
        rx="6"
        class="prim-block readout-card"
      />
      <text :x="readoutCard.x + 10" :y="readoutCard.y + 20" class="readout-out" :class="{ error: node.issueLevel === 'error', warning: node.issueLevel === 'warning' }">
        {{ cardOutText }}<title>{{ formatMhz(node.outMhz) }}</title>
      </text>
      <text :x="readoutCard.x + 10" :y="readoutCard.y + 38" class="readout-max">{{ cardMaxText }}<title>max {{ formatMhz(node.maxMhz) }}</title></text>
      <text v-if="node.hint" :x="readoutCard.x + 10" :y="readoutCard.y + 54" class="readout-hint">
        {{ readoutHintText }}<title>{{ node.hint }}</title>
      </text>
    </template>

    <!-- ===== peri：airy 卡（标题+徽标 / 旋钮 / 请求 / 实际） ===== -->
    <template v-else>
      <rect :x="periCard.x" :y="periCard.y" :width="periCard.w" :height="periCard.h" rx="8" class="prim-block peri-card" />
      <foreignObject
        :x="periTitleFo.x"
        :y="periTitleFo.y"
        :width="periTitleFo.w"
        :height="periTitleFo.h"
        class="peri-title-fo"
      >
        <div class="peri-title" :title="node.label">{{ node.label }}</div>
      </foreignObject>
      <text v-if="badgeLabel" :x="periBadgeX" :y="node.y + 14" text-anchor="end" class="node-badge">
        {{ badgeLabel }}
      </text>

      <!-- 旋钮行（30px）：adcClkDiv stepper / periParam select 常驻 / number 内联 -->
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
            @click.stop="onStep(-1)"
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
          <text :x="periStep.x + periStep.w / 2" :y="periStep.y + periStep.h / 2 + 4" class="step-val">
            {{ periStepValueText }}<title>{{ controlText }}</title>
          </text>
          <rect
            :x="periStep.x + periStep.w - 2 - periStep.btnW"
            :y="periStep.y + 2"
            :width="periStep.btnW"
            :height="periStep.h - 4"
            rx="4"
            class="step-btn-bg"
            :class="{ disabled: !canStep(1) }"
            @click.stop="onStep(1)"
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
            @click.stop="onControlClick"
          />
          <text v-if="!inlineEditing" :x="periStep.x + 8" :y="periStep.y + periStep.h / 2 + 4" class="peri-value">
            {{ periValueText }}<title>{{ controlText }}</title>
          </text>
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

      <text v-if="node.requestedLabel" :x="node.x + 10" :y="node.y + 73" class="peri-req">
        {{ periRequestText }}<title>请求 {{ node.requestedLabel }}</title>
      </text>
      <text v-if="node.actualLabel" :x="node.x + 10" :y="node.y + 93" class="peri-act">
        {{ periActualText }}<title>{{ node.actualLabel }}</title>
      </text>
    </template>

    <!-- 问题标记：簇右上小圆点（error 红 / warning 橙），hover 见 <title> -->
    <circle
      v-if="node.issueLevel"
      :cx="node.x + node.w - 7"
      :cy="node.y + 7"
      r="4"
      class="issue-marker"
      :class="node.issueLevel"
    />
    <!-- 锁定开关：簇右上角（SVG 绘制，点击/右键切换；锁定后控件置灰） -->
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
    <!-- 徽标：fixed / derived / raw（peri 徽标在标题行内右对齐，其余簇右上） -->
    <text v-if="badgeLabel && kind !== 'peri'" :x="badgeX" :y="node.y + 12" text-anchor="end" class="node-badge">
      {{ badgeLabel }}
    </text>
  </g>
</template>

<style scoped src="./primitives.css"></style>
<style scoped>
.node {
  cursor: pointer;
}
.node.dimmed {
  opacity: 0.3;
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
.node-badge {
  font-size: 9px;
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
</style>
