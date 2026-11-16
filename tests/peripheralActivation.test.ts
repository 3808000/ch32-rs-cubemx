// 激活外设自动分配核心 AF 引脚的推导测试：PeripheralConfigCard.planActivationPins。
// 数据：真实 CH32V003F4P6（USART1 四档、SPI1 两档、I2C1 三档、ADC1 无核心 AF 角色）。
import { describe, it, expect } from 'vitest'
import { planActivationPins, CORE_ROLES } from '../src/components/PeripheralConfigCard.vue'
import { getDeviceData } from '@/model/device'

const data = getDeviceData('CH32V003F4P6')

/** 与卡片内部 rolesOf 相同的规整方式：只取给定角色键 */
function rolesOf(entry: object, keys: string[]): Record<string, string> {
  const rec = entry as Record<string, string | undefined>
  const out: Record<string, string> = {}
  for (const k of keys) if (rec[k]) out[k] = rec[k]
  return out
}

describe('planActivationPins 激活自动分配', () => {
  it('USART1 remap 0 → TX=PD5 / RX=PD6', () => {
    const r = data.peripherals.usart[0].remaps[0]
    expect(planActivationPins('usart', 'USART1', rolesOf(r, CORE_ROLES.usart))).toEqual([
      { role: 'tx', pin: 'PD5', signal: 'USART1_TX' },
      { role: 'rx', pin: 'PD6', signal: 'USART1_RX' },
    ])
  })

  it('USART1 remap 3 → TX=PC0 / RX=PC1（按当前档而非固定档）', () => {
    const r = data.peripherals.usart[0].remaps.find((x) => x.remap === 3)!
    expect(planActivationPins('usart', 'USART1', rolesOf(r, CORE_ROLES.usart))).toEqual([
      { role: 'tx', pin: 'PC0', signal: 'USART1_TX' },
      { role: 'rx', pin: 'PC1', signal: 'USART1_RX' },
    ])
  })

  it('SPI1 remap 0 → SCK/MOSI/MISO，不含 NSS', () => {
    const r = data.peripherals.spi[0].remaps[0]
    expect(planActivationPins('spi', 'SPI1', rolesOf(r, CORE_ROLES.spi))).toEqual([
      { role: 'sck', pin: 'PC5', signal: 'SPI1_SCK' },
      { role: 'mosi', pin: 'PC6', signal: 'SPI1_MOSI' },
      { role: 'miso', pin: 'PC7', signal: 'SPI1_MISO' },
    ])
  })

  it('I2C1 remap 2 → SCL=PC5 / SDA=PC6', () => {
    const r = data.peripherals.i2c[0].remaps.find((x) => x.remap === 2)!
    expect(planActivationPins('i2c', 'I2C1', rolesOf(r, CORE_ROLES.i2c))).toEqual([
      { role: 'scl', pin: 'PC5', signal: 'I2C1_SCL' },
      { role: 'sda', pin: 'PC6', signal: 'I2C1_SDA' },
    ])
  })

  it('ADC 不自动分配（核心角色为空）', () => {
    expect(planActivationPins('adc', 'ADC1', {})).toEqual([])
  })

  it('remap 档缺角色时只返回存在的角色', () => {
    expect(planActivationPins('usart', 'USART1', { tx: 'PD5' })).toEqual([{ role: 'tx', pin: 'PD5', signal: 'USART1_TX' }])
  })

  it('所有规划引脚都存在于该芯片 remap 数据且档位一致（不新增 REMAP_UNDEFINED）', () => {
    const cases: { kind: 'usart' | 'spi' | 'i2c'; id: string; remaps: { remap: number }[] }[] = [
      { kind: 'usart', id: 'USART1', remaps: data.peripherals.usart[0].remaps },
      { kind: 'spi', id: 'SPI1', remaps: data.peripherals.spi[0].remaps },
      { kind: 'i2c', id: 'I2C1', remaps: data.peripherals.i2c[0].remaps },
    ]
    for (const c of cases) {
      for (const r of c.remaps) {
        for (const t of planActivationPins(c.kind, c.id, rolesOf(r, CORE_ROLES[c.kind]))) {
          const hit = data.remap.entries.some((e) => e.signal === t.signal && e.pin === t.pin && e.remap === r.remap)
          expect(hit, `${c.id} remap ${r.remap}: ${t.pin} 应承载 ${t.signal}`).toBe(true)
        }
      }
    }
  })
})