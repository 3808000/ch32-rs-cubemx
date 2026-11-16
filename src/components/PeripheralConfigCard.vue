<script lang="ts">
// 供 PeripheralsView / QuickMenu / 单测使用的公共常量与激活分配推导：
// - 卡片 DOM id（QuickMenu scrollIntoView 定位用）
// - 折叠状态注入键（Collapse all / Expand all 跨组件控制卡片分区）
// - planActivationPins：Activate 时按 remap 档推导核心 AF 引脚
import type { InjectionKey } from 'vue'

export const PERIPHERAL_COLLAPSE_KEY: InjectionKey<Record<string, boolean>> = Symbol('peripheral-collapse')

export const cardDomId = (id: string): string => `peri-card-${id}`

export type PeriKind = 'usart' | 'spi' | 'i2c' | 'adc'

// 各类别的核心角色（remap 摘要、激活自动分配与引脚状态行均以此为基准）
export const CORE_ROLES: Record<PeriKind, string[]> = {
  usart: ['tx', 'rx'],
  spi: ['sck', 'mosi', 'miso'],
  i2c: ['scl', 'sda'],
  adc: [],
}

export interface ActivationPin {
  role: string
  pin: string
  signal: string
}

/**
 * 激活外设时按当前 remap 档推导待分配的核心 AF 引脚（ADC 不自动分配）。
 * 纯函数，便于单测；实际写入仍由调用方逐个走覆盖确认。
 */
export function planActivationPins(kind: PeriKind, id: string, roles: Record<string, string>): ActivationPin[] {
  if (kind === 'adc') return []
  const out: ActivationPin[] = []
  for (const role of CORE_ROLES[kind]) {
    const pin = roles[role]
    if (pin) out.push({ role, pin, signal: `${id}_${role.toUpperCase()}` })
  }
  return out
}
</script>

<script setup lang="ts">
// 外设配置卡片（§8.6）：分类小标题 + 名称 + 状态徽标 + Activate/Deactivate 链接；
// Parameter Settings 按数据层 params spec 渲染；remap 下拉切换时重分配 AF 引脚（走覆盖确认）；
// 引脚分配状态行缺失标黄；启用但缺引脚时显示 store.conflicts 中该外设的警告。
// 参数表单 / remap 与引脚状态 / ADC 通道 / 仅展示表格 / 冲突列表拆分到 components/peripherals/ 子组件，
// 本组件仅负责实例查找、启用状态、remap 切换与卡片公共骨架。
import { computed, inject } from 'vue'
import type { AdcChannel, ParamSpec } from '@/model/types'
import { useProjectStore } from '@/controllers/project'
import { usePinOverwrite } from '@/model/pins/pinOverwrite'
import { derivePeripheralUsage } from '@/model/peripherals'
import Card from '@/components/common/Card.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import ParamSettings from '@/components/peripherals/ParamSettings.vue'
import PinRemapPanel from '@/components/peripherals/PinRemapPanel.vue'
import AdcParams from '@/components/peripherals/AdcParams.vue'
import DisplaySignals from '@/components/peripherals/DisplaySignals.vue'
import ConflictList from '@/components/peripherals/ConflictList.vue'
import type { AdcChannelRow, DisplaySignalRow, PinStatusRow, RemapOption } from '@/components/peripherals/types'

interface RoleMap {
  remap: number
  roles: Record<string, string> // role → pin
}

interface InstanceInfo {
  id: string
  kind: PeriKind
  categoryLabel: string
  remaps: RoleMap[]
  params: Record<string, ParamSpec>
  channels: AdcChannel[]
}

const KIND_CATEGORY_LABEL: Record<PeriKind, string> = {
  usart: 'Connectivity',
  spi: 'Connectivity',
  i2c: 'Connectivity',
  adc: 'Analog',
}

const props = defineProps<{ id: string }>()

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite(store)

