// ch58x-hal 后端入口（M11）：CH58x 系（CH582M 等）独立代码生成管线。
// 契约见 docs/CH58X_BACKEND_CONTRACT.md；所有 HAL 签名核对 reference/ch58x-hal @ 611954e
// （uart.rs / spi.rs / i2c.rs / adc.rs / gpio.rs / sysctl.rs / delay.rs / embassy/mod.rs）。
//
// 与 ch32 管线的差异（有意为之，见契约 D2–D14）：
// - 生成区结构相同（src/generated/** + 用户区 main.rs），但 Rust API 全部换成 ch58x-hal；
// - 运行时两档：blocking（stable + #[qingke_rt::entry]）与 embassy（nightly + entry 宏 + hal::embassy::init）；
// - 不生成 exti.rs / irq.rs / DMA / Timer / PWM；不生成 launch.json；不生成 BLE。
import type { CodegenResult, CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { checkConflicts } from '@/model/conflicts'
import { derivePeripheralUsage } from '@/model/peripherals'
import { renderCubeFile } from '../cubefile'
import { withFileGroups } from '../fileGroup'
import { render } from '../render'
import * as T from './templates'
import { renderSkeletonFiles } from './cargo'
import { renderClock } from './clock'
import { renderPins } from './pins'
import { renderUsart } from './usart'
import { renderSpi } from './spi'
import { renderI2c } from './i2c'
import { renderAdc } from './adc'
import { renderCoreGenerated } from './core'
import { renderCh58xHtmlReport, renderReadme } from './readme'
import { featureWarnings, generationErrors, resolveClock } from './derive'
import type { PeriModule } from './derive'

export { CH58X_HAL_GIT, CH58X_HAL_REV } from '../halRev'

export function generateCh58xProject(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
): CodegenResult {
  // 1. 配置期冲突（error 阻止导出）；unlockedPins 与 preflight 保持一致（CH582M 的 PB23=nrst 可解锁）
  const conflicts = checkConflicts(config, data, config.unlockedPins ?? [])
  // 契约 D9：ch58x 不生成任何中断代码（HAL 无 bind_interrupts），config.interrupts 整体忽略；
  // 未知 IRQ 名（例如从 ch32 工程导入的 cube.json）不应阻断 ch58x 导出（README 有说明）。
  const errors = conflicts.filter((c) => c.level === 'error' && c.code !== 'IRQ_UNKNOWN')

  // 2. 生成期错误：开漏 / UART 缺引脚 / SPI 构造方式 / I2C 缺引脚
  const usages = derivePeripheralUsage(config, data)
  errors.push(...generationErrors(config, data, usages))

  // 3. 时钟：只支持 PLL（预设方法或显式 ClockSrc::PLL(div)）
  const clockPlan = resolveClock(config, data)
  if (sel.clock && clockPlan.error) errors.push(clockPlan.error)

  if (errors.length > 0) return { files: [], errors }

  const embassy = config.features?.embassy ?? false
  // warning 不放进 errors（任何条目都会阻止导出）；通过 README/报告诚实标注
  const warnings = featureWarnings(config).map((w) => w.message)
  const files: GeneratedFile[] = []
  const modules: string[] = []

  // 4. 骨架（Cargo/rust-toolchain/.cargo/.gitignore + 可选 .vscode）
  files.push(...renderSkeletonFiles(config, data, sel, embassy))

  // 5. 生成区
  if (sel.clock) {
    files.push(renderClock(clockPlan))
    modules.push('clock')
  }
  if (sel.pins) {
    files.push(renderPins(config, data))
    modules.push('pins')
  }

  const peripherals: PeriModule[] = []
  const addPeri = (m: PeriModule | null) => {
    if (!m) return
    files.push(m.file)
    modules.push(m.module)
    peripherals.push(m)
  }
  if (sel.usart) addPeri(renderUsart(usages))
  if (sel.spi) addPeri(renderSpi(config, usages))
  if (sel.i2c) addPeri(renderI2c(usages))
  if (sel.adc) addPeri(renderAdc(usages))

  files.push(renderCoreGenerated(config, data, sel, modules, peripherals))

  // 6. main.rs（用户区，始终生成）
  files.push({
    path: 'src/main.rs',
    content: render(T.MAIN_RS_TPL, { embassy, clockUsed: sel.clock }),
  })

  // 7. cube.json（配置回读）
  files.push(renderCubeFile(config))

  // 8. README / HTML 报告
  if (sel.readme) files.push(renderReadme(config, data, sel, embassy, files, warnings))
  if (sel.htmlReport) files.push(renderCh58xHtmlReport(config, data, sel, files, embassy))

  return { files: withFileGroups(files), errors: [] }
}
