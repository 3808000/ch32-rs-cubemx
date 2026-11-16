<script setup lang="ts">
// NVIC/PFIC 中断配置面板（M3.1 占位，由中断子代理充实）。
// 目标：IRQ 表（使能/优先级 0..15），写 store.interrupts；生成 src/generated/irq.rs。
import { useProjectStore } from '@/controllers/project'
const store = useProjectStore()
</script>

<template>
  <div class="nvic-panel">
    <p class="panel-placeholder">NVIC 中断配置建设中（M3）：IRQ 使能 / 优先级表。当前已配置 {{ store.interrupts.length }} 条。</p>
  </div>
</template>

<style scoped>
.panel-placeholder {
  font-size: 12px;
  color: var(--mx-text-muted);
}
</style>
