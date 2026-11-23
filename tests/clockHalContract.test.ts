import { describe, expect, it } from 'vitest'
import { clockMatrix } from '../scripts/clock-matrix'
import { applyClockPreset, computeClock, defaultClock, mergeClockConfig, pllCandidateConfig, resolveClockIssues, solvePll, validateClock } from '@/model/clock'
import { computePeripheralClocks } from '@/model/clock/peripheral'
import { applyClockControl, buildClockModel } from '@/model/clock/tree'
import { generateProject } from '@/model/codegen'
import { HAL_REV } from '@/model/codegen/halRev'
import { getDeviceData } from '@/model/device'
import { derivePeripheralUsage, peripheralClockState } from '@/model/peripherals'
import type { ProjectConfig } from '@/model/types'

const targets = [
  ['CH32V003F4P6', 'ch32-hal'],
  ['CH32V103C8T6', 'ch32-hal'],
  ['CH32V203C8T6', 'ch32-hal'],
  ['CH32V307VCT6', 'ch32-hal'],
  ['CH32X035C8T6', 'ch32-hal'],
  ['CH32H417QEU6', 'ch32-hal'],
  ['CH582M', 'ch5xx-hal'],
  ['CH582M', 'ch58x-hal'],
] as const

function project(chip: string, halBackend = 'ch32-hal', clock?: ProjectConfig['clock']): ProjectConfig {
  return { version: 1, projectName: 'clock-contract', chip, halBackend, pins: [], peripherals: {},
    naming: { prefix: '' }, clock, features: { embassy: false, debugPrint: false }, hal: { rev: HAL_REV } }
}

function generatedClock(config: ProjectConfig) {
  const data = getDeviceData(config.chip)
  const result = generateProject(config, data)
  expect(result.errors).toEqual([])
  return result.files.find((file) => file.path.endsWith('src/generated/clock.rs'))?.content
}

