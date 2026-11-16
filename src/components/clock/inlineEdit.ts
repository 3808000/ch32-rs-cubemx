// 时钟树节点内联编辑纯函数：数字输入解析（min/max 夹取）/ 下拉值匹配 / 编辑按键判定 / 可编辑判定。
// 数值语义与 applyClockControl 对齐：提交值直接 Number(value)，不做取整——
// 分频（AHB/APB1/APB2）在模型中是 select 档位控件，唯一的 number 控件是晶振频率（允许小数）。
import type { ClockNodeControl } from '@/model/clock/tree'

/** 数字输入解析结果：ok=false 表示空/非法输入（调用方回退原值） */
export interface NumberParseResult {
  ok: boolean
  value?: number
}

/** 按控件 min/max 夹取（无约束则原值返回） */
export function clampNumber(value: number, min?: number, max?: number): number {
  let v = value
  if (min !== undefined && v < min) v = min
  if (max !== undefined && v > max) v = max
  return v
}

/** 十进制数字字面量（含符号/小数/科学计数法）；拒绝 hex、空白串、Infinity 等 */
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * 解析内联数字输入：空/非数字 → ok:false；合法则按控件 min/max 夹取。
 * 不取整（applyClockControl 对 number 控件直接 Number(value)，无取整语义）。
 */
export function parseNumberInput(raw: string, control: ClockNodeControl): NumberParseResult {
  const text = raw.trim()
  if (!text || !DECIMAL_RE.test(text)) return { ok: false }
  const n = Number(text)
  if (!Number.isFinite(n)) return { ok: false }
  return { ok: true, value: clampNumber(n, control.min, control.max) }
}

/** 按 options 匹配下拉原始值（字符串比较）；命中返回选项原值（保留 string/number 类型），未命中返回 null */
export function resolveSelectValue(raw: string, control: ClockNodeControl): string | number | null {
  const opt = control.options?.find((o) => String(o.value) === raw)
  return opt ? opt.value : null
}

/** 编辑态按键动作：Enter 提交 / Esc 取消 / 其余交还原生行为 */
export type EditKeyAction = 'commit' | 'cancel' | null

export function editKeyAction(key: string): EditKeyAction {
  if (key === 'Enter') return 'commit'
  if (key === 'Escape') return 'cancel'
  return null
}

/** 控件是否可编辑：fixed（数据层固定/唯一档位/锁定置灰）或节点锁定时不可编辑 */
export function canEditControl(control: ClockNodeControl | null | undefined, locked: boolean): boolean {
  return !!control && !control.fixed && !locked
}