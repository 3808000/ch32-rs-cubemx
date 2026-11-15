// 时钟核心：频率链计算 / 校验 / PLL 求解 / 预设匹配。
// 完全数据驱动：所有芯片差异来自 ClockData，禁止按芯片名分支。
import type { ClockConfig, ClockData, ClockFrequencies, ClockIssue, ClockPreset } from '../../types'

/** 取时钟源频率（MHz）。PLL 源返回 null（需先算 pllIn）。 */
export function sourceFreqMhz(spec: ClockData, sourceId: string, cfg: ClockConfig): number | null {
  const src = spec.sources.find((s) => s.id === sourceId)
  if (!src) return null
  if (src.pll) return null
  if (src.hxtal) return cfg.hxtalMhz ?? src.hxtal.default
  return src.freqMhz ?? null
}

/** PLL 输出频率：固定 VCO 模型（fixedOutMhz ÷ div，如 CH582）或输入×倍频参数乘积（V003 固定 mul=2）。 */
export function pllOutMhz(spec: ClockData, pllIn: number, pllParams: Record<string, number>): number {
  if (spec.pll.fixedOutMhz !== undefined) {
    const divSpec = spec.pll.params.find((p) => p.key === 'div')
    const div = pllParams.div ?? divSpec?.default ?? 1
    return spec.pll.fixedOutMhz / div
  }
  let out = pllIn
  for (const p of spec.pll.params) {
    const v = pllParams[p.key] ?? p.default
    out *= v
  }
  return out
}

/** 频率链：源 → PLL → SYSCLK → AHB → APB1/APB2 → ADC/TIM。 */
export function computeClock(spec: ClockData, cfg: ClockConfig): ClockFrequencies {
  let pllIn: number | null = null
  let pllOut: number | null = null
  let sysclk: number

  if (cfg.source === 'PLL') {
    const srcId = cfg.pllSource ?? spec.pll.sourceOptions[0]
    pllIn = sourceFreqMhz(spec, srcId, cfg)
    pllOut = pllIn === null ? null : pllOutMhz(spec, pllIn, cfg.pll ?? {})
    sysclk = pllOut ?? 0
  } else {
    sysclk = sourceFreqMhz(spec, cfg.source, cfg) ?? 0
  }

  const hclk = sysclk / cfg.ahb
  const pclk1 = hclk / cfg.apb1
  const pclk2 = hclk / cfg.apb2

  const adcOpt = spec.adc.options.find((o) => o.id === (cfg.adc ?? spec.adc.default)) ?? spec.adc.options[0]
  const adcBase = adcOpt.source === 'AHB' ? hclk : adcOpt.source === 'APB1' ? pclk1 : pclk2
  const adc = adcBase / adcOpt.div

  // 定时器域：V003 直接 SYSCLK；其它家族 APB 分频>1 时 ×2（由数据字段 timerClock 决定）
  const timMode = spec.timerClock ?? 'apb_x2'
  const pclk1Tim = timMode === 'sysclk' ? sysclk : cfg.apb1 === 1 ? pclk1 : pclk1 * 2
  const pclk2Tim = timMode === 'sysclk' ? sysclk : cfg.apb2 === 1 ? pclk2 : pclk2 * 2

  return {
    pllInMhz: pllIn,
    pllOutMhz: pllOut,
    sysclkMhz: sysclk,
    hclkMhz: hclk,
    pclk1Mhz: pclk1,
    pclk2Mhz: pclk2,
    adcMhz: adc,
    pclk1TimMhz: pclk1Tim,
    pclk2TimMhz: pclk2Tim,
  }
}

