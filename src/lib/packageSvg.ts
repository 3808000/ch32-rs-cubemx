// 封装图几何：dual（两边）/ quad（四边）布局 + 90° 步进旋转。
// 纯函数，输出 SVG 坐标；文字始终水平（旋转只变换位置）。
import type { ChipData, ChipPin, PinSide } from '../types'

export interface PinLayout {
  pin: ChipPin
  /** 胶囊左上角 */
  x: number
  y: number
  w: number
  h: number
  /** 引脚名（芯片内侧）锚点 */
  nameX: number
  nameY: number
  nameAnchor: 'start' | 'end' | 'middle'
  /** 外部标签锚点 */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'end' | 'middle'
  /** 旋转后的逻辑边（用于着色/交互） */
  side: PinSide
}

export interface PackageGeometry {
  width: number
  height: number
  body: { x: number; y: number; w: number; h: number }
  pins: PinLayout[]
  rotation: number
}

const PITCH = 38 // 引脚间距（dual）
const QUAD_PITCH = 46 // quad 四边间距更大，避免顶/底边引脚名重叠
const PIN_W = 62 // 水平胶囊宽
const PIN_H = 24 // 水平胶囊高
const GAP = 18 // 胶囊与芯片主体间距
const LABEL_SPACE = 130 // 外侧标签留白
const PAD = 24 // 画布内边距
const BODY_W_DUAL = 190

/** 每边的引脚（按封装编号顺序）：
 *  QFP 逆时针：左边 1..N 上→下，底边 N+1..2N 左→右，右边 2N+1..3N 下→上，顶边 3N+1..4N 右→左。
 *  dual：左 1..N 上→下，右 N+1..2N 下→上（编号大的在上）。 */
function pinsBySide(chip: ChipData): Record<PinSide, ChipPin[]> {
  const sides: Record<PinSide, ChipPin[]> = { left: [], right: [], top: [], bottom: [] }
  for (const p of chip.pins) sides[p.side].push(p)
  sides.left.sort((a, b) => a.number - b.number)
  // 右侧：编号大的在上（标准 IC 逆时针编号）
  sides.right.sort((a, b) => b.number - a.number)
  // 底边：从左到右递增；顶边：从右到左递增（即渲染顺序递减）
  sides.bottom.sort((a, b) => a.number - b.number)
  sides.top.sort((a, b) => b.number - a.number)
  return sides
}

/** 计算未旋转的布局（rotation=0）。 */
function baseLayout(chip: ChipData): PackageGeometry {
  const sides = pinsBySide(chip)
  const n = chip.pinsPerSide
  const pins: PinLayout[] = []

  if (chip.packageKind === 'dual') {
    const bodyH = n * PITCH + 24
    const bodyW = BODY_W_DUAL
    const bodyX = PAD + LABEL_SPACE + PIN_W + GAP
    const bodyY = PAD + 12
    const width = bodyX + bodyW + GAP + PIN_W + LABEL_SPACE + PAD
    const height = bodyY + bodyH + PAD + 12

    sides.left.forEach((p, i) => {
      const cy = bodyY + 12 + i * PITCH + PITCH / 2
      const x = PAD + LABEL_SPACE
      pins.push({
        pin: p,
        x,
        y: cy - PIN_H / 2,
        w: PIN_W,
        h: PIN_H,
        nameX: bodyX + 10,
        nameY: cy,
        nameAnchor: 'start',
        labelX: x - 16,
        labelY: cy,
        labelAnchor: 'end',
        side: 'left',
      })
    })
    sides.right.forEach((p, i) => {
      const cy = bodyY + 12 + i * PITCH + PITCH / 2
      const x = bodyX + bodyW + GAP
      pins.push({
        pin: p,
        x,
        y: cy - PIN_H / 2,
        w: PIN_W,
        h: PIN_H,
        nameX: bodyX + bodyW - 10,
        nameY: cy,
        nameAnchor: 'end',
        labelX: x + PIN_W + 16,
        labelY: cy,
        labelAnchor: 'start',
        side: 'right',
      })
    })
    return { width, height, body: { x: bodyX, y: bodyY, w: bodyW, h: bodyH }, pins, rotation: 0 }
  }

  // quad：四边，引脚竖放（上下边）/ 横放（左右边）
  const bodyW = n * QUAD_PITCH + 24
  const bodyH = n * QUAD_PITCH + 24
  const bodyX = PAD + LABEL_SPACE + PIN_W + GAP
  const bodyY = PAD + LABEL_SPACE + PIN_W + GAP
  const width = bodyX + bodyW + GAP + PIN_W + LABEL_SPACE + PAD
  const height = bodyY + bodyH + GAP + PIN_W + LABEL_SPACE + PAD

  sides.left.forEach((p, i) => {
    const cy = bodyY + 12 + i * QUAD_PITCH + QUAD_PITCH / 2
    const x = bodyX - GAP - PIN_W
    pins.push({ pin: p, x, y: cy - PIN_H / 2, w: PIN_W, h: PIN_H, nameX: bodyX + 10, nameY: cy, nameAnchor: 'start', labelX: x - 16, labelY: cy, labelAnchor: 'end', side: 'left' })
  })
  sides.right.forEach((p, i) => {
    const cy = bodyY + 12 + i * QUAD_PITCH + QUAD_PITCH / 2
    const x = bodyX + bodyW + GAP
    pins.push({ pin: p, x, y: cy - PIN_H / 2, w: PIN_W, h: PIN_H, nameX: bodyX + bodyW - 10, nameY: cy, nameAnchor: 'end', labelX: x + PIN_W + 16, labelY: cy, labelAnchor: 'start', side: 'right' })
  })
  sides.top.forEach((p, i) => {
    const cx = bodyX + 12 + i * QUAD_PITCH + QUAD_PITCH / 2
    const y = bodyY - GAP - PIN_W
    pins.push({ pin: p, x: cx - PIN_H / 2, y, w: PIN_H, h: PIN_W, nameX: cx, nameY: bodyY + 16, nameAnchor: 'middle', labelX: cx, labelY: y - 12, labelAnchor: 'start', side: 'top' })
  })
  sides.bottom.forEach((p, i) => {
    const cx = bodyX + 12 + i * QUAD_PITCH + QUAD_PITCH / 2
    const y = bodyY + bodyH + GAP
    pins.push({ pin: p, x: cx - PIN_H / 2, y, w: PIN_H, h: PIN_W, nameX: cx, nameY: bodyY + bodyH - 16, nameAnchor: 'middle', labelX: cx, labelY: y + PIN_W + 12, labelAnchor: 'end', side: 'bottom' })
  })
  return { width, height, body: { x: bodyX, y: bodyY, w: bodyW, h: bodyH }, pins, rotation: 0 }
}

