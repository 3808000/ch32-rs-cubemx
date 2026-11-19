// adc.rs 渲染：ch5xx-hal ADC（Config non_exhaustive；通道 = GPIO 单例，blocking_read(&mut pin)）。
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { PeriModule } from './derive'
import { adcGainVariant, pinPeriType, sampleClockVariant } from './derive'
import { render } from '../render'
import * as T from './templates'

export function renderAdc(usages: PeripheralUsage[]): PeriModule | null {
  const insts = enabledUsage(usages, 'adc')
  if (insts.length === 0) return null

  const samplingClock = sampleClockVariant(insts[0].params.samplingClock)
  const pgaGain = adcGainVariant(insts[0].params.pgaGain)
  const channels = insts.flatMap((u) =>
    u.pins.map((p) => ({
      channel: p.role, // ADC_IN0
      field: p.role.toLowerCase(), // adc_in0
      pin: p.pin,
    })),
  )

  const content = render(T.ADC_RS_TPL, {
    samplingClock,
    pgaGain,
    periType: pinPeriType(insts[0].id),
    channels,
  })
  return {
    file: { path: 'src/generated/adc.rs', content },
    module: 'adc',
    fields: [
      ...insts.map((u) => ({
        name: u.id.toLowerCase(),
        type: 'adc::Adc',
        init: `adc::init_adc(p.${u.id})`,
      })),
      // ANALOG 引脚：GPIO 单例（g.adc.blocking_read(&mut g.adc_in0)）
      ...channels.map((c) => ({
        name: c.field,
        type: pinPeriType(c.pin),
        init: `p.${c.pin}`,
      })),
    ],
  }
}