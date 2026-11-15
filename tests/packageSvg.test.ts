// 封装图几何单元测试：dual/quad 布局、90° 步进旋转、引脚配色。
// 数据：真实 CH32V003F4P6（dual TSSOP20，每边 10 脚）；quad 用合成数据。
import { describe, it, expect } from 'vitest'
import { computePackageGeometry, pinColors } from '../src/lib/packageSvg'
import {
  normalizeAngle,
  normalizeSigned,
  readableAngle,
  readabilityFlip,
  nextTiltAngle,
  topAngle,
  packageCanvasSide,
  packageCanvasOffset,
  pinNameFontSize,
  pinOuterText,
} from '../src/components/PackageCanvas.vue'
import type { ChipData, ChipPin, PinAssignment } from '../src/types'
import { getDeviceData } from '../src/data/device'

const chip = getDeviceData('CH32V003F4P6').chip

/** 合成 quad 芯片（8 脚，每边 2 脚） */
function quadChip(): ChipData {
  const mk = (number: number, name: string, side: ChipPin['side']): ChipPin => ({
    number,
    name,
    type: 'IO',
    side,
    special: null,
    ft: false,
    adc: [],
  })
  return {
    chip: 'QUADTEST',
    family: 'TEST',
    core: 'TEST',
    package: 'TEST8',
    packageKind: 'quad',
    pinsPerSide: 2,
    flash: '1K',
    sram: '1K',
    deviceId: '0x0',
    halFeature: 'test',
    target: 'test',
    nightly: false,
    remapModel: 'afio_v1',
    source: 'test',
    pins: [
      mk(1, 'PA0', 'left'),
      mk(2, 'PA1', 'left'),
      mk(3, 'PB0', 'bottom'),
      mk(4, 'PB1', 'bottom'),
      mk(5, 'PC0', 'right'),
      mk(6, 'PC1', 'right'),
      mk(7, 'PD0', 'top'),
      mk(8, 'PD1', 'top'),
    ],
  }
}

describe('dual 封装（真实 V003，20 脚）', () => {
  it('总引脚数 20，左右各 10', () => {
    const g = computePackageGeometry(chip)
    expect(g.pins).toHaveLength(20)
    expect(g.pins.filter((p) => p.side === 'left')).toHaveLength(10)
    expect(g.pins.filter((p) => p.side === 'right')).toHaveLength(10)
    expect(g.pins.filter((p) => p.side === 'top' || p.side === 'bottom')).toHaveLength(0)
  })

  it('左侧引脚按编号 1..10 自上而下排布', () => {
    const g = computePackageGeometry(chip)
    const left = g.pins.filter((p) => p.side === 'left')
    const sorted = [...left].sort((a, b) => a.pin.number - b.pin.number)
    expect(sorted.map((p) => p.pin.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // y 随编号递增
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThan(sorted[i - 1].y)
    // 画布上是第一个引脚
    expect(left.reduce((m, p) => (p.y < m.y ? p : m)).pin.number).toBe(1)
  })

  it('右侧引脚：编号 20 在上、11 在下（IC 逆时针编号）', () => {
    const g = computePackageGeometry(chip)
    const right = g.pins.filter((p) => p.side === 'right')
    expect(right).toHaveLength(10)
    const topmost = right.reduce((m, p) => (p.y < m.y ? p : m))
    const bottommost = right.reduce((m, p) => (p.y > m.y ? p : m))
    expect(topmost.pin.number).toBe(20)
    expect(bottommost.pin.number).toBe(11)
    // 自上而下编号递减
    const sorted = [...right].sort((a, b) => a.y - b.y)
    expect(sorted.map((p) => p.pin.number)).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11])
  })

  it('左侧引脚：名称锚点 start（芯片内侧）、标签锚点 end（外侧）', () => {
    const g = computePackageGeometry(chip)
    const left = g.pins.find((p) => p.side === 'left')!
    expect(left.nameAnchor).toBe('start')
    expect(left.labelAnchor).toBe('end')
    expect(left.labelX).toBeLessThan(left.x)
    expect(left.nameX).toBeGreaterThan(left.x + left.w)
  })

  it('右侧引脚：名称锚点 end、标签锚点 start（外侧）', () => {
    const g = computePackageGeometry(chip)
    const right = g.pins.find((p) => p.side === 'right')!
    expect(right.nameAnchor).toBe('end')
    expect(right.labelAnchor).toBe('start')
    expect(right.labelX).toBeGreaterThan(right.x + right.w)
  })

  it('未旋转时全部引脚都在画布内', () => {
    const g = computePackageGeometry(chip)
    for (const p of g.pins) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(g.width)
      expect(p.y + p.h).toBeLessThanOrEqual(g.height)
    }
  })

  it('未旋转时芯片主体在画布内', () => {
    const g = computePackageGeometry(chip)
    expect(g.body.x).toBeGreaterThanOrEqual(0)
    expect(g.body.y).toBeGreaterThanOrEqual(0)
    expect(g.body.x + g.body.w).toBeLessThanOrEqual(g.width)
    expect(g.body.y + g.body.h).toBeLessThanOrEqual(g.height)
  })

  it('rotation 字段等于 0', () => {
    expect(computePackageGeometry(chip).rotation).toBe(0)
  })
})

