<script setup lang="ts">
// 引脚状态图例：八态色块 + 中文标签 + 实时计数，可折叠（localStorage 持久化）。
// 色块与封装图/表格状态点/悬停浮卡共用 pinFilter 的 pinStateColors。
import { computed, ref, watch } from 'vue'
import { PIN_STATE_META, pinStateColors, type PinStateId } from '@/model/pins/pinFilter'

const props = defineProps<{
  counts: Record<PinStateId, number>
}>()

const STORAGE_KEY = 'ch32.pinout.legend.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const collapsed = ref(readCollapsed())
watch(collapsed, (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
  } catch {
    // 无 localStorage（隐私模式/测试环境）时忽略持久化
  }
})

const total = computed(() => PIN_STATE_META.reduce((sum, m) => sum + (props.counts[m.id] ?? 0), 0))

/** 已配置态在封装图中按 GPIO（绿）/ 复用（蓝）细分，图例用双色渐变保持一致。 */
function swatchStyle(state: PinStateId): Record<string, string> {
  const color = pinStateColors(state)
  if (state === 'configured') {
    const af = pinStateColors('configured', 'AF')
    return { background: `linear-gradient(135deg, ${color.bg} 50%, ${af.bg} 50%)`, borderColor: color.border }
  }
  return { background: color.bg, borderColor: color.border }
}

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <div class="pin-legend" :class="{ collapsed }">
    <button
      type="button"
      class="legend-toggle"
      :aria-expanded="!collapsed"
      :title="collapsed ? '展开状态图例' : '折叠状态图例'"
      @click="toggle"
    >
      <span class="chevron" :class="{ open: !collapsed }">▸</span>
      <span>状态图例</span>
      <span class="legend-total">共 {{ total }}</span>
    </button>
    <div v-if="!collapsed" class="legend-items">
      <span v-for="m in PIN_STATE_META" :key="m.id" class="legend-item">
        <span class="legend-swatch" :style="swatchStyle(m.id)"></span>
        <span class="legend-label">{{ m.label }}</span>
        <span class="legend-count">{{ counts[m.id] ?? 0 }}</span>
      </span>
      <span class="legend-note">已配置：GPIO 绿 / 复用·模拟 蓝</span>
    </div>
  </div>
</template>

<style scoped>
.pin-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 0 20px 8px;
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.legend-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--mx-border);
  background: var(--mx-surface);
  color: var(--mx-text-secondary);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 12px;
  cursor: pointer;
}
.legend-toggle:hover {
  color: var(--mx-accent);
  border-color: var(--mx-accent);
}
.chevron {
  display: inline-block;
  transition: transform 140ms var(--mx-ease-out);
}
.chevron.open {
  transform: rotate(90deg);
}
.legend-total {
  color: var(--mx-text-muted);
  font-variant-numeric: tabular-nums;
}
.legend-items {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--mx-border);
  flex-shrink: 0;
}
.legend-label {
  color: var(--mx-text-secondary);
}
.legend-count {
  color: var(--mx-text-muted);
  font-variant-numeric: tabular-nums;
}
.legend-note {
  color: var(--mx-text-muted);
  border-left: 1px solid var(--mx-border);
  padding-left: 12px;
}
</style>