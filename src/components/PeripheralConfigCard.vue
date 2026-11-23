<script lang="ts">
// 供 PeripheralsView / QuickMenu / 单测使用的公共常量与激活分配推导：
// - 卡片 DOM id（QuickMenu scrollIntoView 定位用）
// - 折叠状态注入键（Collapse all / Expand all 跨组件控制卡片分区）
// - planActivationPins：Activate 时按 remap 档 + mode 引脚需求推导核心 AF 引脚
import type { InjectionKey } from 'vue'
import type { PeripheralConfigCardApi } from '@/components/peripherals/instance'

export const PERIPHERAL_COLLAPSE_KEY: InjectionKey<Record<string, boolean>> = Symbol('peripheral-collapse')

export const cardDomId = (id: string): string => `peri-card-${id}`

export type { PeripheralConfigCardApi }
export { CORE_ROLES, planActivationPins } from '@/components/peripherals/instance'
export type { ActivationPin, PeriKind } from '@/components/peripherals/instance'
</script>

<script setup lang="ts">
// 外设配置卡片（§8.6）：分类小标题 + 名称 + 状态徽标 + Activate/Deactivate 链接；
// Parameter Settings 按数据层 params spec + 当前 mode 渲染；remap 下拉切换时重分配 AF 引脚（走覆盖确认）；
// 引脚分配状态行缺失标黄；启用但缺引脚时显示 store.conflicts 中该外设的警告。
// workspace=true 时隐藏卡片头（由 PeripheralWorkspaceView 提供页头），并通过 defineExpose 暴露激活 API。
import { computed, inject } from 'vue'
import { useProjectStore } from '@/controllers/project'
import { usePinOverwrite } from '@/components/pinout/usePinOverwrite'
import { derivePeripheralUsage } from '@/model/peripherals'
import Card from '@/components/common/Card.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import ParamSettings from '@/components/peripherals/ParamSettings.vue'
import PinRemapPanel from '@/components/peripherals/PinRemapPanel.vue'
import AdcParams from '@/components/peripherals/AdcParams.vue'
import DisplaySignals from '@/components/peripherals/DisplaySignals.vue'
import ConflictList from '@/components/peripherals/ConflictList.vue'
import type { AdcChannelRow, DisplaySignalRow, PinStatusRow, RemapOption } from '@/components/peripherals/types'
import {
  CORE_ROLES,
  findPeripheralInstance,
  planActivationPins,
  type InstanceInfo,
} from '@/components/peripherals/instance'
import {
  MODE_PARAM_KEY,
  filterParamsForMode,
  isCodegenSupported,
  rolesForMode,
  selectedMode,
} from '@/components/peripherals/modes'

const props = withDefaults(defineProps<{ id: string; workspace?: boolean }>(), { workspace: false })

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite(store)

// ---- 实例查找（数据驱动） ----
const instance = computed<InstanceInfo | null>(() =>
  findPeripheralInstance(store.deviceData.peripherals, props.id),
)

// ---- 使用推导 ----
const usage = computed(() => derivePeripheralUsage(store.config, store.deviceData).find((u) => u.id === props.id))

// ---- 当前 mode 与参数集 ----
const mode = computed(() => selectedMode(instance.value?.modes ?? [], usage.value?.params))
const modeRoleKeys = computed(() => rolesForMode(mode.value, instance.value ? CORE_ROLES[instance.value.kind] : []))
const codegenBlocked = computed(() => !!mode.value && !isCodegenSupported(mode.value))

