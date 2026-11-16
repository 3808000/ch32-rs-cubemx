// README 报告增强（M4.3）+ IDE 配置（M4.5）：引脚/时钟/外设/中断/预算/元数据与 .vscode 产物。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodegenSelection, ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { configHash, generateProject } from '@/model/codegen'
import { renderDualReadme, sha256Hex } from '@/model/codegen/readme'
import { renderIdeConfigFiles } from '@/model/codegen/ideConfig'
import { HAL_REV } from '@/model/codegen/halRev'

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

const data = getDeviceData('CH32V003F4P6')

function reportConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'report-demo',
    pins: [
      { pin: 'PA1', mode: 'ANALOG', function: 'ADC_IN1', params: {} },
      { pin: 'PC1', mode: 'INPUT', label: 'BTN', params: { pull: 'UP', exti: { enabled: true, edge: 'FALLING' } } },
      { pin: 'PD6', mode: 'AF', function: 'USART1_RX', remap: 0, params: {} },
      { pin: 'PD4', mode: 'OUTPUT', label: 'LED_RUN', params: { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' } },
      { pin: 'PD5', mode: 'AF', function: 'USART1_TX', remap: 0, params: {} },
    ],
    naming: { prefix: '' },
    clock: { source: 'PLL', pllSource: 'HSI', pll: { mul: 2 }, ahb: 1, apb1: 1, apb2: 1 },
    peripherals: { USART1: { enabled: true, params: { baudrate: 115200 } } },
    features: { embassy: false, debugPrint: false },
    hal: { rev: HAL_REV },
    interrupts: [
      { irq: 'EXTI7_0', enabled: true, priority: 1 },
      { irq: 'USART1', enabled: false, priority: 2 },
    ],
    generator: { name: 'ch32-rs-CubeMX', version: '0.1.0' },
    ...over,
  }
}

function generate(selection: Partial<CodegenSelection> = {}): Record<string, string> {
  const r = generateProject(reportConfig(), data, selection)
  expect(r.errors).toEqual([])
  return Object.fromEntries(r.files.map((f) => [f.path, f.content]))
}

describe('README 工程报告', () => {
  it('引脚占用表按封装物理位号排序，并包含模式/信号/标签/remap', () => {
    const readme = generate()['README.md']
    expect(readme).toContain('### 引脚占用')
    expect(readme).toContain('| 位号 | 引脚 | 模式/信号 | 标签 | remap |')
    // PD4=1, PD5=2, PD6=3, PA1=5, PC1=20
    const order = ['| 1 | PD4', '| 2 | PD5', '| 3 | PD6', '| 5 | PA1', '| 20 | PC1'].map((s) => readme.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(readme).toContain('OUTPUT（PUSH_PULL, HIGH, 初始 LOW）')
    expect(readme).toContain('USART1_TX')
    expect(readme).toContain('LED_RUN')
    expect(readme).toContain('| 2 | PD5 | AF / USART1_TX | — | 0 |')
    expect(readme).toContain('EXTI FALLING')
  })

  it('时钟五元组与 computeClock 一致（48MHz HSI 预设）', () => {
    const readme = generate()['README.md']
    expect(readme).toContain('### 时钟')
    expect(readme).toContain('| SYSCLK | 48 MHz |')
    expect(readme).toContain('| HCLK | 48 MHz |')
    expect(readme).toContain('| PCLK1 | 48 MHz |')
    expect(readme).toContain('| PCLK2 | 48 MHz |')
    expect(readme).toContain('| ADC | 48 MHz |')
  })

  it('外设实例表与中断表来自同一份配置推导', () => {
    const readme = generate()['README.md']
    expect(readme).toContain('### 外设实例')
    expect(readme).toContain('| USART1 | TX / RX | PD5 / PD6 | 0 |')
    expect(readme).toContain('baudrate=115200')
    expect(readme).toContain('wordLength=DataBits8')
    expect(readme).toContain('### 中断')
    expect(readme).toContain('| EXTI7_0 | 启用 | 1 |')
    expect(readme).toContain('| USART1 | 关闭 | 2 |')
  })

  it('Flash/RAM 预算来自 chip.json', () => {
    const readme = generate()['README.md']
    expect(readme).toContain('### Flash / RAM 预算')
    expect(readme).toContain('| Flash | 16K |')
    expect(readme).toContain('| SRAM | 2K |')
  })

  it('生成元数据包含工具名/版本、固定时间、configHash、HAL rev', async () => {
    const readme = generate()['README.md']
    const cfg = reportConfig()
    expect(readme).toContain('### 生成信息')
    expect(readme).toContain('| 生成工具 | ch32-rs-CubeMX 0.1.0 |')
    expect(readme).toContain('| 生成时间 | 2026-01-01T00:00:00.000Z |')
    // README 的同步 SHA-256 与 manifest 的异步 configHash 必须一致
    expect(readme).toContain(`| cube.json configHash | \`${await configHash(cfg)}\` |`)
    expect(readme).toContain(`| HAL rev | \`${HAL_REV}\` |`)
  })

  it('同步 sha256Hex 与标准向量、异步 configHash（含中文）一致', async () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const cfg = reportConfig({ projectName: '闪灯 工程' })
    expect(sha256Hex(JSON.stringify(cfg))).toBe(await configHash(cfg))
  })

  it('无 pins/interrupts 时不崩溃，仍输出空表说明', () => {
    const r = generateProject(
      reportConfig({ pins: [], interrupts: undefined, peripherals: {}, clock: undefined }),
      data,
    )
    expect(r.errors).toEqual([])
    const readme = r.files.find((f) => f.path === 'README.md')!.content
    expect(readme).toContain('当前未配置 GPIO/外设引脚。')
    expect(readme).not.toContain('### 中断')
  })
})

