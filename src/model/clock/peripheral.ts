// 外设时钟域（M15）：USART/SPI/I2C/ADC 实例时钟派生 + USB 48M 域。
// 纯函数、数据驱动：不按芯片名分流，公式逐字复刻参考 HAL。
// - ch32-hal spi.rs:833-853 calculate_baud_rate（2 的幂 BRG，None → DIV_256）
// - ch32-hal usart/mod.rs:1093-1100 baudrate_divisor（4.16 定点 BRR，舍入）
// - ch32-hal i2c.rs:257-280 timing()（standard ÷2、fast Duty2 ÷3、Duty16 ÷25，向上取整）
// - ch58x-hal spi.rs:169-177（fdiv=sysclk/freq 整除 clamp 2..255）
// - ch58x-hal uart.rs:360-371（DIV=1、DL=round(Fsys/(8*baud))，actual=Fsys/(8*DL)）
// - ch58x-hal i2c.rs:128-155（同 I2C factor，向下取整，最小 4/1）
// - ch58x-hal adc.rs:8-15 SamplingClock 枚举（CK32M ÷4/6/8/10）
import type {
  ClockConfig,
  ClockData,
  ClockFrequencies,
  ClockIssue,
  PeripheralsData,
  PeripheralClockBus,
  PeripheralClocksData,
  PeripheralClockFreq,
  PeripheralState,
  SpiClockSpec,
} from '@/model/types'

/** 外设类别（peripherals.json 的四个实例数组）。 */
const INSTANCE_KEYS = ['usart', 'spi', 'i2c', 'adc'] as const

/** ch58x 时钟模型特征：SPI 线性 BRG 或 ADC 枚举旋钮（禁止按芯片名分流）。 */
function isCh58xClockModel(pc: PeripheralClocksData): boolean {
  return !!(pc.spi?.brg.linear || pc.adc?.knob)
}

/** 总线频率（MHz）。CK32M 为 CH58x 固定 32MHz 域（fixedInMhz 优先）。 */
function busFreqMhz(spec: ClockData, freqs: ClockFrequencies, bus: PeripheralClockBus): number {
  switch (bus) {
    case 'SYSCLK':
      return freqs.sysclkMhz
    case 'HCLK':
      return freqs.hclkMhz
    case 'APB1':
      return freqs.pclk1Mhz
    case 'APB2':
      return freqs.pclk2Mhz
    case 'CK32M':
      return spec.peripheralClocks?.adc?.fixedInMhz ?? 32
    default:
      return 0
  }
}

/** 读实例参数当前值（未启用/未配置时取 ParamSpec 默认值）。 */
function paramValue(
  state: Record<string, PeripheralState>,
  periId: string,
  key: string,
  fallback: string | number | boolean | undefined,
): string | number | boolean | undefined {
  return state[periId]?.params?.[key] ?? fallback
}

