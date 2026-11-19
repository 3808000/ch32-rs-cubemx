// i2c.rs 渲染：ch5xx-hal I2C（new_blocking；peri → scl → sda + const REMAP u8；无上拉字段）。
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { PeriModule } from './derive'
import { halInstance, i2cDutyVariant, pinPeriType, remapConst } from './derive'
import { render } from '../render'
import { fmtHz } from '../util'
import * as T from './templates'

export function renderI2c(usages: PeripheralUsage[]): PeriModule | null {
  const insts = enabledUsage(usages, 'i2c')
  if (insts.length === 0) return null

  const instances = insts.map((u) => {
    const scl = u.pins.find((p) => p.role === 'scl')!.pin
    const sda = u.pins.find((p) => p.role === 'sda')!.pin
    const remap = u.remap ?? 0
    const remapConstValue = remapConst(remap)
    const typeName = `${u.id.charAt(0).toUpperCase()}${u.id.slice(1).toLowerCase()}`
    const peri = halInstance(u.id)
    const frequencyHz = Number(u.params.frequency ?? 100_000)
    return {
      id: u.id,
      peri,
      typeName,
      initFn: `init_${u.id.toLowerCase()}`,
      remap,
      remapConst: remapConstValue,
      remapDesc: `${peri} remap ${remap}（REMAP=${remapConstValue}）：SCL=${scl} SDA=${sda}`,
      scl,
      sda,
      periType: pinPeriType(peri),
      sclType: pinPeriType(scl),
      sdaType: pinPeriType(sda),
      frequency: fmtHz(frequencyHz),
      duty: i2cDutyVariant(u.params.duty),
      paramDesc: `${fmtHz(frequencyHz)}Hz（${frequencyHz > 100_000 ? 'Fast' : 'Standard'} 模式），占空比 ${u.params.duty ?? 'Duty2_1'}，7-bit 地址；无内部上拉字段（外部上拉必需）`,
    }
  })

  const content = render(T.I2C_RS_TPL, { instances })
  return {
    file: { path: 'src/generated/i2c.rs', content },
    module: 'i2c',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `i2c::${i.typeName}`,
      init: `i2c::${i.initFn}(${[`p.${i.peri}`, `p.${i.scl}`, `p.${i.sda}`].join(', ')})`,
    })),
  }
}