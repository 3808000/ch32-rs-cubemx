<script setup lang="ts">
// 时钟树画布：原生 SVG 绘制 + 缩放工具条 + 节点内嵌控件内联编辑。
// 越界按级别着色（error 红 / warning 橙）、连接点实心蓝/空心灰、点节点向父级抛 focus。
// M15：点状背景、抓手模式（按钮 + 按住 Space 临时启用）、方向键滚动、路径高亮 dim。
// 节点 / 连线拆分到 components/clock/ 子组件；本组件保留画布、缩放与交互状态，
// 并协调 editingNodeId：同一时刻画布内只允许一个节点处于编辑态（开新关旧）。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ZoomIn, ZoomOut, FullScreen, Pointer } from '@element-plus/icons-vue'
import type { ClockNodeControl, ClockTreeGroup, ClockTreeNode, ClockTreeLayout } from '@/model/clock/tree'
import ClockNode from '@/components/clock/ClockNode.vue'
import ClockWire from '@/components/clock/ClockWire.vue'
import { arrowScrollDelta, anchorZoomScroll, clampZoom, shouldIgnoreSceneKeys } from '@/components/common/canvasNav'
import { edgeInHighlight } from '@/components/clock/graph'

const props = defineProps<{
  layout: ClockTreeLayout
  selectedId: string | null
  search?: string
  /** 路径高亮节点集合（空=不高亮；非空时其余节点/边 dim） */
  highlightIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'control-change', control: ClockNodeControl, value: string | number): void
  (e: 'toggle-lock', nodeId: string): void
  (e: 'contextmenu', nodeId: string, x: number, y: number): void
}>()

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
  return truncateGroupLabel(g.label, Math.max(20, g.w - 20))
}

// ---------- 缩放（用户缩放 × 容器自适应比例） ----------
const zoom = ref(1)
const wrap = ref<HTMLElement | null>(null)
const box = reactive({ w: 1200, h: 700 })
const zoomAnimating = ref(false)
let zoomTimer: number | null = null
let ro: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('keydown', onSceneKeyDown)
  window.addEventListener('keyup', onSceneKeyUp)
  window.addEventListener('blur', onWindowBlur)
  if (!wrap.value) return
  ro = new ResizeObserver((entries) => {
    const e = entries[0]
    if (e) {
      box.w = e.contentRect.width
      box.h = e.contentRect.height
    }
  })
  ro.observe(wrap.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSceneKeyDown)
  window.removeEventListener('keyup', onSceneKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  ro?.disconnect()
  if (zoomTimer !== null) window.clearTimeout(zoomTimer)
})

/** 容器自适应比例：布局比可视区大时自动缩小，避免右侧列被裁切 */
const baseScale = computed(() => {
  const availW = Math.max(200, box.w - 48)
  const availH = Math.max(150, box.h - 72)
  return Math.min(1, availW / props.layout.width, availH / props.layout.height)
})
const effScale = computed(() => baseScale.value * zoom.value)

/** 缩放上限 3（与 Pinout 画布 30%~300% 一致） */
const ZOOM_MAX = 3
/**
 * 滚动容器内边距（与 .canvas-scroll padding 一致，锚定缩放数学需要）。
 * safe center 下未溢出轴的 SVG 原点还包含居中空白；溢出轴回退 start、原点即 padding。
 * 缩放前的实际原点由 contentOrigin() 量取并传入 anchorZoomScroll。
 */
const SCROLL_PAD = 20
const scrollEl = ref<HTMLElement | null>(null)
const innerEl = ref<HTMLElement | null>(null)

/**
 * 缩放前 SVG 原点在滚动内容坐标系中的偏移（相对 scrollLeft/Top=0 的视口边缘）。
 * 左对齐时恒为 padding；safe center 下未溢出轴还包含两侧居中空白的一半，
 * 跨「未溢出 → 溢出」切换时把它传给 anchorZoomScroll 可抵消对齐回退造成的一次性跳变。
 */
function contentOrigin(el: HTMLElement, axis: 'x' | 'y'): number {
  const inner = innerEl.value
  if (!inner) return SCROLL_PAD
  const ir = inner.getBoundingClientRect()
  const sr = el.getBoundingClientRect()
  return axis === 'x' ? ir.left - sr.left + el.scrollLeft : ir.top - sr.top + el.scrollTop
}

