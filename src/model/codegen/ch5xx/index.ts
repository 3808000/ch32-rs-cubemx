// ch5xx-hal 后端入口（M17）：CH58x 系（CH582M 默认）独立代码生成管线，镜像 ch58x 结构。
// 契约见 docs/CH5XX_BACKEND_CONTRACT.md（D1/D2/D4/D5/D6）；HAL 签名核对 reference/ch5xx-hal @ 875651b6
// （rcc.rs / gpio.rs / uart.rs / spi.rs / i2c.rs / adc.rs / time.rs / embassy/mod.rs）。
//
// 与 legacy ch58x 管线的差异（有意为之）：
// - 骨架含 build.rs（-Tlink.x）与 .cargo [unstable] build-std=["core"]；三档 Cargo feature 矩阵；
// - 外设 API 换成 ch5xx-hal（Peri 句柄、UART rx/tx 顺序、SPI 全双工、I2C 无上拉、ADC 通道=GPIO 单例）；
// - BLE 走自建 ch5xx-ble shim（ch5xx-hal 上游未实现 BLE），busy-poll 运行时；
// - 生成期校验补齐 HAL 会返回 Err 的档（D5 五类 code）。
import type { CodegenResult, CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { checkConflicts } from '@/model/conflicts'
import { derivePeripheralUsage } from '@/model/peripherals'
import { renderCubeFile } from '../cubefile'
import { withFileGroups } from '../fileGroup'
import { render } from '../render'
import * as T from './templates'
import { renderSkeletonFiles, type Ch5xxTier } from './cargo'
import { renderClock } from './clock'
import { renderPins } from './pins'
import { renderUsart } from './usart'
import { renderSpi } from './spi'
import { renderI2c } from './i2c'
import { renderAdc } from './adc'
import { renderBle } from './ble'
import { renderCoreGenerated } from './core'
import { renderCh5xxHtmlReport, renderReadme } from './readme'
import {
  bleGenerationErrors,
  bleLogSerialAvailable,
  featureWarnings,
  generationErrors,
  resolveClock,
} from './derive'
import type { PeriModule } from './derive'

export { CH5XX_HAL_GIT, CH5XX_HAL_REV } from './halRev'

export function generateCh5xxProject(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
): CodegenResult {
  const ble = config.features?.ble ?? false
  // BLE 档是 busy-poll 运行时：不用 embassy executor/Timer，也不启用 hal 的 embassy/time-driver feature。
  const embassy = (config.features?.embassy ?? false) && !ble
  const tier: Ch5xxTier = ble ? 'ble' : embassy ? 'embassy' : 'blocking'
  // 时钟生成被 BLE 强制打开（协议栈需要 PLL 主频 + 32K 低频域）
  const clockUsed = sel.clock || ble
  const clock32k = config.ble?.clock32k ?? 'lse'

  // 1. 配置期冲突（error 阻止导出）；IRQ 名未知不阻断（ch5xx 不生成中断代码）
  const conflicts = checkConflicts(config, data, config.unlockedPins ?? [])
  const errors = conflicts.filter((c) => c.level === 'error' && c.code !== 'IRQ_UNKNOWN')

  // M17 裁决：ch5xx-hal build.rs 硬读兄弟目录 ../ch5xx-data/data，纯 git checkout 缺该数据
  // （S1 实测 panic，docs/m17-shim-notes.md §9）→ ch5xx 档强制 vendor 模式（zip 内嵌 vendor/ch5xx-data）。
  if (!sel.vendorHal) {
    errors.push({
      code: 'TARGET_FEATURE_UNSUPPORTED',
      level: 'error',
      message:
        'ch5xx-hal 后端仅支持 vendor 模式：HAL build.rs 依赖兄弟目录 ch5xx-data，git 依赖 checkout 缺该数据无法编译；请开启「内嵌 vendor HAL」',
    })
  }

  // 2. 生成期错误（D5：UART/SPI/I2C/PLL + 开漏）
  const usages = derivePeripheralUsage(config, data)
  errors.push(...generationErrors(config, data, usages))
  // 2b. BLE 生成期兜底（按 code 去重）
  errors.push(...bleGenerationErrors(config, new Set(errors.map((e) => e.code))))

  // 3. 时钟：预设关联常量 / 显式 PLL / HSE；BLE 档 32K 由 main.rs 调 shim
  const clockPlan = {
    ...resolveClock(config, data),
    clock32k,
  }
  if (clockUsed && clockPlan.error) errors.push(clockPlan.error)

  if (errors.length > 0) return { files: [], errors }

  const logSerial = bleLogSerialAvailable(config, usages)
  const warnings = featureWarnings(config, { usages, logSerial }).map((w) => w.message)
  const files: GeneratedFile[] = []
  const modules: string[] = []

  // 4. 骨架（Cargo/rust-toolchain/.cargo/build.rs/.gitignore + 可选 .vscode）
  files.push(...renderSkeletonFiles(config, data, sel, tier))

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

  if (ble) {
    files.push(renderBle(config, logSerial))
    modules.push('ble')
  }

  files.push(renderCoreGenerated(config, data, sel, modules, peripherals))

  // 6. main.rs（用户区，始终生成）
  files.push({
    path: 'src/main.rs',
    content: render(T.MAIN_RS_TPL, {
      embassy,
      clockUsed,
      ble,
      enableLse: ble && clock32k !== 'lsi',
      clock32k,
    }),
  })

  // 7. cube.json（配置回读；halBackend/ble 字段随 config 原样序列化）
  files.push(renderCubeFile(config))

  // 8. README / HTML 报告
  if (sel.readme) files.push(renderReadme(config, data, sel, embassy, files, warnings, ble))
  if (sel.htmlReport) files.push(renderCh5xxHtmlReport(config, data, sel, files, embassy))

  return { files: withFileGroups(files), errors: [] }
}