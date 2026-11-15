<script setup lang="ts">
// 空状态（§8.7）：居中图标 + 主标题 + 一句说明
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon?: Component | null
    title: string
    description?: string
  }>(),
  { icon: null, description: '' },
)
</script>

<template>
  <div class="empty-state">
    <el-icon v-if="icon" :size="40" color="#c9d2e0" class="es-icon"><component :is="icon" /></el-icon>
    <div class="es-title">{{ title }}</div>
    <div v-if="description" class="es-desc">{{ description }}</div>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  gap: 8px;
}
.es-icon {
  margin-bottom: 4px;
}
.es-title {
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text-secondary);
}
.es-desc {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  max-width: 280px;
}
</style>
