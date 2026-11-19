// 单核工程骨架：Cargo.toml / rust-toolchain.toml / .cargo/config.toml / build.rs / .gitignore。
// 契约 D2：nightly + rust-src、[unstable] build-std=["core"]、build.rs 发 -Tlink.x、memory-x feature。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { CH5XX_HAL_GIT, CH5XX_HAL_REV, EMBASSY_GIT, EMBASSY_GIT_REV } from './halRev'
import { renderIdeConfigFiles } from '../ch58x/ide'
import { render } from '../render'
import { sanitizePackageName } from '../util'
import * as T from './templates'

/** ch5xx 运行时档（Cargo feature 矩阵：blocking / embassy / BLE busy-poll）。 */
export type Ch5xxTier = 'blocking' | 'embassy' | 'ble'

/** HAL 芯片 feature：data.chip.family 小写（CH582 → ch582；ch5xx-hal 的 ch582 feature）。 */
export function halChipFeature(data: DeviceData): string {
  return data.chip.family.toLowerCase()
}

/** 三档 feature 列表（D2 逐字）。 */
export function halFeaturesOf(tier: Ch5xxTier, chipFeature: string): string {
  if (tier === 'embassy') return `["${chipFeature}", "rt", "memory-x", "embassy", "time-driver-tmr0"]`
  // blocking 与 BLE 档相同：BLE 不启 hal embassy/time-driver
  return `["${chipFeature}", "rt", "memory-x"]`
}

export function renderSkeletonFiles(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  tier: Ch5xxTier,
): GeneratedFile[] {
  if (!sel.projectSkeleton) {
    // 骨架未勾选时仍可单独生成 IDE 配置（.vscode 与骨架解耦）
    return renderIdeConfigFiles(config, data, sel)
  }

  const packageName = sanitizePackageName(config.projectName)
  const ble = tier === 'ble'
  const embassy = tier === 'embassy'
  const files: GeneratedFile[] = [
    {
      path: 'Cargo.toml',
      content: render(T.CARGO_TOML_TPL, {
        packageName,
        vendorHal: sel.vendorHal,
        halGit: CH5XX_HAL_GIT,
        halRev: CH5XX_HAL_REV,
        halFeatures: halFeaturesOf(tier, halChipFeature(data)),
        embassy,
        ble,
        embassyGit: EMBASSY_GIT,
        embassyRev: EMBASSY_GIT_REV,
      }),
    },
    {
      path: 'rust-toolchain.toml',
      content: render(T.RUST_TOOLCHAIN_TPL, { target: data.chip.target }),
    },
    {
      path: '.cargo/config.toml',
      content: render(T.CARGO_CONFIG_TPL, { target: data.chip.target }),
    },
    // D2：ch5xx 工程需要自己的 build.rs（ch58x 没有）
    { path: 'build.rs', content: T.BUILD_RS_TPL },
    { path: '.gitignore', content: 'target/\n' },
  ]
  files.push(...renderIdeConfigFiles(config, data, sel))
  return files
}