// M17-S3：ch5xx-hal 后端代码生成测试（CH582M 默认后端，镜像 ch58x 套件结构）。
// 契约：docs/CH5XX_BACKEND_CONTRACT.md D1/D2/D4/D5/D6；S1 实测：docs/m17-shim-notes.md。
// HAL 签名基准 reference/ch5xx-hal @ 875651b6（rcc.rs / gpio.rs / uart.rs / spi.rs / i2c.rs / adc.rs）。
// 覆盖：三分流 + 历史 cube.json legacy（含 store 缺省）、骨架（build.rs/.cargo/rust-toolchain）、
//       blocking/embassy/BLE 三档 feature 矩阵、git 模式守卫、时钟（5 预设 / 20MHz 显式 / 非法 div）、
//       GPIO/UART/SPI/I2C/ADC 逐字、D5 五类生成期错误、cube.json 往返、fileGroup。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  CodegenResult,
  CodegenSelection,
  DeviceData,
  PinAssignment,
  PinMode,
  ProjectConfig,
} from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { mergeClockConfig } from '@/model/clock'
import { generateProject, resolveHalBackend } from '@/model/codegen'
import { generateCh5xxProject } from '@/model/codegen/ch5xx'
import { useProjectStore } from '@/controllers/project'

const data: DeviceData = getDeviceData('CH582M')

function pllClock(div = 8): ProjectConfig['clock'] {
  return mergeClockConfig(data.clock, {
    source: 'PLL',
    pllSource: 'HSE',
    pll: { div },
    ahb: 1,
    apb1: 1,
    apb2: 1,
  })
}

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH582M',
    halBackend: 'ch5xx-hal',
    projectName: 'ch582-demo',
    pins: [],
    naming: { prefix: '' },
    clock: pllClock(8),
    features: { embassy: false, debugPrint: false },
    hal: { rev: 'x' },
    ...over,
  }
}

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

function af(pinName: string, fn: string, remap = 0): PinAssignment {
  return pin(pinName, 'AF', { function: fn, remap })
}

function gen(config: ProjectConfig, selection?: Partial<CodegenSelection>): CodegenResult {
  return generateProject(config, data, selection)
}

function fileMap(r: CodegenResult): Record<string, string> {
  return Object.fromEntries(r.files.map((f) => [f.path, f.content]))
}

function contentOf(r: CodegenResult, path: string): string {
  return r.files.find((x) => x.path === path)?.content ?? '<missing>'
}

/** UART0：remap0 = PB7(TX)/PB4(RX)；remap1 = PA14(TX)/PA15(RX)。 */
function uart0(remap = 0): PinAssignment[] {
  return remap === 0
    ? [af('PB7', 'UART0_TX'), af('PB4', 'UART0_RX')]
    : [af('PA14', 'UART0_TX', 1), af('PA15', 'UART0_RX', 1)]
}

/** SPI0 全双工三线：remap0 = PA13/PA14/PA15；remap1 = PB13/PB14/PB15（后两者为 SWD，需解锁）。 */
function spiFull(remap = 0): PinAssignment[] {
  return remap === 0
    ? [af('PA13', 'SPI0_SCK'), af('PA14', 'SPI0_MOSI'), af('PA15', 'SPI0_MISO')]
    : [af('PB13', 'SPI0_SCK', 1), af('PB14', 'SPI0_MOSI', 1), af('PB15', 'SPI0_MISO', 1)]
}