describe('IDE 配置产物（ideConfig）', () => {
  it('默认 none：不生成 .vscode 文件', () => {
    const files = generate()
    expect(files['.vscode/settings.json']).toBeUndefined()
    expect(files['.vscode/tasks.json']).toBeUndefined()
  })

  it('vscode：生成 settings.json（target/check/extraEnv）', () => {
    const files = generate({ ideConfig: 'vscode' })
    const settings = JSON.parse(files['.vscode/settings.json']) as Record<string, unknown>
    expect(settings['rust-analyzer.cargo.target']).toBe('riscv32ec-unknown-none-elf.json')
    expect(settings['rust-analyzer.check.allTargets']).toBe(false)
    expect(settings['rust-analyzer.cargo.extraEnv']).toEqual({ RUSTFLAGS: '-C target-feature=+xwchc' })
  })

  it('vscode：生成 tasks.json（build/flash/三档位），不生成 launch.json', () => {
    const files = generate({ ideConfig: 'vscode' })
    const tasks = (JSON.parse(files['.vscode/tasks.json']) as { version: string; tasks: { label: string }[] })
    expect(tasks.version).toBe('2.0.0')
    const labels = tasks.tasks.map((t) => t.label)
    expect(labels).toContain('构建 (release)')
    expect(labels).toContain('构建 (release-size)')
    expect(labels).toContain('构建 (release-speed)')
    expect(labels).toContain('构建 (release-debug)')
    expect(labels).toContain('烧录 (cargo run)')
    expect(labels).toContain('烧录 (wlink 直调)')
    expect(files['.vscode/launch.json']).toBeUndefined()
  })

  it('双核：tasks.json 使用 xtask 任务（build/flash/merge）', () => {
    const h417 = getDeviceData('CH32H417QEU6')
    const cfg: ProjectConfig = {
      version: 1,
      chip: 'CH32H417QEU6',
      projectName: 'h417-ide',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: false, debugPrint: false },
      hal: { rev: HAL_REV },
    }
    const files = renderIdeConfigFiles(cfg, h417, { ...DEFAULT_SELECTION, ideConfig: 'vscode' })
    const settings = JSON.parse(files.find((f) => f.path === '.vscode/settings.json')!.content) as Record<
      string,
      unknown
    >
    expect(settings['rust-analyzer.cargo.target']).toBe('v3f/riscv32imafc-unknown-none-elf.json')
    // 双核 workspace 固定 nightly：custom target 需要 RUSTFLAGS（与 HAL 模板一致）
    expect(settings['rust-analyzer.cargo.extraEnv']).toEqual({ RUSTFLAGS: '-C target-feature=+xwchc' })
    const tasks = (JSON.parse(files.find((f) => f.path === '.vscode/tasks.json')!.content) as {
      tasks: { label: string; args: string[] }[]
    }).tasks
    expect(tasks.map((t) => t.label)).toEqual(['xtask: 构建', 'xtask: 烧录', 'xtask: 合并镜像'])
    expect(tasks[0].args).toEqual(['xtask', 'build'])
    expect(files.some((f) => f.path === '.vscode/launch.json')).toBe(false)
  })

  it('vscode：README 标注「调试配置待核实」并列出 .vscode 文件', () => {
    const files = generate({ ideConfig: 'vscode' })
    expect(files['README.md']).toContain('调试配置待核实')
    expect(files['README.md']).toContain('.vscode/settings.json')
    expect(files['README.md']).toContain('.vscode/tasks.json')
  })
})

describe('双核 README 报告（renderDualReadme）', () => {
  it('输出引脚/时钟五元组/外设/预算/元数据，并保留双核分工表', () => {
    const h417 = getDeviceData('CH32H417QEU6')
    const cfg: ProjectConfig = {
      version: 1,
      chip: 'CH32H417QEU6',
      projectName: 'h417-report',
      pins: [
        { pin: 'PA9', mode: 'AF', function: 'USART1_TX', remap: 7, params: {} },
        { pin: 'PA10', mode: 'AF', function: 'USART1_RX', remap: 7, params: {} },
      ],
      naming: { prefix: '' },
      clock: { source: 'PLL', pllSource: 'HSI', pll: { mul: 16 }, ahb: 4, apb1: 1, apb2: 1 },
      peripherals: { USART1: { enabled: true, params: {} } },
      features: { embassy: false, debugPrint: false },
      hal: { rev: HAL_REV },
    }
    const readme = renderDualReadme(
      cfg,
      h417,
      { ...DEFAULT_SELECTION },
      [{ path: 'Cargo.toml', content: '' }],
      (path) => (path === 'Cargo.toml' ? 'workspace 清单' : ''),
    ).content

    expect(readme).toContain('## 工程报告')
    expect(readme).toContain('| SYSCLK | 400 MHz |')
    expect(readme).toContain('| HCLK | 100 MHz |')
    expect(readme).toContain('| ADC | 50 MHz |')
    expect(readme).toContain('| USART1 | TX / RX | PA9 / PA10 | 7 |')
    expect(readme).toContain('baudrate=115200')
    expect(readme).toContain('| Flash | 960K |')
    expect(readme).toContain('| SRAM | 896K |')
    expect(readme).toContain('| 生成工具 | ch32-rs-CubeMX 0.1.0 |')
    expect(readme).toContain('## 双核分工')
    expect(readme).toContain('| V3F 控制核 | `v3f/`')
  })
})