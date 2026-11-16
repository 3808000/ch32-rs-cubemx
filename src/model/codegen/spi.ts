// spi.rs 渲染：SPI 初始化（Blocking/Async，mode/bitOrder/frequency）。
import type { DeviceData, ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import { instanceCallArgs } from './derive'
import type { PeriModule } from './derive'
import { render } from './render'
import { dmaChannelPeriph, fmtHz, periType, typeNameOf } from './util'
import * as T from './templates'

function spiCfgLines(params: Record<string, string | number | boolean>): string[] {
  const lines: string[] = []
  // ch32-hal 的 src/spi.rs 只私用 `embedded_hal::spi::{Mode, MODE_0}`，未 re-export；
  // 生成代码必须走 embedded-hal 的公开路径，否则 `hal::spi::MODE_0` 是私有符号（E0603）。
  if (params.mode !== undefined) lines.push(`cfg.mode = embedded_hal::spi::${params.mode};`)
  if (params.bitOrder !== undefined) lines.push(`cfg.bit_order = hal::spi::BitOrder::${params.bitOrder};`)
  if (typeof params.frequency === 'number') lines.push(`cfg.frequency = hal::time::Hertz::hz(${fmtHz(params.frequency)});`)
  return lines
}

export function renderSpi(config: ProjectConfig, usages: PeripheralUsage[], embassy: boolean, data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'spi')
  if (insts.length === 0) return null
  const perPinAf = data.chip.remapModel === 'per_pin_af'
  const afOf = (pinName: string) => (config.pins ?? []).find((a) => a.pin === pinName)?.remap

  const instances = insts.map((u) => {
    const sck = u.pins.find((p) => p.role === 'sck')!.pin
    const mosi = u.pins.find((p) => p.role === 'mosi')!.pin
    const miso = u.pins.find((p) => p.role === 'miso')!.pin
    const remap = u.remap ?? 0
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const params: string[] = [`peri: ${periType(u.id)}`, `sck: ${periType(sck)}`, `mosi: ${periType(mosi)}`, `miso: ${periType(miso)}`]
    if (embassy) {
      const txDma = dmaChannelPeriph(data, `${u.id}_TX`)!
      const rxDma = dmaChannelPeriph(data, `${u.id}_RX`)!
      params.push(`tx_dma: ${periType(txDma)}`, `rx_dma: ${periType(rxDma)}`)
    }
    return {
      id: u.id,
      remap,
      remapSyntax: perPinAf ? '' : `::<${remap}>`,
      remapDesc: perPinAf
        ? `SCK=${sck}(AF${afOf(sck) ?? '?'}) MOSI=${mosi}(AF${afOf(mosi) ?? '?'}) MISO=${miso}(AF${afOf(miso) ?? '?'})`
        : `remap ${remap}：SCK=${sck} MOSI=${mosi} MISO=${miso}`,
      sck,
      mosi,
      miso,
      typeName,
      initFn,
      params: params.join(', '),
      cfgLines: spiCfgLines(u.params),
      paramDesc: `模式 ${u.params.mode ?? 'MODE_0'}，位序 ${u.params.bitOrder ?? 'MsbFirst'}，${fmtHz(Number(u.params.frequency ?? 1_000_000))}Hz`,
      modeType: embassy ? 'Async' : 'Blocking',
      asyncMode: embassy,
    }
  })

  const content = render(T.SPI_TPL, { instances })
  return {
    file: { path: `${base}src/generated/spi.rs`, content },
    module: 'spi',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `spi::${i.typeName}`,
      call: `spi::${i.initFn}(${instanceCallArgs(i.id, 'spi', usages, embassy, data)})`,
    })),
    irqs: [],
  }
}