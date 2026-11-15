<script setup lang="ts">
// 可折叠面板：标题行 ⊖/⊕ 切换（§8.6）。open 支持 v-model:open 受控，缺省展开。
const props = withDefaults(defineProps<{ title: string; open?: boolean }>(), { open: true })
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function toggle() {
  emit('update:open', !props.open)
}
</script>

<template>
  <div class="collapsible-panel">
    <button type="button" class="cp-head" @click="toggle">
      <span class="cp-icon">{{ open ? '⊖' : '⊕' }}</span>
      <span class="cp-title">{{ title }}</span>
      <span class="cp-right"><slot name="right" /></span>
    </button>
    <div v-show="open" class="cp-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.collapsible-panel {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-button);
  background: var(--mx-surface);
  overflow: hidden;
}
.cp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: var(--mx-accent-soft);
  padding: 7px 12px;
  cursor: pointer;
  text-align: left;
  color: var(--mx-text);
}
.cp-head:hover {
  background: #e2eef9;
}
.cp-icon {
  font-size: 13px;
  line-height: 1;
  color: var(--mx-text-secondary);
  font-family: var(--mx-font-mono);
}
.cp-title {
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.cp-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cp-body {
  padding: 8px 16px;
}
</style>