/** I2C：数据层 id 仍为 I2C，生成器映射到 HAL 单例 I2C0。 */
function i2cPins(remap = 0): PinAssignment[] {
  return remap === 0
    ? [af('PB13', 'I2C_SCL'), af('PB12', 'I2C_SDA')]
    : [af('PB21', 'I2C_SCL', 1), af('PB20', 'I2C_SDA', 1)]
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('后端分流与历史工程（D1）', () => {
  it('resolveHalBackend：显式值优先；缺 halBackend 且 chip 有 legacyHalBackend → legacy', () => {
    expect(resolveHalBackend(baseConfig(), data)).toBe('ch5xx-hal')
    expect(resolveHalBackend(baseConfig({ halBackend: 'ch58x-hal' }), data)).toBe('ch58x-hal')
    // 历史 cube.json（无 halBackend 字段）→ 必须走 legacy，保护旧 main.rs
    expect(resolveHalBackend(baseConfig({ halBackend: undefined }), data)).toBe('ch58x-hal')
    // 新建工程不存在 legacy 声明时 → 回落到 chip.halBackend（ch5xx-hal）
    const noLegacy: DeviceData = { ...data, chip: { ...data.chip, legacyHalBackend: undefined } }
    expect(resolveHalBackend(baseConfig({ halBackend: undefined }), noLegacy)).toBe('ch5xx-hal')
  })

  it('chip.halBackend=ch5xx-hal 默认走 ch5xx 管线（生成 build.rs 与 ch5xx 依赖）', () => {
    const r = gen(baseConfig())
    expect(r.errors).toEqual([])
    expect(r.files.map((f) => f.path)).toContain('build.rs')
    expect(contentOf(r, 'Cargo.toml')).toContain('ch5xx-hal = { path = "vendor/ch5xx-hal"')
    expect(contentOf(r, 'src/generated/mod.rs')).toContain('use ch5xx_hal as hal;')
  })

  it('config.halBackend=ch58x-hal 走 legacy 管线（无 build.rs/.cargo build-std）', () => {
    const r = gen(baseConfig({ halBackend: 'ch58x-hal' }))
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'build.rs')).toBe(false)
    expect(contentOf(r, 'Cargo.toml')).toContain('ch58x-hal = { path = "vendor/ch58x-hal"')
    expect(contentOf(r, 'Cargo.toml')).not.toContain('ch5xx')
    expect(contentOf(r, '.cargo/config.toml')).not.toContain('build-std')
  })

  it('历史 cube.json 缺 halBackend → generateProject 实际走 legacy（不是 ch5xx）', () => {
    const r = gen(baseConfig({ halBackend: undefined }))
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'build.rs')).toBe(false)
    expect(contentOf(r, 'Cargo.toml')).toContain('ch58x-hal')
    expect(fileMap(r)['Cargo.toml']).not.toContain('ch5xx-hal')
  })

  it('新建 CH582M 工程（store.switchDevice）缺省解析为 ch5xx-hal', () => {
    const store = useProjectStore()
    store.switchDevice('CH582M')
    expect(store.effectiveHalBackend).toBe('ch5xx-hal')
    expect(store.config.halBackend).toBe('ch5xx-hal')
  })

  it('store 导入历史 cube.json（缺 halBackend）→ effectiveHalBackend 回 legacy', () => {
    const store = useProjectStore()
    store.switchDevice('CH582M')
    store.loadConfig({
      version: 1,
      chip: 'CH582M',
      projectName: 'old-ch582',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: false, debugPrint: false },
      hal: { rev: 'x' },
    })
    expect(store.config.halBackend).toBeUndefined()
    expect(store.effectiveHalBackend).toBe('ch58x-hal')
  })

  it('generateCh5xxProject 可直接调用（不走 generateProject）', () => {
    const r = generateCh5xxProject(baseConfig(), data, DEFAULT_SELECTION)
    expect(r.errors).toEqual([])
    expect(r.files.length).toBeGreaterThan(0)
  })
})

