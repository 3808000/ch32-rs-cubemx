// 单核工程骨架：Cargo.toml / rust-toolchain.toml / .cargo/config.toml / .gitignore。
// 契约 D12：edition 2021；无 build.rs / memory.x / target json；[[bin]] harness=false。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { CH58X_HAL_GIT, CH58X_HAL_REV } from '../halRev'
import { renderIdeConfigFiles } from './ide'
import { render } from '../render'
import { sanitizePackageName } from '../util'
import * as T from './templates'

export function renderSkeletonFiles(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  embassy: boolean,
): GeneratedFile[] {
  if (!sel.projectSkeleton) {
    // 骨架未勾选时仍可单独生成 IDE 配置（.vscode 与骨架解耦）
    return renderIdeConfigFiles(config, data, sel)
  }

  const packageName = sanitizePackageName(config.projectName)
  const files: GeneratedFile[] = [
    {
      path: 'Cargo.toml',
      content: render(T.CARGO_TOML_TPL, {
        packageName,
        vendorHal: sel.vendorHal,
        halGit: CH58X_HAL_GIT,
        halRev: CH58X_HAL_REV,
        embassy,
      }),
    },
    {
      path: 'rust-toolchain.toml',
      content: render(T.RUST_TOOLCHAIN_TPL, { target: data.chip.target, embassy }),
    },
    {
      path: '.cargo/config.toml',
      content: render(T.CARGO_CONFIG_TPL, { target: data.chip.target }),
    },
    { path: '.gitignore', content: 'target/\n' },
  ]
  files.push(...renderIdeConfigFiles(config, data, sel))
  return files
}
