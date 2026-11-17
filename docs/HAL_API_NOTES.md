# ch32-hal API 核对笔记

> 本文档记录**已逐行核对源码**的 ch32-hal API 签名与事实。写任何生成器前必读。
> 所有签名均对照本机克隆 `reference/ch32-hal`，锁定 commit 见下。
> 最后更新：2026-11-15。

## 0. 锁定的真相源版本

| 仓库 | commit rev | 用途 |
|---|---|---|
| `ch32-rs/ch32-hal` | `a0863ebcc1082f64e508b73d3b944f119b0db77b` | 生成目标 HAL |
| `ch32-rs/ch32-metapac` | `c4dc52639ec248be4c889ee5f3b9f9387f03ec30` | HAL 内部依赖（寄存器/元数据） |
| `ch32-rs/ch32-data` | （sparse clone，HEAD） | 芯片/中断/DMA/引脚信号数据 |
| `ch32-rs/ch32-hal-template` | （HEAD） | 工程骨架唯一真相源 |

生成器 `Cargo.toml` 必须 `git` 依赖并锁 `rev = a0863ebcc1082f64e508b73d3b944f119b0db77b`。

## 1. Cargo feature 名（关键纠正）

**提示词 §2.2 说 feature 名是"小写芯片家族名"——这是错的。** 实测 `ch32-hal/Cargo.toml`
的 chip-selection features 是**完整小写芯片型号**，不是家族名：

- CH32V003F4P6 → feature `ch32v003f4p6`（不是 `ch32v003`）
- CH32V203C8T6 → feature `ch32v203c8t6`
- CH32V103C8T6 → feature `ch32v103c8t6`

每个 feature 展开为 `ch32-metapac/<chip>` + `qingke-rt/<core>` + `qingke/<core>`。
`build.rs` 依据选中的 feature 推导 `chip_family` cfg（`ch32v0`/`ch32v1`/`ch32v2`/`ch32v3`/`ch32x0`…）。

其它相关 feature：
- `rt`（入口/中断，`= dep:qingke-rt + rt-wfi`）
- `exti`（内置 EXTI 驱动与中断处理）
- `embassy`（异步）
- `memory-x`（`= ch32-metapac/memory-x`，自动提供 memory.x）
- `time-driver-tim2` 等（embassy 时基）
- 默认 `default = ["embassy", "rt", "exti"]`

> **决策**：非 embassy 工程用 `default-features = false, features = ["<chip>", "rt", "exti", "memory-x"]`，
> 与模板一致。`memory-x` 让 metapac 自动渲染 memory.x，**生成器不必手写 memory.x**（见 §8）。

## 2. 入口与初始化（`src/lib.rs`）

```rust
pub struct Config {
    pub rcc: rcc::Config,
    pub dma_interrupt_priority: interrupt::Priority,
    #[cfg(afio)] pub release_swd_pins: bool,   // 默认 false
}
pub fn init(config: Config) -> Peripherals;   // 只能调用一次
```

入口形态（`examples/ch32v003/src/bin/blinky.rs` 实测）：

```rust
#![no_std]
#![no_main]
use hal::gpio::{Level, Output};
use {ch32_hal as hal, panic_halt as _};

#[qingke_rt::entry]
fn main() -> ! {
    hal::debug::SDIPrint::enable();
    let mut config = hal::Config::default();
    config.rcc = hal::rcc::Config::SYSCLK_FREQ_48MHZ_HSE;
    let p = hal::init(config);
    let mut led = Output::new(p.PD6, Level::Low, Default::default());
    loop { led.toggle(); }
}
```

`Peripherals` 字段即引脚/外设单例：`p.PD6`、`p.USART1`、`p.ADC1`、`p.EXTI1` 等。
`hal::debug::SDIPrint::enable()` 开启单线调试打印；`hal::println!` 输出。

## 3. GPIO（`src/gpio.rs`）

```rust
pub enum Speed { Medium = 0b01 /*10MHz*/, Low = 0b10 /*2MHz*/, High = 0b11 /*50MHz, default*/ }
pub enum Pull { None, Up, Down }
pub enum Level { Low, High }

Output::new(pin: Peri<'d, impl Pin>, initial_output: Level, speed: Speed) -> Output<'d>
OutputOpenDrain::new(pin, initial_output: Level, speed: Speed) -> OutputOpenDrain<'d>
Input::new(pin: Peri<'d, impl Pin>, pull: Pull) -> Input<'d>
Flex::new(pin: Peri<'d, impl Pin>) -> Flex<'d>
```

- `Output`/`OutputOpenDrain` 方法：`set_high/set_low/set_level/toggle/is_set_high/...`
- `Input` 方法：`is_high/is_low/get_level`
- **Speed 只有三档**：`Low/Medium/High`。提示词配置模型里的 `VERY_HIGH` 在 V003 无对应，
  数据层 `speed` 选项只给 `LOW/MEDIUM/HIGH`，映射到 `Speed::Low/Medium/High`。
- `Default::default()` 作 speed 即 `Speed::High`。

## 4. EXTI（`src/exti.rs`）

```rust
ExtiInput::new<T: GpioPin>(pin: Peri<'d, T>, ch: Peri<'d, T::ExtiChannel>, pull: Pull) -> ExtiInput<'d>
```

- **边沿不在构造函数**。边沿通过异步等待方法在运行时设置：
  `wait_for_high / wait_for_low / wait_for_rising_edge / wait_for_falling_edge / wait_for_any_edge`（均 `async`）。
- 这些是 `async fn`，**只在 embassy 上下文可 `.await`**。非 embassy 工程生成 `ExtiInput::new`
  后，边沿信息以注释记录（`// 边沿: RISING`），不生成无法编译的 `.await`。
- V003（`gpio_v0`）只有 **8 条 EXTI 线（EXTI0..EXTI7）**，单一中断向量 `EXTI7_0`。
  `impl_exti!` 只定义 EXTI0..7；EXTI8..15 在 `ch32v0/ch32m0` 被 cfg 掉。
