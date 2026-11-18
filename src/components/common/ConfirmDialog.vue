<script setup lang="ts">
// 通用确认对话框（M15）：中文文案 + 可选「不再询问」checkbox。
// 用法：<ConfirmDialog v-model="open" ... @confirm="(skip)=>..." />
// confirm 事件携带本次勾选状态（未显示 checkbox 时恒为 false）。
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    showCheckbox?: boolean
    checkboxLabel?: string
  }>(),
  {
    confirmText: '确定',
    cancelText: '取消',
    showCheckbox: false,
    checkboxLabel: '不再询问',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', checked: boolean): void
  (e: 'cancel'): void
}>()

const checked = ref(false)
/** 本次关闭是否已发过 confirm/cancel（避免关闭事件重复通知） */
const notified = ref(false)
/** 每次打开重置勾选，避免上次状态影响本次确认 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      checked.value = false
      notified.value = false
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function onConfirm() {
  notified.value = true
  emit('confirm', props.showCheckbox ? checked.value : false)
  close()
}

function onCancel() {
  notified.value = true
  emit('cancel')
  close()
}

/** 关闭（确认按钮 / 取消按钮 / 右上角 X / Esc）：仅未经按钮通知时补发 cancel */
function onClose() {
  if (!notified.value) emit('cancel')
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="420px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @close="onClose"
  >
    <div class="confirm-message">{{ message }}</div>
    <el-checkbox v-if="showCheckbox" v-model="checked" class="confirm-check">{{ checkboxLabel }}</el-checkbox>
    <template #footer>
      <el-button size="small" @click="onCancel">{{ cancelText }}</el-button>
      <el-button size="small" type="primary" @click="onConfirm">{{ confirmText }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.confirm-message {
  font-size: 13px;
  color: var(--mx-text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
}
.confirm-check {
  margin-top: 12px;
}
</style>
