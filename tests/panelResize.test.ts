// M6 面板拖拽调宽纯函数契约测试：夹取边界 / NaN 兜底 / 方向语义 / 键盘步进。
// 与 PanelResizer.vue 的普通 <script> 导出对齐（参考 pinTable.test.ts 的双 script 模式）。
import { describe, it, expect } from 'vitest'
import {
  CODE_WIDTH_RANGE,
  DETAIL_WIDTH_RANGE,
  PANEL_KEYBOARD_STEP,
  clampPanelWidth,
  resizeDelta,
} from '@/components/common/PanelResizer.vue'

/** 模拟一次键盘步进（与 PanelResizer.onKeydown 同语义）：夹取后返回新宽度。 */
function keyboardStep(width: number, key: 'ArrowLeft' | 'ArrowRight', side: 'left' | 'right'): number {
  const dx = key === 'ArrowRight' ? PANEL_KEYBOARD_STEP : -PANEL_KEYBOARD_STEP
  return clampPanelWidth(width + resizeDelta(dx, side), DETAIL_WIDTH_RANGE.min, DETAIL_WIDTH_RANGE.max)
}

describe('clampPanelWidth 夹取与兜底', () => {
  it('范围内的宽度原样返回', () => {
    expect(clampPanelWidth(360, 280, 560)).toBe(360)
    expect(clampPanelWidth(480, 320, 760)).toBe(480)
  })

  it('低于 min 夹到 min，高于 max 夹到 max', () => {
    expect(clampPanelWidth(100, 280, 560)).toBe(280)
    expect(clampPanelWidth(9999, 280, 560)).toBe(560)
    expect(clampPanelWidth(0, 320, 760)).toBe(320)
    expect(clampPanelWidth(1200, 320, 760)).toBe(760)
  })

  it('恰好等于边界值时保持不变', () => {
    expect(clampPanelWidth(280, 280, 560)).toBe(280)
    expect(clampPanelWidth(560, 280, 560)).toBe(560)
    expect(clampPanelWidth(320, 320, 760)).toBe(320)
    expect(clampPanelWidth(760, 320, 760)).toBe(760)
  })

  it('NaN 兜底返回 min（损坏偏好/异常坐标不产生非法宽度）', () => {
    expect(clampPanelWidth(Number.NaN, 280, 560)).toBe(280)
    expect(clampPanelWidth(Number.NaN, 320, 760)).toBe(320)
  })

  it('Infinity / -Infinity 同样兜底返回 min', () => {
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, 280, 560)).toBe(280)
    expect(clampPanelWidth(Number.NEGATIVE_INFINITY, 280, 560)).toBe(280)
  })

  it('负数宽度夹到 min', () => {
    expect(clampPanelWidth(-50, 280, 560)).toBe(280)
  })
})

describe('resizeDelta 方向语义', () => {
  it("side='left'（面板在左）：向右拖增宽，增量 = dx", () => {
    expect(resizeDelta(40, 'left')).toBe(40)
    expect(resizeDelta(-40, 'left')).toBe(-40)
  })

  it("side='right'（面板在右，右缘固定）：向左拖增宽，增量 = -dx", () => {
    expect(resizeDelta(-40, 'right')).toBe(40)
    expect(resizeDelta(40, 'right')).toBe(-40)
  })

  it('零位移不产生宽度变化', () => {
    expect(resizeDelta(0, 'left')).toBe(0)
    expect(resizeDelta(0, 'right')).toBe(0)
  })

  it('NaN 位移兜底为 0', () => {
    expect(resizeDelta(Number.NaN, 'left')).toBe(0)
    expect(resizeDelta(Number.NaN, 'right')).toBe(0)
  })
})

describe('宽度范围常量', () => {
  it('detail 范围 280–560、code 范围 320–760，默认值落在范围内', () => {
    expect(DETAIL_WIDTH_RANGE).toEqual({ min: 280, max: 560 })
    expect(CODE_WIDTH_RANGE).toEqual({ min: 320, max: 760 })
    // uiPreferences 默认 detailWidth=360 / codeWidth=480 必须合法
    expect(clampPanelWidth(360, DETAIL_WIDTH_RANGE.min, DETAIL_WIDTH_RANGE.max)).toBe(360)
    expect(clampPanelWidth(480, CODE_WIDTH_RANGE.min, CODE_WIDTH_RANGE.max)).toBe(480)
  })

  it('键盘步进为 10px', () => {
    expect(PANEL_KEYBOARD_STEP).toBe(10)
  })
})

describe('键盘步进（ArrowLeft / ArrowRight ±10px，夹取同鼠标）', () => {
  it("side='right'：ArrowLeft 增宽 10，ArrowRight 减宽 10", () => {
    expect(keyboardStep(360, 'ArrowLeft', 'right')).toBe(370)
    expect(keyboardStep(360, 'ArrowRight', 'right')).toBe(350)
  })

  it("side='left'：ArrowRight 增宽 10，ArrowLeft 减宽 10", () => {
    expect(keyboardStep(360, 'ArrowRight', 'left')).toBe(370)
    expect(keyboardStep(360, 'ArrowLeft', 'left')).toBe(350)
  })

  it('到达 max 后继续增宽方向按键保持 max（不越界）', () => {
    expect(keyboardStep(560, 'ArrowLeft', 'right')).toBe(560)
    expect(keyboardStep(555, 'ArrowLeft', 'right')).toBe(560)
  })

  it('到达 min 后继续减宽方向按键保持 min（不越界）', () => {
    expect(keyboardStep(280, 'ArrowRight', 'right')).toBe(280)
    expect(keyboardStep(285, 'ArrowRight', 'right')).toBe(280)
  })
})
