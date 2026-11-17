<script setup lang="ts">
// 浏览器式文档标签栏（M10）：只渲染 store.openViews 中「已打开」的视图标签，
// 每个视图标签带 ×（active 常显 / inactive hover 显现），关闭即从标签栏移除；
// 外设对象页标签独立追加（可单独关闭），关闭它不影响 openViews。
// M5：按 conflicts 归属在对应标签图标右上角显示 error 红点 / warning 黄点，计数进 title。
import { computed } from 'vue'
import { HomeFilled, Cpu, Timer, Connection, Setting, Close } from '@element-plus/icons-vue'
import { useProjectStore, type ViewId } from '@/controllers/project'
import type { Conflict } from '@/model/types'

const props = withDefaults(defineProps<{ healthBadges?: boolean }>(), { healthBadges: true })

const store = useProjectStore()

/** 视图元信息（标题 / 图标）；标签栏只渲染 store.openViews 中已打开的项。 */
const VIEW_META: Record<ViewId, { label: string; icon: unknown }> = {
  home: { label: 'Home', icon: HomeFilled },
  pinout: { label: 'Pinout', icon: Cpu },
  clock: { label: 'Clock', icon: Timer },
  peripherals: { label: 'Peripherals', icon: Connection },
  'project-settings': { label: 'Project settings', icon: Setting },
}

/** 当前打开的外设对象页标签（可关闭，独立于 openViews）。 */
const peripheralTab = computed(() => {
  const id = store.activePeripheralId
  if (!id) return null
  return { id, label: id }
})

// ---------------- 每标签健康徽标（M5） ----------------
type HealthLevel = 'error' | 'warning'

interface HealthSummary {
  errors: number
  warnings: number
  /** error 优先于 warning。 */
  level: HealthLevel
}

/** 时钟树问题：即使没有 pins/peripheral 也归到 Clock 标签。 */
const CLOCK_CONFLICT_CODES = new Set<Conflict['code']>([
  'CLOCK_PRESET_UNAVAILABLE',
  'PERIPHERAL_CLOCK_INVALID',
  'SPECIAL_PIN_OSC',
])

/** NVIC / DMA 面板问题：没有具体外设实例时也归到 Peripherals 标签。 */
const PERIPHERAL_PANEL_CODES = new Set<Conflict['code']>([
  'DMA_CHANNEL_CONFLICT',
  'IRQ_UNKNOWN',
  'IRQ_PRIORITY_DUPLICATE',
  'IRQ_EMBASSY_NOT_ENABLED',
])

/** 芯片/工程级问题：归到 Project settings。 */
const DEVICE_CONFLICT_CODES = new Set<Conflict['code']>([
  'TARGET_FEATURE_UNSUPPORTED',
  'SRAM_BUDGET_EXCEEDED',
])

/**
 * 健康摘要派生：
 * - 有 pins → Pinout（引脚冲突）
 * - 有 peripheral → 对应外设对象标签 + Peripherals 概览
 * - clock/dma/irq 等面板问题 → 对应固定视图
 * 同一条冲突可能同时命中多个标签（例如 REMAP_MISMATCH 既有 pin 也有 peripheral），这是有意为之。
 */
const healthMap = computed(() => {
  const map = new Map<string, { errors: number; warnings: number }>()
  const add = (key: string, level: HealthLevel) => {
    const counts = map.get(key) ?? { errors: 0, warnings: 0 }
    if (level === 'error') counts.errors += 1
    else counts.warnings += 1
    map.set(key, counts)
  }

  for (const conflict of store.conflicts) {
    if (conflict.pins?.length) add('view:pinout', conflict.level)
    if (conflict.peripheral || PERIPHERAL_PANEL_CODES.has(conflict.code)) {
      add('view:peripherals', conflict.level)
    }
    if (conflict.peripheral) add(`peripheral:${conflict.peripheral}`, conflict.level)
    if (CLOCK_CONFLICT_CODES.has(conflict.code)) add('view:clock', conflict.level)
    if (DEVICE_CONFLICT_CODES.has(conflict.code)) add('view:project-settings', conflict.level)
  }
  return map
})

/** 取某个标签（view 或 peripheral）的健康摘要；无冲突返回 null。 */
function healthOf(key: string): HealthSummary | null {
  const counts = healthMap.value.get(key)
  if (!counts) return null
  return { ...counts, level: counts.errors > 0 ? 'error' : 'warning' }
}

/** 固定视图标签的健康摘要。 */
function healthOfView(view: ViewId): HealthSummary | null {
  return healthOf(`view:${view}`)
}

/** 外设对象页标签的健康摘要。 */
function healthOfPeripheral(id: string): HealthSummary | null {
  return healthOf(`peripheral:${id}`)
}

/**
 * 已打开的视图标签（文档模型）：顺序与 openViews 一致。
 * 空态（未打开工程）只有 Home，且 Home 不显示关闭按钮。
 */
const openTabs = computed(() =>
  store.openViews.map((id) => ({
    id,
    ...VIEW_META[id],
    health: healthOfView(id),
    closable: store.projectOpened || id !== 'home',
  })),
)

/** 当前外设对象页标签的健康摘要。 */
const peripheralHealth = computed(() =>
  peripheralTab.value ? healthOfPeripheral(peripheralTab.value.id) : null,
)

/** 圆点 tooltip：错误/警告数量。 */
function healthTitle(health: HealthSummary): string {
  const parts: string[] = []
  if (health.errors) parts.push(`${health.errors} 个错误`)
  if (health.warnings) parts.push(`${health.warnings} 个警告`)
  return parts.join('，')
}

