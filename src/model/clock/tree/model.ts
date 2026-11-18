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
import { isClockNodeLockable, isClockNodeLocked, pllOutMhz, sourceFreqMhz } from '@/model/clock'

export interface ClockNodeControlOption {
  value: string | number
  label: string
}

/** 控件可写回的配置字段；periParam 表示外设参数（写回工程 peripherals 状态，由视图层路由）。 */
export type ClockNodeControlField =
  | 'source'
  | 'pllSource'
  | 'hxtalMhz'
  | 'adc'
  | 'ahb'
  | 'apb1'
  | 'apb2'
  | 'pll'
  | 'adcClkDiv'
  | 'periParam'

/** 节点内嵌控件描述（画布下拉弹层与详情面板共用） */
export interface ClockNodeControl {
  kind: 'select' | 'number'
  /** 对应 ClockConfig 的字段；pll 参数用 field='pll' + pllKey；外设参数用 field='periParam' + periId/paramKey */
  field: ClockNodeControlField
  /** field === 'pll' 时的参数 key */
  pllKey?: string
  /** field === 'periParam' 时的外设实例 id（peripherals.json） */
  periId?: string
  /** field === 'periParam' 时写回的外设参数 key（ParamSpec key） */
  paramKey?: string
  label: string
  value: string | number
  options?: ClockNodeControlOption[]
  /** 固定值（数据层 fixed 或唯一档位）：UI 置灰不可改 */
  fixed?: boolean
  min?: number
  max?: number
  unit?: string
}

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
  /** 分组容器 id（g-sources/g-pll/g-sys/g-tim/g-adc/g-usart/g-spi/g-i2c/g-usb；''=不进分组框） */
  group: string
  badge?: ClockNodeBadge
  /** 外设节点对应的 peripherals.json 实例 id（USB 域节点='USB'） */
  periId?: string
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

/** ParamSpec → 控件类型（数据层 kind 优先；缺省按有无 options 推断）。 */
function paramKind(ps: ParamSpec | undefined): 'select' | 'number' {
  if (ps?.kind === 'select' || ps?.kind === 'number') return ps.kind
  return ps?.options?.length ? 'select' : 'number'
}

