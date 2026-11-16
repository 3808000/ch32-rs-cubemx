// HTML 单文件工程报告（M6）：转义防注入/各 section/引脚全表排序/时钟五元组/
// 外设/中断/DMA 空态/文件清单与 group 徽章/确定性/embassy 文案/真实数据冒烟。
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import type { CodegenSelection, DeviceData, GeneratedFile, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { computeClock, mergeClockConfig } from '@/model/clock'
import { generateProject } from '@/model/codegen'
import { sha256Hex } from '@/model/codegen/readme'
import { HAL_REV } from '@/model/codegen/halRev'
import { escapeHtml, renderHtmlReport } from '@/model/codegen/htmlReport'
import pkg from '../package.json'

const data: DeviceData = getDeviceData('CH32V003F4P6')
const sel: CodegenSelection = { ...DEFAULT_SELECTION, htmlReport: true }

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'html-report-demo',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: HAL_REV },
    ...over,
  }
}

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

/** 丰富配置：GPIO/AF/EXTI/ADC + USART1 + 时钟 48MHz + 中断 + DMA（冒烟与多数断言共用）。 */
function richConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return baseConfig({
    projectName: 'rich-demo',
    pins: [
      pin('PC1', 'INPUT', { label: 'BTN', params: { pull: 'DOWN', exti: { enabled: true, edge: 'FALLING' } } }),
      pin('PD5', 'AF', { function: 'USART1_TX', remap: 0, label: 'TX' }),
      pin('PA1', 'ANALOG', { function: 'ADC_IN1' }),
      pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
      pin('PD4', 'OUTPUT', { label: 'LED_RUN', params: { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' } }),
    ],
    clock: { source: 'PLL', pllSource: 'HSI', pll: { mul: 2 }, ahb: 1, apb1: 1, apb2: 1 },
    peripherals: { USART1: { enabled: true, params: { baudrate: 115200 } } },
    interrupts: [
      { irq: 'EXTI7_0', enabled: true, priority: 1 },
      { irq: 'USART1', enabled: false, priority: 2 },
    ],
    dma: [{ peripheral: 'USART1_TX', channel: 4 }],
    ...over,
  })
}

const files: GeneratedFile[] = [
  { path: 'Cargo.toml', content: '[package]\nname = "demo"\n', group: 'project_file' },
  { path: 'src/generated/pins.rs', content: '// pins\n', group: 'generated' },
  { path: 'src/main.rs', content: 'fn main() {}\n', group: 'user_code' },
  { path: 'vendor/ch32-hal/Cargo.toml', content: '[package]\n', group: 'pack' },
  { path: 'README.md', content: '# demo\n' }, // 缺省 group → 按路径推断 project_file
]

function render(config: ProjectConfig = baseConfig(), embassy = false, list: GeneratedFile[] = files, now?: string) {
  return renderHtmlReport(config, data, sel, list, embassy, now).content
}

/** 截取 <section id="..."> 片段，便于按区块断言。 */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}">`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</section>', start)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
}

describe('escapeHtml', () => {
  it('转义全部 5 个特殊字符（& 最先，避免二次转义）', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    expect(escapeHtml('a&b')).toBe('a&amp;b')
    expect(escapeHtml('正常中文 LED_RUN')).toBe('正常中文 LED_RUN')
  })
})