/**
 * 光标锚定缩放（M12-hotfix）：缩放后调整 scrollLeft/Top，使光标下的时钟节点保持不动，
 * 用户可独立放大任意局部再配置。数学见 canvasNav.anchorZoomScroll。
 * 尺寸随 zoom 计算属性变化，scroll 校正须在 nextTick（DOM 更新）后执行。
 */
async function zoomAt(f: number, cursorOffset?: { x: number; y: number }) {
  const nz = clampZoom(zoom.value, f, 0.3, ZOOM_MAX)
  const r = nz / zoom.value
  if (r === 1) return
  const el = scrollEl.value
  const u = cursorOffset ?? (el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 0, y: 0 })
  const ox = el ? contentOrigin(el, 'x') : SCROLL_PAD
  const oy = el ? contentOrigin(el, 'y') : SCROLL_PAD
  const sx = el ? anchorZoomScroll(el.scrollLeft, u.x, SCROLL_PAD, r, ox) : 0
  const sy = el ? anchorZoomScroll(el.scrollTop, u.y, SCROLL_PAD, r, oy) : 0
  zoom.value = nz
  await nextTick()
  if (el) {
    el.scrollLeft = sx
    el.scrollTop = sy
  }
}
/** 按钮缩放：以视口中心为锚，画布尺寸变化走 160ms CSS 过渡 */
function zoomBy(f: number) {
  zoomAnimating.value = true
  if (zoomTimer !== null) window.clearTimeout(zoomTimer)
  zoomTimer = window.setTimeout(() => {
    zoomAnimating.value = false
    zoomTimer = null
  }, 200)
  void zoomAt(f)
}
function fit() {
  zoomBy(1 / zoom.value)
  void nextTick().then(() => {
    if (scrollEl.value) {
      scrollEl.value.scrollLeft = 0
      scrollEl.value.scrollTop = 0
    }
  })
}
function onWheel(e: WheelEvent) {
  // 与 GLSP/MX2 一致：Ctrl/⌘ + 滚轮缩放（光标锚定），普通滚轮用于滚动画布（触控板双指滚动不误缩放）
  if (!e.ctrlKey && !e.metaKey) {
    // Shift + 滚轮：水平滚动画布（部分浏览器不自动映射）
    if (e.shiftKey && scrollEl.value) {
      e.preventDefault()
      scrollEl.value.scrollLeft += e.deltaY
    }
    return
  }
  e.preventDefault()
  const rect = wrap.value?.getBoundingClientRect()
  const cursor = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined
  void zoomAt(e.deltaY < 0 ? 1.1 : 0.9, cursor)
}
const zoomPercent = computed(() => `${Math.round(effScale.value * 100)}%`)

// ---------- 背景拖动平移（M12-hotfix）：空白处按住左键/中键拖动 = 滚动画布 ----------
// M15：抓手模式（工具条按钮或按住 Space）下任意画布区域（含节点）拖动平移。
const panning = ref(false)
const handMode = ref(false)
const spaceHeld = ref(false)
const effectiveHand = computed(() => handMode.value || spaceHeld.value)
const panStart = reactive({ x: 0, y: 0, sl: 0, st: 0 })
function onPanMouseDown(e: MouseEvent) {
  const t = e.target as Element | null
  // 控件/工具条上不平移（保留按钮/内联编辑语义）
  // M16：mux radio 行 / stepper 按钮为 SVG 图元（非 <button>），位于 .node 内；
  // 指针模式下 `.node` 分支直接返回，故其 click handler 不会被 pan 吞掉。
  if (t?.closest('button, input, select, textarea, foreignObject, .zoom-bar')) return
  // 指针模式：节点上保留点选聚焦与内联编辑；抓手模式：节点上也平移
  if (!effectiveHand.value && t?.closest('.node')) return
  if (e.button !== 0 && e.button !== 1) return
  if (e.button === 1) e.preventDefault()
  const el = scrollEl.value
  if (!el) return
  panning.value = true
  panStart.x = e.clientX
  panStart.y = e.clientY
  panStart.sl = el.scrollLeft
  panStart.st = el.scrollTop
}
function onPanMouseMove(e: MouseEvent) {
  if (!panning.value || !scrollEl.value) return
  scrollEl.value.scrollLeft = panStart.sl - (e.clientX - panStart.x)
  scrollEl.value.scrollTop = panStart.st - (e.clientY - panStart.y)
}
function onPanMouseUp() {
  panning.value = false
}

