<script setup lang="ts">
// Peripherals 视图（§8.3）：页头 + 动作条（Collapse all/Expand all、Quick menu、Code preview）
// + 左 320px 列表 + 中卡片流 + 右面板 tabs（使用汇总 / EXTI 分配 / ADC 通道 / 分组）。
import { computed, nextTick, provide, reactive, ref } from 'vue'
import { Document, Fold, Expand, Menu, Promotion } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import PeripheralList from '../components/PeripheralList.vue'
import PeripheralConfigCard, { PERIPHERAL_COLLAPSE_KEY, cardDomId } from '../components/PeripheralConfigCard.vue'
import { derivePeriCategories } from '../components/PeripheralList.vue'
import QuickMenu from '../components/QuickMenu.vue'
import PeripheralUsagePanel from '../components/PeripheralUsagePanel.vue'
import ExtiAllocationPanel from '../components/ExtiAllocationPanel.vue'
import AdcChannelPanel from '../components/AdcChannelPanel.vue'
import GroupsPanel from '../components/GroupsPanel.vue'
import CodePreviewPanel from '../components/CodePreviewPanel.vue'

const store = useProjectStore()

const selectedId = ref<string | null>(null)
const showQuickMenu = ref(false)
const showCode = ref(false)
const rightTab = ref('usage')

// 折叠状态（Collapse all / Expand all 跨卡片控制，键 `${id}:params` / `${id}:pins`）
const openMap = reactive<Record<string, boolean>>({})
provide(PERIPHERAL_COLLAPSE_KEY, openMap)

// 全部实例 id（含 remap 推导的定时器等）
const allIds = computed(() => derivePeriCategories(store.deviceData).flatMap((c) => c.ids))

// 可配置实例（peripherals.json）
const configurables = computed(() => {
  const p = store.deviceData.peripherals
  return [...p.usart, ...p.spi, ...p.i2c, ...p.adc].map((i) => i.id)
})

// 中间卡片流：可配置实例 + 选中的仅展示实例
const displayIds = computed(() => {
  const extra = selectedId.value && !configurables.value.includes(selectedId.value) ? [selectedId.value] : []
  return [...configurables.value, ...extra]
})

function collapseAll() {
  for (const id of allIds.value) {
    openMap[`${id}:params`] = false
    openMap[`${id}:pins`] = false
  }
}

function expandAll() {
  for (const id of allIds.value) {
    delete openMap[`${id}:params`]
    delete openMap[`${id}:pins`]
  }
}

function selectAndScroll(id: string) {
  selectedId.value = id
  void nextTick(() => {
    document.getElementById(cardDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
</script>

<template>
  <div class="peripherals-view">
    <!-- 页头 -->
    <div class="page-head">
      <div>
        <h1 class="page-title">Peripherals</h1>
        <div class="page-sub">{{ store.deviceData.chip.chip }} {{ store.deviceData.chip.package }}</div>
      </div>
      <a class="doc-link" href="https://www.wch.cn/products/CH32V003.html" target="_blank" rel="noopener">
        <el-icon :size="13"><Document /></el-icon> Open documentation
      </a>
    </div>

    <!-- 动作条 -->
    <div class="action-bar">
      <el-button size="small" :icon="Fold" @click="collapseAll">Collapse all</el-button>
      <el-button size="small" :icon="Expand" @click="expandAll">Expand all</el-button>
      <el-button size="small" :icon="Menu" :type="showQuickMenu ? 'primary' : 'default'" @click="showQuickMenu = !showQuickMenu">
        Quick menu
      </el-button>
      <div class="toolbar-fill"></div>
      <el-button size="small" :icon="Promotion" :type="showCode ? 'primary' : 'default'" @click="showCode = !showCode">
        &lt;/&gt; Code preview
      </el-button>
    </div>

    <!-- 工作区 -->
    <div class="work-area">
      <!-- 左：外设列表 -->
      <PeripheralList :selected-id="selectedId" @select="selectAndScroll" />

      <!-- 中：卡片流 -->
      <div class="card-flow">
        <PeripheralConfigCard v-for="id in displayIds" :id="id" :key="id" class="flow-card" />
      </div>

      <!-- 代码预览（可拖拽分栏由 CodePreviewPanel 自身实现） -->
      <CodePreviewPanel v-if="showCode" context="peripherals" />

      <!-- 右：面板 tabs -->
      <div class="right-panel">
        <el-tabs v-model="rightTab" class="right-tabs">
          <el-tab-pane label="使用汇总" name="usage">
            <PeripheralUsagePanel />
          </el-tab-pane>
          <el-tab-pane label="EXTI 分配" name="exti">
            <ExtiAllocationPanel />
          </el-tab-pane>
          <el-tab-pane label="ADC 通道" name="adc">
            <AdcChannelPanel />
          </el-tab-pane>
          <el-tab-pane label="分组" name="groups">
            <GroupsPanel />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- Quick menu 浮层 -->
    <QuickMenu v-if="showQuickMenu" @select="selectAndScroll" @close="showQuickMenu = false" />
  </div>
</template>

<style scoped>
.peripherals-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 14px 20px 8px;
}
.page-title {
  font-size: var(--mx-fz-page-title);
  font-weight: 600;
  margin: 0;
}
.page-sub {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin-top: 2px;
}
.doc-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--mx-fz-label);
  color: var(--mx-accent);
  text-decoration: none;
}
.doc-link:hover {
  text-decoration: underline;
}
.action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 20px 10px;
}
.toolbar-fill {
  flex: 1;
}
.work-area {
  flex: 1;
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--mx-border);
}
.card-flow {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--mx-bg);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.flow-card {
  scroll-margin-top: 8px;
}
.right-panel {
  width: var(--mx-detail-panel-w);
  flex-shrink: 0;
  border-left: 1px solid var(--mx-border);
  background: var(--mx-surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.right-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.right-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 8px;
}
.right-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
</style>
