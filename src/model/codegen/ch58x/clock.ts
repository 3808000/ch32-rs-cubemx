// clock.rs 渲染：ch58x-hal 时钟配方（预设方法或显式 ClockSrc::PLL(div)）。
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
