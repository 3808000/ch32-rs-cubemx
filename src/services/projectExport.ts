// 工程导出应用服务：封装「生成 → 内嵌 vendor HAL → 打包/落盘」的完整流程。
// 视图层（CodegenDialog）只负责选项与提示，IO 与编排全部在本层完成；
// 桌面端（Tauri）与浏览器按运行环境自动分流（desktop.ts）。
//
// M1 再生成安全网：
// - 目录导出先读取目标目录现状 + `.ch32cube/export-manifest.json`，构建逐文件 plan；
// - 按文件组执行保护策略（generated 重写、project_file 生成一次、Cargo.toml 标记区合并、
//   pack/user_code 已存在不覆盖），conflict 默认跳过；
// - 导出结束写回 manifest（ZIP 与目录导出都写），便于下次跨会话比较。
import JSZip from 'jszip'
import {
  MANIFEST_PATH,
  buildManifest,
  classifyFileGroup,
  generateProject,
  parseManifest,
  serializeManifest,
} from '@/model/codegen'
import type {
  CodegenSelection,
  ConflictResolution,
  DeviceData,
  ExportManifest,
  ExportPlanEntry,
  FileGroup,
  GeneratedFile,
  ProjectConfig,
} from '@/model/types'
import {
  isDesktopApp,
  pickFolderNative,
  readFolderNative,
  removeFileNative,
  saveFileNative,
  writeFolderNative,
} from '@/services/desktop'
import {
  buildExportPlan,
  normalizeRelPath,
  summarizeExportPlan,
  type DiskSnapshot,
  type ExportPlanInputEntry,
  type ExportPlanSummary,
  type GroupDefaults,
} from '@/services/exportPlan'

/** 生成器标识：写入 manifest，便于未来做版本迁移/告警。 */
export const GENERATOR = { name: 'ch32-rs-CubeMX', version: '0.1.0' } as const

export interface PreparedExport {
  /** 生成的工程文件（已按 includeMain 过滤 main.rs） */
  files: GeneratedFile[]
  /** vendor/ch32-hal 内嵌源码（二进制条目） */
  vendorEntries: { path: string; data: Uint8Array }[]
  /** 导出快照（用于 diff 预览） */
  snapshot: Record<string, string>
  /** 生成时使用的配置（manifest 的 configHash 来源） */
  config: ProjectConfig
}

/** 生成工程内容并解包 vendor HAL 源码（ZIP 与目录导出共用）。 */
export async function prepareExport(
  config: ProjectConfig,
  data: DeviceData,
  selection: CodegenSelection,
  includeMain: boolean,
): Promise<PreparedExport> {
  const result = generateProject(config, data, { ...selection })
  if (result.errors.length > 0) {
    throw new ExportBlockedError(result.errors[0].message)
  }
  // 单核为 src/main.rs，双核 workspace 为 <核>/src/main.rs：都算用户区
  const files = result.files.filter((f) => !/(^|\/)src\/main\.rs$/.test(f.path) || includeMain)
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
  return { files, vendorEntries, snapshot, config }
}

/** 错误级冲突导致导出被阻止（调用方据此展示原因，不再继续）。 */
export class ExportBlockedError extends Error {}

// ---------- 浏览器目录读写（File System Access API） ----------
// 最小类型声明：TS 5.6 DOM lib 尚不完整。

interface FsWritableLike {
  write(data: string | Uint8Array): Promise<void>
  close(): Promise<void>
}

interface FsFileHandleLike {
  readonly name: string
  createWritable(): Promise<FsWritableLike>
  getFile(): Promise<File>
}

interface FsDirectoryHandleLike {
  readonly name: string
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  values(): AsyncIterableIterator<FsFileHandleLike | FsDirectoryHandleLike>
}

type ShowDirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirectoryHandleLike>

/** 目录写入能力：Chromium 系（安全上下文）或 Tauri 桌面端。 */
export function supportsFolderExport(): boolean {
  const browser = 'showDirectoryPicker' in window && window.isSecureContext
  return browser || isDesktopApp()
}

