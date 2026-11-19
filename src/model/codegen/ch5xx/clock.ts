// clock.rs 渲染：ch5xx-hal 时钟配方（预设关联常量 / 显式 PLL(div) / HSE 直连）。
import type { GeneratedFile } from '@/model/types'
import type { ClockPlan } from './derive'
import { render } from '../render'
import { fmtMhz } from '../util'
import * as T from './templates'

export function renderClock(plan: ClockPlan): GeneratedFile {
  const content = render(T.CLOCK_RS_TPL, {
    presetConst: plan.presetConst ?? null,
    presetLabel: plan.presetLabel ?? '',
    div: plan.div ?? 0,
    hseDirect: plan.hseDirect ?? false,
    sysclk: fmtMhz(plan.sysclkMhz),
  })
  return { path: 'src/generated/clock.rs', content }
}