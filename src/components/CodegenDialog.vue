<script setup lang="ts">
// 代码生成导出对话框（视图层）：子项选择 + 触发导出 + 结果报告。
// 生成/打包/落盘编排全部在 services/projectExport.ts；本组件只管理选项、提示与报告数据组装。
import { computed, reactive, ref, watch } from 'vue'
import { Download, FolderOpened } from '@element-plus/icons-vue'
import { useProjectStore } from '@/controllers/project'
import { downloadProjectFile } from '@/services/projectFile'
import {
  ExportBlockedError,
  exportAsZip,
  folderExportHint,
  isAbortError,
  pickExportFolder,
  prepareExport,
  supportsFolderExport,
  type ConflictResolutions,
  type FolderExportInspection,
  type FolderExportResult,
  type FolderExportTarget,
  type PreparedExport,
  type ZipExportResult,
} from '@/services/projectExport'
import { DEFAULT_SELECTION, type CodegenSelection } from '@/model/types'
import { preflight, type PreflightReport } from '@/model/preflight'
import ExportPlanPreview from '@/components/codegen/ExportPlanPreview.vue'
import ConflictRules from '@/components/codegen/ConflictRules.vue'
import CheckDialog from '@/components/codegen/CheckDialog.vue'
import GenerationReport, { type GenerationReportData, type GenerationReportFile } from '@/components/codegen/GenerationReport.vue'

const store = useProjectStore()
const visible = defineModel<boolean>({ default: false })

const selection = reactive<CodegenSelection>({ ...DEFAULT_SELECTION })
const includeMain = ref(true)
const projectName = ref(store.projectName)
const generating = ref(false)
const writingFolder = ref(false)

// 导出成功后的结果页（M4.2）：报告替代成功 toast，关闭对话框时清空。
const report = ref<GenerationReportData | null>(null)
watch(visible, (open) => {
  if (!open) report.value = null
})

// 目录导出两段式：inspect 预览 → （有冲突/删除时）用户决议 → 确认写入。
interface PendingFolder {
  target: FolderExportTarget
  prepared: PreparedExport
  inspection: FolderExportInspection
}
const pendingFolder = ref<PendingFolder | null>(null)
const resolutions = ref<ConflictResolutions>({})
const conflictEntries = computed(() =>
  (pendingFolder.value?.inspection.plan ?? []).filter((e) => e.action === 'conflict'),
)

const canWriteFolder = supportsFolderExport()
const folderHint = folderExportHint()

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

// ---------- 生成前 Check（M3.7） ----------
/** 导出前检查摘要：用于提示数量；真正阻断/确认在 gateExport 中弹 CheckDialog。 */
const checkSummary = computed(() => preflight(store.config, store.deviceData))
const errorCount = computed(() => checkSummary.value.errors.length)
const warningCount = computed(() => checkSummary.value.warnings.length)

const showCheck = ref(false)
const checkReport = ref<PreflightReport>({ errors: [], warnings: [] })
/** 通过 CheckDialog 继续后要执行的导出动作 */
const pendingExport = ref<'zip' | 'folder' | null>(null)

/** 导出前 preflight：无问题直接放行；有 error/warning 弹 CheckDialog（error 必须修复）。 */
function gateExport(action: 'zip' | 'folder'): boolean {
  checkReport.value = preflight(store.config, store.deviceData)
  if (checkReport.value.errors.length === 0 && checkReport.value.warnings.length === 0) return true
  pendingExport.value = action
  showCheck.value = true
  return false
}

/** CheckDialog「我已知晓，继续」：执行被暂缓的导出。 */
function proceedAfterCheck() {
  const action = pendingExport.value
  pendingExport.value = null
  if (action === 'zip') void runExportZip()
  else if (action === 'folder') void runExportFolder()
}

/** CheckDialog 条目定位：关闭生成本身，露出被定位的视图。 */
function onCheckLocate() {
  pendingExport.value = null
  visible.value = false
}

