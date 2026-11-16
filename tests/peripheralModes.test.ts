// 外设 Mode 数据契约 + 模式驱动参数/引脚推导测试。
// 数据真相源：V003/V203 的 peripherals.json（modes 由 HAL 源码核对，见 docs/HAL_API_NOTES.md）。
import { describe, it, expect } from 'vitest'
import { getDeviceData } from '@/model/device'
import type { ParamSpec } from '@/model/types'
import {
  MODE_PARAM_KEY,
  filterParamsForMode,
  isCodegenSupported,
  modesOf,
  rolesForMode,
  selectedMode,
  type PeripheralMode,
} from '../src/components/peripherals/modes'
import {
  CORE_ROLES,
  ROLE_KEYS,
  findPeripheralInstance,
  planActivationPins,
  rolesOf,
  type PeriKind,
} from '../src/components/peripherals/instance'

const CHIPS = ['CH32V003F4P6', 'CH32V203C8T6'] as const
const KINDS: PeriKind[] = ['usart', 'spi', 'i2c']

function rawInstances(chip: string, kind: PeriKind): Record<string, unknown>[] {
  const data = getDeviceData(chip)
  const list = kind === 'usart' ? data.peripherals.usart : kind === 'spi' ? data.peripherals.spi : data.peripherals.i2c
  return list as unknown as Record<string, unknown>[]
}

function paramsOf(chip: string, kind: PeriKind, id: string): Record<string, ParamSpec> {
  const data = getDeviceData(chip)
  const list = kind === 'usart' ? data.peripherals.usart : kind === 'spi' ? data.peripherals.spi : data.peripherals.i2c
  return list.find((x) => x.id === id)!.params
}

describe('peripherals.json modes 数据契约', () => {
  for (const chip of CHIPS) {
    for (const kind of KINDS) {
      const instances = rawInstances(chip, kind)

      it(`${chip} ${kind}: 每个实例都有唯一 mode id 与非空 label`, () => {
        expect(instances.length).toBeGreaterThan(0)
        for (const inst of instances) {
          const modes = modesOf(inst)
          expect(modes.length, `${String(inst.id)} 缺少 modes`).toBeGreaterThan(0)
          expect(new Set(modes.map((m) => m.id)).size).toBe(modes.length)
          for (const mode of modes) {
            expect(mode.id.length).toBeGreaterThan(0)
            expect(mode.label.length).toBeGreaterThan(0)
          }
        }
      })

      it(`${chip} ${kind}: mode.params 只引用实例已有参数键`, () => {
        for (const inst of instances) {
          const params = paramsOf(chip, kind, String(inst.id))
          for (const mode of modesOf(inst)) {
            for (const key of mode.params ?? []) {
              expect(params[key], `${String(inst.id)}.${mode.id} 引用了不存在的参数 ${key}`).toBeDefined()
            }
          }
        }
      })

      it(`${chip} ${kind}: mode.pins 只使用该类别的合法核心角色`, () => {
        for (const inst of instances) {
          for (const mode of modesOf(inst)) {
            for (const role of mode.pins ?? []) {
              expect(CORE_ROLES[kind]).toContain(role)
            }
            // 每个 remap 档都应具备该 mode 需要的角色
            const remaps = inst.remaps as unknown as Record<string, string | number>[]
            for (const remap of remaps) {
              for (const role of mode.pins ?? []) {
                expect(typeof remap[role], `${String(inst.id)} remap${remap.remap} 缺角色 ${role}`).toBe('string')
              }
            }
          }
        }
      })
    }
  }

  it('USART modes 仅包含 HAL 已暴露的构造：Asynchronous / Half-duplex', () => {
    for (const chip of CHIPS) {
      for (const inst of rawInstances(chip, 'usart')) {
        const modes = modesOf(inst)
        expect(modes.map((m) => m.id)).toEqual(['asynchronous', 'half-duplex'])
        // HAL 模块文档提到 LIN/IrDA/SmartCard，但未暴露配置 API，不臆造为可选 mode
        const ids = modes.map((m) => m.id)
        for (const unverified of ['synchronous', 'irda', 'smartcard', 'lin']) {
          expect(ids).not.toContain(unverified)
        }
        expect(isCodegenSupported(modes[0])).toBe(true)
        expect(isCodegenSupported(modes[1])).toBe(false)
      }
    }
  })

  it('SPI modes 对应 HAL 的 full-duplex / rxonly / txonly / txonly_nosck 构造', () => {
    const expected: Record<string, string[]> = {
      'full-duplex': ['sck', 'mosi', 'miso'],
      'receive-only': ['sck', 'miso'],
      'transmit-only': ['sck', 'mosi'],
      'transmit-only-no-sck': ['mosi'],
    }
    for (const chip of CHIPS) {
      for (const inst of rawInstances(chip, 'spi')) {
        const modes = modesOf(inst)
        expect(modes.map((m) => m.id)).toEqual(Object.keys(expected))
        for (const mode of modes) {
          expect(mode.pins).toEqual(expected[mode.id])
          expect(isCodegenSupported(mode)).toBe(mode.id === 'full-duplex')
        }
      }
    }
  })

  it('I2C modes 为单一 Master（HAL 仅暴露 master 构造）', () => {
    for (const chip of CHIPS) {
      for (const inst of rawInstances(chip, 'i2c')) {
        const modes = modesOf(inst)
        expect(modes.map((m) => m.id)).toEqual(['master'])
        expect(modes[0].pins).toEqual(['scl', 'sda'])
        expect(isCodegenSupported(modes[0])).toBe(true)
      }
    }
  })
})

