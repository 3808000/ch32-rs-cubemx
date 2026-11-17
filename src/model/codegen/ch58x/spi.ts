// spi.rs 渲染：ch58x-hal 仅 SPI0（new / new_txonly / new_rxonly + 软件 NSS）。
import type { ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { ModField, PeriModule } from './derive'
import { pinType, remapConst, spiNssPin } from './derive'
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
    if (!sck) throw new Error(`SPI ${u.id} 缺 SCK（生成期错误应在渲染前拦截）`)
    const remap = u.remap ?? 0
    const remapConstValue = remapConst(remap)
    const typeName = `${u.id.charAt(0).toUpperCase()}${u.id.slice(1).toLowerCase()}`
    const initFn = `init_${u.id.toLowerCase()}`

    // D6：缺 MISO → new_txonly；缺 MOSI → new_rxonly；两者都有 → new
    const ctor = mosi && miso ? 'new' : mosi ? 'new_txonly' : miso ? 'new_rxonly' : 'new'
    const paramParts = [`peri: ${pinType(u.id)}`, `sck: ${pinType(sck)}`]
    // initArgs 供 mod.rs 调用（p.xxx）；callArgs 供生成的函数体内部传参（形参名）
    const initArgs = [`p.${u.id}`, `p.${sck}`]
    const callArgs = ['peri', 'sck']
    if (mosi && ctor !== 'new_rxonly') {
      paramParts.push(`mosi: ${pinType(mosi)}`)
      initArgs.push(`p.${mosi}`)
      callArgs.push('mosi')
    }
    if (miso && ctor !== 'new_txonly') {
      paramParts.push(`miso: ${pinType(miso)}`)
      initArgs.push(`p.${miso}`)
      callArgs.push('miso')
    }

    const callComment =
      ctor === 'new'
        ? '全双工构造（src/spi.rs:61-90）：直接返回 Self（无 Result）'
        : ctor === 'new_txonly'
          ? '仅发送构造（无 MISO，src/spi.rs:115-137）：直接返回 Self（无 Result）'
          : '仅接收构造（无 MOSI，src/spi.rs:92-113）：直接返回 Self（无 Result）'
    const pinDesc = [`SCK=${sck}`, mosi ? `MOSI=${mosi}` : 'MOSI=未用', miso ? `MISO=${miso}` : 'MISO=未用'].join(' ')

    const nss = nssModel && u.pins.some((p) => p.role === 'nss') ? nssModel : null
    fields.push({ name: u.id.toLowerCase(), type: `spi::${typeName}`, init: `spi::${initFn}(${initArgs.join(', ')})` })
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
      params: paramParts.join(', '),
      callExpr: `hal::spi::Spi::${ctor}::<${remapConstValue}>(${[...callArgs, 'config'].join(', ')})`,
      callComment,
      remapDesc: `remap ${remap}（REMAP=${remapConstValue}）：${pinDesc}`,
      polarity: u.params.clockPolarity ?? 'IdleLow',
      bitOrder: u.params.bitOrder ?? 'MsbFirst',
      frequency: fmtHz(Number(u.params.frequency ?? 1_000_000)),
      paramDesc: `CPOL=${u.params.clockPolarity === 'IdleHigh' ? 1 : 0}（只支持 MODE_0/3 语义），位序 ${u.params.bitOrder ?? 'MsbFirst'}，${fmtHz(Number(u.params.frequency ?? 1_000_000))}Hz`,
      nss:
        nss === null
          ? null
          : {
              pin: nss.pin,
              typeName: nss.typeName,
              initFn: nss.initFn,
              comment: `${u.id}_NSS（${nss.pin}）软件片选：ch58x-hal 不管理 NSS，初始高电平（空闲）`,
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
