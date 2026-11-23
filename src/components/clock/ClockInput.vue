<script setup lang="ts">
import { computed } from 'vue'
import ClockLabel from '@/components/clock/ClockLabel.vue'
import type { ClockInputReference } from '@/components/clock/diagram'

const props = defineProps<{
  input: ClockInputReference
  highlighted: boolean
  dimmed: boolean
}>()
const emit = defineEmits<{ locate: [id: string] }>()
const startX = computed(() => props.input.anchor.x - (props.input.showLabel ? 34 : 9))
const title = computed(() => `定位上游 ${props.input.label}`)
</script>

<template>
  <g
    class="clock-input"
    :class="{ active: input.edge.active, highlighted, dimmed }"
    :data-clock-source="input.edge.from"
    :data-clock-target="input.edge.to"
    :aria-label="title"
    role="button"
    tabindex="0"
    @click.stop="emit('locate', input.edge.from)"
    @keydown.enter.space.prevent.stop="emit('locate', input.edge.from)"
  >
    <title>{{ input.edge.label ? `${title} · ${input.edge.label}` : title }}</title>
    <rect
      :x="startX - (input.showLabel ? 9 : 4)"
      :y="input.anchor.y - (input.showLabel ? 20 : 7)"
      :width="input.anchor.x - startX + (input.showLabel ? 9 : 4)"
      :height="input.showLabel ? 27 : 14"
      rx="3"
      class="input-hit"
    />
    <path :d="`M ${startX} ${input.anchor.y} H ${input.anchor.x - 4}`" class="input-line" />
    <circle :cx="startX" :cy="input.anchor.y" r="2.4" class="input-port" />
    <path :d="`M ${input.anchor.x} ${input.anchor.y} l -5 -3 v 6 z`" class="input-arrow" />
    <ClockLabel
      v-if="input.showLabel"
      :x="input.anchor.x - 44" :y="input.anchor.y - 18" :width="41" :height="13"
      :text="input.label" align="end" class="input-label"
    />
  </g>
</template>

<style scoped>
.clock-input {
  color: var(--clock-muted);
  cursor: pointer;
}
.clock-input:is(.active, .highlighted, :hover, :focus-visible) {
  color: var(--mx-accent);
}
.clock-input.dimmed:not(:hover, :focus-visible) {
  opacity: 0.28;
}
.input-hit {
  fill: transparent;
}
.clock-input:is(:hover, :focus-visible) .input-hit {
  fill: var(--mx-accent-soft);
}
.input-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
}
.clock-input:not(.active, .highlighted) .input-line {
  stroke-dasharray: 3 2;
}
.input-port {
  fill: var(--mx-surface);
  stroke: currentColor;
  stroke-width: 1.25;
}
.input-arrow {
  fill: currentColor;
}
.input-label {
  font: 600 10px var(--mx-font-mono);
}
</style>
