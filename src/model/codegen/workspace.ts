// 双核 workspace（H417）：Cargo workspace + 每核一个 crate + xtask（构建/烧录/合并）。
import type { CodegenResult, CodegenSelection, Conflict, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { HAL_GIT, HAL_REV } from './halRev'
import { render } from './render'
import { sanitizePackageName } from './util'
import { withFileGroups } from './fileGroup'
import { renderClock } from './clock'
import { renderCoreGenerated } from './core'
import { renderCubeFile } from './cubefile'
import { renderDualReadme } from './readme'
import { renderIdeConfigFiles } from './ideConfig'
import * as T from './templates'

/** 双核 target → 自定义 target json 模板。未知 target 直接报错，不猜。 */
function targetTemplateOf(target: string): string | null {
  if (target === 'riscv32imafc-unknown-none-elf') return T.TARGET_RISCV32IMAFC_TPL
  if (target === 'riscv32imafbc-unknown-none-elf') return T.TARGET_RISCV32IMAFCB_TPL
  return null
}

/** 双核 README 的文件说明（按路径模式匹配） */
function dualFileDesc(path: string): string {
  if (path === 'Cargo.toml') return 'workspace 清单 + 共享 ch32-hal 依赖'
  if (path === 'rust-toolchain.toml') return 'nightly + rust-src（自定义 target / build-std）'
  if (path === '.cargo/config.toml') return 'xtask 别名'
  if (path === '.gitignore') return '构建产物忽略规则'
  if (path === 'cube.json') return 'ch32-rs-CubeMX 配置回读（可重新导入）'
  if (path === 'xtask/Cargo.toml') return '双核编排工具清单'
  if (path === 'xtask/src/main.rs') return '双核构建 / 烧录 / 合并（cargo xtask）'

  const m = path.match(/^([a-z][a-z0-9_]*)\/(.*)$/)
  if (m) {
    const sub = m[2]
    if (sub === 'Cargo.toml') return `${m[1]} 核 crate（HAL feature / 运行时依赖）`
    if (sub === 'build.rs') return '注入 -Tlink.x，并提供该核 memory.x'
    if (sub === 'memory.x') return '该核的 flash/RAM 布局'
    if (sub === 'link.x') return '启动核 highcode 链接脚本（零等待共享 SRAM）'
    if (sub.endsWith('.json')) return '自定义 target 描述（+xwchc / +b）'
    if (sub === '.cargo/config.toml') return '该核 target + wlink runner'
    if (sub === 'src/main.rs') return '该核用户代码入口（不会被重新导出覆盖）'
    if (sub === 'src/generated/mod.rs') return '生成模块聚合（init 返回 Generated）'
    if (sub === 'src/generated/clock.rs') return '时钟树 → RCC 配方'
    if (sub === 'src/generated/pins.rs') return 'GPIO 引脚初始化'
    if (sub === 'src/generated/exti.rs') return 'EXTI 输入初始化'
    if (sub === 'src/generated/usart.rs') return 'USART 初始化'
    if (sub === 'src/generated/spi.rs') return 'SPI 初始化'
    if (sub === 'src/generated/i2c.rs') return 'I2C 初始化'
    if (sub === 'src/generated/adc.rs') return 'ADC 初始化（通道=引脚字段）'
  }
  return ''
}

/**
 * 双核工程：Cargo workspace + 每核一个 crate + xtask（构建/烧录/合并）。
 * 主核生成完整 generated/**；从核按当前数据模型只生成 clock 快照与空 init。
 */
export function generateDualCoreProject(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  usages: PeripheralUsage[],
  embassy: boolean,
  debugPrint: boolean,
): CodegenResult {
  const cores = data.chip.cores ?? []
  const errors: Conflict[] = []

  // DMA 建模已按 dma.json 的 model 区分：H4 为 dmamux（请求号 → 任一物理通道，
  // 见 derive.buildDmaPlan），不再需要在此拦截 embassy。芯片级 embassy 支持仍由
  // chip.json 的 unsupportedFeatures 决定（冲突规则先于本函数执行）。
  if (cores.length !== 2) {
    errors.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'error',
      message: `双核 workspace 生成目前只支持 2 个核心（当前 ${cores.length} 个）`,
    })
  }
  const mains = cores.filter((c) => c.mainCore === true)
  if (mains.length !== 1) {
    errors.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'error',
      message: `cores 必须恰有一个 mainCore=true（当前 ${mains.length} 个）`,
    })
  }
  for (const core of cores) {
    if (!targetTemplateOf(core.target)) {
      errors.push({
        code: 'TARGET_FEATURE_UNSUPPORTED',
        level: 'error',
        message: `${core.id} 核 target ${core.target} 没有内置的自定义 target json 模板，无法生成双核工程`,
      })
    }
  }
  if (errors.length > 0) return { files: [], errors }

  const mainCore = mains[0]
  const packageName = sanitizePackageName(config.projectName)
  const halRev = config.hal?.rev || HAL_REV
  const files: GeneratedFile[] = []

  // ---------- workspace 骨架 ----------
  if (sel.projectSkeleton) {
    const halDependency = sel.vendorHal
      ? 'path = "vendor/ch32-hal", default-features = false'
      : `git = "${HAL_GIT}", rev = "${halRev}", default-features = false`
    files.push({
      path: 'Cargo.toml',
      content: render(T.DUAL_ROOT_CARGO_TPL, {
        members: [...cores.map((c) => `"${c.id}"`), '"xtask"'].join(', '),
        halDependency,
      }),
    })
    files.push({ path: 'rust-toolchain.toml', content: T.DUAL_RUST_TOOLCHAIN_TPL })
    files.push({ path: '.cargo/config.toml', content: T.DUAL_CARGO_CONFIG_TPL })
    files.push({ path: '.gitignore', content: T.GITIGNORE_TPL })
  }

  // ---------- 每核 crate ----------
  for (const core of cores) {
    const main = core === mainCore
    const coreName = `${packageName}-${core.id}`
    const halFeatures = [core.halFeature, 'rt', ...(main ? ['exti'] : []), 'memory-x']
      .map((f) => `"${f}"`)
      .join(', ')
    const rtFeatures = main ? '"highcode"' : `"${core.id}"`
    const qingkeFeatures = main
      ? '"unsafe-trust-wch-atomics", "dual-core"'
      : `"${core.id}", "dual-core", "unsafe-trust-wch-atomics"`

    if (sel.projectSkeleton) {
      files.push({
        path: `${core.id}/Cargo.toml`,
        content: render(T.CORE_CARGO_TPL, { coreName, halFeatures, rtFeatures, qingkeFeatures, mainCore: main }),
      })
      files.push({
        path: `${core.id}/build.rs`,
        content: render(T.CORE_BUILD_RS_TPL, { mainCore: main }),
      })
      files.push({
        path: `${core.id}/memory.x`,
        content: main ? T.H417_V3F_MEMORY_X : T.H417_V5F_MEMORY_X,
      })
      if (main) files.push({ path: `${core.id}/link.x`, content: T.H417_V3F_LINK_X })
      files.push({ path: `${core.id}/${core.target}.json`, content: targetTemplateOf(core.target)! })
      files.push({
        path: `${core.id}/.cargo/config.toml`,
        content: render(T.CORE_CARGO_CONFIG_TPL, { target: core.target }),
      })
    }

    if (main) {
      files.push(...renderCoreGenerated(config, data, sel, usages, embassy, `${core.id}/`))
      files.push({
        path: `${core.id}/src/main.rs`,
        content: render(T.DUAL_V3F_MAIN_TPL, { clockUsed: sel.clock, debugPrint }),
      })
    } else {
      if (sel.clock) files.push(renderClock(config, data, `${core.id}/`))
      files.push({
        path: `${core.id}/src/generated/mod.rs`,
        content: render(T.V5F_GENERATED_MOD_TPL, { clockUsed: sel.clock }),
      })
      files.push({
        path: `${core.id}/src/main.rs`,
        content: render(T.DUAL_V5F_MAIN_TPL, { clockUsed: sel.clock }),
      })
    }
  }

  // ---------- xtask（双核构建/烧录/合并） ----------
  if (sel.projectSkeleton) {
    const flashK = Number.parseInt(data.chip.flash, 10)
    const totalK = Number.isFinite(flashK) ? flashK : 960
    const xtaskCores = cores.map((c) => {
      const main = c === mainCore
      return {
        id: c.id,
        target: c.target,
        bin: `${packageName}-${c.id}`,
        flashBase: main ? '0x0000_0000' : '0x0001_0000',
        flashLimit: main ? '64 * 1024' : `${totalK} * 1024 - 64 * 1024`,
      }
    })
    files.push({ path: 'xtask/Cargo.toml', content: T.XTASK_CARGO_TPL })
    files.push({ path: 'xtask/src/main.rs', content: render(T.XTASK_MAIN_TPL, { cores: xtaskCores }) })
  }

  // ---------- cube.json（工程根，配置回读） ----------
  files.push(renderCubeFile(config))

  // ---------- IDE 配置（可选 vscode） ----------
  files.push(...renderIdeConfigFiles(config, data, sel))

  // ---------- README（含工程报告，与单核同源） ----------
  if (sel.readme) files.push(renderDualReadme(config, data, sel, files, dualFileDesc))

  return { files: withFileGroups(files), errors: [] }
}