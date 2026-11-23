<script setup lang="ts">
defineProps<{
  x: number
  y: number
  width: number
  height: number
  text: string
  title?: string
  align?: 'start' | 'center' | 'end'
}>()
</script>

<template>
  <foreignObject :x="x" :y="y" :width="width" :height="height" class="clock-label">
    <div :style="{ textAlign: align, lineHeight: height + 'px' }" :title="title ?? text">{{ text }}</div>
  </foreignObject>
</template>

<style scoped>
.clock-label {
  overflow: hidden;
}
.clock-label div {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
