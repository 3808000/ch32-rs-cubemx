// M11：ch58x-hal 后端代码生成测试（CH582M）。
// 契约：docs/CH58X_BACKEND_CONTRACT.md；HAL 签名基准 reference/ch58x-hal @ 611954e。
// 覆盖：blocking/embassy 骨架、6 档预设、显式 PLL(div)、非 PLL 源 error、PB17 拦截、
//       开漏 error、debugPrint warning、UART/SPI/I2C/ADC 初始化逐字、NSS 软件 CS、
//       txonly/rxonly、vendor/git 切换、fileGroup、cube.json 回读、selection 开关。
import { describe, expect, it } from 'vitest'
import type { CodegenResult, CodegenSelection, DeviceData, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { mergeClockConfig } from '@/model/clock'
import { generateProject } from '@/model/codegen'
import { generateCh58xProject } from '@/model/codegen/ch58x'
import { featureWarnings, resolveClock } from '@/model/codegen/ch58x/derive'
import { CH58X_HAL_GIT, CH58X_HAL_REV, HAL_REV } from '@/model/codegen/halRev'

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
    projectName: 'ch582-demo',
    pins: [],
    naming: { prefix: '' },
    clock: pllClock(8),
    features: { embassy: false, debugPrint: false },
    hal: { rev: CH58X_HAL_REV },
    ...over,
  }
}

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

function af(pinName: string, fn: string, remap = 0): PinAssignment {
  return pin(pinName, 'AF', { function: fn, remap })
}

function fileMap(r: CodegenResult): Record<string, string> {
  return Object.fromEntries(r.files.map((f) => [f.path, f.content]))
}

function contentOf(r: CodegenResult, path: string): string {
  const f = r.files.find((x) => x.path === path)
  return f?.content ?? '<missing>'
}

function gen(config: ProjectConfig, selection?: Partial<CodegenSelection>): CodegenResult {
  return generateProject(config, data, selection)
}

function uart0(remap = 0): PinAssignment[] {
  return remap === 0 ? [af('PB7', 'UART0_TX'), af('PB4', 'UART0_RX')] : [af('PA14', 'UART0_TX', 1), af('PA15', 'UART0_RX', 1)]
}

function spiFull(remap = 0): PinAssignment[] {
  return remap === 0
    ? [af('PA13', 'SPI0_SCK'), af('PA14', 'SPI0_MOSI'), af('PA15', 'SPI0_MISO')]
    : [af('PB13', 'SPI0_SCK', 1), af('PB14', 'SPI0_MOSI', 1), af('PB15', 'SPI0_MISO', 1)]
}

