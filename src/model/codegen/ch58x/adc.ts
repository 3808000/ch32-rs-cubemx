// adc.rs 渲染：ch58x-hal ADC（Config non_exhaustive；通道以裸引脚单例字段暴露）。
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { PeriModule } from './derive'
import { pinType } from './derive'
import { render } from '../render'
import * as T from './templates'

export function renderAdc(usages: PeripheralUsage[]): PeriModule | null {
  const insts = enabledUsage(usages, 'adc')
  if (insts.length === 0) return null

  const samplingClock = insts[0].params.samplingClock ?? '_3_2MHz'
  const pgaGain = insts[0].params.pgaGain ?? 'GAIN1_2'
  const channels = insts.flatMap((u) =>
    u.pins.map((p) => ({
      channel: p.role, // ADC_IN0
      field: p.role.toLowerCase(), // adc_in0
      pin: p.pin,
    })),
  )

  const content = render(T.ADC_RS_TPL, { samplingClock, pgaGain, channels })
  return {
    file: { path: 'src/generated/adc.rs', content },
    module: 'adc',
    fields: [
      ...insts.map((u) => ({
        name: u.id.toLowerCase(),
        type: 'adc::Adc',
        init: `adc::init_adc(p.${u.id})`,
      })),
      // ANALOG 引脚：裸单例字段（g.adc.read(&mut g.adc_in0)）
      ...channels.map((c) => ({
        name: c.field,
        type: pinType(c.pin),
        init: `p.${c.pin}`,
      })),
    ],
  }
}
