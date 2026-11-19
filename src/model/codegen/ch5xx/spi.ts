// spi.rs 渲染：ch5xx-hal 全双工 new_blocking + 软件 NSS（MODE_0/MODE_3）。
import type { ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { ModField, PeriModule } from './derive'
import { pinPeriType, remapConst, spiModeVariant, spiNssPin } from './derive'
import { render } from '../render'
import { fmtHz } from '../util'
import * as T from './templates'

export function renderSpi(config: ProjectConfig, usages: PeripheralUsage[]): PeriModule | null {
  const insts = enabledUsage(usages, 'spi')
  if (insts.length === 0) return null

  const nssModel = spiNssPin(config, usages)
  const fields: ModField[] = []

  const instances = insts.map((u) => {
    const sck = u.pins.find((p) => p.role === 'sck')?.pin
    const mosi = u.pins.find((p) => p.role === 'mosi')?.pin
    const miso = u.pins.find((p) => p.role === 'miso')?.pin
    // 生成期错误已拦截缺 SCK / 半双工，这里再作纵深防御
    if (!sck || !mosi || !miso) throw new Error(`SPI ${u.id} 缺引脚（生成期错误应在渲染前拦截）`)
    const remap = u.remap ?? 0
    const remapConstValue = remapConst(remap)
    const typeName = `${u.id.charAt(0).toUpperCase()}${u.id.slice(1).toLowerCase()}`
    const initFn = `init_${u.id.toLowerCase()}`
    const mode = spiModeVariant(u.params)
    const frequencyHz = Number(u.params.frequency ?? 1_000_000)

    const nss = nssModel && u.pins.some((p) => p.role === 'nss') ? nssModel : null
    fields.push({ name: u.id.toLowerCase(), type: `spi::${typeName}`, init: `spi::${initFn}(${[`p.${u.id}`, `p.${sck}`, `p.${mosi}`, `p.${miso}`].join(', ')})` })
    if (nss) {
      fields.push({
        name: nss.field,
        type: `spi::${nss.typeName}`,
        init: `spi::${nss.initFn}(p.${nss.pin})`,
      })
    }

    return {
      id: u.id,
      typeName,
      initFn,
      remap,
      remapConst: remapConstValue,
      params: [
        `peri: ${pinPeriType(u.id)}`,
        `sck: ${pinPeriType(sck)}`,
        `mosi: ${pinPeriType(mosi)}`,
        `miso: ${pinPeriType(miso)}`,
      ].join(', '),
      remapDesc: `remap ${remap}（REMAP=${remapConstValue}）：SCK=${sck} MOSI=${mosi} MISO=${miso}`,
      mode,
      bitOrder: u.params.bitOrder === 'LsbFirst' ? 'LsbFirst' : 'MsbFirst',
      frequency: fmtHz(frequencyHz),
      paramDesc: `${mode === 'MODE_3' ? 'CPOL=1 CPHA=1 (MODE_3)' : 'CPOL=0 CPHA=0 (MODE_0)'}，位序 ${u.params.bitOrder ?? 'MsbFirst'}，${fmtHz(frequencyHz)}Hz`,
      nss:
        nss === null
          ? null
          : {
              pin: nss.pin,
              pinType: pinPeriType(nss.pin),
              typeName: nss.typeName,
              initFn: nss.initFn,
              comment: `${u.id}_NSS（${nss.pin}）软件片选：ch5xx SPI 不管理片选，初始高电平（空闲）`,
            },
    }
  })

  const content = render(T.SPI_RS_TPL, { instances })
  return {
    file: { path: 'src/generated/spi.rs', content },
    module: 'spi',
    fields,
  }
}