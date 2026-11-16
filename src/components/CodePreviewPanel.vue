<script setup lang="ts">
// 代码实时预览面板（提示词 §6.5，对齐 MX2 Code Preview）：
// - Monaco 只读 vs-dark 预览，文件下拉切换（setValue + 语言切换）
// - watch store.config（deep）→ 200ms debounce → generateProject → 更新内容
// - diff 模式：original = lastExportSnapshot，modified = 当前生成结果，并排只读
// - 失败态：顶部红色 el-alert 列出错误码 + 消息，编辑器保留上次有效内容
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type * as monacoTypes from 'monaco-editor'
import { Refresh } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { generateProject } from '@/model/codegen'
import type { Conflict, GeneratedFile } from '@/model/types'
import { ensureMonaco, languageOf, monaco } from '@/services/monaco'

const props = defineProps<{
  /** 面板所处的视图上下文：决定头部对象名 */
  context: 'pinout' | 'clock' | 'peripherals'
}>()

const store = useProjectStore()

// 面板宽度（M6）：不再自带拖拽与固定宽度，由宿主视图的外层容器 + PanelResizer 控制，
// 本组件以 width:100% 填满父容器；内部 Monaco 通过 ResizeObserver 自适应布局。

// ---------- 状态 ----------
const host = ref<HTMLDivElement>()
const editor = shallowRef<monacoTypes.editor.IStandaloneCodeEditor | null>(null)
const diffEditor = shallowRef<monacoTypes.editor.IStandaloneDiffEditor | null>(null)
let contentModel: monacoTypes.editor.ITextModel | null = null
let originalModel: monacoTypes.editor.ITextModel | null = null
let modifiedModel: monacoTypes.editor.ITextModel | null = null

const files = ref<GeneratedFile[]>([])
const errors = ref<Conflict[]>([])
const fatalError = ref<string | null>(null)
const currentPath = ref('')
const diffMode = ref(false)
const elapsedMs = ref(0)
let resizeObserver: ResizeObserver | null = null

// ---------- 头部对象名 ----------
const objectName = computed(() => {
  if (props.context === 'pinout') return store.selectedPin ?? 'Pins'
  if (props.context === 'clock') return 'Clock'
  return 'Peripherals'
})

const halRevShort = computed(() => store.halRev.slice(0, 7))

// ---------- diff 基准 ----------
function baselineOf(path: string): string | undefined {
  const snap = store.lastExportSnapshot
  if (!snap || !path) return undefined
  return snap[path]
}

/** 是否真的进入 diff 模式：开关开启且当前文件存在对比基准，否则退回普通模式 */
const useDiff = computed(() => diffMode.value && baselineOf(currentPath.value) !== undefined)
const noBaseline = computed(() => diffMode.value && !useDiff.value)

// ---------- 生成（200ms 防抖） ----------
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRegenerate() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    regenerate()
  }, 200)
}

function regenerate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const t0 = performance.now()
  try {
    const result = generateProject(store.config, store.deviceData)
    elapsedMs.value = Math.round(performance.now() - t0)
    if (result.errors.length > 0) {
      // 失败态：保留上次有效内容，只更新错误列表
      errors.value = result.errors
      fatalError.value = null
      return
    }
    errors.value = []
    fatalError.value = null
    applyFiles(result.files)
  } catch (e) {
    // codegen 抛异常（不应发生）：同样保留上次内容
    fatalError.value = e instanceof Error ? e.message : String(e)
    errors.value = []
  }
}

function applyFiles(next: GeneratedFile[]) {
  files.value = next
  // 当前文件不在新列表里（或首次生成）→ 切到第一个文件
  if (!next.some((f) => f.path === currentPath.value)) {
    currentPath.value = next[0]?.path ?? ''
  }
  syncEditorContent()
}

// ---------- 编辑器生命周期 ----------
function buildEditors() {
  if (!host.value) return
  destroyEditors()
  if (useDiff.value && originalModel && modifiedModel) {
    diffEditor.value = monaco.editor.createDiffEditor(host.value, {
      theme: 'vs-dark',
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      automaticLayout: false,
      minimap: { enabled: false },
      fontFamily: 'var(--mx-font-mono)',
      fontSize: 12,
      scrollBeyondLastLine: false,
    })
    diffEditor.value.setModel({ original: originalModel, modified: modifiedModel })
  } else {
    editor.value = monaco.editor.create(host.value, {
      model: contentModel,
      theme: 'vs-dark',
      readOnly: true,
      lineNumbers: 'on',
      automaticLayout: false,
      minimap: { enabled: false },
      fontFamily: 'var(--mx-font-mono)',
      fontSize: 12,
      scrollBeyondLastLine: false,
      wordWrap: 'off',
    })
  }
  layoutActive()
}

function destroyEditors() {
  editor.value?.dispose()
  editor.value = null
  diffEditor.value?.dispose()
  diffEditor.value = null
}

function layoutActive() {
  editor.value?.layout()
  diffEditor.value?.layout()
}

/** 文件切换 / 内容更新：setValue + 语言切换（diff 侧同步更新基准与当前值） */
function syncEditorContent() {
  const path = currentPath.value
  const content = files.value.find((f) => f.path === path)?.content ?? ''
  const lang = path ? languageOf(path) : 'plaintext'
  if (contentModel) {
    monaco.editor.setModelLanguage(contentModel, lang)
    contentModel.setValue(content)
  }
  const base = baselineOf(path)
  if (originalModel) {
    monaco.editor.setModelLanguage(originalModel, lang)
    originalModel.setValue(base ?? '')
  }
  if (modifiedModel) {
    monaco.editor.setModelLanguage(modifiedModel, lang)
    modifiedModel.setValue(content)
  }
  if (diffEditor.value && originalModel && modifiedModel) {
    diffEditor.value.setModel({ original: originalModel, modified: modifiedModel })
  }
}

