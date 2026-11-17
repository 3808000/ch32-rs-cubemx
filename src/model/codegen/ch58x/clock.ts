// clock.rs 渲染：ch58x-hal 时钟配方（预设方法或显式 ClockSrc::PLL(div)）。
// BLE 档不再追加 enable_lse()（M13）：板子可能无 LSE 晶振，HAL 的 enable_lse() 强制 XT=1 无回退；
// 保持 LSI 缺省，BLE 库在 SelRTCClock=0 时内部回退（实机 C 固件同配置，证据 HAL notes §14.2bis）。
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
  })
  return { path: 'src/generated/clock.rs', content }
}
