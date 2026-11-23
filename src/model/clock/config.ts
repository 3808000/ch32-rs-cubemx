// 时钟配置默认值、锁定与预设。
import type { ClockConfig, ClockData, ClockPreset } from '@/model/types'
import { computeClock } from './frequency'

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

/** ADC CTLR3.CLK_DIV 缺省值：仅 programmable 芯片（M15）存在。 */
function adcClkDivDefault(spec: ClockData): number | undefined {
  const cd = spec.peripheralClocks?.adc?.clkDiv
  return cd?.programmable ? cd.default : undefined
}

/** 芯片默认档：第一个非 PLL 时钟源（通常 HSI，无 HSI 芯片则 HSE）+ 各分频默认值。 */
export function defaultClock(spec: ClockData): ClockConfig {
  const hse = spec.sources.find((s) => s.id === 'HSE')
  // 不能写死 'HSI'：CH582M 等芯片只有 HSE + PLL，写死会导致默认 SYSCLK=0
  // 优先采用芯片数据指定的起始时钟源，例如以 PLL 预设开始的 CH582。
  // M16：displayOnly 源（LSI/LSE/CK32K 仅显示）不可作默认/求解候选
  const defaultSource =
    spec.defaultSource ?? spec.sources.find((s) => !s.pll && !s.displayOnly)?.id ?? spec.sources.find((s) => !s.displayOnly)?.id ?? ''
  const adcClkDiv = adcClkDivDefault(spec)
  // 无 PLL 芯片（M14）：不写 pllSource/pll
  if (!spec.pll) {
    return {
      source: defaultSource,
      hxtalMhz: hse?.hxtal?.default,
      ahb: spec.ahb.default,
      apb1: spec.apb1.default,
      apb2: spec.apb2.default,
      adc: spec.adc.default,
      ...(adcClkDiv !== undefined ? { adcClkDiv } : {}),
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
    ...(adcClkDiv !== undefined ? { adcClkDiv } : {}),
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
  // adcClkDiv（M15）：仅可编程芯片保留；导入脏值（非整数/越界/非数）回落缺省，防 cube.json 污染。
  const clkDiv = spec.peripheralClocks?.adc?.clkDiv
  if (clkDiv?.programmable) {
    const max = 2 ** clkDiv.bits - 1
    const raw = partial.adcClkDiv
    merged.adcClkDiv =
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= max ? raw : clkDiv.default
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
  const adcClkDiv = adcClkDivDefault(spec)
  const next: ClockConfig = {
    source: m.source,
    hxtalMhz: m.hxtalMhz ?? d.hxtalMhz,
    ...pllFields,
    ahb: m.ahb,
    apb1: m.apb1,
    apb2: m.apb2,
    adc: preset.adc ?? d.adc,
    // 预设应用重置 adcClkDiv 为缺省（M15，与 ADC 域语义一致）
    ...(adcClkDiv !== undefined ? { adcClkDiv } : {}),
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
  if (!isClockNodeLocked(cfg, 'ADC')) {
    if (t.adc !== undefined) next.adc = t.adc
    // ADC 域未锁定时 adcClkDiv 同 adc 重置为缺省（M15）
    if (t.adcClkDiv !== undefined) next.adcClkDiv = t.adcClkDiv
  }
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

/** 找最接近目标频率的合法预设（供 CLOCK_PRESET_UNAVAILABLE 提示）。 */
export function nearestPreset(spec: ClockData, targetMhz: number): ClockPreset | null {
  let best: ClockPreset | null = null
  let bestDiff = Infinity
  const base = defaultClock(spec)
  for (const preset of spec.presets) {
    const cfg = presetToConfig(spec, preset, base)
    const diff = Math.abs(computeClock(spec, cfg).sysclkMhz - targetMhz)
    if (diff < bestDiff) {
      bestDiff = diff
      best = preset
    }
  }
  return best
}
