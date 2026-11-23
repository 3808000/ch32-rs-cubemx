// 同一个时钟用例集用于 Vitest 和 verify:build 的 Rust HAL 编译。
import { defaultClock, presetToConfig } from '@/model/clock'
import type { ClockConfig, ClockData } from '@/model/types'

export function clockMatrix(spec: ClockData): ClockConfig[] {
  const initial = defaultClock(spec)
  const presets = spec.presets.map((preset) => presetToConfig(spec, preset, initial))
  const cases = [initial, ...presets]

  for (const source of spec.sources) {
    const base = { ...initial, source: source.id }
    const oscillators = source.pll ? spec.pll?.sourceOptions ?? [] : [source.id]
    const parameters = source.pll
      ? spec.pll?.params ?? []
      : (spec.pll?.params ?? []).filter((param) => param.key === source.sysclkDividerParam)
    const options = parameters.reduce<Record<string, number>[]>((rows, param) =>
      rows.flatMap((row) => param.options.map((value) => ({ ...row, [param.key]: value }))), [{}])
    for (const oscillator of oscillators) {
      const crystal = spec.sources.find((source) => source.id === oscillator)?.hxtal
      const frequencies = crystal ? [...new Set([crystal.min, crystal.default, crystal.max])] : [base.hxtalMhz]
      for (const pll of options) {
        for (const hxtalMhz of frequencies) {
          cases.push({
            ...base,
            hxtalMhz,
            ...(source.pll ? { pllSource: oscillator } : {}),
            ...(parameters.length ? { pll: { ...initial.pll, ...pll } } : {}),
          })
        }
      }
    }
  }

  for (const base of [initial, ...presets]) {
    for (const field of ['ahb', 'apb1', 'apb2'] as const) {
      for (const value of spec[field].options) cases.push({ ...base, [field]: value })
    }
    for (const adc of spec.adc.options) cases.push({ ...base, adc: adc.id })
  }
  return [...new Map(cases.map((config) => [JSON.stringify(config), config])).values()]
}
