// HTML 单文件工程报告（M6）：概览/引脚全表/时钟/外设/中断/DMA/生成文件清单 + 文件组策略。
// 纯函数、确定性输出：不内嵌时间戳（可选 now 由调用方传入），同一输入逐字节一致。
// 单文件、内联 CSS、无外部依赖/无 JS，离线可完整阅读；所有用户可控字符串一律 HTML 转义。
// 产物 report.html 显式归 generated 组（随每次重新生成更新；路径推断会落到 project_file，故显式覆盖）。
import type {
  CodegenSelection,
  DeviceData,
  FileGroup,
  GeneratedFile,
  PinAssignment,
  ProjectConfig,
} from '@/model/types'
import { computeClock, mergeClockConfig } from '@/model/clock'
import { derivePeripheralUsage, type PeripheralUsage } from '@/model/peripherals'
import { sha256Hex } from './readme'
import { HAL_GIT, HAL_REV } from './halRev'
import { classifyFileGroup } from './fileGroup'
import { HTML_REPORT_SHELL } from './templates/htmlReport'
import pkg from '../../../package.json'

const TOOL_NAME = 'ch32-rs-CubeMX'
const TOOL_VERSION: string = pkg.version

/** HTML 转义：工程名/标签/信号名等用户可控字符串防注入（& < > " ' 全替换，& 必须最先）。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 单元格文本：空值显示 —（0/false 是有效值，正常显示）。 */
function cellText(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

/** 纯文本表格：表头与单元格全部转义后输出。 */
function htmlTable(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(cellText(c))}</td>`).join('')}</tr>`)
    .join('\n')
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`
}

/** 键值表：值列由调用方预先转义/构造（可含链接、code 等安全 HTML）。 */
function kvTable(rows: [string, string][]): string {
  const body = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('\n')
  return `<table class="kv">\n<tbody>\n${body}\n</tbody>\n</table>`
}

/** 空表占位（中断/DMA 未配置等场景）。 */
const EMPTY_NOTE = '<p class="empty">无</p>'

/** MHz 数值格式化：与 readme.ts 的时钟表一致（最多 3 位小数，去尾零）。 */
function fmtMhz(value: number): string {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '')
  return `${text === '' || text === '-' ? '0' : text} MHz`
}

/** 特殊脚标记的中文展示名（数据层 special 枚举）。 */
const SPECIAL_LABELS: Record<string, string> = {
  nrst: 'NRST',
  boot: 'BOOT',
  swd: 'SWD',
  osc: 'OSC',
}

/** 引脚边展示名。 */
const SIDE_LABELS: Record<string, string> = {
  left: '左',
  right: '右',
  top: '上',
  bottom: '下',
}

/** 外设关键参数：键排序保证确定性（与 readme.ts 同一展示思路）。 */
function peripheralParams(u: PeripheralUsage): string {
  const keys = Object.keys(u.params).sort()
  if (keys.length === 0) return '—'
  return keys.map((k) => `${k}=${u.params[k]}`).join(', ')
}

/** HAL rev 的 GitHub commit 链接（HAL_GIT 去掉 .git 后缀即仓库主页）。 */
function halCommitUrl(rev: string): string {
  return `${HAL_GIT.replace(/\.git$/, '')}/commit/${rev}`
}

/** 概览：工程/芯片/target/工具链/HAL rev/运行时/生成器/configHash 等。 */
function buildOverview(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  embassy: boolean,
  now?: string,
): string {
  const halRev = config.hal?.rev || HAL_REV
  // 与 manifest.configHash 同一口径：JSON.stringify(config) 的同步 sha256（readme.ts 实现）。
  const hash = sha256Hex(JSON.stringify(config))
  const rows: [string, string][] = [
    ['工程名', escapeHtml(config.projectName)],
    ['芯片', escapeHtml(data.chip.chip)],
    ['封装', escapeHtml(data.chip.package)],
    ['target', `<code>${escapeHtml(data.chip.target)}</code>`],
    ['工具链', data.chip.nightly ? 'nightly（tier-3 target，build-std 编译 core）' : 'stable'],
    [
      'HAL rev',
      `<a href="${escapeHtml(halCommitUrl(halRev))}"><code>${escapeHtml(halRev.slice(0, 7))}</code></a>`,
    ],
    ['运行时', embassy ? 'embassy（异步）' : 'blocking（阻塞）'],
    ['构建档位', escapeHtml(sel.profile ?? 'release-size')],
    ['IDE 配置', sel.ideConfig === 'vscode' ? 'VS Code（.vscode/）' : '不生成'],
    ['vendor HAL', sel.vendorHal ? '内嵌 vendor/ch32-hal（path 依赖）' : '不内嵌'],
    ['Flash / SRAM', `${escapeHtml(data.chip.flash)} / ${escapeHtml(data.chip.sram)}`],
    ['生成器', `${escapeHtml(TOOL_NAME)} ${escapeHtml(TOOL_VERSION)}`],
    ['configHash', `<code>${escapeHtml(hash)}</code>`],
  ]
  if (now !== undefined) rows.push(['生成时间', escapeHtml(now)])
  return kvTable(rows)
}

/** 引脚全表：封装全部引脚按位号排序；模式/信号/remap/标签来自配置（支持别名），未配置显示 —。 */
function buildPinTable(config: ProjectConfig, data: DeviceData): string {
  const byPin = new Map<string, PinAssignment>()
  for (const p of config.pins ?? []) byPin.set(p.pin, p)
  const unlocked = new Set(config.unlockedPins ?? [])
  const rows = [...data.chip.pins]
    .sort((a, b) => a.number - b.number)
    .map((pin) => {
      const assign = byPin.get(pin.name) ?? (pin.aliases ?? []).map((a) => byPin.get(a)).find((x) => x)
      const special = pin.special ? SPECIAL_LABELS[pin.special] ?? pin.special : ''
      const specialText = special
        ? unlocked.has(pin.name) || (pin.aliases ?? []).some((a) => unlocked.has(a))
          ? `${special}（已解锁）`
          : special
        : ''
      return [
        pin.number,
        pin.name,
        pin.type,
        SIDE_LABELS[pin.side] ?? pin.side,
        assign?.mode,
        assign?.function,
        assign?.remap,
        assign?.label,
        specialText,
      ]
    })
  if (rows.length === 0) return EMPTY_NOTE
  return htmlTable(['位号', '引脚名', '类型', '边', '模式', '信号', 'remap', '标签', '特殊脚'], rows)
}

/** 时钟摘要：与 buildReadmeReport 的时钟表同源（同一 computeClock/mergeClockConfig 五元组）。 */
function buildClockTable(config: ProjectConfig, data: DeviceData): string {
  const f = computeClock(data.clock, mergeClockConfig(data.clock, config.clock))
  const rows: [string, string][] = [
    ['SYSCLK', fmtMhz(f.sysclkMhz)],
    ['HCLK', fmtMhz(f.hclkMhz)],
    ['PCLK1（APB1）', fmtMhz(f.pclk1Mhz)],
    ['PCLK2（APB2）', fmtMhz(f.pclk2Mhz)],
    ['ADC', fmtMhz(f.adcMhz)],
  ]
  return htmlTable(['时钟域', '频率'], rows)
}

/** 外设表：仅已启用实例（与 README 同一份 derivePeripheralUsage 推导）。 */
function buildPeripheralTable(config: ProjectConfig, data: DeviceData): string {
  const usages = derivePeripheralUsage(config, data).filter((u) => u.enabled)
  if (usages.length === 0) return '<p class="empty">当前未启用 USART/SPI/I2C/ADC 实例。</p>'
  const rows = usages.map((u) => [
    u.id,
    u.pins.length > 0 ? u.pins.map((p) => p.role.toUpperCase()).join(' / ') : '—',
    u.pins.length > 0 ? u.pins.map((p) => p.pin).join(' / ') : '—',
    u.remap,
    peripheralParams(u),
  ])
  return htmlTable(['实例', '信号', '引脚', 'remap', '关键参数'], rows)
}

/** 中断表：irq/enabled/priority；未配置（缺省或空数组）显示「无」。 */
function buildInterruptTable(config: ProjectConfig): string {
  const interrupts = config.interrupts ?? []
  if (interrupts.length === 0) return EMPTY_NOTE
  return htmlTable(
    ['中断', '状态', '优先级'],
    interrupts.map((i) => [i.irq, i.enabled ? '启用' : '关闭', i.priority]),
  )
}

/** DMA 表：peripheral/channel/request；未配置（缺省或空数组）显示「无」。 */
function buildDmaTable(config: ProjectConfig): string {
  const dma = config.dma ?? []
  if (dma.length === 0) return EMPTY_NOTE
  return htmlTable(
    ['外设', '通道', '请求'],
    dma.map((d) => [d.peripheral, d.channel, d.request]),
  )
}

/** 生成文件清单：path/group/内容 sha256 短哈希（前 12 位），group 徽章着色；保持传入顺序。 */
function buildFileTable(files: GeneratedFile[]): string {
  if (files.length === 0) return EMPTY_NOTE
  const rows = files.map((f) => {
    const group: FileGroup = f.group ?? classifyFileGroup(f.path)
    const hash = sha256Hex(f.content).slice(0, 12)
    return `<tr><td><code>${escapeHtml(f.path)}</code></td><td><span class="badge badge-${group}">${group}</span></td><td><code>${hash}</code></td></tr>`
  })
  return `<table>\n<thead><tr><th>路径</th><th>文件组</th><th>内容 sha256（前 12 位）</th></tr></thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table>`
}

/** 文件组再生成策略简表（与 model/codegen/fileGroup 及 types 的 FileGroup 注释一致）。 */
function buildGroupStrategyTable(): string {
  return htmlTable(
    ['文件组', '典型路径', '再生成策略'],
    [
      ['generated', 'src/generated/**、report.html', '每次重写（用户手改触发冲突复核）'],
      ['project_file', 'Cargo.toml、README.md、cube.json 等', '生成一次（Cargo.toml 走标记区合并）'],
      ['user_code', 'src/main.rs', '永不覆盖'],
      ['pack', 'vendor/ch32-hal/**', '已存在默认保留本地内容'],
    ],
  )
}

/**
 * 渲染 HTML 单文件工程报告。
 * @param now 可选生成时间（调用方传入才展示；缺省省略，保证输出确定性）。
 */
export function renderHtmlReport(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  files: GeneratedFile[],
  embassy: boolean,
  now?: string,
): GeneratedFile {
  const title = `工程报告 · ${config.projectName}`
  const body = [
    '<header>',
    '<h1>工程报告</h1>',
    `<p class="sub">${escapeHtml(config.projectName)} · ${escapeHtml(data.chip.chip)}（${escapeHtml(data.chip.package)}）</p>`,
    '</header>',
    '<main>',
    `<section id="overview">\n<h2>概览</h2>\n${buildOverview(config, data, sel, embassy, now)}\n</section>`,
    `<section id="pins">\n<h2>引脚全表</h2>\n${buildPinTable(config, data)}\n</section>`,
    `<section id="clock">\n<h2>时钟摘要</h2>\n${buildClockTable(config, data)}\n</section>`,
    `<section id="peripherals">\n<h2>外设实例</h2>\n${buildPeripheralTable(config, data)}\n</section>`,
    `<section id="interrupts">\n<h2>中断</h2>\n${buildInterruptTable(config)}\n</section>`,
    `<section id="dma">\n<h2>DMA 通道</h2>\n${buildDmaTable(config)}\n</section>`,
    `<section id="files">\n<h2>生成文件清单</h2>\n${buildFileTable(files)}\n<h3>文件组再生成策略</h3>\n${buildGroupStrategyTable()}\n</section>`,
    '</main>',
    '<footer>',
    `<p>本报告由 ${escapeHtml(TOOL_NAME)} ${escapeHtml(TOOL_VERSION)} 生成（report.html，generated 组，随重新生成更新）。</p>`,
    '<p>配置未变（configHash 一致）则无需重新生成工程；各文件组的覆盖/保护策略见上表。</p>',
    '</footer>',
  ].join('\n')
  // split/join 替换占位符：避免 String.replace 对替换串中 $ 的特殊解释。
  const content = HTML_REPORT_SHELL.split('<!--REPORT_TITLE-->')
    .join(escapeHtml(title))
    .split('<!--REPORT_BODY-->')
    .join(body)
  return { path: 'report.html', content, group: 'generated' }
}