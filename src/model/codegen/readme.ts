// 单核 README：工程报告（引脚/时钟/外设/中断/预算/生成元数据）+ 文件说明表 + 构建/烧录约定。
import type {
  BuildProfile,
  CodegenSelection,
  DeviceData,
  GeneratedFile,
  PinAssignment,
  ProjectConfig,
} from '@/model/types'
import { computeClock, matchPreset, mergeClockConfig } from '@/model/clock'
import { derivePeripheralUsage, type PeripheralUsage } from '@/model/peripherals'
import { HAL_REV } from './halRev'
import { VSCODE_DEBUG_NOTE } from './templates/ideConfig'
import { render } from './render'
import { sanitizePackageName } from './util'
import pkg from '../../../package.json'
import * as T from './templates'

/** 单核工程的文件说明（与导出的骨架/生成区路径一一对应） */
const FILE_DESCS: Record<string, string> = {
  'Cargo.toml': '工程清单与依赖（ch32-hal 及运行时 crate）',
  'rust-toolchain.toml': '工具链锁定（nightly/stable 由芯片 target 决定）',
  '.cargo/config.toml': '构建目标、wlink runner 与构建档位别名',
  'build.rs': '注入 -Tlink.x 链接参数',
  '.gitignore': 'Git 忽略规则（构建产物 target/）',
  'riscv32ec-unknown-none-elf.json': 'tier-3 自定义 target 描述',
  'cube.json': 'ch32-rs-CubeMX 配置回读（可重新导入）',
  '.vscode/settings.json': 'rust-analyzer 目标与检查配置（可选生成）',
  '.vscode/tasks.json': '构建/烧录任务（可选生成）',
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

const TOOL_NAME = 'ch32-rs-CubeMX'
const TOOL_VERSION: string = pkg.version

/** README 工程报告的各张表（预先渲染为 markdown，模板只负责排版）。 */
export interface ReadmeReport {
  pinTable: string
  clockTable: string
  peripheralTable: string
  interruptTable?: string
  budgetTable: string
  metadataTable: string
  toolchainTable: string
}

/** Markdown 表格单元格转义：空值显示 —，避免竖线/换行破坏表格。 */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null || value === '') return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** MHz 数值格式化：最多 3 位小数，去掉无意义的尾零。 */
function fmtMhz(value: number): string {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '')
  return `${text === '' || text === '-' ? '0' : text} MHz`
}

/** SHA-256（同步实现）：README 生成期是同步流程，无法使用异步 Web Crypto。
 *  输入/输出与 model/codegen/manifest 的 configHash 保持一致（UTF-8 + 小写 hex）。 */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6
  const buf = new Uint8Array(paddedLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const view = new DataView(buf.buffer)
  const bits = bytes.length * 8
  view.setUint32(paddedLen - 8, Math.floor(bits / 0x100000000))
  view.setUint32(paddedLen - 4, bits >>> 0)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('')
}

/** 引脚模式/信号列：模式 + 信号名 + 影响生成的参数（不臆造未配置项）。 */
function pinModeText(p: PinAssignment): string {
  const parts: string[] = [p.mode]
  if (p.function) parts.push(p.function)
  const detail: string[] = []
  if (p.params.outputType) detail.push(p.params.outputType)
  if (p.params.speed) detail.push(p.params.speed)
  if (p.params.level) detail.push(`初始 ${p.params.level}`)
  if (p.params.pull && p.params.pull !== 'NONE') detail.push(`上/下拉 ${p.params.pull}`)
  if (p.params.exti?.enabled) detail.push(`EXTI ${p.params.exti.edge}`)
  return detail.length > 0 ? `${parts.join(' / ')}（${detail.join(', ')}）` : parts.join(' / ')
}

function peripheralParams(u: PeripheralUsage): string {
  const keys = Object.keys(u.params).sort()
  if (keys.length === 0) return '—'
  return keys.map((k) => `${k}=${u.params[k]}`).join(', ')
}

