<script setup lang="ts">
// NVIC/PFIC 中断配置面板（M3.1）：芯片 IRQ 表 + 使能开关 + 优先级 P0..P15。
// 开关/优先级写 store.setInterrupt，清空写 store.removeInterrupt；
// 代码生成侧由 model/codegen/irq.ts 产出 src/generated/irq.rs。
import { computed, ref } from 'vue'
import { useProjectStore } from '@/controllers/project'
import EmptyState from '../common/EmptyState.vue'

const store = useProjectStore()

/** 搜索关键词：IRQ 名称或编号（H417 有 117 条中断，需要过滤） */
const keyword = ref('')

const irqs = computed(() => [...store.deviceData.interrupts.irqs].sort((a, b) => a.number - b.number))
// 大小写不敏感匹配：H417 数据层为 USBPDWakeUP，PAC 枚举为 USBPDWAKEUP
const byName = computed(() => new Map(store.interrupts.map((x) => [x.irq.toUpperCase(), x])))
const knownNames = computed(() => new Set(irqs.value.map((x) => x.name.toUpperCase())))

const rows = computed(() => {
  const kw = keyword.value.trim().toUpperCase()
  return irqs.value
    .filter((i) => !kw || i.name.toUpperCase().includes(kw) || String(i.number).includes(kw))
    .map((i) => {
      const cfg = byName.value.get(i.name.toUpperCase())
      return { ...i, enabled: cfg?.enabled ?? false, priority: cfg?.priority ?? 0 }
    })
})

const enabledCount = computed(() => store.interrupts.filter((x) => x.enabled).length)
/** 已配置但不在当前芯片中断表内的条目（导入旧工程/换芯片后可能出现，冲突面板会报 error） */
const unknownCount = computed(
  () => store.interrupts.filter((x) => !knownNames.value.has(x.irq.toUpperCase())).length,
)

const priorities = Array.from({ length: 16 }, (_, i) => i)

function toggle(name: string, value: string | number | boolean) {
  const cur = byName.value.get(name)
  // 关闭时保留条目与优先级（enabled=false 不进 irq.rs），便于再次启用
  store.setInterrupt(name, { enabled: value === true, priority: cur?.priority ?? 0 })
}

function setPriority(name: string, priority: number) {
  store.setInterrupt(name, { enabled: true, priority })
}

function clearAll() {
  for (const item of [...store.interrupts]) store.removeInterrupt(item.irq)
}
</script>

<template>
  <div class="nvic-panel">
    <div class="nvic-summary">
      <span>
        已配置 <strong>{{ store.interrupts.length }}</strong> 条中断，启用 <strong>{{ enabledCount }}</strong> 条
      </span>
      <el-button v-if="store.interrupts.length > 0" size="small" text type="danger" @click="clearAll">清空</el-button>
    </div>

    <el-input v-model="keyword" size="small" clearable placeholder="搜索 IRQ 名称或编号" class="nvic-search" />

    <p v-if="unknownCount > 0" class="nvic-warning">
      有 {{ unknownCount }} 条已配置中断不在当前芯片列表（见冲突面板）
    </p>

    <EmptyState v-if="irqs.length === 0" title="无中断数据" description="该芯片数据层未定义中断向量" />

    <div v-else class="nvic-table">
      <div class="nvic-head">
        <span>IRQ</span>
        <span class="col-center">编号</span>
        <span class="col-center">使能</span>
        <span>优先级</span>
      </div>
      <div v-for="row in rows" :key="row.name" class="nvic-row" :class="{ on: row.enabled }" :data-irq="row.name">
        <span class="irq-name" :title="row.name">{{ row.name }}</span>
        <span class="irq-num">{{ row.number }}</span>
        <span class="irq-switch">
          <el-switch
            :model-value="row.enabled"
            size="small"
            @change="(v: string | number | boolean) => toggle(row.name, v)"
          />
        </span>
        <el-select
          class="irq-priority"
          :model-value="row.priority"
          size="small"
          :disabled="!row.enabled"
          @change="(v: number) => setPriority(row.name, v)"
        >
          <el-option v-for="p in priorities" :key="p" :label="`P${p}`" :value="p" />
        </el-select>
      </div>
      <div v-if="rows.length === 0" class="nvic-empty">没有匹配的中断</div>
    </div>
  </div>
</template>

<style scoped>
.nvic-panel {
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nvic-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-secondary);
}
.nvic-summary strong {
  color: var(--mx-accent);
  font-weight: 600;
}
.nvic-search {
  width: 100%;
}
.nvic-warning {
  margin: 0;
  font-size: 11px;
  color: var(--mx-warning);
}
.nvic-table {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-button);
  overflow-y: auto;
  max-height: 340px;
}
.nvic-head,
.nvic-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px 48px 84px;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
}
.nvic-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f7f9fc;
  border-bottom: 1px solid var(--mx-border);
  font-size: 11px;
  color: var(--mx-text-muted);
}
.nvic-row {
  border-bottom: 1px solid #f0f3f8;
  font-size: var(--mx-fz-label);
}
.nvic-row:last-child {
  border-bottom: none;
}
.nvic-row.on {
  background: var(--mx-accent-soft);
}
.col-center {
  text-align: center;
}
.irq-name {
  font-family: var(--mx-font-mono);
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.irq-num {
  font-family: var(--mx-font-mono);
  font-size: 11px;
  color: var(--mx-text-muted);
  text-align: center;
}
.irq-switch {
  display: flex;
  justify-content: center;
}
.irq-priority {
  width: 100%;
}
.nvic-empty {
  padding: 16px;
  text-align: center;
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
</style>