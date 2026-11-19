<script setup lang="ts">
// 时钟树画布：原生 SVG 绘制 + 缩放工具条 + 节点内嵌控件内联编辑。
// 越界按级别着色（error 红 / warning 橙）、连接点实心蓝/空心灰、点节点向父级抛 focus。
// 节点 / 连线拆分到 components/clock/ 子组件；本组件保留画布、缩放与交互状态，
// 并协调 editingNodeId：同一时刻画布内只允许一个节点处于编辑态（开新关旧）。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Aim, FullScreen, Position, Pointer, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import type { ClockNodeControl, ClockTreeGroup, ClockTreeNode, ClockTreeLayout } from '@/model/clock/tree'
import ClockNode from '@/components/clock/ClockNode.vue'
import ClockWire from '@/components/clock/ClockWire.vue'
import { arrowScrollDelta, clampZoom, shouldIgnoreSceneKeys } from '@/components/common/canvasNav'
import { computeHighlightSet, edgeInHighlight } from '@/components/clock/graph'
import { arrangeClockDiagram, findClockJunctions } from '@/components/clock/diagram'

const props = defineProps<{
  layout: ClockTreeLayout
  selectedId: string | null
  searchMatches?: ReadonlySet<string> | null
  /** 路径高亮节点集合（空=不高亮；非空时其余节点/边 dim） */
  highlightIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'control-change', control: ClockNodeControl, value: string | number): void
  (e: 'toggle-lock', nodeId: string): void
  (e: 'contextmenu', nodeId: string, x: number, y: number): void
}>()

const diagram = computed(() => arrangeClockDiagram(props.layout))
const trunkNodes = computed(() => computeHighlightSet(
  diagram.value.edges.filter((edge) => edge.active), 'AHB', 'upstream',
))