- 通道外设名 `p.EXTI0`..`p.EXTI7`，`T::ExtiChannel` 由引脚类型关联。
- 需要 `exti` feature（默认开启）。

## 5. RCC / 时钟（`src/rcc/mod.rs` + `src/rcc/v003.rs`）

```rust
pub struct Config {
    pub hse: Option<Hse>,        // Hse { freq: Hertz, mode: HseMode }
    pub sys: Sysclk,             // = pac::rcc::vals::Sw
    pub pll_src: PllSource,      // = pac::rcc::vals::Pllsrc
    pub ahb_pre: AHBPrescaler,   // = pac::rcc::vals::Hpre
    pub apb2_pre: APBPrescaler,  // = pac::rcc::vals::Ppre
}
pub enum HseMode { Oscillator, Bypass }
```

V003 预设常量（`v003.rs` 实测）：

| 常量 | sys | pll_src | hse | 实际 SYSCLK |
|---|---|---|---|---|
| `SYSCLK_FREQ_48MHZ_HSI` | PLL | HSI | None | 24×2 = 48MHz |
| `SYSCLK_FREQ_48MHZ_HSE` | PLL | HSE | 24MHz | 24×2 = 48MHz |
| `SYSCLK_FREQ_24MHZ_HSE` | HSE | HSE | 24MHz | 24MHz |

**关键事实（纠正提示词示例）**：
- V003 **PLL 倍频固定 ×2**（`v003.rs` 注释 "MUL2 is the only option, always *2"）。
  提示词 clock.json 示例里的 `mul options [2..16]` 对 V003 不成立。数据层 PLL 只给 `mul=2`。
- V003 **HSI = 24MHz**（`HSI_FREQUENCY = Hertz(24_000_000)`），不是 8MHz。
- V003 **没有独立 APB1 分频**：`Config` 只有 `apb2_pre`；`pclk1 = hclk`。
  数据层 `apb1` 固定 `options=[1]`。
- `Sysclk` 枚举变体：`HSI / HSE / PLL`；`Pllsrc`：`HSI / HSE`。
- `Hpre`（AHB）：`DIV1..DIV8, DIV16, DIV32, DIV64, DIV128, DIV256`（还有 DIV2_ALT 等别名）。
- `Ppre`（APB2）：`DIV1, DIV2, DIV4, DIV8, DIV16`。
- `Default for Config`：`sys=HSI, pll_src=HSI, ahb_pre=DIV3, apb2_pre=DIV1`（即默认 8MHz HCLK）。
- `Clocks` 暴露 `sysclk/hclk/pclk1/pclk2/pclk1_tim/pclk2_tim`。

> **生成策略**：命中预设 → 直接 `config.rcc = hal::rcc::Config::SYSCLK_FREQ_48MHZ_HSE;`。
> 否则显式构造 `hal::rcc::Config { hse, sys, pll_src, ahb_pre, apb2_pre }`，枚举用
> `hal::pac::rcc::vals::{Sw, Pllsrc, Hpre, Ppre}` 路径。预设匹配要求 HSE 频率=24MHz（见上表）。

## 6. USART（`src/usart/mod.rs`）

```rust
// 阻塞（同步）全双工：注意参数顺序是 rx 在前、tx 在后
Uart::new_blocking::<const REMAP: u8>(
    peri: Peri<'d, T>,
    rx: Peri<'d, impl RxPin<T, REMAP>>,
    tx: Peri<'d, impl TxPin<T, REMAP>>,
    config: Config,
) -> Result<Uart<'d, T, Blocking>, ConfigError>

// 异步全双工（embassy）：需要中断绑定 + TX/RX DMA
Uart::new::<const REMAP: u8>(peri, rx, tx, _irq, tx_dma, rx_dma, config) -> Result<...>
```

```rust
#[non_exhaustive]
pub struct Config {
    pub baudrate: u32,
    pub data_bits: DataBits,   // DataBits8 / DataBits9
    pub stop_bits: StopBits,   // STOP1 / STOP0P5 / STOP2 / STOP1P5
    pub parity: Parity,        // ParityNone / ParityEven / ParityOdd
    pub detect_previous_overrun: bool,
}
// Default = 115200 8N1
```

- **REMAP 是 const 泛型**，引脚 trait `TxPin<T, REMAP>`/`RxPin<T, REMAP>` 绑定 remap 值。
- 枚举变体名实测：`DataBits::DataBits8`、`StopBits::STOP1`（**不是 STOP_1**）、`Parity::ParityNone`。
  提示词 peripherals.json 示例的 `STOP_1` 写法错误，数据层用 `STOP1/STOP2`。
- `Config` 是 `#[non_exhaustive]`，**不能跨 crate 用结构体字面量**，必须 `Config::default()` 后逐字段赋值。
- 返回 `Result`，生成代码用 `.unwrap()`（或 `expect`）。

## 7. SPI / I2C / ADC

### SPI（`src/spi.rs`）
```rust
Spi::new_blocking::<const REMAP: u8>(peri, sck, mosi, miso, config: Config) -> Spi<'d, T, Blocking>
// 另有 new_blocking_rxonly / new_blocking_txonly / new_blocking_txonly_nosck
#[non_exhaustive]
pub struct Config { pub mode: Mode, pub bit_order: BitOrder, pub frequency: Hertz }
// Default: MODE_0, MsbFirst, 1MHz
```
`Mode` 用常量 `MODE_0..MODE_3`；`BitOrder::{MsbFirst, LsbFirst}`；`frequency: Hertz::hz(n)`。

### I2C（`src/i2c.rs`）
```rust
I2c::new_blocking::<const REMAP: u8>(peri, scl, sda, freq: Hertz, config: Config) -> I2c<'d, T, Blocking, Master>
#[non_exhaustive]
pub struct Config { #[cfg(embassy)] pub timeout: Duration, pub duty: Duty }
// Default: Duty2_1
```
`Duty::{Duty2_1, Duty16_9}`；`freq` 直接传 `Hertz::hz(100_000)` 等。

