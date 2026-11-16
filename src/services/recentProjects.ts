// 最近工程注册表（M2.9）：localStorage 索引，支撑 Home 最近工程卡与 Project 菜单 Open Recent。
// 每条保存完整 config，便于直接重开（桌面端后续可迁移到磁盘工程库，见 ROADMAP M4.1）。
import type { ProjectConfig } from '@/model/types'

const KEY = 'ch32-rs-cubemx:recent'
const MAX = 10

export interface RecentProject {
  id: string
  projectName: string
  chip: string
  updatedAt: number
  config: ProjectConfig
}

function read(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function write(list: RecentProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 存储满/隐私模式：静默失败，不影响主流程 */
  }
}

/** 列出最近工程（按更新时间倒序）。 */
export function listRecent(): RecentProject[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 记录/更新一条最近工程（以 chip+projectName 去重），返回其 id。 */
export function touchRecent(config: ProjectConfig): string {
  const list = read()
  const id = `${config.chip}:${config.projectName}`
  const entry: RecentProject = {
    id,
    projectName: config.projectName,
    chip: config.chip,
    updatedAt: Date.now(),
    config,
  }
  const next = [entry, ...list.filter((r) => r.id !== id)].slice(0, MAX)
  write(next)
  return id
}

/** 按 id 取最近工程（重开用）。 */
export function getRecent(id: string): RecentProject | null {
  return read().find((r) => r.id === id) ?? null
}

/** 移除一条最近工程。 */
export function removeRecent(id: string): void {
  write(read().filter((r) => r.id !== id))
}