// ---------- 分组标签截断（SVG text 无 ellipsis；全文走 <title>） ----------
/** 单字符宽度估算（em）：CJK/全角≈1，窄字符≈0.3，大写/数字≈0.62，其余≈0.55 */
function charWidthEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x2e80) return 1
  if (ch === ' ' || /[ilI.,:;'!|]/.test(ch)) return 0.3
  if (/[A-Z0-9]/.test(ch)) return 0.62
  return 0.55
}

function truncateGroupLabel(text: string, maxWidth: number): string {
  const full = text.replace(/\s+/g, ' ').trim()
  const widthOf = (s: string): number => {
    let w = 0
    for (const ch of s) w += charWidthEm(ch)
    return w * 11
  }
  if (!full || widthOf(full) <= maxWidth) return full
  const ellW = charWidthEm('…') * 11
  let out = ''
  let acc = 0
  for (const ch of full) {
    const cw = charWidthEm(ch) * 11
    if (acc + cw + ellW > maxWidth) break
    out += ch
    acc += cw
  }
  return `${out.trimEnd()}…`
}

/** 分组标签可用宽度 = 组宽 - 左右各 10px 内边距 */
function groupLabelText(g: ClockTreeGroup): string {
  const readable = g.id === 'g-aux' ? '辅助时钟' : g.label.split(/[（(·]/, 1)[0]!
  return truncateGroupLabel(readable, Math.max(20, g.w - 20))
}

// ---------- 缩放与定位 ----------
const MIN_READABLE_SCALE = 0.64
const MIN_OVERVIEW_SCALE = 0.56
const MAX_SCALE = 3
const SIDE_PAD = 24
const TOP_PAD = 24
const BOTTOM_PAD = 24
const scrollEl = ref<HTMLElement | null>(null)
const innerEl = ref<HTMLElement | null>(null)
const box = reactive({ w: 0, h: 0 })
const scaleMode = ref<'auto' | 'reading' | 'fit'>('auto')
const manualScale = ref<number | null>(null)
let resizeObserver: ResizeObserver | null = null

function measureViewport() {
  const el = scrollEl.value
  if (!el) return
  // ResizeObserver 观察边框尺寸。缩放时滚动条出现或消失无需重算适应比例。
  box.w = el.offsetWidth
  box.h = el.offsetHeight
}

onMounted(() => {
  if (!scrollEl.value) return
  measureViewport()
  resizeObserver = new ResizeObserver(measureViewport)
  resizeObserver.observe(scrollEl.value, { box: 'border-box' })
  window.addEventListener('keyup', onSceneKeyUp)
  window.addEventListener('blur', onWindowBlur)
})

const widthScale = computed(() => Math.max(1, box.w - SIDE_PAD * 2) / diagram.value.width)
const fitScale = computed(() => Math.min(1, widthScale.value, Math.max(1, box.h - TOP_PAD - BOTTOM_PAD) / diagram.value.height))
const readingScale = computed(() => Math.min(1, Math.max(MIN_READABLE_SCALE, widthScale.value)))
const fitting = computed(() => scaleMode.value === 'fit' || (scaleMode.value === 'auto' && fitScale.value >= MIN_OVERVIEW_SCALE))
const effScale = computed(() => manualScale.value ?? (fitting.value ? fitScale.value : readingScale.value))
const zoomPercent = computed(() => `${Math.max(1, Math.round(effScale.value * 100))}%`)

async function zoomAt(factor: number, clientX?: number, clientY?: number) {
  const el = scrollEl.value
  const inner = innerEl.value
  if (!el || !inner) return
  const before = inner.getBoundingClientRect()
  const viewport = el.getBoundingClientRect()
  const x = clientX ?? viewport.left + el.clientWidth / 2
  const y = clientY ?? viewport.top + el.clientHeight / 2
  const oldScale = effScale.value
  const target = clampZoom(oldScale, factor, Math.min(0.3, fitScale.value), MAX_SCALE)
  if (target === oldScale) return
  const sceneX = (x - before.left) / oldScale
  const sceneY = (y - before.top) / oldScale
  manualScale.value = target
  await nextTick()
  const after = inner.getBoundingClientRect()
  el.scrollLeft += after.left + sceneX * target - x
  el.scrollTop += after.top + sceneY * target - y
}

async function setScaleMode(mode: 'reading' | 'fit') {
  manualScale.value = null
  scaleMode.value = mode
  await nextTick()
  scrollEl.value?.scrollTo(0, 0)
}

async function revealNode(id: string) {
  const el = scrollEl.value
  const inner = innerEl.value
  const node = diagram.value.nodes.find((item) => item.id === id)
  if (!el || !inner || !node) return
  if (effScale.value < readingScale.value) {
    manualScale.value = null
    scaleMode.value = 'reading'
    await nextTick()
  }
  const bounds = el.getBoundingClientRect()
  const scene = inner.getBoundingClientRect()
  el.scrollBy({
    left: scene.left - bounds.left + (node.x + node.w / 2) * effScale.value - el.clientWidth / 2,
    top: scene.top - bounds.top + (node.y + node.h / 2) * effScale.value - (el.clientHeight - BOTTOM_PAD) / 2,
  })
}
async function revealPeripherals() {
  const section = diagram.value.peripheralSection
  const el = scrollEl.value
  const inner = innerEl.value
  if (!section || !el || !inner) return
  if (effScale.value < readingScale.value) await setScaleMode('reading')
  el.scrollBy({
    left: inner.getBoundingClientRect().left - el.getBoundingClientRect().left + section.x * effScale.value - SIDE_PAD,
    top: -el.scrollTop,
  })
}
defineExpose({ revealNode, revealPeripherals })

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    if (!e.deltaY) return
    void zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  } else if (e.shiftKey && e.deltaY && !e.deltaX && scrollEl.value) {
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scrollEl.value.clientWidth : 1
    scrollEl.value.scrollLeft += e.deltaY * unit
  }
}

// ---------- 平移与画布内快捷键 ----------
const panning = ref(false)
const handMode = ref(false)
const spaceHeld = ref(false)
const effectiveHand = computed(() => handMode.value || spaceHeld.value)
let panStart: { id: number; x: number; y: number; left: number; top: number } | null = null

function onPanStart(e: PointerEvent) {
  const el = scrollEl.value
  if (!el || e.pointerType === 'touch' || (e.button !== 0 && e.button !== 1)) return
  const target = e.target as Element
  if (target.closest('button, input, select, textarea')) return
  if (e.button === 0 && !effectiveHand.value && target.closest('.node')) return
  e.preventDefault()
  el.focus({ preventScroll: true })
  el.setPointerCapture(e.pointerId)
  panStart = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
  panning.value = true
}
function onPanMove(e: PointerEvent) {
  if (panStart?.id !== e.pointerId || !scrollEl.value) return
  scrollEl.value.scrollLeft = panStart.left - (e.clientX - panStart.x)
  scrollEl.value.scrollTop = panStart.top - (e.clientY - panStart.y)
}
function onPanEnd(e: PointerEvent) {
  if (panStart?.id !== e.pointerId) return
  panStart = null
  panning.value = false
}
function onSceneKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey ||
      shouldIgnoreSceneKeys(target?.tagName, !!target?.isContentEditable, editingNodeId.value !== null)) return
  if (e.key === ' ') {
    e.preventDefault()
    spaceHeld.value = true
    return
  }
  const delta = arrowScrollDelta(e.key)
  if (!delta.x && !delta.y) return
  e.preventDefault()
  scrollEl.value?.scrollBy({ left: delta.x, top: delta.y })
}
function onSceneKeyUp(e: KeyboardEvent) {
  if (e.key === ' ') spaceHeld.value = false
}
function onWindowBlur() {
  if (panStart && scrollEl.value?.hasPointerCapture(panStart.id)) {
    scrollEl.value.releasePointerCapture(panStart.id)
  }
  panStart = null
  panning.value = false
  spaceHeld.value = false
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keyup', onSceneKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  if (pulseTimer !== null) window.clearTimeout(pulseTimer)
})