/** 绕画布中心旋转 90° 步进；文字保持水平。 */
export function computePackageGeometry(chip: ChipData, rotation = 0): PackageGeometry {
  const base = baseLayout(chip)
  const steps = ((Math.round(rotation / 90) % 4) + 4) % 4
  if (steps === 0) return base

  const cx = base.width / 2
  const cy = base.height / 2
  const newW = steps % 2 === 1 ? base.height : base.width
  const newH = steps % 2 === 1 ? base.width : base.height
  // 旋转后画布中心：奇数步宽高互换
  const ncx = newW / 2
  const ncy = newH / 2
  const rot = (x: number, y: number): [number, number] => {
    let dx = x - cx
    let dy = y - cy
    for (let s = 0; s < steps; s++) {
      const t = dx
      dx = -dy
      dy = t
    }
    return [dx + ncx, dy + ncy]
  }

  const pins = base.pins.map((p) => {
    const [px, py] = rot(p.x + p.w / 2, p.y + p.h / 2)
    const w = steps % 2 === 1 ? p.h : p.w
    const h = steps % 2 === 1 ? p.w : p.h
    const [nx, ny] = rot(p.nameX, p.nameY)
    const [lx, ly] = rot(p.labelX, p.labelY)
    return {
      ...p,
      x: px - w / 2,
      y: py - h / 2,
      w,
      h,
      nameX: nx,
      nameY: ny,
      labelX: lx,
      labelY: ly,
    }
  })
  const [bx, by] = rot(base.body.x + base.body.w / 2, base.body.y + base.body.h / 2)
  const bw = steps % 2 === 1 ? base.body.h : base.body.w
  const bh = steps % 2 === 1 ? base.body.w : base.body.h
  return {
    width: newW,
    height: newH,
    body: { x: bx - bw / 2, y: by - bh / 2, w: bw, h: bh },
    pins,
    rotation: steps * 90,
  }
}

/** 引脚状态 → 配色（§8.4）。 */
export type PinVisualState = 'unassigned' | 'gpio' | 'af' | 'special' | 'power' | 'conflict'

export function pinColors(state: PinVisualState): { bg: string; fg: string; border: string } {
  switch (state) {
    case 'gpio':
      return { bg: '#BFEA9A', fg: '#1D5B2A', border: '#9BD46E' }
    case 'af':
      return { bg: '#DDEBFA', fg: '#2A62B7', border: '#B9D4F0' }
    case 'special':
      return { bg: '#EDEFF3', fg: '#616161', border: '#D5D9E0' }
    case 'power':
      return { bg: '#F7F8FA', fg: '#8A8F98', border: '#E4E9F2' }
    case 'conflict':
      return { bg: '#FDE7E7', fg: '#C00000', border: '#F3B9B9' }
    default:
      return { bg: '#FFFFFF', fg: '#616161', border: '#D0D5DD' }
  }
}