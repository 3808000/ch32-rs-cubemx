<script setup lang="ts">
// 单条正交连线：折线 + 两端连接点（连通实心蓝 / 未连通空心灰）+ 可选标签。
// M15：按目标节点的 issueLevel 着色（error 红 / warning 橙 / active 蓝 / inactive 灰）；
// 路径高亮时非高亮边由父级传入 dimmed 降透明度。
import type { ClockTreeEdge } from '@/model/clock/tree'

withDefaults(
  defineProps<{
    edge: ClockTreeEdge
    /** 目标节点问题级别（null=正常） */
    targetLevel?: 'error' | 'warning' | null
    /** 路径高亮期间的非高亮边 */
    dimmed?: boolean
  }>(),
  { targetLevel: null, dimmed: false },
)
</script>

<template>
  <g :class="{ 'edge-off': !edge.active, dimmed, 'level-error': targetLevel === 'error', 'level-warning': targetLevel === 'warning' }">
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
  stroke: var(--mx-accent);
  stroke-width: 1.5;
  transition: stroke var(--mx-dur-node) linear;
}
/* 未启用链路：灰 */
.edge-off .edge {
  stroke: #d5dbe5;
}
/* 目标节点越界：整条链路按级别着色 */
.level-error .edge {
  stroke: var(--mx-error);
}
.level-warning .edge {
  stroke: var(--mx-warning);
}
.dimmed {
  opacity: 0.18;
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
.level-error .dot-on {
  fill: var(--mx-error);
}
.level-warning .dot-on {
  fill: var(--mx-warning);
}
</style>
