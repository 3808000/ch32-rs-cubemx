<script lang="ts">
// 倾斜角度 / 画布尺寸 / 引脚文本的纯函数：随组件导出，供单元测试直接验证。
// 组件渲染始终以 rotation=0 的基础布局为准，旋转交给 CSS transform（整体刚体旋转，文字随转）。
import type { ChipPin } from '@/model/types'

export const TILT_STEP = 45

/** 角度归一化到 [0, 360)。 */
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

/** 下一次倾斜的原始角度：每次 −45°（对齐原版：首次点击读数 315°）。
 *  原始值持续累减不回卷，避免 315°→0° 时 CSS 过渡沿反方向转一整圈。 */
export function nextTiltAngle(raw: number): number {
  return raw - TILT_STEP
}

/** Top 复位目标：最近的 360° 整倍数，保证过渡沿最短方向回正（归一化 -0 → 0）。 */
export function topAngle(raw: number): number {
  const target = Math.round(raw / 360) * 360
  return target === 0 ? 0 : target
}

/** 正方形画布边长：≥ 布局对角线，任意 45° 步进角度下都完整可见。 */
export function packageCanvasSide(width: number, height: number, padding = 24): number {
  return Math.ceil(Math.hypot(width, height)) + padding
}

/** 基础布局在正方形画布内的居中偏移。 */
export function packageCanvasOffset(width: number, height: number, side: number): { dx: number; dy: number } {
  return { dx: (side - width) / 2, dy: (side - height) / 2 }
}

/** 归一化到 (-180, 180]，用于判断文字朝向是否已倒置。 */
export function normalizeSigned(angle: number): number {
  const a = normalizeAngle(angle)
  return a > 180 ? a - 360 : a
}

/** 可读方向：文字总旋转保持在 (-90°, 90°]，超出则翻转 180°（45° 斜排仍保留，只避免倒置）。 */
export function readableAngle(total: number): number {
  const a = normalizeSigned(total)
  if (a > 90) return a - 180
  if (a < -90) return a + 180
  return a
}

/** 文字自转补偿：父级旋转 R + 文字基准朝向后仍保持可读所需的额外旋转（0 / ±180 / ±360…）。
 *  基准朝向由外层 <g> 的 transform 承担，因此这里只返回“翻转量”，
 *  数值随倾角连续累加，CSS 过渡不会出现反向绕一整圈的跳变。 */
export function readabilityFlip(packageRotation: number, baseRotation = 0): number {
  const total = packageRotation + baseRotation
  return readableAngle(total) - total
}

/** 胶囊内引脚名字号：按名称长度自适应（≤3 字 12px、4 字 11px、≥5 字 10px）。 */
export function pinNameFontSize(name: string): number {
  if (name.length >= 5) return 10
  if (name.length === 4) return 11
  return 12
}

/** 外部标签文本（对齐原版）：用户标签 || 功能名 || 引脚名；
 *  电源/特殊脚无标签时显示 名称_序号（如 VSS_7、VDD_MCU_19），
 *  名称本身已带数字尾缀（如 V203 的 VSS_1 / BOOT0）则原样显示避免重复。 */
export function pinOuterText(pin: ChipPin, a: { label?: string; function?: string } | undefined | null): string {
  if (a?.label) return a.label
  if (a?.function) return a.function
  if (pin.type === 'POWER' || pin.special) {
    return /\d$/.test(pin.name) ? pin.name : `${pin.name}_${pin.number}`
  }
  return pin.name
}
</script>

