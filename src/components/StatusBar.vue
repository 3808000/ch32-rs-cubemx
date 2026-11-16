<script setup lang="ts">
// 状态栏：左保存状态，中问题徽标（点击打开 Problems），右芯片信息 + 通知铃铛（未读数）。
import { computed } from 'vue'
import { Bell, Check, CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'

const props = withDefaults(defineProps<{ unreadNotifications?: number }>(), { unreadNotifications: 0 })
const emit = defineEmits<{ (e: 'problems'): void; (e: 'notifications'): void }>()

const store = useProjectStore()

const statusText = computed(() => (store.dirty ? 'Click to save' : 'Saved'))
/** 铃铛角标只统计通知未读，问题数由错误/警告徽标承担。 */
const unreadLabel = computed(() => (props.unreadNotifications > 99 ? '99+' : String(props.unreadNotifications)))
</script>

<template>
  <footer class="statusbar">
    <button class="save-state" :class="{ dirty: store.dirty }" @click="store.save()">
      <el-icon :size="12">
        <WarningFilled v-if="store.dirty" />
        <Check v-else />
      </el-icon>
      <span>{{ statusText }}</span>
    </button>
    <button
      v-if="store.errorCount"
      class="issue err"
      title="打开问题列表（Problems）"
      @click="emit('problems')"
    >
      <el-icon :size="12"><CircleCloseFilled /></el-icon>
      <span>{{ store.errorCount }} 错误</span>
    </button>
    <button
      v-if="store.warningCount"
      class="issue warn"
      title="打开问题列表（Problems）"
      @click="emit('problems')"
    >
      <el-icon :size="12"><WarningFilled /></el-icon>
      <span>{{ store.warningCount }} 警告</span>
    </button>
    <div class="fill"></div>
    <span class="chip-info">{{ store.deviceData.chip.chip }} · {{ store.deviceData.chip.package }}</span>
    <button
      class="bell"
      :title="`通知（${props.unreadNotifications} 条未读）`"
      :aria-label="`通知，${props.unreadNotifications} 条未读`"
      @click="emit('notifications')"
    >
      <el-icon :size="13"><Bell /></el-icon>
      <span v-if="props.unreadNotifications > 0" class="badge">{{ unreadLabel }}</span>
    </button>
  </footer>
</template>

<style scoped>
.statusbar {
  height: var(--mx-statusbar-h);
  background: var(--mx-surface);
  border-top: 1px solid var(--mx-border);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 12px;
  font-size: 12px;
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}
.save-state {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--mx-success);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.save-state.dirty {
  color: var(--mx-warning);
}
.save-state:hover {
  background: var(--mx-accent-soft);
}
.issue {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.issue:hover {
  background: var(--mx-accent-soft);
}
.issue.err {
  color: var(--mx-error);
}
.issue.warn {
  color: var(--mx-warning);
}
.fill {
  flex: 1;
}
.chip-info {
  color: var(--mx-text-muted);
}
.bell {
  position: relative;
  border: none;
  background: none;
  color: var(--mx-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 3px 6px;
  border-radius: 4px;
}
.bell:hover {
  background: var(--mx-accent-soft);
}
.badge {
  position: absolute;
  top: -3px;
  right: -2px;
  background: var(--mx-error);
  color: #fff;
  font-size: 10px;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}
</style>