describe('ch58x 后端分流与骨架', () => {
  it('generateProject 按 halBackend=ch58x-hal 分流（不再返回占位错误）', () => {
    const r = gen(baseConfig())
    expect(r.errors).toEqual([])
    expect(r.files.length).toBeGreaterThan(0)
  })

  it('空配置生成基础文件清单（无 build.rs / memory.x / target json）', () => {
    const r = gen(baseConfig())
    expect(r.files.map((f) => f.path)).toEqual([
      'Cargo.toml',
      'rust-toolchain.toml',
      '.cargo/config.toml',
      '.gitignore',
      'src/generated/clock.rs',
      'src/generated/pins.rs',
      'src/generated/mod.rs',
      'src/main.rs',
      'cube.json',
      'README.md',
    ])
    expect(r.files.some((f) => f.path === 'build.rs')).toBe(false)
    expect(r.files.some((f) => f.path === 'memory.x')).toBe(false)
    expect(r.files.some((f) => f.path.endsWith('.json') && f.path !== 'cube.json')).toBe(false)
  })

  it('Cargo.toml：edition 2021 + qingke-rt 0.5 highcode + HAL features 恒为 embassy + harness=false', () => {
    const c = contentOf(gen(baseConfig()), 'Cargo.toml')
    expect(c).toContain('edition = "2021"')
    expect(c).toContain('harness = false')
    expect(c).toContain('qingke-rt = { version = "0.5.0", features = ["highcode"] }')
    expect(c).toContain('panic-halt = "0.2.0"')
    expect(c).toContain('default-features = false, features = ["embassy"]')
    expect(c).toContain('[profile.release]')
    expect(c).toContain('panic = "abort"')
    expect(c).toContain('opt-level = "z"')
    expect(c).toContain('[profile.release-debug]')
    expect(c).toContain('inherits = "release"')
    // BLE 本期不生成
    expect(c).not.toContain('"ble"')
    expect(c).not.toContain('LIBCH58xBLE')
  })

  it('blocking：main.rs 用 #[qingke_rt::entry]（stable，无 feature 属性）', () => {
    const c = contentOf(gen(baseConfig()), 'src/main.rs')
    expect(c).toContain('#![no_std]')
    expect(c).toContain('#![no_main]')
    expect(c).toContain('#[qingke_rt::entry]')
    expect(c).toContain('hal::init(generated::clock::config())')
    expect(c).not.toContain('#![feature(')
    expect(c).not.toContain('embassy')
  })

  it('blocking：Cargo 显式 generic-queue（__pender 链接修复），无 embassy-executor', () => {
    const c = contentOf(gen(baseConfig()), 'Cargo.toml')
    // HAL 非可选依赖 embassy-time-queue-utils 默认 integrated queue 引用 __pender；
    // blocking 无 executor 提供该符号 → 必须 feature 统一到 generic-queue
    expect(c).toContain('embassy-time-queue-utils = { version = "0.1.0", features = ["generic-queue-8"] }')
    expect(c).not.toContain('embassy-executor')
  })

  it('embassy：Cargo 不强制 generic-queue（main 宏提供 __pender，integrated queue 可用）', () => {
    const c = contentOf(gen(baseConfig({ features: { embassy: true, debugPrint: false } })), 'Cargo.toml')
    expect(c).not.toContain('embassy-time-queue-utils')
    expect(c).toContain('embassy-executor')
  })

  it('embassy：entry 宏 + nightly feature + hal::embassy::init() 在 hal::init 之后', () => {
    const c = contentOf(gen(baseConfig({ features: { embassy: true, debugPrint: false } })), 'src/main.rs')
    expect(c).toContain('#![feature(impl_trait_in_assoc_type)]')
    expect(c).toContain('#[embassy_executor::main(entry = "qingke_rt::entry")]')
    expect(c).toContain('async fn main(_spawner: embassy_executor::Spawner) -> !')
    expect(c).toContain('embassy_time::Timer::after_millis')
    const iInit = c.indexOf('hal::init(')
    const iEmbassy = c.indexOf('hal::embassy::init();')
    expect(iInit).toBeGreaterThanOrEqual(0)
    expect(iEmbassy).toBeGreaterThan(iInit)
  })

  it('embassy：Cargo 追加 embassy-executor 0.7 / embassy-time 0.4，工具链 nightly', () => {
    const r = gen(baseConfig({ features: { embassy: true, debugPrint: false } }))
    const cargo = contentOf(r, 'Cargo.toml')
    expect(cargo).toContain('embassy-executor = { version = "0.7.0", features = ["nightly", "arch-riscv32", "executor-thread"] }')
    expect(cargo).toContain('embassy-time = "0.4.0"')
    const toolchain = contentOf(r, 'rust-toolchain.toml')
    expect(toolchain).toContain('channel = "nightly"')
    expect(toolchain).toContain('targets = ["riscv32imc-unknown-none-elf"]')
  })

  it('blocking：工具链 stable + target', () => {
    const toolchain = contentOf(gen(baseConfig()), 'rust-toolchain.toml')
    expect(toolchain).toContain('channel = "stable"')
    expect(toolchain).toContain('targets = ["riscv32imc-unknown-none-elf"]')
  })

  it('.cargo/config.toml：target + -Tlink.x rustflags，无 runner', () => {
    const c = contentOf(gen(baseConfig()), '.cargo/config.toml')
    expect(c).toContain('[build]')
    expect(c).toContain('target = "riscv32imc-unknown-none-elf"')
    expect(c).toContain('rustflags = ["-C", "link-arg=-Tlink.x"]')
    expect(c).not.toContain('runner')
  })

  it('vendorHal=true：path = "vendor/ch58x-hal"', () => {
    const c = contentOf(gen(baseConfig()), 'Cargo.toml')
    expect(c).toContain('ch58x-hal = { path = "vendor/ch58x-hal", default-features = false, features = ["embassy"] }')
  })

  it('vendorHal=false：git + 锁定 ch58x rev', () => {
    const c = contentOf(gen(baseConfig(), { vendorHal: false }), 'Cargo.toml')
    expect(c).toContain(`ch58x-hal = { git = "${CH58X_HAL_GIT}", rev = "${CH58X_HAL_REV}", default-features = false, features = ["embassy"] }`)
    expect(c).not.toContain('path = "vendor/ch58x-hal"')
  })
})