### ADC（`src/adc.rs`）
```rust
Adc::new(adc: Peri<'d, T>, config: Config) -> Adc<'d, T>
// V003 (adc_v003) 走无 PGA 分支：
adc.configure_channel(&mut impl AdcChannel<T>, rank: u8, sample_time: SampleTime)
let val: u16 = adc.convert(&mut impl AdcChannel<T>, sample_time: SampleTime)
pub struct Config { pub clkdiv: u8, pub channel_count: u8 }  // Default clkdiv=0b11, count=1
```
- **ADC 通道是引脚 trait 实现**：`adc.convert(&mut p.PA1, SampleTime::CYCLES73)`，不是整数索引。
- `SampleTime` 变体（`adc_v003.rs` 实测）：`CYCLES3/9/15/30/43/57/73/241`。
  提示词示例 `CYCLES_7_5` 错误，数据层用真实变体名。
- V003 ADC 是 **10 位**（`ADC_MAX = 1023`）。

## 8. 工程骨架（`ch32-hal-template`，唯一真相源）

模板文件（非 embassy、rv32ec 目标）：
- `Cargo.toml`：edition 2024；`[[bin]] harness=false`；依赖 `ch32-hal`(git, default-features=false,
  features=[chip, rt, memory-x])、`qingke-rt="0.8.4"`、`qingke={version="0.8.4", features=["unsafe-trust-wch-atomics"]}`、
  `embedded-hal="1.0.0"`、`panic-halt="1.0.0"`；`[profile.release]` lto=fat/opt-level=s/codegen-units=1。
- `rust-toolchain.toml`：rv32ec/emc → `channel="nightly"` + `components=["rust-src"]`；
  其它 target → stable + `targets=[target]`。
- `.cargo/config.toml`：rv32ec → `target="riscv32ec-unknown-none-elf.json"` +
  `[unstable] build-std=["core"], json-target-spec=true`；runner=`wlink -v flash --enable-sdi-print --watch-serial`。
- `build.rs`：`println!("cargo:rustc-link-arg-bins=-Tlink.x");`（非 H4 仅此一行）。
- `riscv32ec-unknown-none-elf.json`：tier-3 自定义 target（abi=ilp32e, features=+e,+c,+forced-atomics,+xwchc,
  linker=rust-lld, panic-strategy=abort）。
- **memory.x 由 `memory-x` feature 自动提供**（metapac 渲染），模板本身不含通用 memory.x。
  生成器启用 `memory-x` feature 即可，无需手写 memory.x（与提示词 §6.1 略有出入，以模板为准）。

## 9. V003 引脚信号 / remap / ADC / EXTI / DMA（ch32-data 实测）

> 提示词 §2.3 说"ch32-data 不含引脚↔复用表"——**部分过时**。`data/family/CH32V003.yaml`
> 的每个外设带 `pins: [{pin, signal, remap}]`，是 remap 的权威来源。封装物理引脚编号仍需数据手册。

**ADC1 通道**（`ADC1` pins，signal=INn）：
PA2=IN0, PA1=IN1, PC4=IN2, PD2=IN3, PD3=IN4, PD5=IN5, PD6=IN6, PD4=IN7。
（提示词示例 PD4=ADC_IN4 错误，实际 PD4=IN7。）

**USART1 remap**（TX/RX）：
- remap0: TX=PD5, RX=PD6
- remap1: TX=PD0, RX=PD1
- remap2: TX=PD6, RX=PD5
- remap3: TX=PC0, RX=PC1

**I2C1 remap**（SCL/SDA）：
- remap0: SCL=PC2, SDA=PC1
- remap1: SCL=PD1, SDA=PD0
- remap2(=1X): SCL=PC5, SDA=PC6

**SPI1 remap**（NSS/SCK/MISO/MOSI）：
- remap0: NSS=PC1, SCK=PC5, MISO=PC7, MOSI=PC6
- remap1: NSS=PC0, SCK=PC5, MISO=PC7, MOSI=PC6

**EXTI**：V003 仅 EXTI0..7，IRQ 统一 `EXTI7_0`（interrupt number 20）。

**DMA1 通道**（`data/dma/CH32V003.yaml`）：
ADC1=1, SPI1_RX=2, SPI1_TX=3, USART1_TX=4, USART1_RX=5, I2C1_TX=6, I2C1_RX=7,
TIM2_CH3=1, TIM2_UP=2, TIM2_CH1=5, TIM2_CH2=7, TIM2_CH4=7 等。

**特殊引脚**：PD7=NRST（默认 NRST，选项字节 RST_MODE 控制，作 GPIO 需解锁）；
PA1/PA2=OSC_IN/OSC_OUT（HSE 晶振）；PD1=SWDIO（调试）。

## 10. 与提示词的差异汇总（以源码为准）

| 提示词说法 | 实测纠正 |
|---|---|
| feature 名=家族名 `ch32v003` | 完整型号 `ch32v003f4p6` |
| PLL mul 可选 2..16 | V003 固定 ×2 |
| HSI 8MHz | V003 HSI 24MHz |
| 有 APB1 分频 | V003 无 APB1 分频，pclk1=hclk |
| StopBits `STOP_1` | `STOP1` |
| SampleTime `CYCLES_7_5` | `CYCLES3/9/.../241` |
| PD4=ADC_IN4 | PD4=ADC_IN7 |
| ch32-data 无引脚表 | family YAML 有 pins/remap |
| 需手写 memory.x | `memory-x` feature 自动提供 |
| Speed 有 VERY_HIGH | V003 仅 Low/Medium/High |
## 11. V203 / V3 家族补充核对（2026-11-15 录入时发现）

