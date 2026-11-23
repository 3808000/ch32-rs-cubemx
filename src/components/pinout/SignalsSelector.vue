<script lang="ts">
// 信号选择器纯函数层（M4.7/M8）：分组构建 + 搜索过滤。
// 放在独立 script 块中导出，供组件与测试共用；不依赖 store / UI。
import { peripheralOfSignal, remapValuesFor, remapsOfPin } from '@/model/device'
import type { ChipPin, DeviceData, PinAssignment, PinMode } from '@/model/types'

/** 条目类别：GPIO / 复用功能 / 模拟通道 / 用户保留。 */
export type SignalKind = 'gpio' | 'af' | 'analog' | 'reserved'

/** 信号清单中的单个可选项（同信号的多 remap 档各自独立）。 */
export interface SignalEntry {
  /** 稳定唯一键（kind + 信号 + remap） */
  key: string
  kind: SignalKind
  /** 所属分组 id */
  group: string
  /** 主文本：GPIO 输入 / USART1_TX / ADC_IN0 / Reserved（用户保留） */
  label: string
  /** 副文本：remap 档位等 */
  detail?: string
  /** AF / ANALOG 的信号名（GPIO/Reserved 为空） */
  signal?: string
  /** AF 的 remap 值 */
  remap?: number
  /** 点击后写入的模式 */
  mode: PinMode
  /** 预拼接的小写搜索文本（信号名 / 外设名 / 引脚别名 / remap） */
  searchText: string
  /** 是否为当前 assignment（高亮「当前」徽标） */
  current: boolean
}

export interface SignalGroup {
  id: string
  label: string
  entries: SignalEntry[]
}

function joinSearch(parts: (string | number | undefined | null)[]): string {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join(' ')
    .toLowerCase()
}

/** 引脚搜索基础词：引脚名 + 数据层别名。 */
function pinWords(pin: ChipPin): string[] {
  return [pin.name, ...(pin.aliases ?? [])]
}

