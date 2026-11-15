<script setup lang="ts">
// 区块头：标题 + 副标题 + 右插槽（§8.6 信息层级）
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="section-header">
    <div class="sh-left">
      <div class="sh-title">{{ title }}</div>
      <div v-if="subtitle" class="sh-subtitle">{{ subtitle }}</div>
    </div>
    <div class="sh-right">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
}
.sh-title {
  font-size: var(--mx-fz-card-title);
  font-weight: 600;
  color: var(--mx-text);
}
.sh-subtitle {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin-top: 2px;
}
.sh-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
