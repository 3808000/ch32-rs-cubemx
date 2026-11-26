<script setup lang="ts">
// 外设单实例工作区（M2.2/M2.3）：页头 + 未激活模式选择/Activate + 已激活配置主体。
// 配置主体复用 PeripheralConfigCard（workspace 模式隐藏卡片头），激活/停用通过其 defineExpose 调用。
import { computed, ref } from 'vue'
import { ArrowLeft, Document } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { categoryOfPeripheral } from '@/model/device'
import { derivePeripheralUsage } from '@/model/peripherals'
import StatusBadge from '@/components/common/StatusBadge.vue'
import BleWorkspaceView from './BleWorkspaceView.vue'
import PeripheralConfigCard from '@/components/PeripheralConfigCard.vue'
import {
  findPeripheralInstance,
  type PeripheralConfigCardApi,
} from '@/components/peripherals/instance'
import {
  MODE_PARAM_KEY,
  isCodegenSupported,
  selectedMode,
  type PeripheralMode,
} from '@/components/peripherals/modes'

const props = defineProps<{ id: string }>()

const store = useProjectStore()
const cardRef = ref<PeripheralConfigCardApi | null>(null)

/** M19：BLE 无 AF 引脚，走独立工作区（数据声明存在才启用）。 */
const isBle = computed(() => store.deviceData.peripherals.ble?.instance === props.id)

const instance = computed(() => findPeripheralInstance(store.deviceData.peripherals, props.id))
const usage = computed(() => derivePeripheralUsage(store.config, store.deviceData).find((u) => u.id === props.id) ?? null)
const active = computed(() => usage.value?.enabled ?? false)
const modes = computed<PeripheralMode[]>(() => instance.value?.modes ?? [])
const currentMode = computed(() => selectedMode(modes.value, usage.value?.params))
const modeBlocked = computed(() => !!currentMode.value && !isCodegenSupported(currentMode.value))

/** 页头文档链接：优先芯片数据里的 docUrl，缺省回退 WCH 官网首页 */
const docUrl = computed(() => store.deviceData.chip.docUrl || 'https://www.wch.cn/')

/** 非配置实例（定时器等）的分类标签。 */
const categoryLabel = computed(() => {
  if (instance.value) return instance.value.categoryLabel
  const cat = categoryOfPeripheral(props.id)
  if (cat === 'timer') return 'Timers'
  if (cat === 'other') return 'System'
  return cat
})

/** 当前选中 mode（未激活时即待激活 mode）；写入 params.opMode 立即持久化。 */
const pendingModeId = computed<string | null>({
  get: () => currentMode.value?.id ?? null,
  set: (id) => {
    if (!id || !instance.value) return
    if (!modes.value.some((m) => m.id === id)) return
    const u = usage.value
    store.setPeripheral(props.id, {
      enabled: u?.enabled ?? false,
      params: { ...(u?.params ?? {}), [MODE_PARAM_KEY]: id },
      remap: instance.value.kind === 'adc' ? undefined : (u?.remap ?? undefined),
    })
  },
})

const canActivate = computed(() => {
  if (!instance.value) return false
  if (modes.value.length === 0) return true
  return !!currentMode.value && isCodegenSupported(currentMode.value)
})

const activationHint = computed(() =>
  modes.value.length > 1
    ? 'Select a mode, then click Activate. Parameter settings appear after activation.'
    : 'Click Activate to enable this peripheral. Parameter settings appear after activation.',
)

const activating = ref(false)
const releasing = ref(false)
const showDeactivate = ref(false)

const pinCount = computed(() => usage.value?.pins.length ?? 0)

async function activateNow() {
  if (!canActivate.value || activating.value) return
  activating.value = true
  try {
    await cardRef.value?.activate(currentMode.value?.id)
  } finally {
    activating.value = false
  }
}

function requestDeactivate() {
  if (!active.value) return
  showDeactivate.value = true
}

async function confirmDeactivate() {
  if (releasing.value) return
  releasing.value = true
  try {
    // 停用必须释放 AF/ANALOG 引脚：derivePeripheralUsage 以「已分配引脚」判定启用，
    // 仅把 enabled 置 false 而保留引脚会被推导回 Active，且生成器仍会导出该外设。
    await cardRef.value?.deactivate(true, false)
    showDeactivate.value = false
    if (usage.value?.enabled) {
      // 用户取消了某个引脚的覆盖：AF 引脚仍存在，derivePeripheralUsage 会推导为启用
      store.notify(`${props.id} 仍有引脚未释放，外设保持启用`, 'warning')
    } else {
      store.notify(`${props.id} 已停用并释放引脚`, 'info')
    }
  } finally {
    releasing.value = false
  }
}
</script>