describe('dual 旋转 90/180/270', () => {
  const base = computePackageGeometry(chip)

  it('旋转 90°：宽高互换（476×658 ↔ 658×476），引脚数不变', () => {
    const g = computePackageGeometry(chip, 90)
    expect(g.width).toBe(base.height)
    expect(g.height).toBe(base.width)
    expect(g.pins).toHaveLength(20)
    expect(g.rotation).toBe(90)
  })

  it('旋转 180°：宽高不变，引脚数不变', () => {
    const g = computePackageGeometry(chip, 180)
    expect(g.width).toBe(base.width)
    expect(g.height).toBe(base.height)
    expect(g.pins).toHaveLength(20)
    expect(g.rotation).toBe(180)
  })

  it('旋转 270°：宽高互换，引脚数不变', () => {
    const g = computePackageGeometry(chip, 270)
    expect(g.width).toBe(base.height)
    expect(g.height).toBe(base.width)
    expect(g.pins).toHaveLength(20)
    expect(g.rotation).toBe(270)
  })

  it('旋转 90° 后引脚胶囊横竖互换（w/h 交换）', () => {
    const g = computePackageGeometry(chip, 90)
    const byName = (name: string) => g.pins.find((p) => p.pin.name === name)!
    const baseByName = (name: string) => base.pins.find((p) => p.pin.name === name)!
    const pd5 = byName('PD5') // 原左侧水平胶囊
    const b = baseByName('PD5')
    expect(pd5.w).toBe(b.h)
    expect(pd5.h).toBe(b.w)
  })

  it('旋转 360° 等价于不旋转（rotation=0，尺寸还原）', () => {
    const g = computePackageGeometry(chip, 360)
    expect(g.rotation).toBe(0)
    expect(g.width).toBe(base.width)
    expect(g.height).toBe(base.height)
  })

  it('旋转 450° 归一化为 90°', () => {
    const g = computePackageGeometry(chip, 450)
    expect(g.rotation).toBe(90)
    expect(g.width).toBe(base.height)
  })

  it('负角度 -90° 归一化为 270°', () => {
    const g = computePackageGeometry(chip, -90)
    expect(g.rotation).toBe(270)
  })

  it('旋转 90° 后每个引脚仍是唯一引脚（不丢失/不重复）', () => {
    const g = computePackageGeometry(chip, 90)
    const names = g.pins.map((p) => p.pin.name)
    expect(new Set(names).size).toBe(20)
  })

  // ---- 旋转后几何必须完整落在画布内（曾有的双重居中 bug 已修复） ----
  it('旋转 90° 后引脚应在画布内', () => {
    const g = computePackageGeometry(chip, 90)
    for (const p of g.pins) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(g.width)
      expect(p.y + p.h).toBeLessThanOrEqual(g.height)
    }
  })
  it('旋转 180° 后引脚应在画布内', () => {
    const g = computePackageGeometry(chip, 180)
    for (const p of g.pins) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y + p.h).toBeLessThanOrEqual(g.height)
    }
  })
  it('旋转 270° 后引脚应在画布内', () => {
    const g = computePackageGeometry(chip, 270)
    for (const p of g.pins) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(g.width)
    }
  })
})