// ---------- 配置变化高亮脉冲（应用预设/修改控件后，频率发生变化的节点闪一次） ----------
const pulseIds = ref<Set<string>>(new Set())
let pulseTimer: number | null = null
function freqSignature(n: ClockTreeNode): string {
  return `${n.inMhz ?? ''}→${n.outMhz ?? ''}`
}
watch(
  () => props.layout.nodes,
  (nodes, prev) => {
    if (!prev?.length) return
    const before = new Map(prev.map((n) => [n.id, freqSignature(n)]))
    const changed = nodes.filter((n) => before.has(n.id) && before.get(n.id) !== freqSignature(n)).map((n) => n.id)
    if (changed.length === 0) return
    pulseIds.value = new Set(changed)
    if (pulseTimer !== null) window.clearTimeout(pulseTimer)
    pulseTimer = window.setTimeout(() => {
      pulseIds.value = new Set()
      pulseTimer = null
    }, 240)
  },
)

/** 非空路径高亮集合（空集合视为未启用） */
const highlight = computed<ReadonlySet<string> | null>(() =>
  props.highlightIds && props.highlightIds.size > 0 ? props.highlightIds : null,
)

/** 连线按目标节点问题级别着色 */
const levelById = computed(() => {
  const m = new Map<string, 'error' | 'warning' | null>()
  for (const n of props.layout.nodes) m.set(n.id, n.issueLevel)
  return m
})
function edgeLevel(to: string): 'error' | 'warning' | null {
  return levelById.value.get(to) ?? null
}
function isTrunkEdge(edge: ClockTreeLayout['edges'][number]) {
  return edge.active && edgeInHighlight(edge, trunkNodes.value)
}
function nodeDimmed(id: string): boolean {
  const searchDim = !!props.searchMatches && !props.searchMatches.has(id) && props.selectedId !== id
  const highlightDim = highlight.value !== null && !highlight.value.has(id)
  return searchDim || highlightDim
}
/** 每个节点当前生效入边来源（M16：PLL 源选择无独立控件值，用它点亮 mux 行） */
const activeInputById = computed(() => {
  const m = new Map<string, string>()
  for (const e of props.layout.edges) if (e.active) m.set(e.to, e.from)
  return m
})
/** 仅显示源节点 id（M16：mux 灰行判定；不参与 control options） */
const displayOnlyInputs = computed(() => props.layout.nodes.filter((n) => n.displayOnly).map((n) => n.id))
function edgeDimmed(edge: { from: string; to: string }): boolean {
  if (highlight.value !== null && !edgeInHighlight(edge, highlight.value)) return true
  const matches = props.searchMatches
  return !!matches && !matches.has(edge.from) && !matches.has(edge.to)
}

// 共享走廊先绘制灰线，避免覆盖已启用、告警或正在高亮的路径。
const orderedEdges = computed(() => {
  const weight = (edge: ClockTreeLayout['edges'][number]) =>
    (edgeDimmed(edge) ? 0 : 8) + (edge.active ? 1 : 0) + (isTrunkEdge(edge) ? 2 : 0) + (edge.active && edgeLevel(edge.to) ? 4 : 0)
  return [...diagram.value.edges].sort((a, b) => weight(a) - weight(b))
})
const junctions = computed(() => findClockJunctions(orderedEdges.value.filter((edge) => !edgeDimmed(edge))))
function edgeHighlighted(edge: ClockTreeLayout['edges'][number]) {
  return highlight.value !== null && edgeInHighlight(edge, highlight.value) && !edgeDimmed(edge)
}

const svgW = computed(() => diagram.value.width * effScale.value)
const svgH = computed(() => diagram.value.height * effScale.value)

