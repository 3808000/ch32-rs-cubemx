// 工程注册表（M2.9 最近工程 + M4.1 浏览器工程库 + M10 桌面磁盘工程库）。
// - 最近工程（KEY_RECENT）：自动 MRU，按 chip+projectName 去重，cap 10，保留既有语义；
// - 工程库（KEY_LIBRARY）：用户显式「保存到库」的完整工程，可覆盖/重命名/删除；
// - 两者都存完整 config，便于直接重开。
// - 桌面端（M10）：磁盘工程库索引 ~/.config/ch32-rs-cubemx/projects.json，
//   每个工程目录内保存 cube.json；浏览器同步 API 逐字节不变，磁盘能力为独立 async 变体。
import type { ProjectConfig } from '@/model/types'
import {
  isDesktopApp,
  projectsRootNative,
  readTextFileNative,
  removeDirNative,
  writeTextFileNative,
} from '@/services/desktop'

const KEY_RECENT = 'ch32-rs-cubemx:recent'
const KEY_LIBRARY = 'ch32-rs-cubemx:library'
const MAX_RECENT = 10

export interface RecentProject {
  id: string
  projectName: string
  chip: string
  updatedAt: number
  config: ProjectConfig
}

/** 工程库条目：比最近工程多一个首次保存时间（覆盖保存时保留）。 */
export interface LibraryProject extends RecentProject {
  createdAt: number
}

// ---------- 最近工程（M2.9，语义保持不变） ----------

function readRecent(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY_RECENT)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeRecent(list: RecentProject[]): void {
  try {
    localStorage.setItem(KEY_RECENT, JSON.stringify(list))
  } catch {
    /* 存储满/隐私模式：静默失败，不影响主流程 */
  }
}

/** 列出最近工程（按更新时间倒序）。 */
export function listRecent(): RecentProject[] {
  return readRecent().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 记录/更新一条最近工程（以 chip+projectName 去重），返回其 id。 */
export function touchRecent(config: ProjectConfig): string {
  const list = readRecent()
  const id = `${config.chip}:${config.projectName}`
  const entry: RecentProject = {
    id,
    projectName: config.projectName,
    chip: config.chip,
    updatedAt: Date.now(),
    config,
  }
  const next = [entry, ...list.filter((r) => r.id !== id)].slice(0, MAX_RECENT)
  writeRecent(next)
  return id
}

/** 按 id 取最近工程（重开用）。 */
export function getRecent(id: string): RecentProject | null {
  return readRecent().find((r) => r.id === id) ?? null
}

/** 移除一条最近工程。 */
export function removeRecent(id: string): void {
  writeRecent(readRecent().filter((r) => r.id !== id))
}

// ---------- 工程库（M4.1 浏览器版） ----------

/** 工程库中已存在同名（chip + projectName）工程。 */
export class LibraryConflictError extends Error {
  constructor(message = '工程库中已存在同名工程') {
    super(message)
    this.name = 'LibraryConflictError'
  }
}

/** 工程库条目 id：chip + projectName（与最近工程一致，便于覆盖保存）。 */
export function libraryProjectId(chip: string, projectName: string): string {
  return `${chip}:${projectName}`
}

function isLibraryProject(value: unknown): value is LibraryProject {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.projectName === 'string' &&
    typeof v.chip === 'string' &&
    typeof v.updatedAt === 'number' &&
    typeof v.config === 'object' &&
    v.config !== null
  )
}

