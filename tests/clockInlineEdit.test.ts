// 时钟树节点内联编辑纯函数测试：数字解析（合法/非法/夹取/边界）/ 下拉匹配 / 按键判定 / 可编辑判定，
// 以及真实 CH32V203C8T6 spec 的 parse → applyClockControl 冒烟链路。
import { describe, it, expect } from 'vitest'
import {
  canEditControl,
  clampNumber,
  editKeyAction,
  isRadioControl,
  isStepperControl,
  parseNumberInput,
  resolveSelectValue,
  stepControlValue,
} from '@/components/clock/inlineEdit'
import { computeHighlightSet, edgeInHighlight } from '@/components/clock/graph'
import { arrowScrollDelta, shouldIgnoreSceneKeys } from '@/components/common/canvasNav'
import type { ClockNodeControl } from '@/model/clock/tree'
import { applyClockControl, buildClockTree } from '@/model/clock/tree'
import { computeClock, defaultClock } from '@/model/clock'
import { computePeripheralClocks } from '@/model/clock/peripheral'
import { getDeviceData } from '@/model/device'

/** 构造 number 控件（默认按 V203 HSE 晶振：3~25 MHz） */
function numControl(over: Partial<ClockNodeControl> = {}): ClockNodeControl {
  return { kind: 'number', field: 'hxtalMhz', label: '晶振频率', value: 8, min: 3, max: 25, unit: 'MHz', ...over }
}

/** 构造 select 控件（默认按 AHB 分频档位） */
function selControl(over: Partial<ClockNodeControl> = {}): ClockNodeControl {
  return {
    kind: 'select',
    field: 'ahb',
    label: '分频',
    value: 1,
    options: [1, 2, 4, 8].map((o) => ({ value: o, label: `÷${o}` })),
    ...over,
  }
}

describe('parseNumberInput 合法输入', () => {
  it('整数原样解析', () => {
    expect(parseNumberInput('12', numControl())).toEqual({ ok: true, value: 12 })
  })

  it('小数保留不取整（与 applyClockControl 的 Number(value) 语义一致）', () => {
    expect(parseNumberInput('8.25', numControl())).toEqual({ ok: true, value: 8.25 })
  })

  it('前后空白被修剪', () => {
    expect(parseNumberInput('  16  ', numControl())).toEqual({ ok: true, value: 16 })
  })

  it('符号与科学计数法合法', () => {
    expect(parseNumberInput('+1e1', numControl({ min: undefined, max: undefined }))).toEqual({ ok: true, value: 10 })
  })
})

describe('parseNumberInput 非法输入', () => {
  it('空串 → ok:false', () => {
    expect(parseNumberInput('', numControl()).ok).toBe(false)
  })

  it('纯空白 → ok:false', () => {
    expect(parseNumberInput('   ', numControl()).ok).toBe(false)
  })

  it('非数字文本 → ok:false', () => {
    expect(parseNumberInput('abc', numControl()).ok).toBe(false)
  })

  it('数字混合文本 → ok:false', () => {
    expect(parseNumberInput('12abc', numControl()).ok).toBe(false)
  })

  it('十六进制字面量 → ok:false（仅接受十进制）', () => {
    expect(parseNumberInput('0x10', numControl()).ok).toBe(false)
  })

  it('Infinity → ok:false', () => {
    expect(parseNumberInput('Infinity', numControl()).ok).toBe(false)
  })
})

describe('parseNumberInput 夹取与边界', () => {
  it('低于 min 夹取到 min', () => {
    expect(parseNumberInput('1', numControl())).toEqual({ ok: true, value: 3 })
  })

  it('高于 max 夹取到 max', () => {
    expect(parseNumberInput('100', numControl())).toEqual({ ok: true, value: 25 })
  })

  it('恰好等于 min/max 边界值原样通过', () => {
    expect(parseNumberInput('3', numControl())).toEqual({ ok: true, value: 3 })
    expect(parseNumberInput('25', numControl())).toEqual({ ok: true, value: 25 })
  })

  it('无 min/max 约束时原值返回（含负数）', () => {
    const c = numControl({ min: undefined, max: undefined })
    expect(parseNumberInput('-5', c)).toEqual({ ok: true, value: -5 })
    expect(parseNumberInput('1000000', c)).toEqual({ ok: true, value: 1000000 })
  })

  it('clampNumber 单侧约束', () => {
    expect(clampNumber(2, 3, undefined)).toBe(3)
    expect(clampNumber(99, undefined, 25)).toBe(25)
    expect(clampNumber(7, undefined, undefined)).toBe(7)
  })
})