describe('时钟（D3）', () => {
  const presets: [number, string][] = [
    [8, 'config.clock.use_pll_60mhz()'],
    [6, 'config.clock.use_pll_80mhz()'],
    [10, 'config.clock.use_pll_48mhz()'],
    [15, 'config.clock.use_pll_32mhz()'],
    [20, 'config.clock.use_pll_24mhz()'],
    [24, 'config.clock.use_pll_20mhz()'],
  ]

  for (const [div, call] of presets) {
    it(`6 档预设：div=${div} → ${call}`, () => {
      const r = gen(baseConfig({ clock: pllClock(div) }))
      expect(r.errors).toEqual([])
      const c = contentOf(r, 'src/generated/clock.rs')
      expect(c).toContain(call)
      expect(c).toContain('let mut config = hal::Config::default();')
      expect(c).toContain('config\n}')
    })
  }

  it('非预设 PLL 分频 → config.clock.mux = ClockSrc::PLL(7)', () => {
    const r = gen(baseConfig({ clock: pllClock(7) }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/clock.rs')
    expect(c).toContain('config.clock.mux = hal::sysctl::ClockSrc::PLL(7);')
    expect(c).toContain('480MHz VCO ÷ 7')
  })

  it('非 PLL 源（HSE）→ CLOCK_PRESET_UNAVAILABLE error', () => {
    const clock = mergeClockConfig(data.clock, { source: 'HSE', hxtalMhz: 32, ahb: 1, apb1: 1, apb2: 1 })
    const r = gen(baseConfig({ clock }))
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'CLOCK_PRESET_UNAVAILABLE' && e.level === 'error')).toBe(true)
    expect(r.errors.find((e) => e.code === 'CLOCK_PRESET_UNAVAILABLE')!.message).toContain('仅生成 PLL')
  })

  it('非法 div=32 → CLOCK_PRESET_UNAVAILABLE error（5 位寄存器截断为 0）', () => {
    const clock = mergeClockConfig(data.clock, { source: 'PLL', pllSource: 'HSE', pll: { div: 32 }, ahb: 1, apb1: 1, apb2: 1 })
    const r = gen(baseConfig({ clock }))
    expect(r.errors.some((e) => e.code === 'CLOCK_PRESET_UNAVAILABLE' && /2\.\.=31/.test(e.message))).toBe(true)
  })

  it('resolveClock 返回显式 div 与预设方法两条路径', () => {
    expect(resolveClock(baseConfig({ clock: pllClock(8) }), data).presetConst).toBe('config.clock.use_pll_60mhz()')
    expect(resolveClock(baseConfig({ clock: pllClock(7) }), data).div).toBe(7)
    expect(resolveClock(baseConfig({ clock: pllClock(7) }), data).error).toBeUndefined()
  })
})