describe('renderHtmlReport 基础契约', () => {
  it('产物 path=report.html，group=generated（显式覆盖路径推断）', () => {
    const f = renderHtmlReport(baseConfig(), data, sel, files, false)
    expect(f.path).toBe('report.html')
    expect(f.group).toBe('generated')
  })

  it('单文件骨架：doctype/中文 lang/内联 CSS，无 JS、无外部资源依赖', () => {
    const html = render()
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<style>')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/<link[^>]+href=/)
    expect(html).not.toMatch(/<img/)
    expect(html).not.toContain('@import')
    expect(html).toContain('</html>')
  })

  it('各 section 与页脚齐全', () => {
    const html = render(richConfig())
    for (const [id, title] of [
      ['overview', '概览'],
      ['pins', '引脚全表'],
      ['clock', '时钟摘要'],
      ['peripherals', '外设实例'],
      ['interrupts', '中断'],
      ['dma', 'DMA 通道'],
      ['files', '生成文件清单'],
    ] as const) {
      expect(section(html, id)).toContain(`<h2>${title}</h2>`)
    }
    expect(html).toContain('<footer>')
    expect(html).toContain('配置未变（configHash 一致）则无需重新生成工程')
    expect(html).toContain(`本报告由 ch32-rs-CubeMX ${pkg.version} 生成`)
  })

  it('概览含工程名/芯片/封装/target/HAL 短哈希链接/生成器/configHash', () => {
    const config = richConfig()
    const html = render(config)
    const overview = section(html, 'overview')
    expect(overview).toContain('rich-demo')
    expect(overview).toContain('CH32V003F4P6')
    expect(overview).toContain('TSSOP20')
    expect(overview).toContain('riscv32ec-unknown-none-elf')
    expect(overview).toContain('nightly')
    expect(overview).toContain(`<code>${HAL_REV.slice(0, 7)}</code>`)
    expect(overview).toContain(`https://github.com/ch32-rs/ch32-hal/commit/${HAL_REV}`)
    expect(overview).toContain(`ch32-rs-CubeMX ${pkg.version}`)
    // configHash 与 manifest 同一口径：JSON.stringify(config) 的同步 sha256
    expect(overview).toContain(sha256Hex(JSON.stringify(config)))
    expect(overview).toContain('16K / 2K')
  })

  it('运行时文案：embassy=true → embassy（异步）；false → blocking（阻塞）', () => {
    const embassyHtml = section(render(richConfig(), true), 'overview')
    expect(embassyHtml).toContain('embassy（异步）')
    expect(embassyHtml).not.toContain('blocking（阻塞）')
    const blockingHtml = section(render(richConfig(), false), 'overview')
    expect(blockingHtml).toContain('blocking（阻塞）')
    expect(blockingHtml).not.toContain('embassy（异步）')
  })

  it('确定性：同一输入两次渲染逐字节相等；缺省无时间戳，now 由调用方传入才展示', () => {
    const config = richConfig()
    const a = renderHtmlReport(config, data, sel, files, false)
    const b = renderHtmlReport(config, data, sel, files, false)
    expect(a.content).toBe(b.content)
    expect(a.content).not.toContain('生成时间')
    const withNow = renderHtmlReport(config, data, sel, files, false, '2026-01-01T00:00:00.000Z').content
    expect(withNow).toContain('生成时间')
    expect(withNow).toContain('2026-01-01T00:00:00.000Z')
  })
})

describe('引脚全表', () => {
  it('覆盖封装全部引脚并按位号升序（含 POWER 脚）', () => {
    const html = render(richConfig())
    const pins = section(html, 'pins')
    const numbers = [...pins.matchAll(/<tr><td>(\d+)<\/td>/g)].map((m) => Number(m[1]))
    expect(numbers).toEqual(Array.from({ length: data.chip.pins.length }, (_, i) => i + 1))
    expect(pins).toContain('<td>VDD</td><td>POWER</td>')
    expect(pins).toContain('<td>VSS</td><td>POWER</td>')
  })

  it('已配置引脚显示模式/信号/remap/标签；未配置引脚显示 —', () => {
    const pins = section(render(richConfig()), 'pins')
    // PD5=位号 2：AF / USART1_TX / remap 0 / 标签 TX
    expect(pins).toContain(
      '<tr><td>2</td><td>PD5</td><td>IO</td><td>左</td><td>AF</td><td>USART1_TX</td><td>0</td><td>TX</td><td>—</td></tr>',
    )
    // PC0=位号 10：未配置
    expect(pins).toContain(
      '<tr><td>10</td><td>PC0</td><td>IO</td><td>左</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>',
    )
    expect(pins).toContain('<td>LED_RUN</td>')
  })

  it('特殊脚标记（NRST/OSC/SWD），unlockedPins 标注已解锁', () => {
    const pins = section(render(richConfig()), 'pins')
    expect(pins).toContain('<td>NRST</td>')
    expect(pins).toContain('<td>OSC</td>')
    expect(pins).toContain('<td>SWD</td>')
    const unlocked = section(render(richConfig({ unlockedPins: ['PD7'] })), 'pins')
    expect(unlocked).toContain('<td>NRST（已解锁）</td>')
  })

  it('别名配置（NRST → PD7）也能落到对应物理引脚行', () => {
    const config = baseConfig({ pins: [pin('NRST', 'INPUT', { label: 'RESET_KEY' })] })
    const pins = section(render(config), 'pins')
    expect(pins).toContain(
      '<tr><td>4</td><td>PD7</td><td>IO</td><td>左</td><td>INPUT</td><td>—</td><td>—</td><td>RESET_KEY</td><td>NRST</td></tr>',
    )
  })
})