function readLibrary(): LibraryProject[] {
  try {
    const raw = localStorage.getItem(KEY_LIBRARY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    // 过滤损坏条目；旧数据缺少 createdAt 时用 updatedAt 补齐（宽容读取）
    return arr.filter(isLibraryProject).map((p) => ({ ...p, createdAt: p.createdAt ?? p.updatedAt }))
  } catch {
    return []
  }
}

/** 写工程库：存储满/隐私模式下抛出异常，由 UI 提示（与最近工程静默失败不同，用户显式保存需要反馈）。 */
function writeLibrary(list: LibraryProject[]): void {
  localStorage.setItem(KEY_LIBRARY, JSON.stringify(list))
}

/** 列出已保存工程（按更新时间倒序）。 */
export function listLibrary(): LibraryProject[] {
  return readLibrary().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 按 id 取已保存工程（打开用）。 */
export function getLibrary(id: string): LibraryProject | null {
  return readLibrary().find((p) => p.id === id) ?? null
}

export interface SaveToLibraryOptions {
  /** 同名工程已存在时是否覆盖（默认 false，冲突抛 LibraryConflictError）。 */
  overwrite?: boolean
}

/**
 * 保存当前工程到工程库。
 * 名称取 config.projectName（空白回退 ch32-project），同 chip+名称 视为同一工程；
 * 覆盖保存保留 createdAt，并同步刷新最近工程记录。
 */
export function saveToLibrary(
  config: ProjectConfig,
  options: SaveToLibraryOptions = {},
): LibraryProject {
  const projectName = config.projectName.trim() || 'ch32-project'
  const id = libraryProjectId(config.chip, projectName)
  const list = readLibrary()
  const existing = list.find((p) => p.id === id)
  if (existing && !options.overwrite) {
    throw new LibraryConflictError(`工程库中已存在「${projectName}」（${config.chip}）`)
  }
  const now = Date.now()
  const entry: LibraryProject = {
    id,
    projectName,
    chip: config.chip,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    // 名称规范化后写回 config，保证库内配置与条目名一致
    config: { ...config, projectName },
  }
  writeLibrary([entry, ...list.filter((p) => p.id !== id)])
  touchRecent(entry.config)
  return entry
}

/**
 * 重命名工程库条目（同时更新条目 config.projectName 与最近工程记录）。
 * 新名称与其它条目冲突时抛 LibraryConflictError；条目不存在时抛 Error。
 */
export function renameLibrary(id: string, projectName: string): LibraryProject {
  const name = projectName.trim()
  if (!name) throw new Error('工程名称不能为空')
  const list = readLibrary()
  const existing = list.find((p) => p.id === id)
  if (!existing) throw new Error('工程不存在或已被删除')
  if (name === existing.projectName) return existing

  const nextId = libraryProjectId(existing.chip, name)
  if (list.some((p) => p.id === nextId)) {
    throw new LibraryConflictError(`工程库中已存在「${name}」（${existing.chip}）`)
  }
  const updated: LibraryProject = {
    ...existing,
    id: nextId,
    projectName: name,
    updatedAt: Date.now(),
    config: { ...existing.config, projectName: name },
  }
  writeLibrary([updated, ...list.filter((p) => p.id !== id)])
  // 最近工程跟随重命名：移除旧 id，再写入新名称（最近列表仍保持 MRU 语义）
  removeRecent(id)
  touchRecent(updated.config)
  return updated
}

/** 从工程库删除一条（不影响当前打开的工程与最近工程列表）。 */
export function removeLibrary(id: string): void {
  writeLibrary(readLibrary().filter((p) => p.id !== id))
}

// ---------- 桌面磁盘工程库（M10） ----------
// 索引文件与工程目录布局：
//   ~/.config/ch32-rs-cubemx/projects.json          ← { version: 1, entries: [...] }
//   ~/.config/ch32-rs-cubemx/projects/<dir>/cube.json
// 索引条目：{ id, name, chip, dir, updatedAt, lastOpened }，一个目录最多一条。

/** 索引文件名（与 projects 目录同级）。 */
export const INDEX_FILE_NAME = 'projects.json'

/** 索引 schema 版本。 */
export const DISK_INDEX_VERSION = 1

/** 磁盘工程库条目（索引是唯一事实来源，config 落在各工程 cube.json）。 */
export interface DiskProjectEntry {
  /** chip:name（与浏览器工程库一致的覆盖语义） */
  id: string
  name: string
  chip: string
  /** 工程目录绝对路径 */
  dir: string
  updatedAt: number
  /** 最近打开时间；0 = 不在最近列表（仍保留在工程库） */
  lastOpened: number
}

export interface DiskProjectIndex {
  version: number
  entries: DiskProjectEntry[]
}

/**
 * 工程名 → 磁盘目录名（纯函数）：
 * - 统一小写；路径分隔符、Windows 禁用字符、空白与控制字符折叠为 '-'；
 * - 连续 '-' 归一，首尾 '-'/'.' 去除，`..` 折叠（防路径穿越），最长 64 字符；
 * - 空/全非法回退 'project'。
 */
export function projectDirName(name: string): string {
  const slug = (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/^[-.]+|[-.]+$/g, '')
  return slug || 'project'
}

/** 路径分隔符推断：只出现反斜杠时按 Windows 处理。 */
function pathSeparator(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

/** 拼接文件系统路径（纯函数，避免依赖 Node path 模块）。 */
export function joinFsPath(base: string, child: string): string {
  const cleanBase = (base ?? '').trim().replace(/[\\/]+$/, '')
  const cleanChild = (child ?? '').trim().replace(/^[\\/]+/, '')
  if (!cleanBase) return cleanChild
  if (!cleanChild) return cleanBase
  const sep = pathSeparator(cleanBase)
  return `${cleanBase}${sep}${cleanChild}`
}

/**
 * 由工程库根目录推导索引路径：`<root 的父目录>/projects.json`。
 * 纯函数，供 Rust projects_root() 返回值使用。
 */
export function projectIndexPath(projectsRoot: string): string {
  const root = (projectsRoot ?? '').trim().replace(/[\\/]+$/, '')
  if (!root) return INDEX_FILE_NAME
  const sep = pathSeparator(root)
  const slash = root.lastIndexOf(sep)
  if (slash <= 0) return `${root}${sep}${INDEX_FILE_NAME}`
  return `${root.slice(0, slash)}${sep}${INDEX_FILE_NAME}`
}

/** 索引条目校验：id/name/chip/dir 为非空字符串，updatedAt 为有限数字。 */
export function isDiskProjectEntry(value: unknown): value is DiskProjectEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    v.id.trim() !== '' &&
    typeof v.name === 'string' &&
    v.name.trim() !== '' &&
    typeof v.chip === 'string' &&
    v.chip.trim() !== '' &&
    typeof v.dir === 'string' &&
    v.dir.trim() !== '' &&
    typeof v.updatedAt === 'number' &&
    Number.isFinite(v.updatedAt) &&
    typeof v.lastOpened === 'number' &&
    Number.isFinite(v.lastOpened)
  )
}

/** 宽容读取单条索引项：lastOpened 缺失按 0（旧索引），其余非法字段拒绝。 */
function normalizeDiskEntry(value: unknown): DiskProjectEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const lastOpened = typeof v.lastOpened === 'number' && Number.isFinite(v.lastOpened) ? v.lastOpened : 0
  const candidate: DiskProjectEntry = {
    id: typeof v.id === 'string' ? v.id : '',
    name: typeof v.name === 'string' ? v.name : '',
    chip: typeof v.chip === 'string' ? v.chip : '',
    dir: typeof v.dir === 'string' ? v.dir : '',
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Number.NaN,
    lastOpened,
  }
  return isDiskProjectEntry(candidate) ? candidate : null
}