// ---- 实例查找（数据驱动） ----
const ROLE_KEYS: Record<PeriKind, string[]> = {
  usart: ['tx', 'rx', 'cts', 'rts', 'ck'],
  spi: ['sck', 'mosi', 'miso', 'nss'],
  i2c: ['scl', 'sda'],
  adc: [],
}

// 把数据层的 remap 行（接口类型，无索引签名）规整为 role → pin 映射
function rolesOf(entry: object, keys: string[]): Record<string, string> {
  const rec = entry as Record<string, string | undefined>
  const out: Record<string, string> = {}
  for (const k of keys) if (rec[k]) out[k] = rec[k]
  return out
}

const instance = computed<InstanceInfo | null>(() => {
  const p = store.deviceData.peripherals
  const u = p.usart.find((i) => i.id === props.id)
  if (u) return { id: u.id, kind: 'usart', categoryLabel: KIND_CATEGORY_LABEL.usart, remaps: u.remaps.map((r) => ({ remap: r.remap, roles: rolesOf(r, ROLE_KEYS.usart) })), params: u.params, channels: [] }
  const s = p.spi.find((i) => i.id === props.id)
  if (s) return { id: s.id, kind: 'spi', categoryLabel: KIND_CATEGORY_LABEL.spi, remaps: s.remaps.map((r) => ({ remap: r.remap, roles: rolesOf(r, ROLE_KEYS.spi) })), params: s.params, channels: [] }
  const i2 = p.i2c.find((i) => i.id === props.id)
  if (i2) return { id: i2.id, kind: 'i2c', categoryLabel: KIND_CATEGORY_LABEL.i2c, remaps: i2.remaps.map((r) => ({ remap: r.remap, roles: rolesOf(r, ROLE_KEYS.i2c) })), params: i2.params, channels: [] }
  const a = p.adc.find((i) => i.id === props.id)
  if (a) return { id: a.id, kind: 'adc', categoryLabel: KIND_CATEGORY_LABEL.adc, remaps: [], params: a.params, channels: a.channels }
  return null
})

// ---- 使用推导 ----
const usage = computed(() => derivePeripheralUsage(store.config, store.deviceData).find((u) => u.id === props.id))

// ---- remap 选项（摘要形如 `remap 0: TX=PD5 RX=PD6`） ----
const remapOptions = computed<RemapOption[]>(() => {
  const inst = instance.value
  if (!inst || inst.kind === 'adc') return []
  return inst.remaps.map((r) => {
    const core = CORE_ROLES[inst.kind]
    const summary = core.filter((role) => r.roles[role]).map((role) => `${role.toUpperCase()}=${r.roles[role]}`).join(' ')
    const extra = Object.keys(r.roles).length > core.length ? ' …' : ''
    return { value: r.remap, label: `remap ${r.remap}: ${summary}${extra}` }
  })
})

// ---- 引脚分配状态行（缺失标黄） ----
const pinStatus = computed<PinStatusRow[]>(() => {
  const inst = instance.value
  const u = usage.value
  if (!inst || !u) return []
  if (inst.kind === 'adc') {
    return u.pins.map((p) => ({ label: p.role, pin: p.pin, ok: true }))
  }
  const core = CORE_ROLES[inst.kind]
  const assigned = new Map(u.pins.map((p) => [p.role, p.pin]))
  const rows: PinStatusRow[] = core.map((role) => ({ label: role.toUpperCase(), pin: assigned.get(role) ?? null, ok: assigned.has(role) }))
  for (const p of u.pins) {
    if (!core.includes(p.role)) rows.push({ label: p.role.toUpperCase(), pin: p.pin, ok: true })
  }
  return rows
})

// ---- ADC 通道分配状态 ----
const adcStatus = computed<AdcChannelRow[]>(() => {
  const inst = instance.value
  if (!inst || inst.kind !== 'adc') return []
  return inst.channels.map((ch) => {
    const a = store.assignments.find((x) => x.mode === 'ANALOG' && x.function === ch.channel)
    return { channel: ch.channel, pin: ch.pin, assignedPin: a?.pin ?? null }
  })
})

