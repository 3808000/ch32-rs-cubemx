// 桌面端（Tauri）桥接：WebKitGTK 不支持 File System Access API，也不处理浏览器下载，
// 因此桌面版通过原生保存对话框 + Rust 命令写文件；浏览器模式继续走 Blob/目录选择。

export interface NativeFileEntry {
  path: string
  data: string | Uint8Array
}

/** 是否运行在 Tauri 桌面壳中（v2 注入 __TAURI_INTERNALS__）。 */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 文本按 UTF-8 编码后转 base64（Rust 端统一 base64 解码写盘）。 */
export function encodeTextBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

function encodeEntry(data: string | Uint8Array): string {
  return typeof data === 'string' ? encodeTextBase64(data) : bytesToBase64(data)
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core')
  return call<T>(cmd, args)
}

/** 原生“另存为”对话框；返回是否已写入。取消返回 false。 */
export async function saveFileNative(
  defaultName: string,
  data: string | Uint8Array,
  filters?: { name: string; extensions: string[] }[],
): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: defaultName, filters })
  if (!path) return false
  await invoke('write_file', { path, contents: encodeEntry(data) })
  return true
}

/** 原生目录选择；取消返回 null。defaultPath 用于工程库默认根目录。 */
export async function pickFolderNative(
  title = '选择导出目录',
  defaultPath?: string,
): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const dir = await open({
    directory: true,
    multiple: false,
    title,
    ...(defaultPath ? { defaultPath } : {}),
  })
  return typeof dir === 'string' ? dir : null
}

/** 把整份工程写入目录（相对路径逐级创建）；返回写入文件数。 */
export async function writeFolderNative(root: string, files: NativeFileEntry[]): Promise<number> {
  return invoke<number>('write_files', {
    root,
    files: files.map((f) => ({ path: f.path, contents: encodeEntry(f.data) })),
  })
}

/** 递归读取目录现状（相对路径 + 内容）；Rust 端跳过 target/ 与 .git/。
 *  返回 Uint8Array 便于直接做哈希比较，文本需要时由调用方解码。 */
export async function readFolderNative(root: string): Promise<NativeFileEntry[]> {
  const files = await invoke<{ path: string; contents: string }[]>('read_folder', { root })
  return files.map((f) => ({ path: f.path, data: base64ToBytes(f.contents) }))
}

/** 删除工程内单个文件（仅用于清理不再生成的 generated 文件）；不存在视为成功。 */
export async function removeFileNative(root: string, path: string): Promise<void> {
  await invoke('remove_file', { root, path })
}

// ---------- 桌面磁盘工程库（M10） ----------

/** 工程库根目录（Rust 端创建）：`$HOME/.config/ch32-rs-cubemx/projects`。 */
export async function projectsRootNative(): Promise<string> {
  return invoke<string>('projects_root', {})
}

/** 读取 UTF-8 文本文件（cube.json / projects.json）。 */
export async function readTextFileNative(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path })
}

/** 写入 UTF-8 文本文件；不存在的父目录由 Rust 端创建。 */
export async function writeTextFileNative(path: string, text: string): Promise<void> {
  await invoke('write_file', { path, contents: encodeTextBase64(text) })
}

/** 递归删除工程目录（Rust 端校验必须位于工程库根目录之下）。 */
export async function removeDirNative(path: string): Promise<void> {
  await invoke('remove_dir', { path })
}
