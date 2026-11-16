<script lang="ts">
// 创建工程向导的纯函数（M9.2）：工程名门禁、建议名规范化、存储位置预览、创建载荷。
// 随组件导出，供 tests/createWizard.test.ts 直接验证；不推断任何磁盘/网络能力。
import { isDesktopApp } from '@/services/desktop'

/** 当前工程在浏览器 localStorage 的单槽键（与 projectStorage 服务一致）。 */
export const PROJECT_STORAGE_SLOT = 'ch32-rs-cubemx:project'

/** 创建载荷：HomeView 收到后依次 setProjectName → switchDevice → 跳 Pinout。 */
export interface CreateProjectPayload {
  chip: string
  name: string
}

/** 第二步创建门禁：工程名 trim 后必须非空（空/纯空白禁用 Create project）。 */
export function wizardNameGate(name: string): boolean {
  return typeof name === 'string' && name.trim().length > 0
}

/**
 * 建议工程名：芯片名小写 + '-project'。
 * 非法字符（空白、标点等）折叠为 '-'，连续/首尾 '-' 归一，空输入回退 ch32-project。
 */
export function suggestProjectName(chip: string): string {
  const base = (chip ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'ch32'}-project`
}

/** 存储位置预览：浏览器与桌面端文案诚实区分；路径统一为 localStorage URI 形态。 */
export interface StoragePreview {
  /** 人类可读的存储位置 */
  location: string
  /** 自动生成的只读路径（name 缺省显示 <name> 占位） */
  path: string
  /** 诚实标注（桌面端磁盘工程库尚未落地） */
  note: string
}

/**
 * 生成存储位置与自动路径预览。
 * @param desktop 是否桌面端（isDesktopApp）；当前两分支都落 localStorage，仅文案不同
 * @param name 工程名；空则显示 <name> 占位
 */
export function storagePreview(desktop: boolean, name = ''): StoragePreview {
  const safeName = (name ?? '').trim() || '<name>'
  const path = `localStorage://ch32-rs-cubemx/project/${safeName}`
  if (desktop) {
    return {
      location: '本机 WebView localStorage（桌面端当前同浏览器存储）',
      path,
      note: '桌面端磁盘工程库待后续里程碑；当前与浏览器一致，保存在本机 WebView 的 localStorage 槽位。',
    }
  }
  return {
    location: `浏览器 localStorage（槽位 ${PROJECT_STORAGE_SLOT}）`,
    path,
    note: '纯本地保存，不上传服务器；桌面端磁盘工程库待后续里程碑。',
  }
}

/** 创建载荷构建：门禁不通过（未选芯片 / 空名）返回 null；名称去除首尾空白。 */
export function createProjectPayload(
  chip: string | null,
  rawName: string,
): CreateProjectPayload | null {
  const name = (rawName ?? '').trim()
  if (!chip || !wizardNameGate(name)) return null
  return { chip, name }
}

/** 当前运行环境是否桌面端（供模板直接调用，避免重复导入服务）。 */
export function wizardIsDesktop(): boolean {
  return isDesktopApp()
}
</script>

<script setup lang="ts">
// M9 两步创建向导（对齐 MX2 Create Application Project from MCU 的前两步）：
// 1 选择芯片（内嵌 ChipPicker，受控选中 + Continue 门禁）
// 2 工程详情（必填名称 + 存储位置/自动路径只读预览 + Selected MCU 回显 + Create 门禁）
// 第三步的联网 setup 明确不模仿：本工具纯本地秒建，创建后直接进入 Pinout。
import { computed, ref, watch } from 'vue'
import { Check } from '@element-plus/icons-vue'
import ChipPicker, {
  canContinueSelection,
  selectionLineCount,
} from '@/components/home/ChipPicker.vue'

const props = withDefaults(
  defineProps<{
    /** 对话框可见性（v-model） */
    modelValue: boolean
    /** 从 Home 底部表格 Continue 打开时的预选芯片 */
    initialChip?: string | null
  }>(),
  { initialChip: null },
)

const emit = defineEmits<{
  (e: 'update:modelValue', open: boolean): void
  /** Create project：父视图负责 setProjectName + switchDevice + 跳 Pinout + 关闭向导 */
  (e: 'create', payload: CreateProjectPayload): void
}>()

const step = ref<1 | 2>(1)
const selectedChip = ref<string | null>(null)
const projectName = ref('')
/** 用户是否手改过名称：手改后切换芯片不再覆盖。 */
const nameTouched = ref(false)

/** 桌面端判定（当前两种环境都落 localStorage，仅文案不同）。 */
const isDesktop = wizardIsDesktop()

/** 存储位置 & 自动路径预览（随工程名联动）。 */
const storage = computed(() => storagePreview(isDesktop, projectName.value))

/** 第二步 Create 门禁：已选芯片 + 名称非空。 */
const createGate = computed(
  () => canContinueSelection(selectedChip.value) && wizardNameGate(projectName.value),
)

// 每次打开重置到第一步；初始芯片来自 Home 卡片（null）或底部表格 Continue（已选）。
watch(
  () => props.modelValue,
  (open) => {
    if (open) resetWizard()
  },
)

function resetWizard(): void {
  step.value = 1
  selectedChip.value = props.initialChip ?? null
  nameTouched.value = false
  projectName.value = selectedChip.value ? suggestProjectName(selectedChip.value) : ''
}

// 第一步换芯片：名称未被用户改过时，自动刷新建议名。
watch(selectedChip, (chip) => {
  if (chip && !nameTouched.value) projectName.value = suggestProjectName(chip)
})