- **V203 target/feature**：`riscv32imac-unknown-none-elf`（stable，无需 nightly）；HAL feature `ch32v203c8t6`；HAL 走 `rcc/v3.rs`。
- **V203 时钟**：HSI=8MHz；PLL 输入有 prediv（HSI/2、HSE/2，`PllPreDiv`），全部官方预设 prediv=DIV1；AHB 支持 ÷2..÷16、÷64..÷512（**无 ÷32**）；APB1/APB2 上限 144MHz；ADC≤14MHz；timerClock=apb_x2（APB 分频>1 时 ×2）。
- **HAL 上游 bug（已规避）**：`rcc/v3.rs` 的 `SYSCLK_FREQ_96MHZ_HSE` 常量是 HSE 8MHz × MUL6 → 实际 48MHz，不是 96MHz。V203 的 clock.json 未收录该预设（notes 注明），生成器不会产出一致性错误的代码。上游修复后补录。
- **HAL v3.rs AHB 分频实现偏差**：其 `Div` 对 raw≥12（÷64 起）少除一级，与 metapac/WCH 标准库矛盾；clock.json 采信 metapac/标准库（无 ÷32、有 ÷512）。
- **双 ADC 实例共享通道引脚**：V203 的 ADC1/ADC2 通道同名（ADC_IN0 = PA0）。Rust 单例语义下同一 Peri 只能被一个 Adc 结构持有，`derivePeripheralUsage` 按实例顺序单归属（先到先得）。如需双 ADC 同步采样同一引脚，需改为共享引脚 + `&mut` 借用模型（后续扩展）。
- **EXTI**：非 ch32v0 家族 16 线，IRQ 分组 `EXTI0..4 / EXTI9_5 / EXTI15_10`。
- **专用引脚建模**：V203 的 NRST/BOOT0 是专用脚（非 GPIO 复用），chip.json 按 `type: POWER` 建模（不可配置）；V003 的 NRST 是 PD7 复用，语义不同。
- **ADC 异步**：`Adc` 只有阻塞 `convert`（无异步版本）。

## 12. 调试链路核实：wlink 无 gdbserver；ch32rv 作为 GDB 服务器（2026-11-17）

### 12.1 结论（以源码/CLI 为准，不臆造）

- **wlink 0.1.3（crates.io，即 ch32-rs/wlink）没有 `gdbserver` 子命令**。
  `wlink --help` 的子命令只有 `dump / regs / erase / flash / unprotect / protect / write-reg /
  write-mem / halt / resume / reset / status / mode-switch / list / set-power / sdi-print / dev`；
  源码 `src/main.rs` 的 `enum Commands` 同样没有 gdbserver；upstream `main` 分支、issues/PR 也无相关实现。
  → 原计划的「wlink gdbserver」调试链路不存在，不能写入 launch.json。
- 采用 **ch32rv 0.31.3**（crates.io，2026-11-13）的 `ch32rv gdb`：GDB Remote Serial Protocol 服务器
  （gdbstub 0.7.10），默认监听 `127.0.0.1:3333`（`--listen` 可改）。attach **不改写 flash**，
  但**不实现 vFlash/`load`，也没有 monitor 命令**（`docs/cli.ja.md` §4.6：
  「`load`(vFlash)は持たない（書き込みは `flash`）」）。因此烧录必须单独走 `ch32rv flash`。
- wlink 继续作为烧录 runner（生成的 `.cargo/config.toml` 与 tasks.json 未改动其用法）；
  用户参考库 `wchlink-rs` 是烧录器（`info/flash/read/erase/reset`，**无 gdbserver**），
  `PROTOCOL.md` 可作 CH-Link 私有协议参考。

### 12.2 工具与版本

| 工具 | 版本/路径 | 用途 |
|---|---|---|
| riscv-none-elf-gdb | `/home/teze/toolchains/common/riscv-none-elf-gcc-14.2.0-2/bin/riscv-none-elf-gdb`，GNU gdb (xPack) 15.1 | launch.json `miDebuggerPath` |
| wlink | 0.1.3（`cargo install wlink --locked`） | flash runner；**无 gdbserver** |
| ch32rv | 0.31.3（`cargo install ch32rv --locked`） | `ch32rv gdb` GDB 服务器 + `ch32rv flash` |
| WCH-Link | `1a86:8010`，WCH-Link(CH549)，serial `BC493E69FAB2`，firmware 2.12 (v32, raw `020c`)，riscv mode | 实机探针 |

> 本机无 `libudev.pc`（只装了运行时 `libudev.so.1`）；wlink 0.1.3 无条件依赖 libudev-sys，
> 安装时用临时 `libudev.pc` + `PKG_CONFIG_PATH/LIBRARY_PATH` 指向 `/tmp/udev-pc` 绕过（不改系统）。
> ch32rv 走 nusb，不需要该 shim。git 全局代理指向不可达的 `127.0.0.1:7897`，
> cargo/git 使用隔离 HOME（`/tmp/ch32-cubemx-clean-home` + 空 proxy `.gitconfig`）访问 crates.io。

### 12.3 实机只读核实输出摘要（未执行任何 flash/erase/load）

```text
$ lsusb
Bus 003 Device 003: ID 1a86:8010 QinHeng Electronics WCH-Link

$ ch32rv probe list
ADDRESS                 MODE   USB        TOPOLOGY  MODEL            PORTS         FIRMWARE
wchlink://BC493E69FAB2  riscv  1a86:8010  3-2.2     WCH-Link(CH549)  /dev/ttyACM0  2.12 (v32, raw 020c)

$ ch32rv probe info
model:    WCH-Link(CH549)
mode:     riscv
firmware: 2.12 (WCH v32, raw 020c, riscv firmware)

$ ch32rv target info
ch32rv: error[target-no-response]: no target detected on the debug pins
  hint: check target wiring/power/BOOT; ... (exit 20)

$ wlink -v status
[INFO] Connected to WCH-Link v2.12(v32) (WCH-Link-CH549)
Error: WCH-Link underlying protocol error: 0x55 [0x81, 0x55, 0x01, 0x01]  (exit 1)

$ ch32rv gdb --listen 127.0.0.1:3333
ch32rv: error[attach-failed]: probe replied with error (reason 0x55): [81, 55, 01, 01]
```

