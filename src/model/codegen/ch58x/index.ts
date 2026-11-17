// ch58x-hal 后端入口（M11 管线 / M12 BLE / M13 BLE busy-poll）：CH58x 系（CH582M 等）独立代码生成管线。
// 契约见 docs/CH58X_BACKEND_CONTRACT.md 与 docs/CH58X_BLE_CONTRACT.md；HAL 签名核对 reference/ch58x-hal @ 611954e
// （uart.rs / spi.rs / i2c.rs / adc.rs / gpio.rs / sysctl.rs / delay.rs / embassy/mod.rs / ble/*）。
//
// 与 ch32 管线的差异（有意为之，见契约 D2–D14）：
// - 生成区结构相同（src/generated/** + 用户区 main.rs），但 Rust API 全部换成 ch58x-hal；
// - 运行时三档：blocking（stable + #[qingke_rt::entry]）、embassy（nightly + entry 宏 + hal::embassy::init）
//   与 BLE busy-poll（stable + #[qingke_rt::entry] + csrs mstatus,8 + TMOS 忙等泵，M13）；
// - 不生成 exti.rs / irq.rs / DMA / Timer / PWM；M12 起生成 BLE（generated/ble.rs，三角色）与
//   MRS OpenOCD 调试链（launch.json + gdbserver/烧录任务，两线调试需 ISP/BOOT 开启）。
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
import { renderBle } from './ble'
import { renderCoreGenerated } from './core'
import { renderCh58xHtmlReport, renderReadme } from './readme'
import { bleGenerationErrors, bleLogSerialAvailable, featureWarnings, generationErrors, resolveClock } from './derive'
import type { PeriModule } from './derive'

export { CH58X_HAL_GIT, CH58X_HAL_REV } from '../halRev'

export function generateCh58xProject(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
): CodegenResult {
  const ble = config.features?.ble ?? false
  // BLE 档仍要求 features.embassy（D2：Cargo features 编译耦合 ["embassy", "ble"]），但 M13 起
  // 生成骨架按 busy-poll 运行时处理：不用 embassy executor/Timer、不用 nightly feature。
  // 因此“运行时 embassy”只看非 BLE 工程——ble 分支生成器完全忽略 features.embassy。
  const embassy = (config.features?.embassy ?? false) && !ble
  // 时钟生成被 BLE 强制打开：ble::init 硬编码 SelRTCClock=0，需要 clock.rs 生成 PLL 主频配置。
  // M13：BLE 档不再追加 enable_lse()（板子可能无 LSE 晶振；库在 SelRTCClock=0 时内部回退 LSI）。
  const clockUsed = sel.clock || ble

  // 1. 配置期冲突（error 阻止导出）；unlockedPins 与 preflight 保持一致（CH582M 的 PB23=nrst 可解锁）
  const conflicts = checkConflicts(config, data, config.unlockedPins ?? [])
  // 契约 D9：ch58x 不生成任何中断代码（HAL 无 bind_interrupts），config.interrupts 整体忽略；
  // 未知 IRQ 名（例如从 ch32 工程导入的 cube.json）不应阻断 ch58x 导出（README 有说明）。
  const errors = conflicts.filter((c) => c.level === 'error' && c.code !== 'IRQ_UNKNOWN')

  // 2. 生成期错误：开漏 / UART 缺引脚 / SPI 构造方式 / I2C 缺引脚
  const usages = derivePeripheralUsage(config, data)
  errors.push(...generationErrors(config, data, usages))
  // 2b. BLE 生成期兜底（D2/D3/D7；冲突链已报的 code 不重复报）
  errors.push(...bleGenerationErrors(config, new Set(errors.map((e) => e.code))))

  // 3. 时钟：只支持 PLL（预设方法或显式 ClockSrc::PLL(div)）
  const clockPlan = resolveClock(config, data)
  if (clockUsed && clockPlan.error) errors.push(clockPlan.error)

  if (errors.length > 0) return { files: [], errors }

  const logSerial = bleLogSerialAvailable(config, usages)
  // warning 不放进 errors（任何条目都会阻止导出）；通过 README/报告诚实标注
  const warnings = featureWarnings(config, { usages, logSerial }).map((w) => w.message)
  const files: GeneratedFile[] = []
  const modules: string[] = []

  // 4. 骨架（Cargo/rust-toolchain/.cargo/.gitignore + 可选 .vscode）
  files.push(...renderSkeletonFiles(config, data, sel, embassy))

  // 5. 生成区
  if (clockUsed) {
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

  // BLE 脚手架（D4）：开启即生成，不受其他 selection 开关影响（main.rs 依赖它）
  if (ble) {
    files.push(renderBle(config, logSerial))
    modules.push('ble')
  }

  files.push(renderCoreGenerated(config, data, sel, modules, peripherals))

  // 6. main.rs（用户区，始终生成）
  files.push({
    path: 'src/main.rs',
    content: render(T.MAIN_RS_TPL, { embassy, clockUsed, ble }),
  })

  // 7. cube.json（配置回读；ble 字段随 config 原样序列化）
  files.push(renderCubeFile(config))

  // 8. README / HTML 报告
  if (sel.readme) files.push(renderReadme(config, data, sel, embassy, files, warnings, ble))
  if (sel.htmlReport) files.push(renderCh58xHtmlReport(config, data, sel, files, embassy))

  return { files: withFileGroups(files), errors: [] }
}