// ---- remap 选项（摘要形如 `remap 0: TX=PD5 RX=PD6`） ----
const remapOptions = computed<RemapOption[]>(() => {
  const inst = instance.value
  if (!inst || inst.kind === 'adc') return []
  return inst.remaps.map((r) => {
    const core = modeRoleKeys.value
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
  const core = modeRoleKeys.value
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

// ---- 参数表（按当前 mode 过滤） ----
const paramEntries = computed(() =>
  filterParamsForMode(Object.entries(instance.value?.params ?? {}), mode.value),
)

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
/**
 * 激活：按当前 remap 档 + mode 的核心角色自动分配 AF 引脚（对齐 MX2）；
 * 取消某引脚覆盖只跳过该引脚；旧 mode/旧 remap 遗留、本次不再需要的引脚会被释放。
 */
async function activate(modeId?: string): Promise<void> {
  const inst = instance.value
  const u = usage.value
  if (!inst || !u) return
  const nextMode = modeId ? (inst.modes.find((m) => m.id === modeId) ?? mode.value) : mode.value
  if (nextMode && !isCodegenSupported(nextMode)) {
    store.notify(`${inst.id} 的 ${nextMode.label} mode 已由 HAL 支持，但代码生成尚未实现，暂不能激活`, 'warning')
    return
  }
  const params = { ...u.params }
  if (nextMode) params[MODE_PARAM_KEY] = nextMode.id

  // ADC 无可自动分配的核心 AF 角色：保持仅启用
  if (inst.kind === 'adc' || inst.remaps.length === 0) {
    store.setPeripheral(inst.id, { enabled: true, params })
    return
  }

  // 当前推导 remap 档优先；数据缺档时回退实例第一档
  const target = inst.remaps.find((r) => r.remap === u.remap) ?? inst.remaps[0]
  const roleKeys = rolesForMode(nextMode, CORE_ROLES[inst.kind])
  const targets = planActivationPins(inst.kind, inst.id, target.roles, roleKeys)
  const targetPins = new Set(targets.map((t) => t.pin))
  // 只清理「本 mode 会管理」的核心角色遗留引脚；CTS/RTS/CK/NSS 等可选引脚不在此列
  const managedRoles = new Set([...CORE_ROLES[inst.kind], ...roleKeys])
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
  // 释放该外设遗留但当前 mode/remap 不再使用的核心引脚（例如切换 mode 后残留的 RX）
  for (const p of u.pins) {
    if (targetPins.has(p.pin) || !managedRoles.has(p.role)) continue
    await requestOverwrite(p.pin, () => store.clearPin(p.pin), `启用 ${inst.id} 时释放不再使用的引脚`)
  }
  store.setPeripheral(inst.id, { enabled: true, params, remap: target.remap })
  if (unassigned.length) {
    store.notify(`${inst.id} 已启用，但 ${unassigned.join('、')} 的覆盖被取消，对应引脚未分配`, 'warning')
  }
}

/**
 * 停用。releasePins=true 时释放该外设占用的引脚。
 * confirmEachPin=false 用于工作区：调用方已弹「停用并释放引脚」确认框，避免逐引脚重复确认。
 */
async function deactivate(releasePins = true, confirmEachPin = true): Promise<void> {
  const u = usage.value
  if (!u) return
  const pinList = [...u.pins]
  store.setPeripheralEnabled(props.id, false)
  if (!releasePins) return
  for (const p of pinList) {
    if (confirmEachPin) {
      await requestOverwrite(p.pin, () => store.clearPin(p.pin), '停用外设并释放引脚')
    } else {
      store.clearPin(p.pin)
    }
  }
}

/** 卡片头 Activate/Deactivate 链接（workspace 模式由页头对话框调用 activate/deactivate）。 */
async function setActive(active: boolean): Promise<void> {
  if (active) {
    await activate()
    return
  }
  await deactivate(true)
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
  const core = modeRoleKeys.value
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

defineExpose({ activate, deactivate, setActive })
</script>

<template>
  <Card :id="cardDomId(id)" class="peri-card" :class="{ 'is-workspace': workspace }">
    <!-- 卡片头：分类小标题 + 名称 + 状态徽标 + Activate/Deactivate 链接（workspace 由页头替代） -->
    <div v-if="!workspace" class="pc-head">
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
      <!-- 未激活：蓝色信息条 + 参数置灰（workspace 模式由页头/模式选择面板替代） -->
      <el-alert
        v-if="!usage.enabled && !workspace"
        type="info"
        :closable="false"
        class="pc-info"
        title="Peripheral Not Configured"
        description="点击右上角 Activate 启用后可配置参数与引脚。"
      />

      <div class="pc-body" :class="{ disabled: !usage.enabled }">
        <!-- 当前 mode 与代码生成能力提示 -->
        <div v-if="mode && workspace" class="pc-mode-line">
          <span class="pc-mode-label">Mode</span>
          <span class="pc-mode-value">{{ mode.label }}</span>
          <el-tag v-if="codegenBlocked" size="small" type="warning">代码生成待支持</el-tag>
        </div>

        <!-- Parameter Settings（按 mode 过滤参数） -->
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
.peri-card.is-workspace {
  box-shadow: none;
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
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pc-body.disabled {
  opacity: 0.55;
  pointer-events: none;
}
.pc-mode-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mx-fz-label);
}
.pc-mode-label {
  color: var(--mx-text-muted);
}
.pc-mode-value {
  font-weight: 600;
  color: var(--mx-text);
}
</style>