describe('骨架（D2）', () => {
  it('基础文件清单含 build.rs（ch58x 没有）与 nightly 工具链文件', () => {
    const r = gen(baseConfig())
    expect(r.files.map((f) => f.path)).toEqual([
      'Cargo.toml',
      'rust-toolchain.toml',
      '.cargo/config.toml',
      'build.rs',
      '.gitignore',
      'src/generated/clock.rs',
      'src/generated/pins.rs',
      'src/generated/mod.rs',
      'src/main.rs',
      'cube.json',
      'README.md',
    ])
    expect(r.files.map((f) => f.path)).not.toContain('memory.x')
  })

  it('build.rs 发 -Tlink.x（链接参数不放 rustflags）', () => {
    const c = contentOf(gen(baseConfig()), 'build.rs')
    expect(c).toContain('fn main() {')
    expect(c).toContain('println!("cargo:rustc-link-arg-bins=-Tlink.x");')
    expect(contentOf(gen(baseConfig()), '.cargo/config.toml')).not.toContain('link-arg=-Tlink.x')
  })

  it('.cargo/config.toml：target = riscv32imc + [unstable] build-std = ["core"]', () => {
    const c = contentOf(gen(baseConfig()), '.cargo/config.toml')
    expect(c).toContain('[build]')
    expect(c).toContain('target = "riscv32imc-unknown-none-elf"')
    expect(c).toContain('[unstable]')
    expect(c).toContain('build-std = ["core"]')
    expect(c).not.toContain('runner')
  })

  it('rust-toolchain.toml：nightly + rust-src（chip.nightlyByBackend["ch5xx-hal"]=true）', () => {
    expect(data.chip.nightlyByBackend?.['ch5xx-hal']).toBe(true)
    expect(data.chip.nightlyByBackend?.['ch58x-hal']).toBe(false)
    const c = contentOf(gen(baseConfig()), 'rust-toolchain.toml')
    expect(c).toContain('channel = "nightly"')
    expect(c).toContain('components = ["rust-src"]')
    expect(c).toContain('targets = ["riscv32imc-unknown-none-elf"]')
  })

  it('blocking 档 HAL features = ["ch582", "rt", "memory-x"]，无 embassy/BLE 依赖', () => {
    const c = contentOf(gen(baseConfig()), 'Cargo.toml')
    expect(c).toContain(
      'ch5xx-hal = { path = "vendor/ch5xx-hal", default-features = false, features = ["ch582", "rt", "memory-x"] }',
    )
    expect(c).toContain('qingke-rt = { version = "0.8.4", features = ["highcode"] }')
    expect(c).toContain('panic-halt = "1.0"')
    expect(c).toContain('embedded-hal = "1.0"')
    expect(c).not.toContain('embassy-executor')
    expect(c).not.toContain('embassy-sync')
    expect(c).not.toContain('ch5xx-ble')
  })

  it('embassy 档 features 含 embassy + time-driver-tmr0，deps 0.10/0.5.1，patch 8 条同一 rev', () => {
    const c = contentOf(gen(baseConfig({ features: { embassy: true, debugPrint: false } })), 'Cargo.toml')
    expect(c).toContain(
      'features = ["ch582", "rt", "memory-x", "embassy", "time-driver-tmr0"]',
    )
    expect(c).toContain(
      'embassy-executor = { version = "0.10.0", features = ["platform-riscv32", "executor-thread", "portable-atomic"] }',
    )
    expect(c).toContain('embassy-time = { version = "0.5.1", features = ["tick-hz-1_000_000"] }')
    expect(c).toContain('portable-atomic = { version = "1.11", features = ["critical-section"] }')
    expect(c).toContain('[patch.crates-io]')
    const rev = '4e2fa2e3ae7c9fd62a32193f47af12f68df3df7d'
    expect(c.match(/rev = "4e2fa2e3ae7c9fd62a32193f47af12f68df3df7d"/g)?.length).toBe(8)
    for (const crateName of [
      'embassy-executor',
      'embassy-executor-timer-queue',
      'embassy-sync',
      'embassy-time',
      'embassy-time-driver',
      'embassy-time-queue-utils',
      'embassy-usb',
      'embassy-usb-driver',
    ]) {
      expect(c).toContain(`${crateName} = { git = "https://github.com/embassy-rs/embassy", rev = "${rev}" }`)
    }
  })

  it('BLE 档不启 hal embassy/time-driver；带 ch5xx-ble path + embassy-sync 0.8 + vendor [patch]', () => {
    const cfg = baseConfig({
      features: { embassy: true, debugPrint: false, ble: true },
      ble: {
        role: 'peripheral',
        deviceName: 'CH582M',
        advIntervalMs: 100,
        macSource: 'factory',
        serviceUuid16: 0xffe0,
        notifyUuid16: 0xffe1,
        writeUuid16: 0xffe2,
        scanMs: 3000,
        activeScan: false,
      },
    })
    const c = contentOf(gen(cfg), 'Cargo.toml')
    expect(c).toContain(
      'ch5xx-hal = { path = "vendor/ch5xx-hal", default-features = false, features = ["ch582", "rt", "memory-x"] }',
    )
    expect(c).toContain('ch5xx-ble = { path = "vendor/ch5xx-ble" }')
    expect(c).toContain('embassy-sync = "0.8"')
    expect(c).toContain('critical-section = "1.2"')
    expect(c).toContain('portable-atomic = { version = "1.11", features = ["critical-section"] }')
    expect(c).toContain('[patch."https://github.com/ch32-rs/ch5xx-hal"]')
    expect(c).toContain('ch5xx-hal = { path = "vendor/ch5xx-hal" }')
    expect(c).not.toContain('embassy-executor =')
    expect(c).not.toContain('time-driver-tmr0')
    expect(c).not.toContain('[patch.crates-io]')
  })

  it('git 模式守卫：vendorHal=false → TARGET_FEATURE_UNSUPPORTED，消息含 ch5xx-data', () => {
    const r = gen(baseConfig(), { vendorHal: false })
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'TARGET_FEATURE_UNSUPPORTED' && x.level === 'error')
    expect(e).toBeDefined()
    expect(e!.message).toContain('ch5xx-data')
    expect(e!.message).toContain('vendor')
  })

  it('main.rs：qingke_rt entry + hal::init(generated::clock::config())', () => {
    const c = contentOf(gen(baseConfig()), 'src/main.rs')
    expect(c).toContain('#![no_std]')
    expect(c).toContain('#![no_main]')
    expect(c).toContain('#[qingke_rt::entry]')
    expect(c).toContain('hal::init(hal::Config { rcc: generated::clock::config() })')
  })

  it('embassy 档 main.rs：#![feature(impl_trait_in_assoc_type)] + entry 宏，无 hal::embassy::init', () => {
    const c = contentOf(gen(baseConfig({ features: { embassy: true, debugPrint: false } })), 'src/main.rs')
    expect(c).toContain('#![feature(impl_trait_in_assoc_type)]')
    expect(c).toContain('#[embassy_executor::main(entry = "qingke_rt::entry")]')
    expect(c).toContain('async fn main(_spawner: embassy_executor::Spawner) -> !')
    expect(c).toContain('embassy_time::Timer::after_millis(1000).await')
    expect(c).not.toContain('hal::embassy::init()')
  })
})

