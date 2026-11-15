<script setup lang="ts">
// 代码生成导出对话框：子项选择 + ZIP / 目录导出 + main.rs 保护 + diff 快照。
import { computed, reactive, ref } from 'vue'
import JSZip from 'jszip'
import { Download, FolderOpened } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'
import { generateProject } from '../lib/codegen'
import { downloadProjectFile } from '../lib/projectFile'
import { isDesktopApp, pickFolderNative, saveFileNative, writeFolderNative } from '../lib/desktop'
import { DEFAULT_SELECTION, type CodegenSelection, type GeneratedFile } from '../types'

const store = useProjectStore()
const visible = defineModel<boolean>({ default: false })

const selection = reactive<CodegenSelection>({ ...DEFAULT_SELECTION })
const includeMain = ref(true)
const projectName = ref(store.projectName)
const generating = ref(false)
const writingFolder = ref(false)

// ---------- File System Access API 最小类型（TS 5.6 DOM lib 尚不完整） ----------

interface FsWritableLike {
  write(data: string | Uint8Array): Promise<void>
  close(): Promise<void>
}

interface FsFileHandleLike {
  createWritable(): Promise<FsWritableLike>
}

interface FsDirectoryHandleLike {
  readonly name: string
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandleLike>
}

type ShowDirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirectoryHandleLike>

/** 目录写入能力：Chromium 系（安全上下文）或 Tauri 桌面端（原生对话框 + Rust 写盘）。 */
const desktop = isDesktopApp()
const supportsDirectoryPicker = 'showDirectoryPicker' in window
const canWriteFolder = (supportsDirectoryPicker && window.isSecureContext) || desktop
const folderHint = canWriteFolder
  ? ''
  : !supportsDirectoryPicker
    ? '当前浏览器不支持目录写入，请使用 ZIP 导出'
    : '当前页面不是安全上下文（需 HTTPS 或 localhost），请使用 ZIP 导出'

const items: { key: keyof CodegenSelection; label: string; desc: string }[] = [
  { key: 'projectSkeleton', label: '工程骨架', desc: 'Cargo.toml / rust-toolchain / .cargo / build.rs / target json' },
  { key: 'vendorHal', label: '内嵌 HAL 源码', desc: 'vendor/ch32-hal 完整库（path 依赖，便于查阅代码）' },
  { key: 'clock', label: '时钟配置', desc: 'generated/clock.rs' },
  { key: 'pins', label: 'GPIO 引脚', desc: 'generated/pins.rs' },
  { key: 'exti', label: 'EXTI', desc: 'generated/exti.rs（有配置时）' },
  { key: 'usart', label: 'USART', desc: 'generated/usart.rs' },
  { key: 'spi', label: 'SPI', desc: 'generated/spi.rs' },
  { key: 'i2c', label: 'I2C', desc: 'generated/i2c.rs' },
  { key: 'adc', label: 'ADC', desc: 'generated/adc.rs' },
  { key: 'readme', label: 'README', desc: '说明文档' },
]

const errorCount = computed(() => store.errorCount)

