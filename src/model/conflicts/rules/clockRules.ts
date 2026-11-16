// 时钟相关规则：HSE 与晶振引脚冲突 / 时钟配置合法性 / 不支持的组合与最近合法档位提示。
import { computeClock, nearestPreset, validateClock } from '@/model/clock'
import type { ConflictContext } from './context'

export function runClockRules(ctx: ConflictContext): void {
  const { config, data, pins, pinByName, push } = ctx

  // ---- OSC 引脚与时钟 ----
  const clockCfg = config.clock
  if (clockCfg) {
    const usesHse = clockCfg.source === 'HSE' || (clockCfg.source === 'PLL' && clockCfg.pllSource === 'HSE')
    if (usesHse) {
      for (const a of pins) {
        const chipPin = pinByName.get(a.pin)
        if (chipPin?.special === 'osc') {
          push({ code: 'SPECIAL_PIN_OSC', level: 'warning', message: `${a.pin} 是晶振引脚，但时钟树使用了 HSE，硬件上会冲突`, pins: [a.pin] })
        }
      }
    }

    // ---- 时钟合法性 ----
    const issues = validateClock(data.clock, clockCfg)
    for (const i of issues) {
      if (i.level === 'error') {
        push({ code: 'PERIPHERAL_CLOCK_INVALID', level: 'error', message: `时钟配置非法：${i.message}` })
      }
    }
    // 仅当配置存在 error（HAL 不支持该组合）时提示最近合法档位；
    // 合法但无预设的配置由生成器按显式 Config 兜底，不再发警告噪音（首屏默认 HSI 直连即属此类）。
    if (issues.some((i) => i.level === 'error')) {
      const f = computeClock(data.clock, clockCfg)
      const near = nearestPreset(data.clock, f.sysclkMhz || data.clock.sysclkMaxMhz)
      push({
        code: 'CLOCK_PRESET_UNAVAILABLE',
        level: 'warning',
        message: near ? `当前时钟组合不被 HAL 支持，最接近的合法档位：${near.label}` : '当前时钟组合不被 HAL 支持，且无可用预设',
      })
    }
  }
}