describe('时钟（D4/D5）', () => {
  const presets: [number, string][] = [
    [8, 'hal::rcc::Config::PLL_60MHZ'],
    [6, 'hal::rcc::Config::PLL_80MHZ'],
    [10, 'hal::rcc::Config::PLL_48MHZ'],
    [15, 'hal::rcc::Config::PLL_32MHZ'],
    [20, 'hal::rcc::Config::PLL_24MHZ'],
  ]

  for (const [div, presetConst] of presets) {
    it(`预设：div=${div} → ${presetConst}`, () => {
      const r = gen(baseConfig({ clock: pllClock(div) }))
      expect(r.errors).toEqual([])
      const c = contentOf(r, 'src/generated/clock.rs')
      expect(c).toContain('pub fn config() -> hal::rcc::Config {')
      expect(c).toContain(`    ${presetConst}`)
      expect(c).not.toContain('rcc::presets::')
    })
  }

  it('CH582 无 20MHz 预设 → 显式 Config::new(Osc::Hse32, Sys::Pll(24))', () => {
    const r = gen(baseConfig({ clock: pllClock(24) }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/clock.rs')
    expect(c).toContain('hal::rcc::Config::new(hal::rcc::Osc::Hse32, hal::rcc::Sys::Pll(24))')
    expect(c).toContain('480MHz VCO ÷ 24 = 20MHz')
    expect(c).not.toContain('PLL_20MHZ')
  })

  it('非预设合法分频 div=7 → 显式 PLL(7)', () => {
    const r = gen(baseConfig({ clock: pllClock(7) }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/clock.rs')
    expect(c).toContain('hal::rcc::Config::new(hal::rcc::Osc::Hse32, hal::rcc::Sys::Pll(7))')
    expect(c).toContain('480MHz VCO ÷ 7 = 68.57MHz')
  })

  it('HSE 32MHz 直连 → Sys::Direct', () => {
    const clock = mergeClockConfig(data.clock, { source: 'HSE', ahb: 1, apb1: 1, apb2: 1 })
    const r = gen(baseConfig({ clock }))
    expect(r.errors).toEqual([])
    expect(contentOf(r, 'src/generated/clock.rs')).toContain(
      'hal::rcc::Config::new(hal::rcc::Osc::Hse32, hal::rcc::Sys::Direct)',
    )
  })

  it('PLL div=5（旧 2..5 档）→ CLOCK_PRESET_UNAVAILABLE error（6..=32）', () => {
    const r = gen(baseConfig({ clock: pllClock(5) }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'CLOCK_PRESET_UNAVAILABLE')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('6..=32')
    expect(e!.message).toContain('div=5')
  })

  it('PLL div=33 → CLOCK_PRESET_UNAVAILABLE error', () => {
    const r = gen(baseConfig({ clock: pllClock(33) }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'CLOCK_PRESET_UNAVAILABLE')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('div=33')
    expect(e!.message).toContain('480MHz VCO')
  })

  it('CK32K 仅显示源 → CLOCK_PRESET_UNAVAILABLE（HAL 无 SYSCLK 预设）', () => {
    const clock = mergeClockConfig(data.clock, { source: 'CK32K', ahb: 1, apb1: 1, apb2: 1 })
    const r = gen(baseConfig({ clock }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'CLOCK_PRESET_UNAVAILABLE')
    expect(e!.message).toContain('仅生成 PLL')
    expect(e!.message).toContain('CK32K')
  })
})

describe('GPIO（D4）', () => {
  it('输出：Level::High/Low + Speed::High/Low（Speed=驱动电流档）', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: [
            pin('PB18', 'OUTPUT', { label: 'LED_RUN', params: { level: 'HIGH', speed: 'HIGH' } }),
            pin('PB19', 'OUTPUT', { label: 'SLOW', params: { level: 'LOW', speed: 'LOW' } }),
          ],
        }),
      ),
      'src/generated/pins.rs',
    )
    expect(c).toContain('Output::new(pb18, Level::High, Speed::High)')
    expect(c).toContain('Output::new(pb19, Level::Low, Speed::Low)')
    expect(c).toContain('use hal::gpio::{Level, Output, Speed};')
    expect(c).toContain('pub fn init(pb18: hal::Peri<\'static, hal::peripherals::PB18>, ')
    expect(c).toContain('pub led_run: hal::gpio::Output<\'d>,')
  })

  it('输入：Pull::Up/Down/None；句柄无 pin 泛型', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: [
            pin('PB18', 'INPUT', { label: 'KEY_UP', params: { pull: 'UP' } }),
            pin('PB19', 'INPUT', { label: 'KEY_DN', params: { pull: 'DOWN' } }),
            pin('PB20', 'INPUT', { label: 'KEY_FL', params: { pull: 'NONE' } }),
          ],
        }),
      ),
      'src/generated/pins.rs',
    )
    expect(c).toContain('Input::new(pb18, Pull::Up)')
    expect(c).toContain('Input::new(pb19, Pull::Down)')
    expect(c).toContain('Input::new(pb20, Pull::None)')
    expect(c).toContain('pub key_up: hal::gpio::Input<\'d>,')
  })

  it('AF 引脚不生成 GPIO；模拟引脚不建 Input/Output（归 ADC）', () => {
    const r = gen(
      baseConfig({
        pins: [...uart0(), pin('PA4', 'ANALOG', { function: 'ADC_IN0' })],
      }),
    )
    const c = contentOf(r, 'src/generated/pins.rs')
    expect(c).not.toContain('PB7')
    expect(c).not.toContain('PB4')
    expect(c).not.toContain('PA4')
    expect(c).toContain('pub struct Pins {}')
  })

  it('开漏输出 → TARGET_FEATURE_UNSUPPORTED error（HAL 只有推挽）', () => {
    const r = gen(baseConfig({ pins: [pin('PB18', 'OUTPUT', { params: { outputType: 'OPEN_DRAIN' } })] }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'TARGET_FEATURE_UNSUPPORTED')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('开漏')
    expect(e!.pins).toEqual(['PB18'])
  })

  it('标签前缀作用于字段与形参', () => {
    const c = contentOf(
      gen(baseConfig({ naming: { prefix: 'app' }, pins: [pin('PB18', 'OUTPUT', { label: 'LED_RUN' })] })),
      'src/generated/pins.rs',
    )
    expect(c).toContain('pub app_led_run:')
    expect(c).toContain('app_led_run: Output::new(pb18')
  })
})