describe('GPIO（D4）', () => {
  it('输出：Level + OutputDrive（HIGH→_20mA）', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: [pin('PB18', 'OUTPUT', { label: 'LED_RUN', params: { level: 'HIGH', speed: 'HIGH' } })],
        }),
      ),
      'src/generated/pins.rs',
    )
    expect(c).toContain("pub led_run: Output<'d, hal::peripherals::PB18>,")
    expect(c).toContain('Output::new(pb18, Level::High, OutputDrive::_20mA)')
    expect(c).toContain('pub fn init(pb18: hal::peripherals::PB18) -> Pins')
  })

  it('输出：LOW/MEDIUM/VERY_HIGH → _5mA（HAL 无 Speed 枚举）', () => {
    for (const speed of ['LOW', 'MEDIUM', 'VERY_HIGH'] as const) {
      const c = contentOf(
        gen(baseConfig({ pins: [pin('PB18', 'OUTPUT', { label: 'X', params: { level: 'LOW', speed } })] })),
        'src/generated/pins.rs',
      )
      expect(c).toContain('OutputDrive::_5mA')
      expect(c).not.toContain('_20mA')
    }
  })

  it('输入：Pull::Up / Down / None', () => {
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
    expect(c).toContain("pub key_up: Input<'d, hal::peripherals::PB18>,")
  })

  it('AF 引脚不生成 GPIO 代码（由外设构造器消费）', () => {
    const c = contentOf(gen(baseConfig({ pins: [...uart0()] })), 'src/generated/pins.rs')
    expect(c).not.toContain('PB7')
    expect(c).not.toContain('PB4')
    expect(c).toContain('pub struct Pins {}')
  })

  it('ANALOG 引脚不进 pins.rs（裸单例字段在 Generated/adc.rs）', () => {
    const c = contentOf(gen(baseConfig({ pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' })] })), 'src/generated/pins.rs')
    expect(c).not.toContain('PA4')
    expect(c).toContain('pub struct Pins {}')
  })

  it('RESERVED 引脚跳过', () => {
    const r = gen(baseConfig({ pins: [pin('PB0', 'RESERVED')] }))
    expect(r.errors).toEqual([])
    expect(contentOf(r, 'src/generated/pins.rs')).not.toContain('PB0')
  })

  it('标签前缀：naming.prefix 作用于字段与形参', () => {
    const c = contentOf(
      gen(baseConfig({ naming: { prefix: 'app' }, pins: [pin('PB18', 'OUTPUT', { label: 'LED_RUN' })] })),
      'src/generated/pins.rs',
    )
    expect(c).toContain('pub app_led_run:')
    expect(c).toContain('app_led_run: Output::new(pb18')
  })

  it('开漏输出 → TARGET_FEATURE_UNSUPPORTED error', () => {
    const r = gen(baseConfig({ pins: [pin('PB18', 'OUTPUT', { params: { outputType: 'OPEN_DRAIN' } })] }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'TARGET_FEATURE_UNSUPPORTED')
    expect(e?.level).toBe('error')
    expect(e?.message).toContain('开漏')
    expect(e?.pins).toEqual(['PB18'])
  })

  it('PB17 经 checkConflicts（HAL_PIN_UNSUPPORTED）拦截', () => {
    const r = gen(baseConfig({ pins: [pin('PB17', 'OUTPUT', { label: 'BAD' })] }))
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'HAL_PIN_UNSUPPORTED' && e.pins?.includes('PB17'))).toBe(true)
  })
})

describe('debugPrint / 警告不阻止导出（D10）', () => {
  it('debugPrint=true 不报 error，生成可继续', () => {
    const r = gen(baseConfig({ features: { embassy: false, debugPrint: true } }))
    expect(r.errors).toEqual([])
    expect(r.files.length).toBeGreaterThan(0)
  })

  it('featureWarnings 返回 TARGET_FEATURE_UNSUPPORTED warning（说明忽略）', () => {
    const w = featureWarnings(baseConfig({ features: { embassy: false, debugPrint: true } }))
    const item = w.find((x) => x.code === 'TARGET_FEATURE_UNSUPPORTED')
    expect(item?.level).toBe('warning')
    expect(item?.message).toContain('debugPrint')
    expect(item?.message).toContain('MRS')
  })

  it('README 诚实标注 debugPrint 被忽略', () => {
    const c = contentOf(gen(baseConfig({ features: { embassy: false, debugPrint: true } })), 'README.md')
    expect(c).toContain('debugPrint')
    expect(c).toContain('SDIPrint')
    expect(c).toContain('本次生成的提示')
  })

  it('中断/DMA 配置被忽略（含未知 IRQ；warning 进 README，不阻止导出）', () => {
    const cfg = baseConfig({
      interrupts: [{ irq: 'NOT_A_CH58X_IRQ', enabled: true, priority: 1 }],
      dma: [{ peripheral: 'SPI0_TX', channel: 1 }],
      pins: [pin('PB18', 'INPUT', { params: { pull: 'UP' } })],
    })
    const r = gen(cfg)
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'src/generated/irq.rs')).toBe(false)
    const readme = contentOf(r, 'README.md')
    expect(readme).toContain('中断配置（含未启用条目）已忽略')
    expect(readme).toContain('DMA 配置已忽略')
    // 普通输入照常生成
    expect(contentOf(r, 'src/generated/pins.rs')).toContain('Input::new(pb18')
  })

  it('featureWarnings：EXTI 配置提示被忽略（ch58x 无 pin→通道映射）', () => {
    const w = featureWarnings(baseConfig({ pins: [pin('PB18', 'INPUT', { params: { exti: { enabled: true, edge: 'RISING' } } })] }))
    expect(w.some((x) => x.message.includes('请关闭引脚上的 EXTI 开关'))).toBe(true)
  })
})

