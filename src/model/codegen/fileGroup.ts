// 文件组分类（M1 安全网）：按路径把生成物归入 CubeMX2 风格的 fileGroup。
// 纯函数、数据驱动，不依赖具体芯片。再生成策略（覆盖/保护/合并）由 group 决定。
import type { FileGroup } from '@/model/types'

/** 按路径推断文件组。
 *  - vendor 前缀          → pack（厂商 HAL 源码，已存在默认保留）
 *  - 以 src/main.rs 结尾  → user_code（用户区，绝不覆盖；双核为 核名/src/main.rs）
 *  - 含 src/generated/    → generated（生成区，每次重写）
 *  - 其余                 → project_file（Cargo.toml、.cargo、rust-toolchain、build.rs、
 *                           .gitignore、README、cube.json、xtask、memory.x、link.x、target json 等）
 */
export function classifyFileGroup(path: string): FileGroup {
  const p = path.replace(/\\/g, '/')
  if (p.startsWith('vendor/')) return 'pack'
  if (/(^|\/)src\/main\.rs$/.test(p)) return 'user_code'
  if (p.includes('src/generated/')) return 'generated'
  return 'project_file'
}

/** 给一组生成文件补齐 group（已有 group 的保留，缺省按路径推断）。 */
export function withFileGroups<T extends { path: string; group?: FileGroup }>(files: T[]): T[] {
  return files.map((f) => (f.group ? f : { ...f, group: classifyFileGroup(f.path) }))
}