// 目标频率求解与时钟问题修复。
import type { ClockConfig, ClockData, ClockIssue } from '@/model/types'
import { isClockNodeLocked, matchPreset } from './config'
import { computeClock, pllOutMhz, sourceFreqMhz, sysclkSourceDivider } from './frequency'
import { validateClock } from './validation'

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
  const paramCombos = locked.has('PLL') ? [currentPllParams(spec, opts.current)] : pllParamCombos(spec)

  for (const src of sources) {
    const s = spec.sources.find((x) => x.id === src)
    if (!s) continue
    const hxtalOptions = s.hxtal
      ? [locked.has('HSE') ? (opts.current?.hxtalMhz ?? s.hxtal.default) : s.hxtal.default]
      : [undefined]
    for (const hxtal of hxtalOptions) {
      const inMhz = sourceFreqMhz(spec, src, { hxtalMhz: hxtal })
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

/** 目标频率候选转为可导出配置。预设专用 HAL 可补齐未锁定的总线档位。 */
export function pllCandidateConfig(spec: ClockData, cfg: ClockConfig, candidate: PllCandidate, backend: string): ClockConfig | null {
  if (isClockNodeLocked(cfg, 'SYSCLK') && cfg.source !== 'PLL') return null
  const pllLocked = isClockNodeLocked(cfg, 'PLL')
  const requested: ClockConfig = {
    ...cfg,
    source: 'PLL',
    pllSource: pllLocked ? cfg.pllSource : candidate.source,
    pll: pllLocked ? cfg.pll : { ...cfg.pll, ...candidate.params },
    hxtalMhz: isClockNodeLocked(cfg, 'HSE') ? cfg.hxtalMhz : candidate.hxtalMhz ?? cfg.hxtalMhz,
  }
  const isValid = (clock: ClockConfig) => clock.pllSource === candidate.source
    && Math.abs(computeClock(spec, clock).sysclkMhz - candidate.outMhz) < 1e-6
    && validateClock(spec, clock, backend).every((issue) => issue.level !== 'error')
  if (isValid(requested)) return requested
  if (spec.codegen.fallback !== 'preset_only') return null

  for (const { match } of spec.presets) {
    const clock: ClockConfig = { ...requested }
    for (const [field, node] of [['ahb', 'AHB'], ['apb1', 'APB1'], ['apb2', 'APB2']] as const) {
      if (!isClockNodeLocked(cfg, node)) clock[field] = match[field]
    }
    if (isValid(clock)) return clock
  }
  return null
}

/** 自动修复结果：合法候选配置 + 其剩余问题（可能仍有 warning）。 */
export interface ClockFixResult {
  config: ClockConfig
  issues: ClockIssue[]
}

/** PLL 参数全组合（空参数返回 [{}]）。 */
function pllParamCombos(spec: ClockData): Record<string, number>[] {
  let combos: Record<string, number>[] = [{}]
  for (const param of spec.pll?.params ?? []) {
    combos = combos.flatMap((combo) => param.options.map((value) => ({ ...combo, [param.key]: value })))
  }
  return combos
}

function currentPllParams(spec: ClockData, cfg?: ClockConfig): Record<string, number> {
  return Object.fromEntries((spec.pll?.params ?? []).map((param) => [param.key, cfg?.pll?.[param.key] ?? param.default]))
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
export function resolveClockIssues(spec: ClockData, cfg: ClockConfig, backend?: string): ClockFixResult | null {
  if (validateClock(spec, cfg, backend).length === 0) return null

  const locked = new Set(cfg.locked ?? [])
  const hse = spec.sources.find((s) => s.id === 'HSE' && s.hxtal)
  const pllSourceOptions = spec.pll?.sourceOptions ?? []
  const basePll = currentPllParams(spec, cfg)

  const curFreq = computeClock(spec, cfg)
  const targetSys = curFreq.sysclkMhz > 0 ? curFreq.sysclkMhz : spec.sysclkMaxMhz

  // M16：displayOnly 源不进自动修复搜索空间（仅显示域无配置语义）
  const sourceIds = locked.has('SYSCLK') ? [cfg.source] : spec.sources.filter((s) => !s.displayOnly).map((s) => s.id)
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
        const combos = source === 'PLL' || sysclkSourceDivider(spec, source, cfg) !== undefined ? allPllCombos : [basePll]
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
                    ...(cfg.adcClkDiv !== undefined ? { adcClkDiv: cfg.adcClkDiv } : {}),
                  }
                  if (cfg.locked !== undefined) candidate.locked = cfg.locked
                  const issues = validateClock(spec, candidate, backend)
                  if (issues.some((i) => i.level === 'error')) continue
                  const preset = matchPreset(spec, candidate)
                  const score: [number, number, number, number] = [
                    issues.length,
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