describe('UART（D5）', () => {
  it('remap0：Uart::new::<false>(peri, tx, rx, config).unwrap() 逐字', () => {
    const c = contentOf(gen(baseConfig({ pins: uart0(0) })), 'src/generated/usart.rs')
    expect(c).toContain("pub type Uart0 = hal::uart::Uart<'static, hal::peripherals::UART0>;")
    expect(c).toContain('peri: hal::peripherals::UART0,')
    expect(c).toContain('tx: hal::peripherals::PB7,')
    expect(c).toContain('rx: hal::peripherals::PB4,')
    expect(c).toContain('baudrate: 115200,')
    expect(c).toContain('data_bits: hal::uart::DataBits::DataBits8,')
    expect(c).toContain('stop_bits: hal::uart::StopBits::STOP1,')
    expect(c).toContain('parity: hal::uart::Parity::ParityNone,')
    expect(c).toContain('hal::uart::Uart::new::<false>(peri, tx, rx, config).unwrap()')
  })

  it('remap1：REMAP const 为 true', () => {
    const c = contentOf(gen(baseConfig({ pins: uart0(1) })), 'src/generated/usart.rs')
    expect(c).toContain('hal::uart::Uart::new::<true>(peri, tx, rx, config).unwrap()')
    expect(c).toContain('TX=PA14 RX=PA15')
  })

  it('参数覆盖来自 config.peripherals（baudrate/dataBits/stopBits/parity）', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: uart0(),
          peripherals: { UART0: { enabled: true, params: { baudrate: 921600, dataBits: 'DataBits7', stopBits: 'STOP2', parity: 'ParityEven' } } },
        }),
      ),
      'src/generated/usart.rs',
    )
    expect(c).toContain('baudrate: 921600,')
    expect(c).toContain('hal::uart::DataBits::DataBits7')
    expect(c).toContain('hal::uart::StopBits::STOP2')
    expect(c).toContain('hal::uart::Parity::ParityEven')
    expect(c).toContain('921600 7E2')
  })

  it('缺 TX → USART_TX_MISSING error', () => {
    const r = gen(baseConfig({ pins: [af('PB4', 'UART0_RX')] }))
    expect(r.errors.some((e) => e.code === 'USART_TX_MISSING' && e.level === 'error')).toBe(true)
  })

  it('缺 RX → USART_RX_MISSING error', () => {
    const r = gen(baseConfig({ pins: [af('PB7', 'UART0_TX')] }))
    expect(r.errors.some((e) => e.code === 'USART_RX_MISSING' && e.level === 'error')).toBe(true)
  })

  it('mod.rs 聚合字段 uart0 与 init 调用实参顺序', () => {
    const c = contentOf(gen(baseConfig({ pins: uart0() })), 'src/generated/mod.rs')
    expect(c).toContain('pub uart0: usart::Uart0,')
    expect(c).toContain('uart0: usart::init_uart0(p.UART0, p.PB7, p.PB4),')
  })
})

describe('SPI（D6）', () => {
  it('全双工：Spi::new::<false> + non_exhaustive Config 逐字', () => {
    const c = contentOf(gen(baseConfig({ pins: spiFull(0) })), 'src/generated/spi.rs')
    expect(c).toContain("pub type Spi0 = hal::spi::Spi<'static, hal::peripherals::SPI0>;")
    expect(c).toContain('config.clock_polarity = hal::spi::Polarity::IdleLow;')
    expect(c).toContain('config.bit_order = hal::spi::BitOrder::MsbFirst;')
    expect(c).toContain('config.frequency = 1_000_000.Hz();')
    expect(c).toContain('let mut config = hal::spi::Config::default();')
    expect(c).toContain('hal::spi::Spi::new::<false>(peri, sck, mosi, miso, config)')
    expect(c).toContain('use hal::prelude::*;')
  })

  it('remap1 + 参数覆盖：IdleHigh/LsbFirst/4MHz（PB14/PB15 为 SWD 脚，需解锁）', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: spiFull(1),
          unlockedPins: ['PB14', 'PB15'],
          peripherals: { SPI0: { enabled: true, params: { clockPolarity: 'IdleHigh', bitOrder: 'LsbFirst', frequency: 4000000 } } },
        }),
      ),
      'src/generated/spi.rs',
    )
    expect(c).toContain('hal::spi::Spi::new::<true>(peri, sck, mosi, miso, config)')
    expect(c).toContain('hal::spi::Polarity::IdleHigh')
    expect(c).toContain('hal::spi::BitOrder::LsbFirst')
    expect(c).toContain('config.frequency = 4_000_000.Hz();')
  })

  it('缺 MISO → new_txonly(sck, mosi)', () => {
    const c = contentOf(gen(baseConfig({ pins: [af('PA13', 'SPI0_SCK'), af('PA14', 'SPI0_MOSI')] })), 'src/generated/spi.rs')
    expect(c).toContain('hal::spi::Spi::new_txonly::<false>(peri, sck, mosi, config)')
    expect(c).not.toContain('miso:')
  })

  it('缺 MOSI → new_rxonly(sck, miso)', () => {
    const c = contentOf(gen(baseConfig({ pins: [af('PA13', 'SPI0_SCK'), af('PA15', 'SPI0_MISO')] })), 'src/generated/spi.rs')
    expect(c).toContain('hal::spi::Spi::new_rxonly::<false>(peri, sck, miso, config)')
    expect(c).not.toContain('mosi:')
  })

  it('缺 SCK → REMAP_UNDEFINED error', () => {
    const r = gen(baseConfig({ pins: [af('PA14', 'SPI0_MOSI'), af('PA15', 'SPI0_MISO')] }))
    expect(r.errors.some((e) => e.code === 'REMAP_UNDEFINED' && /SCK/.test(e.message))).toBe(true)
  })

  it('MOSI/MISO 都缺 → REMAP_UNDEFINED error', () => {
    const r = gen(baseConfig({ pins: [af('PA13', 'SPI0_SCK')] }))
    expect(r.errors.some((e) => e.code === 'REMAP_UNDEFINED' && /MOSI\/MISO/.test(e.message))).toBe(true)
  })

  it('NSS 分配 → 独立 Output 软件片选（初值 High，HAL 不管理）', () => {
    const r = gen(baseConfig({ pins: [...spiFull(0), af('PA12', 'SPI0_NSS')] }))
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/spi.rs')
    expect(c).toContain("pub type Spi0Nss = hal::gpio::Output<'static, hal::peripherals::PA12>;")
    expect(c).toContain('hal::gpio::Output::new(nss, hal::gpio::Level::High, hal::gpio::OutputDrive::_5mA)')
    expect(c).toContain('hal::gpio::OutputDrive::_5mA')
    expect(c).toContain('软件片选')
    const mod_ = contentOf(r, 'src/generated/mod.rs')
    expect(mod_).toContain('pub spi0_nss: spi::Spi0Nss,')
    expect(mod_).toContain('spi0_nss: spi::init_spi0_nss(p.PA12),')
  })
})

