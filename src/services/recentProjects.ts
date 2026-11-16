// 工程注册表（M2.9 最近工程 + M4.1 浏览器工程库）。
// - 最近工程（KEY_RECENT）：自动 MRU，按 chip+projectName 去重，cap 10，保留既有语义；
// - 工程库（KEY_LIBRARY）：用户显式「保存到库」的完整工程，可覆盖/重命名/删除；
// - 两者都存完整 config，便于直接重开。桌面端磁盘工程库（~/.config/...）属 M4 后续 TODO。
import type { ProjectConfig } from '@/model/types'

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