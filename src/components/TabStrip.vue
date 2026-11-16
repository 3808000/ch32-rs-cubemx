<script setup lang="ts">
// 浏览器式标签页条：固定视图 + Project settings + 可关闭的外设对象页（M2）。
// M5：按 conflicts 归属在对应标签上显示 error 红点 / warning 黄点（healthOf 派生）。
import { computed } from 'vue'
import { HomeFilled, Cpu, Timer, Connection, Setting, Close } from '@element-plus/icons-vue'
import { useProjectStore, type ViewId } from '@/controllers/project'
import type { Conflict } from '@/model/types'

const props = withDefaults(defineProps<{ healthBadges?: boolean }>(), { healthBadges: true })

const store = useProjectStore()

const tabs: { id: ViewId; label: string; icon: unknown }[] = [
  { id: 'home', label: 'Home', icon: HomeFilled },
  { id: 'pinout', label: 'Pinout', icon: Cpu },
  { id: 'clock', label: 'Clock', icon: Timer },
  { id: 'peripherals', label: 'Peripherals', icon: Connection },
  { id: 'project-settings', label: 'Project settings', icon: Setting },
]

/** 当前打开的外设对象页标签（可关闭）。 */
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

/** 固定视图标签 + 健康摘要（一次派生，模板不重复查询 Map）。 */
const tabsWithHealth = computed(() =>
  tabs.map((tab) => ({ ...tab, health: healthOfView(tab.id) })),
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

function closePeripheralTab() {
  store.closePeripheral()
}
</script>

<template>
  <div class="tabstrip">
    <button
      v-for="t in tabsWithHealth"
      :key="t.id"
      class="tab"
      :class="{ active: store.activeView === t.id && !(t.id === 'peripherals' && peripheralTab) }"
      @click="store.setView(t.id)"
    >
      <el-icon :size="14"><component :is="t.icon" /></el-icon>
      <span>{{ t.label }}</span>
      <span
        v-if="props.healthBadges && t.health"
        class="health-dot"
        :class="t.health?.level"
        :title="t.health ? healthTitle(t.health) : ''"
      ></span>
      <span v-if="store.dirty && store.activeView === t.id" class="dirty-dot" title="有未保存改动"></span>
    </button>

    <!-- 外设对象页标签（可关闭） -->
    <button
      v-if="peripheralTab"
      class="tab object-tab"
      :class="{ active: store.activeView === 'peripherals' }"
      @click="store.setView('peripherals')"
    >
      <el-icon :size="14"><Connection /></el-icon>
      <span>{{ peripheralTab.label }}</span>
      <span
        v-if="props.healthBadges && peripheralHealth"
        class="health-dot"
        :class="peripheralHealth?.level"
        :title="peripheralHealth ? healthTitle(peripheralHealth) : ''"
      ></span>
      <span
        class="tab-close"
        title="关闭外设页"
        @click.stop="closePeripheralTab"
      >
        <el-icon :size="12"><Close /></el-icon>
      </span>
    </button>

    <div class="tabstrip-fill"></div>
  </div>
</template>

<style scoped>
/* M8 对齐 MX2：标签底板深藏青（与标题栏同色系），未选中透明底浅字，选中白签 raised（上圆角下直角贴合内容区） */
.tabstrip {
  height: var(--mx-tabstrip-h);
  background: var(--mx-tabbar-bg);
  display: flex;
  align-items: flex-end;
  padding: 0 8px;
  gap: 2px;
  flex-shrink: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--mx-tab-inactive-fg);
  font-size: 13px;
  cursor: pointer;
  border-radius: var(--mx-radius-tab) var(--mx-radius-tab) 0 0;
  position: relative;
  white-space: nowrap;
}
.tab .el-icon {
  color: var(--mx-tab-inactive-icon);
}
.tab:hover {
  background: var(--mx-tab-inactive-hover-bg);
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
.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
/* 深藏青底：浅红/黄保证 AA 对比度 */
.health-dot.error {
  background: var(--mx-tab-dot-error);
  box-shadow: 0 0 0 2px var(--mx-tab-dot-ring);
}
.health-dot.warning {
  background: var(--mx-tab-dot-warning);
  box-shadow: 0 0 0 2px var(--mx-tab-dot-ring);
}
/* 白签内：回落语义色 */
.tab.active .health-dot.error {
  background: var(--mx-error);
  box-shadow: 0 0 0 2px rgba(192, 0, 0, 0.12);
}
.tab.active .health-dot.warning {
  background: var(--mx-warning);
  box-shadow: 0 0 0 2px rgba(178, 106, 0, 0.14);
}
.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mx-tab-dot-error);
}
.tab.active .dirty-dot {
  background: var(--mx-error);
}
.tabstrip-fill {
  flex: 1;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--mx-tab-close-fg);
}
.tab-close:hover {
  background: var(--mx-tab-close-hover-bg);
  color: var(--mx-text);
}
/* 未选中的外设对象标签仍在深底上：关闭按钮/图标用浅色 */
.tab:not(.active) .tab-close {
  color: var(--mx-tab-inactive-icon);
}
.tab:not(.active) .tab-close:hover {
  background: var(--mx-tab-inactive-hover-bg);
  color: var(--mx-tab-inactive-fg-hover);
}
</style>