/** ADC 通道的自然排序（ADC_IN2 在 ADC_IN10 之前）。 */
function channelOrder(channel: string): number {
  const m = /(\d+)\s*$/.exec(channel)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

/**
 * 构建某引脚的完整信号分组（确定性排序）：
 * GPIO → Alternate Function（按外设实例 id 字母序，条目按信号名 + remap 升序）→ Analog → Reserved。
 */
export function buildSignalGroups(
  pin: ChipPin,
  data: DeviceData,
  assignment?: PinAssignment,
): SignalGroup[] {
  const words = pinWords(pin)
  const groups: SignalGroup[] = []

  // ---- GPIO：INPUT / OUTPUT 两个入口 ----
  groups.push({
    id: 'gpio',
    label: 'GPIO',
    entries: [
      {
        key: 'gpio:INPUT',
        kind: 'gpio',
        group: 'gpio',
        label: 'GPIO 输入',
        detail: 'INPUT',
        mode: 'INPUT',
        searchText: joinSearch(['GPIO 输入', 'input', 'gpio', ...words]),
        current: assignment?.mode === 'INPUT',
      },
      {
        key: 'gpio:OUTPUT',
        kind: 'gpio',
        group: 'gpio',
        label: 'GPIO 输出',
        detail: 'OUTPUT',
        mode: 'OUTPUT',
        searchText: joinSearch(['GPIO 输出', 'output', 'gpio', ...words]),
        current: assignment?.mode === 'OUTPUT',
      },
    ],
  })

  // ---- Alternate Function：remapsOfPin 的全部 (signal, remap) 按外设实例分组 ----
  const afGroups = new Map<string, SignalEntry[]>()
  const seenAf = new Set<string>()
  for (const entry of remapsOfPin(data, pin.name)) {
    const key = `${entry.signal}#${entry.remap}`
    if (seenAf.has(key)) continue
    seenAf.add(key)
    const groupId = peripheralOfSignal(entry.signal) ?? 'AF'
    // 当前档：显式 remap 优先；未指定时视作该信号的最小 remap 档
    const values = [...remapValuesFor(data, pin.name, entry.signal)].sort((a, b) => a - b)
    const currentRemap = assignment?.remap ?? values[0]
    const current =
      assignment?.mode === 'AF' && assignment.function === entry.signal && currentRemap === entry.remap
    const entries = afGroups.get(groupId) ?? []
    entries.push({
      key: `af:${key}`,
      kind: 'af',
      group: groupId,
      label: entry.signal,
      detail: `remap ${entry.remap}`,
      signal: entry.signal,
      remap: entry.remap,
      mode: 'AF',
      searchText: joinSearch([entry.signal, groupId, `remap ${entry.remap}`, ...words]),
      current,
    })
    afGroups.set(groupId, entries)
  }
  for (const [id, entries] of [...afGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.sort((a, b) => {
      const bySignal = (a.signal ?? '').localeCompare(b.signal ?? '')
      return bySignal !== 0 ? bySignal : (a.remap ?? 0) - (b.remap ?? 0)
    })
    groups.push({ id, label: id, entries })
  }

  // ---- Analog：引脚支持的 ADC 通道 ----
  const channels = [...new Set(pin.adc ?? [])].sort(
    (a, b) => channelOrder(a) - channelOrder(b) || a.localeCompare(b),
  )
  if (channels.length > 0) {
    groups.push({
      id: 'analog',
      label: 'Analog',
      entries: channels.map((channel) => ({
        key: `analog:${channel}`,
        kind: 'analog' as const,
        group: 'analog',
        label: channel,
        detail: 'ANALOG',
        signal: channel,
        mode: 'ANALOG' as const,
        searchText: joinSearch([channel, 'analog', 'adc', ...words]),
        current: assignment?.mode === 'ANALOG' && assignment.function === channel,
      })),
    })
  }

  // ---- Reserved：用户保留（不做电气配置、生成器跳过、外设占用报冲突） ----
  groups.push({
    id: 'reserved',
    label: 'Reserved',
    entries: [
      {
        key: 'reserved:RESERVED',
        kind: 'reserved',
        group: 'reserved',
        label: 'Reserved（用户保留）',
        detail: '生成器跳过',
        mode: 'RESERVED',
        searchText: joinSearch(['reserved', '保留', ...words]),
        current: assignment?.mode === 'RESERVED',
      },
    ],
  })

  return groups
}

/** 按搜索词过滤分组（大小写不敏感；空查询返回全量；空分组剔除）。 */
export function filterSignalGroups(groups: SignalGroup[], query: string): SignalGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, entries: g.entries.filter((e) => e.searchText.includes(q)) }))
    .filter((g) => g.entries.length > 0)
}
</script>