describe('resolveSelectValue', () => {
  it('数字档位按字符串匹配且保留 number 类型', () => {
    expect(resolveSelectValue('4', selControl())).toBe(4)
  })

  it('字符串选项匹配（时钟源）', () => {
    const c = selControl({
      field: 'source',
      value: 'HSI',
      options: [
        { value: 'HSI', label: '内部 HSI' },
        { value: 'HSE', label: '外部晶振' },
        { value: 'PLL', label: 'PLL' },
      ],
    })
    expect(resolveSelectValue('HSE', c)).toBe('HSE')
  })

  it('不在 options 中 → null', () => {
    expect(resolveSelectValue('3', selControl())).toBeNull()
  })

  it('无 options → null', () => {
    expect(resolveSelectValue('1', selControl({ options: undefined }))).toBeNull()
  })
})

describe('editKeyAction / canEditControl', () => {
  it('Enter 提交 / Esc 取消 / 其余按键交还原生', () => {
    expect(editKeyAction('Enter')).toBe('commit')
    expect(editKeyAction('Escape')).toBe('cancel')
    expect(editKeyAction('a')).toBeNull()
    expect(editKeyAction('Tab')).toBeNull()
  })

  it('fixed / 锁定 / 无控件不可编辑，正常控件可编辑', () => {
    expect(canEditControl(null, false)).toBe(false)
    expect(canEditControl(numControl({ fixed: true }), false)).toBe(false)
    expect(canEditControl(numControl(), true)).toBe(false)
    expect(canEditControl(numControl(), false)).toBe(true)
  })
})

describe('冒烟：CH32V203C8T6 parse → applyClockControl 链路', () => {
  const spec = getDeviceData('CH32V203C8T6').clock
  const cfg = defaultClock(spec)
  const layout = buildClockTree(spec, cfg, computeClock(spec, cfg))
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))

  it('HSE 为 number 控件（3~25 MHz），合法输入写回 hxtalMhz', () => {
    const hse = byId.get('HSE')
    expect(hse?.control?.kind).toBe('number')
    const c = hse!.control!
    const r = parseNumberInput('12', c)
    expect(r.ok).toBe(true)
    const next = applyClockControl(cfg, c, r.value!)
    expect(next.hxtalMhz).toBe(12)
  })

  it('HSE 超界输入夹取到 max=25 后写回', () => {
    const c = byId.get('HSE')!.control!
    const r = parseNumberInput('99', c)
    expect(r).toEqual({ ok: true, value: 25 })
    expect(applyClockControl(cfg, c, r.value!).hxtalMhz).toBe(25)
  })

  it('HSE 非法输入不写回（回退原值语义）', () => {
    const c = byId.get('HSE')!.control!
    expect(parseNumberInput('abc', c).ok).toBe(false)
    // 非法时 UI 回退原值：以原值提交不改变配置
    expect(applyClockControl(cfg, c, Number(c.value)).hxtalMhz).toBe(cfg.hxtalMhz)
  })

  it('AHB 分频为 select 档位控件，resolve → apply 后 hclk = sysclk ÷ 4', () => {
    const ahb = byId.get('AHB')
    expect(ahb?.control?.kind).toBe('select')
    const c = ahb!.control!
    const v = resolveSelectValue('4', c)
    expect(v).toBe(4)
    const next = applyClockControl(cfg, c, v!)
    expect(next.ahb).toBe(4)
    const freqs = computeClock(spec, next)
    expect(freqs.hclkMhz).toBe(freqs.sysclkMhz / 4)
  })

  it('锁定节点的修改被 applyClockControl 忽略（与内联编辑置灰一致）', () => {
    const c = byId.get('HSE')!.control!
    const lockedCfg = { ...cfg, locked: ['HSE'] }
    expect(applyClockControl(lockedCfg, c, 16)).toBe(lockedCfg)
    expect(canEditControl(c, true)).toBe(false)
  })
})