<script setup lang="ts">
// 封装图画布：原生 SVG，dual/quad 布局，45° 倾斜/缩放/抓手，悬停浮卡，点选引脚。
// 倾斜：基础布局整体放入 .package-rotator（CSS rotate，transform-box: view-box），
// 主体轮廓/引脚胶囊/胶囊内引脚名/外置标签全部随转（每次 −45°，首次读数 315°），
// 画布为容纳对角线的最小正方形。胶囊内显示引脚名（quad 顶/底竖排），序号只在浮卡/表格。
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { ChipData, PinAssignment } from '@/model/types'
import { computePackageGeometry } from '@/model/package'
import {
  pinMatchesFilter,
  pinStateColors,
  pinStateLabel,
  type PinFilter,
  type PinStateId,
} from '@/model/pins/pinFilter'
import { RefreshRight, ZoomIn, ZoomOut, FullScreen, Pointer, Rank, Monitor } from '@element-plus/icons-vue'
import PinContextMenu from '@/components/pinout/PinContextMenu.vue'

const props = defineProps<{
  chip: ChipData
  assignments: PinAssignment[]
  selectedPin: string | null
  /** 统一过滤条件（搜索 + Show 状态 + Type），与 PinTable 同一份数据 */
  filter: PinFilter
  /** 引脚名 → 九态（由 PinoutView 统一派生） */
  pinStates: Record<string, PinStateId>
}>()

const emit = defineEmits<{
  (e: 'select', pin: string | null): void
  (e: 'configure', pin: string): void
  /** 右键菜单 Assign / 信号分配完成后：选中引脚并打开 Detail view */
  (e: 'assign', pin: string): void
}>()

/** 倾斜角度原始值：只累加，CSS 过渡始终按 +45° 前进；显示值取模。 */
const angle = ref(0)
const displayAngle = computed(() => normalizeAngle(angle.value))
const zoom = ref(1)
const tool = ref<'pointer' | 'hand'>('pointer')
const pan = reactive({ x: 0, y: 0 })
const dragging = ref(false)
const dragStart = reactive({ x: 0, y: 0, px: 0, py: 0 })
const hovered = ref<string | null>(null)
const hoverPos = reactive({ x: 0, y: 0 })
const container = ref<HTMLElement | null>(null)
const containerSize = reactive({ w: 800, h: 600 })
const zoomAnimating = ref(false)
let zoomTimer: number | null = null
let ro: ResizeObserver | null = null

