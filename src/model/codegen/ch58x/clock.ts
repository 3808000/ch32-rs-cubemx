// clock.rs 渲染：ch58x-hal 时钟配方（预设方法或显式 ClockSrc::PLL(div)）。
// lse=true（BLE 开启）时追加 enable_lse()（契约 D3）。
import type { ClockPlan } from './derive'
import { render } from '../render'
import { fmtMhz } from '../util'
import * as T from './templates'

export function renderClock(plan: ClockPlan, lse = false) {
  const content = render(T.CLOCK_RS_TPL, {
    presetConst: plan.presetConst ?? null,
    presetLabel: plan.presetLabel ?? '',
    div: plan.div ?? 0,
    sysclk: fmtMhz(plan.sysclkMhz),
    lse,
  })
  return { path: 'src/generated/clock.rs', content }
}