/** 校验时钟配置，返回问题列表（node 定位到时钟树节点）。 */
export function validateClock(spec: ClockData, cfg: ClockConfig): ClockIssue[] {
  const issues: ClockIssue[] = []
  const f = computeClock(spec, cfg)

  const hse = spec.sources.find((s) => s.id === 'HSE')
  const usesHse = cfg.source === 'HSE' || (cfg.source === 'PLL' && cfg.pllSource === 'HSE')
  if (usesHse && hse?.hxtal) {
    const x = cfg.hxtalMhz ?? hse.hxtal.default
    if (x < hse.hxtal.min || x > hse.hxtal.max) {
      issues.push({ node: 'HSE', level: 'error', message: `HSE 晶振 ${x}MHz 超出范围 ${hse.hxtal.min}~${hse.hxtal.max}MHz` })
    }
  }

  if (cfg.source === 'PLL') {
    if (!spec.pll.sourceOptions.includes(cfg.pllSource ?? '')) {
      issues.push({ node: 'PLL', level: 'error', message: `PLL 源 ${cfg.pllSource} 不合法` })
    }
    for (const p of spec.pll.params) {
      const v = cfg.pll?.[p.key] ?? p.default
      if (!p.options.includes(v)) {
        issues.push({ node: 'PLL', level: 'error', message: `PLL 参数 ${p.label}=${v} 不在可选档位` })
      }
    }
    if (f.pllOutMhz !== null && f.pllOutMhz > spec.pll.outMaxMhz) {
      issues.push({ node: 'PLL', level: 'error', message: `PLL 输出 ${f.pllOutMhz}MHz 超过上限 ${spec.pll.outMaxMhz}MHz` })
    }
  }

  if (f.sysclkMhz > spec.sysclkMaxMhz) {
    issues.push({ node: 'SYSCLK', level: 'error', message: `SYSCLK ${f.sysclkMhz}MHz 超过芯片上限 ${spec.sysclkMaxMhz}MHz` })
  }
  if (f.sysclkMhz <= 0) {
    issues.push({ node: 'SYSCLK', level: 'error', message: 'SYSCLK 为 0：时钟源配置无效' })
  }

  const buses: { key: 'ahb' | 'apb1' | 'apb2'; node: string; mhz: number }[] = [
    { key: 'ahb', node: 'AHB', mhz: f.hclkMhz },
    { key: 'apb1', node: 'APB1', mhz: f.pclk1Mhz },
    { key: 'apb2', node: 'APB2', mhz: f.pclk2Mhz },
  ]
  for (const b of buses) {
    const div = cfg[b.key]
    const dspec = spec[b.key]
    if (!dspec.options.includes(div)) {
      issues.push({ node: b.node, level: 'error', message: `${b.node} 分频 ${div} 不在可选档位` })
    }
    if (b.mhz > dspec.maxMhz) {
      issues.push({ node: b.node, level: 'error', message: `${b.node} ${b.mhz}MHz 超过上限 ${dspec.maxMhz}MHz` })
    }
  }

  if (spec.adc.maxMhz !== undefined && f.adcMhz > spec.adc.maxMhz) {
    issues.push({ node: 'ADC', level: 'warning', message: `ADC 时钟 ${f.adcMhz}MHz 超过建议上限 ${spec.adc.maxMhz}MHz` })
  }

  return issues
}

export interface PllCandidate {
  source: string
  hxtalMhz?: number
  params: Record<string, number>
  outMhz: number
}

/** 自动解算：枚举 PLL 源 × 参数档位，返回命中目标频率的候选（按源优先级排序）。 */
export function solvePll(spec: ClockData, targetMhz: number, sourceId?: string): PllCandidate[] {
  const out: PllCandidate[] = []
  const sources = sourceId ? [sourceId] : spec.pll.sourceOptions
  const paramCombos: Record<string, number>[] = [{}]
  for (const p of spec.pll.params) {
    const next: Record<string, number>[] = []
    for (const combo of paramCombos) {
      for (const opt of p.options) next.push({ ...combo, [p.key]: opt })
    }
    paramCombos.splice(0, paramCombos.length, ...next)
  }

  for (const src of sources) {
    const s = spec.sources.find((x) => x.id === src)
    if (!s) continue
    const hxtalOptions = s.hxtal ? [s.hxtal.default] : [undefined]
    for (const hxtal of hxtalOptions) {
      const cfg = { hxtalMhz: hxtal } as ClockConfig
      const inMhz = sourceFreqMhz(spec, src, cfg)
      if (inMhz === null) continue
      for (const params of paramCombos) {
        const outMhz = pllOutMhz(spec, inMhz, params)
        if (Math.abs(outMhz - targetMhz) < 1e-6 && outMhz <= spec.pll.outMaxMhz) {
          out.push({ source: src, hxtalMhz: hxtal, params, outMhz })
        }
      }
    }
  }
  return out
}

