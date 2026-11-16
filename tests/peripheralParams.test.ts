// 外设参数补全（M3.3）：数据层 ParamSpec 与渲染器输出逐字核对 HAL 枚举。
// 覆盖：USART 校验/停止位/字长/溢出检测、SPI CPOL/CPHA（MODE_n）/位序/频率、
//       I2C 速率模式/占空比、ADC 采样时间；并断言无 HAL API 的参数未被臆造。
import { describe, expect, it } from 'vitest'
import type { ParamSpec, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { generateProject } from '@/model/codegen'

const HAL_REV = 'a0863ebcc1082f64e508b73d3b944f119b0db77b'

const DATA = {
  v003: getDeviceData('CH32V003F4P6'),
  v203: getDeviceData('CH32V203C8T6'),
  h417: getDeviceData('CH32H417QEU6'),
}

const USART_STOP_OPTIONS = ['STOP1', 'STOP0P5', 'STOP2', 'STOP1P5']
const USART_PARITY_OPTIONS = ['ParityNone', 'ParityEven', 'ParityOdd']
const USART_WORD_OPTIONS = ['DataBits8', 'DataBits9']
const SPI_MODE_OPTIONS = ['MODE_0', 'MODE_1', 'MODE_2', 'MODE_3']

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'params-demo',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: HAL_REV },
    ...over,
  }
}

function fileOf(r: ReturnType<typeof generateProject>, path: string): string {
  return r.files.find((f) => f.path === path)?.content ?? ''
}

function optionsOf(spec: ParamSpec): (string | number)[] {
  return spec.options ?? []
}

describe('peripherals.json 参数 spec（逐字核对 HAL 变体）', () => {
  for (const [key, data] of Object.entries(DATA)) {
    describe(`${key} (${data.chip.chip})`, () => {
      it('USART：字长/停止位/校验/溢出检测字段齐全且变体名合法', () => {
        expect(data.peripherals.usart.length).toBeGreaterThan(0)
        for (const inst of data.peripherals.usart) {
          const p = inst.params
          expect(p.wordLength, `${inst.id}.wordLength`).toBeDefined()
          expect(optionsOf(p.wordLength).every((o) => USART_WORD_OPTIONS.includes(String(o)))).toBe(true)
          expect(optionsOf(p.wordLength)).toContain(p.wordLength.default)

          expect(optionsOf(p.stopBits).every((o) => USART_STOP_OPTIONS.includes(String(o)))).toBe(true)
          expect(optionsOf(p.stopBits)).toContain(p.stopBits.default)

          expect(optionsOf(p.parity)).toEqual(USART_PARITY_OPTIONS)
          expect(p.parity.default).toBe('ParityNone')

          // ch32-hal src/usart/mod.rs Config.detect_previous_overrun
          expect(p.detectPreviousOverrun).toMatchObject({ kind: 'boolean', default: false })
        }
      })

      it('SPI：CPOL/CPHA 用 embedded-hal MODE_n，位序/频率合法；位宽与软件 NSS 无 HAL API（未提供）', () => {
        expect(data.peripherals.spi.length).toBeGreaterThan(0)
        for (const inst of data.peripherals.spi) {
          const p = inst.params
          expect(optionsOf(p.mode)).toEqual(SPI_MODE_OPTIONS)
          expect(p.mode.default).toBe('MODE_0')
          expect(optionsOf(p.bitOrder)).toEqual(['MsbFirst', 'LsbFirst'])
          expect(p.frequency.kind).toBe('number')
          // 臆造字段守卫：HAL Config 只有 mode/bit_order/frequency（src/spi.rs）
          for (const forbidden of ['dataWidth', 'dataBits', 'softwareNss', 'nss', 'cpol', 'cpha']) {
            expect(p, `${inst.id} 不应有 ${forbidden}`).not.toHaveProperty(forbidden)
          }
        }
      })

      it('I2C：速率模式 100k/400k + 占空比变体合法', () => {
        expect(data.peripherals.i2c.length).toBeGreaterThan(0)
        for (const inst of data.peripherals.i2c) {
          const p = inst.params
          expect(p.speed.kind).toBe('select')
          expect(optionsOf(p.speed)).toEqual([100000, 400000])
          expect(p.speed.default).toBe(100000)
          expect(optionsOf(p.duty)).toEqual(['Duty2_1', 'Duty16_9'])
          expect(p.duty.default).toBe('Duty2_1')
        }
      })

      it('ADC：采样时间变体随芯片实现不同；分辨率/连续转换无公开 API（未提供）', () => {
        expect(data.peripherals.adc.length).toBeGreaterThan(0)
        const expected = {
          v003: ['CYCLES3', 'CYCLES9', 'CYCLES15', 'CYCLES30', 'CYCLES43', 'CYCLES57', 'CYCLES73', 'CYCLES241'],
          v203: [
            'CYCLES1_5',
            'CYCLES7_5',
            'CYCLES13_5',
            'CYCLES28_5',
            'CYCLES41_5',
            'CYCLES55_5',
            'CYCLES71_5',
            'CYCLES239_5',
          ],
          h417: [
            'S1_5',
            'S7_5',
            'S13_5',
            'S28_5',
            'S41_5',
            'S55_5',
            'S71_5',
            'S239_5',
            'S2_5',
            'S3_5',
            'S4_5',
            'S5_5',
          ],
        }[key]!
        for (const inst of data.peripherals.adc) {
          const p = inst.params
          expect(optionsOf(p.sampleTime)).toEqual(expected)
          expect(p.sampleTime.default).toBeDefined()
          for (const forbidden of ['resolution', 'continuous', 'continuousConversion', 'clkdiv']) {
            expect(p, `${inst.id} 不应有 ${forbidden}`).not.toHaveProperty(forbidden)
          }
        }
      })
    })
  }
})

