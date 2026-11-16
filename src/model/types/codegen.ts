// 代码生成领域类型：勾选项、生成文件与结果。
import type { Conflict } from './conflict'

// ---------- 代码生成 ----------

export interface CodegenSelection {
  projectSkeleton: boolean
  clock: boolean
  pins: boolean
  exti: boolean
  usart: boolean
  spi: boolean
  i2c: boolean
  adc: boolean
  readme: boolean
  /** 内嵌完整 ch32-hal 源码到 vendor/ch32-hal（path 依赖，便于查阅代码） */
  vendorHal: boolean
}

export const DEFAULT_SELECTION: CodegenSelection = {
  projectSkeleton: true,
  clock: true,
  pins: true,
  exti: true,
  usart: true,
  spi: true,
  i2c: true,
  adc: true,
  readme: true,
  vendorHal: true,
}

/** 文件组（对齐 CubeMX2 fileGroup）：决定再生成时的覆盖/保护策略。
 *  - generated：src/generated/**，每次重写（用户手改会触发冲突复核）
 *  - project_file：Cargo.toml/.cargo/rust-toolchain/build.rs/.gitignore/README.md/cube.json，默认生成一次；Cargo.toml 走标记区合并
 *  - user_code：src/main.rs 及用户模块，绝不覆盖
 *  - pack：vendor/ch32-hal/**，已存在默认保留本地内容
 */
export type FileGroup = 'generated' | 'project_file' | 'user_code' | 'pack'

export interface GeneratedFile {
  path: string
  content: string
  /** 文件组；缺省按路径推断（见 model/codegen 的 classifyFileGroup） */
  group?: FileGroup
}

export interface CodegenResult {
  files: GeneratedFile[]
  errors: Conflict[] // 生成期错误（阻止导出）
}

// ---------- 导出清单与再生成计划（M1 安全网） ----------

/** 导出清单条目：记录上次导出的文件及其内容哈希，用于跨会话差异检测。 */
export interface ManifestEntry {
  path: string
  group: FileGroup
  /** 内容 sha256（hex） */
  sha256: string
}

/** `.ch32cube/export-manifest.json`：机器可读的生成记录（对齐 CubeMX2 exported-files.json）。 */
export interface ExportManifest {
  version: 1
  generator: { name: string; version: string }
  /** ISO8601 生成时间 */
  timestamp: string
  /** 规范化 cube.json 的 sha256，用于「配置未变则无需重生成」 */
  configHash: string
  files: ManifestEntry[]
}

/** 再生成计划中单个文件的动作。 */
export type ExportAction = 'unchanged' | 'create' | 'update' | 'delete' | 'conflict'

/** 逐文件冲突解决动作（对齐 CubeMX2 FileDiffAction）。 */
export type ConflictResolution = 'skip' | 'overwrite' | 'backup' | 'base-merge'

export interface ExportPlanEntry {
  path: string
  group: FileGroup
  action: ExportAction
  /** action=conflict 时的默认解决方式（可被用户覆盖） */
  resolution?: ConflictResolution
}