<script setup lang="ts">
// Peripherals 视图（M2.2）：左侧实例列表 + 右侧工作区。
// activePeripheralId 非空时渲染单实例 PeripheralWorkspaceView；否则渲染概览/汇总
// （使用汇总 + EXTI/ADC/分组分配面板），保留 Quick menu / Code preview。
import { computed, provide, reactive, ref } from 'vue'
import { Document, Expand, Fold, Menu, Promotion } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { derivePeripheralUsage } from '@/model/peripherals'
import PeripheralList from '../components/PeripheralList.vue'
import PeripheralWorkspaceView from './PeripheralWorkspaceView.vue'
import { PERIPHERAL_COLLAPSE_KEY } from '../components/PeripheralConfigCard.vue'
import { derivePeriCategories } from '../components/PeripheralList.vue'
import QuickMenu from '../components/QuickMenu.vue'
import PeripheralUsagePanel from '../components/PeripheralUsagePanel.vue'
import ExtiAllocationPanel from '../components/ExtiAllocationPanel.vue'
import AdcChannelPanel from '../components/AdcChannelPanel.vue'
import GroupsPanel from '../components/GroupsPanel.vue'
import CodePreviewPanel from '../components/CodePreviewPanel.vue'
import SectionHeader from '../components/common/SectionHeader.vue'

const store = useProjectStore()

const showQuickMenu = ref(false)
const showCode = ref(false)
const rightTab = ref('exti')

/** 页头文档链接：优先芯片数据里的 docUrl，缺省回退 WCH 官网首页 */
const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

// 折叠状态（Collapse all / Expand all 跨卡片控制，键 `${id}:params` / `${id}:pins`）
const openMap = reactive<Record<string, boolean>>({})
provide(PERIPHERAL_COLLAPSE_KEY, openMap)

// 全部实例 id（含 remap 推导的定时器等）
const allIds = computed(() => derivePeriCategories(store.deviceData).flatMap((c) => c.ids))

// 概览统计
const activeCount = computed(
  () => derivePeripheralUsage(store.config, store.deviceData).filter((u) => u.enabled).length,
)

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

/** 列表项点击不再滚动定位，而是打开对象页（M2.2）。 */
function openPeripheral(id: string) {
  store.openPeripheral(id)
  showQuickMenu.value = false
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
      <a class="doc-link" :href="docUrl" target="_blank" rel="noopener">
        <el-icon :size="13"><Document /></el-icon> Open documentation
      </a>
    </div>

    <!-- 动作条 -->
    <div class="action-bar">
      <template v-if="store.activePeripheralId">
        <el-button size="small" :icon="Fold" @click="collapseAll">Collapse all</el-button>
        <el-button size="small" :icon="Expand" @click="expandAll">Expand all</el-button>
      </template>
      <el-button size="small" :icon="Menu" :type="showQuickMenu ? 'primary' : 'default'" @click="showQuickMenu = !showQuickMenu">
        Quick menu
      </el-button>
      <div class="toolbar-fill"></div>
      <el-button size="small" :icon="Promotion" :type="showCode ? 'primary' : 'default'" @click="showCode = !showCode">
        &lt;/&gt; Code preview
      </el-button>
    </div>

    <!-- 工作区：左列表 + 右对象页/概览 -->
    <div class="work-area">
      <PeripheralList :selected-id="store.activePeripheralId" @select="openPeripheral" />

      <PeripheralWorkspaceView
        v-if="store.activePeripheralId"
        :id="store.activePeripheralId"
        :key="store.activePeripheralId"
      />

      <!-- 概览/汇总（无对象页时） -->
      <div v-else class="overview">
        <div class="ov-head">
          <div>
            <div class="ov-title">Peripheral overview</div>
            <div class="ov-sub">从左侧列表选择实例进入单实例工作区；此处汇总当前引脚占用与分配面板。</div>
          </div>
        </div>

        <div class="ov-stats">
          <div class="ov-stat">
            <div class="ov-stat-num">{{ allIds.length }}</div>
            <div class="ov-stat-label">Instances</div>
          </div>
          <div class="ov-stat">
            <div class="ov-stat-num success">{{ activeCount }}</div>
            <div class="ov-stat-label">Active</div>
          </div>
          <div class="ov-stat">
            <div class="ov-stat-num" :class="{ danger: store.errorCount > 0 }">{{ store.errorCount }}</div>
            <div class="ov-stat-label">Errors</div>
          </div>
          <div class="ov-stat">
            <div class="ov-stat-num" :class="{ warning: store.warningCount > 0 }">{{ store.warningCount }}</div>
            <div class="ov-stat-label">Warnings</div>
          </div>
        </div>

        <div class="ov-grid">
          <section class="ov-card">
            <SectionHeader title="Usage summary" subtitle="已分配引脚与占用驱动" />
            <PeripheralUsagePanel />
          </section>

          <section class="ov-card">
            <SectionHeader title="Allocations" subtitle="EXTI / ADC / 分组" />
            <el-tabs v-model="rightTab" class="ov-tabs">
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
          </section>
        </div>
      </div>

      <!-- 代码预览（可拖拽分栏由 CodePreviewPanel 自身实现） -->
      <CodePreviewPanel v-if="showCode" context="peripherals" />
    </div>

    <!-- Quick menu 浮层 -->
    <QuickMenu v-if="showQuickMenu" @select="openPeripheral" @close="showQuickMenu = false" />
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
.overview {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--mx-bg);
  padding: 16px 20px 24px;
}
.ov-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.ov-title {
  font-size: var(--mx-fz-card-title);
  font-weight: 600;
  color: var(--mx-text);
}
.ov-sub {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin-top: 2px;
}
.ov-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.ov-stat {
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-card);
  padding: 12px 14px;
}
.ov-stat-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--mx-text);
  line-height: 1.2;
}
.ov-stat-num.success {
  color: var(--mx-success);
}
.ov-stat-num.warning {
  color: var(--mx-warning);
}
.ov-stat-num.danger {
  color: var(--mx-error);
}
.ov-stat-label {
  margin-top: 2px;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.ov-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 14px;
  align-items: start;
}
.ov-card {
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-card);
  padding: 4px 12px 12px;
  min-width: 0;
}
.ov-tabs :deep(.el-tabs__header) {
  margin: 0 0 6px;
}
</style>