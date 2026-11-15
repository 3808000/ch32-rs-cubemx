<script setup lang="ts">
// 状态徽标（§8.6）：Active 绿 / Inactive 灰
withDefaults(
  defineProps<{
    active?: boolean
    activeText?: string
    inactiveText?: string
  }>(),
  { active: false, activeText: 'Active', inactiveText: 'Inactive' },
)
</script>

<template>
  <span class="status-badge" :class="active ? 'is-active' : 'is-inactive'">
    <span class="sb-dot" />
    {{ active ? activeText : inactiveText }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 4px 10px;
  border-radius: 10px;
  white-space: nowrap;
}
.status-badge.is-active {
  color: var(--mx-success);
  background: #e6f4ea;
}
.status-badge.is-active .sb-dot {
  background: var(--mx-success);
}
.status-badge.is-inactive {
  color: var(--mx-text-muted);
  background: #f2f4f7;
}
.status-badge.is-inactive .sb-dot {
  background: var(--mx-text-muted);
}
.sb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
