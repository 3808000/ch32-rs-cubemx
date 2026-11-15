<script setup lang="ts">
// 时钟树画布：原生 SVG 绘制 + 缩放工具条 + 节点内嵌控件弹层。
// 越界按级别着色（error 红 / warning 橙）、连接点实心蓝/空心灰、点节点向父级抛 focus。
// 控件弹层 Teleport 到 body（fixed 定位），避免被画布 overflow:hidden 裁剪。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ZoomIn, ZoomOut, FullScreen } from '@element-plus/icons-vue'
import type { ClockNodeControl, ClockTreeNode, ClockTreeLayout } from '../lib/clock/tree'
import { formatMhz } from '../lib/clock/tree'

const props = defineProps<{
  layout: ClockTreeLayout
  selectedId: string | null
  search?: string
}>()

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'control-change', control: ClockNodeControl, value: string | number): void
}>()

// ---------- 缩放（用户缩放 × 容器自适应比例） ----------
const zoom = ref(1)
const wrap = ref<HTMLElement | null>(null)
const box = reactive({ w: 1200, h: 700 })
const zoomAnimating = ref(false)
let zoomTimer: number | null = null
let ro: ResizeObserver | null = null
onMounted(() => {
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
  ro?.disconnect()
  if (zoomTimer !== null) window.clearTimeout(zoomTimer)
  document.removeEventListener('mousedown', onWindowMouseDown, true)
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
function applyZoom(f: number) {
  zoom.value = Math.min(ZOOM_MAX, Math.max(0.3, zoom.value * f))
}
/** 按钮缩放：画布尺寸变化走 160ms CSS 过渡（滚轮走 applyZoom，保持即时） */
function zoomBy(f: number) {
  zoomAnimating.value = true
  if (zoomTimer !== null) window.clearTimeout(zoomTimer)
  zoomTimer = window.setTimeout(() => {
    zoomAnimating.value = false
    zoomTimer = null
  }, 200)
  applyZoom(f)
}
function fit() {
  zoomBy(1 / zoom.value)
}
function onWheel(e: WheelEvent) {
  // 与 GLSP/MX2 一致：Ctrl/⌘ + 滚轮缩放，普通滚轮用于滚动画布（触控板双指滚动不误缩放）
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  applyZoom(e.deltaY < 0 ? 1.1 : 0.9)
}
const zoomPercent = computed(() => `${Math.round(effScale.value * 100)}%`)

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

const svgW = computed(() => props.layout.width * effScale.value)
const svgH = computed(() => props.layout.height * effScale.value)

// ---------- 节点内嵌控件弹层（Teleport 到 body，fixed 定位） ----------
const open = reactive<{
  nodeId: string | null
  control: ClockNodeControl | null
  x: number
  y: number
}>({ nodeId: null, control: null, x: 0, y: 0 })
const pop = ref<HTMLElement | null>(null)
const numberDraft = ref(0)

/** 控件行在节点内的矩形（SVG 坐标）：节点底部留 10px 内边距，高 28px */
function ctrlRect(n: ClockTreeNode) {
  return { x: n.x + 10, y: n.y + n.h - 38, w: n.w - 20, h: 28 }
}

function ctrlText(n: ClockTreeNode): string {
  const c = n.control
  if (!c) return ''
  if (c.kind === 'number') return `${c.value} ${c.unit ?? ''}`.trim()
  const opt = c.options?.find((o) => String(o.value) === String(c.value))
  return opt?.label ?? String(c.value)
}

/** 弹层预计高度：select 每项约 30px + 上下内边距 8px；number 控件约 44px */
function popHeight(c: ClockNodeControl): number {
  if (c.kind === 'number') return 44
  return (c.options?.length ?? 0) * 30 + 8
}

/** document 级监听：Teleport 内容不在 canvas-wrap 内，点击弹层之外即关闭 */
function onWindowMouseDown(e: MouseEvent) {
  const t = e.target
  if (!(t instanceof Node)) return
  if (pop.value?.contains(t)) return
  // 点在控件本身时不关闭，交给 click 处理（打开/切换弹层）
  if (t instanceof Element && t.closest('.ctrl')) return
  closeControl()
}

function openControl(n: ClockTreeNode, e: MouseEvent) {
  e.stopPropagation()
  if (!n.control || n.control.fixed) return
  // 用被点击控件元素的视口矩形定位 fixed 弹层（不受画布滚动/裁剪影响）
  const el = e.currentTarget instanceof Element ? e.currentTarget : null
  const rect = el?.getBoundingClientRect()
  if (!rect) return
  const h = popHeight(n.control)
  const below = rect.bottom + 4
  // 下方空间不足时翻转到控件上方，保证弹层完整可见
  const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 4) : below
  open.nodeId = n.id
  open.control = n.control
  open.x = rect.left
  open.y = top
  if (n.control.kind === 'number') numberDraft.value = Number(n.control.value)
  document.addEventListener('mousedown', onWindowMouseDown, true)
}

function closeControl() {
  open.nodeId = null
  open.control = null
  document.removeEventListener('mousedown', onWindowMouseDown, true)
}

function pickOption(v: string | number) {
  if (open.control) emit('control-change', open.control, v)
  closeControl()
}

function commitNumber() {
  if (open.control && Number.isFinite(numberDraft.value)) {
    emit('control-change', open.control, numberDraft.value)
  }
  closeControl()
}

function onNodeClick(n: ClockTreeNode) {
  emit('focus', n.id)
}
</script>

<template>
  <div ref="wrap" class="canvas-wrap" @wheel="onWheel" @click="closeControl">
    <div class="canvas-scroll" @scroll="closeControl">
      <div class="canvas-inner" :class="{ 'zoom-anim': zoomAnimating }" :style="{ width: svgW + 'px', height: svgH + 'px' }">
        <svg :width="svgW" :height="svgH" :viewBox="`0 0 ${layout.width} ${layout.height}`" class="clock-svg">
          <!-- 分组容器 -->
          <g v-for="g in layout.groups" :key="g.id">
            <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="10" class="group-box" />
            <text :x="g.x + 10" :y="g.y + 19" class="group-label">{{ g.label }}</text>
          </g>

          <!-- 连线（正交折线） -->
          <g v-for="e in layout.edges" :key="e.id" :class="{ 'edge-off': !e.active }">
            <polyline :points="e.points.map((p) => `${p.x},${p.y}`).join(' ')" class="edge" />
            <!-- 连接点：连通实心蓝 / 未连通空心灰 -->
            <circle :cx="e.points[0].x" :cy="e.points[0].y" r="4" :class="e.active ? 'dot-on' : 'dot-off'" />
            <circle
              :cx="e.points[e.points.length - 1].x"
              :cy="e.points[e.points.length - 1].y"
              r="4"
              :class="e.active ? 'dot-on' : 'dot-off'"
            />
            <text v-if="e.label" :x="e.labelAt.x" :y="e.labelAt.y" class="edge-label">{{ e.label }}</text>
          </g>

          <!-- 节点 -->
          <g
            v-for="n in layout.nodes"
            :key="n.id"
            class="node"
            :class="{
              selected: n.id === selectedId,
              dimmed: searchMatch !== null && !searchMatch.has(n.id),
              inactive: !n.active,
              pulse: pulseIds.has(n.id),
            }"
            @click="onNodeClick(n)"
          >
            <rect
              :x="n.x"
              :y="n.y"
              :width="n.w"
              :height="n.h"
              rx="8"
              class="node-box"
              :class="{ error: n.issueLevel === 'error', warning: n.issueLevel === 'warning' }"
            />
            <!-- 顶部上限小标签 -->
            <text v-if="n.maxMhz !== null" :x="n.x + 8" :y="n.y + 15" class="node-max">
              上限 {{ formatMhz(n.maxMhz) }}
            </text>
            <!-- 主体两栏：输入 | 输出 -->
            <template v-if="n.inMhz !== null">
              <text
                :x="n.x + n.w * 0.25"
                :y="n.y + 38"
                text-anchor="middle"
                class="freq"
                :class="{ error: n.issueLevel === 'error', warning: n.issueLevel === 'warning' }"
              >
                {{ formatMhz(n.inMhz) }}
              </text>
              <line :x1="n.x + n.w / 2" :y1="n.y + 26" :x2="n.x + n.w / 2" :y2="n.y + 48" class="freq-divider" />
              <text
                :x="n.x + n.w * 0.75"
                :y="n.y + 38"
                text-anchor="middle"
                class="freq"
                :class="{ error: n.issueLevel === 'error', warning: n.issueLevel === 'warning' }"
              >
                {{ formatMhz(n.outMhz) }}
              </text>
            </template>
            <text
              v-else
              :x="n.x + n.w / 2"
              :y="n.y + 38"
              text-anchor="middle"
              class="freq"
              :class="{ error: n.issueLevel === 'error', warning: n.issueLevel === 'warning' }"
            >
              {{ formatMhz(n.outMhz) }}
            </text>
            <!-- 节点标题 -->
            <text :x="n.x + 8" :y="n.y + 64" class="node-title">{{ n.label }}</text>
            <!-- 内嵌控件行 -->
            <g v-if="n.control" class="ctrl" :class="{ fixed: n.control.fixed }" @click="openControl(n, $event)">
              <rect :x="ctrlRect(n).x" :y="ctrlRect(n).y" :width="ctrlRect(n).w" :height="ctrlRect(n).h" rx="4" class="ctrl-box" />
              <text :x="ctrlRect(n).x + 8" :y="ctrlRect(n).y + 19" class="ctrl-text">{{ ctrlText(n) }}</text>
              <path
                v-if="n.control.kind === 'select'"
                :d="`M ${ctrlRect(n).x + ctrlRect(n).w - 16} ${ctrlRect(n).y + 11} l 5 6 l 5 -6 z`"
                class="ctrl-caret"
              />
            </g>
            <text v-else-if="n.hint" :x="n.x + 10" :y="ctrlRect(n).y + 19" class="node-hint">{{ n.hint }}</text>
          </g>
        </svg>
      </div>
    </div>

    <!-- 控件弹层：Teleport 到 body + fixed 定位，避免被画布裁剪（点击外部/滚动关闭） -->
    <Teleport to="body">
      <div
        v-if="open.control"
        ref="pop"
        class="ctrl-pop"
        :style="{ left: open.x + 'px', top: open.y + 'px' }"
        @click.stop
        @mousedown.stop
      >
        <template v-if="open.control.kind === 'select'">
          <div
            v-for="opt in open.control.options"
            :key="String(opt.value)"
            class="ctrl-opt"
            :class="{ current: String(opt.value) === String(open.control?.value) }"
            @click="pickOption(opt.value)"
          >
            {{ opt.label }}
          </div>
        </template>
        <div v-else class="ctrl-num">
          <el-input-number v-model="numberDraft" :min="open.control.min" :max="open.control.max" size="small" :step="1" />
          <el-button size="small" type="primary" @click="commitNumber">确定</el-button>
        </div>
      </div>
    </Teleport>

    <!-- 底部浮动缩放条 -->
    <div class="zoom-bar" title="Ctrl/⌘ + 滚轮缩放；也可使用按钮缩放">
      <button class="zb-btn" title="缩小" @click="zoomBy(0.85)"><el-icon :size="15"><ZoomOut /></el-icon></button>
      <span class="zb-percent" title="当前有效缩放比例（随容器自适应）">{{ zoomPercent }}</span>
      <button class="zb-btn" title="放大" @click="zoomBy(1.18)"><el-icon :size="15"><ZoomIn /></el-icon></button>
      <span class="zb-sep"></span>
      <button class="zb-btn" title="适合窗口" @click="fit"><el-icon :size="15"><FullScreen /></el-icon></button>
      <span class="zb-hint">Ctrl/⌘+滚轮缩放</span>
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
.canvas-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 20px;
}
.canvas-inner {
  position: relative;
  flex-shrink: 0;
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

/* 分组容器 */
.group-box {
  fill: rgba(255, 255, 255, 0.45);
  stroke: #c9d2e0;
  stroke-width: 1;
  stroke-dasharray: 5 4;
}
.group-label {
  font-size: 12px;
  fill: var(--mx-text-secondary);
}

/* 连线 */
.edge {
  fill: none;
  stroke: #98a2b3;
  stroke-width: 1.5;
  transition: stroke var(--mx-dur-node) linear;
}
.edge-off .edge {
  stroke: #d5dbe5;
}
.edge-label {
  font-size: 11px;
  fill: var(--mx-text-secondary);
  text-anchor: middle;
}
.dot-on {
  fill: var(--mx-accent);
  stroke: none;
  transition: fill var(--mx-dur-node) linear;
}
.dot-off {
  fill: var(--mx-surface);
  stroke: #98a2b3;
  stroke-width: 1.5;
  transition:
    fill var(--mx-dur-node) linear,
    stroke var(--mx-dur-node) linear;
}

/* 节点 */
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
.node.inactive .node-title {
  fill: var(--mx-text-muted);
}
.node-max {
  font-size: 10px;
  fill: var(--mx-text-muted);
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

/* 控件弹层（Teleport 到 body，fixed 定位避免被画布 overflow 裁剪） */
.ctrl-pop {
  position: fixed;
  z-index: 3000;
  min-width: 120px;
  background: #fff;
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  padding: 4px;
}
.ctrl-opt {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--mx-text);
  white-space: nowrap;
}
.ctrl-opt:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.ctrl-opt.current {
  color: var(--mx-accent);
  font-weight: 600;
}
.ctrl-num {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
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