describe('UART（D4）', () => {
  it('remap0：new_blocking::<0>(peri, rx, tx, config)（先 rx 后 tx）+ 8N1 逐字', () => {
    const c = contentOf(gen(baseConfig({ pins: uart0(0) })), 'src/generated/usart.rs')
    expect(c).toContain("pub type Uart0 = hal::uart::Uart<'static, hal::peripherals::UART0, hal::mode::Blocking>;")
    expect(c).toContain('    peri: hal::Peri<\'static, hal::peripherals::UART0>,')
    expect(c).toContain('    rx: hal::Peri<\'static, hal::peripherals::PB4>,')
    expect(c).toContain('    tx: hal::Peri<\'static, hal::peripherals::PB7>,')
    expect(c).toContain('let mut config = hal::uart::Config::new(115200);')
    expect(c).toContain('config.data_bits = hal::uart::DataBits::DataBits8;')
    expect(c).toContain('config.parity = hal::uart::Parity::None;')
    expect(c).toContain('config.stop_bits = hal::uart::StopBits::Stop1;')
    expect(c).toContain('hal::uart::Uart::new_blocking::<0>(peri, rx, tx, config).unwrap()')
    // 参数顺序：peri → rx → tx
    expect(c.indexOf('    rx: ')).toBeLessThan(c.indexOf('    tx: '))
    expect(c).not.toContain('.Hz()')
  })

  it('remap1：REMAP const 泛型 = 1；参数覆盖（7E2）', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: uart0(1),
          peripherals: {
            UART0: {
              enabled: true,
              params: { baudrate: 921600, dataBits: 'DataBits7', stopBits: 'STOP2', parity: 'ParityEven' },
            },
          },
        }),
      ),
      'src/generated/usart.rs',
    )
    expect(c).toContain('hal::uart::Uart::new_blocking::<1>(peri, rx, tx, config).unwrap()')
    expect(c).toContain('hal::uart::Config::new(921600)')
    expect(c).toContain('hal::uart::DataBits::DataBits7')
    expect(c).toContain('hal::uart::StopBits::Stop2')
    expect(c).toContain('hal::uart::Parity::Even')
    expect(c).toContain('921600 7E2')
  })

  it('mod.rs 聚合字段与 init 调用实参顺序（p.UART0, rx, tx）', () => {
    const c = contentOf(gen(baseConfig({ pins: uart0(0) })), 'src/generated/mod.rs')
    expect(c).toContain('pub uart0: usart::Uart0,')
    expect(c).toContain('uart0: usart::init_uart0(p.UART0, p.PB4, p.PB7),')
  })

  it('缺 TX/RX → USART_TX_MISSING / USART_RX_MISSING error', () => {
    const noTx = gen(baseConfig({ pins: [af('PB4', 'UART0_RX')] }))
    expect(noTx.errors.some((e) => e.code === 'USART_TX_MISSING' && e.level === 'error')).toBe(true)
    const noRx = gen(baseConfig({ pins: [af('PB7', 'UART0_TX')] }))
    expect(noRx.errors.some((e) => e.code === 'USART_RX_MISSING' && e.level === 'error')).toBe(true)
  })
})