/** 读取外设参数当前值（工程状态优先，缺省回退 ParamSpec.default）。 */
function paramValue(state: PeripheralState | undefined, key: string, ps: ParamSpec | undefined): string | number {
  const v = state?.params?.[key]
  if (typeof v === 'string' || typeof v === 'number') return v
  const d = ps?.default
  return typeof d === 'string' || typeof d === 'number' ? d : 0
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

/** 外设控件的公共部分（periParam：外设参数旋钮）。 */
function periParamControl(
  iid: string,
  key: string,
  ps: ParamSpec | undefined,
  state: PeripheralState | undefined,
): ClockNodeControl {
  const kind = paramKind(ps)
  return {
    kind,
    field: 'periParam',
    periId: iid,
    paramKey: key,
    label: ps?.label ?? key,
    value: paramValue(state, key, ps),
    ...(kind === 'select'
      ? { options: (ps?.options ?? []).map((o) => ({ value: o, label: String(o) })) }
      : { ...(ps?.min !== undefined ? { min: ps.min } : {}), ...(ps?.max !== undefined ? { max: ps.max } : {}) }),
  }
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
  }
  if (pllSpec) groupLabels['g-pll'] = `PLL Max ${pllSpec.outMaxMhz} MHz`
  const timMode = spec.timerClock ?? 'apb_x2'
  const tim1Max = timMode === 'sysclk' ? spec.sysclkMaxMhz : spec.apb1.maxMhz * 2
  const tim2Max = timMode === 'sysclk' ? spec.sysclkMaxMhz : spec.apb2.maxMhz * 2
  groupLabels['g-tim'] = `TIM Max ${tim1Max} MHz`
  groupLabels['g-adc'] = spec.adc.maxMhz !== undefined ? `ADC Max ${spec.adc.maxMhz} MHz` : 'ADC'

  // ---------- 节点 ----------
  for (const s of srcSpecs) {
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
  if (pllSpec) {
    const pllLabel = spec.sources.find((s) => s.pll)?.label ?? 'PLL'
    const firstParam = pllSpec.params[0]
    const pllInShown = sourceFreqMhz(spec, pllSourceId, cfg)
    const pllOutShown = pllInShown === null ? null : pllOutMhz(spec, pllInShown, cfg.pll ?? {})
    const pllLevel = issueLevelOf(issues, 'PLL')
    const pllLocked = isClockNodeLocked(cfg, 'PLL')
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
      control: firstParam
        ? {
            kind: 'select',
            field: 'pll',
            pllKey: firstParam.key,
            label: firstParam.label,
            value: cfg.pll?.[firstParam.key] ?? firstParam.default,
            options: firstParam.options.map((o) => ({
              value: o,
              label: pllSpec.fixedOutMhz !== undefined ? `÷${o}` : `×${o}`,
            })),
            fixed: firstParam.fixed || firstParam.options.length <= 1 || pllLocked,
          }
        : null,
      // M16：完整参数链供 pll 簇 stepper 链渲染（布局槽位数=pllSpec.params.length，二者一致）
      pllControls: pllSpec.params.map((p) => ({
        kind: 'select' as const,
        field: 'pll' as const,
        pllKey: p.key,
        label: p.label,
        value: cfg.pll?.[p.key] ?? p.default,
        options: p.options.map((o) => ({ value: o, label: pllSpec.fixedOutMhz !== undefined ? `÷${o}` : `×${o}` })),
        fixed: p.fixed || p.options.length <= 1 || pllLocked,
      })),
      hint: usePll ? undefined : '未使用',
      column: COL_PLL,
      group: 'g-pll',
    })
  }

  // SYSCLK（源选择）
  const directSrc = spec.sources.find((s) => s.id === cfg.source)
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
  nodes.push({
    id: 'SYSCLK',
    label: 'SYSCLK',
    kind: 'mux',
    // RM 保真：仅 sysclkMuxInput 的 displayOnly 源（CH582 CK32K）画灰行；LSI/LSE 非 mux 输入不画
    muxInputs: [
      ...sysSourceOptions.map((o) => String(o.value)),
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
  nodes.push(
    busNode('AHB', 'AHB', 'ahb', spec.ahb, freqs.sysclkMhz, freqs.hclkMhz, cfg, issues, COL_SYSTEM, 'g-sys'),
    busNode('APB1', 'APB1', 'apb1', spec.apb1, freqs.hclkMhz, freqs.pclk1Mhz, cfg, issues, COL_BUS, ''),
    busNode('APB2', 'APB2', 'apb2', spec.apb2, freqs.hclkMhz, freqs.pclk2Mhz, cfg, issues, COL_BUS, ''),
  )

  // 定时器域（模式由 spec.timerClock 决定：sysclk 直通 / APB 分频>1 时 ×2）
  const timHint = timMode === 'sysclk' ? 'SYSCLK 直通' : undefined
  const tim1Level = issueLevelOf(issues, 'TIM1')
  nodes.push({
    id: 'TIM1',
    label: 'TIM1',
    kind: 'readout',
    inMhz: freqs.pclk1Mhz,
    outMhz: freqs.pclk1TimMhz,
    maxMhz: tim1Max,
    issueLevel: tim1Level,
    overLimit: tim1Level === 'error',
    active: true,
    locked: isClockNodeLocked(cfg, 'TIM1'),
    lockable: isClockNodeLockable(spec, 'TIM1'),
    control: null,
    hint: timMode === 'sysclk' ? timHint : cfg.apb1 > 1 ? '×2' : '×1',
    column: COL_TIM,
    group: 'g-tim',
  })
  const tim2Level = issueLevelOf(issues, 'TIM2')
  nodes.push({
    id: 'TIM2',
    label: 'TIM2',
    kind: 'readout',
    inMhz: freqs.pclk2Mhz,
    outMhz: freqs.pclk2TimMhz,
    maxMhz: tim2Max,
    issueLevel: tim2Level,
    overLimit: tim2Level === 'error',
    active: true,
    locked: isClockNodeLocked(cfg, 'TIM2'),
    lockable: isClockNodeLockable(spec, 'TIM2'),
    control: null,
    hint: timMode === 'sysclk' ? timHint : cfg.apb2 > 1 ? '×2' : '×1',
    column: COL_TIM,
    group: 'g-tim',
  })

  // ADC 域（时钟源来自 spec.adc.options；CK32M 为 CH58x 固定 32MHz 域）
  const adcOpt = spec.adc.options.find((o) => o.id === (cfg.adc ?? spec.adc.default)) ?? spec.adc.options[0]!
  const adcBase =
    adcOpt.source === 'SYSCLK'
      ? freqs.sysclkMhz
      : adcOpt.source === 'AHB'
        ? freqs.hclkMhz
        : adcOpt.source === 'APB1'
          ? freqs.pclk1Mhz
          : adcOpt.source === 'CK32M'
            ? spec.peripheralClocks?.adc?.fixedInMhz ?? 32
            : freqs.pclk2Mhz
  const adcLevel = issueLevelOf(issues, 'ADC')
  const adcLocked = isClockNodeLocked(cfg, 'ADC')
  nodes.push({
    id: 'ADC',
    // CH582 单 ADC 实例 id 即 'ADC'，与域节点同名会混淆 → 域节点改称「ADC 域」（数据驱动，非芯片硬编码）
    label: peri?.peripherals?.adc?.some((i) => i.id === 'ADC') ? 'ADC 域' : 'ADC',
    kind: 'mux',
    // ADC mux 的输入是数据层 adc 选项 id（分频档位，非时钟源）：仅显示源不追加灰行
    muxInputs: spec.adc.options.map((o) => String(o.id)),
    inMhz: adcBase,
    outMhz: freqs.adcMhz,
    maxMhz: spec.adc.maxMhz ?? null,
    issueLevel: adcLevel,
    overLimit: adcLevel === 'error',
    active: true,
    locked: adcLocked,
    lockable: isClockNodeLockable(spec, 'ADC'),
    control: {
      kind: 'select',
      field: 'adc',
      label: '时钟源',
      value: cfg.adc ?? spec.adc.default,
      options: spec.adc.options.map((o) => ({ value: o.id, label: o.label })),
      fixed: spec.adc.options.length <= 1 || adcLocked,
    },
    column: COL_ADC,
    group: 'g-adc',
  })

  // ---------- 连线（逻辑；正交折线由 layout 生成） ----------
  const edge = (id: string, from: string, to: string, active: boolean, label?: string) => {
    edges.push({ id, from, to, active, label })
  }

  for (const s of srcSpecs) {
    // M16 RM 保真：非 mux 输入的 displayOnly 源（LSI/LSE）在 RM 中无通往 SYSCLK/PLL 的路径 → 不画灰边；
    // 其仅供 aux 域（IWDG/RTC）引用。sysclkMuxInput（CH582 CK32K）保留灰边+灰行，永不激活。
    if (s.displayOnly && !s.sysclkMuxInput) continue
    const selectable = !s.displayOnly
    if (pllSpec && !s.displayOnly) edge(`src-${s.id}-pll`, s.id, 'PLL', selectable && usePll && pllSourceId === s.id)
    edge(`src-${s.id}-sys`, s.id, 'SYSCLK', selectable && cfg.source === s.id)
  }
  if (pllSpec) edge('pll-sys', 'PLL', 'SYSCLK', usePll)

  edge('sys-ahb', 'SYSCLK', 'AHB', true, `÷${cfg.ahb}`)
  edge('ahb-apb1', 'AHB', 'APB1', true, `÷${cfg.apb1}`)
  edge('ahb-apb2', 'AHB', 'APB2', true, `÷${cfg.apb2}`)

  // 定时器域：APB 出口
  edge(
    'apb1-tim1',
    'APB1',
    'TIM1',
    true,
    timMode === 'sysclk' ? 'SYSCLK' : cfg.apb1 > 1 ? '×2' : '×1',
  )
  edge(
    'apb2-tim2',
    'APB2',
    'TIM2',
    true,
    timMode === 'sysclk' ? 'SYSCLK' : cfg.apb2 > 1 ? '×2' : '×1',
  )

  // ADC：按数据里的时钟源选出发节点与走线；CK32M 为独立固定域（不伪造上游）
  const adcLabel = `÷${adcOpt.div}`
  if (adcOpt.source === 'SYSCLK') {
    edge('sys-adc', 'SYSCLK', 'ADC', true, adcLabel)
  } else if (adcOpt.source === 'AHB') {
    edge('ahb-adc', 'AHB', 'ADC', true, adcLabel)
  } else if (adcOpt.source === 'APB1') {
    edge('apb1-adc', 'APB1', 'ADC', true, adcLabel)
  } else if (adcOpt.source !== 'CK32M') {
    edge('apb2-adc', 'APB2', 'ADC', true, adcLabel)
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
      inMhz: pf?.inMhz ?? busMhz(bus, freqs, adcClkSpec),
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

  // USB 时钟域（仅显示 + 警告，无生成）：PLL → USB；无 PLL 芯片（X035 HSI 直连）不画上游边
  const usbSpec = pc?.usb
  if (usbSpec) {
    const pf = freqById.get('USB')
    const list = nodeIssues('USB', issues, pf?.issues)
    const labels = periLabels('usb', pf, adcClkSpec)
    nodes.push({
      id: 'USB',
      label: 'USB',
      kind: 'readout',
      // 非 PLL 源时 peripheral.ts 以 0 表「无时钟」（类型约束）→ 显示层归一为 null（—），不误导为 0 MHz
      inMhz: (pf?.inMhz ?? freqs.pllOutMhz) || null,
      outMhz: pf?.actualMhz ?? null,
      maxMhz: usbSpec.fixedMhz ?? 48,
      issueLevel: levelOfList(list),
      overLimit: levelOfList(list) === 'error',
      active: true,
      locked: false,
      lockable: false,
      control: null,
      column: COL_USB,
      group: PERI_GROUP.usb,
      badge: 'derived',
      periId: 'USB',
      ...(list.length ? { issues: list } : {}),
      ...(labels.requestedLabel !== undefined ? { requestedLabel: labels.requestedLabel } : {}),
      ...(labels.actualLabel !== undefined ? { actualLabel: labels.actualLabel } : {}),
    })
    if (pllSpec) edge('pll-usb', 'PLL', 'USB', true, pf?.dividerLabel ?? undefined)
  }

  // ---------- M16 仅显示域（aux：RM 框图有、模型/代码生成不覆盖） ----------
  // badge='derived' + displayOnly=true + control=null + 不可锁 + active=true；边 active=false（灰线）。
  for (const a of spec.aux ?? []) {
    const hint = [a.fixedDivLabel, a.note].filter((s) => !!s).join(' · ')
    const fixed = a.fixedMhz ?? null
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
      inMhz: fixed,
      outMhz: fixed,
      maxMhz: a.maxMhz ?? null,
      issueLevel: null,
      overLimit: false,
      active: true,
      locked: false,
      lockable: false,
      control: null,
      ...(hint ? { hint } : {}),
      column: COL_AUX,
      group: 'g-aux',
      badge: 'derived',
      displayOnly: true,
    })
    const seenInputs = new Map<string, number>()
    for (const inp of a.inputs ?? []) {
      // 同源多行（如 MCO 的 PLL3 与 PLL3÷2）：重复边 id 加行序后缀，避免 Vue :key 重复
      const n = seenInputs.get(inp.id) ?? 0
      seenInputs.set(inp.id, n + 1)
      edges.push({ id: `aux-${a.id}-${inp.id}${n > 0 ? `-${n}` : ''}`, from: inp.id, to: a.id, active: false })
    }
  }

  // ---------- M16 diagram kind 覆盖（数据坐标优先于默认 kind） ----------
  const diagramNodes = spec.diagram?.nodes
  if (diagramNodes) {
    for (const n of nodes) {
      const override = diagramNodes[n.id]?.kind
      if (override) n.kind = override
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
  const groupOrder = ['g-sources', 'g-pll', 'g-sys', 'g-tim', PERI_GROUP.adc, PERI_GROUP.usart, PERI_GROUP.spi, PERI_GROUP.i2c, PERI_GROUP.usb, 'g-aux']
  for (const gid of groupOrder) {
    if (!nodes.some((n) => n.group === gid)) continue
    groups.push({ id: gid, label: groupLabels[gid] ?? gid })
  }

  return { nodes, edges, groups }
}

/**
 * 外设参数写回（M15）：把 periParam 控件的值合并进实例 params，返回新的 PeripheralState。
 * 非 periParam 控件原样返回（视图层走 applyClockControl 路径）。
 */
export function applyPeripheralClockControl(
  state: PeripheralState,
  control: ClockNodeControl,
  value: string | number,
): PeripheralState {
  if (control.field !== 'periParam' || !control.paramKey) return state
  return { ...state, params: { ...state.params, [control.paramKey]: value } }
}

/** 控件字段 → 所属时钟树节点（锁定判断用）。periParam 作用于外设状态，不入此表。 */
const CONTROL_NODE: Record<Exclude<ClockNodeControlField, 'periParam'>, string> = {
  source: 'SYSCLK',
  pllSource: 'PLL',
  hxtalMhz: 'HSE',
  adc: 'ADC',
  ahb: 'AHB',
  apb1: 'APB1',
  apb2: 'APB2',
  pll: 'PLL',
  adcClkDiv: 'ADC',
}

/** 应用画布/详情控件修改，返回新的 ClockConfig（纯函数；锁定节点忽略修改）。 */
export function applyClockControl(cfg: ClockConfig, control: ClockNodeControl, value: string | number): ClockConfig {
  // 外设参数写回工程 peripherals 状态，与 ClockConfig 无关（视图层路由）
  if (control.field === 'periParam') return cfg
  if (isClockNodeLocked(cfg, CONTROL_NODE[control.field])) return cfg
  switch (control.field) {
    case 'source':
      return { ...cfg, source: String(value) }
    case 'pllSource':
      return { ...cfg, pllSource: String(value) }
    case 'adc':
      return { ...cfg, adc: String(value) }
    case 'hxtalMhz':
      return { ...cfg, hxtalMhz: Number(value) }
    case 'ahb':
      return { ...cfg, ahb: Number(value) }
    case 'apb1':
      return { ...cfg, apb1: Number(value) }
    case 'apb2':
      return { ...cfg, apb2: Number(value) }
    case 'pll':
      return { ...cfg, pll: { ...(cfg.pll ?? {}), [control.pllKey ?? 'mul']: Number(value) } }
    case 'adcClkDiv': {
      const n = Number(value)
      if (!Number.isFinite(n)) return cfg
      // Number + min/max clamp（越界夹取，与 stepper/内联编辑语义一致）
      let v = Math.round(n)
      if (control.min !== undefined) v = Math.max(control.min, v)
      if (control.max !== undefined) v = Math.min(control.max, v)
      return { ...cfg, adcClkDiv: v }
    }
  }
}
