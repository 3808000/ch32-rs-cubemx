// 工程持久化服务：localStorage 读写（控制器不直接做 IO）。
// 键名与历史版本兼容；损坏数据静默判失败，由调用方决定是否提示。
import type { ProjectConfig } from '@/model/types'

const STORAGE_KEY = 'ch32-rs-cubemx:project'

/** 保存配置快照。失败时抛出原始异常（存储满/隐私模式等）。 */
export function saveProject(config: ProjectConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

/** 读取配置快照；不存在或损坏返回 null。 */
export function loadProject(): ProjectConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectConfig
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}