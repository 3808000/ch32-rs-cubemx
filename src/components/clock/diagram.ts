import { anchorIn, crossesForeignWire, sharesForeignSegment } from '@/model/clock/tree'
import type { ClockPt, ClockTreeEdge, ClockTreeLayout, ClockTreeNode } from '@/model/clock/tree'
import { computeHighlightSet, edgeInHighlight } from '@/components/clock/graph'

const PERIPHERALS_PER_COLUMN = 6
const MAX_TRUNK_GAP = 64
const SECTION_GAP = 28
const GROUP_GAP = 12
const PERIPHERAL_WIDTH = 158
const PERIPHERAL_HEIGHT = 68
const INPUT_GUTTER = 48
const COLUMN_WIDTH = INPUT_GUTTER + PERIPHERAL_WIDTH + 8
const ROW_GAP = 6
const GROUP_TOP = 23
const GROUP_BOTTOM = 8

export interface ClockInputReference {
  edge: ClockTreeEdge
  anchor: ClockPt
  label: string
  showLabel: boolean
}

const SIGNAL_NAMES: Record<string, string> = {
  AHB: 'HCLK',
  APB1: 'PCLK1',
  APB2: 'PCLK2',
  ADC: 'ADCCLK',
}

function clockSignalName(nodeId: string): string {
  return SIGNAL_NAMES[nodeId] ?? nodeId
}

export function isLowSpeedWire(edge: ClockTreeEdge): boolean {
  return edge.to === 'IWDG' || ['LSI', 'LSE', 'CK32K', 'RTC'].includes(edge.from)
}

export function isClockSelectionWire(edge: ClockTreeEdge): boolean {
  return edge.to === 'PLL' || edge.to === 'SYSCLK'
}

/** 只压缩两组节点之间的水平空白。单调映射保留节点尺寸、走线的正交性以及端口的相对位置。 */
function compactTrunkX(nodes: readonly ClockTreeNode[]) {
  const gaps: { start: number; end: number; shrink: number }[] = []
  let right = 0
  for (const node of [...nodes].sort((a, b) => a.x - b.x)) {
    const width = node.x - right
    if (width > MAX_TRUNK_GAP) gaps.push({ start: right, end: node.x, shrink: width - MAX_TRUNK_GAP })
    right = Math.max(right, node.x + node.w)
  }
  return (x: number) => x - gaps.reduce((total, gap) => {
    const fraction = Math.max(0, Math.min(1, (x - gap.start) / (gap.end - gap.start)))
    return total + fraction * gap.shrink
  }, 0)
}

