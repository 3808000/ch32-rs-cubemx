<script setup lang="ts">
// DMA 通道分配面板（M3.2）：按已启用 USART/SPI/I2C 的 TX/RX 请求列出通道分配。
// 通道语义完全来自数据层 dma.json：
//  - model=fixed：请求硬件固定在某个 DMA1_CHn（下拉只有该通道，不可改道）；
//  - model=dmamux：requests[].channel 是 DMAMUX 请求号，物理通道可任选（H4 16 通道）；
//    显式选择写 store.setDma，恢复自动写 store.removeDma（自动占用最低空闲通道）。
import { computed } from 'vue'
import { Connection } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { derivePeripheralUsage } from '@/model/peripherals'
import { buildDmaPlan, dmaChannelsOf, dmaModelOf, dmaRequestOf } from '@/model/codegen/derive'
import type { DmaAssignment } from '@/model/codegen/derive'
import EmptyState from '../common/EmptyState.vue'

const store = useProjectStore()

const model = computed(() => dmaModelOf(store.deviceData))
const channels = computed(() => dmaChannelsOf(store.deviceData))
const usages = computed(() => derivePeripheralUsage(store.config, store.deviceData))
/** 数据层是否提供了 DMA 请求映射；没有时面板只提示「待核实」，不生成任何通道配置。 */
const hasDmaRequests = computed(() => (store.deviceData.dma?.requests.length ?? 0) > 0)
const modelLabel = computed(() =>
  !hasDmaRequests.value ? '无 DMA 数据' : model.value === 'dmamux' ? 'DMAMUX 请求路由' : '固定通道',
)
const modelHint = computed(() => {
  if (!hasDmaRequests.value) return '数据层未提供该芯片的 DMA 请求映射（待核实），无法生成 DMA 配置。'
  return model.value === 'dmamux'
    ? '请求号由数据层固定，物理通道可任选；未手选的请求自动占用最低空闲通道。'
    : '通道由芯片硬件固定，不可改道；下拉值来自 dma.json。'
})

interface DmaRow {
  request: string
  instance: string
  role: 'TX' | 'RX'
  assignment: DmaAssignment | null
  /** 数据层固定的通道号（fixed）或 DMAMUX 请求号（dmamux） */
  requestNumber?: number
  /** 工程配置里显式写入的通道号；undefined = 未显式配置 */
  explicitChannel?: number
  issue: string | null
  duplicate: boolean
}

const rows = computed<DmaRow[]>(() => {
  const plan = buildDmaPlan(store.config, store.deviceData, usages.value)
  const out: DmaRow[] = []
  for (const u of usages.value) {
    if (!u.enabled || u.category === 'adc') continue
    for (const role of ['TX', 'RX'] as const) {
      const request = `${u.id}_${role}`
      const entry = dmaRequestOf(store.deviceData, request)
      const explicit = (store.dma ?? []).find((e) => e.peripheral === request)
      const issues: string[] = []
      if (!store.deviceData.dma) issues.push('数据层缺少 dma.json')
      else if (!entry) issues.push('dma.json 缺少该请求映射（待核实）')
      if (explicit) {
        if (model.value === 'fixed' && entry && explicit.channel !== entry.channel) {
          issues.push(`该请求固定使用通道 ${entry.channel}，配置值 ${explicit.channel} 无效`)
        } else if (model.value === 'dmamux' && !channels.value.some((c) => c.number === explicit.channel)) {
          issues.push(`通道 ${explicit.channel} 不在 dma.json channels 中`)
        }
      }
      if (entry && !plan.get(request)) {
        issues.push(model.value === 'dmamux' ? '无空闲 DMA 通道（物理通道已用尽）' : 'dma.json channels 缺少该固定通道')
      }
      out.push({
        request,
        instance: u.id,
        role,
        assignment: plan.get(request) ?? null,
        requestNumber: entry?.channel,
        explicitChannel: explicit?.channel,
        issue: issues.length > 0 ? issues.join('；') : null,
        duplicate: false,
      })
    }
  }
  // 通道重复：fixed 芯片可能由硬件映射天然冲突（如 USART1_TX 与 SPI2_RX）；
  // dmamux 芯片只有显式配置才可能重复，自动分配不会。
  const users = new Map<string, number>()
  for (const row of out) {
    if (!row.assignment) continue
    users.set(row.assignment.channelPeripheral, (users.get(row.assignment.channelPeripheral) ?? 0) + 1)
  }
  for (const row of out) {
    if (row.assignment && (users.get(row.assignment.channelPeripheral) ?? 0) > 1) row.duplicate = true
  }
  // dmamux 显式配置重复：buildDmaPlan 会把后一个请求改为自动分配（不生成错误代码），
  // 但工程配置本身冲突；这里提示，导出前由 dmaRules 阻止。
  if (model.value === 'dmamux') {
    const explicitUsers = new Map<number, DmaRow[]>()
    for (const row of out) {
      if (row.explicitChannel === undefined) continue
      if (!channels.value.some((c) => c.number === row.explicitChannel)) continue
      const group = explicitUsers.get(row.explicitChannel) ?? []
      group.push(row)
      explicitUsers.set(row.explicitChannel, group)
    }
    for (const [channel, group] of explicitUsers) {
      if (group.length < 2) continue
      for (const row of group) {
        const msg = `显式通道 ${channel} 被多个请求重复填写`
        row.issue = row.issue ? `${row.issue}；${msg}` : msg
      }
    }
  }
  return out
})

const issueCount = computed(() => rows.value.filter((r) => r.issue !== null || r.duplicate).length)

