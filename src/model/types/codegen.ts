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

export interface GeneratedFile {
  path: string
  content: string
}

export interface CodegenResult {
  files: GeneratedFile[]
  errors: Conflict[] // 生成期错误（阻止导出）
}