**核实层级（诚实标注）**：
- 探针层：**通过**——USB 枚举、RISC-V 模式、固件版本、serial 均读到。
- 目标层：本次**未响应**（当时未接目标板），`target info` 与 `wlink status` 均报 `0x55`。
  → 后续接入 CH32V203C8T6 后目标层已补跑通过，见 **§12.7**（本节保留当时原始输出作历史取证）。
- GDB 服务器层：`ch32rv gdb` 的 attach 发生在 `TcpListener::bind` 之前（源码 `cli/src/cmd_gdb.rs`），
  目标无响应时进程在 attach 阶段退出，**本机未观察到监听端口，也未能完成
  `target remote` + halt/读寄存器**。服务器能力依据 ch32rv 0.31.3 的 CLI/源码/文档核实，
  **不宣称已实机连通目标**；接上可响应目标后按 launch.json 即可复测。

### 12.4 生成产物设计（src/model/codegen/ideConfig.ts）

- `launch.json`：`type: cppdbg`、`request: attach`（attach 不触发 load）、
  `name: Debug (ch32rv gdbserver)`、`miDebuggerServerAddress: localhost:3333`、
  `miDebuggerPath: riscv-none-elf-gdb`（假设在 PATH，README 说明可改绝对路径）、
  `runToEntryPoint: main`、`cwd: ${workspaceFolder}`。
- `program`：
  - 单核：`target/<chip.target>/release-debug/<package>`（Cargo 产物无 `.elf` 后缀；
    `release-debug` = `debug=2, strip=false`，GDB 可读符号）；
  - 双核：`target/<主核 target>/release/<package>-<主核 id>`（xtask 只构建 release）。
- `preLaunchTask`：单核 `构建 (release-debug)`；双核 `xtask: 构建`（均与 tasks.json label 一致）。
- tasks.json 追加：`gdbserver (ch32rv)` = `ch32rv gdb --reset-halt`（`isBackground`，常驻专用终端；
  **每次只服务一个 GDB 会话**，断开后需重新运行）；单核追加
  `烧录 (ch32rv)` = `ch32rv flash target/<target>/release-debug/<package>`（接受 ELF/HEX/BIN/UF2）。
- **不写** `postRemoteConnectCommands`：ch32rv 无 `monitor`、无 vFlash，写
  `monitor reset halt` / `load` 会报 unsupported。三步流：构建 → `烧录 (ch32rv)`（写 flash，用户发起）
  → `gdbserver (ch32rv)` → F5。
- `request: attach` 的 cppdbg 会话未在本机实际拉起（无 VSCode 图形会话）；
  attach 语义本身不执行 `load`，且服务器端也不提供 vFlash。
  **GDB Remote 协议层已在 CH32V203C8T6 实机连通**（`target remote` + 读寄存器/内存 + detach，见 §12.7）；
  VSCode cppdbg 图形会话本身仍未拉起过，该字段语义依据协议层核实。

### 12.5 安全注意

- GDB attach 本身不改写 flash；但断点可能改写 RAM、HW trigger 或 flash page（无 trigger 的核），
  flash 断点有磨损且中断会话可能残留 `ebreak`（ch32rv 会尽力还原）。
- `ch32rv flash`、`wlink flash`、GDB `load` 都会写 flash。本次核实**只做** `probe list/info`、
  `target info`、`wlink status` 与 `ch32rv gdb` attach 尝试，未执行任何写操作。

### 12.6 CH582M 接入复测（2026-11-17）：支持矩阵结论

用户接入 CH582M 目标后复测（只读）：

| 工具 | 结果 | 原因 |
|---|---|---|
| `ch32rv probe list/info` | 探针层通过（WCH-Link v2.12, serial BC493E69FAB2） | 探针与目标芯片无关 |
| `ch32rv target info` | `error[target-no-response]` | 自动检测失败 |
| `ch32rv target info --chip CH582M` | `error[target-not-in-db]: --chip CH582M is not in the target DB` | **ch32rv 0.31.3 目标 DB 仅 CH32V 系**（cmd_db.rs：0x06=CH32V307、0x09=CH32V003 等；全源码无 ch58x 条目） |
| `wlink status` | `Protocol error 0x55` | wlink 0.1.3 仅 CH32V 系 |
| `wchlink-rs`（用户参考库） | --type 表仅 5=V20x/6=V30x/9=V003/1=V10x | 同仅 CH32V 系 |
| openocd 0.12.0+dev（系统） | scripts/target 无 wch/ch58x/ch32v _cfg | 上游未合入 WCH RISC-V 目标 |

**结论**：CH582M 属 CH58x（BLE）系，与 CH32V 系调试协议/ID 不同；当前开源链（ch32rv/wlink/wchlink/openocd 0.12）
均不支持，`target-no-response` 是**支持矩阵问题而非接线问题**。CH58x 调试需 WCH MRS/LinkUtility 自带 gdbserver
（未安装）；且本工具 CH582 代码生成仍被 `halBackend=ch58x-hal` 守卫拦截（独立里程碑）。
**目标层核实已补跑**：用户随后接入 CH32V203C8T6，halt/读寄存器/读 Flash/gdb attach 全链路只读通过，见 **§12.7**。
launch.json 模板能力依据不变（§12.4）。

### 12.7 CH32V203C8T6 目标层只读核实（2026-11-17，全链路通过）

用户将 CH-LINK 接到 CH32V203C8T6 目标板后补跑。**全程只读：未执行任何 flash/erase/load/write。**

