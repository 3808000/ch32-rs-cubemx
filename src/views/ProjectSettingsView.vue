<script setup lang="ts">
// Project settings 主视图（M2.4 占位，由外设/工程子代理充实）。
// 目标：General（名称/路径）/ Generation（导出选项）/ Advanced（冲突规则）三段 + 页内「生成工程」。
import { useProjectStore } from '@/controllers/project'
const store = useProjectStore()
</script>

<template>
  <div class="project-settings">
    <h1>Project settings</h1>
    <p class="ps-sub">{{ store.projectName }} · {{ store.chip }}</p>
    <p class="ps-placeholder">工程设置视图建设中（M2）：将集中管理工程名/路径、生成选项与冲突规则。</p>
  </div>
</template>

<style scoped>
.project-settings {
  padding: 24px;
  overflow-y: auto;
}
.ps-sub {
  color: var(--mx-text-secondary);
  font-size: 13px;
}
.ps-placeholder {
  color: var(--mx-text-muted);
  font-size: 13px;
}
</style>
