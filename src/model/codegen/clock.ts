// clock.rs 渲染：时钟树配置 → RCC 赋值配方（RCC 配方的显式字段兜底路径）。
import type { DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { computeClock, matchPreset, mergeClockConfig } from '@/model/clock'
import { adcClockOption } from '@/model/clock/frequency'
import { render } from './render'
import { fmtHz, fmtMhz } from './util'
import * as T from './templates'

export function renderClock(config: ProjectConfig, data: DeviceData, base = ''): GeneratedFile {
  const spec = data.clock
  const cfg = mergeClockConfig(spec, config.clock)
  const preset = matchPreset(spec, cfg)
  const f = computeClock(spec, cfg)
  const adcDiv = adcClockOption(spec, cfg).div
  const usesHse = cfg.source === 'HSE' || (cfg.source === 'PLL' && cfg.pllSource === 'HSE')

  // 该芯片是否有独立 APB1 分频（V003 无：apb1 options=[1]，HAL Config 无 apb1_pre 字段）
  const hasApb1 = spec.apb1.options.length > 1 || spec.apb1.options[0] !== 1

  const assignments: string[] = []
  const rccLayout = spec.codegen.rccLayout
  if (usesHse) {
    assignments.push(
      [
        'cfg.hse = Some(hal::rcc::Hse {',
        `    freq: hal::time::Hertz(${fmtHz((cfg.hxtalMhz ?? 24) * 1_000_000)}),`,
        '    mode: hal::rcc::HseMode::Oscillator,',
        '});',
      ].join('\n    '),
    )
  }
  if (rccLayout !== 'ahb_only') assignments.push(`cfg.sys = hal::pac::rcc::vals::Sw::${cfg.source};`)
  if (cfg.source === 'PLL') {
    const sourceType = rccLayout === 'v3' ? 'hal::rcc::PllSource' : 'hal::pac::rcc::vals::Pllsrc'
    assignments.push(`cfg.pll_src = ${sourceType}::${cfg.pllSource ?? 'HSI'};`)
    if (rccLayout === 'v1' || rccLayout === 'v3') {
      const prediv = cfg.pll?.prediv ?? 1
      const multiplier = String(cfg.pll?.mul).replace('.', '_')
      assignments.push(
        `cfg.pll = Some(hal::rcc::Pll { prediv: hal::rcc::PllPreDiv::DIV${prediv}, mul: hal::pac::rcc::vals::PllMul::MUL${multiplier} });`,
      )
    }
  }
  assignments.push(`cfg.ahb_pre = hal::pac::rcc::vals::Hpre::DIV${cfg.ahb};`)
  if (hasApb1) assignments.push(`cfg.apb1_pre = hal::pac::rcc::vals::Ppre::DIV${cfg.apb1};`)
  if (rccLayout !== 'ahb_only') assignments.push(`cfg.apb2_pre = hal::pac::rcc::vals::Ppre::DIV${cfg.apb2};`)

  let presetConst = preset ? (spec.codegen.presetConstMap[preset.id] ?? null) : null
  if (presetConst && spec.codegen.recipeAdcPrescaler && cfg.adc !== spec.adc.default) {
    presetConst = `{ let mut cfg = ${presetConst}; cfg.bus.adcpre = hal::pac::rcc::vals::Adcpre::DIV${adcDiv}; cfg }`
  }
  const content = render(T.CLOCK_TPL, {
    sysclk: fmtMhz(f.sysclkMhz),
    hclk: fmtMhz(f.hclkMhz),
    pclk1: fmtMhz(f.pclk1Mhz),
    pclk2: fmtMhz(f.pclk2Mhz),
    presetConst,
    presetLabel: preset?.label ?? '',
    assignments,
    pacAdcDiv: spec.codegen.pacAdcPrescaler ? adcDiv : undefined,
  })
  return { path: `${base}src/generated/clock.rs`, content }
}