// ---- 该外设的冲突（启用但缺引脚等） ----
const peripheralConflicts = computed(() => store.conflicts.filter((c) => c.peripheral === props.id))

// ---- 仅展示模式（定时器等，从 remap 数据推导信号映射） ----
const displaySignals = computed<DisplaySignalRow[]>(() => {
  if (instance.value) return []
  const prefix = `${props.id}_`
  const map = new Map<string, { pin: string; remap: number }[]>()
  for (const e of store.deviceData.remap.entries) {
    if (!e.signal.startsWith(prefix)) continue
    const arr = map.get(e.signal) ?? []
    arr.push({ pin: e.pin, remap: e.remap })
    map.set(e.signal, arr)
  }
  return [...map.entries()].map(([signal, list]) => ({ signal, list }))
})

// ---- 参数表 ----
const paramEntries = computed(() => Object.entries(instance.value?.params ?? {}))

// ---- 折叠状态（受 PeripheralsView 的 Collapse all / Expand all 控制） ----
const collapseStates = inject(PERIPHERAL_COLLAPSE_KEY, null)
const paramsOpen = computed({
  get: () => collapseStates?.[`${props.id}:params`] ?? true,
  set: (v: boolean) => {
    if (collapseStates) collapseStates[`${props.id}:params`] = v
  },
})
const pinsOpen = computed({
  get: () => collapseStates?.[`${props.id}:pins`] ?? true,
  set: (v: boolean) => {
    if (collapseStates) collapseStates[`${props.id}:pins`] = v
  },
})

// ---- 动作 ----
/** 激活：按当前 remap 档自动分配核心 AF 引脚（对齐 MX2）；取消某引脚覆盖只跳过该引脚。 */
async function setActive(active: boolean) {
  const u = usage.value
  if (!u) return
  if (active) {
    const inst = instance.value
    if (!inst) return
    // ADC 无可自动分配的核心 AF 角色：保持仅启用
    if (inst.kind === 'adc' || inst.remaps.length === 0) {
      store.setPeripheralEnabled(props.id, true)
      return
    }
    // 当前推导 remap 档优先；数据缺档时回退实例第一档
    const target = inst.remaps.find((r) => r.remap === u.remap) ?? inst.remaps[0]
    const targets = planActivationPins(inst.kind, inst.id, target.roles)
    const unassigned: string[] = []
    for (const t of targets) {
      const ok = await requestOverwrite(
        t.pin,
        () => store.setPinAssignment(t.pin, 'AF', { function: t.signal, remap: target.remap }),
        `启用 ${inst.id} 并分配 ${t.signal}（remap ${target.remap}）`,
      )
      // 用户取消仅跳过当前引脚，不回滚其它已分配引脚
      if (!ok) unassigned.push(t.pin)
    }
    // 保持启用并锁定 remap 档；未分配引脚交由冲突面板给出缺失警告
    store.setPeripheral(inst.id, { enabled: true, params: { ...u.params }, remap: target.remap })
    if (unassigned.length) {
      store.notify(`${inst.id} 已启用，但 ${unassigned.join('、')} 的覆盖被取消，对应引脚未分配`, 'warning')
    }
    return
  }
  const pins = u.pins
  store.setPeripheralEnabled(props.id, false)
  // 停用时清除该外设占用的引脚（覆盖已有配置需确认）
  for (const p of pins) {
    await requestOverwrite(p.pin, () => store.clearPin(p.pin), '停用外设')
  }
}

function setParam(key: string, value: string | number | boolean) {
  const u = usage.value
  if (!u) return
  store.setPeripheral(props.id, {
    enabled: u.enabled,
    params: { ...u.params, [key]: value },
    remap: instance.value?.kind === 'adc' ? undefined : (u.remap ?? undefined),
  })
}

