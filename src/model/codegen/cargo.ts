// 单核工程骨架：Cargo.toml / rust-toolchain.toml / .cargo/config.toml / build.rs / .gitignore。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { HAL_GIT, HAL_REV } from './halRev'
import { renderIdeConfigFiles } from './ideConfig'
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
  const files: GeneratedFile[] = []
  if (!sel.projectSkeleton) {
    // 骨架未勾选时仍可单独生成 IDE 配置（.vscode 与骨架解耦）
    files.push(...renderIdeConfigFiles(config, data, sel))
    return files
  }
  const packageName = sanitizePackageName(config.projectName)
  const nightly = data.chip.nightly
  // 自定义 target JSON：内建 tier-3 rv32ec（V003）或芯片数据自带 targetSpec（M14，如 V307）
  const targetSpec = data.chip.targetSpec
  const jsonTarget = nightly && (data.chip.target === 'riscv32ec-unknown-none-elf' || targetSpec != null)
  const jsonTargetFile = targetSpec != null ? `${data.chip.target}.json` : 'riscv32ec-unknown-none-elf.json'
  const feats = [data.chip.halFeature]
  if (embassy) feats.push('embassy', 'time-driver-tim2')
  feats.push('rt', 'exti', 'memory-x')

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
      jsonTargetFile,
    }),
  })
  files.push({ path: 'build.rs', content: render(T.BUILD_RS_TPL, {}) })
  files.push({ path: '.gitignore', content: T.GITIGNORE_TPL })
  // targetSpec：内容逐字来自数据（JSON.stringify + 末尾换行）；V003 旧路径保持内置模板逐字节不变
  if (jsonTarget) {
    files.push({
      path: jsonTargetFile,
      content: targetSpec != null ? `${JSON.stringify(targetSpec, null, 2)}\n` : T.TARGET_RISCV32EC_TPL,
    })
  }
  files.push(...renderIdeConfigFiles(config, data, sel))
  return files
}