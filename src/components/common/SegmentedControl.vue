<script setup lang="ts">
// 分段控件（§8.7）：选中项白底 + 蓝字 + 2px 蓝下划线
defineProps<{ options: { value: string; label: string }[] }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="segmented-control">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="sc-item"
      :class="{ active: model === o.value }"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented-control {
  display: inline-flex;
  background: #e9edf5;
  border-radius: var(--mx-radius-button);
  padding: 2px;
}
.sc-item {
  border: none;
  background: transparent;
  padding: 5px 14px;
  font-size: var(--mx-fz-label);
  font-family: inherit;
  color: var(--mx-text-secondary);
  cursor: pointer;
  border-radius: 6px;
  position: relative;
}
.sc-item.active {
  background: var(--mx-surface);
  color: var(--mx-accent);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  border-bottom: 2px solid var(--mx-accent);
}
</style>
