// 跨视图定位时钟节点：CheckDialog 等组件在 setView('clock') 后请求聚焦某个节点。
// ClockView 未挂载时先暂存 pending，挂载后消费；已挂载时通过 window 事件即时响应。

const CLOCK_FOCUS_EVENT = 'ch32:clock-focus'

let pendingNode: string | null = null

/** 请求聚焦时钟节点（可在 ClockView 挂载前调用）。 */
export function requestClockFocus(nodeId: string): void {
  pendingNode = nodeId
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>(CLOCK_FOCUS_EVENT, { detail: nodeId }))
  }
}

/** ClockView 挂载时消费挂起请求（无请求返回 null）。 */
export function takeClockFocus(): string | null {
  const id = pendingNode
  pendingNode = null
  return id
}

/** ClockView 已挂载时订阅聚焦请求；返回取消订阅函数。 */
export function subscribeClockFocus(cb: (nodeId: string) => void): () => void {
  const handler = (e: Event) => {
    pendingNode = null
    cb((e as CustomEvent<string>).detail)
  }
  window.addEventListener(CLOCK_FOCUS_EVENT, handler)
  return () => window.removeEventListener(CLOCK_FOCUS_EVENT, handler)
}