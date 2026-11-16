// cube.json：工程配置回读文件（始终生成，单核/双核同一序列化格式）。
import type { GeneratedFile, ProjectConfig } from '@/model/types'

/** 配置 → cube.json（2 空格缩进 + 行尾换行，确定性输出）。 */
export function renderCubeFile(config: ProjectConfig): GeneratedFile {
  return { path: 'cube.json', content: JSON.stringify(config, null, 2) + '\n' }
}