async function exportConfigOnly() {
  store.setProjectName(projectName.value || 'ch32-project')
  try {
    const saved = await downloadProjectFile(store.config)
    if (saved) store.notify(`已导出 ${store.config.projectName}.cube.json`, 'info')
  } catch (e) {
    store.notify(`保存配置失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** 目录选择必须在用户点击手势内直接调用（中间不能先 await 其它操作）。 */
async function pickDirectory(): Promise<FsDirectoryHandleLike> {
  const picker = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker
  if (!picker) throw new Error('当前浏览器不支持目录写入')
  return picker.call(window, { mode: 'readwrite' })
}

/** 按 'a/b/c.rs' 逐级建目录并写入内容（File System Access API）。 */
async function writeFileAt(root: FsDirectoryHandleLike, path: string, data: string | Uint8Array): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  const fileName = segments.pop()
  if (!fileName) return
  let dir = root
  for (const seg of segments) dir = await dir.getDirectoryHandle(seg, { create: true })
  const file = await dir.getFileHandle(fileName, { create: true })
  const writable = await file.createWritable()
  await writable.write(data)
  await writable.close()
}

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError'
}

interface PreparedExport {
  files: GeneratedFile[]
  vendorEntries: { path: string; data: Uint8Array }[]
  snapshot: Record<string, string>
}

/** ZIP 与目录导出共用同一份生成结果（含 vendor 源码解包）。 */
async function prepareExport(): Promise<PreparedExport | null> {
  store.setProjectName(projectName.value || 'ch32-project')
  const result = generateProject(store.config, store.deviceData, { ...selection })
  if (result.errors.length > 0) {
    store.notify(`导出被阻止：${result.errors[0].message}`, 'error')
    return null
  }
  // 单核为 src/main.rs，双核 workspace 为 <核>/src/main.rs：都算用户区
  const files = result.files.filter((f) => !/(^|\/)src\/main\.rs$/.test(f.path) || includeMain.value)
  const snapshot: Record<string, string> = {}
  for (const f of files) snapshot[f.path] = f.content

  const vendorEntries: { path: string; data: Uint8Array }[] = []
  if (selection.vendorHal) {
    const resp = await fetch(`${import.meta.env.BASE_URL}vendor/ch32-hal.zip`)
    if (!resp.ok) throw new Error(`HAL 源码包加载失败：${resp.status}（先运行 npm run vendor:hal）`)
    const halZip = await JSZip.loadAsync(await resp.arrayBuffer())
    // zip 内路径已含 ch32-hal/ 前缀 → 统一写为 vendor/ch32-hal/...
    for (const e of Object.values(halZip.files).filter((x) => !x.dir)) {
      vendorEntries.push({ path: `vendor/${e.name}`, data: await e.async('uint8array') })
    }
  }
  return { files, vendorEntries, snapshot }
}

async function doExportZip() {
  if (generating.value || writingFolder.value) return
  generating.value = true
  try {
    const prepared = await prepareExport()
    if (!prepared) return
    const zip = new JSZip()
    const folder = zip.folder(store.config.projectName)!
    for (const f of prepared.files) folder.file(f.path, f.content)
    for (const v of prepared.vendorEntries) folder.file(v.path, v.data)
    const blob = await zip.generateAsync({ type: 'blob' })
    if (desktop) {
      // WebKitGTK 不处理 <a download>：走原生保存对话框
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const saved = await saveFileNative(`${store.config.projectName}.zip`, bytes, [
        { name: 'ZIP 压缩包', extensions: ['zip'] },
      ])
      if (!saved) return
    } else {
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url
      el.download = `${store.config.projectName}.zip`
      el.click()
      URL.revokeObjectURL(url)
    }
    store.setExportSnapshot(prepared.snapshot)
    store.notify(`已导出 ${prepared.files.length} 个文件${selection.vendorHal ? ' + 完整 HAL 源码' : ''}（${store.config.projectName}.zip）`, 'info')
    visible.value = false
  } catch (e) {
    store.notify(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    generating.value = false
  }
}

async function doExportFolder() {
  if (writingFolder.value || generating.value || !canWriteFolder) return
  writingFolder.value = true
  try {
    if (desktop) {
      // 桌面端：原生目录选择 + Rust 写盘（WebKitGTK 无 File System Access API）
      const dir = await pickFolderNative('选择工程导出目录')
      if (!dir) return
      const prepared = await prepareExport()
      if (!prepared) return
      const entries = [
        ...prepared.files.map((f) => ({ path: f.path, data: f.content })),
        ...prepared.vendorEntries.map((v) => ({ path: v.path, data: v.data })),
      ]
      const written = await writeFolderNative(dir, entries)
      store.setExportSnapshot(prepared.snapshot)
      store.notify(`已写入 ${written} 个文件到 ${dir}`, 'info')
      visible.value = false
      return
    }
    // 浏览器：先请求目录（必须直接处于用户点击手势内）
    const dir = await pickDirectory()
    const prepared = await prepareExport()
    if (!prepared) return
    let written = 0
    for (const f of prepared.files) {
      await writeFileAt(dir, f.path, f.content)
      written++
    }
    for (const v of prepared.vendorEntries) {
      await writeFileAt(dir, v.path, v.data)
      written++
    }
    store.setExportSnapshot(prepared.snapshot)
    store.notify(`已写入 ${written} 个文件到 ${dir.name}/`, 'info')
    visible.value = false
  } catch (e) {
    // 用户取消目录选择：静默返回
    if (isAbortError(e)) return
    store.notify(`写入目录失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    writingFolder.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="生成 Rust 工程" width="640px">
    <el-alert v-if="errorCount > 0" type="error" :closable="false" class="export-alert"
      :title="`存在 ${errorCount} 个错误级冲突，导出将被阻止。请先在冲突面板修复。`" />
    <div class="form-row">
      <label>工程名</label>
      <el-input v-model="projectName" size="small" style="width: 240px" placeholder="ch32-project" />
    </div>
    <div class="selection-grid">
      <el-checkbox v-for="it in items" :key="it.key" v-model="selection[it.key]">
        <span class="sel-label">{{ it.label }}</span>
        <span class="sel-desc">{{ it.desc }}</span>
      </el-checkbox>
    </div>
    <el-checkbox v-model="includeMain" class="main-check">
      包含 src/main.rs 骨架（双核为各核 src/main.rs；已有自己的 main.rs 时取消勾选，生成器永不覆盖用户文件）
    </el-checkbox>
    <p class="hint">cube.json（配置回读）与 generated/mod.rs 始终生成。导出后可直接 <code>cargo build --release</code>。</p>
    <template #footer>
      <div class="dialog-footer">
        <el-button plain @click="exportConfigOnly">仅导出配置 (cube.json)</el-button>
        <el-button @click="visible = false">取消</el-button>
        <el-button plain :icon="Download" :loading="generating" :disabled="errorCount > 0 || writingFolder" @click="doExportZip">
          导出 ZIP
        </el-button>
        <el-tooltip :content="folderHint" :disabled="!folderHint" placement="top">
          <span class="folder-btn-wrap">
            <el-button
              type="primary"
              :icon="FolderOpened"
              :loading="writingFolder"
              :disabled="errorCount > 0 || generating || !canWriteFolder"
              @click="doExportFolder"
            >
              {{ writingFolder ? '正在写入…' : '导出到文件夹' }}
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.export-alert {
  margin-bottom: 12px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.form-row label {
  font-size: 13px;
  color: var(--mx-text-secondary);
}
.selection-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 20px;
  margin-bottom: 12px;
}
/* Element Plus 默认 white-space:nowrap + 固定高度会把右列文字裁掉，这里允许换行 */
.selection-grid :deep(.el-checkbox) {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  width: 100%;
  height: auto;
  margin-right: 0;
  white-space: normal;
}
.selection-grid :deep(.el-checkbox__input) {
  flex-shrink: 0;
  margin-top: 1px;
}
.selection-grid :deep(.el-checkbox__label) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.sel-label {
  font-weight: 600;
  margin-right: 4px;
}
.sel-desc {
  font-size: 11px;
  color: var(--mx-text-muted);
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.main-check {
  display: flex;
  align-items: flex-start;
  height: auto;
  margin-bottom: 8px;
  white-space: normal;
}
.main-check :deep(.el-checkbox__input) {
  flex-shrink: 0;
  margin-top: 1px;
}
.main-check :deep(.el-checkbox__label) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.dialog-footer {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dialog-footer :deep(.el-button) {
  flex-shrink: 0;
  margin-left: 0;
}
.folder-btn-wrap {
  display: inline-block;
  flex-shrink: 0;
}
.hint {
  font-size: 12px;
  color: var(--mx-text-muted);
  margin: 0;
}
</style>