/** 引脚占用表：按封装物理位号排序（数据层 number）。 */
function buildPinTable(config: ProjectConfig, data: DeviceData): string {
  const byName = new Map<string, { number: number }>()
  for (const p of data.chip.pins) {
    byName.set(p.name, p)
    for (const alias of p.aliases ?? []) if (!byName.has(alias)) byName.set(alias, p)
  }
  const rows = [...config.pins]
    .sort((a, b) => {
      const na = byName.get(a.pin)?.number ?? Number.MAX_SAFE_INTEGER
      const nb = byName.get(b.pin)?.number ?? Number.MAX_SAFE_INTEGER
      return na - nb
    })
    .map((p) => {
      const physical = byName.get(p.pin)?.number
      return `| ${cell(physical ?? '?')} | ${cell(p.pin)} | ${cell(pinModeText(p))} | ${cell(p.label)} | ${cell(p.remap)} |`
    })
  if (rows.length === 0) return '当前未配置 GPIO/外设引脚。'
  return ['| 位号 | 引脚 | 模式/信号 | 标签 | remap |', '|---|---|---|---|---|', ...rows].join('\n')
}

/** 时钟五元组：SYSCLK/HCLK/PCLK1/PCLK2/ADC（与 codegen 使用同一 computeClock）。 */
function buildClockTable(config: ProjectConfig, data: DeviceData): string {
  const cfg = mergeClockConfig(data.clock, config.clock)
  const f = computeClock(data.clock, cfg)
  const rows: [string, number][] = [
    ['SYSCLK', f.sysclkMhz],
    ['HCLK', f.hclkMhz],
    ['PCLK1', f.pclk1Mhz],
    ['PCLK2', f.pclk2Mhz],
    ['ADC', f.adcMhz],
  ]
  return ['| 时钟域 | 频率 |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${fmtMhz(v)} |`)].join('\n')
}

/** 外设实例表：仅列已启用实例（derivePeripheralUsage 的同一份推导结果）。 */
function buildPeripheralTable(config: ProjectConfig, data: DeviceData): string {
  const usages = derivePeripheralUsage(config, data).filter((u) => u.enabled)
  if (usages.length === 0) return '当前未启用 USART/SPI/I2C/ADC 实例。'
  const rows = usages.map((u) => {
    const signals = u.pins.length > 0 ? u.pins.map((p) => p.role.toUpperCase()).join(' / ') : '—'
    const pins = u.pins.length > 0 ? u.pins.map((p) => p.pin).join(' / ') : '—'
    return `| ${cell(u.id)} | ${cell(signals)} | ${cell(pins)} | ${cell(u.remap)} | ${cell(peripheralParams(u))} |`
  })
  return ['| 实例 | 信号 | 引脚 | remap | 关键参数 |', '|---|---|---|---|---|', ...rows].join('\n')
}

/** 中断表：仅当 cube.json 显式配置了 interrupts 时生成。 */
function buildInterruptTable(config: ProjectConfig): string | undefined {
  const interrupts = config.interrupts ?? []
  if (interrupts.length === 0) return undefined
  const rows = interrupts.map(
    (i) => `| ${cell(i.irq)} | ${i.enabled ? '启用' : '关闭'} | ${cell(i.priority)} |`,
  )
  return ['| 中断 | 状态 | 优先级 |', '|---|---|---|', ...rows].join('\n')
}

/** Flash/RAM 预算：容量来自 chip.json（不推算实际占用，构建产物为准）。 */
function buildBudgetTable(data: DeviceData): string {
  return [
    '| 区域 | 容量 |',
    '|---|---|',
    `| Flash | ${cell(data.chip.flash)} |`,
    `| SRAM | ${cell(data.chip.sram)} |`,
  ].join('\n')
}

/** 生成元数据：工具名/版本、时间、cube.json configHash、HAL rev。 */
function buildMetadataTable(config: ProjectConfig): string {
  const halRev = config.hal?.rev || HAL_REV
  const hash = sha256Hex(JSON.stringify(config))
  return [
    '| 项 | 值 |',
    '|---|---|',
    `| 生成工具 | ${TOOL_NAME} ${TOOL_VERSION} |`,
    `| 生成时间 | ${new Date().toISOString()} |`,
    `| cube.json configHash | \`${hash}\` |`,
    `| HAL rev | \`${halRev}\` |`,
  ].join('\n')
}

/** 构建档位表（profile 与 .cargo/config.toml 别名一一对应）。 */
function buildToolchainTable(profile: BuildProfile): string {
  return [
    '| 命令 | profile | 用途 |',
    '|---|---|---|',
    "| `cargo build --release` | `release` | 默认构建（opt-level='s', lto='fat', debug=2） |",
    `| \`cargo build-size\` | \`release-size\` | 体积优先（opt-level='z', lto='fat', strip='symbols'）${profile === 'release-size' ? ' ← 当前选择' : ''} |`,
    `| \`cargo build-speed\` | \`release-speed\` | 速度优先（opt-level=3）${profile === 'release-speed' ? ' ← 当前选择' : ''} |`,
    `| \`cargo build-debug\` | \`release-debug\` | 可调试（debug=2, opt-level='s'）${profile === 'release-debug' ? ' ← 当前选择' : ''} |`,
  ].join('\n')
}

/** 构造 README 工程报告（单核与双核模板共用同一数据源）。 */
export function buildReadmeReport(
  config: ProjectConfig,
  data: DeviceData,
  profile: BuildProfile = 'release-size',
): ReadmeReport {
  return {
    pinTable: buildPinTable(config, data),
    clockTable: buildClockTable(config, data),
    peripheralTable: buildPeripheralTable(config, data),
    interruptTable: buildInterruptTable(config),
    budgetTable: buildBudgetTable(data),
    metadataTable: buildMetadataTable(config),
    toolchainTable: buildToolchainTable(profile),
  }
}

/**
 * 双核 README（M4.3）：与单核共用同一份工程报告。
 * files 为已收集的导出文件；fileDesc 由调用方提供，避免在 model 层复制 workspace 的路径说明表。
 */
export function renderDualReadme(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  files: GeneratedFile[],
  fileDesc: (path: string) => string,
): GeneratedFile {
  const cores = data.chip.cores ?? []
  const f = computeClock(data.clock, mergeClockConfig(data.clock, config.clock))
  const profile = sel.profile ?? 'release-size'
  return {
    path: 'README.md',
    content: render(T.DUAL_README_TPL, {
      projectName: config.projectName,
      chip: data.chip.chip,
      chipPackage: data.chip.package,
      coreSummary: cores.map((c) => c.label).join(' + '),
      cores: cores.map((c) => ({
        id: c.id,
        label: c.label,
        halFeature: c.halFeature,
        target: c.target,
        mainCore: c.mainCore === true,
      })),
      clockSummary: `当前配置：SYSCLK ${f.sysclkMhz}MHz，HCLK ${f.hclkMhz}MHz，PCLK1 ${f.pclk1Mhz}MHz，PCLK2 ${f.pclk2Mhz}MHz。`,
      vendorHal: sel.vendorHal,
      files: files.map((x) => ({ path: x.path, desc: fileDesc(x.path) })),
      profile,
      ...buildReadmeReport(config, data, profile),
      // 双核工程的构建由 xtask 编排，根 Cargo.toml 暂不生成三档 profile：不展示单核档位表
      toolchainTable: '',
      debugNote: sel.ideConfig === 'vscode' ? VSCODE_DEBUG_NOTE : '',
    }),
  }
}

/** 生成 README.md（files 为已收集的全部导出文件，用于列文件说明）。 */
export function renderReadme(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  embassy: boolean,
  files: GeneratedFile[],
): GeneratedFile {
  // 时钟摘要节：频率表由 buildClockTable 提供，预设名与 UI/codegen 使用同一 matchPreset。
  const clockPreset = matchPreset(data.clock, mergeClockConfig(data.clock, config.clock))?.label ?? '显式配置'
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
      ideConfig: sel.ideConfig === 'vscode',
      debugNote: VSCODE_DEBUG_NOTE,
      profile: sel.profile ?? 'release-size',
      clockPreset,
      ...buildReadmeReport(config, data, sel.profile ?? 'release-size'),
      files: files.map((f) => ({ path: f.path, desc: FILE_DESCS[f.path] ?? '' })),
    }),
  }
}