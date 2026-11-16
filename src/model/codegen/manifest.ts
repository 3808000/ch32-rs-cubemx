// 导出清单（M1 安全网）：生成 `.ch32cube/export-manifest.json` 的机器可读记录。
// 对齐 CubeMX2 `.settings/exported-files.json`（file + group + sha256 + timestamp）。
// 纯模型层：只做哈希与组装，不做 IO（落盘由 services/projectExport 负责）。
import type { ExportManifest, FileGroup, ManifestEntry, ProjectConfig } from '@/model/types'

/** 清单文件在导出工程内的固定路径。 */
export const MANIFEST_PATH = '.ch32cube/export-manifest.json'

/** 内容 sha256（hex）。文本按 UTF-8 编码；二进制直接哈希。
 *  用 Web Crypto（浏览器与 Node ≥18 的 globalThis.crypto 均可用）。 */
export async function hashContent(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 规范化配置哈希：对 cube.json 的 JSON 序列化取 sha256，用于「配置未变则无需重生成」。 */
export async function configHash(config: ProjectConfig): Promise<string> {
  return hashContent(JSON.stringify(config))
}

export interface ManifestInput {
  path: string
  group: FileGroup
  data: string | Uint8Array
}

/** 组装导出清单。generator.version 由调用方传入（避免模型层依赖 package.json）。 */
export async function buildManifest(
  entries: ManifestInput[],
  config: ProjectConfig,
  generator: { name: string; version: string },
): Promise<ExportManifest> {
  const files: ManifestEntry[] = []
  for (const e of entries) {
    files.push({ path: e.path, group: e.group, sha256: await hashContent(e.data) })
  }
  // 稳定排序，保证同一配置产出同一清单（便于 diff）
  files.sort((a, b) => a.path.localeCompare(b.path))
  return {
    version: 1,
    generator,
    timestamp: new Date().toISOString(),
    configHash: await configHash(config),
    files,
  }
}

/** 清单序列化为 JSON 文本（2 空格缩进，与 cube.json 一致）。 */
export function serializeManifest(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2)
}

/** 解析清单文本；损坏/版本不符返回 null（调用方按「无清单」处理，走全量创建）。 */
export function parseManifest(text: string): ExportManifest | null {
  try {
    const raw = JSON.parse(text) as ExportManifest
    if (raw?.version !== 1 || !Array.isArray(raw.files)) return null
    return raw
  } catch {
    return null
  }
}