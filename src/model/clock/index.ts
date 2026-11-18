// 时钟核心：频率链计算 / 校验 / PLL 求解 / 预设匹配。
// 完全数据驱动：所有芯片差异来自 ClockData，禁止按芯片名分支。
import type { ClockConfig, ClockData, ClockFrequencies, ClockIssue, ClockPreset } from '@/model/types'

/** 该节点是否在 ClockConfig.locked 中（预设/解算/自动修复不会修改其值）。 */
export function isClockNodeLocked(cfg: ClockConfig, nodeId: string): boolean {
  return (cfg.locked ?? []).includes(nodeId)
}

/** 节点是否可锁定：有可编辑参数的时钟节点（HSE 晶振 / PLL / SYSCLK / 总线 / ADC）。 */
export function isClockNodeLockable(spec: ClockData, nodeId: string): boolean {
  // 无 PLL 芯片（M14，如 X035）不存在 PLL 节点，自然不可锁定
  if (nodeId === 'PLL') return !!spec.pll
  if (nodeId === 'SYSCLK' || nodeId === 'AHB' || nodeId === 'APB1' || nodeId === 'APB2' || nodeId === 'ADC') {
    return true
  }
  // 源节点：只有带晶振频率的源（HSE）存在可保留的配置值
  return spec.sources.some((s) => s.id === nodeId && !!s.hxtal)
}