describe('时钟/外设/中断/DMA', () => {
  it('时钟五元组与 computeClock 一致（HSI PLL×2 → 48MHz），标注 APB1/APB2', () => {
    const config = richConfig()
    const f = computeClock(data.clock, mergeClockConfig(data.clock, config.clock))
    expect(f.sysclkMhz).toBe(48)
    const clock = section(render(config), 'clock')
    for (const domain of ['SYSCLK', 'HCLK', 'PCLK1（APB1）', 'PCLK2（APB2）', 'ADC']) {
      expect(clock).toContain(`<td>${domain}</td>`)
    }
    expect(clock).toContain('<tr><td>SYSCLK</td><td>48 MHz</td></tr>')
    expect(clock).toContain('<tr><td>HCLK</td><td>48 MHz</td></tr>')
    expect(clock).toContain('<tr><td>PCLK1（APB1）</td><td>48 MHz</td></tr>')
    expect(clock).toContain('<tr><td>PCLK2（APB2）</td><td>48 MHz</td></tr>')
    expect(clock).toContain(`<tr><td>ADC</td><td>${f.adcMhz} MHz</td></tr>`)
  })

  it('外设表仅列已启用实例与关键参数', () => {
    const config = richConfig({
      peripherals: {
        USART1: { enabled: true, params: { baudrate: 115200 } },
        SPI1: { enabled: false, params: {} },
      },
    })
    const peripherals = section(render(config), 'peripherals')
    expect(peripherals).toContain('<td>USART1</td>')
    expect(peripherals).toContain('TX / RX')
    expect(peripherals).toContain('PD5 / PD6')
    expect(peripherals).toContain('baudrate=115200')
    expect(peripherals).not.toContain('<td>SPI1</td>')
    // 空配置：无已启用实例
    expect(section(render(baseConfig()), 'peripherals')).toContain('当前未启用 USART/SPI/I2C/ADC 实例')
  })

  it('中断表：irq/启用状态/优先级；空数组与缺省均显示「无」', () => {
    const interrupts = section(render(richConfig()), 'interrupts')
    expect(interrupts).toContain('<tr><td>EXTI7_0</td><td>启用</td><td>1</td></tr>')
    expect(interrupts).toContain('<tr><td>USART1</td><td>关闭</td><td>2</td></tr>')
    expect(section(render(richConfig({ interrupts: [] })), 'interrupts')).toContain('<p class="empty">无</p>')
    const noIrq = richConfig()
    delete noIrq.interrupts
    expect(section(render(noIrq), 'interrupts')).toContain('<p class="empty">无</p>')
  })

  it('DMA 表：peripheral/channel/request（缺省 request 显示 —）；空时显示「无」', () => {
    const config = richConfig({
      dma: [
        { peripheral: 'USART1_TX', channel: 4, request: 7 },
        { peripheral: 'ADC1', channel: 1 },
      ],
    })
    const dma = section(render(config), 'dma')
    expect(dma).toContain('<tr><td>USART1_TX</td><td>4</td><td>7</td></tr>')
    expect(dma).toContain('<tr><td>ADC1</td><td>1</td><td>—</td></tr>')
    expect(section(render(richConfig({ dma: [] })), 'dma')).toContain('<p class="empty">无</p>')
    const noDma = richConfig()
    delete noDma.dma
    expect(section(render(noDma), 'dma')).toContain('<p class="empty">无</p>')
  })
})

