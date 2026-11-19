// 生成流程编排（M7：决议入页）：原 CodegenDialog 的选项/门禁/两段式目录导出/结果报告
// 全部移入 Project settings 页内消费，不再有任何二次决议弹窗（对齐 CubeMX2）。
// 本 composable 只管状态与编排；落盘/打包仍在 services/projectExport，检查仍在 model/preflight。
import { computed, reactive, ref, watch } from 'vue'
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
import { resolveGroupDefaults } from '@/services/exportPlan'
import { preflight, type PreflightReport } from '@/model/preflight'
import type { GenerationReportData, GenerationReportFile } from '@/components/codegen/GenerationReport.vue'

/** 生成门禁决议（纯函数，供单测）：error 阻止；warning 需页内勾选确认；其余放行。 */
export type GenerationGate = 'go' | 'block' | 'need-ack'
export function generationGate(report: PreflightReport, warnAcknowledged: boolean): GenerationGate {
  if (report.errors.length > 0) return 'block'
  if (report.warnings.length > 0 && !warnAcknowledged) return 'need-ack'
  return 'go'
}

/** 目录导出两段式的待决议状态（页内「导出预览」段消费）。 */
export interface PendingFolder {
  target: FolderExportTarget
  prepared: PreparedExport
  inspection: FolderExportInspection
}

export interface GenerationItem {
  key: keyof CodegenSelection
  label: string
  desc: string
}

/**
 * 生成子项清单（页内复选框；与 CubeMX2 的 General Setup 决议同位）。
 * vendorHal 文案随芯片 HAL 后端变化（M11：ch32-hal / ch58x-hal），其余项后端无关。
 */
export function generationItemsFor(halBackend?: string): GenerationItem[] {
  const hal = halBackend ?? 'ch32-hal'
  return [
    { key: 'projectSkeleton', label: '工程骨架', desc: 'Cargo.toml / rust-toolchain / .cargo / build.rs / target json' },
    { key: 'vendorHal', label: '内嵌 HAL 源码', desc: `vendor/${hal} 完整库（path 依赖，便于查阅代码）` },
    { key: 'clock', label: '时钟配置', desc: 'generated/clock.rs' },
    { key: 'pins', label: 'GPIO 引脚', desc: 'generated/pins.rs' },
    { key: 'exti', label: 'EXTI', desc: 'generated/exti.rs（有配置时）' },
    { key: 'usart', label: 'USART', desc: 'generated/usart.rs' },
    { key: 'spi', label: 'SPI', desc: 'generated/spi.rs' },
    { key: 'i2c', label: 'I2C', desc: 'generated/i2c.rs' },
    { key: 'adc', label: 'ADC', desc: 'generated/adc.rs' },
    { key: 'readme', label: 'README', desc: '说明文档' },
    { key: 'htmlReport', label: 'HTML 报告', desc: 'report.html 单文件工程报告（浏览器直接打开）' },
  ]
}