/** 取时钟源频率（MHz）。PLL 源返回 null（需先算 pllIn）。 */
export function sourceFreqMhz(spec: ClockData, sourceId: string, cfg: ClockConfig): number | null {
  const src = spec.sources.find((s) => s.id === sourceId)
  if (!src) return null
  if (src.pll) return null
  if (src.hxtal) return cfg.hxtalMhz ?? src.hxtal.default
  return src.freqMhz ?? null
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
    sysclk = sourceFreqMhz(spec, cfg.source, cfg) ?? 0
  }

  const hclk = sysclk / cfg.ahb
  const pclk1 = hclk / cfg.apb1
  const pclk2 = hclk / cfg.apb2

  const adcOpt = spec.adc.options.find((o) => o.id === (cfg.adc ?? spec.adc.default)) ?? spec.adc.options[0]
  // ADC 源：X035 由 SYSCLK 经 CLK_DIV 分频（M14）；其余分支保持原语义
  const adcBase =
    adcOpt.source === 'SYSCLK' ? sysclk : adcOpt.source === 'AHB' ? hclk : adcOpt.source === 'APB1' ? pclk1 : pclk2
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

  // 无 PLL 芯片（spec.pll 缺省）：跳过全部 PLL 校验；source=PLL 会由下方 SYSCLK 为 0 报错
  if (cfg.source === 'PLL' && spec.pll) {
    const pll = spec.pll
    const pllSource = cfg.pllSource ?? ''
    if (!pll.sourceOptions.includes(pllSource)) {
      issues.push({ node: 'PLL', level: 'error', message: `PLL 源 ${cfg.pllSource} 不合法` })
    }
    for (const p of pll.params) {
      const v = cfg.pll?.[p.key] ?? p.default
      if (!p.options.includes(v)) {
        issues.push({ node: 'PLL', level: 'error', message: `PLL 参数 ${p.label}=${v} 不在可选档位` })
      }
      // 参数按当前 PLL 源的上限（M14，如 V307 prediv 在 HSI 源下 ≤2）
      const maxBySource = p.maxBySource?.[pllSource]
      if (maxBySource !== undefined && v > maxBySource) {
        issues.push({
          node: 'PLL',
          level: 'error',
          message: `PLL 参数 ${p.key}（${p.label}）=${v} 超出源 ${pllSource} 上限 ${maxBySource}`,
        })
      }
    }
    if (f.pllOutMhz !== null && f.pllOutMhz > pll.outMaxMhz) {
      issues.push({ node: 'PLL', level: 'error', message: `PLL 输出 ${f.pllOutMhz}MHz 超过上限 ${pll.outMaxMhz}MHz` })
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

/** solvePll 的可选约束：锁定节点 id + 当前配置（锁定节点保留其值）。 */
export interface SolvePllOptions {
  locked?: string[]
  current?: ClockConfig
}

/** 自动解算：枚举 PLL 源 × 参数档位，返回命中目标频率的候选（按源优先级排序）。 */
export function solvePll(spec: ClockData, targetMhz: number, sourceId?: string, opts: SolvePllOptions = {}): PllCandidate[] {
  const out: PllCandidate[] = []
  // 无 PLL 芯片（M14，如 X035）：无候选
  if (!spec.pll) return out
  const pll = spec.pll
  const locked = new Set(opts.locked ?? [])
  // SYSCLK 锁定在非 PLL 源时，无法切到 PLL → 无候选
  if (locked.has('SYSCLK') && opts.current && opts.current.source !== 'PLL') return []
  let sources = sourceId ? [sourceId] : pll.sourceOptions
  // PLL 锁定：源与倍频参数都必须保留当前值
  if (locked.has('PLL')) {
    const fixedSource = opts.current?.pllSource ?? pll.sourceOptions[0]
    sources = sources.filter((s) => s === fixedSource)
  }
  const paramCombos: Record<string, number>[] = []
  if (locked.has('PLL')) {
    const params: Record<string, number> = {}
    for (const p of pll.params) params[p.key] = opts.current?.pll?.[p.key] ?? p.default
    paramCombos.push(params)
  } else {
    paramCombos.push({})
    for (const p of pll.params) {
      const next: Record<string, number>[] = []
      for (const combo of paramCombos) {
        for (const opt of p.options) next.push({ ...combo, [p.key]: opt })
      }
      paramCombos.splice(0, paramCombos.length, ...next)
    }
  }

  for (const src of sources) {
    const s = spec.sources.find((x) => x.id === src)
    if (!s) continue
    const hxtalOptions = s.hxtal
      ? [locked.has('HSE') ? (opts.current?.hxtalMhz ?? s.hxtal.default) : s.hxtal.default]
      : [undefined]
    for (const hxtal of hxtalOptions) {
      const cfg = { hxtalMhz: hxtal } as ClockConfig
      const inMhz = sourceFreqMhz(spec, src, cfg)
      if (inMhz === null) continue
      for (const params of paramCombos) {
        const outMhz = pllOutMhz(spec, inMhz, params)
        if (Math.abs(outMhz - targetMhz) < 1e-6 && outMhz <= pll.outMaxMhz) {
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
  // 不能写死 'HSI'：CH582M 等芯片只有 HSE + PLL，写死会导致默认 SYSCLK=0
  // M12：defaultSource 数据驱动优先（CH582M 指定 PLL——HSE 直连需 div=1 被 HAL assert 拒绝，不可生成）
  const defaultSource = spec.defaultSource ?? spec.sources.find((s) => !s.pll)?.id ?? spec.sources[0]?.id ?? ''
  // 无 PLL 芯片（M14）：不写 pllSource/pll
  if (!spec.pll) {
    return {
      source: defaultSource,
      hxtalMhz: hse?.hxtal?.default,
      ahb: spec.ahb.default,
      apb1: spec.apb1.default,
      apb2: spec.apb2.default,
      adc: spec.adc.default,
    }
  }
  const pllDefaults: Record<string, number> = {}
  for (const p of spec.pll.params) pllDefaults[p.key] = p.default
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

/** 旧工程兼容：缺省字段补默认（locked 原样保留）。 */
export function mergeClockConfig(spec: ClockData, partial?: Partial<ClockConfig>): ClockConfig {
  const d = defaultClock(spec)
  if (!partial) return d
  const merged: ClockConfig = {
    source: partial.source ?? d.source,
    hxtalMhz: partial.hxtalMhz ?? d.hxtalMhz,
    // 有 PLL：补默认参数；无 PLL（M14）：不补 pllSource/pll，仅保留旧配置里显式存在的值
    ...(spec.pll
      ? { pllSource: partial.pllSource ?? d.pllSource, pll: { ...d.pll, ...(partial.pll ?? {}) } }
      : {
          ...(partial.pllSource !== undefined ? { pllSource: partial.pllSource } : {}),
          ...(partial.pll !== undefined ? { pll: { ...partial.pll } } : {}),
        }),
    ahb: partial.ahb ?? d.ahb,
    apb1: partial.apb1 ?? d.apb1,
    apb2: partial.apb2 ?? d.apb2,
    adc: partial.adc ?? d.adc,
  }
  if (partial.locked !== undefined) merged.locked = [...partial.locked]
  return merged
}

/** 预设 → 完整配置（预设未声明的字段沿用 base/默认值）。 */
export function presetToConfig(spec: ClockData, preset: ClockPreset, base: ClockConfig): ClockConfig {
  const d = mergeClockConfig(spec, base)
  const m = preset.match
  let pllFields: { pllSource: string | undefined; pll: Record<string, number> } | Record<string, never> = {}
  if (spec.pll) {
    const pll = { ...d.pll }
    for (const p of spec.pll.params) {
      const v = (m as Record<string, unknown>)[p.key]
      if (typeof v === 'number') pll[p.key] = v
    }
    pllFields = { pllSource: m.pllSource ?? spec.pll.sourceOptions[0], pll }
  }
  const next: ClockConfig = {
    source: m.source,
    hxtalMhz: m.hxtalMhz ?? d.hxtalMhz,
    ...pllFields,
    ahb: m.ahb,
    apb1: m.apb1,
    apb2: m.apb2,
    adc: d.adc,
  }
  if (d.locked !== undefined) next.locked = [...d.locked]
  return next
}

/**
 * 应用预设，但跳过锁定节点：锁定节点的字段保留配置当前值。
 * 对应节点：SYSCLK=source / HSE=hxtalMhz / PLL=pllSource+pll / AHB|APB1|APB2=分频 / ADC=adc。
 */
export function applyClockPreset(spec: ClockData, cfg: ClockConfig, preset: ClockPreset): ClockConfig {
  const t = presetToConfig(spec, preset, cfg)
  const next: ClockConfig = spec.pll ? { ...cfg, pll: { ...(cfg.pll ?? {}) } } : { ...cfg }
  if (!isClockNodeLocked(cfg, 'SYSCLK')) next.source = t.source
  if (!isClockNodeLocked(cfg, 'HSE') && t.hxtalMhz !== undefined) next.hxtalMhz = t.hxtalMhz
  if (spec.pll && !isClockNodeLocked(cfg, 'PLL')) {
    next.pllSource = t.pllSource
    next.pll = { ...(cfg.pll ?? {}), ...(t.pll ?? {}) }
  }
  if (!isClockNodeLocked(cfg, 'AHB')) next.ahb = t.ahb
  if (!isClockNodeLocked(cfg, 'APB1')) next.apb1 = t.apb1
  if (!isClockNodeLocked(cfg, 'APB2')) next.apb2 = t.apb2
  if (!isClockNodeLocked(cfg, 'ADC') && t.adc !== undefined) next.adc = t.adc
  return next
}

/** matchPreset 选项：skipLocked 时锁定节点对应字段视为通配（仅 UI 展示/解算偏好使用）。 */
export interface MatchPresetOptions {
  skipLocked?: boolean
}

/**
 * 预设匹配：配置与 preset.match 一致才命中。
 * 默认严格匹配（代码生成必须按真实值选择 HAL 预设，避免锁定字段掩盖差异）；
 * UI 高亮/解算偏好可传 { skipLocked: true }，跳过锁定节点对应的字段。
 */
export function matchPreset(spec: ClockData, cfg: ClockConfig, opts: MatchPresetOptions = {}): ClockPreset | null {
  const pll = spec.pll
  const pllKeys = pll?.params.map((p) => p.key) ?? []
  const locked = opts.skipLocked ? new Set(cfg.locked ?? []) : new Set<string>()
  for (const p of spec.presets) {
    const m = p.match
    if (!locked.has('SYSCLK') && m.source !== cfg.source) continue
    // 无 PLL 数据：不存在可命中的 PLL 预设
    if (m.source === 'PLL' && !pll) continue
    if (m.source === 'PLL' && pll) {
      if (!locked.has('PLL')) {
        const wantSrc = m.pllSource ?? pll.sourceOptions[0]
        const gotSrc = cfg.pllSource ?? pll.sourceOptions[0]
        if (wantSrc !== gotSrc) continue
        // 逐键比较 PLL 参数（mul/div/prediv…），缺省取数据层默认值
        let pllOk = true
        for (const key of pllKeys) {
          const want = (m as Record<string, unknown>)[key]
          if (want === undefined) continue
          const def = pll.params.find((x) => x.key === key)?.default ?? 1
          const got = cfg.pll?.[key] ?? def
          if (want !== got) {
            pllOk = false
            break
          }
        }
        if (!pllOk) continue
      }
      if (!locked.has('HSE') && m.pllSource === 'HSE' && m.hxtalMhz !== undefined && m.hxtalMhz !== cfg.hxtalMhz) continue
    }
    if (!locked.has('HSE') && m.source === 'HSE' && m.hxtalMhz !== undefined && m.hxtalMhz !== cfg.hxtalMhz) continue
    if (!locked.has('AHB') && m.ahb !== cfg.ahb) continue
    if (!locked.has('APB1') && m.apb1 !== cfg.apb1) continue
    if (!locked.has('APB2') && m.apb2 !== cfg.apb2) continue
    return p
  }
  return null
}

// ---------- 自动修复（Resolve clock issues） ----------

/** 自动修复结果：合法候选配置 + 其剩余问题（可能仍有 warning）。 */
export interface ClockFixResult {
  config: ClockConfig
  issues: ClockIssue[]
}

/** PLL 参数全组合（空参数返回 [{}]）。 */
function pllParamCombos(spec: ClockData): Record<string, number>[] {
  const combos: Record<string, number>[] = [{}]
  for (const p of spec.pll?.params ?? []) {
    const next: Record<string, number>[] = []
    for (const combo of combos) {
      for (const opt of p.options) next.push({ ...combo, [p.key]: opt })
    }
    combos.splice(0, combos.length, ...next)
  }
  return combos
}

/** HSE 晶振候选：优先当前值与数据默认值（锁定只保留当前值）；自动修复不遍历整个量程。 */
function hxtalChoices(
  range: { min: number; max: number; default: number } | undefined,
  current: number | undefined,
  locked: boolean,
): (number | undefined)[] {
  if (!range) return [current]
  const cur = current ?? range.default
  if (locked) return [cur]
  const values = new Set<number>([cur, range.default, range.min, range.max])
  return [...values].filter((v) => v >= range.min && v <= range.max)
}

/** 统计两份配置在可配置字段上的差异数（用于选择"改动最小"的修复方案）。 */
function countConfigChanges(spec: ClockData, a: ClockConfig, b: ClockConfig): number {
  let n = 0
  if (a.source !== b.source) n++
  if ((a.hxtalMhz ?? 0) !== (b.hxtalMhz ?? 0)) n++
  if ((a.pllSource ?? '') !== (b.pllSource ?? '')) n++
  for (const p of spec.pll?.params ?? []) {
    if ((a.pll?.[p.key] ?? p.default) !== (b.pll?.[p.key] ?? p.default)) n++
  }
  if (a.ahb !== b.ahb) n++
  if (a.apb1 !== b.apb1) n++
  if (a.apb2 !== b.apb2) n++
  if ((a.adc ?? spec.adc.default) !== (b.adc ?? spec.adc.default)) n++
  return n
}

/**
 * 约束求解自动修复：枚举 源/PLL/分频/ADC 组合，返回 error 数最少（优先 0）的配置。
 * - 跳过锁定节点（字段保留当前值），锁定节点本身非法时返回 null（无解）；
 * - 评分优先级：warning 少 → 命中预设 → 改动字段少 → SYSCLK 接近原频率；
 * - 无任何 error=0 的候选时返回 null（调用方回退问题列表）。
 */
export function resolveClockIssues(spec: ClockData, cfg: ClockConfig): ClockFixResult | null {
  if (validateClock(spec, cfg).length === 0) return null

  const locked = new Set(cfg.locked ?? [])
  const hse = spec.sources.find((s) => s.id === 'HSE' && s.hxtal)
  const pllSourceOptions = spec.pll?.sourceOptions ?? []
  const basePll: Record<string, number> = {}
  for (const p of spec.pll?.params ?? []) basePll[p.key] = cfg.pll?.[p.key] ?? p.default

  const curFreq = computeClock(spec, cfg)
  const targetSys = curFreq.sysclkMhz > 0 ? curFreq.sysclkMhz : spec.sysclkMaxMhz

  const sourceIds = locked.has('SYSCLK') ? [cfg.source] : spec.sources.map((s) => s.id)
  const pllSourceIds = locked.has('PLL') ? [cfg.pllSource ?? pllSourceOptions[0]] : pllSourceOptions
  const allPllCombos = locked.has('PLL') ? [basePll] : pllParamCombos(spec)
  const ahbOptions = locked.has('AHB') ? [cfg.ahb] : spec.ahb.options
  const apb1Options = locked.has('APB1') ? [cfg.apb1] : spec.apb1.options
  const apb2Options = locked.has('APB2') ? [cfg.apb2] : spec.apb2.options
  const adcOptions = locked.has('ADC') ? [cfg.adc ?? spec.adc.default] : spec.adc.options.map((o) => o.id)

  interface Scored {
    config: ClockConfig
    issues: ClockIssue[]
    score: [number, number, number, number]
  }
  let best: Scored | null = null

  for (const source of sourceIds) {
    const pllSources = source === 'PLL' ? pllSourceIds : [cfg.pllSource ?? pllSourceOptions[0]]
    for (const pllSource of pllSources) {
      const usesHse = source === 'HSE' || (source === 'PLL' && pllSource === 'HSE')
      const hxtals = usesHse ? hxtalChoices(hse?.hxtal, cfg.hxtalMhz, locked.has('HSE')) : [cfg.hxtalMhz]
      for (const hxtalMhz of hxtals) {
        const combos = source === 'PLL' ? allPllCombos : [basePll]
        for (const params of combos) {
          for (const ahb of ahbOptions) {
            for (const apb1 of apb1Options) {
              for (const apb2 of apb2Options) {
                for (const adc of adcOptions) {
                  const candidate: ClockConfig = {
                    source,
                    hxtalMhz,
                    pllSource,
                    pll: { ...params },
                    ahb,
                    apb1,
                    apb2,
                    adc,
                  }
                  if (cfg.locked !== undefined) candidate.locked = cfg.locked
                  const issues = validateClock(spec, candidate)
                  const errors = issues.filter((i) => i.level === 'error').length
                  if (errors > 0) continue
                  const warnings = issues.length // errors 为 0 时剩余均为 warning
                  const preset = matchPreset(spec, candidate)
                  const score: [number, number, number, number] = [
                    warnings,
                    preset ? 0 : 1,
                    countConfigChanges(spec, cfg, candidate),
                    Math.abs(computeClock(spec, candidate).sysclkMhz - targetSys),
                  ]
                  if (!best || scoreLess(score, best.score)) best = { config: candidate, issues, score }
                }
              }
            }
          }
        }
      }
    }
  }

  return best ? { config: best.config, issues: best.issues } : null
}

/** 字典序比较评分（越小越优）。 */
function scoreLess(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

/** 找最接近目标频率的合法预设（供 CLOCK_PRESET_UNAVAILABLE 提示）。 */
export function nearestPreset(spec: ClockData, targetMhz: number): ClockPreset | null {
  let best: ClockPreset | null = null
  let bestDiff = Infinity
  for (const p of spec.presets) {
    const pll: Record<string, number> = {}
    for (const param of spec.pll?.params ?? []) {
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