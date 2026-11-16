<script setup lang="ts">
// 时钟树画布：原生 SVG 绘制 + 缩放工具条 + 节点内嵌控件弹层。
// 越界按级别着色（error 红 / warning 橙）、连接点实心蓝/空心灰、点节点向父级抛 focus。
// 节点 / 连线 / 控件弹层拆分到 components/clock/ 子组件；本组件保留画布、缩放与交互状态。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ZoomIn, ZoomOut, FullScreen } from '@element-plus/icons-vue'
import type { ClockNodeControl, ClockTreeNode, ClockTreeLayout } from '@/model/clock/tree'
import ClockNode from '@/components/clock/ClockNode.vue'
import ClockWire from '@/components/clock/ClockWire.vue'
import ClockPopup from '@/components/clock/ClockPopup.vue'

const props = defineProps<{
  layout: ClockTreeLayout
  selectedId: string | null
  search?: string
}>()

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'control-change', control: ClockNodeControl, value: string | number): void
  (e: 'toggle-lock', nodeId: string): void
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
// seq 递增作为弹层 key：即使连续点击同一数字控件，也按最新值重建数字草稿
const open = reactive<{
  nodeId: string | null
  control: ClockNodeControl | null
  x: number
  y: number
  seq: number
}>({ nodeId: null, control: null, x: 0, y: 0, seq: 0 })

/** 弹层预计高度：select 每项约 30px + 上下内边距 8px；number 控件约 44px */
function popHeight(c: ClockNodeControl): number {
  if (c.kind === 'number') return 44
  return (c.options?.length ?? 0) * 30 + 8
}

/** 节点控件行被点击：用控件元素的视口矩形定位 fixed 弹层 */
function openControl(n: ClockTreeNode, rect: DOMRect) {
  if (!n.control || n.control.fixed) return
  const h = popHeight(n.control)
  const below = rect.bottom + 4
  // 下方空间不足时翻转到控件上方，保证弹层完整可见
  const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 4) : below
  open.nodeId = n.id
  open.control = n.control
  open.x = rect.left
  open.y = top
  open.seq += 1
}

function closeControl() {
  open.nodeId = null
  open.control = null
}

function onPopupChange(control: ClockNodeControl, value: string | number) {
  emit('control-change', control, value)
}

function onNodeClick(nodeId: string) {
  emit('focus', nodeId)
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
          <ClockWire v-for="e in layout.edges" :key="e.id" :edge="e" />

          <!-- 节点 -->
          <ClockNode
            v-for="n in layout.nodes"
            :key="n.id"
            :node="n"
            :selected="n.id === selectedId"
            :dimmed="searchMatch !== null && !searchMatch.has(n.id)"
            :pulse="pulseIds.has(n.id)"
            @focus="onNodeClick"
            @control-open="openControl"
            @toggle-lock="(id: string) => emit('toggle-lock', id)"
          />
        </svg>
      </div>
    </div>

    <!-- 控件弹层：Teleport 到 body + fixed 定位，避免被画布裁剪（点击外部/滚动关闭） -->
    <ClockPopup
      v-if="open.control"
      :key="open.seq"
      :control="open.control"
      :x="open.x"
      :y="open.y"
      @change="onPopupChange"
      @close="closeControl"
    />

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