describe('SPI（D4）', () => {
  it('MODE_0 + Hertz + new_blocking(sck, mosi, miso) 逐字', () => {
    const c = contentOf(gen(baseConfig({ pins: spiFull(0) })), 'src/generated/spi.rs')
    expect(c).toContain("pub type Spi0 = hal::spi::Spi<'static, hal::peripherals::SPI0, hal::mode::Blocking>;")
    expect(c).toContain('let mut config = hal::spi::Config::default();')
    expect(c).toContain('config.frequency = hal::time::Hertz(1_000_000);')
    expect(c).toContain('config.mode = embedded_hal::spi::MODE_0;')
    expect(c).toContain('config.bit_order = hal::spi::BitOrder::MsbFirst;')
    expect(c).toContain('hal::spi::Spi::new_blocking::<0>(peri, sck, mosi, miso, config).unwrap()')
    expect(c).not.toContain('.Hz()')
  })

  it('IdleHigh → MODE_3；remap1 const = 1；LsbFirst/4MHz', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: spiFull(1),
          unlockedPins: ['PB14', 'PB15'],
          peripherals: {
            SPI0: {
              enabled: true,
              // MODE_3 = CPOL=1（IdleHigh）+ CPHA=1（第二沿采样）；只给 IdleHigh 是 mode 2（生成期拒绝）
              params: {
                clockPolarity: 'IdleHigh',
                clockPhase: 'CaptureOnSecondTransition',
                bitOrder: 'LsbFirst',
                frequency: 4_000_000,
              },
            },
          },
        }),
      ),
      'src/generated/spi.rs',
    )
    expect(c).toContain('config.mode = embedded_hal::spi::MODE_3;')
    expect(c).toContain('hal::spi::Spi::new_blocking::<1>(peri, sck, mosi, miso, config).unwrap()')
    expect(c).toContain('config.frequency = hal::time::Hertz(4_000_000);')
    expect(c).toContain('hal::spi::BitOrder::LsbFirst')
  })

  it('NSS 分配 → 独立软件片选 Output（初值 High，Speed::Low）', () => {
    const r = gen(baseConfig({ pins: [...spiFull(0), af('PA12', 'SPI0_NSS')] }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/spi.rs')
    expect(c).toContain("pub type Spi0Nss = hal::gpio::Output<'static>;")
    expect(c).toContain('hal::gpio::Output::new(nss, hal::gpio::Level::High, hal::gpio::Speed::Low)')
    const mod_ = contentOf(r, 'src/generated/mod.rs')
    expect(mod_).toContain('pub spi0_nss: spi::Spi0Nss,')
    expect(mod_).toContain('spi0_nss: spi::init_spi0_nss(p.PA12),')
  })

  it('缺 SCK → REMAP_UNDEFINED error；缺 MISO/MOSI → SPI_HALFDUPLEX_UNSUPPORTED', () => {
    const noSck = gen(baseConfig({ pins: [af('PA14', 'SPI0_MOSI'), af('PA15', 'SPI0_MISO')] }))
    expect(noSck.errors.some((e) => e.code === 'REMAP_UNDEFINED' && /SCK/.test(e.message))).toBe(true)
    const txOnly = gen(baseConfig({ pins: [af('PA13', 'SPI0_SCK'), af('PA14', 'SPI0_MOSI')] }))
    expect(txOnly.errors.some((e) => e.code === 'SPI_HALFDUPLEX_UNSUPPORTED')).toBe(true)
    const rxOnly = gen(baseConfig({ pins: [af('PA13', 'SPI0_SCK'), af('PA15', 'SPI0_MISO')] }))
    expect(rxOnly.errors.some((e) => e.code === 'SPI_HALFDUPLEX_UNSUPPORTED')).toBe(true)
  })
})

describe('I2C（D4；Fsys=24MHz 以满足 2..=36MHz）', () => {
  const i2cBase = () => baseConfig({ clock: pllClock(20) })

  it('remap0：I2C0 单例映射 + Duty::Ratio2to1 + Hertz + 无上拉字段', () => {
    const c = contentOf(gen({ ...i2cBase(), pins: i2cPins(0) }), 'src/generated/i2c.rs')
    expect(c).toContain("pub type I2c = hal::i2c::I2c<'static, hal::peripherals::I2C0, hal::mode::Blocking>;")
    expect(c).toContain('    peri: hal::Peri<\'static, hal::peripherals::I2C0>,')
    expect(c).toContain('let mut config = hal::i2c::Config::default();')
    expect(c).toContain('config.frequency = hal::time::Hertz(100_000);')
    expect(c).toContain('config.duty = hal::i2c::Duty::Ratio2to1;')
    expect(c).toContain('hal::i2c::I2c::new_blocking::<0>(peri, scl, sda, config).unwrap()')
    expect(c).not.toContain('config.sda_pullup')
    expect(c).not.toContain('config.scl_pullup')
    expect(c).not.toContain('.Hz()')
    const mod_ = contentOf(gen({ ...i2cBase(), pins: i2cPins(0) }), 'src/generated/mod.rs')
    expect(mod_).toContain('i2c: i2c::init_i2c(p.I2C0, p.PB13, p.PB12),')
  })

  it('remap1 + Duty16_9/400kHz 覆盖', () => {
    const c = contentOf(
      gen(
        {
          ...i2cBase(),
          pins: i2cPins(1),
          peripherals: { I2C: { enabled: true, params: { frequency: 400_000, duty: 'Duty16_9' } } },
        },
      ),
      'src/generated/i2c.rs',
    )
    expect(c).toContain('hal::i2c::I2c::new_blocking::<1>(peri, scl, sda, config).unwrap()')
    expect(c).toContain('config.frequency = hal::time::Hertz(400_000);')
    expect(c).toContain('config.duty = hal::i2c::Duty::Ratio16to9;')
  })

  it('缺 SCL/SDA → REMAP_UNDEFINED error', () => {
    const r = gen({ ...i2cBase(), pins: [af('PB13', 'I2C_SCL')] })
    expect(r.errors.some((e) => e.code === 'REMAP_UNDEFINED' && /SDA/.test(e.message))).toBe(true)
  })
})