function markNameTouched(): void {
  nameTouched.value = true
}

function goStep2(): void {
  if (!canContinueSelection(selectedChip.value)) return
  if (!nameTouched.value) projectName.value = suggestProjectName(selectedChip.value)
  step.value = 2
}

function closeWizard(): void {
  emit('update:modelValue', false)
}

function onCreate(): void {
  const payload = createProjectPayload(selectedChip.value, projectName.value)
  if (!payload) return
  emit('create', payload)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="从 MCU 创建工程"
    width="900px"
    append-to-body
    :close-on-click-modal="false"
    class="create-wizard"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- stepper 头：1 选择芯片 / 2 工程详情（完成态勾图标 + 横线连接，对齐 MX2） -->
    <div class="wiz-steps">
      <div class="wiz-step" :class="{ active: step === 1, done: step > 1 }">
        <span class="wiz-dot">
          <el-icon v-if="step > 1" :size="13"><Check /></el-icon>
          <template v-else>1</template>
        </span>
        <span class="wiz-step-title">选择芯片</span>
      </div>
      <span class="wiz-line" :class="{ done: step > 1 }" />
      <div class="wiz-step" :class="{ active: step === 2 }">
        <span class="wiz-dot">2</span>
        <span class="wiz-step-title">工程详情</span>
      </div>
    </div>

    <!-- 第一步：选择芯片 -->
    <div v-if="step === 1" class="wiz-body">
      <p class="wiz-lead">从下方列表选择一颗 MCU；行点击即选中，Continue 进入工程详情。</p>
      <ChipPicker v-model="selectedChip" embedded />
    </div>

    <!-- 第二步：工程详情 -->
    <div v-else class="wiz-body">
      <p class="wiz-lead">填写工程名并确认存储位置；名称与位置在创建后只读（改名请用工程库重命名）。</p>
      <div class="wiz-form">
        <div class="wiz-field">
          <label class="wiz-label" for="wiz-project-name">Project name</label>
          <el-input
            id="wiz-project-name"
            v-model="projectName"
            maxlength="60"
            show-word-limit
            placeholder="请输入工程名称"
            @input="markNameTouched"
          />
          <p class="wiz-hint">必填；写入 cube.json 的 projectName，同时作为生成的 Cargo package 名。</p>
        </div>
        <div class="wiz-row">
          <span class="wiz-label">存储位置</span>
          <div class="wiz-value">
            <code>{{ storage.location }}</code>
            <span class="wiz-hint">{{ storage.note }}</span>
          </div>
        </div>
        <div class="wiz-row">
          <span class="wiz-label">自动路径</span>
          <div class="wiz-value"><code>{{ storage.path }}</code></div>
        </div>
        <div class="wiz-row">
          <span class="wiz-label">Selected MCU</span>
          <div class="wiz-value"><code>{{ selectedChip }}</code></div>
        </div>
        <p class="wiz-local-note">本工具纯本地生成，无需联网安装依赖；创建后直接进入 Pinout。</p>
      </div>
    </div>

    <template #footer>
      <div class="wiz-footer">
        <el-button v-if="step === 2" @click="step = 1">Previous step</el-button>
        <el-button v-else disabled>Previous step</el-button>
        <span class="wiz-footer-spacer" />
        <span v-if="step === 1" class="wiz-selected">
          Selected: {{ selectionLineCount(selectedChip) }} line(s)
        </span>
        <el-button @click="closeWizard">Cancel</el-button>
        <el-button v-if="step === 1" type="primary" :disabled="!selectedChip" @click="goStep2">
          Continue
        </el-button>
        <el-button v-else type="primary" :disabled="!createGate" @click="onCreate">
          Create project
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.wiz-steps {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  padding: 4px 0 18px;
}
.wiz-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 96px;
  color: var(--mx-text-muted);
}
.wiz-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--mx-border);
  background: var(--mx-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--mx-text-muted);
}
.wiz-step.active .wiz-dot {
  border-color: var(--mx-accent);
  background: var(--mx-accent);
  color: #fff;
}
.wiz-step.done .wiz-dot {
  border-color: var(--mx-accent);
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
}
.wiz-step.active .wiz-step-title,
.wiz-step.done .wiz-step-title {
  color: var(--mx-accent);
  font-weight: 600;
}
.wiz-step-title {
  font-size: 12px;
}
.wiz-line {
  flex: 0 0 180px;
  height: 1px;
  margin-top: 13px;
  background: var(--mx-border);
}
.wiz-line.done {
  background: var(--mx-accent);
}
.wiz-body {
  min-height: 320px;
}
.wiz-lead {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--mx-text-muted);
}
.wiz-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
}
.wiz-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wiz-label {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--mx-text-secondary);
}
.wiz-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.wiz-value {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  font-size: 12px;
}
.wiz-value code {
  font-family: var(--mx-font-mono);
  font-size: 12px;
  color: var(--mx-text-secondary);
  background: #f2f5fa;
  border-radius: 4px;
  padding: 2px 6px;
  overflow-wrap: anywhere;
}
.wiz-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--mx-text-muted);
}
.wiz-local-note {
  margin: 2px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--mx-accent-soft);
  color: var(--mx-accent);
  font-size: 12px;
}
.wiz-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wiz-footer-spacer {
  flex: 1;
}
.wiz-selected {
  margin-right: 4px;
  font-size: 12px;
  color: var(--mx-text-muted);
}
</style>
