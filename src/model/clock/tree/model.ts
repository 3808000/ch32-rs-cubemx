// 时钟树数据模型（纯函数）：输入 ClockData + ClockConfig + ClockFrequencies，
// 输出节点 / 连线 / 分组容器的逻辑结构（不含画布坐标）。
// 节点数量与取值全部来自 spec（源数量、PLL 参数、分频档位、ADC 选项、定时器域模式）。
// M15：列式布局元数据（column/group）+ 外设时钟节点（periParam / adcClkDiv 控件、badge、双行标签）。
import type {
  AdcClockSpec,
  ClockConfig,
  ClockData,
  ClockFrequencies,
  ClockIssue,
  ClockNodeKind,
  ParamSpec,
  PeripheralClockBus,
  PeripheralClockFreq,
  PeripheralClocksData,
  PeripheralsData,
  PeripheralState,
} from '@/model/types'
import { periParamControl, type ClockNodeControl } from './controls'
import { isClockNodeLockable, isClockNodeLocked } from '../config'
import { adcClockOption, adcInputMhz, pllOutMhz, sourceFreqMhz, sysclkSourceDivider } from '../frequency'

/** 节点徽标：fixed=源总线固定 / raw=寄存器原始值 / derived=由 PLL 自动派生 */
export type ClockNodeBadge = 'fixed' | 'derived' | 'raw'

/** 节点逻辑内容；几何字段（x/y/w/h）由 layout 层补充。 */
export interface ClockNodeModel {
  id: string
  label: string
  /** M16 图元种类（渲染簇形状）：源=osc / SYSCLK·ADC=mux / PLL=pll / AHB·APB=div（单档→readout）
   *  / TIM·USB=readout / 外设=peri / aux 数据自述；diagram.nodes[id].kind 覆盖优先 */
  kind: ClockNodeKind
  /** M16 仅显示（不生成）：aux 域与 displayOnly 源；渲染层灰显 */
  displayOnly?: boolean
  /** M16 mux/pll 输入 id 列表（锚点行序）：源选择 mux=options 值序 + displayOnly 源追加（灰行）；
   *  ADC 分频 mux=选项 id；aux mux/pll=inputs id */
  muxInputs?: string[]
  /** M16 mux 行 RM 文案（与 muxInputs 同序；aux inputs[].label）；渲染层缺省回退 id/option label */
  muxLabels?: string[]
  /** M16 pll 簇完整参数 stepper 链（prediv/mul/div 逐参数控件，field='pll'+pllKey）；
   *  control 仍为首参数（表格/Detail 兼容），渲染层用本链画全部 stepper */
  pllControls?: ClockNodeControl[]
  /** 输入频率（MHz），源节点为 null */
  inMhz: number | null
  /** 输出频率（MHz） */
  outMhz: number | null
  /** 选择器输出端的信号名，以及自动分频等独立读数卡的显示值。 */
  outputLabel?: string
  readoutText?: string
  /** 频率上限（MHz），无上限为 null */
  maxMhz: number | null
  /** 问题级别：error 红 / warning 橙 / null 正常（来自 validateClock 定位到本节点） */
  issueLevel: 'error' | 'warning' | null
  /** 越界错误（error 级；保留以兼容既有调用方） */
  overLimit: boolean
  /** 是否在当前有效链路上（外设实例节点=实例 enabled，未启用仍渲染 dim） */
  active: boolean
  /** 节点是否被锁定（预设/解算/自动修复保留其值） */
  locked: boolean
  /** 节点是否支持锁定（外设节点固定 false） */
  lockable: boolean
  control: ClockNodeControl | null
  /** 控件行位置的只读说明（如 TIM 倍率） */
  hint?: string
  /** 布局列（0 sources 1 PLL 2 system 3 buses 4 TIM 5 USART 6 SPI 7 I2C 8 ADC 9 USB） */
  column: number
  /** 分组容器 id（g-sources/g-pll/g-sys/g-out/g-adc/g-usart/g-spi/g-i2c；''=不进分组框） */
  group: string
  badge?: ClockNodeBadge
  /** 外设节点对应的 peripherals.json 实例 id（USB 域节点='USB'） */
  periId?: string
  /** 外设实例读数所对应的实际输入时钟名称。 */
  inputClockLabel?: string
  /** 全量问题消息（hover tooltip） */
  issues?: ClockIssue[]
  /** 外设节点：请求值原生单位（'115200 baud'/'8 MHz'/'raw 3'） */
  requestedLabel?: string
  /** 外设节点：实际派生（'实际 7.5 MHz · ÷8 (BRG)'/'误差 0.16%'） */
  actualLabel?: string
}

/** 连线逻辑内容；折线点集与标签位置由 layout 层补充。 */
export interface ClockEdgeModel {
  id: string
  from: string
  to: string
  active: boolean
  label?: string
  /** 输入行索引，用于同源多档或档位 ID 与来源 ID 不同的选择器。 */
  inputIndex?: number
}

/** 分组容器逻辑内容；几何字段由 layout 层补充。 */
export interface ClockGroupModel {
  id: string
  label: string
}

export interface ClockTreeModel {
  nodes: ClockNodeModel[]
  edges: ClockEdgeModel[]
  groups: ClockGroupModel[]
}

