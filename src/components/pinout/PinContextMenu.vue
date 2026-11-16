<script setup lang="ts">
// 引脚右键菜单（M2.7 / M4.7）：分组信号清单 + 信号选择器（搜索/分组）+ Reserved 切换 +
// Assign / Configure / Edit label / Reset Pin State。
// 动作复用 PinConfigPanel 的覆盖确认（usePinOverwrite）与 store；Exclude pin 为 M3 占位。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useProjectStore } from '@/controllers/project'
import { peripheralOfSignal, remapValuesFor, remapsOfPin } from '@/model/device'
import { usePinOverwrite } from '@/model/pins/pinOverwrite'
import { pinStateColors, pinStateLabel, type PinStateId } from '@/model/pins/pinFilter'
import type { ChipPin, PinAssignment } from '@/model/types'
import SignalsSelector from './SignalsSelector.vue'

const props = defineProps<{
  x: number
  y: number
  pin: ChipPin
  assignment?: PinAssignment
  state: PinStateId
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** 选中引脚并打开 Detail view（Assign signal… / 完成信号分配后） */
  (e: 'assign', pin: string): void
}>()

const store = useProjectStore()
const { requestOverwrite } = usePinOverwrite(store)
const root = ref<HTMLElement | null>(null)
/** 信号选择器打开时隐藏菜单本体（dialog 本身 teleport 到 body）。 */
const selectorOpen = ref(false)

const stateColor = computed(() => pinStateColors(props.state, props.assignment?.mode))
const stateText = computed(() => pinStateLabel(props.state))
const isIo = computed(() => props.pin.type === 'IO')

const alternateSignals = computed(() => [
  ...new Set(remapsOfPin(store.deviceData, props.pin.name).map((e) => e.signal)),
])
const analogChannels = computed(() => props.pin.adc ?? [])

/** AF 配置时解析所属外设实例（USART1_TX → USART1）；无对应实例则不显示 Configure。 */
const peripheralId = computed(() => {
  if (props.assignment?.mode !== 'AF' || !props.assignment.function) return null
  const id = peripheralOfSignal(props.assignment.function)
  if (!id) return null
  const p = store.deviceData.peripherals
  const exists = [...p.usart, ...p.spi, ...p.i2c, ...p.adc].some((i) => i.id === id)
  return exists ? id : null
})

async function applyAssign(action: () => void, text: string) {
  const ok = await requestOverwrite(props.pin.name, action, text)
  if (!ok) return
  emit('assign', props.pin.name)
  emit('close')
}

function assignSignal(signal: string) {
  const remaps = remapValuesFor(store.deviceData, props.pin.name, signal)
  void applyAssign(
    () => store.setPinAssignment(props.pin.name, 'AF', { function: signal, remap: remaps[0], label: props.assignment?.label }),
    `分配 ${signal}`,
  )
}

function assignAnalog(channel: string) {
  void applyAssign(
    () => store.setPinAssignment(props.pin.name, 'ANALOG', { function: channel, label: props.assignment?.label }),
    `分配 ${channel}`,
  )
}

