// ch5xx README 渲染：工程概览 + 文件清单 + 构建/能力边界 + HTML 报告后端名修正。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { computeClock, mergeClockConfig } from '@/model/clock'
import { CH5XX_HAL_REV } from './halRev'
import { HAL_REV } from '../halRev'
import { renderHtmlReport } from '../htmlReport'
import { render } from '../render'
import { fmtMhz, sanitizePackageName } from '../util'
import * as T from './templates'

/** 与导出文件一一对应的说明（路径不存在时给空描述）。 */
const FILE_DESCS: Record<string, string> = {
  'Cargo.toml': '工程清单与依赖（ch5xx-hal / qingke-rt 0.8.4 / panic-halt）',
  'rust-toolchain.toml': '工具链锁定（nightly + rust-src，build-std=core）',
  '.cargo/config.toml': '构建目标与 [unstable] build-std（链接参数由 build.rs 发出）',
  'build.rs': '发出 cargo:rustc-link-arg-bins=-Tlink.x',
  '.gitignore': 'Git 忽略规则（构建产物 target/）',
  'cube.json': 'ch32-rs-CubeMX 配置回读（可重新导入）',
  '.vscode/settings.json': 'rust-analyzer 目标配置（可选生成）',
  '.vscode/tasks.json': '构建 + MRS OpenOCD gdbserver/烧录 + wchisp 备用任务（可选生成）',
  '.vscode/launch.json': 'cppdbg attach localhost:3333（MRS OpenOCD，可选生成）',
  'report.html': 'HTML 单文件工程报告（generated 组）',
  'src/main.rs': '用户代码入口（不会被重新导出覆盖）',
  'src/generated/mod.rs': '生成模块聚合（init 返回 Generated）',
  'src/generated/clock.rs': '时钟配置（rcc 预设或显式 PLL/HSE）',
  'src/generated/pins.rs': 'GPIO 引脚初始化（Output/Input）',
  'src/generated/usart.rs': 'UART 初始化（阻塞，peri→rx→tx）',
  'src/generated/spi.rs': 'SPI0 初始化（全双工 + 软件 NSS）',
  'src/generated/i2c.rs': 'I2C 初始化（阻塞，peri→scl→sda）',
  'src/generated/adc.rs': 'ADC 初始化（通道 = GPIO 单例）',
  'src/generated/ble.rs': 'BLE 协议栈脚手架（ch5xx-ble shim：ble::init + GATT/广播/扫描 + busy-poll TMOS 泵）',
}

export function renderReadme(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  embassy: boolean,
  files: GeneratedFile[],
  warnings: string[],
  ble = false,
): GeneratedFile {
  const cfg = mergeClockConfig(data.clock, config.clock)
  const f = computeClock(data.clock, cfg)
  const clockSummary =
    cfg.source === 'PLL'
      ? `PLL 480MHz ÷ ${cfg.pll?.div ?? '?'} = ${fmtMhz(f.sysclkMhz)}`
      : `${cfg.source} 直连 ${fmtMhz(f.sysclkMhz)}`

  return {
    path: 'README.md',
    content: render(T.README_TPL, {
      projectName: config.projectName,
      chip: data.chip.chip,
      chipPackage: data.chip.package,
      target: data.chip.target,
      packageName: sanitizePackageName(config.projectName),
      halRev: CH5XX_HAL_REV,
      embassy,
      ble,
      clock32k: config.ble?.clock32k ?? 'lse',
      vendorHal: sel.vendorHal,
      clockSummary,
      warnings,
      files: files.map((x) => ({ path: x.path, desc: FILE_DESCS[x.path] ?? '' })),
    }),
  }
}

/**
 * HTML 单文件报告：复用 backend-agnostic 的 htmlReport.ts，再做后端名/rev 文本替换，
 * 避免报告把 ch5xx 工程写成 ch32-hal/ch58x-hal。
 */
export function renderCh5xxHtmlReport(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  files: GeneratedFile[],
  embassy: boolean,
): GeneratedFile {
  const report = renderHtmlReport(config, data, sel, files, embassy)
  const originalRev = config.hal?.rev || HAL_REV
  let content = report.content
    .split('vendor/ch32-hal')
    .join('vendor/ch5xx-hal')
    .split('vendor/ch58x-hal')
    .join('vendor/ch5xx-hal')
    .split('ch32-rs/ch32-hal')
    .join('ch32-rs/ch5xx-hal')
    .split('ch32-rs/ch58x-hal')
    .join('ch32-rs/ch5xx-hal')
  if (originalRev !== CH5XX_HAL_REV) {
    content = content.split(originalRev).join(CH5XX_HAL_REV)
    content = content.split(originalRev.slice(0, 7)).join(CH5XX_HAL_REV.slice(0, 7))
  }
  // ch5xx 三档全部 nightly（build-std=core）
  content = content.split('<td>stable</td>').join('<td>nightly</td>')
  if (config.features?.ble) {
    content = content
      .split('<td>blocking（阻塞）</td>')
      .join('<td>busy-poll（BLE，nightly，无 executor/Timer）</td>')
  }
  return { ...report, content }
}