// ---------- M15：radio / stepper 控件形态 ----------

function sourceControl(over: Partial<ClockNodeControl> = {}): ClockNodeControl {
  return {
    kind: 'select',
    field: 'source',
    label: '时钟源',
    value: 'HSI',
    options: [
      { value: 'HSI', label: 'HSI' },
      { value: 'HSE', label: 'HSE' },
      { value: 'PLL', label: 'PLL' },
    ],
    ...over,
  }
}

describe('isRadioControl', () => {
  it('源选择且选项 ≤4 → radio', () => {
    expect(isRadioControl(sourceControl())).toBe(true)
  })

  it('源选择但选项 ≥5 → 不强制 radio（保持内联 select）', () => {
    const c = sourceControl({
      options: ['HSI', 'HSE', 'PLL', 'LSI', 'LSE'].map((v) => ({ value: v, label: v })),
    })
    expect(isRadioControl(c)).toBe(false)
  })

  it('分频字段即使选项少也不用 radio', () => {
    expect(isRadioControl(selControl())).toBe(false)
  })

  it('无控件/无选项 → 不是 radio', () => {
    expect(isRadioControl(null)).toBe(false)
    expect(isRadioControl(sourceControl({ options: undefined }))).toBe(false)
  })
})

describe('isStepperControl / stepControlValue', () => {
  it('分频字段识别为 stepper，源选择不是', () => {
    expect(isStepperControl(selControl())).toBe(true)
    expect(isStepperControl(selControl({ field: 'adcClkDiv' }))).toBe(true)
    expect(isStepperControl(sourceControl())).toBe(false)
    expect(isStepperControl(null)).toBe(false)
  })

  it('按 options 索引 ±1，返回选项原值（number 类型）', () => {
    const c = selControl({ value: 2 })
    expect(stepControlValue(c, 1)).toBe(4)
    expect(stepControlValue(c, -1)).toBe(1)
  })

  it('首/尾档位返回 null（按钮置灰）', () => {
    expect(stepControlValue(selControl({ value: 1 }), -1)).toBeNull()
    expect(stepControlValue(selControl({ value: 8 }), 1)).toBeNull()
  })

  it('fixed / 当前值不在 options / 无选项 → null', () => {
    expect(stepControlValue(selControl({ fixed: true }), 1)).toBeNull()
    expect(stepControlValue(selControl({ value: 3 }), 1)).toBeNull()
    expect(stepControlValue(selControl({ options: undefined }), 1)).toBeNull()
  })

  it('stepper 结果可直接写回 applyClockControl（V203 AHB ÷2 → ÷4）', () => {
    const spec = getDeviceData('CH32V203C8T6').clock
    const cfg = defaultClock(spec)
    const c: ClockNodeControl = selControl({ value: 2 })
    const v = stepControlValue(c, 1)
    expect(v).toBe(4)
    expect(applyClockControl(cfg, c, v!).ahb).toBe(4)
  })
})

// ---------- M15：路径高亮 BFS ----------

const CHAIN = [
  { from: 'HSI', to: 'SYSCLK' },
  { from: 'SYSCLK', to: 'AHB' },
  { from: 'AHB', to: 'APB1' },
  { from: 'APB1', to: 'P-USART1' },
]

describe('computeHighlightSet 路径高亮', () => {
  it('upstream：仅上游祖先链（不含下游）', () => {
    const ids = computeHighlightSet(CHAIN, 'APB1', 'upstream')
    expect([...ids].sort()).toEqual(['AHB', 'APB1', 'HSI', 'SYSCLK'].sort())
    expect(ids.has('P-USART1')).toBe(false)
  })

  it('both：上下游全闭包', () => {
    const ids = computeHighlightSet(CHAIN, 'AHB', 'both')
    expect(ids.has('HSI')).toBe(true)
    expect(ids.has('SYSCLK')).toBe(true)
    expect(ids.has('APB1')).toBe(true)
    expect(ids.has('P-USART1')).toBe(true)
    expect(ids.has('APB2')).toBe(false)
  })

  it('起点始终包含；未知起点返回单节点', () => {
    const ids = computeHighlightSet(CHAIN, 'UART-UNKNOWN', 'upstream')
    expect(ids).toEqual(new Set(['UART-UNKNOWN']))
  })

  it('空边集仍返回起点', () => {
    expect(computeHighlightSet([], 'SYSCLK', 'both')).toEqual(new Set(['SYSCLK']))
  })

  it('edgeInHighlight 要求两端都在集合中', () => {
    const ids = new Set(['AHB', 'APB1'])
    expect(edgeInHighlight({ from: 'AHB', to: 'APB1' }, ids)).toBe(true)
    expect(edgeInHighlight({ from: 'APB1', to: 'P-USART1' }, ids)).toBe(false)
  })
})