describe('mode 选择与参数过滤', () => {
  const modes: PeripheralMode[] = [
    { id: 'full-duplex', label: 'Full-Duplex', params: ['mode', 'bitOrder', 'frequency'] },
    { id: 'transmit-only-no-sck', label: 'TX only no SCK', params: ['bitOrder', 'frequency'], codegen: false },
  ]
  const entries: [string, ParamSpec][] = [
    ['mode', { default: 'MODE_0', kind: 'select' }],
    ['bitOrder', { default: 'MsbFirst', kind: 'select' }],
    ['frequency', { default: 1_000_000, kind: 'number' }],
    ['unknown', { default: true }],
  ]

  it('selectedMode 优先 params.opMode，缺失/非法时回退第一个', () => {
    expect(selectedMode(modes, { [MODE_PARAM_KEY]: 'transmit-only-no-sck' })?.id).toBe('transmit-only-no-sck')
    expect(selectedMode(modes, { [MODE_PARAM_KEY]: 'nope' })?.id).toBe('full-duplex')
    expect(selectedMode(modes, {})?.id).toBe('full-duplex')
    expect(selectedMode([], {})).toBeNull()
  })

  it('filterParamsForMode 按 mode.params 过滤；缺省 params 时保留全部', () => {
    expect(filterParamsForMode(entries, modes[0]).map(([k]) => k)).toEqual(['mode', 'bitOrder', 'frequency'])
    expect(filterParamsForMode(entries, modes[1]).map(([k]) => k)).toEqual(['bitOrder', 'frequency'])
    expect(filterParamsForMode(entries, null)).toHaveLength(4)
    expect(filterParamsForMode(entries, { id: 'x', label: 'X' })).toHaveLength(4)
  })

  it('rolesForMode 过滤非法角色，空集回退类别核心角色', () => {
    expect(rolesForMode({ id: 'x', label: 'X', pins: ['mosi', 'sck'] }, CORE_ROLES.spi)).toEqual(['mosi', 'sck'])
    expect(rolesForMode({ id: 'x', label: 'X', pins: ['bogus'] }, CORE_ROLES.spi)).toEqual(CORE_ROLES.spi)
    expect(rolesForMode(null, CORE_ROLES.usart)).toEqual(CORE_ROLES.usart)
  })
})

describe('mode 驱动的激活引脚推导', () => {
  const v003 = getDeviceData('CH32V003F4P6')
  const usart = v003.peripherals.usart.find((i) => i.id === 'USART1')!
  const spi = v003.peripherals.spi.find((i) => i.id === 'SPI1')!
  const i2c = v003.peripherals.i2c.find((i) => i.id === 'I2C1')!

  it('USART Asynchronous → TX+RX；Half-duplex → 仅 TX', () => {
    const remap0 = rolesOf(usart.remaps[0], ROLE_KEYS.usart)
    expect(planActivationPins('usart', 'USART1', remap0, ['tx', 'rx'])).toEqual([
      { role: 'tx', pin: 'PD5', signal: 'USART1_TX' },
      { role: 'rx', pin: 'PD6', signal: 'USART1_RX' },
    ])
    expect(planActivationPins('usart', 'USART1', remap0, ['tx'])).toEqual([
      { role: 'tx', pin: 'PD5', signal: 'USART1_TX' },
    ])
  })

  it('SPI Receive Only → SCK+MISO；Transmit Only (No SCK) → 仅 MOSI', () => {
    const remap0 = rolesOf(spi.remaps[0], ROLE_KEYS.spi)
    expect(planActivationPins('spi', 'SPI1', remap0, ['sck', 'miso'])).toEqual([
      { role: 'sck', pin: 'PC5', signal: 'SPI1_SCK' },
      { role: 'miso', pin: 'PC7', signal: 'SPI1_MISO' },
    ])
    expect(planActivationPins('spi', 'SPI1', remap0, ['mosi'])).toEqual([
      { role: 'mosi', pin: 'PC6', signal: 'SPI1_MOSI' },
    ])
  })

  it('I2C Master → SCL+SDA', () => {
    const remap0 = rolesOf(i2c.remaps[0], ROLE_KEYS.i2c)
    expect(planActivationPins('i2c', 'I2C1', remap0, ['scl', 'sda'])).toEqual([
      { role: 'scl', pin: 'PC2', signal: 'I2C1_SCL' },
      { role: 'sda', pin: 'PC1', signal: 'I2C1_SDA' },
    ])
  })

  it('findPeripheralInstance 返回 modes；ADC 无 modes', () => {
    const inst = findPeripheralInstance(v003.peripherals, 'USART1')!
    expect(inst.kind).toBe('usart')
    expect(inst.modes.map((m) => m.id)).toEqual(['asynchronous', 'half-duplex'])
    const adc = findPeripheralInstance(v003.peripherals, 'ADC1')!
    expect(adc.kind).toBe('adc')
    expect(adc.modes).toEqual([])
    expect(findPeripheralInstance(v003.peripherals, 'TIM2')).toBeNull()
  })
})