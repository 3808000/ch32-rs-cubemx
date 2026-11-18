// clock.rs 渲染：ch58x-hal 时钟配方（预设方法或显式 ClockSrc::PLL(div)）。
// BLE 档 32K 域由 ClockPlan.enableLse 决定（M14：ble.clock32k 缺省 lse → enable_lse()，
// 与 stack_init SelRTCClock=0 一致；实机连接建立已验证，证据 HAL notes §14.2quater）。
import type { ClockPlan } from './derive'
import { render } from '../render'
import { fmtMhz } from '../util'
import * as T from './templates'

export function renderClock(plan: ClockPlan) {
  const content = render(T.CLOCK_RS_TPL, {
    presetConst: plan.presetConst ?? null,
    presetLabel: plan.presetLabel ?? '',
    div: plan.div ?? 0,
    sysclk: fmtMhz(plan.sysclkMhz),
    enableLse: plan.enableLse ?? false,
  })
  return { path: 'src/generated/clock.rs', content }
}