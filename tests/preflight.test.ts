// M3.7 生成前 Check 报告单元测试：checkConflicts + validateClock 合并、分级与定位目标。
import { describe, it, expect } from 'vitest'
import type { DeviceData, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { preflight, preflightBlocked } from '@/model/preflight'
import { validateClock } from '@/model/clock'
import { getDeviceData } from '@/model/device'

const data = getDeviceData('CH32V003F4P6')

function makeConfig(pins: PinAssignment[] = [], opts: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'test-project',
    pins,
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: true },
    hal: { rev: 'test' },
    ...opts,
  }
}

function pin(name: string, mode: PinMode): PinAssignment {
  return { pin: name, mode, params: {} }
}

describe('preflight 基础分级', () => {
  it('默认时钟（无 clock 配置）：空引脚工程 0 warning（ADC=HCLK÷2=12MHz ≤14）', () => {
    // D4bis：V003 ADCPRE 自 HCLK 复位 ÷2，默认档不再触发 ADC 超限 warning；
    // ADC warning 分级由下方「时钟 warning 进入 warnings」显式 PLL48 配置覆盖
    const report = preflight(makeConfig(), data)
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
    expect(preflightBlocked(report)).toBe(false)
  })

  it('重复引脚 → error，target 定位 Pinout/PD5', () => {
    const report = preflight(makeConfig([pin('PD5', 'OUTPUT'), pin('PD5', 'INPUT')]), data)
    const dup = report.errors.find((e) => e.code === 'DUPLICATE_PIN')
    expect(dup).toBeDefined()
    expect(dup!.target).toMatchObject({ view: 'pinout', pin: 'PD5' })
    expect(preflightBlocked(report)).toBe(true)
  })

  it('启用外设缺引脚 → warning，target 定位 Peripherals/USART1', () => {
    const report = preflight(
      makeConfig([], { peripherals: { USART1: { enabled: true, params: {} } } }),
      data,
    )
    const missing = report.warnings.find((w) => w.code === 'USART_TX_MISSING')
    expect(missing).toBeDefined()
    expect(missing!.target).toMatchObject({ view: 'peripherals', peripheral: 'USART1' })
  })

  it('时钟非法：逐节点 error 定位，且不与 checkConflicts 重复', () => {
    const clock = { source: 'PLL', pllSource: 'HSI', pll: { mul: 3 }, ahb: 1, apb1: 1, apb2: 1 }
    const config = makeConfig([], { clock })
    const report = preflight(config, data)
    const clockErrors = report.errors.filter((e) => e.code === 'PERIPHERAL_CLOCK_INVALID')
    const expected = validateClock(data.clock, clock).filter((i) => i.level === 'error').length
    expect(clockErrors).toHaveLength(expected)
    expect(clockErrors.every((e) => e.target.view === 'clock' && !!e.target.node)).toBe(true)
    expect(clockErrors.some((e) => e.target.node === 'PLL')).toBe(true)
    expect(clockErrors.some((e) => e.target.node === 'SYSCLK')).toBe(true)
  })

  it('时钟 warning 进入 warnings 并带 node（ADC 超建议上限）', () => {
    const clock = { source: 'PLL', pllSource: 'HSI', pll: { mul: 2 }, ahb: 1, apb1: 1, apb2: 1 }
    const report = preflight(makeConfig([], { clock }), data)
    const warn = report.warnings.find((w) => w.code === 'CLOCK_WARNING')
    expect(warn).toBeDefined()
    expect(warn!.target).toMatchObject({ view: 'clock', node: 'ADC' })
  })

  it('TARGET_FEATURE_UNSUPPORTED 定位 Project settings', () => {
    const h417 = getDeviceData('CH32H417QEU6')
    const config: ProjectConfig = {
      ...makeConfig(),
      chip: 'CH32H417QEU6',
      features: { embassy: true, debugPrint: true },
    }
    const report = preflight(config, h417 as DeviceData)
    const err = report.errors.find((e) => e.code === 'TARGET_FEATURE_UNSUPPORTED')
    expect(err).toBeDefined()
    expect(err!.target.view).toBe('project-settings')
  })

  it('SPECIAL_PIN_OSC warning 带引脚定位（HSE 使用晶振引脚）', () => {
    const clock = { source: 'HSE', hxtalMhz: 24, ahb: 1, apb1: 1, apb2: 1 }
    const report = preflight(makeConfig([pin('PA1', 'INPUT')], { clock }), data)
    const osc = report.warnings.find((w) => w.code === 'SPECIAL_PIN_OSC')
    expect(osc).toBeDefined()
    expect(osc!.target).toMatchObject({ view: 'pinout', pin: 'PA1' })
  })
})