<script setup lang="ts">
// 信号选择器（M4.7/M8）：搜索 + 分组（GPIO / AF 多 remap 档 / Analog / Reserved）。
// 点击条目经 usePinOverwrite 覆盖确认后写入 store；分配完成即关闭。
import { computed, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { usePinOverwrite } from '@/components/pinout/usePinOverwrite'
// 类型 import 在普通 <script> 块（模块作用域），setup 函数可直接引用，避免重复标识符。

const props = defineProps<{
  pin: ChipPin
  assignment?: PinAssignment
  data: DeviceData
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite(store)

const open = ref(true)
const query = ref('')
const isReserved = computed(() => props.assignment?.mode === 'RESERVED')
const groups = computed(() => buildSignalGroups(props.pin, props.data, props.assignment))
const filtered = computed(() => filterSignalGroups(groups.value, query.value))

function onOpenChange(v: boolean) {
  if (!v) emit('close')
}

/** 解除用户保留：清除该引脚的 assignment。 */
async function unreserve() {
  const ok = await requestOverwrite(props.pin.name, () => store.clearPin(props.pin.name), '解除保留')
  if (ok) emit('close')
}

/** 应用条目：保留既有标签，按类别写入 mode / function / remap。 */
async function choose(entry: SignalEntry) {
  if (entry.current) {
    emit('close')
    return
  }
  const label = props.assignment?.label
  const name = props.pin.name
  let action: () => void
  let text: string

  if (entry.kind === 'gpio') {
    action = () =>
      store.setPinAssignment(name, entry.mode, {
        params:
          entry.mode === 'INPUT'
            ? { pull: 'NONE' }
            : { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' },
      })
    text = entry.mode === 'INPUT' ? '切换为 GPIO 输入' : '切换为 GPIO 输出'
  } else if (entry.kind === 'af') {
    action = () =>
      store.setPinAssignment(name, 'AF', {
        function: entry.signal,
        remap: entry.remap,
        label,
      })
    text = `分配 ${entry.signal}${entry.remap !== undefined ? `（remap ${entry.remap}）` : ''}`
  } else if (entry.kind === 'analog') {
    action = () => store.setPinAssignment(name, 'ANALOG', { function: entry.signal, label })
    text = `分配 ${entry.signal}`
  } else {
    // Reserved：不传 function/remap，store 会清空这两项
    action = () => store.setPinAssignment(name, 'RESERVED')
    text = '标记 Reserved'
  }

  const ok = await requestOverwrite(name, action, text)
  if (ok) emit('close')
}
</script>

<template>
  <el-dialog
    :model-value="open"
    append-to-body
    width="520px"
    class="signals-selector"
    :title="`信号列表 · ${pin.name}`"
    @update:model-value="onOpenChange"
  >
    <div class="ss-head">
      <el-input
        v-model="query"
        size="small"
        clearable
        :prefix-icon="Search"
        placeholder="搜索信号 / 外设 / 引脚别名"
      />
      <div v-if="isReserved" class="ss-reserved-bar">
        <el-tag size="small" type="warning" effect="plain">此引脚已标记 Reserved</el-tag>
        <el-button size="small" text type="warning" @click="unreserve">解除保留</el-button>
      </div>
    </div>

    <div class="ss-groups">
      <div v-for="g in filtered" :key="g.id" class="ss-group">
        <div class="ss-group-title">
          <span>{{ g.label }}</span>
          <span class="ss-group-count">{{ g.entries.length }}</span>
        </div>
        <button
          v-for="e in g.entries"
          :key="e.key"
          type="button"
          class="ss-item"
          :class="{ current: e.current, reserved: e.kind === 'reserved' }"
          @click="choose(e)"
        >
          <span class="ss-item-label">{{ e.label }}</span>
          <span v-if="e.detail" class="ss-item-detail">{{ e.detail }}</span>
          <el-tag v-if="e.current" size="small" type="success" effect="plain" class="ss-current">
            当前
          </el-tag>
        </button>
      </div>
      <div v-if="filtered.length === 0" class="ss-empty">没有匹配的信号</div>
    </div>

    <template #footer>
      <el-button size="small" @click="emit('close')">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.signals-selector :deep(.el-dialog__body) {
  padding-top: 8px;
}
.ss-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.ss-reserved-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ss-groups {
  max-height: 420px;
  overflow-y: auto;
  border-top: 1px solid var(--mx-border);
}
.ss-group {
  padding: 6px 0;
  border-bottom: 1px solid var(--mx-border);
}
.ss-group:last-child {
  border-bottom: none;
}
.ss-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mx-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.ss-group-count {
  font-weight: 400;
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  padding: 0 5px;
  line-height: 14px;
}
.ss-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--mx-text-primary);
  cursor: pointer;
}
.ss-item:hover,
.ss-item:focus-visible {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
  outline: none;
}
.ss-item.current {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
  font-weight: 600;
}
.ss-item.reserved {
  color: var(--mx-text-secondary);
}
.ss-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ss-item-detail {
  margin-left: auto;
  font-size: 11px;
  color: var(--mx-text-muted);
  font-variant-numeric: tabular-nums;
}
.ss-current {
  flex-shrink: 0;
}
.ss-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--mx-text-muted);
}
</style>