/** 按 updatedAt 倒序（纯函数，返回新数组）。 */
export function sortProjectEntries(entries: readonly DiskProjectEntry[]): DiskProjectEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 规范化索引（纯函数）：
 * - 接受数组或 `{ entries: [...] }`；非法条目过滤；
 * - 同一 id 或同一目录保留 updatedAt 最新的一条（防手改/并发写重复）；
 * - 返回按 updatedAt 倒序的新数组。
 */
export function normalizeProjectIndex(raw: unknown): DiskProjectEntry[] {
  let list: unknown[] = []
  if (Array.isArray(raw)) list = raw
  else if (typeof raw === 'object' && raw !== null) {
    const entries = (raw as Record<string, unknown>).entries
    if (Array.isArray(entries)) list = entries
  }

  const byId = new Map<string, DiskProjectEntry>()
  for (const item of list) {
    const entry = normalizeDiskEntry(item)
    if (!entry) continue
    const existing = byId.get(entry.id)
    if (!existing || entry.updatedAt >= existing.updatedAt) byId.set(entry.id, entry)
  }

  // 再按目录去重（同目录多条目 = 重命名残留，保留最新）
  const byDir = new Map<string, DiskProjectEntry>()
  for (const entry of byId.values()) {
    const existing = byDir.get(entry.dir)
    if (!existing || entry.updatedAt >= existing.updatedAt) byDir.set(entry.dir, entry)
  }

  return sortProjectEntries([...byDir.values()])
}

/** 合并一条索引项（纯函数）：按 id 与目录双重 upsert，返回倒序新数组。 */
export function mergeProjectIndexEntry(
  entries: readonly DiskProjectEntry[],
  entry: DiskProjectEntry,
): DiskProjectEntry[] {
  const next = entries.filter((e) => e.id !== entry.id && e.dir !== entry.dir)
  return sortProjectEntries([...next, entry])
}

/** 最近工程选择（纯函数）：lastOpened > 0，按 lastOpened 倒序，最多 cap 条。 */
export function selectRecentEntries(
  entries: readonly DiskProjectEntry[],
  cap = MAX_RECENT,
): DiskProjectEntry[] {
  return [...entries]
    .filter((e) => e.lastOpened > 0)
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, cap)
}

// 索引读写的串行队列：保存/打开/重命名/删除并发时不互相覆盖。
let indexQueue: Promise<unknown> = Promise.resolve()

