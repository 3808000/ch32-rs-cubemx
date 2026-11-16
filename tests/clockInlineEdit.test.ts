// 时钟树节点内联编辑纯函数测试：数字解析（合法/非法/夹取/边界）/ 下拉匹配 / 按键判定 / 可编辑判定，
// 以及真实 CH32V203C8T6 spec 的 parse → applyClockControl 冒烟链路。
import { describe, it, expect } from 'vitest'
import {
  canEditControl,
  clampNumber,
  editKeyAction,
  parseNumberInput,
  resolveSelectValue,
} from '@/components/clock/inlineEdit'
import type { ClockNodeControl } from '@/model/clock/tree'
import { applyClockControl, buildClockTree } from '@/model/clock/tree'
import { computeClock, defaultClock } from '@/model/clock'
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