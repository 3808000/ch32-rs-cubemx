<script setup lang="ts">
// 单条正交连线：折线 + 两端连接点（连通实心蓝 / 未连通空心灰）+ 可选标签。
import type { ClockTreeEdge } from '@/model/clock/tree'

defineProps<{ edge: ClockTreeEdge }>()
</script>

<template>
  <g :class="{ 'edge-off': !edge.active }">
    <polyline :points="edge.points.map((p) => `${p.x},${p.y}`).join(' ')" class="edge" />
    <!-- 连接点：连通实心蓝 / 未连通空心灰 -->
    <circle :cx="edge.points[0].x" :cy="edge.points[0].y" r="4" :class="edge.active ? 'dot-on' : 'dot-off'" />
    <circle
      :cx="edge.points[edge.points.length - 1].x"
      :cy="edge.points[edge.points.length - 1].y"
      r="4"
      :class="edge.active ? 'dot-on' : 'dot-off'"
    />
    <text v-if="edge.label" :x="edge.labelAt.x" :y="edge.labelAt.y" class="edge-label">{{ edge.label }}</text>
  </g>
</template>

<style scoped>
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
</style>