<script setup lang="ts">
// 冲突面板：按 error/warning 分组，点击定位引脚
import { computed } from 'vue'
import { useProjectStore } from '@/controllers/project'
import { CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'

const store = useProjectStore()
const errors = computed(() => store.conflicts.filter((c) => c.level === 'error'))
const warnings = computed(() => store.conflicts.filter((c) => c.level === 'warning'))

function locate(pins?: string[]) {
  if (pins?.length) {
    store.selectPin(pins[0])
    store.setView('pinout')
  }
}
</script>

<template>
  <div class="conflicts">
    <div v-if="store.conflicts.length === 0" class="all-clear">
      <el-icon :size="16" color="#1D8136"><CircleCloseFilled /></el-icon>
      <span>配置无冲突</span>
    </div>
    <template v-else>
      <div v-if="errors.length" class="group">
        <div class="group-title err">错误（{{ errors.length }}）</div>
        <button v-for="(c, i) in errors" :key="'e' + i" class="conflict-row err" @click="locate(c.pins)">
          <el-icon :size="13"><CircleCloseFilled /></el-icon>
          <span class="code">{{ c.code }}</span>
          <span class="msg">{{ c.message }}</span>
        </button>
      </div>
      <div v-if="warnings.length" class="group">
        <div class="group-title warn">警告（{{ warnings.length }}）</div>
        <button v-for="(c, i) in warnings" :key="'w' + i" class="conflict-row warn" @click="locate(c.pins)">
          <el-icon :size="13"><WarningFilled /></el-icon>
          <span class="code">{{ c.code }}</span>
          <span class="msg">{{ c.message }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.conflicts {
  padding: 8px;
}
.all-clear {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: var(--mx-success);
  font-size: 13px;
}
.group {
  margin-bottom: 10px;
}
.group-title {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
}
.group-title.err {
  color: var(--mx-error);
}
.group-title.warn {
  color: var(--mx-warning);
}
.conflict-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.conflict-row.err {
  color: var(--mx-error);
}
.conflict-row.warn {
  color: var(--mx-warning);
}
.conflict-row:hover {
  background: var(--mx-accent-soft);
}
.code {
  font-family: var(--mx-font-mono);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}
.msg {
  color: var(--mx-text-secondary);
}
</style>