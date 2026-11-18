// 跨视图定位外设实例（M15）：Clock 视图右键 Configure / 详情面板「在外设视图配置」在
// setView('peripherals') 后请求打开某个外设对象页。
// PeripheralsView 未挂载时先暂存 pending，挂载后消费；已挂载时通过 window 事件即时响应。
// 结构与 components/clock/clockFocus.ts 一致（request / take / subscribe 单例桥）。

const PERIPHERAL_FOCUS_EVENT = 'ch32:peripheral-focus'

let pendingPeripheral: string | null = null

/** 请求打开外设实例对象页（可在 PeripheralsView 挂载前调用）。 */
export function requestPeripheralFocus(periId: string): void {
  pendingPeripheral = periId
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>(PERIPHERAL_FOCUS_EVENT, { detail: periId }))
  }
}

/** PeripheralsView 挂载时消费挂起请求（无请求返回 null）。 */
export function takePeripheralFocus(): string | null {
  const id = pendingPeripheral
  pendingPeripheral = null
  return id
}

/** PeripheralsView 已挂载时订阅请求；返回取消订阅函数。 */
export function subscribePeripheralFocus(cb: (periId: string) => void): () => void {
  const handler = (e: Event) => {
    pendingPeripheral = null
    cb((e as CustomEvent<string>).detail)
  }
  window.addEventListener(PERIPHERAL_FOCUS_EVENT, handler)
  return () => window.removeEventListener(PERIPHERAL_FOCUS_EVENT, handler)
}
