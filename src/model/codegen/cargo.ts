// 单核工程骨架：Cargo.toml / rust-toolchain.toml / .cargo/config.toml / build.rs / .gitignore。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { HAL_GIT, HAL_REV } from './halRev'
import { render } from './render'
import { sanitizePackageName } from './util'
import * as T from './templates'

/**
 * 生成工程骨架文件（selection.projectSkeleton）。
 * 顺序即导出顺序：Cargo.toml → rust-toolchain.toml → .cargo/config.toml → build.rs → .gitignore → [自定义 target]。
 */
export function renderSkeletonFiles(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  embassy: boolean,
): GeneratedFile[] {
  if (!sel.projectSkeleton) return []
  const packageName = sanitizePackageName(config.projectName)
  const nightly = data.chip.nightly
  const jsonTarget = nightly && data.chip.target === 'riscv32ec-unknown-none-elf'
  const feats = [data.chip.halFeature]
  if (embassy) feats.push('embassy', 'time-driver-tim2')
  feats.push('rt', 'exti', 'memory-x')

  const files: GeneratedFile[] = []
  files.push({
    path: 'Cargo.toml',
    content: render(T.CARGO_TOML_TPL, {
      packageName,
      vendorHal: sel.vendorHal,
      halGit: HAL_GIT,
      halRev: config.hal?.rev || HAL_REV,
      halFeatures: feats.map((f) => `"${f}"`).join(', '),
      embassy,
    }),
  })
  files.push({
    path: 'rust-toolchain.toml',
    content: render(T.RUST_TOOLCHAIN_TPL, { nightly, target: data.chip.target }),
  })
  files.push({
    path: '.cargo/config.toml',
    content: render(T.CARGO_CONFIG_TPL, {
      target: data.chip.target,
      jsonTarget,
      jsonTargetFile: 'riscv32ec-unknown-none-elf.json',
    }),
  })
  files.push({ path: 'build.rs', content: render(T.BUILD_RS_TPL, {}) })
  files.push({ path: '.gitignore', content: T.GITIGNORE_TPL })
  if (jsonTarget) files.push({ path: 'riscv32ec-unknown-none-elf.json', content: T.TARGET_RISCV32EC_TPL })
  return files
}