// 时钟树控件 schema、外设控件构造与配置写回。
import type { ClockConfig, ParamSpec, PeripheralState } from '@/model/types'
import { isClockNodeLocked } from '../config'

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

/** 外设控件的公共部分（periParam：外设参数旋钮）。 */
export function periParamControl(
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