describe('I2C（D7）', () => {
  it('remap0：I2c::new::<false>(peri, scl, sda, config) + 频率/占空比', () => {
    const c = contentOf(gen(baseConfig({ pins: [af('PB13', 'I2C_SCL'), af('PB12', 'I2C_SDA')] })), 'src/generated/i2c.rs')
    expect(c).toContain("pub type I2c = hal::i2c::I2c<'static, hal::peripherals::I2C>;")
    expect(c).toContain('config.frequency = 100_000.Hz();')
    expect(c).toContain('config.duty = hal::i2c::Duty::Duty2_1;')
    expect(c).toContain('let mut config = hal::i2c::Config::default();')
    expect(c).toContain('hal::i2c::I2c::new::<false>(peri, scl, sda, config)')
    expect(c).toContain('7-bit')
  })

  it('remap1 + Duty16_9/400kHz 覆盖', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: [af('PB21', 'I2C_SCL', 1), af('PB20', 'I2C_SDA', 1)],
          peripherals: { I2C: { enabled: true, params: { frequency: 400000, duty: 'Duty16_9' } } },
        }),
      ),
      'src/generated/i2c.rs',
    )
    expect(c).toContain('hal::i2c::I2c::new::<true>(peri, scl, sda, config)')
    expect(c).toContain('config.frequency = 400_000.Hz();')
    expect(c).toContain('hal::i2c::Duty::Duty16_9')
  })

  it('缺 SDA → REMAP_UNDEFINED error', () => {
    const r = gen(baseConfig({ pins: [af('PB13', 'I2C_SCL')] }))
    expect(r.errors.some((e) => e.code === 'REMAP_UNDEFINED' && /SDA/.test(e.message))).toBe(true)
  })
})

describe('ADC（D8）', () => {
  it('Adc::new + non_exhaustive Config + 裸通道引脚字段', () => {
    const r = gen(
      baseConfig({
        pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' }), pin('PA5', 'ANALOG', { function: 'ADC_IN1' })],
      }),
    )
    expect(r.errors).toEqual([])
    const c = contentOf(r, 'src/generated/adc.rs')
    expect(c).toContain("pub type Adc = hal::adc::Adc<'static, hal::peripherals::ADC>;")
    expect(c).toContain('config.clk = hal::adc::SamplingClock::_3_2MHz;')
    expect(c).toContain('config.pga_gain = hal::adc::Gain::GAIN1_2;')
    expect(c).toContain('let mut config = hal::adc::Config::default();')
    expect(c).toContain('hal::adc::Adc::new(peri, config)')
    expect(c).toContain('let v = g.adc.read(&mut g.adc_in0);')
    const mod_ = contentOf(r, 'src/generated/mod.rs')
    expect(mod_).toContain('pub adc: adc::Adc,')
    expect(mod_).toContain('pub adc_in0: hal::peripherals::PA4,')
    expect(mod_).toContain('pub adc_in1: hal::peripherals::PA5,')
    expect(mod_).toContain('adc_in0: p.PA4,')
  })

  it('采样时钟/PGA 增益来自参数', () => {
    const c = contentOf(
      gen(
        baseConfig({
          pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' })],
          peripherals: { ADC: { enabled: true, params: { samplingClock: '_8MHz', pgaGain: 'GAIN2' } } },
        }),
      ),
      'src/generated/adc.rs',
    )
    expect(c).toContain('config.clk = hal::adc::SamplingClock::_8MHz;')
    expect(c).toContain('config.pga_gain = hal::adc::Gain::GAIN2;')
  })
})

