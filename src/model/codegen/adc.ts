// adc.rs 渲染：ADC 初始化（通道 = 引脚字段，convert/blocking_read 两代 API）。
import type { DeviceData } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { PeriModule } from './derive'
import { render } from './render'
import { periType, pinIdent, typeNameOf } from './util'
import * as T from './templates'

export function renderAdc(usages: PeripheralUsage[], data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'adc')
  if (insts.length === 0) return null
  // H4/V4x7：Adc::new 返回 Result，读通道用 blocking_read（v1/v3 用 convert）
  const adcApi = data.peripherals.adcApi ?? 'convert'

  const instances = insts.map((u) => {
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const channels = u.pins.map((p) => ({
      channel: p.role, // 'ADC_IN1'
      field: p.role.replace(/^ADC_/i, '').toLowerCase(), // 'in1'
      pin: p.pin,
      param: pinIdent(p.pin),
    }))
    const params = [`adc_peri: ${periType(u.id)}`, ...channels.map((c) => `${c.param}: ${periType(c.pin)}`)].join(', ')
    return {
      id: u.id,
      typeName,
      initFn,
      fieldName: u.id.toLowerCase(),
      channels,
      params,
      sampleTime: u.params.sampleTime ?? 'CYCLES73',
    }
  })

  const content = render(T.ADC_TPL, { instances, adcApi })
  return {
    file: { path: `${base}src/generated/adc.rs`, content },
    module: 'adc',
    fields: instances.map((i) => ({
      name: i.fieldName,
      type: `adc::${i.typeName}`,
      call: `adc::${i.initFn}(${['p.' + i.id, ...i.channels.map((c) => `p.${c.pin}`)].join(', ')})`,
    })),
    irqs: [],
  }
}