// ---------- 节点内嵌控件内联编辑（foreignObject 原位编辑，画布协调单一编辑态） ----------
const editingNodeId = ref<string | null>(null)

/** 节点请求进入编辑态：单一状态天然「开新关旧」（旧节点 editing 变 false 即退出） */
function startEdit(nodeId: string) {
  editingNodeId.value = nodeId
}

/** 节点退出编辑态（提交/取消/置灰）：仅当仍是当前编辑节点时清空，避免误关新打开的节点 */
function endEdit(nodeId: string) {
  if (editingNodeId.value === nodeId) editingNodeId.value = null
}

/** 点击画布空白处关闭编辑态（控件行点击已 stopPropagation，不会误关） */
function closeEdit() {
  editingNodeId.value = null
}

/** 内联编辑提交：契约与既有 ClockView @control-change 一致 (control, value) */
function onControlChange(control: ClockNodeControl, value: string | number) {
  emit('control-change', control, value)
}

// 编辑节点随布局变化消失（如切换芯片）时清空编辑态
watch(
  () => props.layout.nodes,
  (nodes) => {
    if (editingNodeId.value !== null && !nodes.some((n) => n.id === editingNodeId.value)) editingNodeId.value = null
  },
)

function onNodeClick(nodeId: string) {
  emit('focus', nodeId)
}

function onNodeContextMenu(nodeId: string, x: number, y: number) {
  emit('contextmenu', nodeId, x, y)
}
</script>