export function useGenerationFlow() {
  const store = useProjectStore()

  const selection = reactive<CodegenSelection>({ ...DEFAULT_SELECTION })
  const includeMain = ref(true)
  const generating = ref(false)
  const writingFolder = ref(false)

  // 导出方式（页内决议，对齐 CubeMX2 Destination）：zip=下载/原生保存；folder=写本地目录
  const exportMode = ref<'zip' | 'folder'>('zip')
  const folderTarget = ref<FolderExportTarget | null>(null)
  const canWriteFolder = supportsFolderExport()
  const folderHint = folderExportHint()

  // 结果报告（页内「生成结果」段）
  const report = ref<GenerationReportData | null>(null)

  // 目录导出两段式：inspect 预览 →（有冲突/删除时）页内逐项决议 → 确认写入
  const pendingFolder = ref<PendingFolder | null>(null)
  const resolutions = ref<ConflictResolutions>({})
  // M8 类别级冲突策略：工程级 conflict 默认决议（safe 时为空表，逐文件决议仍可覆盖）
  const groupDefaults = computed(() => resolveGroupDefaults(store.config.conflictPolicy))
  const conflictEntries = computed(() =>
    (pendingFolder.value?.inspection.plan ?? []).filter((e) => e.action === 'conflict'),
  )

  // 生成前检查：页内常驻面板（不再弹 CheckDialog）
  const checkReport = computed(() => preflight(store.config, store.deviceData))
  const warnAcknowledged = ref(false)
  // 警告内容变化后确认失效，需重新勾选
  watch(
    () => checkReport.value.warnings.map((w) => w.message).join('|'),
    () => {
      warnAcknowledged.value = false
    },
  )

  /** 页内选择导出目录（用户手势内调用）；成功后切到 folder 模式。 */
  async function pickFolder() {
    if (!canWriteFolder) return
    try {
      const target = await pickExportFolder()
      if (!target) return
      folderTarget.value = target
      exportMode.value = 'folder'
    } catch (e) {
      if (isAbortError(e)) return
      store.notify(`选择目录失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  /** 仅导出配置（cube.json）。 */
  async function exportConfigOnly() {
    try {
      const saved = await downloadProjectFile(store.config)
      if (saved) store.notify(`已导出 ${store.config.projectName}.cube.json`, 'info')
    } catch (e) {
      store.notify(`保存配置失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  /** 已确认的警告（报告页展示）：未勾选确认时为空。 */
  function confirmedWarnings(): string[] {
    return warnAcknowledged.value ? checkReport.value.warnings.map((w) => w.message) : []
  }

  function buildZipReport(prepared: PreparedExport, result: ZipExportResult, elapsedMs: number): GenerationReportData {
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
      notes: [
        ...(selection.vendorHal
          ? [
              // M11/M17：按生效 HAL 后端标注实际内嵌目录（ch32-hal / ch58x-hal / ch5xx-hal）
              `ZIP 内含 vendor/${store.effectiveHalBackend} 完整 HAL 源码。`,
            ]
          : []),
        ...(selection.htmlReport ? ['report.html 为单文件工程报告，浏览器直接打开即可查阅。'] : []),
      ],
    }
  }

  function buildFolderReport(
    result: FolderExportResult,
    inspection: FolderExportInspection,
    elapsedMs: number,
  ): GenerationReportData {
    const notes: string[] = []
    if (!result.readable) {
      notes.push('目标目录不可读：已按全量写入处理，未检测冲突，也未保留已有文件。')
    }
    if (selection.htmlReport) {
      notes.push('report.html 为单文件工程报告，浏览器直接打开即可查阅。')
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

  async function runExportZip() {
    if (generating.value || writingFolder.value) return
    generating.value = true
    const startedAt = Date.now()
    try {
      const prepared = await prepareExport(store.config, store.deviceData, { ...selection }, includeMain.value)
      const result = await exportAsZip(prepared, store.config.projectName)
      if (result === null) return // 用户在保存对话框中取消
      store.setExportSnapshot(prepared.snapshot)
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

  /** 实际写盘并收尾（预览确认后 / 无冲突时直接调用）；成功后页内展示结果报告。 */
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
      groupDefaults: groupDefaults.value,
    })
    store.setExportSnapshot(prepared.snapshot)
    report.value = buildFolderReport(result, inspection, Date.now() - startedAt)
    pendingFolder.value = null
    resolutions.value = {}
  }

  async function runExportFolder() {
    if (writingFolder.value || generating.value || !canWriteFolder) return
    writingFolder.value = true
    try {
      // 页内已选目录优先；未选则在当前用户手势内补选
      const target = folderTarget.value ?? (await pickExportFolder())
      if (!target) return // 用户取消
      folderTarget.value = target
      const startedAt = Date.now()
      const prepared = await prepareExport(store.config, store.deviceData, { ...selection }, includeMain.value)
      const inspection = await target.inspect(prepared, { groupDefaults: groupDefaults.value })
      const needsReview = inspection.summary.conflict > 0 || inspection.summary.delete > 0
      if (needsReview) {
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

  /** 页内「生成工程」主按钮：门禁决议全部在页内完成（error 阻止 / warning 需勾选）。 */
  async function generate() {
    if (generating.value || writingFolder.value) return
    const gate = generationGate(checkReport.value, warnAcknowledged.value)
    if (gate === 'block') {
      store.notify(`存在 ${checkReport.value.errors.length} 个错误级冲突，请先在页内检查面板定位修复`, 'error')
      return
    }
    if (gate === 'need-ack') {
      store.notify('存在警告：请在检查面板下方勾选「我已知晓警告」后再生成', 'warning')
      return
    }
    report.value = null
    if (exportMode.value === 'zip') await runExportZip()
    else await runExportFolder()
  }

  /** 预览段「确认写入」：用户逐项决议后写盘。 */
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

  /** 预览段「返回」：放弃本次目录导出决议。 */
  function cancelFolderPreview() {
    pendingFolder.value = null
    resolutions.value = {}
  }

  /** 结果段「完成」：清空报告回到选项态。 */
  function finishReport() {
    report.value = null
  }

  return {
    selection,
    includeMain,
    generating,
    writingFolder,
    exportMode,
    folderTarget,
    canWriteFolder,
    folderHint,
    report,
    pendingFolder,
    resolutions,
    conflictEntries,
    checkReport,
    warnAcknowledged,
    pickFolder,
    exportConfigOnly,
    generate,
    confirmFolderWrite,
    cancelFolderPreview,
    finishReport,
  }
}