describe('ADC（D4）', () => {
  const adcPins = () => [
    pin('PA4', 'ANALOG', { function: 'ADC_IN0' }),
    pin('PA5', 'ANALOG', { function: 'ADC_IN1' }),
    pin('PA6', 'ANALOG', { function: 'ADC_IN10' }),
    pin('PA9', 'ANALOG', { function: 'ADC_IN13' }),
  ]

  it('Config::default() 后逐字段赋值；Gain/SampleClock 默认 Div2/Divide1', () => {
    const r = gen(baseConfig({ pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' })] }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/adc.rs')
    expect(c).toContain("pub type Adc = hal::adc::Adc<'static, hal::peripherals::ADC>;")
    expect(c).toContain('let mut config = hal::adc::Config::default();')
    expect(c).toContain('config.gain = hal::adc::Gain::Div2;')
    expect(c).toContain('config.sample_clock = hal::adc::SampleClock::Divide1;')
    expect(c).toContain('hal::adc::Adc::new(peri, config)')
    expect(c.indexOf('Config::default()')).toBeLessThan(c.indexOf('config.gain'))
    expect(c.indexOf('config.gain')).toBeLessThan(c.indexOf('config.sample_clock'))
  })

  it('SampleClock 映射（3.2M→Divide1 / 8M→Divide2 / 5.33M→Divide3 / 4M→Divide4）', () => {
    const cases: [string, string][] = [
      ['_3_2MHz', 'Divide1'],
      ['_8MHz', 'Divide2'],
      ['_5_33MHz', 'Divide3'],
      ['_4MHz', 'Divide4'],
    ]
    for (const [param, variant] of cases) {
      const r = gen(
        baseConfig({
          pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' })],
          peripherals: { ADC: { enabled: true, params: { samplingClock: param } } },
        }),
      )
      expect(r.errors).toEqual([])
      expect(contentOf(r, 'src/generated/adc.rs')).toContain(`hal::adc::SampleClock::${variant}`)
    }
  })

  it('Gain 映射（GAIN1_4→Div4 / GAIN1→Unity / GAIN2→X2）', () => {
    const cases: [string, string][] = [
      ['GAIN1_4', 'Div4'],
      ['GAIN1', 'Unity'],
      ['GAIN2', 'X2'],
    ]
    for (const [param, variant] of cases) {
      const r = gen(
        baseConfig({
          pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' })],
          peripherals: { ADC: { enabled: true, params: { pgaGain: param } } },
        }),
      )
      expect(contentOf(r, 'src/generated/adc.rs')).toContain(`hal::adc::Gain::${variant}`)
    }
  })

  it('blocking_read 注释 + GPIO 单例通道表（PA4=ch0 … PA9=ch13）', () => {
    const r = gen(baseConfig({ pins: adcPins() }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/adc.rs')
    expect(c).toContain('let raw = g.adc.blocking_read(&mut g.adc_in0).unwrap();')
    expect(c).toContain('// adc_in0 → PA4（ADC_IN0）')
    expect(c).toContain('// adc_in1 → PA5（ADC_IN1）')
    expect(c).toContain('// adc_in10 → PA6（ADC_IN10）')
    expect(c).toContain('// adc_in13 → PA9（ADC_IN13）')
    expect(c).toContain('read_as_millivolts')
    const mod_ = contentOf(r, 'src/generated/mod.rs')
    expect(mod_).toContain('pub adc_in0: hal::Peri<\'static, hal::peripherals::PA4>,')
    expect(mod_).toContain('pub adc_in13: hal::Peri<\'static, hal::peripherals::PA9>,')
    expect(mod_).toContain('adc_in0: p.PA4,')
    expect(mod_).toContain('adc_in13: p.PA9,')
  })

  it('模拟引脚不进入 pins.rs（无 Input/Output，Pins 为空）', () => {
    const c = contentOf(gen(baseConfig({ pins: adcPins() })), 'src/generated/pins.rs')
    expect(c).not.toContain('PA4')
    expect(c).not.toContain('PA9')
    expect(c).toContain('pub struct Pins {}')
  })
})

describe('生成期错误 D5（五类各一例）', () => {
  it('UART 波特率 2% 越界：Fsys=5.333MHz / 115200 → DL6 → 111111（3.55%）→ BAUDRATE_UNREPRESENTABLE', () => {
    const r = gen(baseConfig({ clock: pllClock(90), pins: uart0(0) }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'BAUDRATE_UNREPRESENTABLE')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('误差 3.55%')
    expect(e!.message).toContain('111111')
    expect(e!.message).toContain('2%')
  })

  it('SPI mode 1（显式 mode）与 mode 2（IdleHigh+首沿采样）→ SPI_MODE_UNSUPPORTED', () => {
    const mode1 = gen(
      baseConfig({
        pins: spiFull(0),
        peripherals: { SPI0: { enabled: true, params: { mode: 'MODE_1' } } },
      }),
    )
    expect(mode1.errors.some((e) => e.code === 'SPI_MODE_UNSUPPORTED' && /mode 1/.test(e.message))).toBe(true)
    const mode2 = gen(
      baseConfig({
        pins: spiFull(0),
        peripherals: { SPI0: { enabled: true, params: { clockPolarity: 'IdleHigh' } } },
      }),
    )
    expect(mode2.errors.some((e) => e.code === 'SPI_MODE_UNSUPPORTED' && /mode 2/.test(e.message))).toBe(true)
  })

  it('SPI 显式 mode3 + 缺省极性 → 渲染 MODE_3（校验/渲染同源回归，S3 发现错码）', () => {
    const r = gen(
      baseConfig({
        pins: spiFull(0),
        peripherals: { SPI0: { enabled: true, params: { mode: 'MODE_3' } } },
      }),
    )
    expect(r.errors.some((e) => e.code === 'SPI_MODE_UNSUPPORTED')).toBe(false)
    const c = contentOf(r, 'src/generated/spi.rs')
    expect(c).toContain('config.mode = embedded_hal::spi::MODE_3')
    expect(c).not.toContain('config.mode = embedded_hal::spi::MODE_0')
  })

  it('SPI freq > Fsys/2 → SPI_FREQUENCY_UNREPRESENTABLE（60MHz 下 40MHz）', () => {
    const r = gen(
      baseConfig({
        pins: spiFull(0),
        peripherals: { SPI0: { enabled: true, params: { frequency: 40_000_000 } } },
      }),
    )
    const e = r.errors.find((x) => x.code === 'SPI_FREQUENCY_UNREPRESENTABLE')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('超过 Fsys/2')
    expect(e!.message).toContain('30000kHz')
  })

  it('SPI 半双工（仅 MOSI）→ SPI_HALFDUPLEX_UNSUPPORTED', () => {
    const r = gen(baseConfig({ pins: [af('PA13', 'SPI0_SCK'), af('PA14', 'SPI0_MOSI')] }))
    const e = r.errors.find((x) => x.code === 'SPI_HALFDUPLEX_UNSUPPORTED')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('全双工')
    expect(e!.message).toContain('MOSI 与 MISO')
  })

  it('I2C Fsys=60MHz → I2C_CLOCK_OUT_OF_RANGE（CTRL2.FREQ 2..=36MHz）', () => {
    const r = gen(baseConfig({ clock: pllClock(8), pins: i2cPins(0) }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'I2C_CLOCK_OUT_OF_RANGE')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('60MHz')
    expect(e!.message).toContain('2..=36MHz')
  })
})

describe('配置回读与文件组', () => {
  it('cube.json 往返保留 halBackend（ch5xx-hal）与全部配置', () => {
    const cfg = baseConfig({ pins: [pin('PB18', 'OUTPUT', { label: 'LED' })] })
    const cube = JSON.parse(contentOf(gen(cfg), 'cube.json')) as ProjectConfig
    expect(cube).toEqual(cfg)
    expect(cube.halBackend).toBe('ch5xx-hal')
  })

  it('fileGroup：main=user_code、generated=generated、Cargo/build.rs/README=project_file', () => {
    const r = gen(baseConfig({ pins: [pin('PB18', 'OUTPUT')] }))
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f.group]))
    expect(byPath['src/main.rs']).toBe('user_code')
    expect(byPath['src/generated/mod.rs']).toBe('generated')
    expect(byPath['Cargo.toml']).toBe('project_file')
    expect(byPath['build.rs']).toBe('project_file')
    expect(byPath['README.md']).toBe('project_file')
  })

  it('确定性：同一输入两次生成逐字节一致', () => {
    const cfg = baseConfig({ pins: [...uart0(), ...spiFull(), pin('PB18', 'OUTPUT', { label: 'LED' })] })
    expect(fileMap(gen(cfg))).toEqual(fileMap(gen(cfg)))
  })

  it('README 声明 ch5xx-hal / nightly build-std / 诚实能力边界', () => {
    const c = contentOf(gen(baseConfig()), 'README.md')
    expect(c).toContain('ch5xx-hal')
    expect(c).toContain('build.rs')
    expect(c).toContain('-Tlink.x')
    expect(c).toContain('nightly + rust-src')
    expect(c).toContain('SPI_HALFDUPLEX_UNSUPPORTED')
    expect(c).toContain('BAUDRATE_UNREPRESENTABLE')
  })
})