onMounted(() => {
  if (!container.value) return
  ro = new ResizeObserver((entries) => {
    const e = entries[0]
    if (e) {
      containerSize.w = e.contentRect.width
      containerSize.h = e.contentRect.height
    }
  })
  ro.observe(container.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (zoomTimer !== null) window.clearTimeout(zoomTimer)
})

// 始终使用基础布局（rotation=0）：旋转只由 .package-rotator 的 CSS transform 承担
const geo = computed(() => computePackageGeometry(props.chip, 0))
/** 正方形画布边长：覆盖任意倾斜角度下的布局对角线 */
const canvasSide = computed(() => packageCanvasSide(geo.value.width, geo.value.height))
/** 基础布局在正方形画布内的居中偏移 */
const canvasOffset = computed(() => packageCanvasOffset(geo.value.width, geo.value.height, canvasSide.value))

const assignmentMap = computed(() => new Map(props.assignments.map((a) => [a.pin, a])))

/** 某引脚的派生九态（PinoutView 统一计算，缺省按未分配兜底）。 */
function stateOf(pinName: string): PinStateId {
  return props.pinStates[pinName] ?? 'unassigned'
}

/** 状态色：图形与图例/表格/悬停共用 pinFilter 的色板；已配置再按 GPIO/AF 细分。 */
function colorsOf(pinName: string) {
  return pinStateColors(stateOf(pinName), assignmentMap.value.get(pinName)?.mode)
}

// 统一过滤：只影响渲染，不参与几何计算，保证隐藏引脚后编号位置不变
const visiblePins = computed(() =>
  geo.value.pins.filter((pl) =>
    pinMatchesFilter(pl.pin, assignmentMap.value.get(pl.pin.name), stateOf(pl.pin.name), props.filter),
  ),
)

// 1 号脚指示圆点：取 1 号脚胶囊中心，向芯片主体中心内缩 22px
const pin1Marker = computed(() => {
  const pl = geo.value.pins.find((p) => p.pin.number === 1)
  if (!pl) return null
  const px = pl.x + pl.w / 2
  const py = pl.y + pl.h / 2
  const bx = geo.value.body.x + geo.value.body.w / 2
  const by = geo.value.body.y + geo.value.body.h / 2
  const dx = bx - px
  const dy = by - py
  const len = Math.hypot(dx, dy)
  if (len < 1) return { x: px, y: py }
  return { x: px + (dx / len) * 22, y: py + (dy / len) * 22 }
})

// 画布自适应：按当前倾斜角度下的实际包围盒计算（0° 时铺满，45° 时按对角收放）
const visualAngle = computed(() => normalizeAngle(-angle.value))
const rotatedBBox = computed(() => {
  const rad = (visualAngle.value * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  return {
    w: geo.value.width * c + geo.value.height * s,
    h: geo.value.width * s + geo.value.height * c,
  }
})
const baseScale = computed(() => {
  const availW = Math.max(120, containerSize.w - 32)
  const availH = Math.max(120, containerSize.h - 72)
  // 倾斜/复位引起比例变化时，缩放层随旋转同步补间（避免尺寸跳变）
  return Math.min(1, availW / rotatedBBox.value.w, availH / rotatedBBox.value.h)
})
const effectiveScale = computed(() => baseScale.value * zoom.value)

/** 外部标签是否来自用户配置（标签/功能名 → 蓝色；默认引脚名 → 灰色） */
function isCustomLabel(pinName: string): boolean {
  const a = assignmentMap.value.get(pinName)
  return !!(a?.label || a?.function)
}

/** −45° 倾斜（0→315→270→…→45→0 循环，方向对齐原版） */
function tilt() {
  startZoomAnim()
  angle.value = nextTiltAngle(angle.value)
}
/** Top 复位：回到 0° 朝向（沿最短方向动画回正） */
function resetTop() {
  startZoomAnim()
  angle.value = topAngle(angle.value)
}

function applyZoom(f: number) {
  zoom.value = Math.min(3, Math.max(0.3, zoom.value * f))
}
/** 临时开启缩放层补间（按钮缩放 / 倾斜引起的基准比例变化） */
function startZoomAnim() {
  zoomAnimating.value = true
  if (zoomTimer !== null) window.clearTimeout(zoomTimer)
  zoomTimer = window.setTimeout(() => {
    zoomAnimating.value = false
    zoomTimer = null
  }, 260)
}
/** 按钮缩放：外层 transform 过渡 160ms（滚轮走 applyZoom，保持即时） */
function zoomBy(f: number) {
  startZoomAnim()
  applyZoom(f)
}
function fit() {
  zoomBy(1 / zoom.value)
  pan.x = 0
  pan.y = 0
}
function fullscreen() {
  container.value?.requestFullscreen?.()
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  applyZoom(e.deltaY < 0 ? 1.1 : 0.9)
}
function onMouseDown(e: MouseEvent) {
  if (tool.value !== 'hand') return
  dragging.value = true
  dragStart.x = e.clientX
  dragStart.y = e.clientY
  dragStart.px = pan.x
  dragStart.py = pan.y
}
function onMouseMove(e: MouseEvent) {
  if (dragging.value) {
    pan.x = dragStart.px + (e.clientX - dragStart.x)
    pan.y = dragStart.py + (e.clientY - dragStart.y)
  }
}
function onMouseUp() {
  dragging.value = false
}

function onPinClick(pinName: string, type: string) {
  if (tool.value === 'hand') return
  emit('select', pinName)
  if (type === 'IO') emit('configure', pinName)
}
function onPinHover(pinName: string, e: MouseEvent) {
  hovered.value = pinName
  const rect = container.value?.getBoundingClientRect()
  if (rect) {
    hoverPos.x = e.clientX - rect.left + 14
    hoverPos.y = e.clientY - rect.top + 14
  }
}

// ---- 右键菜单（M2.7） ----
const menu = reactive<{ open: boolean; x: number; y: number; pin: ChipPin | null }>({
  open: false,
  x: 0,
  y: 0,
  pin: null,
})

function onPinContextMenu(pinName: string, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (tool.value === 'hand') return
  const pin = props.chip.pins.find((p) => p.name === pinName)
  if (!pin) return
  emit('select', pinName)
  hovered.value = null
  const rect = container.value?.getBoundingClientRect()
  const rawX = rect ? e.clientX - rect.left : e.clientX
  const rawY = rect ? e.clientY - rect.top : e.clientY
  const maxX = Math.max(6, (rect?.width ?? 800) - 240)
  const maxY = Math.max(6, (rect?.height ?? 600) - 420)
  menu.open = true
  menu.pin = pin
  menu.x = Math.max(6, Math.min(rawX, maxX))
  menu.y = Math.max(6, Math.min(rawY, maxY))
}
function closeMenu() {
  menu.open = false
  menu.pin = null
}
function onMenuAssign(pinName: string) {
  emit('select', pinName)
  emit('assign', pinName)
  closeMenu()
}
const menuAssignment = computed(() => (menu.pin ? assignmentMap.value.get(menu.pin.name) : undefined))
const menuState = computed<PinStateId>(() => (menu.pin ? stateOf(menu.pin.name) : 'unassigned'))

/** 悬停浮卡/状态点的色块样式（与图例同源）。 */
function stateDotStyle(state: PinStateId, mode?: PinAssignment['mode']) {
  const c = pinStateColors(state, mode)
  return { background: c.bg, borderColor: c.border }
}

const hoveredInfo = computed(() => {
  if (!hovered.value) return null
  const pin = props.chip.pins.find((p) => p.name === hovered.value)
  if (!pin) return null
  const a = assignmentMap.value.get(pin.name)
  return { pin, a, state: stateOf(pin.name) }
})

const zoomPercent = computed(() => `${Math.round(effectiveScale.value * 100)}%`)

/** 缩放层：固定为正方形画布尺寸，transform 承担平移 + 自适应/用户缩放 */
const zoomLayerStyle = computed(() => ({
  width: `${canvasSide.value}px`,
  height: `${canvasSide.value}px`,
  transform: `translate(${pan.x}px, ${pan.y}px) scale(${effectiveScale.value})`,
}))
/** 倾斜组的 CSS transform：原版 315° 读数对应视觉 +45°（左边缘转向左上），故取反角度 */
const rotatorStyle = computed(() => ({ transform: `rotate(${-angle.value}deg)` }))
/** 倾斜组当前的原始旋转角（与 angle 反号，持续累加不回卷） */
const packageRotation = computed(() => -angle.value)
/** 左/右文字（基准水平）的自转补偿；顶/底文字（基准 −90°）的同理。
 *  补偿量为 0/±180/±360…：平时文字随封装一起转，转到倒置区间时补一个 180° 翻转动画，
 *  保证任意 45° 倍数下文字都可读（45° 时仍是方便观看的斜排）。 */
const flipLR = computed(() => readabilityFlip(packageRotation.value, 0))
const flipTB = computed(() => readabilityFlip(packageRotation.value, -90))
/** 正方形画布内的基础布局居中偏移 */
const offsetTransform = computed(() => `translate(${canvasOffset.value.dx} ${canvasOffset.value.dy})`)
</script>

<template>
  <div ref="container" class="canvas-wrap" @wheel="onWheel" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp">
    <div class="canvas-scroll" :class="{ hand: tool === 'hand', dragging }">
      <div class="package-zoom" :class="{ 'zoom-anim': zoomAnimating }" :style="zoomLayerStyle">
        <svg :width="canvasSide" :height="canvasSide" :viewBox="`0 0 ${canvasSide} ${canvasSide}`" class="package-svg">
          <!-- 整体倾斜组：画布中心为轴，transition 220ms ease-out；文字随整体刚体旋转 -->
          <g class="package-rotator" :style="rotatorStyle">
            <!-- 基础布局在正方形画布内居中 -->
            <g :transform="offsetTransform">
              <!-- 芯片主体 -->
              <rect :x="geo.body.x" :y="geo.body.y" :width="geo.body.w" :height="geo.body.h" rx="12" fill="#fff" stroke="#D0D5DD" stroke-width="1.5" />
              <!-- 1 号脚指示圆点（随旋转跟随 1 号脚） -->
              <circle v-if="pin1Marker" :cx="pin1Marker.x" :cy="pin1Marker.y" r="5" fill="#E4E9F2" stroke="#C7CED9" stroke-width="1" />
              <!-- 芯片名竖排（rotate -90）；倾斜后叠加可读性翻转，任意角度不倒置 -->
              <g :transform="`rotate(-90 ${geo.body.x + geo.body.w / 2 - 8} ${geo.body.y + geo.body.h / 2})`">
                <text
                  :x="geo.body.x + geo.body.w / 2 - 8"
                  :y="geo.body.y + geo.body.h / 2"
                  text-anchor="middle"
                  font-size="16"
                  font-weight="600"
                  fill="#1A1A1A"
                  class="tilt-text"
                  :style="{ transform: `rotate(${flipTB}deg)` }"
                >
                  {{ chip.chip }}
                </text>
              </g>
              <g :transform="`rotate(-90 ${geo.body.x + geo.body.w / 2 + 12} ${geo.body.y + geo.body.h / 2})`">
                <text
                  :x="geo.body.x + geo.body.w / 2 + 12"
                  :y="geo.body.y + geo.body.h / 2"
                  text-anchor="middle"
                  font-size="11"
                  fill="#8A8F98"
                  class="tilt-text"
                  :style="{ transform: `rotate(${flipTB}deg)` }"
                >
                  {{ chip.package }}
                </text>
              </g>

              <!-- 引脚 -->
              <g v-for="pl in visiblePins" :key="pl.pin.number" class="pin-group" @click="onPinClick(pl.pin.name, pl.pin.type)" @contextmenu="onPinContextMenu(pl.pin.name, $event)" @mouseenter="onPinHover(pl.pin.name, $event)" @mouseleave="hovered = null">
                <rect
                  :x="pl.x"
                  :y="pl.y"
                  :width="pl.w"
                  :height="pl.h"
                  rx="6"
                  :fill="colorsOf(pl.pin.name).bg"
                  :stroke="selectedPin === pl.pin.name ? '#2A62B7' : colorsOf(pl.pin.name).border"
                  :stroke-width="selectedPin === pl.pin.name ? 2.5 : 1.2"
                  :class="{ selected: selectedPin === pl.pin.name }"
                />
                <!-- 胶囊内引脚名（居中；quad 顶/底边胶囊竖放 → 0° 时文字随长轴竖排，倾斜后随整体刚体旋转，
                     进入倒置区间时补 180° 翻转动画保证可读） -->
                <g :transform="pl.side === 'top' || pl.side === 'bottom' ? `rotate(-90 ${pl.x + pl.w / 2} ${pl.y + pl.h / 2})` : undefined">
                  <text
                    :x="pl.x + pl.w / 2"
                    :y="pl.y + pl.h / 2 + 3.5"
                    text-anchor="middle"
                    :font-size="pinNameFontSize(pl.pin.name)"
                    font-weight="600"
                    :fill="colorsOf(pl.pin.name).fg"
                    class="tilt-text"
                    :style="{ transform: `rotate(${pl.side === 'top' || pl.side === 'bottom' ? flipTB : flipLR}deg)` }"
                  >
                    {{ pl.pin.name }}
                  </text>
                </g>
                <!-- 外部标签：用户标签 || 功能名 || 引脚名（电源/特殊脚无标签时为 名称_序号）；顶/底边随胶囊轴向竖排 -->
                <g :transform="pl.side === 'top' || pl.side === 'bottom' ? `rotate(-90 ${pl.labelX} ${pl.labelY})` : undefined">
                  <text
                    :x="pl.labelX"
                    :y="pl.labelY + 4"
                    :text-anchor="pl.labelAnchor"
                    :font-size="pl.side === 'top' || pl.side === 'bottom' ? 10 : 11"
                    :fill="isCustomLabel(pl.pin.name) ? '#2A62B7' : '#8A8F98'"
                    class="tilt-text"
                    :style="{ transform: `rotate(${pl.side === 'top' || pl.side === 'bottom' ? flipTB : flipLR}deg)` }"
                  >
                    {{ pinOuterText(pl.pin, assignmentMap.get(pl.pin.name)) }}
                  </text>
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>
    </div>

    <!-- 过滤后无引脚 -->
    <div v-if="visiblePins.length === 0" class="canvas-empty">没有匹配当前过滤条件的引脚</div>

    <!-- 悬停浮卡 -->
    <div v-if="hoveredInfo && !menu.open" class="hover-card" :style="{ left: hoverPos.x + 'px', top: hoverPos.y + 'px' }">
      <div class="hover-title">{{ hoveredInfo.pin.number }} · {{ hoveredInfo.pin.name }}</div>
      <div class="hover-row hover-state">
        <span class="state-dot" :style="stateDotStyle(hoveredInfo.state, hoveredInfo.a?.mode)"></span>
        状态：{{ pinStateLabel(hoveredInfo.state) }}
      </div>
      <div class="hover-row">类型：{{ hoveredInfo.pin.type }}{{ hoveredInfo.pin.ft ? ' · 5V 容忍' : '' }}</div>
      <div v-if="hoveredInfo.pin.special" class="hover-row">特殊：{{ hoveredInfo.pin.special.toUpperCase() }}</div>
      <div v-if="hoveredInfo.a" class="hover-row">模式：{{ hoveredInfo.a.mode }}</div>
      <div v-if="hoveredInfo.a?.function" class="hover-row">信号：{{ hoveredInfo.a.function }}{{ hoveredInfo.a.remap !== undefined ? ` (remap ${hoveredInfo.a.remap})` : '' }}</div>
      <div v-if="hoveredInfo.a?.label" class="hover-row">标签：{{ hoveredInfo.a.label }}</div>
      <div v-if="(hoveredInfo.pin.adc ?? []).length" class="hover-row">ADC：{{ hoveredInfo.pin.adc!.join(', ') }}</div>
    </div>

    <!-- 右键菜单（点击空白/Esc 关闭） -->
    <div v-if="menu.open" class="menu-backdrop" @mousedown.prevent="closeMenu" @contextmenu.prevent="closeMenu"></div>
    <PinContextMenu
      v-if="menu.open && menu.pin"
      :x="menu.x"
      :y="menu.y"
      :pin="menu.pin"
      :assignment="menuAssignment"
      :state="menuState"
      @close="closeMenu"
      @assign="onMenuAssign"
    />

    <!-- 底部浮动工具条 -->
    <div class="float-toolbar">
      <el-tooltip content="指针" placement="top">
        <button class="ft-btn" aria-label="指针工具" :class="{ active: tool === 'pointer' }" @click="tool = 'pointer'"><el-icon :size="15"><Pointer /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="抓手" placement="top">
        <button class="ft-btn" aria-label="抓手工具" :class="{ active: tool === 'hand' }" @click="tool = 'hand'"><el-icon :size="15"><Rank /></el-icon></button>
      </el-tooltip>
      <span class="ft-sep"></span>
      <el-tooltip content="倾斜封装 45°" placement="top">
        <button class="ft-btn" aria-label="倾斜封装 45°" :class="{ active: displayAngle !== 0 }" @click="tilt"><el-icon :size="15"><RefreshRight /></el-icon></button>
      </el-tooltip>
      <span class="ft-angle" title="当前倾斜角度">{{ displayAngle }}°</span>
      <el-tooltip content="复位到 Top 视图（0°）" placement="top">
        <button class="ft-btn ft-top" aria-label="Top 复位" @click="resetTop">Top</button>
      </el-tooltip>
      <span class="ft-sep"></span>
      <el-tooltip content="缩小" placement="top">
        <button class="ft-btn" aria-label="缩小" @click="zoomBy(0.85)"><el-icon :size="15"><ZoomOut /></el-icon></button>
      </el-tooltip>
      <span class="ft-percent">{{ zoomPercent }}</span>
      <el-tooltip content="放大" placement="top">
        <button class="ft-btn" aria-label="放大" @click="zoomBy(1.18)"><el-icon :size="15"><ZoomIn /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="适合窗口" placement="top">
        <button class="ft-btn" aria-label="适合窗口" @click="fit"><el-icon :size="15"><FullScreen /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="全屏" placement="top">
        <button class="ft-btn" aria-label="全屏" @click="fullscreen"><el-icon :size="15"><Monitor /></el-icon></button>
      </el-tooltip>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--mx-surface);
  overflow: hidden;
}
.canvas-scroll {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.canvas-scroll.hand {
  cursor: grab;
}
.canvas-scroll.hand.dragging {
  cursor: grabbing;
}
/* 缩放层：尺寸固定为正方形画布，缩放/平移统一走 transform */
.package-zoom {
  flex-shrink: 0;
  transform-origin: center center;
}
/* 仅按钮缩放触发过渡；滚轮缩放不加此类，保持即时 */
.package-zoom.zoom-anim {
  transition: transform var(--mx-dur-zoom) var(--mx-ease-out);
}
.package-svg {
  display: block;
}
/* 整体刚体旋转：画布中心为轴，220ms ease-out，无回弹 */
.package-rotator {
  transform-box: view-box;
  transform-origin: center;
  transition: transform var(--mx-dur-tilt) var(--mx-ease-out);
}
/* 文字可读性补偿：绕自身包围盒中心翻转 180°，与封装旋转同一节奏补间 */
.tilt-text {
  transform-box: fill-box;
  transform-origin: center;
  transition: transform var(--mx-dur-tilt) var(--mx-ease-out);
}
.pin-group {
  cursor: pointer;
}
.pin-group:hover rect {
  filter: brightness(0.96);
}
.pin-group rect.selected {
  filter: drop-shadow(0 0 4px rgba(42, 98, 183, 0.5));
}
.hover-card {
  position: absolute;
  background: #fff;
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  padding: 8px 12px;
  font-size: 12px;
  pointer-events: none;
  z-index: 10;
  max-width: 260px;
}
.hover-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.hover-row {
  color: var(--mx-text-secondary);
  line-height: 1.6;
}
.hover-state {
  display: flex;
  align-items: center;
  gap: 5px;
}
.state-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid var(--mx-border);
  flex-shrink: 0;
}
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mx-text-muted);
  font-size: 13px;
  pointer-events: none;
}
.menu-backdrop {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: transparent;
}
.float-toolbar {
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
.ft-btn {
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
.ft-btn:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.ft-btn.active {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
/* 角度读数：等宽数字，避免跳动 */
.ft-angle {
  font-size: 12px;
  color: var(--mx-text-secondary);
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.ft-top {
  width: auto;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 600;
}
.ft-sep {
  width: 1px;
  height: 18px;
  background: var(--mx-border);
  margin: 0 4px;
}
.ft-percent {
  font-size: 12px;
  color: var(--mx-text-secondary);
  min-width: 42px;
  text-align: center;
}
</style>