describe('selection 开关与文件组', () => {
  it('selection.clock=false：不生成 clock.rs，main 用 Config::default()', () => {
    const r = gen(baseConfig(), { clock: false })
    expect(r.files.some((f) => f.path === 'src/generated/clock.rs')).toBe(false)
    const main = contentOf(r, 'src/main.rs')
    expect(main).toContain('hal::init(hal::Config::default())')
    expect(contentOf(r, 'src/generated/mod.rs')).not.toContain('pub mod clock;')
  })

  it('selection.pins=false：不生成 pins.rs / pins 字段', () => {
    const r = gen(baseConfig(), { pins: false })
    expect(r.files.some((f) => f.path === 'src/generated/pins.rs')).toBe(false)
    expect(contentOf(r, 'src/generated/mod.rs')).not.toContain('pub pins:')
  })

  it('selection.usart=false：有 UART 配置也不生成 usart.rs', () => {
    const r = gen(baseConfig({ pins: uart0() }), { usart: false })
    expect(r.files.some((f) => f.path === 'src/generated/usart.rs')).toBe(false)
    expect(contentOf(r, 'src/generated/mod.rs')).not.toContain('pub uart0:')
  })

  it('selection.readme=false：不生成 README.md', () => {
    expect(gen(baseConfig(), { readme: false }).files.some((f) => f.path === 'README.md')).toBe(false)
  })

  it('selection.htmlReport=true：report.html（generated 组）且后端名/rev 替换为 ch58x', () => {
    const r = gen(baseConfig(), { htmlReport: true })
    const report = r.files.find((f) => f.path === 'report.html')
    expect(report?.group).toBe('generated')
    expect(report!.content).toContain('vendor/ch58x-hal')
    expect(report!.content).not.toContain('vendor/ch32-hal')
    expect(report!.content).toContain(CH58X_HAL_REV.slice(0, 7))
  })

  it('htmlReport：config.hal.rev 为 ch32 rev 时替换为 ch58x rev（不泄露 ch32 链接）', () => {
    const r = gen(baseConfig({ hal: { rev: HAL_REV } }), { htmlReport: true })
    const html = r.files.find((f) => f.path === 'report.html')!.content
    expect(html).toContain(CH58X_HAL_REV.slice(0, 7))
    expect(html).not.toContain(HAL_REV.slice(0, 7))
    expect(html).not.toContain('ch32-rs/ch32-hal')
  })

  it('fileGroup：main=user_code、generated=generated、Cargo/README=project_file', () => {
    const r = gen(baseConfig({ pins: [pin('PB18', 'OUTPUT')] }))
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f.group]))
    expect(byPath['src/main.rs']).toBe('user_code')
    expect(byPath['src/generated/mod.rs']).toBe('generated')
    expect(byPath['src/generated/pins.rs']).toBe('generated')
    expect(byPath['Cargo.toml']).toBe('project_file')
    expect(byPath['README.md']).toBe('project_file')
  })

  it('cube.json 回读与原 config 一致', () => {
    const cfg = baseConfig({ pins: [pin('PB18', 'OUTPUT', { label: 'LED' })] })
    const r = gen(cfg)
    expect(JSON.parse(contentOf(r, 'cube.json'))).toEqual(cfg)
  })

  it('ideConfig=vscode：M12 三件套 + 五项任务（MRS OpenOCD 调试链）', () => {
    const r = gen(baseConfig({ projectName: 'My Ch582' }), { ideConfig: 'vscode' })
    const paths = r.files.map((f) => f.path)
    expect(paths).toContain('.vscode/settings.json')
    expect(paths).toContain('.vscode/tasks.json')
    expect(paths).toContain('.vscode/launch.json')
    const tasks = JSON.parse(contentOf(r, '.vscode/tasks.json'))
    expect(tasks.version).toBe('2.0.0')
    expect(tasks.tasks.map((t: { label: string }) => t.label)).toEqual([
      '构建',
      '构建 (release-debug)',
      'gdbserver (MRS OpenOCD)',
      '烧录 (MRS OpenOCD)',
      '烧录 (wchisp)',
    ])
    expect(tasks.tasks[0].command).toBe('cargo')
    expect(tasks.tasks[0].args).toEqual(['build', '--release'])
    expect(tasks.tasks[4].command).toBe('wchisp')
    expect(tasks.tasks[4].args).toEqual(['flash', 'target/riscv32imc-unknown-none-elf/release/my-ch582'])
    const launch = JSON.parse(contentOf(r, '.vscode/launch.json'))
    expect(launch.configurations[0].request).toBe('attach')
    expect(launch.configurations[0].miDebuggerServerAddress).toBe('localhost:3333')
    expect(contentOf(r, '.vscode/settings.json')).toContain('rust-analyzer.cargo.target')
  })

  it('projectSkeleton=false：无骨架文件，生成区仍在', () => {
    const r = gen(baseConfig(), { projectSkeleton: false, ideConfig: 'none' })
    const paths = r.files.map((f) => f.path)
    expect(paths).not.toContain('Cargo.toml')
    expect(paths).not.toContain('.cargo/config.toml')
    expect(paths).toContain('src/generated/mod.rs')
  })

  it('projectSkeleton=false + ideConfig=vscode：仍生成 .vscode（与骨架解耦）', () => {
    const r = gen(baseConfig(), { projectSkeleton: false, ideConfig: 'vscode' })
    expect(r.files.map((f) => f.path)).toContain('.vscode/tasks.json')
  })
})