<template>
  <BleWorkspaceView v-if="isBle" :id="id" />
  <div v-else class="ws-view">
    <!-- 页头：返回 + 分类/名称 + 状态 + mode + 文档 + Deactivate -->
    <div class="ws-head">
      <div class="ws-head-left">
        <button type="button" class="ws-back" @click="store.closePeripheral()">
          <el-icon :size="13"><ArrowLeft /></el-icon>
          Back to list
        </button>
        <div class="ws-title">
          <div class="ws-category">{{ categoryLabel }}</div>
          <div class="ws-name">{{ id }}</div>
        </div>
        <StatusBadge v-if="instance" :active="active" />
        <StatusBadge v-else :active="false" inactive-text="Display" />
        <span v-if="active && currentMode" class="ws-mode-chip">Mode: {{ currentMode.label }}</span>
        <el-tag v-if="active && modeBlocked" size="small" type="warning">代码生成待支持</el-tag>
      </div>
      <div class="ws-head-right">
        <a class="doc-link" :href="docUrl" target="_blank" rel="noopener">
          <el-icon :size="13"><Document /></el-icon> Open documentation
        </a>
        <el-button v-if="instance && active" type="danger" plain size="small" @click="requestDeactivate">
          Deactivate
        </el-button>
      </div>
    </div>

    <div class="ws-body">
      <template v-if="instance">
        <!-- 未激活：Peripheral Not Configured / Select mode / Activate -->
        <div v-if="!active" class="ws-activation">
          <el-alert
            type="info"
            :closable="false"
            title="Peripheral Not Configured"
            :description="activationHint"
          />
          <div class="ws-mode-panel">
            <template v-if="modes.length > 0">
              <div class="ws-mode-title">{{ modes.length > 1 ? 'Select mode' : 'Mode' }}</div>
              <el-radio-group v-if="modes.length > 1" v-model="pendingModeId" class="ws-mode-group">
                <el-radio
                  v-for="m in modes"
                  :key="m.id"
                  :value="m.id"
                  :disabled="!isCodegenSupported(m)"
                  border
                >
                  {{ m.label }}
                  <el-tag v-if="!isCodegenSupported(m)" size="small" type="info" class="ws-mode-tag">待支持</el-tag>
                </el-radio>
              </el-radio-group>
              <div v-else class="ws-mode-single">
                <strong>{{ modes[0].label }}</strong>
              </div>
              <p v-if="modes.length > 1" class="ws-mode-hint">
                HAL 已支持但代码生成器尚未实现的 mode 标记为「待支持」，激活后暂无法导出对应代码。
              </p>
            </template>
            <p v-else class="ws-mode-hint">该外设没有可选的 mode，直接 Activate 即可。</p>
            <el-button type="primary" :disabled="!canActivate" :loading="activating" @click="activateNow">
              Activate
            </el-button>
          </div>
        </div>

        <!-- 已激活配置主体（未激活时保持挂载以便调用 activate） -->
        <div v-show="active" class="ws-config">
          <PeripheralConfigCard ref="cardRef" :id="id" workspace />
        </div>
      </template>

      <!-- 仅展示实例（定时器等）：复用卡片内的 DisplaySignals 表格 -->
      <PeripheralConfigCard v-else :id="id" workspace />
    </div>

    <!-- Deactivate 确认：明确告知会释放引脚（params / mode 保留） -->
    <el-dialog v-model="showDeactivate" :title="`Deactivate ${id}`" width="460px">
      <p class="ws-dialog-text">
        停用后将释放该外设已占用的 <strong>{{ pinCount }}</strong> 个引脚（AF / ANALOG 分配）。
        参数与 mode 选择会保留，下次 Activate 时可直接恢复。
      </p>
      <p v-if="pinCount === 0" class="ws-dialog-muted">当前没有已分配的引脚。</p>
      <template #footer>
        <el-button :disabled="releasing" @click="showDeactivate = false">取消</el-button>
        <el-button type="danger" :loading="releasing" @click="confirmDeactivate">Deactivate</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ws-view {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--mx-bg);
}
.ws-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--mx-border);
  background: var(--mx-surface);
}
.ws-head-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ws-head-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
.ws-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--mx-text-secondary);
  font-size: var(--mx-fz-label);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.ws-back:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.ws-title {
  min-width: 0;
}
.ws-category {
  font-size: 11px;
  color: var(--mx-text-muted);
  line-height: 1.2;
}
.ws-name {
  font-size: var(--mx-fz-page-title);
  font-weight: 600;
  color: var(--mx-text);
  line-height: 1.3;
}
.ws-mode-chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--mx-accent);
  background: var(--mx-accent-soft);
  border-radius: 10px;
  padding: 4px 10px;
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
.ws-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 24px;
}
.ws-activation {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ws-mode-panel {
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ws-mode-title {
  font-size: var(--mx-fz-body);
  font-weight: 600;
  color: var(--mx-text);
}
.ws-mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ws-mode-group :deep(.el-radio) {
  margin-right: 0;
}
.ws-mode-tag {
  margin-left: 4px;
}
.ws-mode-single {
  font-size: var(--mx-fz-body);
  color: var(--mx-text-secondary);
}
.ws-mode-hint {
  margin: 0;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  line-height: 1.5;
}
.ws-config {
  max-width: 940px;
}
.ws-dialog-text {
  font-size: var(--mx-fz-body);
  color: var(--mx-text-secondary);
  line-height: 1.6;
  margin: 0 0 8px;
}
.ws-dialog-muted {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
  margin: 0;
}
</style>