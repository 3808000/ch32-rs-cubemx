// ch58x README 渲染：工程概览 + 文件清单 + 构建/烧录 + 诚实能力边界。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { computeClock, mergeClockConfig } from '@/model/clock'
import { CH58X_HAL_REV, HAL_REV } from '../halRev'
import { renderHtmlReport } from '../htmlReport'
import { render } from '../render'
import { fmtMhz, sanitizePackageName } from '../util'
import * as T from './templates'

/** 与导出文件一一对应的说明（路径不存在时给空描述）。 */
const FILE_DESCS: Record<string, string> = {
  'Cargo.toml': '工程清单与依赖（ch58x-hal / qingke-rt 0.5 / panic-halt）',
  'rust-toolchain.toml': '工具链锁定（blocking=stable，embassy=nightly）',
  '.cargo/config.toml': '构建目标与链接参数（-Tlink.x；无 build.rs）',
  '.gitignore': 'Git 忽略规则（构建产物 target/）',
  'cube.json': 'ch32-rs-CubeMX 配置回读（可重新导入）',
  '.vscode/settings.json': 'rust-analyzer 目标配置（可选生成）',
  '.vscode/tasks.json': '构建 + MRS OpenOCD gdbserver/烧录 + wchisp 备用任务（可选生成）',
  '.vscode/launch.json': 'cppdbg attach localhost:3333（MRS OpenOCD，可选生成）',
  'report.html': 'HTML 单文件工程报告（generated 组）',
  'src/main.rs': '用户代码入口（不会被重新导出覆盖）',
  'src/generated/mod.rs': '生成模块聚合（init 返回 Generated）',
  'src/generated/clock.rs': '时钟配置（预设方法或 ClockSrc::PLL(div)）',
  'src/generated/pins.rs': 'GPIO 引脚初始化（Output/Input）',
  'src/generated/usart.rs': 'UART 初始化（阻塞）',
  'src/generated/spi.rs': 'SPI0 初始化 + 软件 NSS',
  'src/generated/i2c.rs': 'I2C 初始化（阻塞）',
  'src/generated/adc.rs': 'ADC 初始化（通道=裸引脚单例）',
  'src/generated/ble.rs': 'BLE 协议栈脚手架（config/run + GATT/广播/扫描 + TMOS 泵）',
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
  const clockSummary = cfg.source === 'PLL' ? `PLL 480MHz ÷ ${cfg.pll?.div ?? '?'} = ${fmtMhz(f.sysclkMhz)}` : `${cfg.source} 直连 ${fmtMhz(f.sysclkMhz)}`

  return {
    path: 'README.md',
    content: render(T.README_TPL, {
      projectName: config.projectName,
      chip: data.chip.chip,
      chipPackage: data.chip.package,
      target: data.chip.target,
      packageName: sanitizePackageName(config.projectName),
      halRev: CH58X_HAL_REV,
      embassy,
      ble,
      vendorHal: sel.vendorHal,
      clockSummary,
      warnings,
      files: files.map((x) => ({ path: x.path, desc: FILE_DESCS[x.path] ?? '' })),
    }),
  }
}

/**
 * HTML 单文件报告：复用 backend-agnostic 的 htmlReport.ts（契约 D1），
 * 但其概览/文件组表硬编码了 ch32-hal 的名称与 rev 链接（readme.ts 所属的 ch32 管线不在本域），
 * 这里对生成后的 HTML 做后处理，改为 ch58x-hal 的真实名称/仓库/rev，避免报告说谎。
 */
export function renderCh58xHtmlReport(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  files: GeneratedFile[],
  embassy: boolean,
): GeneratedFile {
  // 用原始 config 生成（保证报告里的 configHash 与 cube.json 同口径），再做文本替换
  const report = renderHtmlReport(config, data, sel, files, embassy)
  const originalRev = config.hal?.rev || HAL_REV
  let content = report.content.split('vendor/ch32-hal').join('vendor/ch58x-hal').split('ch32-rs/ch32-hal').join('ch32-rs/ch58x-hal')
  if (originalRev !== CH58X_HAL_REV) {
    content = content.split(originalRev).join(CH58X_HAL_REV)
    content = content.split(originalRev.slice(0, 7)).join(CH58X_HAL_REV.slice(0, 7))
  }
  if (embassy) content = content.split('<td>stable</td>').join('<td>nightly</td>')
  return { ...report, content }
}