async function exportConfigOnly() {
  store.setProjectName(projectName.value || 'ch32-project')
  try {
    const saved = await downloadProjectFile(store.config)
    if (saved) store.notify(`已导出 ${store.config.projectName}.cube.json`, 'info')
  } catch (e) {
    store.notify(`保存配置失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** 导出前检查中用户已确认的警告（报告页展示；无警告为空数组）。 */
function confirmedWarnings(): string[] {
  return checkReport.value.warnings.map((w) => w.message)
}

/** ZIP 导出报告：归档内全部文件按 create 展示；manifest 一并打包。 */
function buildZipReport(
  prepared: PreparedExport,
  result: ZipExportResult,
  elapsedMs: number,
): GenerationReportData {
  const files: GenerationReportFile[] = [
    ...prepared.files.map((f) => ({ path: f.path, action: 'create' as const })),
    ...prepared.vendorEntries.map((v) => ({ path: v.path, action: 'create' as const })),
  ]
  return {
    mode: 'zip',
    projectName: store.config.projectName,
    target: `${store.config.projectName}.zip`,
    elapsedMs,
    written: result.written,
    deleted: 0,
    skipped: 0,
    backedUp: 0,
    manifestWritten: result.manifestWritten,
    files,
    summary: { create: files.length, update: 0, unchanged: 0, delete: 0, conflict: 0 },
    warnings: confirmedWarnings(),
    notes: selection.vendorHal ? ['ZIP 内含 vendor/ch32-hal 完整 HAL 源码。'] : [],
  }
}

/** 目录导出报告：逐文件动作来自 inspect plan，计数来自实际写入结果。 */
function buildFolderReport(
  result: FolderExportResult,
  inspection: FolderExportInspection,
  elapsedMs: number,
): GenerationReportData {
  const notes: string[] = []
  if (!result.readable) {
    notes.push('目标目录不可读：已按全量写入处理，未检测冲突，也未保留已有文件。')
  }
  return {
    mode: 'folder',
    projectName: store.config.projectName,
    target: result.root,
    targetPath: result.root,
    elapsedMs,
    written: result.written,
    deleted: result.deleted,
    skipped: result.skipped,
    backedUp: result.backedUp,
    manifestWritten: result.manifestWritten,
    files: inspection.plan.map((e) => ({ path: e.path, action: e.action })),
    summary: result.summary,
    warnings: confirmedWarnings(),
    notes,
  }
}

/** 生成并导出 ZIP（manifest 一并打包）；先经过 preflight 门禁。 */
async function doExportZip() {
  if (generating.value || writingFolder.value) return
  if (!gateExport('zip')) return
  await runExportZip()
}

async function runExportZip() {
  if (generating.value || writingFolder.value) return
  generating.value = true
  const startedAt = Date.now()
  try {
    store.setProjectName(projectName.value || 'ch32-project')
    const prepared = await prepareExport(store.config, store.deviceData, { ...selection }, includeMain.value)
    const result = await exportAsZip(prepared, store.config.projectName)
    if (result === null) return // 用户在保存对话框中取消
    store.setExportSnapshot(prepared.snapshot)
    // 成功不关闭对话框：切到结果页，由用户点「完成」关闭（M4.2）
    report.value = buildZipReport(prepared, result, Date.now() - startedAt)
  } catch (e) {
    if (e instanceof ExportBlockedError) {
      store.notify(`导出被阻止：${e.message}`, 'error')
      return
    }
    store.notify(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    generating.value = false
  }
}

/** 实际写盘并收尾（预览确认后 / 无冲突时直接调用）；成功后展示结果报告。 */
async function writeFolder(
  target: FolderExportTarget,
  prepared: PreparedExport,
  inspection: FolderExportInspection,
  userResolutions?: ConflictResolutions,
  startedAt = Date.now(),
) {
  const result = await target.write(prepared, {
    plan: inspection.plan,
    disk: inspection.disk,
    manifest: inspection.manifest,
    readable: inspection.readable,
    resolutions: userResolutions,
  })
  store.setExportSnapshot(prepared.snapshot)
  report.value = buildFolderReport(result, inspection, Date.now() - startedAt)
  pendingFolder.value = null
  resolutions.value = {}
}

/** 生成并写入目录：先经过 preflight 门禁，再选目录（用户手势内）→ inspect 预览。 */
async function doExportFolder() {
  if (writingFolder.value || generating.value || !canWriteFolder) return
  if (!gateExport('folder')) return
  await runExportFolder()
}

async function runExportFolder() {
  if (writingFolder.value || generating.value || !canWriteFolder) return
  writingFolder.value = true
  try {
    const target = await pickExportFolder()
    if (!target) return // 用户取消
    const startedAt = Date.now()
    const prepared = await prepareExport(store.config, store.deviceData, { ...selection }, includeMain.value)
    const inspection = await target.inspect(prepared)
    const needsReview = inspection.summary.conflict > 0 || inspection.summary.delete > 0
    if (needsReview) {
      // 进入预览/决议步骤：默认 resolution 取自 plan，用户可逐个改
      pendingFolder.value = { target, prepared, inspection }
      resolutions.value = {}
      return
    }
    await writeFolder(target, prepared, inspection, undefined, startedAt)
  } catch (e) {
    if (e instanceof ExportBlockedError) {
      store.notify(`导出被阻止：${e.message}`, 'error')
      return
    }
    if (isAbortError(e)) return // 用户取消目录选择
    store.notify(`写入目录失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    writingFolder.value = false
  }
}

/** 预览步骤：用户确认决议后写盘。 */
async function confirmFolderWrite() {
  const pending = pendingFolder.value
  if (!pending || writingFolder.value) return
  writingFolder.value = true
  const startedAt = Date.now()
  try {
    await writeFolder(pending.target, pending.prepared, pending.inspection, resolutions.value, startedAt)
  } catch (e) {
    store.notify(`写入目录失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    writingFolder.value = false
  }
}

/** 预览步骤：返回选项页（放弃本次目录导出）。 */
function cancelFolderPreview() {
  pendingFolder.value = null
  resolutions.value = {}
}

/** 结果页「完成」：关闭对话框并清空报告。 */
function finishReport() {
  report.value = null
  visible.value = false
}
</script>


<template>
  <el-dialog
    v-model="visible"
    :title="report ? '生成结果' : '生成 Rust 工程'"
    :width="report ? '760px' : '640px'"
  >
    <!-- 导出结果报告（M4.2）：ZIP 与目录导出成功后显示 -->
    <template v-if="report">
      <GenerationReport :report="report" />
    </template>

    <!-- 选项页 -->
    <template v-else-if="!pendingFolder">
      <el-alert v-if="errorCount > 0" type="error" :closable="false" class="export-alert"
        :title="`生成前检查发现 ${errorCount} 个错误，导出将被阻止。点击导出可查看报告并定位。`" />
      <el-alert v-else-if="warningCount > 0" type="warning" :closable="false" class="export-alert"
        :title="`生成前检查发现 ${warningCount} 个警告，导出前需确认。`" />
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
      <div class="form-row gen-options">
        <label>构建档位</label>
        <el-select v-model="selection.profile" size="small" style="width: 170px">
          <el-option label="体积优先 (release-size)" value="release-size" />
          <el-option label="速度优先 (release-speed)" value="release-speed" />
          <el-option label="可调试 (release-debug)" value="release-debug" />
        </el-select>
        <label>IDE 配置</label>
        <el-select v-model="selection.ideConfig" size="small" style="width: 130px">
          <el-option label="不生成" value="none" />
          <el-option label="VS Code" value="vscode" />
        </el-select>
      </div>
      <el-checkbox v-model="includeMain" class="main-check">
        包含 src/main.rs 骨架（双核为各核 src/main.rs；已有自己的 main.rs 时取消勾选，生成器永不覆盖用户文件）
      </el-checkbox>
      <p class="hint">cube.json（配置回读）与 generated/mod.rs 始终生成。导出后可直接 <code>cargo build --release</code>。</p>
    </template>

    <!-- 目录导出预览/冲突决议页 -->
    <template v-else>
      <ExportPlanPreview
        :plan="pendingFolder.inspection.plan"
        :summary="pendingFolder.inspection.summary"
        :readable="pendingFolder.inspection.readable"
        :manifest-found="pendingFolder.inspection.manifestFound"
      />
      <ConflictRules v-if="conflictEntries.length > 0" :conflicts="conflictEntries" v-model="resolutions" />
    </template>

    <template #footer>
      <div v-if="report" class="dialog-footer">
        <el-button type="primary" @click="finishReport">完成</el-button>
      </div>
      <div v-else-if="!pendingFolder" class="dialog-footer">
        <el-button plain @click="exportConfigOnly">仅导出配置 (cube.json)</el-button>
        <el-button @click="visible = false">取消</el-button>
        <el-button plain :icon="Download" :loading="generating" :disabled="writingFolder" @click="doExportZip">
          导出 ZIP
        </el-button>
        <el-tooltip :content="folderHint" :disabled="!folderHint" placement="top">
          <span class="folder-btn-wrap">
            <el-button
              type="primary"
              :icon="FolderOpened"
              :loading="writingFolder"
              :disabled="generating || !canWriteFolder"
              @click="doExportFolder"
            >
              {{ writingFolder ? '正在准备…' : '导出到文件夹' }}
            </el-button>
          </span>
        </el-tooltip>
      </div>
      <div v-else class="dialog-footer">
        <el-button :disabled="writingFolder" @click="cancelFolderPreview">返回</el-button>
        <el-button type="primary" :icon="FolderOpened" :loading="writingFolder" @click="confirmFolderWrite">
          {{ writingFolder ? '正在写入…' : '确认写入' }}
        </el-button>
      </div>
    </template>

    <!-- 生成前检查报告：error 阻止，warning 可“我已知晓，继续” -->
    <CheckDialog v-model="showCheck" :report="checkReport" @continue="proceedAfterCheck" @locate="onCheckLocate" />
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