function assignGpio(mode: 'INPUT' | 'OUTPUT') {
  const action = () =>
    mode === 'INPUT'
      ? store.setPinAssignment(props.pin.name, 'INPUT', { params: { pull: 'NONE' } })
      : store.setPinAssignment(props.pin.name, 'OUTPUT', { params: { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' } })
  void applyAssign(action, mode === 'INPUT' ? '切换为 GPIO 输入' : '切换为 GPIO 输出')
}

function openDetail() {
  emit('assign', props.pin.name)
  emit('close')
}

/** 打开信号选择器（搜索 + 分组 + Reserved）；关闭后整张菜单一并收起。 */
function openSelector() {
  selectorOpen.value = true
}

function closeSelector() {
  selectorOpen.value = false
  emit('close')
}

/** 标记 / 解除用户保留（RESERVED）：走覆盖确认，不改变其余菜单动作。 */
async function toggleReserved() {
  const isReserved = props.assignment?.mode === 'RESERVED'
  const ok = await requestOverwrite(
    props.pin.name,
    () =>
      isReserved
        ? store.clearPin(props.pin.name)
        : store.setPinAssignment(props.pin.name, 'RESERVED'),
    isReserved ? '解除保留' : '标记 Reserved',
  )
  if (!ok) return
  emit('close')
}

function configurePeripheral() {
  if (!peripheralId.value) return
  store.openPeripheral(peripheralId.value)
  emit('close')
}

async function editLabel() {
  if (!props.assignment) return
  try {
    const res = (await ElMessageBox.prompt(`引脚 ${props.pin.name} 的标签`, 'Edit label', {
      inputValue: props.assignment.label ?? '',
      inputPlaceholder: '如 LED_RUN（留空清除）',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })) as { value: string }
    store.setPinLabel(props.pin.name, (res.value ?? '').trim())
    emit('close')
  } catch {
    // 用户取消
  }
}

async function resetPin() {
  if (!props.assignment) return
  const ok = await requestOverwrite(props.pin.name, () => store.clearPin(props.pin.name), '重置引脚状态')
  if (!ok) return
  store.notify(`${props.pin.name} 已重置`, 'info')
  emit('close')
}

function onDocumentMouseDown(e: MouseEvent) {
  // 选择器打开时点击发生在 dialog（teleport 到 body）内，不据此关闭菜单
  if (selectorOpen.value) return
  if (root.value && !root.value.contains(e.target as Node)) emit('close')
}
function onDocumentKey(e: KeyboardEvent) {
  // Esc 交给 dialog 处理（关闭 dialog 后再由 closeSelector 收起菜单）
  if (selectorOpen.value) return
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown)
  document.addEventListener('keydown', onDocumentKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  document.removeEventListener('keydown', onDocumentKey)
})
</script>

<template>
  <div
    v-show="!selectorOpen"
    ref="root"
    class="pin-menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="menu"
    @contextmenu.prevent
    @mousedown.stop
  >
    <div class="menu-head">
      <span class="menu-pos">#{{ pin.number }}</span>
      <span class="menu-pin">{{ pin.name }}</span>
      <span class="menu-state" :style="{ color: stateColor.fg, background: stateColor.bg, borderColor: stateColor.border }">
        {{ stateText }}
      </span>
    </div>

    <div v-if="isIo && alternateSignals.length" class="menu-section">
      <div class="menu-section-title">Alternate signals</div>
      <div class="signal-list">
        <button
          v-for="sig in alternateSignals"
          :key="sig"
          type="button"
          class="menu-item signal-item"
          role="menuitem"
          @click="assignSignal(sig)"
        >
          <span class="signal-name">{{ sig }}</span>
          <span v-if="assignment?.function === sig" class="signal-current">当前</span>
        </button>
      </div>
    </div>

    <div v-if="isIo && analogChannels.length" class="menu-section">
      <div class="menu-section-title">Analog signals</div>
      <div class="signal-list">
        <button
          v-for="ch in analogChannels"
          :key="ch"
          type="button"
          class="menu-item signal-item"
          role="menuitem"
          @click="assignAnalog(ch)"
        >
          <span class="signal-name">{{ ch }}</span>
          <span v-if="assignment?.mode === 'ANALOG' && assignment.function === ch" class="signal-current">当前</span>
        </button>
      </div>
    </div>

    <div v-if="isIo" class="menu-section">
      <div class="menu-section-title">GPIO</div>
      <button type="button" class="menu-item" role="menuitem" @click="assignGpio('INPUT')">GPIO 输入</button>
      <button type="button" class="menu-item" role="menuitem" @click="assignGpio('OUTPUT')">GPIO 输出</button>
    </div>

    <div class="menu-sep"></div>

    <button type="button" class="menu-item" role="menuitem" :disabled="!isIo" @click="openDetail">Assign signal…</button>
    <button type="button" class="menu-item" role="menuitem" :disabled="!isIo" @click="openSelector">
      信号列表（搜索/分组）…
    </button>
    <button type="button" class="menu-item" role="menuitem" :disabled="!isIo" @click="toggleReserved">
      {{ assignment?.mode === 'RESERVED' ? '解除保留' : '标记 Reserved' }}
    </button>
    <button v-if="peripheralId" type="button" class="menu-item" role="menuitem" @click="configurePeripheral">
      Configure {{ peripheralId }}
    </button>
    <button type="button" class="menu-item" role="menuitem" :disabled="!assignment" @click="editLabel">Edit label</button>
    <button type="button" class="menu-item" role="menuitem" :disabled="!assignment" @click="resetPin">Reset Pin State</button>
    <button type="button" class="menu-item menu-item-muted" role="menuitem" disabled>
      Exclude pin <span class="m3">M3</span>
    </button>
  </div>

  <!-- 信号选择器：dialog teleport 到 body，首屏即挂载在菜单上下文里 -->
  <SignalsSelector
    v-if="selectorOpen"
    :pin="pin"
    :assignment="assignment"
    :data="store.deviceData"
    @close="closeSelector"
  />
</template>

<style scoped>
.pin-menu {
  position: absolute;
  width: 232px;
  max-height: 440px;
  overflow-y: auto;
  background: var(--mx-surface);
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  padding: 5px;
  z-index: 30;
  font-size: 12px;
}
.menu-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px 7px;
  border-bottom: 1px solid var(--mx-border);
  margin-bottom: 4px;
}
.menu-pos {
  color: var(--mx-text-muted);
  font-variant-numeric: tabular-nums;
}
.menu-pin {
  font-weight: 600;
  color: var(--mx-text-primary);
}
.menu-state {
  margin-left: auto;
  border: 1px solid var(--mx-border);
  border-radius: 9px;
  padding: 0 7px;
  line-height: 17px;
  font-size: 11px;
}
.menu-section {
  padding: 3px 0;
}
.menu-section-title {
  font-size: 11px;
  color: var(--mx-text-muted);
  padding: 3px 7px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 5px 7px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--mx-text-primary);
  cursor: pointer;
}
.menu-item:hover:not(:disabled),
.menu-item:focus-visible:not(:disabled) {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
  outline: none;
}
.menu-item:disabled {
  cursor: default;
  color: var(--mx-text-muted);
}
.menu-item-muted {
  opacity: 0.7;
}
.signal-list {
  max-height: 110px;
  overflow-y: auto;
}
.signal-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.signal-current {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--mx-accent);
  background: var(--mx-accent-soft);
  border-radius: 7px;
  padding: 0 5px;
  line-height: 15px;
}
.menu-sep {
  height: 1px;
  background: var(--mx-border);
  margin: 4px 3px;
}
.m3 {
  font-size: 10px;
  border: 1px solid var(--mx-border);
  border-radius: 7px;
  padding: 0 5px;
  line-height: 15px;
  color: var(--mx-text-muted);
}
</style>