```text
$ ch32rv target info --chip CH32V203C8T6
target:   connected (identified)
family:   CH32V20x        family byte: 0x05
chip id:  0x20310500      uid: ccaaabcd371ebea7
flash:    64 KiB          sram: 20 KiB (DB)
sku:      CH32V203C8T6 (verified on silicon)
debug:    2-wire (SWDIO/DAT=PA13, SWCLK=PA14)

$ ch32rv dbg halt
halted at 0x0002b714
$ ch32rv dbg regs          # 31 GPR + dpc 全部读到（值随机，见下）
$ ch32rv read --range 0x00000000+64 --format hex-dump
00000000  39 e3 39 e3 39 e3 ...   # 全片重复 0xe339 图案
$ ch32rv dbg resume
resumed

$ ch32rv gdb --chip CH32V203C8T6 --listen 127.0.0.1:3333 --no-flash
gdb: listening on 127.0.0.1:3333
gdb: --no-flash: vFlash (load) is not offered
gdb: client connected from 127.0.0.1:57974
gdb: attached, 0 hardware breakpoint slot(s) (no trigger module; ...)
gdb: client disconnected                     # detach 后进程正常退出 (exit 0)

$ riscv-none-elf-gdb -nx -batch -ex 'target remote 127.0.0.1:3333' \
    -ex 'info registers pc sp' -ex 'x/8xw 0x0' -ex 'detach'
pc  0x14032    sp  0x92a12462
0x0: 0xe339e339 0xe339e339 ...               # 与 ch32rv read 逐字节一致
[Inferior 1 (process 1) detached]
# detach 后 target info 仍 connected (identified)
```

**核实层级（诚实标注）**：
- 探针层：**通过**（同 §12.3）。
- 目标层：**通过**——SKU 硅片级确认（`verified on silicon`）、halt/regs/resume、Flash 读取均成功。
- GDB 服务器层：**通过**——`ch32rv gdb` 监听 3333，`riscv-none-elf-gdb` `target remote` attach、
  读寄存器/内存、detach 干净退出；`--no-flash` 下服务器明确不提供 vFlash。
  这正是 launch.json（cppdbg attach → localhost:3333）的协议层等价验证。
- VSCode cppdbg 图形会话：仍未拉起（本机无 VSCode 图形会话），不宣称已验证 IDE 层。

**现场观察（不臆造）**：
1. 该板 Flash 内容为重复 `0xe339` 图案，**不是有效固件镜像**（首字应指向 SRAM 0x2000xxxx 的初始 SP）；
   GPR 值随机、pc 落在图案区与此一致——核心在执行无效内容。调试链路本身不受影响；
   烧录有效固件后即可正常断点调试（烧录由用户发起，本次未写）。
2. **V203 经 WCH-Link 无硬件断点槽**（gdbserver 明示 `0 hardware breakpoint slot(s), no trigger module`）：
   软件断点会改写 flash page（约 2 s/页，有磨损）。调试时建议 GDB 侧
   `set breakpoint always-inserted on` + `set remotetimeout 10`（gdbserver 输出原话建议）。
   此结论与 §12.5 安全注意一致，launch.json/tasks.json 模板无需改动。

## 13. ch58x-hal 后端核实（M11，2026-11-17）

真相源：`reference/ch58x-hal` @ `611954e40cc4a562f0c4756ab4c0a935af6158df`（ch58x-hal 0.0.2，edition 2021）。
4 份只读调研报告逐字核实，施工契约见 `docs/CH58X_BACKEND_CONTRACT.md`（含集成期修正 D15）。

### 13.1 与 ch32-hal 的关键差异（生成器必须遵守）

| 维度 | ch58x-hal 事实 | 证据 |
|---|---|---|
| entry | HAL **不 re-export** entry；`#[qingke_rt::entry]`，qingke-rt 0.5.0 必须直依赖（highcode feature 恒开，向量表在 RAM 0x20000000） | src/lib.rs:30（`// pub mod rt;`）、Cargo.toml:25 |
| init | `hal::init(Config{clock,low_power,enable_dcdc})` 内部 freeze 时钟 + take 外设 | src/lib.rs:127-167 |
| 时钟 | 480MHz 固定 PLL ÷ div（6 具名档 60/80/48/32/24/20）；`ClockSrc::{PLL(u8),HSE(u8),Clock32K}` pub；无 AHB/APB 分频；HSE 硬编码 32MHz；div 5 位（32 截断为 0） | src/sysctl.rs:8-9,34-49,70-98,168 |
| GPIO | `Output::new(pin,Level,OutputDrive::{_5mA,_20mA})` / `Input::new(pin,Pull)`；**无 Speed/OpenDrain/通用 AF**；**PB17 无 Pin impl**（peripherals 有声明） | src/gpio.rs:165-181,394-408；src/peripherals.rs:39 |
| UART | `Uart::new::<const REMAP: bool>(peri,tx,rx,Config)` → Result；Config 非 non_exhaustive 四字段；**仅阻塞**（async write 被注释）；固定引脚表 UART0-3×2 档 | src/uart.rs:43-58,252-261,499-517 |
| SPI | 仅 SPI0；Config non_exhaustive（polarity/bit_order/frequency，**无 phase**）；无 CS 管理（NSS 需软件 Output）；`blocking_read` 有 FIFO 空跳过 bug | src/spi.rs:31-49,61-90,275-279,355-358 |
| I2C | 单实例 I2C；7-bit 地址（内部左移）；`transaction()` 是 todo!()（调用即 panic） | src/i2c.rs:92-100,234,440 |
| ADC | 14 外部通道 ch0-13；Config{clk:SamplingClock,pga_gain:Gain} non_exhaustive；固定 12-bit；**Vbat 通道不可信**（enable_vbat 空操作且与温度共用 ch15） | src/adc.rs:8-49,123-159,212-214 |
| 不存在 | DMA 驱动（仅 NoDma）、Timer/PWM 驱动（timer.rs 10 行）、async 外设（全仓无 embedded_hal_async impl）、SPI1、bind_interrupts | src/dma.rs:1-5、src/timer.rs:1-10 |
| embassy | feature **不可关**（gpio.rs:14 无条件 use embassy_sync）；时间驱动 SysTick hclk/8（tick 32768）；`hal::embassy::init()` 必须在 hal::init 之后；executor 由应用直依赖 embassy-executor 0.7（nightly + impl_trait_in_assoc_type） | src/gpio.rs:14、src/embassy/mod.rs:3-10、examples/embassy-blinky.rs:54-59 |
| 构建 | -C link-arg=-Tlink.x；memory.x（448K/32K）由 HAL build.rs 提供；device.x 由 ch58x PAC 0.4.0 rt feature 提供；libISP583.a 无条件链接；BLE 库仅 ble feature | build.rs:7-14、.cargo/config.toml |
| non_exhaustive | crate 外**禁止结构体字面量含 FRU**（E0639，rustc 1.98 实测）→ `let mut c = Config::default(); c.field = …;`（官方 examples 模式） | examples/spi-ssd1306.rs:81-84 |