/** 视图标签的 active：Peripherals 概览在有对象页时让位给对象标签。 */
function isActiveView(id: ViewId): boolean {
  if (store.activeView !== id) return false
  return !(id === 'peripherals' && peripheralTab.value)
}

function closePeripheralTab() {
  store.closePeripheral()
}
</script>

<template>
  <div class="tabstrip" role="tablist">
    <button
      v-for="t in openTabs"
      :key="t.id"
      class="tab"
      :class="{ active: isActiveView(t.id) }"
      role="tab"
      :aria-selected="isActiveView(t.id)"
      :title="t.label"
      @click="store.setView(t.id)"
    >
      <span class="tab-icon">
        <el-icon :size="14"><component :is="t.icon" /></el-icon>
        <span
          v-if="props.healthBadges && t.health"
          class="health-dot"
          :class="t.health.level"
          :title="healthTitle(t.health)"
        ></span>
      </span>
      <span class="tab-label">{{ t.label }}</span>
      <span v-if="store.dirty && store.activeView === t.id" class="dirty-dot" title="有未保存改动"></span>
      <span
        v-if="t.closable"
        class="tab-close"
        role="button"
        tabindex="0"
        :title="`关闭 ${t.label}`"
        :aria-label="`关闭 ${t.label}`"
        @click.stop="store.closeView(t.id)"
        @keydown.stop.enter.prevent="store.closeView(t.id)"
        @keydown.stop.space.prevent="store.closeView(t.id)"
      >
        <el-icon :size="12"><Close /></el-icon>
      </span>
    </button>

    <!-- 外设对象页标签（独立文档，可关闭） -->
    <button
      v-if="store.projectOpened && peripheralTab"
      class="tab object-tab"
      :class="{ active: store.activeView === 'peripherals' }"
      role="tab"
      :aria-selected="store.activeView === 'peripherals'"
      :title="peripheralTab.label"
      @click="store.setView('peripherals')"
    >
      <span class="tab-icon">
        <el-icon :size="14"><Connection /></el-icon>
        <span
          v-if="props.healthBadges && peripheralHealth"
          class="health-dot"
          :class="peripheralHealth.level"
          :title="healthTitle(peripheralHealth)"
        ></span>
      </span>
      <span class="tab-label">{{ peripheralTab.label }}</span>
      <span
        class="tab-close"
        role="button"
        tabindex="0"
        title="关闭外设页"
        aria-label="关闭外设页"
        @click.stop="closePeripheralTab"
        @keydown.stop.enter.prevent="closePeripheralTab"
        @keydown.stop.space.prevent="closePeripheralTab"
      >
        <el-icon :size="12"><Close /></el-icon>
      </span>
    </button>

    <div class="tabstrip-fill"></div>
  </div>
</template>

<style scoped>
/* MX2 对齐：深藏青标签底板 + 连续无间隙标签；选中标签白底、仅上圆角，下沿与内容区齐平无缝 */
.tabstrip {
  height: 36px;
  background: var(--mx-tabbar-bg);
  display: flex;
  align-items: flex-end;
  /* MX2 特写：底板全宽，首标签缩进左栏宽度（标签列不与左栏相交） */
  padding: 0 8px 0 var(--mx-iconrail-w);
  gap: 0;
  flex-shrink: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--mx-tab-inactive-fg);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  position: relative;
  white-space: nowrap;
}
.tab .el-icon {
  color: var(--mx-tab-inactive-icon);
}
.tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--mx-tab-inactive-fg-hover);
}
.tab:hover .el-icon {
  color: var(--mx-tab-inactive-fg-hover);
}
.tab:focus-visible {
  outline: 2px solid var(--mx-highlight);
  outline-offset: -2px;
}
.tab.active {
  background: var(--mx-tab-active-bg);
  color: var(--mx-tab-active-fg);
  font-weight: 600;
}
.tab.active .el-icon {
  color: inherit;
}
.tab.active:hover {
  background: var(--mx-tab-active-bg);
  color: var(--mx-tab-active-fg);
}
.tab.active:focus-visible {
  outline-color: var(--mx-accent);
}
/* 图标容器：健康角标以图标右上角为锚点 */
.tab-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
/* MX2 角标圆点：6px，深底用浅色变体，白签内回落语义色 */
.health-dot {
  position: absolute;
  top: -3px;
  right: -4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-dot.error {
  background: var(--mx-tab-dot-error);
}
.health-dot.warning {
  background: var(--mx-tab-dot-warning);
}
.tab.active .health-dot.error {
  background: var(--mx-error);
}
.tab.active .health-dot.warning {
  background: var(--mx-warning);
}
/* 未保存点：标题文字后的小圆点 */
.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mx-tab-dot-error);
  flex-shrink: 0;
}
.tab.active .dirty-dot {
  background: var(--mx-error);
}
.tabstrip-fill {
  flex: 1;
}
/* × 按钮：16px 圆角，active 常显 / inactive hover 显现 */
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  border-radius: 50%;
  color: var(--mx-tab-close-fg);
  opacity: 0;
  flex-shrink: 0;
  cursor: pointer;
}
.tab:hover .tab-close,
.tab.active .tab-close,
.tab-close:focus-visible {
  opacity: 1;
}
/* 外设对象标签的 × 常显 */
.object-tab .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--mx-text);
}
/* 未选中的标签仍在深底上：× 用浅色，hover 底为半透明白 */
.tab:not(.active) .tab-close {
  color: var(--mx-tab-inactive-icon);
}
.tab:not(.active) .tab-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--mx-tab-inactive-fg-hover);
}
</style>
