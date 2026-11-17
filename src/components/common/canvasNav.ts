// 画布导航纯函数（M12-hotfix）：光标锚定缩放 + 背景拖动平移决策。
// PackageCanvas（transform 层）与 ClockCanvas（滚动容器）共用，供 vitest 直接验证。

export interface Pt {
  x: number
  y: number
}

/** 缩放钳制（与两画布既有 30%~300% 一致）。 */
export function clampZoom(z: number, f: number, min = 0.3, max = 3): number {
  return Math.min(max, Math.max(min, z * f))
}

/**
 * transform 层光标锚定缩放：层 `translate(pan) scale(s)`、transform-origin 中心、
 * 层在容器内 flex 居中（层中心未变换时与容器中心重合）。
 * 屏幕点 = center + pan + s·(层点 − 层中心)；保持光标下的层点不动：
 *   pan' = pan·r + (cursor − center)·(1 − r)，r = s'/s。
 * cursor/center 均为容器坐标系。cursor=center 时退化为 pan·r（按钮缩放保持视图中心）。
 */
export function anchorZoomPan(pan: Pt, cursor: Pt, center: Pt, ratio: number): Pt {
  return {
    x: pan.x * ratio + (cursor.x - center.x) * (1 - ratio),
    y: pan.y * ratio + (cursor.y - center.y) * (1 - ratio),
  }
}

/**
 * 滚动容器光标锚定缩放：内容 = padding + SVG（SVG 尺寸随 zoom 线性缩放）。
 * 光标视口偏移 u 处的内容坐标 = scroll + u；SVG 坐标 = scroll + u − padding。
 * 缩放后保持光标下内容不动：scroll' = padding + (scroll + u − padding)·r − u。
 */
export function anchorZoomScroll(scroll: number, cursorOffset: number, padding: number, ratio: number): number {
  return padding + (scroll + cursorOffset - padding) * ratio - cursorOffset
}

/**
 * 背景拖动平移决策（UI 守卫——按钮/工具条/浮卡等——由调用方先行排除）：
 * - hand 工具：任意画布区域拖动平移；
 * - pointer 工具：空白处（非引脚/节点）左键拖动平移，引脚上保留点选/拖拽移动信号；
 * - 中键：任意处平移（调用方 preventDefault 阻止自动滚动）。
 */
export function shouldStartPan(opts: { tool: 'pointer' | 'hand'; onPin: boolean; button: number }): boolean {
  if (opts.button === 1) return true
  if (opts.button !== 0) return false
  if (opts.tool === 'hand') return true
  return !opts.onPin
}