// ---------- M15 键盘导航：Space 临时抓手 / 方向键滚动画布（编辑态不劫持） ----------
function sceneKeyBlocked(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return shouldIgnoreSceneKeys(t?.tagName, !!t?.isContentEditable, editingNodeId.value !== null)
}

function onSceneKeyDown(e: KeyboardEvent) {
  if (sceneKeyBlocked(e)) return
  if (e.key === ' ') {
    e.preventDefault()
    spaceHeld.value = true
    return
  }
  const d = arrowScrollDelta(e.key)
  if (d.x === 0 && d.y === 0) return
  const el = scrollEl.value
  if (!el) return
  e.preventDefault()
  el.scrollBy({ left: d.x, top: d.y })
}

function onSceneKeyUp(e: KeyboardEvent) {
  if (e.key === ' ') spaceHeld.value = false
}

function onWindowBlur() {
  spaceHeld.value = false
  panning.value = false
}

function toggleHand() {
  handMode.value = !handMode.value
}

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

// ---------- 搜索高亮 ----------
const searchMatch = computed(() => {
  const q = (props.search ?? '').trim().toLowerCase()
  if (!q) return null
  return new Set(
    props.layout.nodes
      .filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .map((n) => n.id),
  )
})

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
function nodeDimmed(id: string): boolean {
  const searchDim = searchMatch.value !== null && !searchMatch.value.has(id)
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
  return highlight.value !== null && !edgeInHighlight(edge, highlight.value)
}

