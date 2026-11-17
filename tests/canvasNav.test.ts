// 画布导航纯函数测试（M12-hotfix）：光标锚定缩放数学 + 背景平移决策。
import { describe, expect, it } from 'vitest'
import { anchorZoomPan, anchorZoomScroll, clampZoom, shouldStartPan } from '@/components/common/canvasNav'

describe('clampZoom', () => {
  it('比例缩放正常区间', () => {
    expect(clampZoom(1, 1.1)).toBeCloseTo(1.1)
    expect(clampZoom(1, 0.9)).toBeCloseTo(0.9)
  })
  it('上限 3 / 下限 0.3 钳制', () => {
    expect(clampZoom(2.9, 1.1)).toBe(3)
    expect(clampZoom(0.31, 0.9)).toBe(0.3)
    expect(clampZoom(3, 1.1)).toBe(3)
    expect(clampZoom(0.3, 0.9)).toBe(0.3)
  })
  it('自定义上下限', () => {
    expect(clampZoom(1, 5, 0.5, 2)).toBe(2)
  })
})

describe('anchorZoomPan（transform 层，flex 居中 + origin 中心）', () => {
  const center = { x: 400, y: 300 }
  it('光标在容器中心：pan 随比例缩放（视图中心不动）', () => {
    const p = anchorZoomPan({ x: 40, y: -20 }, center, center, 2)
    expect(p.x).toBeCloseTo(80)
    expect(p.y).toBeCloseTo(-40)
  })
  it('光标偏离中心：放大后 pan 向光标反方向补偿，光标下层点不动', () => {
    // 屏幕点 = center + pan + s·(层点−层中心)。取 s=1, pan=0, 光标=center+(100,50)
    // → 层点偏移 (100,50)；s'=2 时 pan' 须使 center+pan'+2·(100,50) = 光标
    // → pan' = (100,50) − 2·(100,50) = (−100,−50)
    const p = anchorZoomPan({ x: 0, y: 0 }, { x: 500, y: 350 }, center, 2)
    expect(p.x).toBeCloseTo(-100)
    expect(p.y).toBeCloseTo(-50)
  })
  it('缩小（r<1）对称成立', () => {
    const p = anchorZoomPan({ x: 0, y: 0 }, { x: 500, y: 350 }, center, 0.5)
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(25)
  })
  it('往返缩放回到原位（r 与 1/r 复合）', () => {
    const cursor = { x: 620, y: 180 }
    const pan0 = { x: 30, y: -15 }
    const p1 = anchorZoomPan(pan0, cursor, center, 1.7)
    const p2 = anchorZoomPan(p1, cursor, center, 1 / 1.7)
    expect(p2.x).toBeCloseTo(pan0.x)
    expect(p2.y).toBeCloseTo(pan0.y)
  })
  it('r=1 恒等', () => {
    const p = anchorZoomPan({ x: 12, y: 34 }, { x: 900, y: 100 }, center, 1)
    expect(p).toEqual({ x: 12, y: 34 })
  })
})

describe('anchorZoomScroll（滚动容器 + padding）', () => {
  it('光标在视口原点（u=0）：scroll 随比例缩放', () => {
    expect(anchorZoomScroll(100, 0, 20, 2)).toBeCloseTo(20 + (100 - 20) * 2)
  })
  it('保持光标下内容不动：内容坐标 = scroll+u，SVG 坐标扣 padding 后缩放', () => {
    // scroll=100, u=200, pad=20 → SVG 坐标 280；r=2 → 560；内容 580；scroll'=580−200=380
    expect(anchorZoomScroll(100, 200, 20, 2)).toBeCloseTo(380)
  })
  it('r=1 恒等', () => {
    expect(anchorZoomScroll(123, 456, 20, 1)).toBeCloseTo(123)
  })
  it('往返缩放回到原位', () => {
    const s1 = anchorZoomScroll(80, 300, 20, 1.9)
    const s2 = anchorZoomScroll(s1, 300, 20, 1 / 1.9)
    expect(s2).toBeCloseTo(80)
  })
  it('padding=0 退化为 (scroll+u)·r−u', () => {
    expect(anchorZoomScroll(50, 100, 0, 2)).toBeCloseTo(200)
  })
})

describe('anchorZoomScroll（safe center 居中 origin）', () => {
  it('未溢出轴传入居中 origin：补偿量可超出滚动起点（交由浏览器钳为 0）', () => {
    // 卡片宽 756、容器内容宽 819 → origin = 20 + (819−756)/2 = 51.5
    const s = anchorZoomScroll(0, 336, 20, 1.1, 51.5)
    expect(s).toBeCloseTo(20 + (336 - 51.5) * 1.1 - 336)
    expect(s).toBeLessThan(0)
  })
  it('origin ≠ padding 的正向补偿', () => {
    expect(anchorZoomScroll(50, 200, 20, 2, 120)).toBeCloseTo(20 + (50 + 200 - 120) * 2 - 200)
  })
  it('跨越未溢出→溢出：传入居中 origin 后光标下内容仍在光标处', () => {
    // 卡片 700 → 缩放 1.2 → 840（>819 内容宽，已溢出）；居中 origin = 20 + (819−700)/2
    const pad = 20
    const contentW = 819
    const cardW0 = 700
    const s0 = 0.6
    const r = 1.2
    const origin0 = pad + (contentW - cardW0) / 2
    const u = 500
    const nodeSvg = (u - origin0) / s0
    const scroll1 = anchorZoomScroll(0, u, pad, r, origin0)
    expect(scroll1).toBeGreaterThan(0)
    // 溢出后 safe center 回退 start：新原点 = padding，scale = s0·r
    const screen1 = pad + nodeSvg * s0 * r - scroll1
    expect(screen1).toBeCloseTo(u)
  })
  it('溢出轴 origin=padding 时与旧公式一致', () => {
    expect(anchorZoomScroll(100, 200, 20, 2, 20)).toBeCloseTo(anchorZoomScroll(100, 200, 20, 2))
  })
})

describe('shouldStartPan（背景拖动平移决策）', () => {
  it('hand 工具：左键任意处（含引脚上）平移', () => {
    expect(shouldStartPan({ tool: 'hand', onPin: true, button: 0 })).toBe(true)
    expect(shouldStartPan({ tool: 'hand', onPin: false, button: 0 })).toBe(true)
  })
  it('pointer 工具：空白处左键平移，引脚上不平移（保留点选/拖拽移动信号）', () => {
    expect(shouldStartPan({ tool: 'pointer', onPin: false, button: 0 })).toBe(true)
    expect(shouldStartPan({ tool: 'pointer', onPin: true, button: 0 })).toBe(false)
  })
  it('中键任意处平移（两种工具）', () => {
    expect(shouldStartPan({ tool: 'pointer', onPin: true, button: 1 })).toBe(true)
    expect(shouldStartPan({ tool: 'hand', onPin: false, button: 1 })).toBe(true)
  })
  it('右键不启动平移（保留上下文菜单）', () => {
    expect(shouldStartPan({ tool: 'hand', onPin: false, button: 2 })).toBe(false)
    expect(shouldStartPan({ tool: 'pointer', onPin: false, button: 2 })).toBe(false)
  })
})