describe('生成文件清单', () => {
  it('与传入 files 一致：path/group 徽章/内容 sha256 前 12 位；缺省 group 按路径推断', () => {
    const html = render(baseConfig(), false, files)
    const list = section(html, 'files')
    const expected: [string, string][] = [
      ['Cargo.toml', 'project_file'],
      ['src/generated/pins.rs', 'generated'],
      ['src/main.rs', 'user_code'],
      ['vendor/ch32-hal/Cargo.toml', 'pack'],
      ['README.md', 'project_file'],
    ]
    for (const [i, f] of files.entries()) {
      const [path, group] = expected[i]
      const hash = sha256Hex(f.content).slice(0, 12)
      expect(hash).toHaveLength(12)
      expect(list).toContain(
        `<tr><td><code>${path}</code></td><td><span class="badge badge-${group}">${group}</span></td><td><code>${hash}</code></td></tr>`,
      )
    }
    // 空清单兜底
    expect(section(render(baseConfig(), false, []), 'files')).toContain('<p class="empty">无</p>')
  })

  it('附文件组再生成策略简表（四组语义与 fileGroup 注释一致）', () => {
    const list = section(render(), 'files')
    expect(list).toContain('文件组再生成策略')
    expect(list).toContain('<td>generated</td><td>src/generated/**、report.html</td><td>每次重写（用户手改触发冲突复核）</td>')
    expect(list).toContain('<td>project_file</td>')
    expect(list).toContain('生成一次（Cargo.toml 走标记区合并）')
    expect(list).toContain('<td>user_code</td><td>src/main.rs</td><td>永不覆盖</td>')
    expect(list).toContain('<td>pack</td><td>vendor/ch32-hal/**</td><td>已存在默认保留本地内容</td>')
  })
})

describe('转义防注入', () => {
  it('工程名/标签/now 中的 <script>、<img>、引号全部转义，页面无原始标签', () => {
    const config = baseConfig({
      projectName: `<script>alert("x")</script>`,
      pins: [pin('PD4', 'OUTPUT', { label: `<img src=x onerror=alert('y')>` })],
    })
    const html = render(config, false, files, `2026-01-01<script>bad()</script>`)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(&#39;y&#39;)&gt;')
    expect(html).toContain('2026-01-01&lt;script&gt;bad()&lt;/script&gt;')
    // <title> 内同样转义
    expect(html).toContain('<title>工程报告 · &lt;script&gt;')
  })
})

describe('真实数据冒烟', () => {
  it('generateProject(CH32V003F4P6) 产物 → report.html 写入 /tmp/m6-report-smoke.html', () => {
    const config = richConfig({ projectName: 'smoke-demo', naming: { prefix: 'app' } })
    const r = generateProject(config, data, sel)
    expect(r.errors).toEqual([])
    expect(r.files.length).toBeGreaterThan(0)
    const report = renderHtmlReport(config, data, sel, r.files, false)
    expect(report.path).toBe('report.html')
    expect(report.group).toBe('generated')
    // 清单覆盖本次生成的全部文件
    for (const f of r.files) expect(report.content).toContain(`<code>${f.path}</code>`)
    writeFileSync('/tmp/m6-report-smoke.html', report.content, 'utf8')
    expect(readFileSync('/tmp/m6-report-smoke.html', 'utf8')).toBe(report.content)
  })
})