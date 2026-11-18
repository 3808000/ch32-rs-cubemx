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
 * 光标视口偏移 u 处的内容坐标 = scroll + u；SVG 坐标 = scroll + u − origin。
 * 缩放后保持光标下内容不动：scroll' = padding + (scroll + u − origin)·r − u。
 *
 * origin 是缩放前 SVG 左上角在滚动内容坐标系中的偏移（相对 scrollLeft=0 的视口左缘）。
 * 常规（内容溢出/左对齐）时 origin = padding，公式退化为旧形式。
 * 居中布局下未溢出轴的 origin = padding + 两侧空白/2；跨越「未溢出 → 溢出」时
 * 传入该实际 origin 可抵消对齐方式切换（居中 → start）造成的一次性跳变。
 * 缩放后的新原点按 padding 计：溢出轴 safe center 回退 start，原点确在 padding；
 * 仍未溢出的轴 scroll 会被浏览器钳回 0（锚定在该轴不可行），结果无害。
 */
export function anchorZoomScroll(
  scroll: number,
  cursorOffset: number,
  padding: number,
  ratio: number,
  origin = padding,
): number {
  return padding + (scroll + cursorOffset - origin) * ratio - cursorOffset
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

/**
 * 方向键滚动画布（ClockCanvas，M15）：返回滚动容器 scrollLeft/scrollTop 的增量。
 * 仅识别 ArrowLeft/Right/Up/Down，其余按键返回 0（交还原生行为）。
 */
export function arrowScrollDelta(key: string, step = 56): Pt {
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 }
    case 'ArrowRight':
      return { x: step, y: 0 }
    case 'ArrowUp':
      return { x: 0, y: -step }
    case 'ArrowDown':
      return { x: 0, y: step }
    default:
      return { x: 0, y: 0 }
  }
}

/**
 * 画布快捷键是否应放弃拦截（M15 Space 临时抓手 / 方向键滚动）：
 * - 节点内联编辑中：不劫持；
 * - 焦点在输入/文本域/下拉/可编辑区/按钮上：不劫持（保留原生输入与按钮激活语义）。
 */
export function shouldIgnoreSceneKeys(
  tagName: string | undefined,
  isContentEditable: boolean,
  editing: boolean,
): boolean {
  if (editing) return true
  if (isContentEditable) return true
  const tag = (tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON'
}