/** 不支持目录导出时的提示文案（空串 = 支持）。 */
export function folderExportHint(): string {
  if (supportsFolderExport()) return ''
  return 'showDirectoryPicker' in window
    ? '当前页面不是安全上下文（需 HTTPS 或 localhost），请使用 ZIP 导出'
    : '当前浏览器不支持目录写入，请使用 ZIP 导出'
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

/** 删除 'a/b/c.rs'（仅用于 generated 组清理）；父目录/文件不存在视为成功。 */
async function removeFileAt(root: FsDirectoryHandleLike, path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  const fileName = segments.pop()
  if (!fileName) return
  let dir = root
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg)
    } catch {
      return
    }
  }
  try {
    await dir.removeEntry(fileName)
  } catch {
    // 文件已不存在：与 Rust remove_file 行为一致，视为成功
  }
}

/** 递归读取目录现状；跳过 target/ 与 .git/（与桌面端一致）。 */
async function readBrowserDisk(root: FsDirectoryHandleLike): Promise<DiskSnapshot> {
  const disk: DiskSnapshot = {}
  async function walk(dir: FsDirectoryHandleLike, prefix: string): Promise<void> {
    for await (const child of dir.values()) {
      if ('values' in child) {
        if (child.name === 'target' || child.name === '.git') continue
        await walk(child, `${prefix}${child.name}/`)
      } else {
        const file = await child.getFile()
        disk[`${prefix}${child.name}`] = new Uint8Array(await file.arrayBuffer())
      }
    }
  }
  await walk(root, '')
  return disk
}

/** 用户在原生/浏览器目录选择中取消。 */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError'
}

// ---------- 目录导出 plan / manifest ----------

/** 目录读取 + plan 构建结果（UI 预览用）。 */
export interface FolderExportInspection {
  plan: ExportPlanEntry[]
  summary: ExportPlanSummary
  /** 目标目录现状（write 时复用，避免二次读盘） */
  disk: DiskSnapshot
  /** 目录是否可读；false 时退化为「全量创建 + 提示」 */
  readable: boolean
  /** 是否读到有效的上次 manifest */
  manifestFound: boolean
  manifest: ExportManifest | null
}

/** 用户对 conflict 文件的逐项决定（path → resolution）。 */
export type ConflictResolutions = Record<string, ConflictResolution>

export interface FolderWriteOptions {
  /** inspect() 得到的 plan；不传则 write 内部重新读取并构建 */
  plan?: ExportPlanEntry[]
  /** inspect() 读到的目录现状 */
  disk?: DiskSnapshot
  /** inspect() 读到的 manifest（null = 无有效清单） */
  manifest?: ExportManifest | null
  /** inspect() 的目录可读性 */
  readable?: boolean
  /** 用户在冲突 UI 中的逐项选择；未列出的 conflict 按 groupDefaults / 组默认处理 */
  resolutions?: ConflictResolutions
  /** 类别级冲突策略默认值（M8）；逐文件 resolutions 优先，未传时与 M1 行为一致 */
  groupDefaults?: GroupDefaults
}

/** 目录导出结果：plan 摘要 + 实际执行计数。 */
export interface FolderExportResult {
  root: string
  readable: boolean
  /** 实际写入的工程文件数（不含 manifest 与 .bak 备份） */
  written: number
  /** 实际删除的 generated 文件数 */
  deleted: number
  /** 按组策略/冲突选择跳过、以及 unchanged 的文件数 */
  skipped: number
  /** 生成 .bak 备份数 */
  backedUp: number
  manifestWritten: boolean
  /** plan 中各动作计数（动作可能因组策略实际不执行，见 written/skipped） */
  summary: ExportPlanSummary
}

/** 目录导出目标：先选择（用户手势内），再 inspect（预览）→ write（确认后落盘）。 */
export interface FolderExportTarget {
  readonly root: string
  /** 读取目录现状并构建 plan，不写盘；groupDefaults 决定 conflict 条目的默认 resolution。 */
  inspect(
    prepared: PreparedExport,
    options?: { groupDefaults?: GroupDefaults },
  ): Promise<FolderExportInspection>
  /** 按 plan 写盘；不传 options 时自行读取目录并构建 plan。 */
  write(prepared: PreparedExport, options?: FolderWriteOptions): Promise<FolderExportResult>
}

/** 把 prepared 展开为带 group 的 plan 输入条目（工程文件 + vendor）。 */
function flatten(prepared: PreparedExport): ExportPlanInputEntry[] {
  return [
    ...prepared.files.map((f) => ({
      path: f.path,
      group: f.group ?? classifyFileGroup(f.path),
      data: f.content as string | Uint8Array,
    })),
    ...prepared.vendorEntries.map((v) => ({
      path: v.path,
      group: 'pack' as FileGroup,
      data: v.data as string | Uint8Array,
    })),
  ]
}