<template>
  <div class="canvas-wrap" :class="{ hand: effectiveHand, panning }">
    <div
      ref="scrollEl"
      class="canvas-scroll"
      tabindex="0"
      aria-label="时钟树画布"
      @wheel="onWheel"
      @click="closeEdit"
      @keydown="onSceneKeyDown"
      @pointerdown="onPanStart"
      @pointermove="onPanMove"
      @pointerup="onPanEnd"
      @pointercancel="onPanEnd"
      @lostpointercapture="onPanEnd"
    >
      <div ref="innerEl" class="canvas-inner" :style="{ width: svgW + 'px', height: svgH + 'px' }">
        <svg :width="svgW" :height="svgH" :viewBox="`0 0 ${diagram.width} ${diagram.height}`" class="clock-svg">
          <g v-if="diagram.peripheralSection">
            <line
              :x1="diagram.peripheralSection.x - 12" :x2="diagram.peripheralSection.x - 12"
              :y1="diagram.peripheralSection.y" :y2="diagram.height - 22"
              class="peripheral-divider"
            />
            <text :x="diagram.peripheralSection.x + 8" :y="diagram.peripheralSection.y + 21" class="peripheral-heading">外设时钟</text>
          </g>
          <g v-for="g in diagram.groups" :key="g.id">
            <rect v-if="g.id === 'g-sys'" :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="7" class="system-lane" />
            <path :d="`M ${g.x + 1} ${g.y + 3} v 10`" class="group-tick" />
            <text :x="g.x + 10" :y="g.y + 12" class="group-label">
              {{ groupLabelText(g) }}<title>{{ g.label }}</title>
            </text>
          </g>

          <!-- 连线（正交折线）：按目标节点问题级别着色 + 高亮 dim -->
          <ClockWire
            v-for="e in orderedEdges"
            :key="e.id"
            :edge="e"
            :target-level="edgeLevel(e.to)"
            :primary="isTrunkEdge(e)"
            :dimmed="edgeDimmed(e)"
            :highlighted="edgeHighlighted(e)"
          />
          <circle
            v-for="junction in junctions"
            :key="`${junction.x}-${junction.y}`"
            :cx="junction.x"
            :cy="junction.y"
            r="2.7"
            class="wire-junction"
            :class="{ active: junction.active }"
          />

          <!-- 节点 -->
          <ClockNode
            v-for="n in diagram.nodes"
            :key="n.id"
            :node="n"
            :selected="n.id === selectedId"
            :search-hit="searchMatches?.has(n.id)"
            :dimmed="nodeDimmed(n.id)"
            :pulse="pulseIds.has(n.id)"
            :primary="trunkNodes.has(n.id)"
            :editing="n.id === editingNodeId"
            :active-input="activeInputById.get(n.id) ?? null"
            :display-only-inputs="displayOnlyInputs"
            @focus="onNodeClick"
            @edit-start="startEdit"
            @edit-end="endEdit"
            @control-change="onControlChange"
            @toggle-lock="(id: string) => emit('toggle-lock', id)"
            @contextmenu="onNodeContextMenu"
          />
        </svg>
      </div>
    </div>

    <div class="canvas-tools">
      <div class="zoom-bar" role="group" aria-label="画布工具">
        <button class="zb-btn" :class="{ active: !handMode }" :aria-pressed="!handMode" title="选择节点" aria-label="选择节点" @click="handMode = false">
          <el-icon :size="17"><Position /></el-icon>
        </button>
        <button class="zb-btn" :class="{ active: handMode }" :aria-pressed="handMode" title="抓手平移" aria-label="抓手平移" @click="handMode = true">
          <el-icon :size="17"><Pointer /></el-icon>
        </button>
        <span class="zb-sep"></span>
        <button class="zb-btn" title="缩小" aria-label="缩小" @click="zoomAt(1 / 1.18)"><el-icon :size="17"><ZoomOut /></el-icon></button>
        <output class="zb-percent" aria-label="缩放比例">{{ zoomPercent }}</output>
        <button class="zb-btn" title="放大" aria-label="放大" @click="zoomAt(1.18)"><el-icon :size="17"><ZoomIn /></el-icon></button>
        <span class="zb-sep"></span>
        <button class="zb-btn" title="回到主干" aria-label="回到主干" @click="setScaleMode('reading')"><el-icon :size="17"><Aim /></el-icon></button>
        <button class="zb-btn" title="全图总览" aria-label="全图总览" @click="setScaleMode('fit')"><el-icon :size="17"><FullScreen /></el-icon></button>
      </div>
      <div class="canvas-legend" aria-label="连线图例">
        <span><i class="legend-wire active"></i>工作路径</span>
        <span><i class="legend-wire"></i>其他路径</span>
      </div>
      <div class="canvas-actions"><slot name="actions" /></div>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--clock-border);
  border-radius: 10px;
  container: clock-canvas / inline-size;
}
.canvas-scroll {
  flex: 1 1 0;
  width: 100%;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  display: flex;
  justify-content: safe center;
  align-items: flex-start;
  overscroll-behavior: contain;
  background-color: #f0f5f2;
}
.canvas-scroll:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}
.hand .canvas-scroll,
.hand .canvas-scroll :deep(.node *) {
  cursor: grab;
}
.panning .canvas-scroll,
.panning .canvas-scroll :deep(.node *) {
  cursor: grabbing;
  user-select: none;
}
.canvas-inner {
  position: relative;
  flex: none;
  background: #fff;
  border-radius: 4px;
}
.clock-svg {
  display: block;
  width: 100%;
  height: 100%;
}
.wire-junction {
  fill: var(--clock-wire);
  pointer-events: none;
}
.wire-junction.active {
  fill: var(--clock-active-wire);
}
.peripheral-divider {
  stroke: var(--clock-border);
}
.peripheral-heading {
  font-size: 16px;
  font-weight: 700;
  fill: var(--clock-ink);
}
.system-lane {
  fill: #edf6f1;
}
.group-tick {
  fill: none;
  stroke: #829b90;
  stroke-width: 2;
}
.group-label {
  font-size: 12px;
  font-weight: 700;
  fill: var(--clock-ink);
}
.canvas-tools {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
  padding: 5px 10px;
  background: var(--mx-surface);
  border-top: 1px solid var(--clock-border);
}
.zoom-bar {
  display: flex;
  align-items: center;
  gap: 2px;
}
.zb-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: 5px;
  color: var(--clock-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.zb-btn:hover,
.zb-btn.active {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.zb-percent {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--clock-ink);
  min-width: 44px;
  text-align: center;
}
.zb-sep {
  width: 1px;
  height: 18px;
  background: var(--clock-border);
  margin: 0 2px;
}
.canvas-legend {
  display: flex;
  gap: 12px;
  margin-inline-start: auto;
  color: var(--clock-muted);
  font-size: 12px;
  white-space: nowrap;
}
.canvas-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend-wire {
  width: 15px;
  border-block-start: 2px dashed var(--clock-wire);
}
.legend-wire.active {
  border-block-start: 2px solid var(--clock-active-wire);
}
@container clock-canvas (max-width: 535px) {
  .canvas-legend {
    display: none;
  }
  .canvas-actions {
    margin-inline-start: auto;
  }
}
@container clock-canvas (max-width: 360px) {
  .canvas-tools {
    gap: 4px;
    padding-inline: 5px;
  }
  .zb-btn {
    width: 26px;
  }
  .zb-percent {
    min-width: 32px;
  }
}
</style>
