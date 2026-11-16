// 目录导出计划（M1 再生成安全网）：纯函数，基于「目标目录现状 + 上次导出清单」
// 逐文件判定 unchanged/create/update/delete/conflict，不做任何 IO。
// IO（读目录、写盘、落 manifest）由 services/projectExport.ts 负责。
import type { ConflictPolicy, ConflictResolution, ExportManifest, ExportPlanEntry, FileGroup, ManifestEntry } from '@/model/types'
import { hashContent } from '@/model/codegen'

/** 类别级冲突决议默认值（M8）：fileGroup → conflict 条目的默认 resolution。 */
export type GroupDefaults = Partial<Record<FileGroup, ConflictResolution>>

/** 可参与策略的文件组：user_code 硬保护（永不写盘），永远不出现在策略默认值里。 */
const POLICY_GROUPS: readonly FileGroup[] = ['generated', 'project_file', 'pack']

/**
 * 把工程级冲突策略（对齐 CubeMX2 Automatic Conflict Handling Rules）映射为逐组默认值：
 * - 缺省 / safe：返回空表，conflict 一律回退 'skip'（M1 安全网现状）；
 * - update（Update files on change）：三个可写组 conflict 默认 'overwrite'；
 * - custom：逐组取 groups 覆盖值，缺省组回退 safe（不写入表）；
 *   base-merge 仅对 project_file 有意义（Cargo.toml 标记区），其它组降级为 'overwrite'。
 * user_code 在任何档位下都不出现在返回值里（硬保护不受策略影响）。
 */
export function resolveGroupDefaults(policy?: ConflictPolicy): GroupDefaults {
  if (!policy || policy.mode === 'safe') return {}
  if (policy.mode === 'update') {
    return { generated: 'overwrite', project_file: 'overwrite', pack: 'overwrite' }
  }
  if (policy.mode !== 'custom') return {}
  const defaults: GroupDefaults = {}
  for (const group of POLICY_GROUPS) {
    const value = policy.groups?.[group]
    if (value === undefined) continue
    defaults[group] = value === 'base-merge' && group !== 'project_file' ? 'overwrite' : value
  }
  return defaults
}

/** plan 的输入条目：即将生成的一个文件。 */
export interface ExportPlanInputEntry {
  path: string
  group: FileGroup
  data: string | Uint8Array
}

/** 目标目录现状：相对路径 → 文本或二进制内容（只用于哈希比较）。 */
export type DiskSnapshot = Record<string, string | Uint8Array>

/** 各动作计数，供 UI 展示「将新建 X / 更新 Y / 删除 Z / 保留 W / 冲突 N」。 */
export interface ExportPlanSummary {
  create: number
  update: number
  unchanged: number
  delete: number
  conflict: number
}

/** 统计 plan 中各 action 的数量。 */
export function summarizeExportPlan(plan: ExportPlanEntry[]): ExportPlanSummary {
  const summary: ExportPlanSummary = { create: 0, update: 0, unchanged: 0, delete: 0, conflict: 0 }
  for (const entry of plan) summary[entry.action] += 1
  return summary
}

/** 规范化工程内相对路径：统一正斜杠，去掉开头的 `./` 与 `/`。 */
export function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
}

function indexDisk(disk: DiskSnapshot): Map<string, string | Uint8Array> {
  const map = new Map<string, string | Uint8Array>()
  for (const [path, data] of Object.entries(disk)) map.set(normalizeRelPath(path), data)
  return map
}

function indexManifest(manifest: ExportManifest | null): Map<string, ManifestEntry> {
  const map = new Map<string, ManifestEntry>()
  if (!manifest) return map
  for (const entry of manifest.files) map.set(normalizeRelPath(entry.path), entry)
  return map
}

/**
 * 构建再生成计划。
 *
 * 规则（对齐 CubeMX2 的再生成安全网）：
 * - 磁盘无此文件 → create
 * - 磁盘有且内容哈希 == 新内容 → unchanged
 * - 磁盘有且内容不同：
 *   - manifest 记录了该文件且其哈希 == 磁盘哈希（用户没改过，是生成器内容变了）→ update
 *   - 否则（用户手改过，或无 manifest 但磁盘已有不同内容）→ conflict，
 *     默认 resolution = groupDefaults[group] ?? 'skip'（M8 类别级策略；不传时与 M1 一致）
 * - manifest 有、本次不再生成、且 group === 'generated' → delete；其它组永不删除。
 *
 * 哈希使用 Web Crypto（异步），因此本函数为 async。
 */
export async function buildExportPlan(
  newEntries: ExportPlanInputEntry[],
  manifest: ExportManifest | null,
  disk: DiskSnapshot,
  groupDefaults?: GroupDefaults,
): Promise<ExportPlanEntry[]> {
  const diskByPath = indexDisk(disk)
  const manifestByPath = indexManifest(manifest)
  const plan: ExportPlanEntry[] = []
  const seen = new Set<string>()

  for (const entry of newEntries) {
    const path = normalizeRelPath(entry.path)
    // 同一路径只取第一次出现的条目，避免 plan 内重复。
    if (seen.has(path)) continue
    seen.add(path)

    if (!diskByPath.has(path)) {
      plan.push({ path, group: entry.group, action: 'create' })
      continue
    }

    const diskData = diskByPath.get(path)!
    const [diskHash, newHash] = await Promise.all([hashContent(diskData), hashContent(entry.data)])
    if (diskHash === newHash) {
      plan.push({ path, group: entry.group, action: 'unchanged' })
      continue
    }

    // 磁盘内容与上次导出记录一致 → 是生成器侧变化，可安全 update；
    // 否则视为用户手改，进入 conflict 复核。
    const previous = manifestByPath.get(path)
    if (previous && previous.sha256 === diskHash) {
      plan.push({ path, group: entry.group, action: 'update' })
    } else {
      plan.push({ path, group: entry.group, action: 'conflict', resolution: groupDefaults?.[entry.group] ?? 'skip' })
    }
  }

  // 上次生成、本次不再生成的文件：只允许删除 generated 组。
  const deletions = (manifest?.files ?? [])
    .map((entry) => ({ ...entry, path: normalizeRelPath(entry.path) }))
    .filter((entry) => entry.group === 'generated' && !seen.has(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const entry of deletions) {
    plan.push({ path: entry.path, group: entry.group, action: 'delete' })
  }

  return plan
}