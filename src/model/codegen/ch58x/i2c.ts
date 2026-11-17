// i2c.rs 渲染：ch58x-hal I2C（单实例；peri → scl → sda + const REMAP）。
import type { PeripheralUsage } from '@/model/peripherals'
import { enabledUsage } from '@/model/peripherals'
import type { PeriModule } from './derive'
import { remapConst } from './derive'
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
    const freq = fmtHz(Number(u.params.frequency ?? 100_000))
    return {
      id: u.id,
      typeName,
      initFn: `init_${u.id.toLowerCase()}`,
      remap,
      remapConst: remapConstValue,
      remapDesc: `remap ${remap}（REMAP=${remapConstValue}）：SCL=${scl} SDA=${sda}`,
      scl,
      sda,
      frequency: freq,
      duty: u.params.duty ?? 'Duty2_1',
      paramDesc: `${freq}Hz（${Number(u.params.frequency ?? 100_000) > 100_000 ? 'Fast' : 'Standard'} 模式），占空比 ${u.params.duty ?? 'Duty2_1'}，7-bit 地址`,
    }
  })

  const content = render(T.I2C_RS_TPL, { instances })
  return {
    file: { path: 'src/generated/i2c.rs', content },
    module: 'i2c',
    fields: instances.map((i) => ({
      name: i.id.toLowerCase(),
      type: `i2c::${i.typeName}`,
      init: `i2c::${i.initFn}(${[`p.${i.id}`, `p.${i.scl}`, `p.${i.sda}`].join(', ')})`,
    })),
  }
}