/** 外设时钟上下文（M15）：实例清单 + 工程外设状态 + 由 model/clock/peripheral.ts 算出的派生频率。 */
export interface PeripheralClockContext {
  peripherals: PeripheralsData
  state: Record<string, PeripheralState>
  periFreqs: PeripheralClockFreq[]
  halBackend?: string
}

/** 频率显示：整数不带小数点，最多 3 位小数（尾零自然截断）。 */
export function formatMhz(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const r = Math.round(v * 1000) / 1000
  return `${r} MHz`
}

/** 汇总某个节点上的问题级别：任一 error 即 error，否则有 warning 即 warning。 */
function issueLevelOf(issues: ClockIssue[] | undefined, node: string): 'error' | 'warning' | null {
  if (!issues?.length) return null
  let level: 'error' | 'warning' | null = null
  for (const i of issues) {
    if (i.node !== node) continue
    if (i.level === 'error') return 'error'
    level = 'warning'
  }
  return level
}

/** 合并「全局问题列表」与「外设派生问题」中属于本节点的消息（去重）。 */
function nodeIssues(id: string, issues?: ClockIssue[], extra?: ClockIssue[]): ClockIssue[] {
  const out: ClockIssue[] = []
  const seen = new Set<string>()
  for (const i of [...(issues ?? []), ...(extra ?? [])]) {
    if (i.node !== id) continue
    const key = `${i.level}:${i.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(i)
  }
  return out
}

function levelOfList(list: ClockIssue[]): 'error' | 'warning' | null {
  let level: 'error' | 'warning' | null = null
  for (const i of list) {
    if (i.level === 'error') return 'error'
    level = 'warning'
  }
  return level
}

function srcActive(cfg: ClockConfig, srcId: string): boolean {
  return cfg.source === srcId || (cfg.source === 'PLL' && (cfg.pllSource ?? '') === srcId)
}

// ---------- 列 / 分组常量（列号只在此处推导；layout 只消费 node.column） ----------

const COL_SOURCE = 0
const COL_PLL = 1
const COL_SYSTEM = 2
const COL_BUS = 3
const COL_TIM = 4
const COL_USART = 5
const COL_SPI = 6
const COL_I2C = 7
const COL_ADC = 8
const COL_USB = 9
/** M16 仅显示域列（不进 M15 列；无 diagram 回退时排在最右列） */
const COL_AUX = 10

/** 外设类别 → 列号 / 分组 id（外设节点 id='P-'+实例 id）。 */
const PERI_COLUMN: Record<'usart' | 'spi' | 'i2c' | 'adc', number> = {
  usart: COL_USART,
  spi: COL_SPI,
  i2c: COL_I2C,
  adc: COL_ADC,
}

const PERI_GROUP: Record<'usart' | 'spi' | 'i2c' | 'adc' | 'usb', string> = {
  usart: 'g-usart',
  spi: 'g-spi',
  i2c: 'g-i2c',
  adc: 'g-adc',
  usb: 'g-usb',
}

const PERI_GROUP_LABEL: Record<'usart' | 'spi' | 'i2c' | 'adc' | 'usb', string> = {
  usart: 'USART Clocks',
  spi: 'SPI Clocks',
  i2c: 'I2C Clocks',
  adc: 'ADC Clocks',
  usb: 'USB Clock',
}

/** 分频总线节点（AHB/APB1/APB2）；column/group 由调用方指定（AHB 属 System Clock 列，APB 独立成列） */
function busNode(
  id: string,
  label: string,
  field: 'ahb' | 'apb1' | 'apb2',
  div: ClockData['ahb'],
  inMhz: number,
  outMhz: number,
  cfg: ClockConfig,
  issues: ClockIssue[] | undefined,
  column: number,
  group: string,
): ClockNodeModel {
  const issueLevel = issueLevelOf(issues, id)
  const locked = isClockNodeLocked(cfg, id)
  return {
    id,
    label,
    // M16：唯一档位无分频旋钮 → 单读数卡（MX2 固定分频块）
    kind: div.options.length <= 1 ? 'readout' : 'div',
    inMhz,
    outMhz,
    maxMhz: div.maxMhz,
    issueLevel,
    overLimit: issueLevel === 'error',
    active: true,
    locked,
    // 总线节点始终支持锁定（分频档位可能唯一，但锁语义仍有效）
    lockable: true,
    control: {
      kind: 'select',
      field,
      label: '分频',
      value: cfg[field],
      options: div.options.map((o) => ({ value: o, label: `÷${o}` })),
      fixed: div.options.length <= 1 || locked,
    },
    column,
    group,
  }
}

// ---------- 外设节点辅助（M15） ----------

/** 总线节点 id（HCLK 映射到 AHB 节点、CK32M 映射到 ADC 域节点，其余同名）。 */
function busNodeId(bus: PeripheralClockBus): string {
  if (bus === 'HCLK') return 'AHB'
  if (bus === 'CK32M') return 'ADC'
  return bus
}

/** 实例的源总线（数据驱动：实例级 overrides 优先）。 */
function peripheralBus(
  category: 'usart' | 'spi' | 'i2c' | 'adc',
  iid: string,
  pc: PeripheralClocksData | undefined,
): PeripheralClockBus {
  const rate =
    category === 'usart' ? pc?.usart : category === 'spi' ? pc?.spi : category === 'i2c' ? pc?.i2c : undefined
  if (rate) return rate.sourceOverrides?.[iid] ?? rate.sourceDefault
  // ADC 实例由 ADC 域节点连出；源总线仅用于频率回退
  return pc?.adc?.source ?? 'APB2'
}

/** 总线频率（MHz）：CK32M 取 ADC 时钟域固定源频率（缺省 32）。 */
function busMhz(bus: PeripheralClockBus, freqs: ClockFrequencies, adcSpec: AdcClockSpec | undefined): number {
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
      return adcSpec?.fixedInMhz ?? 32
  }
}

/** 数字转短字符串（最多 3 位小数，尾零截断）。 */
function trimNum(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/** Hz → 原生单位标签（'8 MHz' / '400 kHz' / '115200 Hz'）。 */
function formatHzLabel(hz: number): string {
  if (hz >= 1e6) return `${trimNum(hz / 1e6)} MHz`
  if (hz >= 1e3) return `${trimNum(hz / 1e3)} kHz`
  return `${trimNum(hz)} Hz`
}

/** 外设节点的请求/实际双行标签（原生单位；数值全部来自 periFreqs）。 */
function periLabels(
  category: 'usart' | 'spi' | 'i2c' | 'adc' | 'usb',
  pf: PeripheralClockFreq | undefined,
  adcSpec: AdcClockSpec | undefined,
): { requestedLabel?: string; actualLabel?: string } {
  let requestedLabel: string | undefined
  const req = pf?.requested ?? null
  if (req !== null) {
    if (category === 'usart') {
      requestedLabel = `${req} baud`
    } else if (category === 'spi' || category === 'i2c') {
      requestedLabel = typeof req === 'number' ? formatHzLabel(req) : String(req)
    } else if (category === 'adc') {
      if (typeof req === 'string') {
        const mhz = adcSpec?.enumMhz?.[req]
        requestedLabel = mhz !== undefined ? formatMhz(mhz) : req
      } else {
        requestedLabel = `raw ${req}`
      }
    } else {
      requestedLabel = typeof req === 'number' ? `${trimNum(req)} MHz` : String(req)
    }
  }
  const actual = pf?.actualMhz ?? null
  const divider = pf?.dividerLabel ?? null
  let actualLabel: string | undefined
  // dividerLabel 已含单位/括号（如 '÷8 (BRG)' / 'BRR 250（< 0x10）'），用分隔符拼接避免括号嵌套
  if (actual !== null) actualLabel = `实际 ${formatMhz(actual)}${divider ? ` · ${divider}` : ''}`
  else if (divider) actualLabel = divider
  if (pf?.errorPct !== undefined) {
    // 误差保留两位小数（原始浮点直显会露出 0.006400409626217475% 这类噪声）
    actualLabel = `${actualLabel ? `${actualLabel} · ` : ''}误差 ${Math.abs(pf.errorPct).toFixed(2)}%`
  }
  return { requestedLabel, actualLabel }
}

/**
 * 构建时钟树逻辑模型：左列时钟源 → PLL / SYSCLK 多路复用 → AHB → APB1/APB2 → TIM / 外设时钟列。
 * 只负责节点 / 边的构成与取值，坐标与走线由 layout 层的 buildClockTree 补充。
 * peri 存在时按 peripherals.json 实例追加外设节点（USART/SPI/I2C/ADC 实例 + USB 时钟域）。
 */
export function buildClockModel(
  spec: ClockData,
  cfg: ClockConfig,
  freqs: ClockFrequencies,
  issues?: ClockIssue[],
  peri?: PeripheralClockContext,
): ClockTreeModel {
  const nodes: ClockNodeModel[] = []
  const edges: ClockEdgeModel[] = []
  const groups: ClockGroupModel[] = []

  const srcSpecs = spec.sources.filter((s) => !s.pll)
  // M16：仅显示源（LSI/LSE/CK32K 等）→ 灰 osc 块 + mux 灰行；不进 control options、边 active=false
  const displayOnlySources = srcSpecs.filter((s) => s.displayOnly)
  // 无 PLL 芯片（M14，如 X035）：不生成 PLL 分组/节点/连线
  const pllSpec = spec.pll

  const usePll = !!pllSpec && cfg.source === 'PLL'
  const pllSourceId = cfg.pllSource ?? pllSpec?.sourceOptions[0] ?? ''

  // ---------- 分组标签（节点构建后按实际成员过滤输出） ----------
  const groupLabels: Record<string, string> = {
    'g-sources': 'Clock sources',
    'g-sys': 'System Clock',
    [PERI_GROUP.usart]: PERI_GROUP_LABEL.usart,
    [PERI_GROUP.spi]: PERI_GROUP_LABEL.spi,
    [PERI_GROUP.i2c]: PERI_GROUP_LABEL.i2c,
    [PERI_GROUP.adc]: PERI_GROUP_LABEL.adc,
    [PERI_GROUP.usb]: PERI_GROUP_LABEL.usb,
    'g-aux': 'Display-only domains',
    'g-low': '低速时钟',
  }
  if (pllSpec) groupLabels['g-pll'] = `PLL Max ${pllSpec.outMaxMhz} MHz`
  const timMode = spec.timerClock ?? 'apb_x2'
  const timerLabels = spec.timerLabels ?? ['APB1 定时器', 'APB2 定时器']
  const timerOutputs = [
    { id: 'TIM1', bus: 'APB1', pclk: freqs.pclk1Mhz, outMhz: freqs.pclk1TimMhz, divider: cfg.apb1, busMax: spec.apb1.maxMhz },
    { id: 'TIM2', bus: 'APB2', pclk: freqs.pclk2Mhz, outMhz: freqs.pclk2TimMhz, divider: cfg.apb2, busMax: spec.apb2.maxMhz },
  ] as const
  groupLabels['g-out'] = '总线 / 内核输出'
  groupLabels['g-adc'] = spec.adc.maxMhz !== undefined ? `ADC Max ${spec.adc.maxMhz} MHz` : 'ADC'

  // ---------- 节点 ----------
  const auxDomains = spec.aux ?? []
  const auxIds = new Set(auxDomains.map((domain) => domain.id))
  for (const s of srcSpecs) {
    if (s.displayOnly && auxIds.has(s.id)) continue
    const out = s.hxtal ? (cfg.hxtalMhz ?? s.hxtal.default) : (s.freqMhz ?? null)
    const srcLevel = issueLevelOf(issues, s.id)
    const locked = isClockNodeLocked(cfg, s.id)
    nodes.push({
      id: s.id,
      label: s.label,
      kind: 'osc',
      ...(s.displayOnly ? { displayOnly: true } : {}),
      inMhz: null,
      outMhz: out,
      maxMhz: null,
      issueLevel: srcLevel,
      overLimit: srcLevel === 'error',
      active: srcActive(cfg, s.id),
      locked,
      lockable: isClockNodeLockable(spec, s.id),
      control: s.hxtal
        ? {
            kind: 'number',
            field: 'hxtalMhz',
            label: '晶振频率',
            value: out ?? 0,
            min: s.hxtal.min,
            max: s.hxtal.max,
            unit: 'MHz',
            fixed: locked,
          }
        : null,
      hint: s.hxtal ? `范围 ${s.hxtal.min}~${s.hxtal.max} MHz` : undefined,
      column: COL_SOURCE,
      group: 'g-sources',
    })
  }

  // PLL（倍频下拉；数据层 fixed 时置灰）。即使当前未选用 PLL，也显示其潜在输出（置灰态），
  // 便于用户判断切到 PLL 后的频率。
  const directSrc = spec.sources.find((s) => s.id === cfg.source)
  const inactivePllHint = directSrc?.sysclkDividerParam ? 'SYSCLK 共用分频' : '未使用'
  if (pllSpec) {
    const pllLabel = spec.sources.find((s) => s.pll)?.label ?? 'PLL'
    const pllInShown = sourceFreqMhz(spec, pllSourceId, cfg)
    const pllOutShown = pllInShown === null ? null : pllOutMhz(spec, pllInShown, cfg.pll ?? {})
    const pllLevel = issueLevelOf(issues, 'PLL')
    const pllLocked = isClockNodeLocked(cfg, 'PLL')
    const pllControls: ClockNodeControl[] = pllSpec.params.map((param) => ({
      kind: 'select',
      field: 'pll',
      pllKey: param.key,
      label: param.label,
      value: cfg.pll?.[param.key] ?? param.default,
      options: param.options.map((value) => ({ value, label: `${param.key === 'mul' ? '×' : '÷'}${value}` })),
      fixed: param.fixed || param.options.length <= 1 || pllLocked,
    }))
    nodes.push({
      id: 'PLL',
      label: pllLabel,
      kind: 'pll',
      // PLL 的 mux 是 pllSource 选择（control.options 是本参数档位，不是源 id）：
      // 锚点行序=sourceOptions（RM 保真：LSI/LSE/CK32K 不是 PLL 输入，不画假灰行）。
      muxInputs: [...pllSpec.sourceOptions],
      inMhz: pllInShown,
      outMhz: pllOutShown,
      maxMhz: pllSpec.outMaxMhz,
      issueLevel: pllLevel,
      overLimit: pllLevel === 'error',
      active: usePll,
      locked: pllLocked,
      lockable: isClockNodeLockable(spec, 'PLL'),
      control: pllControls[0] ?? null,
      pllControls,
      hint: usePll ? undefined : inactivePllHint,
      column: COL_PLL,
      group: 'g-pll',
    })
  }

  // SYSCLK（源选择）
  const sysIn = usePll
    ? freqs.pllOutMhz
    : directSrc
      ? directSrc.hxtal
        ? (cfg.hxtalMhz ?? directSrc.hxtal.default)
        : (directSrc.freqMhz ?? null)
      : null
  const sysLevel = issueLevelOf(issues, 'SYSCLK')
  const sysLocked = isClockNodeLocked(cfg, 'SYSCLK')
  // M16：仅显示源灰行追加在可选源之后（mux 锚点行序），但不进 control options
  const sysSourceOptions = spec.sources
    .filter((s) => !s.displayOnly)
    .map((s) => ({ value: s.id, label: s.label }))
  const sysMuxInputs = sysSourceOptions.map((option) => option.value)
  const hsiRow = sysMuxInputs.indexOf('HSI')
  const hseRow = sysMuxInputs.indexOf('HSE')
  if (hsiRow >= 0 && hseRow > hsiRow) {
    // 把外部晶振放在 HSI 上方，只调整图上接线端口的顺序。
    sysMuxInputs.splice(hseRow, 1)
    sysMuxInputs.splice(hsiRow, 0, 'HSE')
  }
  const pllRow = sysMuxInputs.indexOf('PLL')
  if (pllRow > 0) {
    sysMuxInputs.splice(pllRow, 1)
    sysMuxInputs.unshift('PLL')
  }
  nodes.push({
    id: 'SYSCLK',
    label: 'SYSCLK',
    kind: 'mux',
    // RM 保真：仅 sysclkMuxInput 的 displayOnly 源（CH582 CK32K）画灰行；LSI/LSE 非 mux 输入不画
    muxInputs: [
      ...sysMuxInputs,
      ...displayOnlySources.filter((s) => s.sysclkMuxInput).map((s) => s.id),
    ],
    inMhz: sysIn,
    outMhz: freqs.sysclkMhz,
    maxMhz: spec.sysclkMaxMhz,
    issueLevel: sysLevel,
    overLimit: sysLevel === 'error',
    active: true,
    locked: sysLocked,
    lockable: isClockNodeLockable(spec, 'SYSCLK'),
    control: {
      kind: 'select',
      field: 'source',
      label: '时钟源',
      value: cfg.source,
      options: sysSourceOptions,
      fixed: sysLocked,
    },
    column: COL_SYSTEM,
    group: 'g-sys',
  })

  // 总线
  const hasApbDomains = spec.apbClockDomains !== false
  nodes.push(busNode('AHB', 'AHB', 'ahb', spec.ahb, freqs.sysclkMhz, freqs.hclkMhz, cfg, issues, COL_SYSTEM, 'g-sys'))
  if (hasApbDomains) {
    nodes.push(
      busNode('APB1', 'APB1', 'apb1', spec.apb1, freqs.hclkMhz, freqs.pclk1Mhz, cfg, issues, COL_BUS, 'g-out'),
      busNode('APB2', 'APB2', 'apb2', spec.apb2, freqs.hclkMhz, freqs.pclk2Mhz, cfg, issues, COL_BUS, 'g-out'),
    )
  }

  // ADC 域（时钟源来自 spec.adc.options；CK32M 为 CH58x 固定 32MHz 域）
  const adcOpt = adcClockOption(spec, cfg)
  const adcBase = adcInputMhz(spec, adcOpt.source, freqs)
  const adcLevel = issueLevelOf(issues, 'ADC')
  const adcLocked = isClockNodeLocked(cfg, 'ADC')
  const adcPrescaler = spec.adc.prescaler
  const systemAdcRawDivider = adcOpt.source === 'SYSCLK' && spec.peripheralClocks?.adc?.clkDiv?.raw
  nodes.push({
    id: 'ADC',
    // CH582 单 ADC 实例 id 即 'ADC'，与域节点同名会混淆 → 域节点改称「ADC 域」（数据驱动，非芯片硬编码）
    label: adcPrescaler?.label ?? (peri?.peripherals?.adc?.some((i) => i.id === 'ADC') ? 'ADC 域' : 'ADC'),
    kind: 'mux',
    // ADC mux 的输入是数据层 adc 选项 id（分频档位，非时钟源）：仅显示源不追加灰行
    muxInputs: spec.adc.options.map((o) => String(o.id)),
    inMhz: adcBase,
    outMhz: systemAdcRawDivider ? null : freqs.adcMhz,
    outputLabel: adcPrescaler ? 'ADCCLK' : undefined,
    hint: adcPrescaler?.note ?? (systemAdcRawDivider ? spec.peripheralClocks?.adc?.clkDiv?.note : undefined),
    maxMhz: spec.adc.maxMhz ?? null,
    issueLevel: adcLevel,
    overLimit: adcLevel === 'error',
    active: true,
    locked: adcLocked,
    lockable: isClockNodeLockable(spec, 'ADC'),
    control: {
      kind: 'select',
      field: 'adc',
      label: adcPrescaler ? '分频' : '时钟源',
      value: cfg.adc ?? spec.adc.default,
      options: spec.adc.options.map((o) => ({ value: o.id, label: o.label })),
      fixed: spec.adc.options.length <= 1 || adcLocked,
    },
    column: COL_ADC,
    group: 'g-out',
  })

  // ---------- 连线（逻辑；正交折线由 layout 生成） ----------
  const edge = (id: string, from: string, to: string, active: boolean, label?: string, inputIndex?: number) => {
    edges.push({ id, from, to, active, label, ...(inputIndex === undefined ? {} : { inputIndex }) })
  }

  for (const s of srcSpecs) {
    // M16 RM 保真：非 mux 输入的 displayOnly 源（LSI/LSE）在 RM 中无通往 SYSCLK/PLL 的路径 → 不画灰边；
    // 其仅供 aux 域（IWDG/RTC）引用。sysclkMuxInput（CH582 CK32K）保留灰边+灰行，永不激活。
    if (s.displayOnly && !s.sysclkMuxInput) continue
    const selectable = !s.displayOnly
    if (pllSpec && !s.displayOnly) edge(`src-${s.id}-pll`, s.id, 'PLL', selectable && usePll && pllSourceId === s.id)
    const divider = sysclkSourceDivider(spec, s.id, cfg)
    edge(`src-${s.id}-sys`, s.id, 'SYSCLK', selectable && cfg.source === s.id, divider === undefined ? undefined : `÷${divider}`)
  }
  if (pllSpec) edge('pll-sys', 'PLL', 'SYSCLK', usePll)

  edge('sys-ahb', 'SYSCLK', 'AHB', true, `÷${cfg.ahb}`)
  if (hasApbDomains) {
    edge('ahb-apb1', 'AHB', 'APB1', true, `÷${cfg.apb1}`)
    edge('ahb-apb2', 'AHB', 'APB2', true, `÷${cfg.apb2}`)
  }

  // 输出编号供布局使用，显示名称来自芯片的实际定时器分组。
  for (const [index, label] of timerLabels.entries()) {
    if (!label) continue
    const timer = timerOutputs[index]!
    const from = timMode === 'sysclk' ? 'SYSCLK' : timMode === 'hclk' ? 'AHB' : timer.bus
    const sourceLabel = from === 'AHB' ? 'HCLK' : from.replace('APB', 'PCLK')
    const factor = timer.divider > 1 ? '×2' : '×1'
    const level = issueLevelOf(issues, timer.id)
    nodes.push({
      id: timer.id,
      label,
      kind: 'readout',
      inMhz: timMode === 'apb_x2' ? timer.pclk : timer.outMhz,
      inputClockLabel: sourceLabel,
      outMhz: timer.outMhz,
      maxMhz: timMode === 'apb_x2' ? timer.busMax * 2 : timMode === 'hclk' ? spec.ahb.maxMhz : spec.sysclkMaxMhz,
      issueLevel: level,
      overLimit: level === 'error',
      active: true,
      locked: isClockNodeLocked(cfg, timer.id),
      lockable: isClockNodeLockable(spec, timer.id),
      control: null,
      hint: timMode === 'apb_x2' ? factor : `${sourceLabel} 直通`,
      column: COL_TIM,
      group: 'g-out',
    })
    edge(`${from.toLowerCase()}-${timer.id.toLowerCase()}`, from, timer.id, true, timMode === 'apb_x2' ? factor : undefined)
  }

  // ADC：按数据里的时钟源选出发节点与走线。
  const adcLabel = `÷${adcOpt.div}`
  const adcInput = spec.adc.options.indexOf(adcOpt)
  if (adcOpt.source === 'SYSCLK') {
    edge('sys-adc', 'SYSCLK', 'ADC', true, adcLabel, adcInput)
  } else if (adcOpt.source === 'AHB') {
    edge('ahb-adc', 'AHB', 'ADC', true, adcLabel, adcInput)
  } else if (adcOpt.source === 'APB1') {
    edge('apb1-adc', 'APB1', 'ADC', true, adcLabel, adcInput)
  } else if (adcOpt.source === 'CK32M') {
    if (spec.adc.fixedSource) edge('fixed-adc', spec.adc.fixedSource, 'ADC', true, undefined, adcInput)
  } else {
    edge('apb2-adc', 'APB2', 'ADC', true, adcLabel, adcInput)
  }

  // ---------- 外设节点（M15；periFreqs 由 A 域 model/clock/peripheral.ts 计算后传入） ----------
  const pc: PeripheralClocksData | undefined = spec.peripheralClocks
  const freqById = new Map((peri?.periFreqs ?? []).map((f) => [f.nodeId, f]))
  const adcClkSpec = pc?.adc

  /** 单个外设实例节点（usart/spi/i2c：periParam 旋钮；adc：adcClkDiv / knob / 只读） */
  const makePeriNode = (
    category: 'usart' | 'spi' | 'i2c' | 'adc',
    iid: string,
    instParams: Record<string, ParamSpec>,
  ): ClockNodeModel => {
    const nodeId = `P-${iid}`
    const pf = freqById.get(nodeId)
    const st = peri?.state?.[iid]
    const bus = peripheralBus(category, iid, pc)

    let control: ClockNodeControl | null = null
    let badge: ClockNodeBadge = 'fixed'

    if (category === 'adc') {
      const clkDiv = adcClkSpec?.clkDiv
      if (clkDiv?.programmable) {
        // CTLR3.CLK_DIV raw 寄存器值（ClockConfig 全局单值；ADC 节点锁定时置灰）
        const maxRaw = 2 ** clkDiv.bits - 1
        control = {
          kind: 'select',
          field: 'adcClkDiv',
          label: 'CTLR3.CLK_DIV',
          value: cfg.adcClkDiv ?? clkDiv.default,
          options: Array.from({ length: maxRaw + 1 }, (_, n) => ({
            value: n,
            label: `raw ${n} (0b${n.toString(2).padStart(clkDiv.bits, '0')})`,
          })),
          min: 0,
          max: maxRaw,
          fixed: adcLocked,
        }
        badge = 'raw'
      } else if (adcClkSpec?.knob) {
        // CH582：旋钮镜像外设参数（samplingClock）
        control = periParamControl(iid, adcClkSpec.knob, instParams[adcClkSpec.knob], st)
      }
    } else {
      const rate = category === 'usart' ? pc?.usart : category === 'spi' ? pc?.spi : pc?.i2c
      if (rate) control = periParamControl(iid, rate.knob, instParams[rate.knob], st)
    }

    // 上限：SPI = 源总线/2（BRG 最小 ÷2）；I2C = SCL 上限；ADC = 芯片 ADC 上限；USART 无
    let maxMhz: number | null = null
    if (category === 'spi') maxMhz = busMhz(bus, freqs, adcClkSpec) / 2
    else if (category === 'i2c') maxMhz = pc?.i2c ? pc.i2c.maxKhz / 1000 : null
    else if (category === 'adc') maxMhz = spec.adc.maxMhz ?? null

    const list = nodeIssues(nodeId, issues, pf?.issues)
    const labels = periLabels(category, pf, adcClkSpec)
    return {
      id: nodeId,
      label: iid,
      kind: 'peri',
      inMhz: pf?.inMhz ?? (category === 'adc' && bus !== 'CK32M' && !systemAdcRawDivider
        ? freqs.adcMhz : busMhz(bus, freqs, adcClkSpec)),
      inputClockLabel: category === 'adc' && bus !== 'CK32M' && !systemAdcRawDivider ? 'ADC 时钟域' : bus,
      // ADC raw 级不编造频率（periFreqs.actualMhz=null）
      outMhz: pf?.actualMhz ?? null,
      maxMhz,
      issueLevel: levelOfList(list),
      overLimit: levelOfList(list) === 'error',
      // 未启用实例仍渲染（dim），由视图层据 active 降透明度
      active: !!st?.enabled,
      locked: false,
      lockable: false,
      control,
      column: PERI_COLUMN[category],
      group: PERI_GROUP[category],
      badge,
      periId: iid,
      ...(list.length ? { issues: list } : {}),
      ...(labels.requestedLabel !== undefined ? { requestedLabel: labels.requestedLabel } : {}),
      ...(labels.actualLabel !== undefined ? { actualLabel: labels.actualLabel } : {}),
      ...(pf?.dividerLabel ? { hint: pf.dividerLabel } : {}),
    }
  }

  if (peri?.peripherals) {
    const cats: { category: 'usart' | 'spi' | 'i2c' | 'adc'; list: { id: string; params: Record<string, ParamSpec> }[] }[] = [
      { category: 'usart', list: peri.peripherals.usart ?? [] },
      { category: 'spi', list: peri.peripherals.spi ?? [] },
      { category: 'i2c', list: peri.peripherals.i2c ?? [] },
      { category: 'adc', list: peri.peripherals.adc ?? [] },
    ]
    for (const { category, list } of cats) {
      for (const inst of list) {
        const node = makePeriNode(category, inst.id, inst.params ?? {})
        nodes.push(node)
        // 边：bus → 外设（ADC 实例由 ADC 域节点连出；HCLK 落 AHB 节点、CK32M 落 ADC 域）
        const from = category === 'adc' ? 'ADC' : busNodeId(peripheralBus(category, inst.id, pc))
        edges.push({ id: `peri-${node.id}`, from, to: node.id, active: node.active })
      }
    }
  }

  // USB 时钟域：有自动分频级时显示 PLL → USBPRE → USBCLK，直连芯片保留固定频率。
  const usbSpec = pc?.usb
  const usbPrescaler = pllSpec && usbSpec && usbSpec.fixedMhz === undefined
    ? auxDomains.find((domain) => domain.id === 'USBPRE')
    : undefined
  if (usbSpec) {
    const pf = freqById.get('USB')
    const list = nodeIssues('USB', issues, pf?.issues)
    const labels = periLabels('usb', pf, adcClkSpec)
    const fixedSource = usbSpec.fixedMhz === undefined ? undefined : usbSpec.fixedSource ?? 'HSI'
    const inputMhz = (pf?.inMhz ?? usbSpec.fixedMhz ?? freqs.pllOutMhz) || null
    const outputMhz = pf?.actualMhz ?? usbSpec.fixedMhz ?? null
    if (usbPrescaler) {
      const divisor = outputMhz !== null && inputMhz !== null ? usbSpec.autoPre[String(inputMhz)] : undefined
      nodes.push({
        id: usbPrescaler.id,
        label: usbPrescaler.label,
        kind: 'readout',
        inMhz: inputMhz,
        outMhz: outputMhz,
        readoutText: divisor === undefined ? '—' : `÷${divisor}`,
        maxMhz: null,
        issueLevel: null,
        overLimit: false,
        active: inputMhz !== null,
        locked: false,
        lockable: false,
        control: null,
        hint: usbPrescaler.note,
        column: COL_USB,
        group: usbPrescaler.group ?? 'g-aux',
        badge: 'derived',
        displayOnly: true,
      })
      edge('pll-usbpre', 'PLL', usbPrescaler.id, inputMhz !== null)
      edge('usbpre-usb', usbPrescaler.id, 'USB', outputMhz !== null)
    }
    nodes.push({
      id: 'USB',
      label: 'USBCLK',
      kind: 'readout',
      inMhz: usbPrescaler ? outputMhz : inputMhz,
      inputClockLabel: usbPrescaler?.id ?? fixedSource,
      outMhz: outputMhz,
      maxMhz: usbSpec.fixedMhz ?? 48,
      issueLevel: levelOfList(list),
      overLimit: levelOfList(list) === 'error',
      active: true,
      locked: false,
      lockable: false,
      control: null,
      column: COL_USB,
      group: 'g-out',
      badge: 'derived',
      periId: 'USB',
      ...(list.length ? { issues: list } : {}),
      ...(labels.requestedLabel !== undefined ? { requestedLabel: labels.requestedLabel } : {}),
      ...(labels.actualLabel !== undefined ? { actualLabel: labels.actualLabel } : {}),
    })
    if (fixedSource) edge('src-usb', fixedSource, 'USB', true)
    else if (pllSpec && !usbPrescaler) edge('pll-usb', 'PLL', 'USB', true, pf?.dividerLabel ?? undefined)
  }

  // ---------- M16 仅显示域（aux：RM 框图有、模型/代码生成不覆盖） ----------
  // badge='derived' + displayOnly=true + control=null + 不可锁 + active=true；边 active=false（灰线）。
  for (const a of auxDomains) {
    if (a === usbPrescaler) continue
    const div = a.deriveDivByBackend?.[peri?.halBackend ?? ''] ?? a.deriveDiv ?? 1
    const divLabel = a.deriveDivByBackend ? `÷${div}` : a.fixedDivLabel
    const hint = [divLabel, a.note].filter((s) => !!s).join(' · ')
    const fixed = a.fixedMhz ?? null
    // D12：readout 单输入派生行（CORE/SYSTICK/V5F/V3F）——fixedMhz 优先；
    // 否则取输入节点 outMhz ÷ deriveDiv（缺省 1），badge=derived 仅显示不生成
    let inMhz = fixed
    let outMhz = fixed
    if (fixed === null && a.kind === 'readout' && a.inputs?.length === 1) {
      const src = nodes.find((n) => n.id === a.inputs![0]!.id)
      if (src && src.outMhz !== null) {
        inMhz = src.outMhz
        outMhz = src.outMhz / div
      }
    }
    const muxKind = a.kind === 'mux' || a.kind === 'pll'
    nodes.push({
      id: a.id,
      label: a.label,
      kind: a.kind,
      ...(muxKind
        ? {
            muxInputs: (a.inputs ?? []).map((i) => i.id),
            // RM 文案（如 'PLL3÷2'/'HSE÷128'）：渲染层 mux 行标签优先取此，缺省回退 id
            muxLabels: (a.inputs ?? []).map((i) => i.label),
          }
        : {}),
      inMhz,
      outMhz,
      maxMhz: a.maxMhz ?? null,
      issueLevel: null,
      overLimit: false,
      active: true,
      locked: false,
      lockable: false,
      control: null,
      ...(hint ? { hint } : {}),
      column: COL_AUX,
      group: a.group ?? 'g-aux',
      badge: 'derived',
      displayOnly: true,
    })
    const seenInputs = new Map<string, number>()
    for (const [inputIndex, inp] of (a.inputs ?? []).entries()) {
      // 同源多行（如 MCO 的 PLL3 与 PLL3÷2）：重复边 id 加行序后缀，避免 Vue :key 重复
      const n = seenInputs.get(inp.id) ?? 0
      seenInputs.set(inp.id, n + 1)
      const label = a.kind === 'readout' && div > 1 ? `÷${div}` : undefined
      edges.push({ id: `aux-${a.id}-${inp.id}${n > 0 ? `-${n}` : ''}`, from: inp.id, to: a.id, active: false, label, ...(muxKind ? { inputIndex } : {}) })
    }
  }

  // ---------- diagram 图元与分组覆盖 ----------
  const diagramNodes = spec.diagram?.nodes
  if (diagramNodes) {
    for (const n of nodes) {
      const override = diagramNodes[n.id]
      if (override?.kind) n.kind = override.kind
      if (override?.group) n.group = override.group
    }
  }
  // mux/pll kind 节点必须带 muxInputs（含灰行）；diagram 把其它节点覆盖成 mux/pll 时用入边来源兜底
  for (const n of nodes) {
    if (n.kind !== 'mux' && n.kind !== 'pll') continue
    if (!n.muxInputs) n.muxInputs = edges.filter((e) => e.to === n.id).map((e) => e.from)
  }

  // 核心节点：把全局问题列表按节点归属挂到节点上（hover 全量消息；外设节点已自带合并列表）
  for (const n of nodes) {
    if (n.issues?.length) continue
    const list = (issues ?? []).filter((i) => i.node === n.id)
    if (list.length) n.issues = list
  }

  // ---------- 分组容器（仅保留有成员的组，顺序固定） ----------
  const groupOrder = ['g-sources', 'g-pll', 'g-sys', 'g-out', PERI_GROUP.adc, PERI_GROUP.usart, PERI_GROUP.spi, PERI_GROUP.i2c, 'g-aux', 'g-low']
  for (const gid of groupOrder) {
    if (!nodes.some((n) => n.group === gid)) continue
    groups.push({ id: gid, label: groupLabels[gid] ?? gid })
  }

  return { nodes, edges, groups }
}