/** 切换 remap 档：核心角色引脚重分配为 AF（覆盖确认），旧档不再使用的引脚清除。 */
async function switchRemap(target: number) {
  const inst = instance.value
  const u = usage.value
  if (!inst || !u) return
  const entry = inst.remaps.find((r) => r.remap === target)
  if (!entry) return
  const core = CORE_ROLES[inst.kind]
  const targets = core.filter((role) => entry.roles[role]).map((role) => ({ role, pin: entry.roles[role] }))
  const newPinSet = new Set(targets.map((t) => t.pin))
  const oldPins = u.pins.filter((p) => core.includes(p.role) && !newPinSet.has(p.pin)).map((p) => p.pin)

  for (const t of targets) {
    const signal = `${inst.id}_${t.role.toUpperCase()}`
    const ok = await requestOverwrite(
      t.pin,
      () => store.setPinAssignment(t.pin, 'AF', { function: signal, remap: target }),
      `重分配为 ${signal}（remap ${target}）`,
    )
    if (!ok) return // 用户取消则中止切换
  }
  for (const p of oldPins) {
    await requestOverwrite(p, () => store.clearPin(p), '切换 remap')
  }
  store.setPeripheral(inst.id, { enabled: true, params: { ...u.params }, remap: target })
}
</script>

<template>
  <Card :id="cardDomId(id)" class="peri-card">
    <!-- 卡片头：分类小标题 + 名称 + 状态徽标 + Activate/Deactivate 链接 -->
    <div class="pc-head">
      <div class="pc-title">
        <div class="pc-category">{{ instance ? instance.categoryLabel : 'Timers' }}</div>
        <div class="pc-name">{{ id }}</div>
      </div>
      <div class="pc-head-right">
        <template v-if="instance">
          <StatusBadge :active="usage?.enabled ?? false" />
          <a class="pc-toggle" @click.prevent="setActive(!usage?.enabled)">{{ usage?.enabled ? 'Deactivate' : 'Activate' }}</a>
        </template>
        <StatusBadge v-else :active="false" inactive-text="Display" />
      </div>
    </div>

    <template v-if="instance && usage">
      <!-- 未激活：蓝色信息条 + 参数置灰 -->
      <el-alert
        v-if="!usage.enabled"
        type="info"
        :closable="false"
        class="pc-info"
        title="Peripheral Not Configured"
        description="点击右上角 Activate 启用后可配置参数与引脚。"
      />

      <div class="pc-body" :class="{ disabled: !usage.enabled }">
        <!-- Parameter Settings -->
        <ParamSettings v-model:open="paramsOpen" :entries="paramEntries" :params="usage.params" :disabled="!usage.enabled" @change="setParam" />

        <!-- Remap / 引脚分配（Connectivity） -->
        <PinRemapPanel
          v-if="instance.kind !== 'adc'"
          v-model:open="pinsOpen"
          :options="remapOptions"
          :remap="usage.remap"
          :rows="pinStatus"
          :disabled="!usage.enabled"
          @remap-change="switchRemap"
        />

        <!-- ADC 通道状态 -->
        <AdcParams v-else v-model:open="pinsOpen" :rows="adcStatus" />
      </div>

      <!-- 启用但缺引脚等冲突警告 -->
      <ConflictList v-if="usage.enabled && peripheralConflicts.length" :conflicts="peripheralConflicts" />
    </template>

    <!-- 仅展示（定时器等）：remap 数据推导的信号映射表 -->
    <DisplaySignals v-else :rows="displaySignals" />
  </Card>
</template>

<style scoped>
.peri-card {
  padding: 0;
}
.pc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
}
.pc-category {
  font-size: var(--mx-fz-label);
  color: var(--mx-text-muted);
}
.pc-name {
  font-size: var(--mx-fz-card-title);
  font-weight: 600;
  color: var(--mx-text);
  margin-top: 1px;
}
.pc-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pc-toggle {
  font-size: var(--mx-fz-label);
  color: var(--mx-accent);
  cursor: pointer;
}
.pc-toggle:hover {
  text-decoration: underline;
}
.pc-info {
  margin: 0 16px 8px;
}
.pc-body {
  padding: 0 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pc-body.disabled {
  opacity: 0.55;
  pointer-events: none;
}
</style>