function enqueueIndex<T>(task: () => Promise<T>): Promise<T> {
  const run = indexQueue.then(task, task)
  indexQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readProjectsIndex(): Promise<DiskProjectEntry[]> {
  try {
    const root = await projectsRootNative()
    return normalizeProjectIndex(JSON.parse(await readTextFileNative(projectIndexPath(root))))
  } catch {
    // 索引不存在/损坏：按空库处理（读取宽容；不影响新建）
    return []
  }
}

async function writeProjectsIndex(entries: readonly DiskProjectEntry[]): Promise<void> {
  const root = await projectsRootNative()
  const index: DiskProjectIndex = { version: DISK_INDEX_VERSION, entries: [...entries] }
  await writeTextFileNative(projectIndexPath(root), JSON.stringify(index, null, 2))
}

/** 列出磁盘工程库（按 updatedAt 倒序）；非桌面端返回空数组。 */
export async function listLibraryDisk(): Promise<DiskProjectEntry[]> {
  return enqueueIndex(async () => {
    if (!isDesktopApp()) return []
    return readProjectsIndex()
  })
}

/** 列出磁盘最近工程（lastOpened 倒序，cap 10）。 */
export async function listRecentDisk(): Promise<DiskProjectEntry[]> {
  return selectRecentEntries(await listLibraryDisk())
}

/**
 * 记录/更新一条磁盘索引（保存 cube.json 后调用）：
 * 按 chip+name 生成 id，同目录旧条目被替换；新工程 lastOpened 置为当前时间。
 */
export async function saveProjectEntryDisk(
  config: ProjectConfig,
  dir: string,
): Promise<DiskProjectEntry> {
  return enqueueIndex(async () => {
    const entries = await readProjectsIndex()
    const now = Date.now()
    const name = config.projectName.trim() || 'ch32-project'
    const existing =
      entries.find((e) => e.dir === dir) ?? entries.find((e) => e.id === libraryProjectId(config.chip, name))
    const entry: DiskProjectEntry = {
      id: libraryProjectId(config.chip, name),
      name,
      chip: config.chip,
      dir,
      updatedAt: now,
      lastOpened: existing?.lastOpened ?? now,
    }
    await writeProjectsIndex(mergeProjectIndexEntry(entries, entry))
    return entry
  })
}

/** 打开工程后刷新最近使用时间（lastOpened/updatedAt）。 */
export async function touchRecentDisk(id: string): Promise<void> {
  await enqueueIndex(async () => {
    const entries = await readProjectsIndex()
    const now = Date.now()
    const next = entries.map((e) =>
      e.id === id ? { ...e, lastOpened: now, updatedAt: now } : e,
    )
    await writeProjectsIndex(sortProjectEntries(next))
  })
}

/** 从最近列表移除（只清 lastOpened，保留工程库条目与磁盘目录）。 */
export async function removeRecentDisk(id: string): Promise<void> {
  await enqueueIndex(async () => {
    const entries = await readProjectsIndex()
    await writeProjectsIndex(entries.map((e) => (e.id === id ? { ...e, lastOpened: 0 } : e)))
  })
}

/** 重命名磁盘工程库条目（索引更新；cube.json 内 projectName 尽力同步，失败不阻塞）。 */
export async function renameLibraryDisk(id: string, projectName: string): Promise<DiskProjectEntry> {
  const name = projectName.trim()
  if (!name) throw new Error('工程名称不能为空')
  return enqueueIndex(async () => {
    const entries = await readProjectsIndex()
    const existing = entries.find((e) => e.id === id)
    if (!existing) throw new Error('工程不存在或已被删除')
    if (name === existing.name) return existing

    const nextId = libraryProjectId(existing.chip, name)
    if (entries.some((e) => e.id === nextId && e.dir !== existing.dir)) {
      throw new LibraryConflictError(`工程库中已存在「${name}」（${existing.chip}）`)
    }
    const updated: DiskProjectEntry = {
      ...existing,
      id: nextId,
      name,
      updatedAt: Date.now(),
    }
    await writeProjectsIndex(mergeProjectIndexEntry(entries, updated))
    await rewriteProjectName(existing.dir, name)
    return updated
  })
}

/** 尽力把 cube.json 内的 projectName 改成新名称（文件缺失/损坏时忽略）。 */
async function rewriteProjectName(dir: string, projectName: string): Promise<void> {
  try {
    const path = joinFsPath(dir, 'cube.json')
    const raw: unknown = JSON.parse(await readTextFileNative(path))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
    const config = { ...(raw as Record<string, unknown>), projectName }
    await writeTextFileNative(path, JSON.stringify(config, null, 2))
  } catch {
    /* cube.json 不可读时保持原样：索引重命名仍生效 */
  }
}

/** 删除磁盘工程：先递归删目录（Rust 侧路径守卫），成功后再移除索引条目。 */
export async function removeLibraryDisk(id: string): Promise<void> {
  const existing = (await listLibraryDisk()).find((e) => e.id === id)
  if (!existing) return
  await removeDirNative(existing.dir)
  await enqueueIndex(async () => {
    const entries = await readProjectsIndex()
    await writeProjectsIndex(entries.filter((e) => e.id !== id))
  })
}