### 13.2 原子指令缺陷与 target 决策（D15，真实编译阻塞）

首次 CH582M cargo build 撞 `qingke 0.5.0` 的 `compile_error!`：`target_has_atomic="8"` 且未开
`unsafe-trust-wch-atomics` 即拒绝编译（src/lib.rs:18-29）。上游核实（api.github.com）：
**ch32-rs/qingke#9**（closed）与 ch32-hal#59——WCH QingKe LR/SC 原子指令有缺陷，embassy executor
进入错误状态（task 标记 woken 但不在 ready 列表），维护者实测**禁用原子走 critical-section 回退后问题消失**；
issue 结论「using portable-atomic is the accepted fix」。qingke#8 即引入该 compile_error 的 PR。

决策（实测排除法）：
- ❌ `unsafe-trust-wch-atomics`：等于信任已知坏原子指令，不采用。
- ❌ `-C target-feature=-a`：rustc 的 `target_has_atomic` 是 target spec 静态属性，**不随该 flag 改变**（--print cfg 实测）。
- ✅ **编译 target 用 riscv32imc-unknown-none-elf**（无 A → 无 target_has_atomic → qingke 通过 →
  embassy-sync 自动 critical-section 回退）。CH582 硬件 RV32IMAC，IMC 代码生成是严格子集，正常执行。
  chip.json.target 一处驱动全链路（模板/工具链/IDE 任务路径全数据驱动）；README 模板含完整说明。
- ch58x-hal 上游 Cargo.toml 未开 trust feature 也未改 target → **上游该 commit 在标准 imac target 上当前不可编译**
  （其 CI 用 nightly imac，qingke 0.5.0 是唯一 0.5.x，crates.io 版本列表核实）；本工具以 imc target 绕过，不修改 HAL 源码。

### 13.2bis 第二个链接阻塞：`__pender`（blocking 档）

imc 解决编译后，blocking 档链接报 `undefined symbol: __pender`（embassy_executor::raw::wake_task 引用）。
根因：HAL 非可选依赖 `embassy-time-queue-utils 0.1.0` 无条件依赖 embassy-executor 0.7，默认 integrated
queue（src/lib.rs:6-13：无 `_generic-queue` feature → queue_integrated → 引用 executor raw 符号）。
`__pender` 由应用提供：embassy 档 `#[embassy_executor::main]` 宏生成；blocking 档无 executor → 缺符号。
修复：blocking Cargo.toml 直依赖 `embassy-time-queue-utils = { version = "0.1.0", features = ["generic-queue-8"] }`
（feature 统一 → queue_generic，不引用 executor 符号）；embassy 档保持 integrated。
上游 HAL 非 embassy examples 亦无 __pender 定义（grep 全仓零命中）——与 13.2 一致，上游该 commit 当前不可直接编译。

### 13.3 工具链事故记录（诚实标注）

生成工程的 `rust-toolchain.toml channel="stable"` 在 rustup 1.29.3 下触发自动更新（stable 1.98.1 → 1.100.0），
期间 imc rust-std 组件冲突致更新回滚不完整、stable 工具链损坏（rustc 组件丢失）；`rustup update stable`
修复至 1.100.0，imc 残留组件目录清除后重装。verify:build 以 `RUSTUP_TOOLCHAIN=<显式工具链名>` 运行避免再次触发渠道解析更新。

**第二根因（verify 脚本缺陷，已修）**：隔离 HOME 方案只钉了 CARGO_HOME 未钉 RUSTUP_HOME——rustup 在
`/tmp/ch32-cubemx-clean-home/.rustup` 新建了工具链家目录，自动更新中断后那里留下**半套 stable**，
脚本内 cargo 随机 crate 编译失败（pin-project-lite/futures-core/embedded-io 等，手动同目录重编却成功）。
修复：verify-build.mjs 隔离 HOME 分支补 `env.RUSTUP_HOME ??= realHome/.rustup`（与 CARGO_HOME 同理），
残缺临时家目录已清除。**最终门禁以 stable 1.100.0 / nightly 1.102.0 为准**（此前 1.98 的通过记录保留作历史）。

### 13.4 生成能力矩阵（CH582M，M11）

可生成：GPIO 输入/输出（驱动电流档）、UART0-3 阻塞、SPI0（MODE_0/3 语义、软件 CS）、I2C 阻塞、
ADC 14 通道单次采样、RTC 只读建议（本期未建模）、时钟 6 预设 + 显式 PLL(div)、embassy 档（GPIO async + Timer）。
不生成（诚实标注于 README）：BLE、async 外设、DMA、TMR/PWM、SPI1、OpenDrain、PB17、Vbat/温度内部通道、
EXTI/中断绑定代码、launch.json/gdbserver（CH58x 不在 ch32rv/wlink 支持矩阵，§12.6；烧录走 wchisp USB ISP）。
debugPrint：warning 忽略（featureWarnings → README/报告）。

### 13.5 验证状态

- 单元：ch58xCodegen 70 + ch58xData 7 + halUnsupportedPin 6 + exportBackend 6 + chipPicker 更新（全仓 1075+）。
- validate:device：4 芯片 0 错 0 警（CH582M 6 预设全可复现）。
- 浏览器验收：CH582M 向导秒建 → 11 引脚（GPIO/UART0/SPI0 含 NSS/I2C/ADC）→ 20MHz 新预设 →
  blocking/embassy 双档页内生成 + ZIP 导出（78 文件含 vendor/ch58x-hal）→ 设置页 rev/target/工具链后端感知。
