// codegen 快照测试：每个生成文件 toMatchSnapshot()。
// 覆盖：空配置 / GPIO 输出输入 / EXTI / USART remap0 / SPI / I2C / ADC /
//       embassy / 时钟预设命中 / 显式兜底 / vendorHal 开关 / 错误阻止 / halBackend 守卫。
import { describe, expect, it } from 'vitest'
import type { CodegenResult, DeviceData, PinAssignment, PinMode, ProjectConfig } from '../src/types'
import { getDeviceData } from '../src/data/device'
import { generateProject } from '../src/lib/codegen'

const HAL_REV = 'a0863ebcc1082f64e508b73d3b944f119b0db77b'

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'demo-app',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: HAL_REV },
    ...over,
  }
}

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

/** 结果 → { path: content }，整体快照 */
function fileMap(r: CodegenResult): Record<string, string> {
  return Object.fromEntries(r.files.map((f) => [f.path, f.content]))
}

const data: DeviceData = getDeviceData('CH32V003F4P6')

describe('generateProject 基础快照', () => {
  it('空配置：仅骨架 + 空模块', () => {
    const r = generateProject(baseConfig(), data)
    expect(r.errors).toEqual([])
    expect(r.files.map((f) => f.path)).toEqual([
      'Cargo.toml',
      'rust-toolchain.toml',
      '.cargo/config.toml',
      'build.rs',
      '.gitignore',
      'riscv32ec-unknown-none-elf.json',
      'src/generated/clock.rs',
      'src/generated/pins.rs',
      'src/generated/mod.rs',
      'src/main.rs',
      'cube.json',
      'README.md',
    ])
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('GPIO 输出/输入（含前缀与开漏）', () => {
    const r = generateProject(
      baseConfig({
        projectName: 'Gpio Demo',
        naming: { prefix: 'app' },
        features: { embassy: false, debugPrint: true },
        pins: [
          pin('PD6', 'OUTPUT', { label: 'LED_RUN', params: { level: 'LOW', speed: 'MEDIUM', outputType: 'PUSH_PULL' } }),
          pin('PC3', 'OUTPUT', { label: 'BUS_EN', params: { level: 'HIGH', speed: 'VERY_HIGH', outputType: 'OPEN_DRAIN' } }),
          pin('PC4', 'INPUT', { label: 'KEY0', params: { pull: 'UP' } }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('EXTI 输入', () => {
    const r = generateProject(
      baseConfig({
        pins: [
          pin('PC1', 'INPUT', { label: 'BTN', params: { pull: 'DOWN', exti: { enabled: true, edge: 'FALLING' } } }),
          pin('PD3', 'INPUT', { params: { pull: 'UP', exti: { enabled: true, edge: 'RISING' } } }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })
})

describe('generateProject 外设快照', () => {
  it('USART1 remap0（阻塞）', () => {
    const r = generateProject(
      baseConfig({
        peripherals: { USART1: { enabled: true, params: {} } },
        pins: [
          pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('SPI1（阻塞）', () => {
    const r = generateProject(
      baseConfig({
        pins: [
          pin('PC5', 'AF', { function: 'SPI1_SCK', remap: 0 }),
          pin('PC6', 'AF', { function: 'SPI1_MOSI', remap: 0 }),
          pin('PC7', 'AF', { function: 'SPI1_MISO', remap: 0 }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('I2C1（阻塞）', () => {
    const r = generateProject(
      baseConfig({
        pins: [
          pin('PC2', 'AF', { function: 'I2C1_SCL', remap: 0 }),
          pin('PC1', 'AF', { function: 'I2C1_SDA', remap: 0 }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('ADC1（ANALOG 引脚即通道）', () => {
    const r = generateProject(
      baseConfig({
        pins: [
          pin('PA1', 'ANALOG', { function: 'ADC_IN1' }),
          pin('PA2', 'ANALOG', { function: 'ADC_IN0' }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('embassy：USART + I2C（bind_interrupts + DMA 通道）', () => {
    const r = generateProject(
      baseConfig({
        features: { embassy: true, debugPrint: false },
        peripherals: { USART1: { enabled: true, params: {} }, I2C1: { enabled: true, params: {} } },
        pins: [
          pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
          pin('PC2', 'AF', { function: 'I2C1_SCL', remap: 0 }),
          pin('PC1', 'AF', { function: 'I2C1_SDA', remap: 0 }),
        ],
      }),
      data,
    )
    expect(r.errors).toEqual([])
    expect(fileMap(r)).toMatchSnapshot()
  })
})

describe('generateProject 时钟', () => {
  it('命中预设：48MHz HSE', () => {
    const r = generateProject(
      baseConfig({
        clock: { source: 'PLL', pllSource: 'HSE', hxtalMhz: 24, pll: { mul: 2 }, ahb: 1, apb1: 1, apb2: 1 },
      }),
      data,
    )
    expect(r.errors).toEqual([])
    const clock = r.files.find((f) => f.path === 'src/generated/clock.rs')!.content
    expect(clock).toContain('SYSCLK_FREQ_48MHZ_HSE')
    expect(clock).toContain('// SYSCLK=48MHz HCLK=48MHz PCLK1=48MHz PCLK2=48MHz')
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('显式兜底：无匹配预设（AHB 分频 2）', () => {
    const r = generateProject(
      baseConfig({
        clock: { source: 'PLL', pllSource: 'HSE', hxtalMhz: 24, pll: { mul: 2 }, ahb: 2, apb1: 1, apb2: 1 },
      }),
      data,
    )
    expect(r.errors).toEqual([])
    const clock = r.files.find((f) => f.path === 'src/generated/clock.rs')!.content
    expect(clock).toContain('let mut cfg = hal::rcc::Config::default()')
    expect(clock).toContain('cfg.ahb_pre = hal::pac::rcc::vals::Hpre::DIV2')
    // 只有带 APB1 分频的芯片才生成 apb1_pre（V003 无）
    expect(clock).not.toContain('cfg.apb1_pre')
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('未配置时钟：按默认档显式生成', () => {
    const r = generateProject(baseConfig(), data)
    const clock = r.files.find((f) => f.path === 'src/generated/clock.rs')!.content
    expect(clock).toContain('cfg.sys = hal::pac::rcc::vals::Sw::HSI')
    expect(clock).toContain('// SYSCLK=24MHz HCLK=24MHz PCLK1=24MHz PCLK2=24MHz')
  })
})

describe('generateProject 依赖模式', () => {
  it('vendorHal=false：git 依赖锁 rev', () => {
    const r = generateProject(
      baseConfig({ projectName: 'GitDep 项目!' }),
      data,
      { projectSkeleton: true, clock: true, pins: true, exti: true, usart: true, spi: true, i2c: true, adc: true, readme: true, vendorHal: false },
    )
    const cargo = r.files.find((f) => f.path === 'Cargo.toml')!.content
    expect(cargo).toContain(`ch32-hal = { git = "https://github.com/ch32-rs/ch32-hal.git", rev = "${HAL_REV}"`)
    expect(cargo).not.toContain('vendor/ch32-hal')
    // 工程名清洗：'GitDep 项目!' → 'gitdep'
    expect(cargo).toContain('name = "gitdep"')
    expect(fileMap(r)).toMatchSnapshot()
  })

  it('vendorHal=true（默认）：path 依赖', () => {
    const r = generateProject(baseConfig(), data)
    const cargo = r.files.find((f) => f.path === 'Cargo.toml')!.content
    expect(cargo).toContain('ch32-hal = { path = "vendor/ch32-hal", default-features = false, features = ["ch32v003f4p6", "rt", "exti", "memory-x"] }')
    expect(fileMap(r)).toMatchSnapshot()
  })
})

describe('generateProject 错误阻止', () => {
  it('启用 USART 但缺 TX/RX 引脚 → 阻止导出', () => {
    const r = generateProject(
      baseConfig({ peripherals: { USART1: { enabled: true, params: {} } } }),
      data,
    )
    expect(r.files).toEqual([])
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('USART_TX_MISSING')
    expect(codes).toContain('USART_RX_MISSING')
    expect(r.errors.every((e) => e.level === 'error')).toBe(true)
    expect(r.errors).toMatchSnapshot()
  })

  it('启用 SPI 但缺 MISO → 阻止导出', () => {
    const r = generateProject(
      baseConfig({
        peripherals: { SPI1: { enabled: true, params: {} } },
        pins: [
          pin('PC5', 'AF', { function: 'SPI1_SCK', remap: 0 }),
          pin('PC6', 'AF', { function: 'SPI1_MOSI', remap: 0 }),
        ],
      }),
      data,
    )
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.level === 'error' && e.message.includes('MISO'))).toBe(true)
  })

  it('配置期 error 级冲突（引脚重复）→ 阻止导出', () => {
    const r = generateProject(
      baseConfig({
        pins: [pin('PD6', 'OUTPUT'), pin('PD6', 'INPUT')],
      }),
      data,
    )
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'DUPLICATE_PIN' && e.level === 'error')).toBe(true)
  })

  it('warning 级冲突不阻止导出', () => {
    // 标签归一化后重名 → DUPLICATE_LABEL（warning）
    const r = generateProject(
      baseConfig({
        pins: [pin('PD6', 'OUTPUT', { label: 'led-run' }), pin('PD5', 'OUTPUT', { label: 'LED_RUN' })],
      }),
      data,
    )
    expect(r.files.length).toBeGreaterThan(0)
    expect(r.errors).toEqual([])
  })
})

describe('generateProject 双核（CH32H417QEU6）', () => {
  const h417 = getDeviceData('CH32H417QEU6')
  const h417Config = (over: Partial<ProjectConfig> = {}): ProjectConfig =>
    baseConfig({
      chip: 'CH32H417QEU6',
      projectName: 'h417-demo',
      // 400MHz 主 PLL：AHB 合成分频 4（HPRE1×FPRE4）→ V3F 100MHz
      clock: { source: 'PLL', pllSource: 'HSI', pll: { mul: 16 }, ahb: 4, apb1: 1, apb2: 1 },
      peripherals: { USART1: { enabled: true, params: {} } },
      pins: [
        pin('PA9', 'AF', { function: 'USART1_TX', remap: 7 }),
        pin('PA10', 'AF', { function: 'USART1_RX', remap: 7 }),
        pin('PA0', 'ANALOG', { function: 'ADC_IN0' }),
        pin('PB2', 'OUTPUT', { label: 'LED_RUN', params: { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' } }),
      ],
      ...over,
    })

  it('产出 workspace：根清单 + v3f/v5f + xtask，主核完整、从核空骨架', () => {
    const r = generateProject(h417Config(), h417)
    expect(r.errors).toEqual([])
    const m = fileMap(r)

    // workspace 根
    expect(m['Cargo.toml']).toContain('members = ["v3f", "v5f", "xtask"]')
    expect(m['Cargo.toml']).toContain('ch32-hal = { path = "vendor/ch32-hal", default-features = false }')
    expect(m['rust-toolchain.toml']).toContain('channel = "nightly"')
    expect(m['.cargo/config.toml']).toContain('xtask = "run --package xtask --release --"')

    // 两个核各自 target / memory map / main
    expect(m['v3f/Cargo.toml']).toContain('"ch32h417qeu6-v3f"')
    expect(m['v3f/Cargo.toml']).toContain('workspace = true')
    expect(m['v3f/riscv32imafc-unknown-none-elf.json']).toContain('"+m,+a,+f,+c,+xwchc"')
    expect(m['v5f/Cargo.toml']).toContain('"ch32h417qeu6-v5f"')
    expect(m['v5f/riscv32imafbc-unknown-none-elf.json']).toContain('"+m,+a,+f,+c,+b,+xwchc"')
    expect(m['v3f/memory.x']).toContain('ORIGIN = 0x00000000, LENGTH =  64K')
    expect(m['v5f/memory.x']).toContain('ORIGIN = 0x00010000, LENGTH = 960K - 64K')
    expect(m['v3f/link.x']).toContain('.highcode')
    expect(m['v5f/link.x']).toBeUndefined()

    // 主核时钟走 HAL 配方；从核也有 clock 快照但 main 不调用 hal::init
    expect(m['v3f/src/generated/clock.rs']).toContain('hal::rcc::Config::with_sysclk_400m_v5f_400m_v3f_100m_hsi()')
    expect(m['v5f/src/generated/clock.rs']).toContain('with_sysclk_400m_v5f_400m_v3f_100m_hsi()')
    expect(m['v5f/src/main.rs']).not.toContain('hal::init(')
    expect(m['v5f/src/main.rs']).toContain('generated::init()')
    expect(m['v3f/src/main.rs']).toContain('qingke::pfic::wake_other_core(V5F_ENTRY)')

    // H4 每引脚 AF：构造函数不能带 REMAP const 泛型
    expect(m['v3f/src/generated/usart.rs']).toContain('Uart::new_blocking(peri, rx, tx, cfg)')
    expect(m['v3f/src/generated/usart.rs']).not.toContain('new_blocking::<')
    expect(m['v3f/src/generated/usart.rs']).toContain('TX=PA9(AF7) RX=PA10(AF7)')

    // H4 ADC API：Adc::new 返回 Result，示例用 blocking_read
    expect(m['v3f/src/generated/adc.rs']).toContain('hal::adc::Adc::new(adc_peri, Default::default()).unwrap()')
    expect(m['v3f/src/generated/adc.rs']).toContain('.blocking_read(')

    expect(fileMap(r)).toMatchSnapshot()
  })

  it('未配置时钟：默认 HSI 命中 25MHZ_HSI 配方', () => {
    const r = generateProject(h417Config({ clock: undefined }), h417)
    expect(r.errors).toEqual([])
    const clock = r.files.find((f) => f.path === 'v3f/src/generated/clock.rs')!.content
    expect(clock).toContain('hal::rcc::Config::with_hsi()')
    expect(clock).toContain('SYSCLK=25MHz HCLK=25MHz PCLK1=25MHz PCLK2=25MHz')
  })

  it('per_pin_af：TX/RX 可用不同 AF（不要求 PCFR 分组交集）', () => {
    const r = generateProject(
      h417Config({
        peripherals: { USART1: { enabled: true, params: {} } },
        pins: [
          pin('PB6', 'AF', { function: 'USART1_TX', remap: 7 }),
          pin('PB15', 'AF', { function: 'USART1_RX', remap: 4 }),
        ],
      }),
      h417,
    )
    expect(r.errors).toEqual([])
    const usart = r.files.find((f) => f.path === 'v3f/src/generated/usart.rs')!.content
    expect(usart).toContain('Uart::new_blocking(peri, rx, tx, cfg)')
    expect(usart).toContain('TX=PB6(AF7) RX=PB15(AF4)')
  })

  it('preset_only：无匹配预设 → CLOCK_PRESET_UNAVAILABLE 阻止导出', () => {
    const r = generateProject(
      h417Config({ clock: { source: 'PLL', pllSource: 'HSI', pll: { mul: 16 }, ahb: 1, apb1: 1, apb2: 1 } }),
      h417,
    )
    expect(r.files).toEqual([])
    expect(r.errors.some((e) => e.code === 'CLOCK_PRESET_UNAVAILABLE' && e.level === 'error')).toBe(true)
  })

  it('数据驱动：cores 缺失时仍走单核输出（H417 数据去掉 cores）', () => {
    const single: DeviceData = { ...h417, chip: { ...h417.chip, cores: undefined } }
    const r = generateProject(h417Config(), single)
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'src/main.rs')).toBe(true)
    expect(r.files.some((f) => f.path.startsWith('v3f/'))).toBe(false)
  })
})

describe('generateProject 后端守卫', () => {
  it('halBackend 非 ch32-hal → 阻止导出（数据驱动，不按芯片名分支）', () => {
    const ch58Data: DeviceData = {
      ...data,
      chip: { ...data.chip, chip: 'CH582M', halBackend: 'ch58x-hal' },
    }
    const r = generateProject(baseConfig({ chip: 'CH582M' }), ch58Data)
    expect(r.files).toEqual([])
    expect(r.errors).toEqual([
      {
        code: 'TARGET_FEATURE_UNSUPPORTED',
        level: 'error',
        message: '该芯片使用 ch58x-hal 后端，当前代码生成仅支持 ch32-hal',
      },
    ])
  })
})