/** 底部动作：把当前生成结果设为 diff 对比基准 */
function setBaseline() {
  if (files.value.length === 0) return
  const snapshot: Record<string, string> = {}
  for (const f of files.value) snapshot[f.path] = f.content
  store.setExportSnapshot(snapshot)
  syncEditorContent()
}

onMounted(() => {
  ensureMonaco()
  contentModel = monaco.editor.createModel('', 'plaintext')
  originalModel = monaco.editor.createModel('', 'plaintext')
  modifiedModel = monaco.editor.createModel('', 'plaintext')
  buildEditors()
  // 首次立即生成一次（不经防抖）
  regenerate()
  resizeObserver = new ResizeObserver(() => layoutActive())
  if (host.value) resizeObserver.observe(host.value)
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  resizeObserver?.disconnect()
  resizeObserver = null
  destroyEditors()
  contentModel?.dispose()
  contentModel = null
  originalModel?.dispose()
  originalModel = null
  modifiedModel?.dispose()
  modifiedModel = null
})

// ---------- 响应式数据流 ----------
// 配置任意变化（含换芯片）→ 防抖重算；config getter 每次返回新对象，deep 追踪嵌套变更
watch(() => store.config, scheduleRegenerate, { deep: true })
// 文件切换 → 更新内容与语言
watch(currentPath, syncEditorContent)
// diff 可用性变化（开关 / 基准出现 / 切换文件）→ 重建对应形态的编辑器
watch(useDiff, buildEditors)
</script>

<template>
  <div class="code-preview">
    <div class="cp-header">
      <div class="cp-title">
        <span class="obj">{{ objectName }}</span>
        <span class="sep">·</span>
        <span class="label">Code Preview</span>
      </div>
      <div class="cp-toolbar">
        <el-select
          v-model="currentPath"
          size="small"
          filterable
          placeholder="生成文件"
          class="cp-select"
        >
          <el-option v-for="f in files" :key="f.path" :label="f.path" :value="f.path" />
        </el-select>
        <el-tooltip content="与上次导出快照对比" placement="bottom">
          <el-switch v-model="diffMode" size="small" class="cp-switch" active-text="Show change(s)" />
        </el-tooltip>
        <el-button size="small" class="cp-refresh" @click="regenerate">
          <el-icon><Refresh /></el-icon>
          <span>刷新</span>
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="fatalError"
      type="error"
      title="生成器异常"
      :description="fatalError"
      :closable="false"
      show-icon
      class="cp-alert"
    />
    <el-alert
      v-else-if="errors.length"
      type="error"
      title="生成失败，编辑器保留上次有效内容"
      :closable="false"
      show-icon
      class="cp-alert"
    >
      <div v-for="(e, i) in errors" :key="i" class="cp-err-line">
        <span class="cp-err-code">{{ e.code }}</span>
        <span>{{ e.message }}</span>
      </div>
    </el-alert>
    <el-alert
      v-else-if="noBaseline"
      type="info"
      title="尚未导出，无对比基准"
      description="先导出工程，或点击底部「设为对比基准」后再开启对比。"
      :closable="false"
      show-icon
      class="cp-alert"
    />

    <div class="cp-body">
      <div ref="host" class="cp-host"></div>
      <div v-if="files.length === 0 && !errors.length && !fatalError" class="cp-empty">
        暂无生成文件
      </div>
    </div>

    <div class="cp-footer">
      <span class="cp-meta">
        {{ files.length }} 个文件 · {{ elapsedMs }} ms · HAL {{ halRevShort }}
      </span>
      <el-button
        size="small"
        text
        type="primary"
        :disabled="files.length === 0"
        @click="setBaseline"
      >
        设为对比基准
      </el-button>
    </div>
  </div>
</template>

<style scoped>
/* 宽度由宿主容器决定（M6）：填满父容器，内部滚动/布局不受影响 */
.code-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  height: 100%;
  background: var(--mx-surface);
  border-left: 1px solid var(--mx-border);
  overflow: hidden;
}

.cp-header {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--mx-border);
  flex-shrink: 0;
}
.cp-title {
  font-size: var(--mx-fz-card-title);
  font-weight: 600;
  color: var(--mx-text);
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 8px;
}
.cp-title .label {
  font-size: var(--mx-fz-label);
  font-weight: 500;
  color: var(--mx-text-muted);
}
.cp-title .sep {
  color: var(--mx-text-muted);
}
.cp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cp-select {
  flex: 1;
  min-width: 0;
}
.cp-refresh {
  flex-shrink: 0;
}

.cp-alert {
  flex-shrink: 0;
  margin: 8px 12px 0;
}
.cp-err-line {
  display: flex;
  gap: 6px;
  font-size: var(--mx-fz-label);
  line-height: 1.6;
}
.cp-err-code {
  font-family: var(--mx-font-mono);
  font-weight: 600;
  flex-shrink: 0;
}

.cp-body {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--mx-surface);
}
.cp-host {
  position: absolute;
  inset: 0;
}
.cp-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mx-text-muted);
  font-size: var(--mx-fz-body);
  pointer-events: none;
}

.cp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  border-top: 1px solid var(--mx-border);
  font-size: var(--mx-fz-label);
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}
.cp-meta {
  font-family: var(--mx-font-mono);
  color: var(--mx-text-muted);
}
</style>