describe('渲染器参数输出（逐字 HAL 枚举）', () => {
  it('USART：9 位 + 偶校验 + 2 停止位 + 溢出检测', () => {
    const r = generateProject(
      baseConfig({
        peripherals: {
          USART1: {
            enabled: true,
            params: {
              baudrate: 9600,
              wordLength: 'DataBits9',
              stopBits: 'STOP2',
              parity: 'ParityEven',
              detectPreviousOverrun: true,
            },
          },
        },
        pins: [
          pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
        ],
      }),
      DATA.v003,
    )
    expect(r.errors).toEqual([])
    const usart = fileOf(r, 'src/generated/usart.rs')
    expect(usart).toContain('cfg.baudrate = 9600;')
    expect(usart).toContain('cfg.data_bits = hal::usart::DataBits::DataBits9;')
    expect(usart).toContain('cfg.stop_bits = hal::usart::StopBits::STOP2;')
    expect(usart).toContain('cfg.parity = hal::usart::Parity::ParityEven;')
    expect(usart).toContain('cfg.detect_previous_overrun = true;')
    expect(usart).toContain('9600 9E2')
  })

  it('USART V203：STOP0P5 描述为 0.5 停止位', () => {
    const r = generateProject(
      baseConfig({
        chip: 'CH32V203C8T6',
        peripherals: { USART1: { enabled: true, params: { stopBits: 'STOP0P5' } } },
        pins: [
          pin('PA9', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PA10', 'AF', { function: 'USART1_RX', remap: 0 }),
        ],
      }),
      DATA.v203,
    )
    expect(r.errors).toEqual([])
    const usart = fileOf(r, 'src/generated/usart.rs')
    expect(usart).toContain('cfg.stop_bits = hal::usart::StopBits::STOP0P5;')
    expect(usart).toContain('115200 8N0.5')
  })

  it('SPI：MODE_3（CPOL=1 CPHA=1）+ LSB first + 8MHz', () => {
    const r = generateProject(
      baseConfig({
        peripherals: { SPI1: { enabled: true, params: { mode: 'MODE_3', bitOrder: 'LsbFirst', frequency: 8_000_000 } } },
        pins: [
          pin('PC5', 'AF', { function: 'SPI1_SCK', remap: 0 }),
          pin('PC6', 'AF', { function: 'SPI1_MOSI', remap: 0 }),
          pin('PC7', 'AF', { function: 'SPI1_MISO', remap: 0 }),
        ],
      }),
      DATA.v003,
    )
    expect(r.errors).toEqual([])
    const spi = fileOf(r, 'src/generated/spi.rs')
    expect(spi).toContain('cfg.mode = embedded_hal::spi::MODE_3;')
    expect(spi).toContain('cfg.bit_order = hal::spi::BitOrder::LsbFirst;')
    expect(spi).toContain('cfg.frequency = hal::time::Hertz::hz(8_000_000);')
    expect(spi).toContain('CPOL=1 CPHA=1')
  })

  it('I2C：Fast 模式 400kHz + Duty16_9', () => {
    const r = generateProject(
      baseConfig({
        peripherals: { I2C1: { enabled: true, params: { speed: 400_000, duty: 'Duty16_9' } } },
        pins: [
          pin('PC2', 'AF', { function: 'I2C1_SCL', remap: 0 }),
          pin('PC1', 'AF', { function: 'I2C1_SDA', remap: 0 }),
        ],
      }),
      DATA.v003,
    )
    expect(r.errors).toEqual([])
    const i2c = fileOf(r, 'src/generated/i2c.rs')
    expect(i2c).toContain('cfg.duty = hal::i2c::Duty::Duty16_9;')
    expect(i2c).toContain('Hertz::hz(400_000)')
    expect(i2c).toContain('Fast 模式')
  })

  it('ADC V003：采样时间 CYCLES241 进入读取示例', () => {
    const r = generateProject(
      baseConfig({
        peripherals: { ADC1: { enabled: true, params: { sampleTime: 'CYCLES241' } } },
        pins: [pin('PA2', 'ANALOG', { function: 'ADC_IN0' })],
      }),
      DATA.v003,
    )
    expect(r.errors).toEqual([])
    expect(fileOf(r, 'src/generated/adc.rs')).toContain('hal::adc::SampleTime::CYCLES241')
  })

  it('ADC V203：采样时间 CYCLES239_5 进入读取示例', () => {
    const r = generateProject(
      baseConfig({
        chip: 'CH32V203C8T6',
        peripherals: { ADC1: { enabled: true, params: { sampleTime: 'CYCLES239_5' } } },
        pins: [pin('PA0', 'ANALOG', { function: 'ADC_IN0' })],
      }),
      DATA.v203,
    )
    expect(r.errors).toEqual([])
    expect(fileOf(r, 'src/generated/adc.rs')).toContain('hal::adc::SampleTime::CYCLES239_5')
  })
})