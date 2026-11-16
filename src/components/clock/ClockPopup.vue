<script setup lang="ts">
// 节点内嵌控件的弹层：Teleport 到 body + fixed 定位（避免被画布 overflow:hidden 裁剪）。
// 点击弹层之外（且不落在其它 .ctrl 控件上）或滚动时由父级关闭；选择/确认后抛 change 再关闭。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ClockNodeControl } from '@/model/clock/tree'

const props = defineProps<{
  control: ClockNodeControl
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'change', control: ClockNodeControl, value: string | number): void
  (e: 'close'): void
}>()

const pop = ref<HTMLElement | null>(null)
const numberDraft = ref(0)

// 每次打开（父级用 key 重建）都按当前控件值初始化数字草稿
watch(
  () => props.control,
  (c) => {
    if (c.kind === 'number') numberDraft.value = Number(c.value)
  },
  { immediate: true },
)

/** document 级监听：Teleport 内容不在 canvas-wrap 内，点击弹层之外即关闭 */
function onWindowMouseDown(e: MouseEvent) {
  const t = e.target
  if (!(t instanceof Node)) return
  if (pop.value?.contains(t)) return
  // 点在控件本身时不关闭，交给 click 处理（打开/切换弹层）
  if (t instanceof Element && t.closest('.ctrl')) return
  emit('close')
}

onMounted(() => document.addEventListener('mousedown', onWindowMouseDown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onWindowMouseDown, true))

function pickOption(v: string | number) {
  emit('change', props.control, v)
  emit('close')
}

function commitNumber() {
  if (Number.isFinite(numberDraft.value)) {
    emit('change', props.control, numberDraft.value)
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div ref="pop" class="ctrl-pop" :style="{ left: x + 'px', top: y + 'px' }" @click.stop @mousedown.stop>
      <template v-if="control.kind === 'select'">
        <div
          v-for="opt in control.options"
          :key="String(opt.value)"
          class="ctrl-opt"
          :class="{ current: String(opt.value) === String(control.value) }"
          @click="pickOption(opt.value)"
        >
          {{ opt.label }}
        </div>
      </template>
      <div v-else class="ctrl-num">
        <el-input-number v-model="numberDraft" :min="control.min" :max="control.max" size="small" :step="1" />
        <el-button size="small" type="primary" @click="commitNumber">确定</el-button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 控件弹层（Teleport 到 body，fixed 定位避免被画布 overflow 裁剪） */
.ctrl-pop {
  position: fixed;
  z-index: 3000;
  min-width: 120px;
  background: #fff;
  border: 1px solid var(--mx-border);
  border-radius: 8px;
  box-shadow: var(--mx-shadow-popover);
  padding: 4px;
}
.ctrl-opt {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--mx-text);
  white-space: nowrap;
}
.ctrl-opt:hover {
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.ctrl-opt.current {
  color: var(--mx-accent);
  font-weight: 600;
}
.ctrl-num {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
}
</style>