const textDecoder = new TextDecoder()

function decodeText(data: string | Uint8Array): string {
  return typeof data === 'string' ? data : textDecoder.decode(data)
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isCargoToml(path: string): boolean {
  return path.split('/').pop() === 'Cargo.toml'
}

function readManifestFromDisk(disk: DiskSnapshot): ExportManifest | null {
  if (!hasOwn(disk, MANIFEST_PATH)) return null
  return parseManifest(decodeText(disk[MANIFEST_PATH]))
}

async function inspectPrepared(
  prepared: PreparedExport,
  disk: DiskSnapshot,
  readable: boolean,
  groupDefaults?: GroupDefaults,
): Promise<FolderExportInspection> {
  const manifest = readManifestFromDisk(disk)
  const plan = await buildExportPlan(flatten(prepared), manifest, disk, groupDefaults)
  return {
    plan,
    summary: summarizeExportPlan(plan),
    disk,
    readable,
    manifestFound: manifest !== null,
    manifest,
  }
}

// ---------- Cargo.toml 标记区合并 ----------
// 只替换 `# >>> ch32-cubemx generated >>>` … `# <<<` 区间，保留用户写在标记区外的内容。
// 纯函数由 services/tomlMerge.ts（M1.6）提供，无标记区时保守返回原文件。
import { mergeCargoToml } from '@/services/tomlMerge'

// ---------- plan 执行 ----------

interface FolderWrite {
  path: string
  data: string | Uint8Array
}

interface FolderPlanExecution {
  deletes: string[]
  backups: FolderWrite[]
  writes: FolderWrite[]
  written: number
  deleted: number
  skipped: number
  summary: ExportPlanSummary
  manifestWritten: boolean
}

/**
 * 按 plan 计算实际写盘操作与下一份 manifest（纯计算，不做 IO；导出以便单测策略优先级）。
 *
 * 组策略在此层生效（plan 只描述内容差异，不改变 CubeMX 式文件组保护）：
 * - generated：update/overwrite 写入；conflict 默认 skip（用户选择 / M8 类别级策略可覆盖）；
 * - project_file：已存在默认不覆盖（生成一次）；Cargo.toml 走标记区合并；
 * - pack：已存在默认跳过；
 * - user_code：已存在永不覆盖（硬保护，不受类别级策略影响）。
 * M8：conflict 默认 resolution = 逐文件 resolutions > groupDefaults[group] > 组原有默认；
 * 不传 groupDefaults 时行为与 M1 完全一致。
 */
export async function planFolderExecution(
  prepared: PreparedExport,
  plan: ExportPlanEntry[],
  disk: DiskSnapshot,
  manifest: ExportManifest | null,
  resolutions: ConflictResolutions | undefined,
  groupDefaults?: GroupDefaults,
): Promise<FolderPlanExecution> {
  const inputs = flatten(prepared)
  const inputByPath = new Map(inputs.map((e) => [normalizeRelPath(e.path), e]))
  const diskByPath = new Map(Object.entries(disk).map(([p, d]) => [normalizeRelPath(p), d]))
  const manifestByPath = new Map(
    (manifest?.files ?? []).map((e) => [normalizeRelPath(e.path), e]),
  )

  const deletes: string[] = []
  const backups: FolderWrite[] = []
  const writes: FolderWrite[] = []
  const finalData = new Map<string, { group: FileGroup; data: string | Uint8Array }>()
  // conflict 被跳过、且属于 generated 的文件：manifest 保留旧条目（而不是记录磁盘哈希），
  // 这样下次导出仍会再次提示冲突，避免静默覆盖用户改动。
  const preserveOldEntry = new Set<string>()
  let written = 0
  let skipped = 0

  for (const item of plan) {
    if (item.action !== 'delete') continue
    // 防御：只允许删除 generated 组
    if (item.group !== 'generated') {
      skipped++
      continue
    }
    deletes.push(normalizeRelPath(item.path))
  }

  for (const item of plan) {
    if (item.action === 'delete') continue
    const path = normalizeRelPath(item.path)
    const input = inputByPath.get(path)
    if (!input) {
      skipped++
      continue
    }
    const exists = diskByPath.has(path)
    const diskData = exists ? diskByPath.get(path)! : undefined
    const explicit = resolutions?.[path]
    const group = input.group

    if (item.action === 'unchanged') {
      skipped++
      if (exists) finalData.set(path, { group, data: diskData! })
      else finalData.set(path, { group, data: input.data })
      continue
    }

    // create（或 plan 与磁盘不一致时）：直接写入
    if (item.action === 'create' || !exists) {
      writes.push({ path, data: input.data })
      finalData.set(path, { group, data: input.data })
      written++
      continue
    }

    // 以下均为「磁盘已有该文件，且本次内容不同」（update / conflict）
    let mode: ConflictResolution
    if (group === 'user_code') {
      // 用户区永不覆盖（即使 plan 判为 update/conflict；类别级策略不适用于硬保护）
      mode = 'skip'
    } else if (item.action === 'conflict') {
      // M8 类别级策略：逐文件选择 > 策略默认 > 组原有默认。
      // 组原有默认：generated 取 plan 决议（缺省 skip）；Cargo.toml 走标记区合并；其它 skip。
      const fallback =
        group === 'generated'
          ? (item.resolution ?? 'skip')
          : group === 'project_file' && isCargoToml(path)
            ? 'base-merge'
            : 'skip'
      mode = explicit ?? groupDefaults?.[group] ?? fallback
    } else if (group === 'pack') {
      // vendor：已存在默认保留本地内容（update 动作不受类别级策略影响）
      mode = explicit ?? 'skip'
    } else if (group === 'project_file') {
      // 已存在默认不覆盖；Cargo.toml 默认走标记区合并
      mode = isCargoToml(path) ? (explicit ?? 'base-merge') : (explicit ?? 'skip')
    } else {
      // generated：update 默认可安全覆盖（manifest 证明用户没改过）
      mode = explicit ?? 'overwrite'
    }

    if (mode === 'skip') {
      skipped++
      if (group === 'generated' && item.action === 'conflict') preserveOldEntry.add(path)
      else if (exists) finalData.set(path, { group, data: diskData! })
      continue
    }

    let dataToWrite: string | Uint8Array = input.data
    if (mode === 'base-merge' && isCargoToml(path)) {
      const existingText = decodeText(diskData!)
      const generatedText = decodeText(input.data)
      const merged = mergeCargoToml(existingText, generatedText)
      if (merged === existingText) {
        skipped++
        finalData.set(path, { group, data: diskData! })
        continue
      }
      dataToWrite = merged
    }
    // 非 Cargo 文件的 base-merge 没有标记区可合并：按覆盖处理（UI 有说明）
    if (mode === 'backup') backups.push({ path: `${path}.bak`, data: diskData! })

    writes.push({ path, data: dataToWrite })
    finalData.set(path, { group, data: dataToWrite })
    written++
  }

  // ---------- 下一份 manifest ----------
  const manifestInputs: ExportPlanInputEntry[] = []
  for (const [path, value] of finalData) {
    if (preserveOldEntry.has(path)) continue
    manifestInputs.push({ path, group: value.group, data: value.data })
  }
  // 上次 manifest 中本次未生成、但仍保留在磁盘上的非 generated 文件（例如用户本地 vendor）
  for (const oldEntry of manifest?.files ?? []) {
    const path = normalizeRelPath(oldEntry.path)
    if (path === MANIFEST_PATH || finalData.has(path) || inputByPath.has(path)) continue
    if (oldEntry.group === 'generated') continue
    if (!diskByPath.has(path)) continue
    manifestInputs.push({ path, group: oldEntry.group, data: diskByPath.get(path)! })
  }

  const nextManifest = await buildManifest(manifestInputs, prepared.config, GENERATOR)
  for (const path of preserveOldEntry) {
    const oldEntry = manifestByPath.get(path)
    if (oldEntry) {
      nextManifest.files.push({ path, group: oldEntry.group, sha256: oldEntry.sha256 })
    }
  }
  nextManifest.files.sort((a, b) => a.path.localeCompare(b.path))
  writes.push({ path: MANIFEST_PATH, data: serializeManifest(nextManifest) })

  return {
    deletes,
    backups,
    writes,
    written,
    deleted: deletes.length,
    skipped,
    summary: summarizeExportPlan(plan),
    manifestWritten: true,
  }
}

/** 目录 IO 抽象：读现状 + 执行写/删操作（桌面与浏览器各自实现）。 */
interface FolderIo {
  read(): Promise<DiskSnapshot>
  apply(execution: FolderPlanExecution): Promise<void>
}

function createFolderTarget(root: string, io: FolderIo): FolderExportTarget {
  return {
    root,
    inspect: async (prepared, options) => {
      try {
        return await inspectPrepared(prepared, await io.read(), true, options?.groupDefaults)
      } catch {
        // 读不了目录：退化为全量创建，避免阻断导出
        return await inspectPrepared(prepared, {}, false, options?.groupDefaults)
      }
    },
    write: async (prepared, options) => {
      let disk = options?.disk
      let readable = options?.readable ?? true
      if (!disk) {
        try {
          disk = await io.read()
        } catch {
          disk = {}
          readable = false
        }
      }
      const manifest = options?.manifest !== undefined ? options.manifest : readManifestFromDisk(disk)
      const plan =
        options?.plan ?? (await buildExportPlan(flatten(prepared), manifest, disk, options?.groupDefaults))
      const execution = await planFolderExecution(
        prepared,
        plan,
        disk,
        manifest,
        options?.resolutions,
        options?.groupDefaults,
      )
      await io.apply(execution)
      return {
        root,
        readable,
        written: execution.written,
        deleted: execution.deleted,
        skipped: execution.skipped,
        backedUp: execution.backups.length,
        manifestWritten: execution.manifestWritten,
        summary: execution.summary,
      }
    },
  }
}

// ---------- 导出入口 ----------

/** ZIP 导出结果。 */
export interface ZipExportResult {
  /** 工程文件数（不含 vendor 与 manifest） */
  written: number
  manifestWritten: boolean
}

/** ZIP 导出：返回导出摘要；用户在保存对话框中取消返回 null。manifest 一并打包。 */
export async function exportAsZip(
  prepared: PreparedExport,
  projectName: string,
): Promise<ZipExportResult | null> {
  const zip = new JSZip()
  const folder = zip.folder(projectName)!
  for (const f of prepared.files) folder.file(f.path, f.content)
  for (const v of prepared.vendorEntries) folder.file(v.path, v.data)
  const manifest = await buildManifest(
    flatten(prepared).map((e) => ({ path: e.path, group: e.group, data: e.data })),
    prepared.config,
    GENERATOR,
  )
  folder.file(MANIFEST_PATH, serializeManifest(manifest))
  const blob = await zip.generateAsync({ type: 'blob' })
  if (isDesktopApp()) {
    // WebKitGTK 不处理 <a download>：走原生保存对话框
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const saved = await saveFileNative(`${projectName}.zip`, bytes, [
      { name: 'ZIP 压缩包', extensions: ['zip'] },
    ])
    if (!saved) return null
  } else {
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = `${projectName}.zip`
    el.click()
    URL.revokeObjectURL(url)
  }
  return { written: prepared.files.length + prepared.vendorEntries.length, manifestWritten: true }
}

/** 选择导出目录（必须在用户点击手势内调用）：桌面端原生对话框 / 浏览器目录选择。
 *  用户取消返回 null；拿到 target 后先 inspect() 预览、确认后再 write()。 */
export async function pickExportFolder(): Promise<FolderExportTarget | null> {
  if (isDesktopApp()) {
    const dir = await pickFolderNative('选择工程导出目录')
    if (!dir) return null
    return createFolderTarget(dir, {
      read: async () => {
        const files = await readFolderNative(dir)
        const disk: DiskSnapshot = {}
        for (const f of files) disk[f.path] = f.data
        return disk
      },
      apply: async (execution) => {
        for (const path of execution.deletes) await removeFileNative(dir, path)
        const files = [...execution.backups, ...execution.writes]
        if (files.length > 0) await writeFolderNative(dir, files)
      },
    })
  }

  const picker = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker
  if (!picker) throw new Error('当前浏览器不支持目录写入')
  const dir = await picker.call(window, { mode: 'readwrite' })
  return createFolderTarget(dir.name, {
    read: () => readBrowserDisk(dir),
    apply: async (execution) => {
      for (const path of execution.deletes) await removeFileAt(dir, path)
      for (const backup of execution.backups) await writeFileAt(dir, backup.path, backup.data)
      for (const write of execution.writes) await writeFileAt(dir, write.path, write.data)
    },
  })
}