<script setup lang="ts">
// DMA 通道分配面板（M3.2 占位，由 DMA/参数子代理充实）。
// 目标：外设→通道/请求号分配，写 store.dma；合法性由 data/devices/<chip>/dma.json 校验。
import { useProjectStore } from '@/controllers/project'
const store = useProjectStore()
</script>

<template>
  <div class="dma-panel">
    <p class="panel-placeholder">DMA 通道分配建设中（M3）：外设→通道/请求号。当前已配置 {{ store.dma.length }} 条。</p>
  </div>
</template>

<style scoped>
.panel-placeholder {
  font-size: 12px;
  color: var(--mx-text-muted);
}
</style>
