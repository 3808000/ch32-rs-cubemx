<script setup lang="ts">
// 通用卡片：mx-card 样式容器（设计令牌见 §8.2）
const props = withDefaults(defineProps<{ padding?: number | string }>(), { padding: 0 })
</script>

<template>
  <div
    class="mx-card card-root"
    :style="props.padding !== 0 ? { padding: typeof props.padding === 'number' ? `${props.padding}px` : props.padding } : undefined"
  >
    <slot />
  </div>
</template>

<style scoped>
.card-root {
  display: block;
}
</style>
