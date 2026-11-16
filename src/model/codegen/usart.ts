// usart.rs 渲染：USART 初始化（Blocking/Async，含 remap 与参数描述）。
import type { DeviceData, ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import { dmaPeripheralOf, instanceCallArgs } from './derive'
import type { PeriModule } from './derive'
import { render } from './render'
import { periType, typeNameOf } from './util'
import * as T from './templates'

/** usart 参数键 → cfg 赋值行（参数值来自数据层，逐字拼接 HAL 枚举变体名） */
function usartCfgLines(params: Record<string, string | number | boolean>): string[] {
  const lines: string[] = []
  if (params.baudrate !== undefined) lines.push(`cfg.baudrate = ${params.baudrate};`)
  if (params.wordLength !== undefined) lines.push(`cfg.data_bits = hal::usart::DataBits::${params.wordLength};`)
  if (params.stopBits !== undefined) lines.push(`cfg.stop_bits = hal::usart::StopBits::${params.stopBits};`)
  if (params.parity !== undefined) lines.push(`cfg.parity = hal::usart::Parity::${params.parity};`)
  // HAL Config.detect_previous_overrun（src/usart/mod.rs，公共字段）
  if (params.detectPreviousOverrun !== undefined) {
    lines.push(`cfg.detect_previous_overrun = ${params.detectPreviousOverrun ? 'true' : 'false'};`)
  }
  return lines
}

/** "115200 8N1" 风格参数描述（STOP0P5/STOP1P5 按实际停止位数显示） */
function usartParamDesc(params: Record<string, string | number | boolean>): string {
  const bits = params.wordLength === 'DataBits9' ? '9' : '8'
  const par = params.parity === 'ParityEven' ? 'E' : params.parity === 'ParityOdd' ? 'O' : 'N'
  const stop = params.stopBits === 'STOP2' ? '2' : params.stopBits === 'STOP0P5' ? '0.5' : params.stopBits === 'STOP1P5' ? '1.5' : '1'
  return `${params.baudrate ?? 115200} ${bits}${par}${stop}`
}

export function renderUsart(config: ProjectConfig, usages: PeripheralUsage[], embassy: boolean, data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'usart')
  if (insts.length === 0) return null
  // per_pin_af（H4）：构造函数没有 REMAP const 泛型，AF 由引脚 trait 的 af_num() 写入 AFR
  const perPinAf = data.chip.remapModel === 'per_pin_af'
  const afOf = (pinName: string) => (config.pins ?? []).find((a) => a.pin === pinName)?.remap

  const instances = insts.map((u) => {
    const rx = u.pins.find((p) => p.role === 'rx')!.pin
    const tx = u.pins.find((p) => p.role === 'tx')!.pin
    const remap = u.remap ?? 0
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const params: string[] = [`peri: ${periType(u.id)}`, `rx: ${periType(rx)}`, `tx: ${periType(tx)}`]
    const callArgs: string[] = [`p.${u.id}`, `p.${rx}`, `p.${tx}`]
    if (embassy) {
      params.push('irqs: super::Irqs')
      // DMA 通道取自工程配置（config.dma）；未配置时按数据层固定/自动分配
      const txDma = dmaPeripheralOf(config, data, usages, `${u.id}_TX`)
      const rxDma = dmaPeripheralOf(config, data, usages, `${u.id}_RX`)
      params.push(`tx_dma: ${periType(txDma)}`, `rx_dma: ${periType(rxDma)}`)
      callArgs.push('Irqs', `p.${txDma}`, `p.${rxDma}`)
    }
    return {
      id: u.id,
      remap,
      remapSyntax: perPinAf ? '' : `::<${remap}>`,
      remapDesc: perPinAf
        ? `TX=${tx}(AF${afOf(tx) ?? '?'}) RX=${rx}(AF${afOf(rx) ?? '?'})`
        : `remap ${remap}：TX=${tx} RX=${rx}`,
      tx,
      rx,
      typeName,
      initFn,
      params: params.join(', '),
      cfgLines: usartCfgLines(u.params),
      paramDesc: usartParamDesc(u.params),
      modeType: embassy ? 'Async' : 'Blocking',
      asyncMode: embassy,
    }
  })

  const content = render(T.USART_TPL, { instances })
  return {
    file: { path: `${base}src/generated/usart.rs`, content },
    module: 'usart',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `usart::${i.typeName}`,
      call: `usart::${i.initFn}(${instanceCallArgs(config, i.id, 'usart', usages, embassy, data)})`,
    })),
    // 中断名与向量表核对（ Embassy Binding：USART 单中断）
    irqs: embassy
      ? insts.map((u) => ({
          irq: u.id,
          handler: `hal::usart::InterruptHandler<hal::peripherals::${u.id}>`,
        }))
      : [],
  }
}