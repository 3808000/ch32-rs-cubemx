// 时钟树路径高亮纯函数（M15）：沿 layout.edges 做 BFS，返回需要点亮的节点 id 集合。
// 不依赖 store / Vue；上游=只沿入边回溯（source path），双向=上下游闭包（all paths）。

/** 高亮模式：upstream=仅上游链；both=上下游全闭包。 */
export type HighlightMode = 'upstream' | 'both'

export interface GraphEdge {
  from: string
  to: string
}

/**
 * 从 startId 出发计算高亮节点集合（始终包含起点）。
 * - upstream：只沿「边指向当前节点」回溯（祖先链）；
 * - both：沿无向邻接遍历（祖先 + 后代全闭包）。
 * 边集为空或起点不存在时仍返回仅含起点的集合（调用方可据此显示单节点高亮）。
 */
export function computeHighlightSet(
  edges: readonly GraphEdge[],
  startId: string,
  mode: HighlightMode = 'upstream',
): Set<string> {
  const seen = new Set<string>([startId])
  const queue: string[] = [startId]
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const e of edges) {
    const inc = incoming.get(e.to)
    if (inc) inc.push(e.from)
    else incoming.set(e.to, [e.from])
    if (mode === 'both') {
      const out = outgoing.get(e.from)
      if (out) out.push(e.to)
      else outgoing.set(e.from, [e.to])
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!
    const next = mode === 'both' ? [...(incoming.get(cur) ?? []), ...(outgoing.get(cur) ?? [])] : (incoming.get(cur) ?? [])
    for (const id of next) {
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(id)
    }
  }
  return seen
}

/** 边是否落在高亮集合内（两端都被点亮才高亮；用于 ClockCanvas 的连线 dim）。 */
export function edgeInHighlight(edge: GraphEdge, ids: ReadonlySet<string>): boolean {
  return ids.has(edge.from) && ids.has(edge.to)
}