/** 长距离外设输入和折返辅助输入用信号名接入，逻辑边保留原有来源和目标。 */
export function arrangeClockDiagram(layout: ClockTreeLayout) {
  const peripherals = layout.nodes.filter((node) => node.kind === 'peri')

  const peripheralIds = new Set(peripherals.map((node) => node.id))
  const groupLabels = new Map(layout.groups.map((group) => [group.id, group.label]))
  const peripheralGroups = new Map<string, ClockTreeNode[]>()
  for (const node of peripherals) {
    const members = peripheralGroups.get(node.group) ?? []
    members.push(node)
    peripheralGroups.set(node.group, members)
  }

  const mainNodes = layout.nodes.filter((node) => !peripheralIds.has(node.id))
  const compactX = compactTrunkX(mainNodes)
  const mainById = new Map(mainNodes.map((node) => [node.id, { ...node, x: compactX(node.x) }]))
  const namedAuxInputs = new Set<string>()
  for (const edge of layout.edges) {
    const from = mainById.get(edge.from)
    const to = mainById.get(edge.to)
    if (from && to?.displayOnly && to.group === 'g-aux' && to.kind === 'mux' && from.x + from.w >= to.x) {
      namedAuxInputs.add(to.id)
    }
  }
  const inputs: ClockInputReference[] = []
  const groups = layout.groups.filter((group) => !peripheralGroups.has(group.id)).map((group) => ({
    ...group,
    x: compactX(group.x),
    w: compactX(group.x + group.w) - compactX(group.x),
  }))
  const edges: ClockTreeEdge[] = []
  const workingTrunk = computeHighlightSet(layout.edges.filter((edge) => edge.active), 'AHB', 'upstream')
  const priority = (edge: ClockTreeEdge) =>
    (edge.active ? 4 : 0) + (edge.active && edgeInHighlight(edge, workingTrunk) ? 2 : 0)
    + (isLowSpeedWire(edge) ? 2 : 0) + (isClockSelectionWire(edge) ? 3 : 0) + (mainById.get(edge.to)?.displayOnly ? 0 : 1)
  const lanes = [...layout.edges].sort((a, b) => priority(b) - priority(a))
  for (const edge of lanes) {
    if (peripheralIds.has(edge.to)) continue
    const points = edge.points.map((point) => ({ x: compactX(point.x), y: point.y }))
    const target = mainById.get(edge.to)
    // 系统选源保留可追踪的整根线。其他支路需要折返或相交时用同名端子。
    const turnsBack = points.slice(1).some((point, index) => point.x < points[index]!.x)
    if (target && ((namedAuxInputs.has(edge.to) && !isLowSpeedWire(edge)) || turnsBack || sharesForeignSegment(points, edge.from, edges)
      || (!isClockSelectionWire(edge) && crossesForeignWire(points, edge.from, edges)))) {
      const inputIndex = edge.inputIndex ?? target.muxInputs?.indexOf(edge.from) ?? -1
      inputs.push({
        edge,
        anchor: anchorIn(target, edge.from, edge.inputIndex),
        label: target.muxLabels?.[inputIndex] ?? clockSignalName(edge.from),
        showLabel: inputIndex < 0,
      })
      continue
    }
    edges.push({ ...edge, points, labelAt: { x: compactX(edge.labelAt.x), y: edge.labelAt.y } })
  }
  if (!peripherals.length) {
    return { ...layout, width: compactX(layout.width), nodes: [...mainById.values()], groups, edges, inputs, peripheralSection: null }
  }
  const mainRight = Math.max(0,
    ...[...mainById.values()].map((node) => node.x + node.w),
    ...groups.map((group) => group.x + group.w),
    ...edges.flatMap((edge) => edge.points.map((point) => point.x)),
  )
  const x = mainRight + SECTION_GAP
  const y = 18
  // 双列优先在外设类别的边界断开，避免同类控件分散在两列。
  const halfway = Math.ceil(peripherals.length / 2)
  let rowsPerColumn = peripherals.length
  if (peripherals.length > PERIPHERALS_PER_COLUMN) {
    rowsPerColumn = halfway
    let boundary = 0
    let distance = 2
    for (const members of peripheralGroups.values()) {
      boundary += members.length
      if (boundary < peripherals.length && Math.abs(boundary - halfway) < distance) {
        rowsPerColumn = boundary
        distance = Math.abs(boundary - halfway)
      }
    }
  }
  const placed = new Map<string, ClockTreeNode>()
  let column = 0
  let rows = 0
  let top = y + 34
  let bottom = y
  for (const [id, members] of peripheralGroups) {
    const fullLabel = groupLabels.get(id) ?? members[0]!.label
    const label = fullLabel.split(/[（(]/, 1)[0]!.trim()
    for (let offset = 0; offset < members.length;) {
      if (column === 0 && rows === rowsPerColumn) {
        column++
        rows = 0
        top = y + 34
      }
      const band = column === 0 ? members.slice(offset, offset + rowsPerColumn - rows) : members.slice(offset)
      const left = x + column * (COLUMN_WIDTH + GROUP_GAP)
      let nodeY = top + GROUP_TOP
      for (const node of band) {
        placed.set(node.id, { ...node, x: left + INPUT_GUTTER, y: nodeY, w: PERIPHERAL_WIDTH, h: PERIPHERAL_HEIGHT })
        nodeY += PERIPHERAL_HEIGHT + ROW_GAP
      }
      const height = nodeY - ROW_GAP + GROUP_BOTTOM - top
      groups.push({
        id: offset ? `${id}-${offset}` : id,
        label: offset ? `${label}（续）` : label,
        x: left,
        y: top,
        w: COLUMN_WIDTH,
        h: height,
      })
      offset += band.length
      rows += band.length
      bottom = Math.max(bottom, top + height + 14)
      top += height + GROUP_GAP
    }
  }

  for (const edge of layout.edges) {
    const target = placed.get(edge.to)
    if (!target) continue
    inputs.push({
      edge,
      anchor: anchorIn(target),
      label: target.inputClockLabel === 'CK32M' ? 'CK32M' : clockSignalName(edge.from),
      showLabel: true,
    })
  }

  const width = (column + 1) * COLUMN_WIDTH + column * GROUP_GAP
  return {
    width: x + width + 24,
    height: 28 + Math.max(
      bottom,
      ...mainNodes.map((node) => node.y + node.h),
      ...groups.map((group) => group.y + group.h),
      ...edges.flatMap((edge) => edge.points.map((point) => point.y)),
    ),
    nodes: layout.nodes.map((node) => placed.get(node.id) ?? mainById.get(node.id)!),
    groups,
    edges,
    inputs,
    peripheralSection: { x, y, w: width, h: bottom - y },
  }
}

// 沿同一来源的两条线寻找共享前缀的末端。只在实际分叉处绘制连接点。
function sharedBranch(a: readonly ClockPt[], b: readonly ClockPt[]): ClockPt | undefined {
  let point = a[0]
  if (!point || point.x !== b[0]?.x || point.y !== b[0]?.y) return
  let i = 1
  let j = 1
  while (i < a.length && j < b.length) {
    const p = a[i]!
    const q = b[j]!
    const dx = p.x - point.x
    const dy = p.y - point.y
    const ex = q.x - point.x
    const ey = q.y - point.y
    if (Math.sign(dx) !== Math.sign(ex) || Math.sign(dy) !== Math.sign(ey)) {
      return point === a[0] ? undefined : point
    }
    const distanceA = Math.abs(dx) + Math.abs(dy)
    const distanceB = Math.abs(ex) + Math.abs(ey)
    point = distanceA <= distanceB ? p : q
    if (distanceA <= distanceB) i++
    if (distanceB <= distanceA) j++
  }
}

export function findClockJunctions(edges: readonly ClockTreeEdge[]) {
  const sources = new Map<string, ClockTreeEdge[]>()
  const junctions = new Map<string, ClockPt & { active: boolean }>()
  for (const edge of edges) {
    const routes = sources.get(edge.from) ?? []
    for (const route of routes) {
      const point = sharedBranch(route.points, edge.points)
      if (!point) continue
      const key = `${point.x},${point.y}`
      const active = junctions.get(key)?.active || edge.active || route.active
      junctions.set(key, { ...point, active })
    }
    routes.push(edge)
    sources.set(edge.from, routes)
  }
  return [...junctions.values()]
}

/** 同源重叠区间只绘制一次，沿用最后一条边（视觉优先级最高）的颜色和状态。 */
export function buildClockStrokes(edges: readonly ClockTreeEdge[]) {
  type Span = { edgeId: string; start: number; end: number }
  type Stroke = Span & { fixed: number }
  const tracks = new Map<string, { horizontal: boolean; fixed: number; spans: Span[] }>()
  const sourceEdges = new Map<string, string>()
  const edgeOrder = new Map(edges.map((edge, order) => [edge.id, { from: edge.from, order }]))
  for (const edge of edges) {
    sourceEdges.set(edge.from, edge.id)
    for (const [i, end] of edge.points.slice(1).entries()) {
      const start = edge.points[i]!
      const horizontal = start.y === end.y
      const fixed = horizontal ? start.y : start.x
      const a = horizontal ? start.x : start.y
      const b = horizontal ? end.x : end.y
      if (a === b) continue
      const key = `${edge.from}/${horizontal}/${fixed}`
      const track = tracks.get(key) ?? { horizontal, fixed, spans: [] }
      track.spans.push({ edgeId: edge.id, start: Math.min(a, b), end: Math.max(a, b) })
      tracks.set(key, track)
    }
  }

  const commands = new Map<string, string[]>()
  const horizontalStrokes: Stroke[] = []
  const verticalStrokes: Stroke[] = []
  for (const { horizontal, fixed, spans } of tracks.values()) {
    const cuts = [...new Set(spans.flatMap(({ start, end }) => [start, end]))].sort((a, b) => a - b)
    const pieces: Span[] = []
    spans.reverse()
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1]!
      const end = cuts[i]!
      const winner = spans.find((span) => span.start <= start && span.end >= end)
      if (!winner) continue
      const last = pieces.at(-1)
      if (last?.edgeId === winner.edgeId && last.end === start) last.end = end
      else pieces.push({ edgeId: winner.edgeId, start, end })
    }
    for (const { edgeId, start, end } of pieces) {
      const path = commands.get(edgeId) ?? []
      path.push(horizontal ? `M ${start} ${fixed} H ${end}` : `M ${fixed} ${start} V ${end}`)
      commands.set(edgeId, path)
      const strokes = horizontal ? horizontalStrokes : verticalStrokes
      strokes.push({ edgeId, start, end, fixed })
    }
  }

  // 异源正交交越处给下层线留缺口。点只用于同源的实际分叉。
  const gaps = new Map<string, Map<string, ClockPt>>()
  for (const horizontal of horizontalStrokes) {
    const h = edgeOrder.get(horizontal.edgeId)!
    for (const vertical of verticalStrokes) {
      const v = edgeOrder.get(vertical.edgeId)!
      const x = vertical.fixed
      const y = horizontal.fixed
      if (h.from === v.from || x < horizontal.start || x > horizontal.end || y < vertical.start || y > vertical.end) continue
      const under = h.order < v.order ? horizontal : vertical
      const points = gaps.get(under.edgeId) ?? new Map<string, ClockPt>()
      points.set(`${x}/${y}`, { x, y })
      gaps.set(under.edgeId, points)
    }
  }
  return {
    paths: new Map([...commands].map(([id, path]) => [id, path.join(' ')])),
    sources: new Set(sourceEdges.values()),
    gaps: new Map([...gaps].map(([id, points]) => [id, [...points.values()]])),
  }
}
