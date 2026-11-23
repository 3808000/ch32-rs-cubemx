// 物理时钟约束与 HAL 可导出性校验。
import type { ClockConfig, ClockData, ClockIssue } from '@/model/types'
import { matchPreset } from './config'
import { computeClock, sysclkSourceDivider } from './frequency'

/** 校验时钟配置，返回问题列表（node 定位到时钟树节点）。 */
export function validateClock(spec: ClockData, cfg: ClockConfig, backend?: string): ClockIssue[] {
  const issues: ClockIssue[] = []
  const f = computeClock(spec, cfg)

  const hse = spec.sources.find((s) => s.id === 'HSE')
  // M16：仅显示源（LSI/LSE/CK32K 等 RM 低频域）不可配置为 SYSCLK（导入脏值兜底）
  const srcSpec = spec.sources.find((s) => s.id === cfg.source)
  if (srcSpec?.displayOnly) {
    issues.push({ node: 'SYSCLK', level: 'error', message: `${srcSpec.label} 为仅显示时钟源（RM 低频域），不可配置为 SYSCLK` })
  }
  const directDivider = sysclkSourceDivider(spec, cfg.source, cfg)
  const dividerSpec = spec.pll?.params.find((item) => item.key === srcSpec?.sysclkDividerParam)
  if (dividerSpec && directDivider !== undefined && !dividerSpec.options.includes(directDivider)) {
    issues.push({ node: 'SYSCLK', level: 'error', message: `SYSCLK 分频 ÷${directDivider} 不在可选档位` })
  }
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

  const adcSelection = cfg.adc ?? spec.adc.default
  if (!spec.adc.options.some((option) => option.id === adcSelection)) {
    issues.push({ node: 'ADC', level: 'error', message: `ADC 时钟档位 ${adcSelection} 不在可选范围` })
  } else if (adcSelection !== spec.adc.default && spec.peripheralClocks?.adc?.pre?.programmable === false) {
    issues.push({ node: 'ADC', level: 'error', message: '当前 HAL 不写 ADCPRE，导出需要选择复位档' })
  }
  if (spec.adc.maxMhz !== undefined && f.adcMhz > spec.adc.maxMhz) {
    issues.push({ node: 'ADC', level: 'warning', message: `ADC 时钟 ${f.adcMhz}MHz 超过建议上限 ${spec.adc.maxMhz}MHz` })
  }

  if (backend) {
    const exportIssue = clockExportIssue(spec, cfg, backend)
    if (exportIssue) issues.push(exportIssue)
  }

  return issues
}

/** 配方限制与物理时钟限制分开，画布与导出共享同一判据。 */
export function clockExportIssue(spec: ClockData, cfg: ClockConfig, backend = 'ch32-hal'): ClockIssue | undefined {
  let message: string | undefined
  let node = 'SYSCLK'
  if (backend === 'ch32-hal' && spec.codegen.fallback === 'preset_only') {
    const preset = matchPreset(spec, cfg)
    if (!preset || !spec.codegen.presetConstMap[preset.id]) {
      message = '当前 SYSCLK 与总线组合没有 HAL 预设配方，请选择支持的预设'
    }
  } else if (backend === 'ch58x-hal') {
    const div = cfg.pll?.div
    if (cfg.source !== 'PLL') {
      message = `ch58x-hal 后端仅生成 PLL 时钟；${cfg.source} 仅用于时钟树预览`
    } else if (div === undefined || !Number.isInteger(div) || div < 2 || div > 31) {
      node = 'PLL'
      message = `ch58x-hal 的 PLL 分频必须为 2..=31（5 位寄存器），当前 div=${String(div ?? '未配置')}`
    }
  } else if (backend === 'ch5xx-hal' && cfg.source === 'HSE') {
    const div = sysclkSourceDivider(spec, 'HSE', cfg)
    const mhz = computeClock(spec, cfg).sysclkMhz
    if (div === undefined || !Number.isInteger(div) || div < 2 || div > 32
        || !((mhz >= 2 && mhz <= 10) || (mhz >= 15 && mhz <= 80))) {
      message = `HSE 分频必须为 2..=32，且 Fsys 落在 2–10 MHz 或 15–80 MHz。当前为 ${mhz} MHz。`
    }
  } else if (backend === 'ch5xx-hal' && cfg.source === 'PLL') {
    const div = cfg.pll?.div
    const [lo, hi] = spec.codegen.backends?.[backend]?.pllDivRange ?? [6, 32]
    if (div === undefined || !Number.isInteger(div) || div < lo || div > hi) {
      node = 'PLL'
      message = `ch5xx-hal 的 PLL 分频必须为 ${lo}..=${hi}（480MHz VCO），当前 div=${String(div ?? '未配置')}`
    } else {
      const { sysclkMhz } = computeClock(spec, cfg)
      if (!(sysclkMhz >= 15 && sysclkMhz <= 80)) {
        message = `ch5xx-hal 的 PLL 系统频率必须在 15–80 MHz，当前为 ${sysclkMhz} MHz`
      }
    }
  } else if (backend === 'ch5xx-hal') {
    message = `${cfg.source} 仅为显示源，ch5xx-hal 无对应 SYSCLK 初始化；请选择 PLL 或 HSE`
  }
  return message ? { node, level: 'error', message } : undefined
}