/** 数字参数（非法导入值 → null，不编造频率）。 */
function numericParam(v: string | number | boolean | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 频率显示：去掉多余小数（1e-9 量级浮点误差不影响展示）。 */
function fmt(v: number): string {
  return String(Number(v.toFixed(6)))
}

/** SPI 实际分频（ch32：最小 2 的幂使 bus/div ≤ requested；ch58x：线性整除 clamp 2..255）。 */
function spiDivider(
  busHz: number,
  requestedHz: number,
  brg: SpiClockSpec['brg'],
): { div: number; linear: boolean } {
  if (brg.linear) {
    const raw = requestedHz > 0 ? Math.floor(busHz / requestedHz) : brg.linear.max
    return { div: Math.min(brg.linear.max, Math.max(brg.linear.min, raw)), linear: true }
  }
  const divs = [...(brg.divs ?? [])].sort((a, b) => a - b)
  const fallback = divs[divs.length - 1] ?? 256
  // HAL：for divisor in [2,4,...,256] { if clock <= frequency*divisor { return divisor } } → None 时 DIV_256
  const hit = divs.find((d) => requestedHz > 0 && busHz <= requestedHz * d)
  return { div: hit ?? fallback, linear: false }
}

interface RateResult {
  actualMhz: number | null
  dividerLabel: string | null
  errorPct?: number
  issue?: { level: 'error' | 'warning'; message: string }
}

/** ch32 USART：BRR = round(fCK/baud)（4.16 定点），实际 baud = fCK/BRR。 */
function usartCh32(clockHz: number, baud: number): RateResult {
  if (!(baud > 0)) {
    return { actualMhz: null, dividerLabel: null, issue: { level: 'error', message: '波特率必须大于 0（HAL ConfigError::BaudrateTooLow）' } }
  }
  // HAL：divisor = (clock + baud/2) / baud（整数除法，baud/2 先截断）
  const divisor = Math.floor((clockHz + Math.floor(baud / 2)) / baud)
  if (divisor < 0x10) {
    return {
      actualMhz: null,
      dividerLabel: `BRR ${divisor}（< 0x10）`,
      issue: { level: 'error', message: `波特率 ${baud} 过高：BRR=${divisor} 低于 HAL 下限 0x10（ConfigError::BaudrateTooHigh）` },
    }
  }
  if (divisor > 0xffff) {
    return {
      actualMhz: null,
      dividerLabel: `BRR ${divisor}（> 0xFFFF）`,
      issue: { level: 'error', message: `波特率 ${baud} 过低：BRR=${divisor} 超过 HAL 上限 0xFFFF（ConfigError::BaudrateTooLow）` },
    }
  }
  const actualHz = clockHz / divisor
  return {
    actualMhz: actualHz / 1e6,
    dividerLabel: `÷${divisor} (BRR)`,
    errorPct: ((actualHz - baud) / baud) * 100,
  }
}

/** ch58x UART：DIV=1、DL=round(Fsys/(8*baud))，actual=Fsys/(8*DIV*DL)。 */
function usartCh58x(clockHz: number, baud: number): RateResult {
  if (!(baud > 0)) {
    return { actualMhz: null, dividerLabel: null, issue: { level: 'error', message: '波特率必须大于 0' } }
  }
  let div = 1
  let dl: number
  if (clockHz === 60_000_000 && baud === 115200) {
    // HAL 特例（uart.rs:361-362）
    div = 13
    dl = 5
  } else if (clockHz === 60_000_000 && baud === 8600) {
    div = 8
    dl = 109
  } else {
    // HAL：x = 10*Fsys/8/baud（整数除法）；x = ((x+5)/10) & 0xffff
    const x = Math.floor(Math.floor((10 * clockHz) / 8) / baud)
    dl = Math.floor((x + 5) / 10) & 0xffff
  }
  if (dl <= 0) {
    return {
      actualMhz: null,
      dividerLabel: `DIV ${div} DL ${dl}`,
      issue: { level: 'error', message: `波特率 ${baud} 过高：DL=${dl} 无法分频` },
    }
  }
  const actualHz = (clockHz * 2) / (div * 16 * dl)
  return {
    actualMhz: actualHz / 1e6,
    dividerLabel: `DIV ${div} DL ${dl}`,
    errorPct: ((actualHz - baud) / baud) * 100,
  }
}

/** I2C 实际 SCL（ch32 timing() 向上取整；ch58x 向下取整；standard ÷2 / Duty2 ÷3 / Duty16 ÷25）。 */
function i2cTiming(busHz: number, freqHz: number, duty: string, ch58x: boolean): RateResult {
  if (!(freqHz > 0)) {
    return { actualMhz: null, dividerLabel: null, issue: { level: 'error', message: 'SCL 请求必须大于 0（HAL timing() assert）' } }
  }
  const fast = freqHz > 100_000
  const factor = !fast ? 2 : duty === 'Duty16_9' ? 25 : 3
  const raw = ch58x ? Math.floor(busHz / (freqHz * factor)) : Math.ceil(busHz / (freqHz * factor))
  const divider = Math.max(raw, fast ? 1 : 4)
  if (divider > 0xfff) {
    return {
      actualMhz: null,
      dividerLabel: `CCR ${divider}（> 0xFFF）`,
      issue: { level: 'error', message: `SCL ${freqHz}Hz 需要 CCR=${divider}，超过 12 位上限 0xFFF（HAL timing() assert）` },
    }
  }
  const actualHz = busHz / (divider * factor)
  return { actualMhz: actualHz / 1e6, dividerLabel: `÷${divider} (CCR)` }
}

/** 外设时钟派生：遍历全部实例（含未启用），末尾追加 USB 域节点。 */
export function computePeripheralClocks(
  spec: ClockData,
  cfg: ClockConfig,
  freqs: ClockFrequencies,
  periData: PeripheralsData,
  periState: Record<string, PeripheralState> = {},
): PeripheralClockFreq[] {
  const pc = spec.peripheralClocks
  const out: PeripheralClockFreq[] = []
  if (!pc) return out
  const ch58x = isCh58xClockModel(pc)
  const state = periState ?? {}

  const push = (node: PeripheralClockFreq): void => {
    out.push(node)
  }
  const enabled = (iid: string): boolean => state[iid]?.enabled === true

  // ---- USART ----
  if (pc.usart) {
    const usart = pc.usart
    const warnPct = usart.baudErrorWarnPct ?? 3
    for (const inst of periData.usart ?? []) {
      const bus = usart.sourceOverrides?.[inst.id] ?? usart.sourceDefault
      const inMhz = busFreqMhz(spec, freqs, bus)
      const requested = numericParam(paramValue(state, inst.id, usart.knob, inst.params[usart.knob]?.default))
      const issues: ClockIssue[] = []
      let result: RateResult = { actualMhz: null, dividerLabel: null }
      if (requested !== null) {
        result = ch58x ? usartCh58x(inMhz * 1e6, requested) : usartCh32(inMhz * 1e6, requested)
      }
      if (result.issue && enabled(inst.id)) {
        issues.push({ node: `P-${inst.id}`, level: result.issue.level, message: result.issue.message })
      } else if (result.errorPct !== undefined && enabled(inst.id) && Math.abs(result.errorPct) > warnPct) {
        issues.push({
          node: `P-${inst.id}`,
          level: 'warning',
          message: `波特率误差 ${Math.abs(result.errorPct).toFixed(2)}% 超过阈值 ${warnPct}%（请求 ${requested}，实际 ${fmt((result.actualMhz ?? 0) * 1e6)}）`,
        })
      }
      push({
        nodeId: `P-${inst.id}`,
        periId: inst.id,
        category: 'usart',
        sourceBus: bus,
        inMhz,
        requested,
        actualMhz: result.actualMhz,
        dividerLabel: result.dividerLabel,
        ...(result.errorPct !== undefined ? { errorPct: result.errorPct } : {}),
        issues,
      })
    }
  }

  // ---- SPI ----
  if (pc.spi) {
    const spi = pc.spi
    for (const inst of periData.spi ?? []) {
      const bus = spi.sourceOverrides?.[inst.id] ?? spi.sourceDefault
      const inMhz = busFreqMhz(spec, freqs, bus)
      const requested = numericParam(paramValue(state, inst.id, spi.knob, inst.params[spi.knob]?.default))
      const issues: ClockIssue[] = []
      let actualMhz: number | null = null
      let dividerLabel: string | null = null
      if (requested !== null && requested > 0) {
        const { div, linear } = spiDivider(inMhz * 1e6, requested, spi.brg)
        actualMhz = (inMhz * 1e6) / div / 1e6
        dividerLabel = linear ? `÷${div} (线性 BRG)` : `÷${div} (BRG)`
        if (enabled(inst.id)) {
          // ch32：requested > bus/2 → HAL 落 DIV_2；requested < bus/256 → calculate_baud_rate 返回 None → DIV_256
          // ch58x：线性分频 HAL 静默 clamp 2..255（同向回退，消息用 ÷N 表达）
          if (requested > (inMhz * 1e6) / 2) {
            issues.push({
              node: `P-${inst.id}`,
              level: 'warning',
              message: linear
                ? `请求超 bus/2，HAL 将 clamp 到 ÷2，实际 ${fmt(actualMhz)}MHz`
                : `请求超 bus/2，HAL 将用 DIV_2，实际 ${fmt(actualMhz)}MHz`,
            })
          } else if (requested < (inMhz * 1e6) / (linear ? (spi.brg.linear?.max ?? 255) : 256)) {
            issues.push({
              node: `P-${inst.id}`,
              level: 'warning',
              message: linear
                ? `请求低于 bus/${spi.brg.linear?.max ?? 255}，HAL 将 clamp 到 ÷${div}，实际 ${fmt(actualMhz)}MHz`
                : `请求低于 bus/256，HAL 回退 DIV_256，实际 ${fmt(actualMhz)}MHz`,
            })
          }
        }
      }
      push({
        nodeId: `P-${inst.id}`,
        periId: inst.id,
        category: 'spi',
        sourceBus: bus,
        inMhz,
        requested,
        actualMhz,
        dividerLabel,
        issues,
      })
    }
  }

  // ---- I2C ----
  if (pc.i2c) {
    const i2c = pc.i2c
    for (const inst of periData.i2c ?? []) {
      const bus = i2c.sourceOverrides?.[inst.id] ?? i2c.sourceDefault
      const inMhz = busFreqMhz(spec, freqs, bus)
      const requested = numericParam(paramValue(state, inst.id, i2c.knob, inst.params[i2c.knob]?.default))
      const duty = String(paramValue(state, inst.id, 'duty', inst.params.duty?.default ?? 'Duty2_1'))
      const issues: ClockIssue[] = []
      let actualMhz: number | null = null
      let dividerLabel: string | null = null
      if (requested !== null) {
        if (enabled(inst.id) && requested > i2c.maxKhz * 1000) {
          // HAL timing() assert!(frequency <= 400_000)
          issues.push({
            node: `P-${inst.id}`,
            level: 'error',
            message: `SCL 请求 ${requested / 1000}kHz 超过上限 ${i2c.maxKhz}kHz（HAL timing() assert）`,
          })
        } else {
          const r = i2cTiming(inMhz * 1e6, requested, duty, ch58x)
          actualMhz = r.actualMhz
          dividerLabel = r.dividerLabel
          if (r.issue && enabled(inst.id)) issues.push({ node: `P-${inst.id}`, ...r.issue })
        }
      }
      push({
        nodeId: `P-${inst.id}`,
        periId: inst.id,
        category: 'i2c',
        sourceBus: bus,
        inMhz,
        requested,
        actualMhz,
        dividerLabel,
        issues,
      })
    }
  }

  // ---- ADC ----
  if (pc.adc) {
    const adcSpec = pc.adc
    for (const inst of periData.adc ?? []) {
      const inMhz = adcSpec.fixedInMhz ?? freqs.adcMhz
      const issues: ClockIssue[] = []
      let requested: number | string | null = null
      let actualMhz: number | null = null
      let dividerLabel: string | null = null

      if (adcSpec.knob) {
        // CH58x：SamplingClock 枚举镜像外设参数（CK32M ÷4/6/8/10）
        const v = paramValue(state, inst.id, adcSpec.knob, inst.params[adcSpec.knob]?.default)
        requested = typeof v === 'string' ? v : v === undefined ? null : String(v)
        if (requested !== null) {
          const mhz = adcSpec.enumMhz?.[String(requested)]
          actualMhz = mhz ?? null
          dividerLabel = `SamplingClock ${String(requested)}`
          if (mhz === undefined && enabled(inst.id)) {
            issues.push({
              node: `P-${inst.id}`,
              level: 'error',
              message: `采样时钟 ${String(requested)} 不在 enumMhz 映射内`,
            })
          }
        }
      } else if (adcSpec.clkDiv) {
        // CTLR3.CLK_DIV raw：语义未核实 → 不编造 MHz（actualMhz=null）
        const raw = cfg.adcClkDiv ?? adcSpec.clkDiv.default
        requested = raw
        dividerLabel = `raw ${raw} (0b${Math.max(0, raw).toString(2).padStart(adcSpec.clkDiv.bits, '0')})`
        actualMhz = null
      } else {
        // 无额外分频旋钮：按现有 ADC 域频率（含 ADCPRE 复位路径）直通
        actualMhz = inMhz
      }

      push({
        nodeId: `P-${inst.id}`,
        periId: inst.id,
        category: 'adc',
        sourceBus: adcSpec.source,
        inMhz,
        requested,
        actualMhz,
        dividerLabel,
        issues,
      })
    }
  }

  // ---- USB 48M 域（HAL rcc::init 自动 USBPRE，无 API）----
  if (pc.usb) {
    const usb = pc.usb
    let inMhz: number | null = null
    let sourceBus = 'PLL'
    let actualMhz: number | null = null
    let dividerLabel: string | null = null
    const issues: ClockIssue[] = []

    if (usb.fixedMhz !== undefined) {
      // X035：HSI 48MHz 直连，无分频
      inMhz = usb.fixedMhz
      sourceBus = 'HSI'
      actualMhz = usb.fixedMhz
      dividerLabel = `固定 ${fmt(usb.fixedMhz)}MHz（HSI 直连）`
    } else if (cfg.source === 'PLL') {
      inMhz = freqs.pllOutMhz
    }

    if (usb.fixedMhz === undefined && inMhz !== null) {
      const div = usb.autoPre[String(inMhz)]
      const valid = usb.validPllMhz.includes(inMhz)
      if (valid && div !== undefined) {
        actualMhz = inMhz / div
        dividerLabel = `USBPRE ÷${div} (HAL auto)`
      } else {
        actualMhz = null
        dividerLabel = null
        issues.push({
          node: 'USB',
          level: 'warning',
          message: `PLL ${fmt(inMhz)}MHz 不在 USBPRE 合法集 [${usb.validPllMhz.join(',')}]MHz，USB 时钟非法（HAL 静默留复位值）`,
        })
      }
    }

    push({
      nodeId: 'USB',
      periId: 'USB',
      category: 'usb',
      sourceBus,
      // 类型要求 number：非 PLL 源无输入，用 0 表示「无时钟」（actualMhz=null 表达非法）
      inMhz: inMhz ?? 0,
      requested: null,
      actualMhz,
      dividerLabel,
      issues,
    })
  }

  return out
}

/**
 * 外设时钟校验（契约 D2）：汇总 computePeripheralClocks 的节点问题。
 * 规则：SPI 双向回退 warning；I2C 超 maxKhz error；USART 误差超阈值 warning；
 * USB 非法 PLL warning。ADC 超 maxMhz 由既有 validateClock 负责，不重复。
 */
export function validatePeripheralClocks(
  spec: ClockData,
  cfg: ClockConfig,
  freqs: ClockFrequencies,
  periData: PeripheralsData,
  periState: Record<string, PeripheralState> = {},
): ClockIssue[] {
  return computePeripheralClocks(spec, cfg, freqs, periData, periState).flatMap((p) => p.issues)
}

/** 供测试/数据校验复用：peripheralClocks 块声明了哪些实例类别。 */
export function peripheralClockCategories(pc: PeripheralClocksData | undefined): (typeof INSTANCE_KEYS)[number][] {
  if (!pc) return []
  return INSTANCE_KEYS.filter((k) => pc[k] !== undefined)
}