const svgW = computed(() => props.layout.width * effScale.value)
const svgH = computed(() => props.layout.height * effScale.value)

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
  <div
    ref="wrap"
    class="canvas-wrap"
    :class="{ hand: effectiveHand, panning }"
    @wheel="onWheel"
    @click="closeEdit"
    @mousedown="onPanMouseDown"
    @mousemove="onPanMouseMove"
    @mouseup="onPanMouseUp"
    @mouseleave="onPanMouseUp"
  >
    <!-- 内联编辑器随 SVG 内容一起滚动，无需在滚动时关闭 -->
    <div ref="scrollEl" class="canvas-scroll" :class="{ dragging: panning }">
      <div ref="innerEl" class="canvas-inner" :class="{ 'zoom-anim': zoomAnimating }" :style="{ width: svgW + 'px', height: svgH + 'px' }">
        <svg :width="svgW" :height="svgH" :viewBox="`0 0 ${layout.width} ${layout.height}`" class="clock-svg">
          <!-- 分组容器 -->
          <g v-for="g in layout.groups" :key="g.id">
            <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="8" class="group-box" />
            <!-- M16：上移到 +12 给组内首节点的簇外标题（node.y-6）让位，避免两行 10/11px 字形相叠 -->
            <text :x="g.x + 10" :y="g.y + 12" class="group-label">
              {{ groupLabelText(g) }}<title>{{ g.label }}</title>
            </text>
          </g>

          <!-- 连线（正交折线）：按目标节点问题级别着色 + 高亮 dim -->
          <ClockWire
            v-for="e in layout.edges"
            :key="e.id"
            :edge="e"
            :target-level="edgeLevel(e.to)"
            :dimmed="edgeDimmed(e)"
          />

          <!-- 节点 -->
          <ClockNode
            v-for="n in layout.nodes"
            :key="n.id"
            :node="n"
            :selected="n.id === selectedId"
            :dimmed="nodeDimmed(n.id)"
            :pulse="pulseIds.has(n.id)"
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

    <!-- 底部浮动缩放条 -->
    <div class="zoom-bar" title="空白处拖动平移；Ctrl/⌘ + 滚轮以光标为锚点缩放；也可使用按钮缩放">
      <button
        class="zb-btn"
        :class="{ active: handMode }"
        title="抓手模式：拖动任意位置平移画布（也可按住 Space 临时启用）"
        @click="toggleHand"
      >
        <el-icon :size="15"><Pointer /></el-icon>
      </button>
      <span class="zb-sep"></span>
      <button class="zb-btn" title="缩小" @click="zoomBy(0.85)"><el-icon :size="15"><ZoomOut /></el-icon></button>
      <span class="zb-percent" title="当前有效缩放比例（随容器自适应）">{{ zoomPercent }}</span>
      <button class="zb-btn" title="放大" @click="zoomBy(1.18)"><el-icon :size="15"><ZoomIn /></el-icon></button>
      <span class="zb-sep"></span>
      <button class="zb-btn" title="适合窗口" @click="fit"><el-icon :size="15"><FullScreen /></el-icon></button>
      <span class="zb-hint">方向键滚动 · 抓手/Space 拖动 · Ctrl/⌘+滚轮缩放</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--mx-bg);
  overflow: hidden;
}
/* 抓手模式（按钮或 Space）：整张画布可拖动平移 */
.canvas-wrap.hand {
  cursor: grab;
}
.canvas-wrap.hand.panning {
  cursor: grabbing;
  user-select: none;
}
/*
 * 内容小于视口时居中（M12-hotfix）：布局是窄高树，fit 比例由高度约束主导，
 * 左对齐会在右侧留下大片死区。flex + safe center 让卡片在未溢出轴上居中；
 * 溢出轴安全回退到 start，保证滚动可达（普通 center 会把起始侧裁到负偏移，滚不回去）。
 *
 * 锚定缩放数学（anchorZoomScroll）不受影响：
 * - 溢出轴：safe center 回退为 start，内容原点仍在 padding 边缘，公式成立；
 * - 未溢出轴：scroll 恒为 0（无滚动区间），锚定本就不可行，与改动前左对齐时一致。
 * 缩放跨越「未溢出 → 溢出」时，对齐方式从居中切到 start；contentOrigin() 把切换前
 * 的居中偏移传入锚定公式，消除跳变（补偿量超出滚动起点时由浏览器钳为 0，残余不可达）。
 */
.canvas-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 20px;
  display: flex;
  justify-content: safe center;
  align-items: safe center;
}
/* 背景拖动平移中：抓取光标 + 禁选文本 */
.canvas-scroll.dragging {
  cursor: grabbing;
  user-select: none;
}
.canvas-inner {
  position: relative;
  flex-shrink: 0;
  /* M16 白纸面板（MX2 实机）：纯白底 + 细边框，去点阵背景 */
  background: var(--mx-surface);
  border-radius: var(--mx-radius-card);
  border: 1px solid var(--mx-border);
  box-shadow: var(--mx-shadow-card);
}
/* 仅按钮缩放触发尺寸过渡；Ctrl/⌘+滚轮缩放不加此类，保持即时 */
.canvas-inner.zoom-anim {
  transition:
    width var(--mx-dur-zoom) var(--mx-ease-out),
    height var(--mx-dur-zoom) var(--mx-ease-out);
}
.clock-svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* 分组容器：MX2 淡描边矩形 + 11px 左上标题 */
.group-box {
  fill: none;
  stroke: #d5dbe5;
  stroke-width: 1;
}
.group-label {
  font-size: 11px;
  fill: var(--mx-text-muted);
}

/* 底部浮动缩放条 */
.zoom-bar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  border: 1px solid var(--mx-border);
  border-radius: 12px;
  box-shadow: var(--mx-shadow-popover);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
}
.zb-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  border-radius: 7px;
  color: var(--mx-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.zb-btn:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.zb-btn.active {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.zb-percent {
  font-size: 12px;
  color: var(--mx-text-secondary);
  min-width: 42px;
  text-align: center;
}
.zb-sep {
  width: 1px;
  height: 18px;
  background: var(--mx-border);
  margin: 0 4px;
}
.zb-hint {
  font-size: 11px;
  color: var(--mx-text-muted);
  padding: 0 4px 0 6px;
  white-space: nowrap;
}
</style>