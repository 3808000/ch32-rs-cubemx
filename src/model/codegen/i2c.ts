// i2c.rs 渲染：I2C 初始化（Blocking/Async，速率/占空比 + EV/ER 双中断绑定）。
import type { DeviceData, ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import { dmaPeripheralOf, instanceCallArgs } from './derive'
import type { IrqBinding, PeriModule } from './derive'
import { render } from './render'
import { fmtHz, periType, typeNameOf } from './util'
import * as T from './templates'

/**
 * I2C 速率模式说明：ch32-hal 没有 Speed 枚举，I2C 构造只收 Hertz（src/i2c.rs
 * 的 timing() 断言 0 < freq ≤ 400kHz）。数据层用 100k（Standard）/400k（Fast）两档，
 * 映射为 Hertz 后生成，不臆造 HAL 枚举。
 */
function i2cSpeedDesc(hz: number): string {
  return hz > 100_000 ? 'Fast' : 'Standard'
}

export function renderI2c(config: ProjectConfig, usages: PeripheralUsage[], embassy: boolean, data: DeviceData, base = ''): PeriModule | null {
  const insts = enabledUsage(usages, 'i2c')
  if (insts.length === 0) return null
  const perPinAf = data.chip.remapModel === 'per_pin_af'
  const afOf = (pinName: string) => (config.pins ?? []).find((a) => a.pin === pinName)?.remap

  const instances = insts.map((u) => {
    const scl = u.pins.find((p) => p.role === 'scl')!.pin
    const sda = u.pins.find((p) => p.role === 'sda')!.pin
    const remap = u.remap ?? 0
    const typeName = typeNameOf(u.id)
    const initFn = `init_${u.id.toLowerCase()}`
    const params: string[] = [`peri: ${periType(u.id)}`, `scl: ${periType(scl)}`, `sda: ${periType(sda)}`]
    if (embassy) {
      params.push('irqs: super::Irqs')
      const txDma = dmaPeripheralOf(config, data, usages, `${u.id}_TX`)
      const rxDma = dmaPeripheralOf(config, data, usages, `${u.id}_RX`)
      params.push(`tx_dma: ${periType(txDma)}`, `rx_dma: ${periType(rxDma)}`)
    }
    const cfgLines: string[] = []
    if (u.params.duty !== undefined) cfgLines.push(`cfg.duty = hal::i2c::Duty::${u.params.duty};`)
    const freqHz = fmtHz(Number(u.params.speed ?? 100_000))
    return {
      id: u.id,
      remap,
      remapSyntax: perPinAf ? '' : `::<${remap}>`,
      remapDesc: perPinAf
        ? `SCL=${scl}(AF${afOf(scl) ?? '?'}) SDA=${sda}(AF${afOf(sda) ?? '?'})`
        : `remap ${remap}：SCL=${scl} SDA=${sda}`,
      scl,
      sda,
      typeName,
      initFn,
      params: params.join(', '),
      cfgLines,
      paramDesc: `速率 ${freqHz}Hz（${i2cSpeedDesc(Number(u.params.speed ?? 100_000))} 模式），占空比 ${u.params.duty ?? 'Duty2_1'}`,
      modeType: embassy ? 'Async' : 'Blocking',
      asyncMode: embassy,
      freq: freqHz,
    }
  })

  const content = render(T.I2C_TPL, { instances })
  const irqs: IrqBinding[] = []
  if (embassy) {
    for (const u of insts) {
      // I2C 需双中断 handler（Event/Error），名称核对 ch32-hal src/i2c.rs
      irqs.push(
        { irq: `${u.id}_EV`, handler: `hal::i2c::EventInterruptHandler<hal::peripherals::${u.id}>` },
        { irq: `${u.id}_ER`, handler: `hal::i2c::ErrorInterruptHandler<hal::peripherals::${u.id}>` },
      )
    }
  }
  return {
    file: { path: `${base}src/generated/i2c.rs`, content },
    module: 'i2c',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `i2c::${i.typeName}`,
      call: `i2c::${i.initFn}(${instanceCallArgs(config, i.id, 'i2c', usages, embassy, data)})`,
    })),
    irqs,
  }
}