describe('时钟 UI 与 HAL 导出路径', () => {
  it.each(targets)('%s / %s 所有配置档的校验与导出一致，显示源和配置源一致', (chip, backend) => {
    const data = getDeviceData(chip)
    for (const cfg of clockMatrix(data.clock)) {
      const frequencies = computeClock(data.clock, cfg)
      const issues = validateClock(data.clock, cfg, backend)
      const graph = buildClockModel(data.clock, cfg, frequencies, issues)
      const config = project(chip, backend, cfg)
      const result = generateProject(config, data)
      const message = `${chip}/${backend}: ${JSON.stringify(cfg)}`
      expect(result.errors.length > 0, message).toBe(issues.some((issue) => issue.level === 'error'))
      expect(graph.nodes.find((node) => node.id === 'SYSCLK')!.outMhz, message).toBe(frequencies.sysclkMhz)
      if (!issues.some((issue) => issue.level === 'error')) {
        expect(result.files.some((file) => file.path.endsWith('src/generated/clock.rs')), message).toBe(true)
        expect(graph.edges.some((edge) => edge.to === 'SYSCLK' && edge.from === cfg.source && edge.active), message).toBe(true)
      } else {
        expect(result.files, message).toEqual([])
      }
    }
  })

  it.each([
    ['CH32V103C8T6', 'hal::pac::rcc::vals::Pllsrc', 2, 8, '8', 32],
    ['CH32V203C8T6', 'hal::rcc::PllSource', 2, 8, '8', 32],
    ['CH32V307VCT6', 'hal::rcc::PllSource', 2, 6.5, '6_5', 26],
  ] as const)('%s PLL 的实际 HAL 类型、预分频和倍频', (chip, sourceType, prediv, mul, variant, mhz) => {
    const { clock } = getDeviceData(chip)
    const cfg = mergeClockConfig(clock, { source: 'PLL', pllSource: 'HSE', pll: { prediv, mul } })
    const rust = generatedClock(project(chip, 'ch32-hal', cfg))
    expect(rust).toContain(`cfg.pll_src = ${sourceType}::HSE;`)
    expect(rust).toContain(`prediv: hal::rcc::PllPreDiv::DIV${prediv}`)
    expect(rust).toContain(`mul: hal::pac::rcc::vals::PllMul::MUL${variant}`)
    expect(computeClock(clock, cfg).sysclkMhz).toBe(mhz)
  })

  it('X035 显式配置只写 HAL 的 AHB 字段', () => {
    const chip = 'CH32X035C8T6'
    const { clock } = getDeviceData(chip)
    const rust = generatedClock(project(chip, 'ch32-hal', mergeClockConfig(clock, { ahb: 6 })))
    expect(rust).toContain('cfg.ahb_pre = hal::pac::rcc::vals::Hpre::DIV6;')
    expect(rust).not.toMatch(/cfg\.(sys|pll|apb)/)
  })

  it('X035 的 ADC 图元只给出已确认的 SYSCLK 输入', () => {
    const { clock } = getDeviceData('CH32X035C8T6')
    const cfg = mergeClockConfig(clock, { ahb: 6, adcClkDiv: 9 })
    const model = buildClockModel(clock, cfg, computeClock(clock, cfg))
    expect(model.nodes.find((node) => node.id === 'ADC')).toMatchObject({ inMhz: 48, outMhz: null })
  })

  it('V203 拒绝 HAL 错算的旧 AHB 档与 HAL 未写的 ADCPRE', () => {
    const chip = 'CH32V203C8T6'
    const data = getDeviceData(chip)
    for (const ahb of [64, 128, 256, 512]) {
      const r = generateProject(project(chip, 'ch32-hal', mergeClockConfig(data.clock, { ahb })), data)
      expect(r.errors.some((issue) => issue.message.includes(`AHB 分频 ${ahb}`))).toBe(true)
    }
    for (const adc of data.clock.adc.options.filter((option) => option.id !== data.clock.adc.default)) {
      const r = generateProject(project(chip, 'ch32-hal', mergeClockConfig(data.clock, { adc: adc.id })), data)
      expect(r.errors.some((issue) => issue.message.includes('HAL 不写 ADCPRE'))).toBe(true)
    }
  })

  it.each([
    ['CH32V307VCT6', [12, 12, 12, 12]],
    ['CH32V103C8T6', [12, 9, 12, 9, 10, 10]],
  ] as const)('%s 的预设采用安全 ADC 时钟，生成器在 ADC 构造前写入 ADCPRE', (chip, expected) => {
    const data = getDeviceData(chip)
    const { clock } = data
    const { pin, channel } = data.peripherals.adc[0].channels[0]
    const initial = mergeClockConfig(clock, { adc: 'APB2_DIV2' })
    expect(validateClock(clock, initial).some((issue) => issue.node === 'ADC')).toBe(true)
    for (const [index, preset] of clock.presets.entries()) {
      const cfg = applyClockPreset(clock, initial, preset)
      const freqs = computeClock(clock, cfg)
      const issues = validateClock(clock, cfg)
      expect(freqs.adcMhz).toBe(expected[index])
      expect(issues.some((issue) => issue.node === 'ADC')).toBe(false)
      expect(buildClockModel(clock, cfg, freqs, issues).nodes.find((node) => node.id === 'ADC'))
        .toMatchObject({ outMhz: expected[index], issueLevel: null })
      const config = project(chip, 'ch32-hal', cfg)
      config.pins = [{ pin, mode: 'ANALOG', function: channel, params: {} }]
      const result = generateProject(config, data)
      expect(result.errors).toEqual([])
      const adcDiv = clock.adc.options.find((option) => option.id === cfg.adc)!.div
      const rcc = result.files.find((file) => file.path === 'src/generated/clock.rs')!.content
      expect(rcc).toContain(`w.set_adcpre(hal::pac::rcc::vals::Adcpre::DIV${adcDiv})`)
      if (chip === 'CH32V307VCT6' && preset.id.startsWith('144')) {
        expect(freqs).toMatchObject({ sysclkMhz: 144, hclkMhz: 144, pclk1Mhz: 144, pclk2Mhz: 72 })
        expect(rcc).toContain('cfg.apb2_pre = hal::pac::rcc::vals::Ppre::DIV2')
      }
      const init = result.files.find((file) => file.path === 'src/generated/mod.rs')!.content
      expect(init).toMatch(/clock::init_adc_prescaler\(\);[\s\S]+adc::init_/)
      const withoutClock = generateProject(config, data, { clock: false })
      expect(withoutClock.files.find((file) => file.path === 'src/generated/mod.rs')?.content)
        .not.toContain('init_adc_prescaler')
    }
    const locked = { ...initial, locked: ['ADC'] }
    expect(applyClockPreset(clock, locked, clock.presets[0]).adc).toBe(initial.adc)
  })

  it('H417 的每个 ADCPRE 档位跟随三种公开配方生成', () => {
    const chip = 'CH32H417QEU6'
    const { clock } = getDeviceData(chip)
    for (const cfg of clockMatrix(clock).filter((cfg) => !validateClock(clock, cfg, 'ch32-hal').some((issue) => issue.level === 'error'))) {
      const div = clock.adc.options.find((option) => option.id === cfg.adc)!.div
      const rust = generatedClock(project(chip, 'ch32-hal', cfg))
      if (div !== 2) expect(rust).toContain(`cfg.bus.adcpre = hal::pac::rcc::vals::Adcpre::DIV${div};`)
      expect(computeClock(clock, cfg).adcMhz).toBe(computeClock(clock, cfg).hclkMhz / div)
    }
  })

  it('H417 PLL 目标频率补齐可导出的总线档位，并尊重 AHB 锁定', () => {
    const chip = 'CH32H417QEU6'
    const { clock } = getDeviceData(chip)
    const initial = defaultClock(clock)
    const candidate = solvePll(clock, 400, 'HSI')[0]!
    const config = pllCandidateConfig(clock, initial, candidate, 'ch32-hal')!
    expect(config).toMatchObject({ source: 'PLL', ahb: 4 })
    expect(generatedClock(project(chip, 'ch32-hal', config))).toContain('with_sysclk_400m_v5f_400m_v3f_100m_hsi')
    expect(pllCandidateConfig(clock, { ...initial, locked: ['AHB'] }, candidate, 'ch32-hal')).toBeNull()
  })

  it('时钟自动修复遵守后端可导出性和独立 ADC raw 旋钮', () => {
    const data = getDeviceData('CH32V203C8T6')
    const cfg = mergeClockConfig(data.clock, { adc: 'APB2_DIV4', adcClkDiv: 7 })
    const repaired = resolveClockIssues(data.clock, cfg, 'ch32-hal')!
    expect(repaired.config.adc).toBe(data.clock.adc.default)
    expect(repaired.config.adcClkDiv).toBe(7)
    const { clock } = getDeviceData('CH582M')
    const hse = mergeClockConfig(clock, { source: 'HSE', pll: { div: 3 }, locked: ['SYSCLK'] })
    const ch5xx = resolveClockIssues(clock, hse, 'ch5xx-hal')!
    expect(ch5xx.config.source).toBe('HSE')
    expect(validateClock(clock, ch5xx.config, 'ch5xx-hal')).toEqual([])
    expect(resolveClockIssues(clock, hse, 'ch58x-hal')).toBeNull()
  })

  it('引脚隐式启用的外设参与时钟读数与 HAL 拒绝条件', () => {
    const chip = 'CH582M'
    const data = getDeviceData(chip)
    const spi = data.peripherals.spi[0]!
    const remap = spi.remaps[0]!
    const cfg = defaultClock(data.clock)
    const config = project(chip, 'ch5xx-hal', cfg)
    config.pins = [{ pin: remap.sck!, mode: 'AF', function: `${spi.id}_SCK`, remap: remap.remap, params: {} }]
    config.peripherals = { [spi.id]: { enabled: false, params: { frequency: 40_000_000 } } }
    const state = peripheralClockState(derivePeripheralUsage(config, data))
    const rates = computePeripheralClocks(data.clock, cfg, computeClock(data.clock, cfg), data.peripherals, state, 'ch5xx-hal')
    const result = rates.find((rate) => rate.periId === spi.id)!
    expect(state[spi.id].enabled).toBe(true)
    expect(result.actualMhz).toBeNull()
    expect(result.issues[0].level).toBe('error')
    expect(generateProject(config, data).errors.find((e) => e.code === 'SPI_FREQUENCY_UNREPRESENTABLE')?.message)
      .toContain(result.issues[0].message)
  })

  it.each(['CH32V203C8T6', 'CH32V307VCT6', 'CH32X035C8T6'])('%s 的所有 raw ADC 值写入实际 HAL Config', (chip) => {
    const data = getDeviceData(chip)
    const adc = data.peripherals.adc[0]!
    const channel = adc.channels[0]!
    const cfg = defaultClock(data.clock)
    const model = buildClockModel(data.clock, cfg, computeClock(data.clock, cfg), undefined, {
      peripherals: data.peripherals, state: {}, periFreqs: [],
    })
    const raw = model.nodes.find((node) => node.id === `P-${adc.id}`)!.control!
    const config = project(chip, 'ch32-hal', cfg)
    config.pins = [{ pin: channel.pin, mode: 'ANALOG', function: channel.channel, params: {} }]
    const reset = data.clock.peripheralClocks!.adc!.clkDiv!.default
    for (const option of raw.options!) {
      const changed = applyClockControl(cfg, raw, option.value)
      const result = generateProject({ ...config, clock: changed }, data)
      expect(result.errors).toEqual([])
      const rust = result.files.find((file) => file.path.endsWith('src/generated/adc.rs'))!.content
      if (option.value === reset) expect(rust).not.toContain('clkdiv:')
      else expect(rust).toContain(`clkdiv: ${option.value}`)
    }
  })
})
