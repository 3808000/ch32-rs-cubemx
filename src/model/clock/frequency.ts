// 时钟源、PLL 与总线的频率计算。
import type { ClockConfig, ClockData, ClockFrequencies } from '@/model/types'

/** 取时钟源频率（MHz）。PLL 源返回 null（需先算 pllIn）。 */
export function sourceFreqMhz(spec: ClockData, sourceId: string, cfg: Pick<ClockConfig, 'hxtalMhz'>): number | null {
  const src = spec.sources.find((s) => s.id === sourceId)
  if (!src) return null
  if (src.pll) return null
  if (src.hxtal) return cfg.hxtalMhz ?? src.hxtal.default
  return src.freqMhz ?? null
}

export function adcClockOption(spec: ClockData, cfg: ClockConfig): ClockData['adc']['options'][number] {
  return spec.adc.options.find((option) => option.id === (cfg.adc ?? spec.adc.default)) ?? spec.adc.options[0]!
}

export function adcInputMhz(
  spec: ClockData,
  source: ClockData['adc']['options'][number]['source'],
  buses: Pick<ClockFrequencies, 'sysclkMhz' | 'hclkMhz' | 'pclk1Mhz' | 'pclk2Mhz'>,
): number {
  switch (source) {
    case 'SYSCLK': return buses.sysclkMhz
    case 'AHB': return buses.hclkMhz
    case 'APB1': return buses.pclk1Mhz
    case 'CK32M': return spec.peripheralClocks?.adc?.fixedInMhz ?? 32
    default: return buses.pclk2Mhz
  }
}

export function sysclkSourceDivider(spec: ClockData, sourceId: string, cfg: ClockConfig): number | undefined {
  const key = spec.sources.find((source) => source.id === sourceId)?.sysclkDividerParam
  const param = spec.pll?.params.find((item) => item.key === key)
  return param ? cfg.pll?.[param.key] ?? param.default : undefined
}

/**
 * PLL 输出频率：固定 VCO 模型（fixedOutMhz ÷ div，如 CH582）或输入×倍频参数乘积。
 * 非固定模型下参数键 `prediv` 做除法（in / prediv × mul，V1/V3），其余键做乘法（V003 固定 mul=2）。
 * 无 PLL 数据时原样返回输入（仅防御，调用方不应在无 PLL 芯片上走 PLL 链）。
 */
export function pllOutMhz(spec: ClockData, pllIn: number, pllParams: Record<string, number>): number {
  const pll = spec.pll
  if (!pll) return pllIn
  if (pll.fixedOutMhz !== undefined) {
    const divSpec = pll.params.find((p) => p.key === 'div')
    const div = pllParams.div ?? divSpec?.default ?? 1
    return pll.fixedOutMhz / div
  }
  let out = pllIn
  for (const p of pll.params) {
    const v = pllParams[p.key] ?? p.default
    if (p.key === 'prediv') out /= v
    else out *= v
  }
  return out
}

/** 频率链：源 → PLL → SYSCLK → AHB → APB1/APB2 → ADC/TIM。 */
export function computeClock(spec: ClockData, cfg: ClockConfig): ClockFrequencies {
  let pllIn: number | null = null
  let pllOut: number | null = null
  let sysclk: number

  if (cfg.source === 'PLL' && spec.pll) {
    const srcId = cfg.pllSource ?? spec.pll.sourceOptions[0]
    pllIn = sourceFreqMhz(spec, srcId, cfg)
    pllOut = pllIn === null ? null : pllOutMhz(spec, pllIn, cfg.pll ?? {})
    sysclk = pllOut ?? 0
  } else if (cfg.source === 'PLL') {
    // 无 PLL 数据的芯片选了 PLL：无有效时钟（validateClock 会报 SYSCLK 为 0）
    sysclk = 0
  } else {
    const sourceMhz = sourceFreqMhz(spec, cfg.source, cfg) ?? 0
    sysclk = sourceMhz / (sysclkSourceDivider(spec, cfg.source, cfg) ?? 1)
  }

  const hclk = sysclk / cfg.ahb
  const pclk1 = hclk / cfg.apb1
  const pclk2 = hclk / cfg.apb2

  const buses = { sysclkMhz: sysclk, hclkMhz: hclk, pclk1Mhz: pclk1, pclk2Mhz: pclk2 }
  const adcOption = adcClockOption(spec, cfg)
  const adc = adcInputMhz(spec, adcOption.source, buses) / adcOption.div

  const timMode = spec.timerClock ?? 'apb_x2'
  const sharedTimerClock = timMode === 'sysclk' ? sysclk : timMode === 'hclk' ? hclk : undefined
  const pclk1Tim = sharedTimerClock ?? (cfg.apb1 === 1 ? pclk1 : pclk1 * 2)
  const pclk2Tim = sharedTimerClock ?? (cfg.apb2 === 1 ? pclk2 : pclk2 * 2)

  return {
    pllInMhz: pllIn,
    pllOutMhz: pllOut,
    ...buses,
    adcMhz: adc,
    pclk1TimMhz: pclk1Tim,
    pclk2TimMhz: pclk2Tim,
  }
}