describe('quad 封装（合成数据）', () => {
  it('四边各 2 脚、总 8 脚', () => {
    const g = computePackageGeometry(quadChip())
    expect(g.pins).toHaveLength(8)
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(g.pins.filter((p) => p.side === side)).toHaveLength(2)
    }
  })

  it('正方形画布与正方形主体（width=height）', () => {
    const g = computePackageGeometry(quadChip())
    expect(g.width).toBe(g.height)
    expect(g.body.w).toBe(g.body.h)
  })

  it('上/下边引脚竖放（w=24、h=62），左/右边横放（w=62、h=24）', () => {
    const g = computePackageGeometry(quadChip())
    const top = g.pins.find((p) => p.side === 'top')!
    const bottom = g.pins.find((p) => p.side === 'bottom')!
    const left = g.pins.find((p) => p.side === 'left')!
    const right = g.pins.find((p) => p.side === 'right')!
    expect([top.w, bottom.w]).toEqual([24, 24])
    expect([top.h, bottom.h]).toEqual([62, 62])
    expect([left.w, right.w]).toEqual([62, 62])
    expect([left.h, right.h]).toEqual([24, 24])
  })

  it('上边引脚在主体上方，下边在主体下方', () => {
    const g = computePackageGeometry(quadChip())
    const top = g.pins.find((p) => p.side === 'top')!
    const bottom = g.pins.find((p) => p.side === 'bottom')!
    expect(top.y + top.h).toBeLessThanOrEqual(g.body.y)
    expect(bottom.y).toBeGreaterThanOrEqual(g.body.y + g.body.h)
  })

  it('左边引脚在主体左侧，右边在主体右侧', () => {
    const g = computePackageGeometry(quadChip())
    const left = g.pins.find((p) => p.side === 'left')!
    const right = g.pins.find((p) => p.side === 'right')!
    expect(left.x + left.w).toBeLessThanOrEqual(g.body.x)
    expect(right.x).toBeGreaterThanOrEqual(g.body.x + g.body.w)
  })

  it('未旋转时 quad 全部引脚都在画布内', () => {
    const g = computePackageGeometry(quadChip())
    for (const p of g.pins) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(g.width)
      expect(p.y + p.h).toBeLessThanOrEqual(g.height)
    }
  })

  it('quad 旋转 90° 引脚数不变、宽高互换', () => {
    const b = computePackageGeometry(quadChip())
    const g = computePackageGeometry(quadChip(), 90)
    expect(g.pins).toHaveLength(8)
    expect(g.width).toBe(b.height)
    expect(g.height).toBe(b.width)
  })

  it('上边引脚按编号降序自左向右（QFP 逆时针：7 在右、8 在左）', () => {
    const g = computePackageGeometry(quadChip())
    const top = g.pins.filter((p) => p.side === 'top').sort((a, b) => a.x - b.x)
    expect(top.map((p) => p.pin.number)).toEqual([8, 7])
  })
})