/** 芯片默认档：第一个非 PLL 时钟源（通常 HSI，无 HSI 芯片则 HSE）+ 各分频默认值。 */
export function defaultClock(spec: ClockData): ClockConfig {
  const hse = spec.sources.find((s) => s.id === 'HSE')
  const pllDefaults: Record<string, number> = {}
  for (const p of spec.pll.params) pllDefaults[p.key] = p.default
  // 不能写死 'HSI'：CH582M 等芯片只有 HSE + PLL，写死会导致默认 SYSCLK=0
  const defaultSource = spec.sources.find((s) => !s.pll)?.id ?? spec.sources[0]?.id ?? ''
  return {
    source: defaultSource,
    hxtalMhz: hse?.hxtal?.default,
    pllSource: spec.pll.sourceOptions[0],
    pll: pllDefaults,
    ahb: spec.ahb.default,
    apb1: spec.apb1.default,
    apb2: spec.apb2.default,
    adc: spec.adc.default,
  }
}

/** 旧工程兼容：缺省字段补默认。 */
export function mergeClockConfig(spec: ClockData, partial?: Partial<ClockConfig>): ClockConfig {
  const d = defaultClock(spec)
  if (!partial) return d
  return {
    source: partial.source ?? d.source,
    hxtalMhz: partial.hxtalMhz ?? d.hxtalMhz,
    pllSource: partial.pllSource ?? d.pllSource,
    pll: { ...d.pll, ...(partial.pll ?? {}) },
    ahb: partial.ahb ?? d.ahb,
    apb1: partial.apb1 ?? d.apb1,
    apb2: partial.apb2 ?? d.apb2,
    adc: partial.adc ?? d.adc,
  }
}

/** 预设匹配：配置与 preset.match 全字段一致才命中（HSE 频率必须相等；PLL 参数逐键比较）。 */
export function matchPreset(spec: ClockData, cfg: ClockConfig): ClockPreset | null {
  const pllKeys = spec.pll.params.map((p) => p.key)
  for (const p of spec.presets) {
    const m = p.match
    if (m.source !== cfg.source) continue
    if (m.source === 'PLL') {
      const wantSrc = m.pllSource ?? spec.pll.sourceOptions[0]
      const gotSrc = cfg.pllSource ?? spec.pll.sourceOptions[0]
      if (wantSrc !== gotSrc) continue
      // 逐键比较 PLL 参数（mul/div/…），缺省取数据层默认值
      let pllOk = true
      for (const key of pllKeys) {
        const want = (m as Record<string, unknown>)[key]
        if (want === undefined) continue
        const def = spec.pll.params.find((x) => x.key === key)?.default ?? 1
        const got = cfg.pll?.[key] ?? def
        if (want !== got) {
          pllOk = false
          break
        }
      }
      if (!pllOk) continue
      if (m.pllSource === 'HSE' && m.hxtalMhz !== undefined && m.hxtalMhz !== cfg.hxtalMhz) continue
    }
    if (m.source === 'HSE' && m.hxtalMhz !== undefined && m.hxtalMhz !== cfg.hxtalMhz) continue
    if (m.ahb !== cfg.ahb || m.apb1 !== cfg.apb1 || m.apb2 !== cfg.apb2) continue
    return p
  }
  return null
}

/** 找最接近目标频率的合法预设（供 CLOCK_PRESET_UNAVAILABLE 提示）。 */
export function nearestPreset(spec: ClockData, targetMhz: number): ClockPreset | null {
  let best: ClockPreset | null = null
  let bestDiff = Infinity
  for (const p of spec.presets) {
    const pll: Record<string, number> = {}
    for (const param of spec.pll.params) {
      const v = (p.match as Record<string, unknown>)[param.key]
      if (typeof v === 'number') pll[param.key] = v
    }
    const cfg = mergeClockConfig(spec, {
      source: p.match.source,
      pllSource: p.match.pllSource,
      hxtalMhz: p.match.hxtalMhz,
      pll: Object.keys(pll).length ? pll : undefined,
      ahb: p.match.ahb,
      apb1: p.match.apb1,
      apb2: p.match.apb2,
    })
    const f = computeClock(spec, cfg)
    const diff = Math.abs(f.sysclkMhz - targetMhz)
    if (diff < bestDiff) {
      bestDiff = diff
      best = p
    }
  }
  return best
}