describe('README 诚实标注（§6）', () => {
  const readme = () => contentOf(gen(baseConfig({ features: { embassy: false, debugPrint: false } })), 'README.md')

  it('含上游 DO NOT USE in production 原话', () => {
    expect(readme()).toContain('DO NOT USE in production')
  })

  it('非 BLE 工程 README：BLE 未生成 + wchisp 备用 + MRS 调试链（M12 起含 launch.json）', () => {
    const c = readme()
    expect(c).toContain('不生成 BLE 代码')
    expect(c).toContain('LIBCH58xBLE')
    expect(c).toContain('wchisp flash target/riscv32imc-unknown-none-elf/release/ch582-demo')
    expect(c).toContain('MRS')
    expect(c).toContain('launch.json')
    expect(c).toContain('cppdbg attach localhost:3333')
    expect(c).toContain('两线调试')
  })

  it('声明 HAL 能力边界（async 外设/DMA/Timer/SPI1/开漏/Speed/AF/PB17/Vbat/transaction）', () => {
    const c = readme()
    for (const text of ['async UART/SPI/I2C/ADC', 'DMA', '定时器 / PWM', 'SPI1', 'OpenDrain', 'Speed', '通用 AF API', 'PB17', 'Vbat', 'transaction']) {
      expect(c).toContain(text)
    }
  })

  it('embassy 档说明异步能力仅 GPIO + Timer，外设仍阻塞', () => {
    const c = contentOf(gen(baseConfig({ features: { embassy: true, debugPrint: false } })), 'README.md')
    expect(c).toContain('GPIO 异步等待')
    expect(c).toContain('embassy_time::Timer')
    expect(c).toContain('仍是纯阻塞 API')
  })
})

describe('确定性与模块聚合', () => {
  it('同一输入两次生成逐字节一致', () => {
    const cfg = baseConfig({ pins: [...uart0(), ...spiFull(), pin('PB18', 'OUTPUT', { label: 'LED' })] })
    expect(fileMap(gen(cfg))).toEqual(fileMap(gen(cfg)))
  })

  it('多模块 mod.rs 声明顺序：clock → pins → usart → spi', () => {
    const c = contentOf(gen(baseConfig({ pins: [...uart0(), ...spiFull()] })), 'src/generated/mod.rs')
    const idx = (m: string) => c.indexOf(`pub mod ${m};`)
    expect(idx('clock')).toBeGreaterThanOrEqual(0)
    expect(idx('pins')).toBeGreaterThan(idx('clock'))
    expect(idx('usart')).toBeGreaterThan(idx('pins'))
    expect(idx('spi')).toBeGreaterThan(idx('usart'))
    expect(c).not.toContain('pub mod exti;')
    expect(c).not.toContain('pub mod irq;')
  })

  it('generateCh58xProject 可直接调用（不走 generateProject）', () => {
    const r = generateCh58xProject(baseConfig(), data, DEFAULT_SELECTION)
    expect(r.errors).toEqual([])
    expect(r.files.length).toBeGreaterThan(0)
  })
})
