// usart.rs 渲染：ch5xx-hal UART 初始化（new_blocking；peri → rx → tx + const REMAP u8）。
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { PeriModule } from './derive'
import { dataBitsVariant, parityVariant, pinPeriType, remapConst, stopBitsVariant } from './derive'
import { render } from '../render'
import * as T from './templates'

/** UART 参数 → 显示描述（如 "115200 8N1"）。 */
function paramDesc(p: Record<string, string | number | boolean>): string {
  const bits = dataBitsVariant(p.dataBits).replace(/^DataBits/, '')
  const par = parityVariant(p.parity).charAt(0)
  const stop = stopBitsVariant(p.stopBits).replace(/^Stop/, '')
  return `${p.baudrate ?? 115200} ${bits}${par}${stop}`
}

export function renderUsart(usages: PeripheralUsage[]): PeriModule | null {
  const insts = enabledUsage(usages, 'usart')
  if (insts.length === 0) return null

  const instances = insts.map((u) => {
    const tx = u.pins.find((p) => p.role === 'tx')!.pin
    const rx = u.pins.find((p) => p.role === 'rx')!.pin
    const remap = u.remap ?? 0
    const typeName = `${u.id.charAt(0).toUpperCase()}${u.id.slice(1).toLowerCase()}`
    const remapConstValue = remapConst(remap)
    return {
      id: u.id,
      typeName,
      initFn: `init_${u.id.toLowerCase()}`,
      remap,
      remapConst: remapConstValue,
      remapDesc: `remap ${remap}（REMAP=${remapConstValue}）：RX=${rx} TX=${tx}（构造先 rx 后 tx）`,
      tx,
      rx,
      periType: pinPeriType(u.id),
      rxType: pinPeriType(rx),
      txType: pinPeriType(tx),
      baudrate: u.params.baudrate ?? 115200,
      dataBits: dataBitsVariant(u.params.dataBits),
      stopBits: stopBitsVariant(u.params.stopBits),
      parity: parityVariant(u.params.parity),
      paramDesc: paramDesc(u.params),
    }
  })

  const content = render(T.USART_RS_TPL, { instances })
  return {
    file: { path: 'src/generated/usart.rs', content },
    module: 'usart',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `usart::${i.typeName}`,
      init: `usart::${i.initFn}(${[`p.${i.id}`, `p.${i.rx}`, `p.${i.tx}`].join(', ')})`,
    })),
  }
}