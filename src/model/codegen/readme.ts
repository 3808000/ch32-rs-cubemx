// 单核 README：工程概要 + 已生成文件说明表（按路径查表，未知路径留空说明）。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { HAL_REV } from './halRev'
import { render } from './render'
import { sanitizePackageName } from './util'
import * as T from './templates'

/** 单核工程的文件说明（与导出的骨架/生成区路径一一对应） */
const FILE_DESCS: Record<string, string> = {
  'Cargo.toml': '工程清单与依赖（ch32-hal 及运行时 crate）',
  'rust-toolchain.toml': '工具链锁定（nightly/stable 由芯片 target 决定）',
  '.cargo/config.toml': '构建目标与 wlink runner',
  'build.rs': '注入 -Tlink.x 链接参数',
  '.gitignore': 'Git 忽略规则（构建产物 target/）',
  'riscv32ec-unknown-none-elf.json': 'tier-3 自定义 target 描述',
  'cube.json': 'ch32-rs-CubeMX 配置回读（可重新导入）',
  'src/main.rs': '用户代码入口（不会被重新导出覆盖）',
  'src/generated/mod.rs': '生成模块聚合（init 返回 Generated）',
  'src/generated/clock.rs': '时钟树 → RCC 配置',
  'src/generated/pins.rs': 'GPIO 引脚初始化',
  'src/generated/exti.rs': 'EXTI 输入初始化',
  'src/generated/usart.rs': 'USART 初始化',
  'src/generated/spi.rs': 'SPI 初始化',
  'src/generated/i2c.rs': 'I2C 初始化',
  'src/generated/adc.rs': 'ADC 初始化（通道=引脚字段）',
}

/** 生成 README.md（files 为已收集的全部导出文件，用于列文件说明）。 */
export function renderReadme(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  embassy: boolean,
  files: GeneratedFile[],
): GeneratedFile {
  return {
    path: 'README.md',
    content: render(T.README_TPL, {
      projectName: config.projectName,
      chip: data.chip.chip,
      chipPackage: data.chip.package,
      target: data.chip.target,
      packageName: sanitizePackageName(config.projectName),
      halRev: config.hal?.rev || HAL_REV,
      nightly: data.chip.nightly,
      embassy,
      vendorHal: sel.vendorHal,
      files: files.map((f) => ({ path: f.path, desc: FILE_DESCS[f.path] ?? '' })),
    }),
  }
}