describe('quad 封装（真实 V203 LQFP48，逆时针编号）', () => {
  const v203 = getDeviceData('CH32V203C8T6').chip
  const g = computePackageGeometry(v203)
  const pinsOf = (side: 'left' | 'right' | 'top' | 'bottom') => g.pins.filter((p) => p.side === side)
  const center = (number: number) => {
    const p = g.pins.find((x) => x.pin.number === number)!
    return { x: p.x + p.w / 2, y: p.y + p.h / 2 }
  }

  it('四边各 12 脚、总 48 脚', () => {
    expect(g.pins).toHaveLength(48)
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(pinsOf(side)).toHaveLength(12)
    }
  })

  it('左边 1..12 自上而下', () => {
    const left = [...pinsOf('left')].sort((a, b) => a.y - b.y)
    expect(left.map((p) => p.pin.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('底边 13..24 自左向右', () => {
    const bottom = [...pinsOf('bottom')].sort((a, b) => a.x - b.x)
    expect(bottom.map((p) => p.pin.number)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
  })

  it('右边 25 在下、36 在上（自下而上 25..36）', () => {
    const right = [...pinsOf('right')].sort((a, b) => b.y - a.y)
    expect(right.map((p) => p.pin.number)).toEqual([25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36])
    // 25 是最靠下的右边引脚
    expect(pinsOf('right').reduce((m, p) => (p.y > m.y ? p : m)).pin.number).toBe(25)
  })

  it('顶边 37 在右、48 在左（自右向左 37..48）', () => {
    const top = [...pinsOf('top')].sort((a, b) => b.x - a.x)
    expect(top.map((p) => p.pin.number)).toEqual([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48])
    // 37 是最靠右的顶边引脚，48 是最靠左的
    expect(pinsOf('top').reduce((m, p) => (p.x > m.x ? p : m)).pin.number).toBe(37)
    expect(pinsOf('top').reduce((m, p) => (p.x < m.x ? p : m)).pin.number).toBe(48)
  })

  it('四角编号相邻：12→13、24→25、36→37、48→1 的胶囊中心距离足够近', () => {
    const corners: [number, number][] = [
      [12, 13], // 左下角
      [24, 25], // 右下角
      [36, 37], // 右上角
      [48, 1], // 左上角
    ]
    for (const [a, b] of corners) {
      const ca = center(a)
      const cb = center(b)
      // 相邻角脚应在一个引脚间距量级内（QUAD_PITCH=46，斜对角约 119）
      expect(Math.hypot(ca.x - cb.x, ca.y - cb.y)).toBeLessThan(130)
    }
  })
})

describe('封装图 45° 倾斜（PackageCanvas 纯函数）', () => {
  it('连点 8 次：每次 −45°，读数序列 0/315/270/…/45/0（对齐原版首次读数 315°）', () => {
    let raw = 0
    const readings: number[] = [normalizeAngle(raw)]
    for (let i = 0; i < 8; i++) {
      raw = nextTiltAngle(raw)
      readings.push(normalizeAngle(raw))
    }
    expect(readings).toEqual([0, 315, 270, 225, 180, 135, 90, 45, 0])
    // 原始值持续累减（负方向不回卷），CSS 过渡不会在 315°→0° 时反向转一整圈
    expect(raw).toBe(-360)
  })

  it('normalizeAngle：负角归一化到 [0, 360)', () => {
    expect(normalizeAngle(-45)).toBe(315)
    expect(normalizeAngle(-360)).toBe(0)
    expect(normalizeAngle(-405)).toBe(315)
    expect(normalizeAngle(0)).toBe(0)
  })

  it('Top 复位取最近的 360° 整倍数（最短方向回正，支持负角）', () => {
    expect(topAngle(0)).toBe(0)
    expect(topAngle(-45)).toBe(0)
    expect(topAngle(-90)).toBe(0)
    expect(topAngle(-225)).toBe(-360)
    expect(topAngle(-315)).toBe(-360)
    expect(topAngle(-405)).toBe(-360)
    expect(topAngle(45)).toBe(0)
    expect(topAngle(225)).toBe(360)
  })

  it('正方形画布边长 ≥ 布局对角线（任意角度不裁切）', () => {
    const g = computePackageGeometry(chip)
    const side = packageCanvasSide(g.width, g.height)
    expect(side).toBe(Math.ceil(Math.hypot(g.width, g.height)) + 24)
    expect(side).toBeGreaterThanOrEqual(Math.hypot(g.width, g.height))
    // 45° 时的轴对齐包围盒为 (w+h)/√2，必须落在画布内
    expect(side).toBeGreaterThanOrEqual((g.width + g.height) / Math.SQRT2)
  })

  it('quad 同样按对角线取正方形画布', () => {
    const g = computePackageGeometry(quadChip())
    const side = packageCanvasSide(g.width, g.height)
    expect(side).toBe(Math.ceil(Math.hypot(g.width, g.height)) + 24)
  })

  it('居中偏移：布局中心与画布中心重合', () => {
    const g = computePackageGeometry(chip)
    const side = packageCanvasSide(g.width, g.height)
    const { dx, dy } = packageCanvasOffset(g.width, g.height, side)
    expect(dx * 2 + g.width).toBeCloseTo(side, 10)
    expect(dy * 2 + g.height).toBeCloseTo(side, 10)
    expect(g.width / 2 + dx).toBeCloseTo(side / 2, 10)
    expect(g.height / 2 + dy).toBeCloseTo(side / 2, 10)
  })
})

describe('倾斜时文字可读性补偿（任意 45° 倍数不倒置）', () => {
  const angles = Array.from({ length: 8 }, (_, i) => i * 45)
  /** 视觉总旋转 = 封装旋转 + 文字基准朝向 + 自转补偿（取模到 (-180,180] 便于判断） */
  const visual = (R: number, base: number) => normalizeSigned(R + base + readabilityFlip(R, base))

  it('normalizeSigned：归一化到 (-180, 180]', () => {
    expect(normalizeSigned(0)).toBe(0)
    expect(normalizeSigned(180)).toBe(180)
    expect(normalizeSigned(-180)).toBe(180)
    expect(normalizeSigned(225)).toBe(-135)
    expect(normalizeSigned(-225)).toBe(135)
    expect(normalizeSigned(720)).toBe(0)
  })

  it('readableAngle：总旋转保持在 (-90°, 90°]，45° 斜排保留', () => {
    expect(readableAngle(45)).toBe(45)
    expect(readableAngle(-45)).toBe(-45)
    expect(readableAngle(90)).toBe(90)
    expect(readableAngle(135)).toBe(-45)
    expect(readableAngle(180)).toBe(0)
    expect(readableAngle(225)).toBe(45)
    expect(readableAngle(270)).toBe(-90)
    expect(readableAngle(315)).toBe(-45)
  })

  it('左/右文字：每个 45° 倍数下都不倒置（225° 读数时补 −180°）', () => {
    for (const R of angles) {
      const v = visual(R, 0)
      expect(v).toBeGreaterThanOrEqual(-90)
      expect(v).toBeLessThanOrEqual(90)
    }
    // 读数 225° → R = 135°，补偿 −180°（原实现此处文字倒置）
    expect(readabilityFlip(135, 0)).toBe(-180)
    expect(visual(135, 0)).toBe(-45)
  })

  it('顶/底文字（基准 −90°）同样保持可读', () => {
    for (const R of angles) {
      const v = visual(R, -90)
      expect(v).toBeGreaterThanOrEqual(-90)
      expect(v).toBeLessThanOrEqual(90)
    }
    // 0° 时竖排（−90°）不需要补偿；倾斜后仍随封装旋转
    expect(readabilityFlip(0, -90)).toBe(0)
    expect(readabilityFlip(45, -90)).toBe(0)
    expect(visual(45, -90)).toBe(-45)
  })

  it('补偿量连续累加（相邻步进差 ≤ 180°），CSS 过渡不会反向绕圈', () => {
    for (let i = 0; i < 16; i++) {
      const r0 = i * 45
      const r1 = r0 + 45
      if (readabilityFlip(r1, 0) - readabilityFlip(r0, 0) > 180) {
        throw new Error(`左/右补偿在 R=${r1} 出现 >180° 跳变`)
      }
      if (Math.abs(readabilityFlip(r1, 0) - readabilityFlip(r0, 0)) > 180) {
        throw new Error(`左/右补偿在 R=${r1} 出现跳变`)
      }
    }
  })
})

describe('胶囊内引脚名与外部标签（PackageCanvas 纯函数）', () => {
  const v203 = getDeviceData('CH32V203C8T6').chip
  const asg = (pin: string, extra: Partial<PinAssignment> = {}): PinAssignment => ({
    pin,
    mode: 'AF',
    params: {},
    ...extra,
  })

  it('pinNameFontSize：按名称长度自适应（≤3 字 12px、4 字 11px、≥5 字 10px）', () => {
    expect(pinNameFontSize('PA3')).toBe(12)
    expect(pinNameFontSize('NRST')).toBe(11)
    expect(pinNameFontSize('VDD_IO_1')).toBe(10)
  })

  it('外部标签优先级：用户标签 > 功能名 > 引脚名兜底', () => {
    const io = chip.pins.find((p) => p.type === 'IO' && !p.special)!
    expect(pinOuterText(io, asg(io.name, { label: 'LED_RUN', function: 'USART1_TX' }))).toBe('LED_RUN')
    expect(pinOuterText(io, asg(io.name, { function: 'USART1_TX' }))).toBe('USART1_TX')
    expect(pinOuterText(io, asg(io.name, { mode: 'OUTPUT' }))).toBe(io.name)
  })

  it('未配置 IO 脚也显示引脚名（对齐原版）', () => {
    const io = chip.pins.find((p) => p.type === 'IO' && !p.special)!
    expect(pinOuterText(io, undefined)).toBe(io.name)
  })

  it('电源脚无尾缀时显示 名称_序号（V003：VSS_7 / VDD_9）', () => {
    const vss = chip.pins.find((p) => p.name === 'VSS')!
    const vdd = chip.pins.find((p) => p.name === 'VDD')!
    expect(vss.type).toBe('POWER')
    expect(vss.number).toBe(7)
    expect(vdd.number).toBe(9)
    expect(pinOuterText(vss, undefined)).toBe('VSS_7')
    expect(pinOuterText(vdd, undefined)).toBe('VDD_9')
  })

  it('名称已带数字尾缀则原样显示（V203：VSS_1 / VDD_IO_1 / BOOT0）', () => {
    const vss1 = v203.pins.find((p) => p.name === 'VSS_1')!
    expect(vss1.number).toBe(23)
    expect(pinOuterText(vss1, undefined)).toBe('VSS_1')
    expect(pinOuterText(v203.pins.find((p) => p.name === 'VDD_IO_1')!, undefined)).toBe('VDD_IO_1')
    expect(pinOuterText(v203.pins.find((p) => p.name === 'BOOT0')!, undefined)).toBe('BOOT0')
  })

  it('特殊脚带用户标签时优先显示标签', () => {
    const pa1 = chip.pins.find((p) => p.name === 'PA1')! // OSC 特殊脚
    expect(pa1.special).toBeTruthy()
    expect(pinOuterText(pa1, asg(pa1.name, { label: 'XTAL_IN' }))).toBe('XTAL_IN')
  })
})

describe('pinColors', () => {
  it('gpio：绿色系配色', () => {
    expect(pinColors('gpio')).toEqual({ bg: '#BFEA9A', fg: '#1D5B2A', border: '#9BD46E' })
  })
  it('af：蓝色系配色', () => {
    expect(pinColors('af')).toEqual({ bg: '#DDEBFA', fg: '#2A62B7', border: '#B9D4F0' })
  })
  it('special：灰色系配色', () => {
    expect(pinColors('special')).toEqual({ bg: '#EDEFF3', fg: '#616161', border: '#D5D9E0' })
  })
  it('power：浅灰配色', () => {
    expect(pinColors('power')).toEqual({ bg: '#F7F8FA', fg: '#8A8F98', border: '#E4E9F2' })
  })
  it('conflict：红色系配色', () => {
    expect(pinColors('conflict')).toEqual({ bg: '#FDE7E7', fg: '#C00000', border: '#F3B9B9' })
  })
  it('unassigned（default 分支）：白底灰字', () => {
    expect(pinColors('unassigned')).toEqual({ bg: '#FFFFFF', fg: '#616161', border: '#D0D5DD' })
  })
  it('六种状态背景色互不相同', () => {
    const states = ['unassigned', 'gpio', 'af', 'special', 'power', 'conflict'] as const
    const bgs = states.map((s) => pinColors(s).bg)
    expect(new Set(bgs).size).toBe(6)
  })
  it('每种状态返回 bg/fg/border 三个字符串字段', () => {
    for (const s of ['unassigned', 'gpio', 'af', 'special', 'power', 'conflict'] as const) {
      const c = pinColors(s)
      expect(typeof c.bg).toBe('string')
      expect(typeof c.fg).toBe('string')
      expect(typeof c.border).toBe('string')
    }
  })
})