// ---------- M15：画布键盘导航纯函数 ----------

// ---------- M15：外设节点树模型冒烟（C 域消费 B/A 接口） ----------

describe('冒烟：CH32V203C8T6 外设时钟节点', () => {
  const data = getDeviceData('CH32V203C8T6')
  const spec = data.clock
  const cfg = defaultClock(spec)
  const freqs = computeClock(spec, cfg)
  const periFreqs = computePeripheralClocks(spec, cfg, freqs, data.peripherals, {})
  const layout = buildClockTree(spec, cfg, freqs, undefined, { peripherals: data.peripherals, state: {}, periFreqs })
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))

  it('外设实例节点带 periId/column/group/badge 元数据', () => {
    const usart = byId.get('P-USART1')
    expect(usart).toBeDefined()
    expect(usart!.periId).toBe('USART1')
    expect(usart!.lockable).toBe(false)
    expect(usart!.badge).toBe('fixed')
    expect(typeof usart!.column).toBe('number')
    expect(usart!.group).toBe('g-usart')
  })

  it('USART 速率旋钮为 periParam 控件（baudrate）', () => {
    const c = byId.get('P-USART1')!.control!
    expect(c.field).toBe('periParam')
    expect(c.periId).toBe('USART1')
    expect(c.paramKey).toBe('baudrate')
    expect(c.kind).toBe('number')
  })

  it('ADC 实例节点暴露 adcClkDiv raw 控件（V203 programmable）', () => {
    const adc = byId.get('P-ADC1')
    expect(adc).toBeDefined()
    expect(adc!.control?.field).toBe('adcClkDiv')
    expect(adc!.control?.kind).toBe('select')
    expect(adc!.badge).toBe('raw')
  })

  it('外设边从源总线节点连出（V203 USART1 覆盖为 APB2）', () => {
    const e = layout.edges.find((x) => x.to === 'P-USART1')
    expect(e?.from).toBe('APB2')
  })
})

describe('arrowScrollDelta / shouldIgnoreSceneKeys', () => {
  it('方向键映射为滚动增量', () => {
    expect(arrowScrollDelta('ArrowLeft')).toEqual({ x: -56, y: 0 })
    expect(arrowScrollDelta('ArrowRight', 10)).toEqual({ x: 10, y: 0 })
    expect(arrowScrollDelta('ArrowUp')).toEqual({ x: 0, y: -56 })
    expect(arrowScrollDelta('ArrowDown')).toEqual({ x: 0, y: 56 })
    expect(arrowScrollDelta('Enter')).toEqual({ x: 0, y: 0 })
  })

  it('输入/下拉/可编辑区/按钮上不劫持快捷键', () => {
    expect(shouldIgnoreSceneKeys('INPUT', false, false)).toBe(true)
    expect(shouldIgnoreSceneKeys('textarea', false, false)).toBe(true)
    expect(shouldIgnoreSceneKeys('SELECT', false, false)).toBe(true)
    expect(shouldIgnoreSceneKeys('BUTTON', false, false)).toBe(true)
    expect(shouldIgnoreSceneKeys('DIV', true, false)).toBe(true)
  })

  it('内联编辑中不劫持；普通画布区域劫持', () => {
    expect(shouldIgnoreSceneKeys('DIV', false, true)).toBe(true)
    expect(shouldIgnoreSceneKeys('DIV', false, false)).toBe(false)
    expect(shouldIgnoreSceneKeys(undefined, false, false)).toBe(false)
  })
})