// 工程导出应用服务：封装「生成 → 内嵌 vendor HAL → 打包/落盘」的完整流程。
// 视图层（CodegenDialog）只负责选项与提示，IO 与编排全部在本层完成；
// 桌面端（Tauri）与浏览器按运行环境自动分流（desktop.ts）。
import JSZip from 'jszip'
import { generateProject } from '@/model/codegen'
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { isDesktopApp, pickFolderNative, saveFileNative, writeFolderNative } from '@/services/desktop'

export interface PreparedExport {
  /** 生成的工程文件（已按 includeMain 过滤 main.rs） */
  files: GeneratedFile[]
  /** vendor/ch32-hal 内嵌源码（二进制条目） */
  vendorEntries: { path: string; data: Uint8Array }[]
  /** 导出快照（用于 diff 预览） */
  snapshot: Record<string, string>
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
  return { files, vendorEntries, snapshot }
}

/** 错误级冲突导致导出被阻止（调用方据此展示原因，不再继续）。 */
export class ExportBlockedError extends Error {}

// ---------- 浏览器目录写入（File System Access API） ----------
// 最小类型声明：TS 5.6 DOM lib 尚不完整。

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

/** 用户在原生/浏览器目录选择中取消。 */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError'
}

// ---------- 导出入口 ----------

/** ZIP 导出：返回导出的文件总数（含 vendor），用于提示；取消返回 null。 */
export async function exportAsZip(prepared: PreparedExport, projectName: string): Promise<number | null> {
  const zip = new JSZip()
  const folder = zip.folder(projectName)!
  for (const f of prepared.files) folder.file(f.path, f.content)
  for (const v of prepared.vendorEntries) folder.file(v.path, v.data)
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
  return prepared.files.length + prepared.vendorEntries.length
}

/** 目录导出目标：先选择（用户手势内），拿到生成结果后再写入。 */
export interface FolderExportTarget {
  /** 写入全部文件（含 vendor）；返回根目录名与文件数。 */
  write(prepared: PreparedExport): Promise<{ root: string; written: number }>
}

/** 把 prepared 展开为 (path, data) 条目（工程文件 + vendor）。 */
function flatten(prepared: PreparedExport): { path: string; data: string | Uint8Array }[] {
  return [
    ...prepared.files.map((f) => ({ path: f.path, data: f.content as string | Uint8Array })),
    ...prepared.vendorEntries.map((v) => ({ path: v.path, data: v.data as string | Uint8Array })),
  ]
}

/** 选择导出目录（必须在用户点击手势内调用）：桌面端原生对话框 / 浏览器目录选择。
 *  用户取消返回 null；拿到返回值后再生成内容并调用 target.write()。 */
export async function pickExportFolder(): Promise<FolderExportTarget | null> {
  if (isDesktopApp()) {
    const dir = await pickFolderNative('选择工程导出目录')
    if (!dir) return null
    return {
      write: async (prepared) => {
        const written = await writeFolderNative(dir, flatten(prepared))
        return { root: dir, written }
      },
    }
  }
  const picker = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker
  if (!picker) throw new Error('当前浏览器不支持目录写入')
  const dir = await picker.call(window, { mode: 'readwrite' })
  return {
    write: async (prepared) => {
      let written = 0
      for (const entry of flatten(prepared)) {
        await writeFileAt(dir, entry.path, entry.data)
        written++
      }
      return { root: dir.name, written }
    },
  }
}