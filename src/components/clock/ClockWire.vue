<script setup lang="ts">
import { computed, useId } from 'vue'
import type { ClockPt, ClockTreeEdge } from '@/model/clock/tree'

const props = defineProps<{
  edge: ClockTreeEdge
  strokePath?: string
  crossingGaps?: readonly ClockPt[]
  drawSource: boolean
  targetLevel?: 'error' | 'warning' | null
  primary?: boolean
  lowSpeed?: boolean
  selection?: boolean
  dimmed?: boolean
  highlighted?: boolean
}>()

const maskId = `clock-crossings-${useId()}`
const source = computed(() => props.edge.points[0]!)
const target = computed(() => props.edge.points.at(-1)!)
const showLabel = computed(() => props.edge.label && !['÷1', '×1'].includes(props.edge.label))
const arrow = computed(() => {
  const tip = target.value
  const prev = props.edge.points.at(-2)
  if (!prev || tip.y !== prev.y || tip.x === prev.x) return undefined
  const base = tip.x - Math.sign(tip.x - prev.x) * 6
  return `${tip.x},${tip.y} ${base},${tip.y - 3} ${base},${tip.y + 3}`
})
</script>

<template>
  <g
    class="wire"
    :class="{
      active: edge.active,
      primary,
      'low-speed': lowSpeed,
      selection,
      dimmed,
      highlighted,
      'level-error': edge.active && targetLevel === 'error',
      'level-warning': edge.active && targetLevel === 'warning',
    }"
    :data-from="edge.from"
    :data-to="edge.to"
  >
    <mask v-if="crossingGaps?.length" :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
      <rect width="100%" height="100%" fill="white" />
      <circle v-for="gap in crossingGaps" :key="`${gap.x}/${gap.y}`" :cx="gap.x" :cy="gap.y" r="4.5" fill="black" />
    </mask>
    <path v-if="strokePath" :d="strokePath" :mask="crossingGaps?.length ? `url(#${maskId})` : undefined" class="edge" />
    <polygon v-if="arrow && (edge.active || highlighted || lowSpeed || selection)" :points="arrow" class="edge-arrow" />
    <circle v-if="drawSource" :cx="source.x" :cy="source.y" r="2.6" class="edge-port" />
    <text v-if="showLabel" :x="edge.labelAt.x" :y="edge.labelAt.y" class="edge-label">{{ edge.label }}</text>
  </g>
</template>

<style scoped>
.wire {
  --wire-color: var(--clock-wire);
  color: var(--wire-color);
  pointer-events: none;
}
.wire:is(.active, .primary) { --wire-color: var(--clock-active-wire); }
.wire.highlighted { --wire-color: var(--mx-accent); }
.wire.level-error { --wire-color: var(--mx-error); }
.wire.level-warning { --wire-color: var(--mx-warning); }
.wire.dimmed { opacity: 0.24; }
.edge {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.wire:not(.active) .edge { stroke-dasharray: 4 4; }
.wire:not(.active):not(.highlighted) { opacity: 0.65; }
.wire.low-speed:not(.active, .highlighted) {
  --wire-color: var(--clock-muted);
  opacity: 1;
}
.wire.selection:not(.active, .highlighted) {
  --wire-color: var(--clock-muted);
  opacity: 0.85;
}
.wire.dimmed:not(.active) { opacity: 0.24; }
.primary .edge { stroke-width: 2.2; }
.highlighted .edge { stroke-width: 2.5; }
.edge-arrow { fill: currentColor; }
.edge-port {
  fill: var(--mx-surface);
  stroke: currentColor;
  stroke-width: 1.15;
}
.edge-label {
  font-size: 10px;
  fill: var(--clock-muted);
  stroke: var(--mx-surface);
  stroke-width: 3px;
  paint-order: stroke;
  text-anchor: middle;
}
</style>