/** 可选的固定通道（fixed 芯片只有一个合法通道；无映射数据时为空）。 */
function fixedOptions(row: DmaRow) {
  return row.assignment ? [{ number: row.assignment.channel, name: row.assignment.channelPeripheral }] : []
}

/** dmamux 手选通道：写入显式分配（request 号来自 dma.json，作为配置快照）。 */
function setChannel(row: DmaRow, value: string | number) {
  const channel = Number(value)
  if (!Number.isInteger(channel)) return
  store.setDma({
    peripheral: row.request,
    channel,
    // request 字段只对 DMAMUX 芯片有意义（固定通道芯片由数据层决定请求映射）
    ...(model.value === 'dmamux' && row.requestNumber !== undefined ? { request: row.requestNumber } : {}),
  })
}

/** fixed 芯片：把数据层固定通道记录到工程配置（不改变生成结果，仅用于显式校验/导出）。 */
function applyFixed(row: DmaRow) {
  const ch = row.assignment?.channel
  if (ch === undefined) return
  store.setDma({ peripheral: row.request, channel: ch })
}

/** 移除显式配置：dmamux 回到自动分配，fixed 回到数据层默认。 */
function clear(row: DmaRow) {
  store.removeDma(row.request)
}

function autoAll() {
  for (const row of rows.value) store.removeDma(row.request)
}
</script>

<template>
  <div class="dma-panel">
    <div class="dma-head">
      <div class="dma-head-main">
        <span class="dma-model">{{ modelLabel }}</span>
        <span class="dma-hint">{{ modelHint }}</span>
      </div>
      <el-button v-if="model === 'dmamux' && rows.length > 0" size="small" @click="autoAll">全部恢复自动</el-button>
    </div>

    <el-alert
      v-if="issueCount > 0"
      class="dma-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`${issueCount} 条 DMA 分配需要处理：通道重复或不合法（导出会被阻止）`"
    />

    <div v-if="!store.features.embassy" class="dma-note">当前未启用 embassy：DMA 分配只在异步外设代码生成时生效。</div>

    <div v-for="row in rows" :key="row.request" class="dma-row" :class="{ bad: row.issue !== null || row.duplicate }">
      <div class="dma-req">
        <span class="dma-name">{{ row.request }}</span>
        <span class="dma-role">{{ row.instance }} · {{ row.role }}</span>
      </div>
      <div class="dma-ctrl">
        <el-select
          :model-value="row.assignment?.channel ?? ''"
          size="small"
          class="dma-channel-select"
          :disabled="model === 'fixed' || (!row.assignment && !row.explicitChannel)"
          @change="(v: string | number) => setChannel(row, v)"
        >
          <el-option
            v-for="c in model === 'fixed' ? fixedOptions(row) : channels"
            :key="c.number"
            :label="model === 'fixed' ? c.name : `${c.name}（通道 ${c.number}）`"
            :value="c.number"
          />
        </el-select>
        <span v-if="model === 'dmamux'" class="dma-reqno">请求 #{{ row.requestNumber ?? '?' }}</span>
        <span v-else class="dma-reqno">DMA 通道 {{ row.assignment?.channel ?? '?' }}</span>
        <el-tag v-if="model === 'fixed'" size="small" :type="row.explicitChannel ? 'success' : 'info'">
          {{ row.explicitChannel ? '已记录' : '数据层固定' }}
        </el-tag>
        <el-tag v-else size="small" :type="row.explicitChannel ? 'success' : 'info'">
          {{ row.explicitChannel ? '手动分配' : '自动分配' }}
        </el-tag>
        <el-button v-if="model === 'fixed'" size="small" :disabled="!!row.explicitChannel" @click="applyFixed(row)">
          记录
        </el-button>
        <el-button size="small" :disabled="!row.explicitChannel" @click="clear(row)">清除</el-button>
      </div>
      <div v-if="row.issue" class="dma-issue">{{ row.issue }}</div>
      <div v-else-if="row.duplicate" class="dma-issue">通道 {{ row.assignment?.channelPeripheral }} 被多个请求占用</div>
    </div>

    <EmptyState
      v-if="rows.length === 0"
      :icon="Connection"
      title="无可分配的 DMA 请求"
      :description="
        hasDmaRequests
          ? '先在 Peripherals 中启用 USART / SPI / I2C 实例，TX/RX 请求会出现在这里'
          : '该芯片数据层未提供 DMA 请求映射（待核实）'
      "
    />
  </div>
</template>

<style scoped>
.dma-panel {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dma-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.dma-head-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.dma-model {
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-accent);
}
.dma-hint {
  font-size: 11px;
  color: var(--mx-text-muted);
  line-height: 1.5;
}
.dma-note {
  font-size: 11px;
  color: var(--mx-warning);
}
.dma-alert {
  padding: 6px 10px;
}
.dma-row {
  border: 1px solid var(--mx-border);
  border-radius: var(--mx-radius-button);
  padding: 6px 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dma-row.bad {
  border-color: var(--mx-warning);
  background: #fff8ec;
}
.dma-req {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 130px;
}
.dma-name {
  font-family: var(--mx-font-mono);
  font-size: var(--mx-fz-label);
  font-weight: 600;
  color: var(--mx-text);
}
.dma-role {
  font-size: 11px;
  color: var(--mx-text-muted);
}
.dma-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dma-channel-select {
  width: 190px;
}
.dma-reqno {
  font-size: 11px;
  color: var(--mx-text-muted);
  font-family: var(--mx-font-mono);
}
.dma-issue {
  width: 100%;
  font-size: 11px;
  color: var(--mx-warning);
}
</style>