- verify:build（修复 RUSTUP_HOME 后，显式工具链名，离线）：**V003 ✓ / V203 ✓ / H417 ✓ / CH582M blocking ✓ / CH582M embassy ✓**
  （stable 1.100.0 / nightly 1.102.0；CH582M entry 含 GPIO/UART/SPI/I2C/ADC 全外设）。

## 14. CH58x BLE 协议栈与调试链（M12，2026-11-18）

契约：docs/CH58X_BLE_CONTRACT.md（src/ble/* 2909 行 + 5 示例逐字核实）。生成能力与边界以契约 D1–D12 为准，此处只记关键事实与实机状态。

### 14.1 BLE 关键事实（生成器已编码）

- ble+embassy feature 强耦合；**LSE 强制**（SelRTCClock=0 硬编码，mod.rs:190）→ 时钟生成追加 `.enable_lse()`；PA10/PA11（X32KI/X32KO，板级约定）被占 → error。
- init 顺序：hal::init → hal::embassy::init → ble::init → GAPRole_*_init → GGS_AddService + GATTServApp::add_service → register_service → *StartDevice；TMOS 泵 300µs #[highcode] 独立 task。
- **TmosEvent 单订阅者**（Clone+Drop 双 deallocate → 多订阅 double free）；**imc 无原子** → 模板禁 core::sync::atomic，状态走 embassy-sync Channel。
- 硬编码：ATT_MTU 23 / TX 6dBm / 1+3 连接 / 无 SNV；central 无上游示例不开放；gapbondmgr.rs 死文件（GAPBondMgr_* 走 ffi）。
- 设备名三处同步（GGS + scan-rsp + adv TLV）；名称预算 peripheral 26 / broadcaster 29 字节（扫描响应 31B 上限），短名截断 8 字节。
- BLE temperature_raw steal ADC → BLE_ADC_SHARED warning；RTC 被 BLE 占用不生成 RTC 配置。
- **默认时钟源数据驱动**（M12 集成修复）：ClockData.defaultSource 可选字段；CH582M 指定 PLL（HSE 直连需 div=1 被 HAL assert 拒绝，旧默认 HSE 导致新建工程生成被阻止）。ch32 芯片无该字段行为不变。

### 14.2 调试链：MRS OpenOCD 唯一可行路径（实机只读核实）

- ch32rv 0.31.4 仍无 CH58x（源码 0 命中）；probe-rs CH58x PR #4534 关闭未合并；开源 openocd fork 均无 sdi/wlinke。
- **MRS V3.0.0 Linux 包自带 WCH fork OpenOCD**（0.11.0+dev-snapshot 2026-10-21，v2.10；wlinke 驱动 + sdi transport + wch_riscv target；strings 含 CH58x；WCH-Link-CH549 RV 模式无 CH58x 排除提示）。已部署用户目录 `/home/teze/mrs-openocd/`（无 sudo，可逆）。
- **只读 attach 曾失败**（6000/400 kHz 两档）：`WCH-Link failed to connect with riscv chip`——根因后证实为 **CFG_DEBUG_EN=0**。
- **两线调试开启（2026-11-17 晚，用户于 Windows 侧官方工具操作）**：WCHISPStudio V4.00「开启两线仿真」两次回执「开启调试接口成功!」（19:58:56 / 20:05:39，UID 94-62-A6-5E-3D-0C-77-CD，BTVER 02.40）；未点下载、未写读保护。证据：`/run/media/teze/新加卷/linux/windows-side/`（状态.md + 4 截图）。Linux 侧 ISP 零事件之谜（BOOT 脚 DOWNLOAD_CFG 实际值未知）不再阻塞——调试口路径绕开 ISP/BOOT。
- **只读 attach 复测通过（开启后，CH-LINK 接回 Linux）**：`The debug interface has been opened` + `wlink_init ok` + `Examined RISC-V core; found 1 harts, XLEN=32, misa=0x40901125` + `Target successfully examined`（6000 kHz 一次通过）。
- **gdbserver 路径实机验证**：openocd gdb server 3333 → `riscv-none-elf-gdb target remote` 读 pc=0x0 / sp=0x20007fc0（boot ROM 栈顶，芯片当时在 bootloader）、`x/8xw 0x0` = 重复 0xf3f9bda9（**无有效固件**，首字非 SRAM 初始 SP）、`monitor flash info 0` = 448KB（0x70000，与 CH582M 一致；protection state unknown=驱动未实现该查询）、detach 干净。**launch.json 三步流（gdbserver→attach→读）实机等价验证完成**。全程未写 flash。
- IDE 生成（D9）：launch.json cppdbg attach 3333 + tasks `openocd-wch -f ${env:MRS_OPENOCD_CFG}`（gdbserver/烧录）+ wchisp 备用；README 两条 setup（symlink + export）与两线调试前提诚实标注。
- **代码生成与编译不依赖两线调试开关**：CH582M --ble 真实 cargo build 通过（LIBCH58xBLE.a 链接）。

### 14.3 M12 验证状态

- 1222 测试全绿（+124：ch58xBleCodegen 70 / bleRules 23 / bleProjectFile 15 / ideConfig ch58x 13 / 默认时钟 3）；tsc/eslint/validate/build ✓。
- verify:build：V003/V203/H417/CH582M blocking/embassy/**--ble** 全过（stable 1.100 / nightly 1.102）。
- 浏览器验收：BLE 节（角色/名称字节计数/广播间隔/MAC 三来源/UUID16/observer 参数）+ 运行时互锁（BLE⇒embassy、blocking 禁用）+ 新建工程默认 PLL 直接生成 + ZIP 75 文件 0 冲突。
- **实机目标层核实闭环（2026-11-17 晚）**：Windows 官方工具开启两线调试 → CH-LINK 接回 Linux → MRS OpenOCD examine 通过 → gdb 3333 attach 读寄存器/Flash/flash info → detach。见 §14.2。烧录待用户授权。
- 开发期 HMR _artifact_ 记录：autosave 单例闭包绑定旧 store 实例，HMR 重置 store 后继续写旧工程快照——仅 dev 环境出现（生产 store 不重建），验收以干净 reload 为准；不视为产品缺陷，留观。
