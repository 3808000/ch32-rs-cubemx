// 代码生成入口：generateProject(config, data, selection?) → CodegenResult。
// 契约：有 error 级冲突或生成期错误时返回 { files: [], errors }，阻止导出。
// 本文件只做编排；渲染细节见同目录 clock/pins/exti/usart/spi/i2c/adc/irq（生成区）、
// cargo/readme（单核骨架）、core（mod.rs 聚合 + irq::init 调用）、workspace（双核）、cubefile（配置回读）。
// 所有 HAL 签名均核对过 docs/HAL_API_NOTES.md 与 reference/ch32-hal 源码（rev a0863eb…）。
import type { CodegenResult, CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { checkConflicts } from '@/model/conflicts'
import { computeClock, matchPreset, mergeClockConfig } from '@/model/clock'
import { derivePeripheralUsage } from '@/model/peripherals'
import { generationErrors } from './derive'
import { renderSkeletonFiles } from './cargo'
import { renderCoreGenerated } from './core'
import { renderCubeFile } from './cubefile'
import { renderReadme } from './readme'
import { renderHtmlReport } from './htmlReport'
import { generateDualCoreProject } from './workspace'
import { generateCh58xProject } from './ch58x'
import { generateCh5xxProject } from './ch5xx'
import { render } from './render'
import { withFileGroups } from './fileGroup'
import * as T from './templates'

export { sanitizePackageName } from './util'
export { classifyFileGroup, withFileGroups } from './fileGroup'
export {
  MANIFEST_PATH,
  hashContent,
  configHash,
  buildManifest,
  serializeManifest,
  parseManifest,
} from './manifest'
export type { CodegenResult, CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'

/**
 * 生效的 HAL 后端（M17，契约 D1）：
 * - `ProjectConfig.halBackend` 显式值优先（新建工程由 store 写入 chip.halBackend）；
 * - 缺省且芯片声明了 `legacyHalBackend` → 视为历史工程（cube.json 无 halBackend）走 legacy ch58x-hal，
 *   保护旧 main.rs 手写代码；该规则同时让历史 cube.json 与本仓库 ch58x 旧套件保持零 regress；
 * - 其余 → chip.halBackend，再退 ch32-hal。
 */
export function resolveHalBackend(config: ProjectConfig, data: DeviceData): string {
  if (typeof config.halBackend === 'string' && config.halBackend !== '') return config.halBackend
  if (data.chip.legacyHalBackend) return data.chip.legacyHalBackend
  return data.chip.halBackend ?? 'ch32-hal'
}

export function generateProject(
  config: ProjectConfig,
  data: DeviceData,
  selection?: Partial<CodegenSelection>,
): CodegenResult {
  const sel: CodegenSelection = { ...DEFAULT_SELECTION, ...(selection ?? {}) }

  // 数据驱动后端分流（M11/M17）：ch32-hal（缺省）走下方原管线；ch58x-hal（legacy）与
  // ch5xx-hal（CH582 新默认）走各自独立后端；其它未知后端诚实阻止导出。
  const backend = resolveHalBackend(config, data)
  if (backend === 'ch58x-hal') {
    return generateCh58xProject(config, data, sel)
  }
  if (backend === 'ch5xx-hal') {
    return generateCh5xxProject(config, data, sel)
  }
  if (backend !== 'ch32-hal') {
    return {
      files: [],
      errors: [
        {
          code: 'TARGET_FEATURE_UNSUPPORTED',
          level: 'error',
          message: `该芯片使用 ${backend} 后端，当前代码生成仅支持 ch32-hal / ch58x-hal / ch5xx-hal`,
        },
      ],
    }
  }

  // 1. 配置期冲突：error 级直接阻止（unlocked 传 []，与导出一致）
  const conflicts = checkConflicts(config, data, [])
  const errors = conflicts.filter((c) => c.level === 'error')

  // 2. 生成期错误：缺引脚/DMA 映射 → error 级 Conflict，阻止导出
  const usages = derivePeripheralUsage(config, data)
  errors.push(...generationErrors(usages, config.features?.embassy ?? false, data))

  // 3a. M16：仅显示时钟源（RM 低频域 LSI/LSE/CK32K）不可生成——Sw 枚举无对应值，阻止导出
  if (sel.clock) {
    const clockCfg0 = mergeClockConfig(data.clock, config.clock)
    const dispSrc = data.clock.sources.find((s) => s.id === clockCfg0.source && s.displayOnly)
    if (dispSrc) {
      errors.push({
        code: 'CLOCK_DISPLAY_ONLY_SOURCE',
        level: 'error',
        message: `${dispSrc.label} 为仅显示时钟源（RM 低频域，不生成），请改选 HSI/HSE/PLL`,
      })
    }
  }

  // 3. 时钟预设守卫：HAL 只提供时钟配方时（H4），无匹配预设不能用显式字段拼装
  if (sel.clock && data.clock.codegen?.fallback === 'preset_only') {
    const clockCfg = mergeClockConfig(data.clock, config.clock)
    const preset = matchPreset(data.clock, clockCfg)
    const presetConst = preset ? data.clock.codegen.presetConstMap[preset.id] : undefined
    if (!preset || !presetConst) {
      const f = computeClock(data.clock, clockCfg)
      errors.push({
        code: 'CLOCK_PRESET_UNAVAILABLE',
        level: 'error',
        message: `${data.chip.chip} 的 HAL 只提供预置时钟方案（clock.codegen.fallback=preset_only）：当前配置 SYSCLK ${f.sysclkMhz}MHz、AHB÷${clockCfg.ahb} 无匹配预设，请选择预设时钟或调整分频`,
      })
    }
  }
  if (errors.length > 0) return { files: [], errors }

  const embassy = config.features?.embassy ?? false
  const debugPrint = config.features?.debugPrint ?? false

  // 4. 双核芯片（ChipData.cores）→ workspace；单核芯片保持原有输出
  if ((data.chip.cores?.length ?? 0) > 0) {
    return generateDualCoreProject(config, data, sel, usages, embassy, debugPrint)
  }

  const files: GeneratedFile[] = []

  // ---------- 骨架文件（selection.projectSkeleton / src/generated/*） ----------
  files.push(...renderSkeletonFiles(config, data, sel, embassy))
  files.push(...renderCoreGenerated(config, data, sel, usages, embassy))

  // ---------- main.rs（始终生成，用户区） ----------
  files.push({
    path: 'src/main.rs',
    content: render(T.MAIN_TPL, {
      embassy,
      debugPrint,
      clockUsed: sel.clock,
    }),
  })

  // ---------- cube.json（始终生成，配置回读） ----------
  files.push(renderCubeFile(config))

  // ---------- README ----------
  if (sel.readme) files.push(renderReadme(config, data, sel, embassy, files))

  // ---------- HTML 单文件报告（M6，generated 组：随重新生成更新） ----------
  if (sel.htmlReport) files.push(renderHtmlReport(config, data, sel, files, embassy))

  return { files: withFileGroups(files), errors: [] }
}