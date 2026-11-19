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

### 14.2bis 烧录后实机诊断链（2026-11-17 晚，BLE 射频验证受阻根因）

烧录（program verify reset exit，用户授权）✓ Verified OK。固件启动、embassy executor 运行（pc 符号/调用栈正确，imc critical-section 回退路径实机证实）。但 **BLE 不广播**，只读诊断链（gdb getter/内存读，未写 flash）：

1. `PERIPHERAL_ATTR_TABLE` 句柄全 0 + `GAP_GetParamValue(781/773)` 返回 0xFFFF + `BLE_HEAP` 全 0 → **ble::init/服务注册从未执行**（main _future 卡在更早的 await）。
2. SysTick：CTLR=0x3（=STE|STIE，与驱动 init 期望逐位一致，PAC 0.4.0 位定义核对）、CMP=0x11970（驱动写过的 alarm 值，非初值 MAX-1）、SR.CNTIF=1 且 alarm 不更新 → **SysTick ISR 从未执行**。
3. 向量表/mtvec/PFIC 全正确：mtvec=0x20000003、RAM 向量表 SysTick 槽(0x20000030)=0x20000090=ISR 地址、PFIC enable 在驱动源码中存在 → 排除接线/链接问题。
4. **mstatus=0x0（MIE=0）**：qingke-rt 0.5 启动写 0x1880（MPIE=1/MIE=0），注释称由 handle_reset 末尾 mret 置 MIE——实机未生效（上游启动语义疑点，待上游核实）。
5. gdb 补 MIE（`set $mstatus|$8`，运行时 CSR、复位可逆）后：mstatus=0x1888、SR.CNTIF 被清 → **ISR 开始执行**，中断链修复证实。
6. 但自由运行 10s CNT 仅 +196（7.5MHz 应 +7.5e7）→ **SysTick 在 WFI/空闲期间停计**；embassy executor 空闲即 WFI → 时基瘫痪 → Timer/Ticker 全饿死 → BLE init 不可达。结论：**ch58x-hal embassy SysTick 时间驱动与 CH58x 睡眠门控行为不兼容（上游缺陷）**；ch58x-hal 上游自述 "DO NOT USE in production" 与此一致。

**生成器侧已确定的修复方向（M13 候选）**：①main 入口显式 `csrs mstatus,8`（补 MIE，无论上游语义如何都正确）；②BLE 运行时改 **busy-poll 泵**变体：`#[qingke_rt::entry]` 阻塞 main + `loop { TMOS_SystemProcess(); hal::delay_us(300); }`（CycleDelay 不依赖中断/Timer），事件用 try-poll——绕开坏时间驱动；ble feature 仍需 embassy feature（编译耦合）但不用 executor/Timer。③向上游提 issue（证据包：本节 1–6 + 寄存器快照）。

### 14.2ter M13 实机闭环（2026-11-17 深夜）：Rust 生成 BLE 固件实机广播成功

对照实验链（官方 EVT 预编译 hex 经用户授权烧录对照）：
- 官方 C `Peripheral.hex` 广播可见（`Simple Peripheral`，出厂 MAC 0C:3D:5E:A6:62:94）→ **板级硬件/RF/晶振全好**。
- 官方 C 运行态实测：PFIC IENR0=0、BLEL/BLEB 向量=DefaultHandler、仅 RTC 槽接线（且 PFIC 关→从不触发）→ **C 亦纯 polling 驱动**；32K 源=LSI（CK32K_CONFIG=0x8a，RTC 计数 ≈32.768kHz 准确）→ C 库对无 LSE 板自动回退 LSI。
- 时钟实测：SysTick 增量 ≈61.6M/s（1.02s 自由运行）= 480÷8 → **PLL 锁 480MHz、HSE 32MHz 在振**；总线=60MHz（CLK_SYS_CFG=0x0048）。480 为 VCO 非总线（用户疑问已答：sysctl.rs:9 常量 + 手册 §7 + 寄存器三重证据）。

Rust 侧四个实机根因与修复（全部生成器侧，未改 HAL 源码）：
1. **MIE=0**：qingke-rt 0.5 mret 置位语义实机未生效 → main 入口 `csrs mstatus, 8`（修后 mstatus=0x1888、SysTick ISR 恢复）。
2. **embassy 时间驱动饿死**：SysTick 在 WFI 空闲停计 + 驱动 hclk/8 假设与硅片不符 → BLE 档改 **busy-poll 运行时**（blocking main + `loop{TMOS_SystemProcess(); delay_us(300); try-poll}`，stable 工具链，无 executor/Timer）。
3. **强制 LSE**：enable_lse() 置 XT=1 无回退（板无 LSE 晶振）→ BLE 档不再追加 enable_lse（LSI 缺省，库内部回退，与 C 一致）。
4. **广播 flags 缺 discoverable 位**（最后一片拼图）：仅 BREDR_NOT_SUPPORTED=0x04 的广播被 bluez StartDiscovery 按规范过滤；C 带 discoverable 位可见。修：`GAP_ADTYPE_FLAGS_GENERAL | BREDR_NOT_SUPPORTED`=0x06（持续广播）。
   诊断中另证实：BLEL/BLEB 向量接库 ISR（`LLE_IRQLibHandler/BB_IRQLibHandler`，PAC `__EXTERNAL_INTERRUPTS[20/21]` 弱符号 override）已加入生成代码（PFIC 未使能时不触发，与 C 行为一致，保留作中断模式余地）。

**闭环证据**：M13 固件烧录 Verified OK 后 bluez 扫到 `Device 0C:3D:5E:A6:62:94 CH582M`（出厂 MAC 与 C 同源）；gdb 证实属性表句柄已分配（handle=0x0e）、GAP adv 数据指针/TLV 合法（flags 06 + 厂商 D7 07 + UUID FFE0 + 短名；scan-rsp 完整名 CH582M）、TMOS 泵运行（pc 在 delay_us 循环）。**CH58x BLE 从代码生成到实机射频全链路打通**。

> **M14 更正**：上文第 3 条「库内部回退 LSI」推断有误——C 固件是**显式配置 LSI**（CLK_OSC32K=1 + rcCB 校准），并非库自动回退；ch58x-hal 的 ble::init 反而硬编码 SelRTCClock=0（LSE）。详见 §14.2quater。

### 14.2quater M14 连接路径攻坚（2026-11-18）：广播之上，连接为何失败

**目标**：M13 广播闭环后验证 BLE 连接 + GATT 读写/notify（bluez D-Bus，免手机）。

**实机现象（M13 固件，可复现）**：bluez `Device1.Connect` → `le-connection-abort-by-local`（约 2s）或 `Connection timed out`（约 25s）；失败后**广播停止且不恢复**（wlink reset 后恢复广播）。广播本身始终正常。→ 连接建立路径独立缺陷，非广播问题。

**根因 #5（源码对照级，高置信；实机确认待修复固件烧录）**：
- ch58x-hal `ble::init` 硬编码 `cfg.SelRTCClock = 0`（src/ble/mod.rs:190，注释自述 0=外部 LSE 32768Hz）且 `cfg.rcCB = None`（:196，"use LSE, no calibrate"）。
- `SelRTCClock` 编码（官方 CH58xBLE_LIB.h:143-145）：bit0-1 `00=LSE(32768Hz) / 01=LSI(32000Hz) / 10=LSI(32768Hz)`；bit7=BLE timer 走 HSE（须禁睡眠）。
- 本板**无 LSE 晶振**（M13 已证）。sysctl 级 32K 域虽缺省 LSI（sysctl.rs:123-128 正确上电内部 32K），但**库自身被告知用 LSE** → 连接事件定时基准死源 → 建立失败；广播间隔定时容忍度高故仍工作。
- 官方 C 对照（EVT/EXAM/BLE/HAL/MCU.c:79-145 `CH58X_BLEInit`）：`cfg.SelRTCClock = CLK_OSC32K`（LSI 构建=1）+ `cfg.rcCB = Lib_Calibration_LSI`（:111-119）+ `SysTick_Config(max)` 自由运行供 srandCB + `PFIC_DisableIRQ(SysTick_IRQn)`；LSI 上电/校准另见 HAL/RTC.c:74-85。M13 所见 C 运行态 CK32K_CONFIG=0x8a（XT=0）是**显式 LSI 配置的结果**，非自动回退。
- `Calibration_LSI` 实现于 StdPeriphDriver/CH58x_clk.c:138（寄存器级 OSC_CAL 校准，**非 BLE 库导出符号**，nm 两版 libCH58xBLE.a 均无）；Level_64≈2.2ms/800ppm@32M。

**生成器侧修复（未改 HAL 源码，契约 D20–D22）**：
1. `stack_init()` 替代 `ble::init`：经公开 ffi 自建 `bleConfig_t`——**SelRTCClock 随 `ble.clock32k`（新增选项，缺省 lse=0，lsi 回退=1）**、自有 6KB 堆（与 HAL BLE_HEAP 同尺寸）、自有 embassy-sync PubSub 通道（同参数 4/2/2）+ TMOS 任务（SYS_EVENT_MSG→publish；0x2000 事件→BLE_RegInit+120s 重定时，与 HAL hal_tmos_task 等价）、srandCB=SysTick CNT（stack_init 内配自由运行：CMP=0xFFFFFFFF、CTLR 只 STE 不开中断）、tsCB=hal::ble::temperature_raw（HAL 公开）、**rcCB=None**（校准移植为后续增强）。clock.rs 同步：lse 缺省生成 `config.clock.enable_lse()`（与 SelRTCClock=0 一致）；lsi 不生成。
2. `mac_addr_lsb()` 替代 `config()`：MacAddress 元组字段私有（mod.rs:266）无法从 ble::Config 取字节 → 生成器直接产出 LSB-first 数组（factory=hal::isp::get_mac_address()；custom=MSB 反转；default=[0x66..0x11]）。
3. **busy-poll 连续轮询无 delay**：官方 C Main_Circulation = `while(1){TMOS_SystemProcess();}`（peripheral_main.c:40）；M13 的 delay_us(300) 取自上游 embassy Rust 示例（该示例走 SysTick Timer，在本硅片从未跑通，§14.2bis）。notify 周期最终用 **SysTick CNT**（周期=`clocks().hclk`≈1s，单次 load）；曾试 TMOS_GetSystemClock 时基——它**非纯 getter**（调 pfnTimerCBs 累加 gTmosPara，反汇编核实），每圈含一次 __udivdi3（clockGetTickValve 内），PC 采样实测占主循环 5/6 时间，弃用。连接期间 GAP/GATT 事件静默消费（阻塞 UART println 会饿死 TMOS 泵）。**M14 中午更正：「周期=clocks().hclk」缺 /8（STCLK=HCLK/8），实机 8s 周期裁决后已修为 hclk/8，见 §14.2quinquies。**

**烧录工具链事故（诚实记录）**：`wlink flash <elf>`（无 verify）烧 M14 首版后**广播消失**；wlink dump 读外设/RAM 出现与运行态矛盾的值（CLK_SYS_CFG/pfnTimerCBs 等，halted 与 running 读一致但和固件行为不符——wlink dump 外设读可靠性存疑，本节不以其为证据）。改 **MRS OpenOCD `program <elf> verify reset exit` → Verified OK 后广播立即恢复**。结论：CH58x 烧录一律走 OpenOCD program verify（M13 流程），wlink flash 产物不可信；寄存器证据以 OpenOCD+gdb 为准。另：WCH-Link 当日多次自发 USB 掉线重枚举（内核日志可查），掉线期间 OpenOCD 读全零/attach 失败——取证前先确认探针在线。

**闭环（2026-11-18 上午）**：
- **LSE 全链固件（enable_lse + SelRTCClock=0）实机连接建立成功 ×3**（bluez Device1.Connect → Connected=true；M13 固件从未连上）。根因 #5 坐实：32K 域错配（硬件 LSI vs 库 LSE）。
- **宿主适配器定位**：连上后 GATT 发现极慢（~30s）且链路 ~30s 掉（ATT 超时）；**官方 C Peripheral.hex 对照现象完全相同**；内核日志每次连接时刻报 `Bluetooth: Unexpected continuation frame (len 7)`（L2CAP 孤儿续帧=起始帧丢失）。**用户手机 nRF Connect 对照：C 固件秒级发现 FFE0+FFE1–FFE5、FFE1 读写成功** → 板子 RF/协议栈正常，**卡点在本机 Intel AX210 适配器 LE 数据通路**（WiFi/BT 共存或固件问题；适配器 D-Bus 断电重启无效）。宿主侧 GATT 验证改由手机承担。
- **发货配置**：`ble.clock32k` 缺省 **lse**（官方模组标配晶振，连接已验证）；lsi 回退保留（无晶振板，校准未移植、连接稳定性未保证，UI 有警告文案）。发货版 Rust 固件（LSE + stack_init + 连续轮询 + SysTick notify）已 OpenOCD Verified OK 烧录，广播 CH582M 正常；手机对 Rust 固件的 FFE1/FFE2 读写+notify 验证进行中。
- 生成服务语义（手机验证判据）：读 FFE1=00 → 写 FFE2=42 → 读 FFE1=42 + notify 订阅每秒收 42（write 落 notify_value，read/notify 返回它）。
- **上游 issue 已提交（2026-11-18）**：qingke#42（MIE 启动缺陷，含 0.8.4 v4 路径仍缺 MIE 的疑问）· ch58x-hal#13（SysTick WFI 停计 + hclk/8 速率假设错误）· ch58x-hal#14（ble::init SelRTCClock=0/rcCB=None 硬编码，建议暴露 32K 源 + 校准回调）· ch32-hal#283（v3 96MHZ_HSE 常量实为 48MHz，源码逐字核实）· ch32-hal#284（v1/v3 Div<AHBPrescaler> 对 ÷64..512 移位数错，clocks() 虚高 2×；寄存器写入路径正确）。
- **手机对 Rust 发货固件读写成功（用户实测确认）**：CH582M 连接 → FFE0/FFE1/FFE2 发现 → FFE2 写 → FFE1 读回一致。**Rust 生成固件 BLE 全链路（广播→连接→GATT 发现→读写）实机闭环**。notify 订阅发送路径编译 verified，周期待实测确认（不宣称已验证）。**M14 中午更新：宿主 AX210 修复后 notify 周期实机裁决 + 修复闭环，见 §14.2quinquies。**

### 14.2quinquies M14 宿主蓝牙攻坚闭环（2026-11-18 中午）：AX210 根因 + notify 周期实机裁决

**背景**：§14.2quater 把宿主 GATT 卡顿定位到本机 AX210（手机对照秒级）。本轮用户指令「修复 AX210 固件/共存参数」，宿主侧根因实证闭环，并顺带裁决了 notify 周期。

**宿主取证链（全部实证）**：
1. 初始状态：BT USB（8087:0032，5-1）`power/control=auto` 且 **runtime_status=suspended**（2s 自动挂起）；内核 `Unexpected continuation frame (len 7)` 自开机累计 ×8；固件 `intel/ibt-0041-0041.sfi` 24-29.26（linux-firmware 20261019）。
2. **btmon HCI 抓包裁决**：连接建立（45ms 间隔）→ bluez 发 ATT Exchange MTU Request(517) → DLE 协商 27 字节 → **LE PHY Update Complete → 2M** → **1ms 后**收到的 MTU 响应整包 `03 00 04 00 03 17 00`（L2CAP len=3/CID=4 + ATT opcode 03 MTU=23，恰 7 字节）被标为 **flags 0x01（continuation）**，无 start 帧 → 内核丢包 → ATT 超时 → GATT 发现卡死。**根因：AX210 在 2M PHY 切换后首个 ACL 包 PB 标志损坏**（start 帧丢失/误标）。
3. **排除固件版本回归**：三版对照——2026-10（build 82200，原版）/ 2025-01（build 79483）/ 2024-09（build 73111），btintel 版本比对触发真实重新下载（dmesg "Firmware loaded in 1.2s"）——**三版同症状**。原固件已恢复。
4. **排除 autosuspend 根因**：关闭后（btusb.enable_autosuspend=N + 5-1 control=on）症状仍在；保留为辅助卫生（Intel BT 挂起恢复有 HCI 错乱前科）。
5. **coex 参数核实为 no-op**：`iwlwifi bt_coex_active=0` 仅 **dvm**（老芯片 op_mode）消费；**mvm**（AX210）源码只在 mac80211.c:461 打印警告、coex.c 不读该参数（GitHub 源码逐字核实）。配置中已移除并注释说明。
6. **修复验证**：`btmgmt phy BR1M1SLOT LE1MTX LE1MRX` 强制 LE 1M → **GATT 发现 1.17s、FFE1 读/FFE2 写成功、零内核报错**（多次复现）。2M PHY 即触发损坏。

**宿主持久化（已落地）**：
- `/etc/systemd/system/ax210-phy-1m.service`（enabled + active）：开机 `btmgmt phy BR1M1SLOT LE1MTX LE1MRX`。代价：本机所有 LE 连接走 1M（鼠标等外设正常；LE Audio 等高吞吐场景受限——开发机可接受）。
- `/etc/modprobe.d/ax210-bt.conf`：`options btusb enable_autosuspend=0` + 根因/边界注释。
- 原固件备份：`/var/tmp/ax210-fw-backup/ibt-0041-0041.sfi.xz.orig`。
- 诚实边界：这是 **workaround 而非适配器修复**——2M PHY 损坏机制未解（固件三版同症，疑硅片/驱动深层问题）；修复后 GATT 功能正常但延迟有波动（发现 1.2–4.9s、读 0.45–2.1s，手机对照秒级），疑残留 RF/宿主次级因素，不阻塞开发使用。上游报告（linux-bluetooth/Intel）待用户决定。

**notify 周期实机裁决（生成器 bug #6，已修复 + 实机复验）**：
- 20s 订阅计数：发货固件 notify 间隔 **7.98s / 8.00s**（3 包）——**不是设计的 1s**。
- 根因：stack_init 的 SysTick `STCLK=hclk_div8`（计数率 **HCLK/8**，与 HAL SysTick 驱动 systick.rs:16 一致），而 `notify_period = clocks().hclk` **缺 /8** → 60M tick ÷ 7.5MHz = 8s。**M13「实测硅片 SysTick=HCLK」系误判**（PAC ch58x-0.4.0 核实：STCLK_A HCLK_DIV8=0/HCLK=1，CNT 为 u64 无截断环绕；§14.2ter/§14.2quater 相关表述以本节为准）。
- 修复：`notify_period = clocks().hclk.to_Hz() / 8`（bleRs 模板 + 注释 + README + 测试断言）。
- **实机复验（fw-notify，OpenOCD Verified OK）**：20s 窗口 **20 包，间隔 0.97–1.19s（均值 ≈0.99s）**；FFE1 读=00（新固件初值）→ FFE2 写 42 → notify 全 42（write→notify_value 路径宿主端实证）。**M14 遗留「notify 周期待实测」闭环**。
- 连带澄清：ch58x-hal#13 的「hclk/8 速率假设错误」论点需修正——HAL 的 hclk/8 假设与硅片一致（STCLK=0 时）；该 issue 的 WFI 停计部分仍成立。**更正评论已提交（用户批准，2026-11-18）**：[#13 comment](https://github.com/ch32-rs/ch58x-hal/issues/13#issuecomment-6968946706)——撤回 claim 2（附双周期实测表 + PAC 交叉核实），保留 claim 1（WFI 停计），原 61.6M/s 读数标注不可复现/不可靠；issue 标题含已撤回论点，待编辑（评论中已声明）。

### 14.3 M12 验证状态

- 1222 测试全绿（+124：ch58xBleCodegen 70 / bleRules 23 / bleProjectFile 15 / ideConfig ch58x 13 / 默认时钟 3）；tsc/eslint/validate/build ✓。
- verify:build：V003/V203/H417/CH582M blocking/embassy/**--ble** 全过（stable 1.100 / nightly 1.102）。
- 浏览器验收：BLE 节（角色/名称字节计数/广播间隔/MAC 三来源/UUID16/observer 参数）+ 运行时互锁（BLE⇒embassy、blocking 禁用）+ 新建工程默认 PLL 直接生成 + ZIP 75 文件 0 冲突。
- **实机目标层核实闭环（2026-11-17 晚）**：Windows 官方工具开启两线调试 → CH-LINK 接回 Linux → MRS OpenOCD examine 通过 → gdb 3333 attach 读寄存器/Flash/flash info → detach。见 §14.2。烧录待用户授权。
- 开发期 HMR _artifact_ 记录：autosave 单例闭包绑定旧 store 实例，HMR 重置 store 后继续写旧工程快照——仅 dev 环境出现（生产 store 不重建），验收以干净 reload 为准；不视为产品缺陷，留观。

## 15. M15 外设时钟域：硬件真相 / HAL 公式逐字证据 / 诚实边界（2026-11-18）

> 契约：M15_CLOCK_OVERHAUL_CONTRACT.md（D1–D9）。时钟树页大修（MX2 对齐）+ 每外设实例时钟节点。
> **核心真相：WCH 芯片 I2C/SPI/USART 无独立内核时钟 mux**（固定 PCLK1/PCLK2/HCLK）。ch32-hal `build.rs:351-357` `T::frequency()`=**bus_clock**（非 kernel_clock）；`rcc/v3.rs:99` 的 per-peripheral `mux` 字段被上游注释掉；ch32-data/metapac 的 `Mux` 变体零使用。故外设节点源为固定总线 + 「固定」徽标，**不发明 mux**；真实旋钮=速率参数（写回外设状态，单一真相源）+ ADC 分频链 + USB 显示域。

### 15.1 派生公式（reference HAL 逐字核实，model/clock/peripheral.ts 复刻）

- **ch32 SPI BRG**：`spi.rs:833-853 calculate_baud_rate`——最小 2 的幂 div 使 `clock ≤ frequency*divisor`（即 bus/div ≤ requested）；调用点 `:184/:235` `.unwrap_or(BaudRate::DIV_256)` → requested>bus/2 落 DIV_2、requested<bus/256 落 DIV_256（**HAL 静默回退**，UI 出 warning + 显示实际 SCK）。
- **ch32 USART BRR**：`usart/mod.rs:1093-1106`——`divisor=(clock_hz + baudrate/2)/baudrate`；`divisor<0x10` 或 `>0xffff` → ConfigError（UI error + actual=null）；实际 baud=clock/divisor（4.16 定点近似），误差 >3%（可配 baudErrorWarnPct）warning。
- **ch32 I2C CCR**：`i2c.rs:257-280`——factor=2（standard）/3（fast Duty2_1）/25（Duty16_9）；`divider=div_ceil(input, freq*factor)`，`max(4 standard / 1 fast)`；`timing()` assert freq≤400k（UI 超 maxKhz=error）。
- **ch58x SPI**：`spi.rs:170-172`——`fdiv = sysclk/freq`（整除）`.min(0xff).max(2)`（**线性** div 2..255，静默 clamp）。
- **ch58x UART**：`uart.rs:360-371`——`baud = Fsys*2/DIV/16/DL`；通用路径 DIV=1、`x=10*hclk/8/baud; DL=((x+5)/10)&0xffff`；60MHz/115200 硬编码 (13,5)（UI 显示「DIV 13 DL 5」与 HAL 逐字一致）。
- **ch58x I2C**：`i2c.rs:128-155` 同 2/3/25 系数整除。
- **USBPRE（HAL rcc::init 自动，无 API）**：v1.rs:311-318 `{48→÷1, 72→÷1.5}`；v3.rs:487-497 `{48→÷1, 96→÷2, 144→÷3}`（240→÷5 仅 d8w）；**未命中静默留复位值 → USB 时钟非法且上游无警告**——M15 UI 首次补警告（V103 80MHz 预设实机验收触发：「PLL 80MHz 不在 USBPRE 合法集 [48,72]MHz，USB 时钟非法（HAL 静默留复位值）」）。X035 HSI 48M 直连（fixedMhz）。

### 15.2 ADC 分频链语义状态（诚实边界）

- V003/V103：RCC ADCPRE ÷2/4/6/8 存在但 **HAL 无 API**（`adc.rs:66-69` cfg 排除 adc_v003/adc_v1）→ 仅显示徽标；V003 另有上游 FIXME（v003.rs:20,125 PPRE2/ADCPRE 关系不明）→ 数据层保持 div:1 + note，不改频率宣称。
- V203/V307：ADCPRE（HAL 不写）+ **CTLR3.CLK_DIV raw 4-bit（HAL 写，`Config.clkdiv` 缺省 0b11）**；ADCPRE+CLK_DIV 组合语义未核实 → UI raw 旋钮带「语义待核实」警告、**不编造 MHz**；codegen 仅 programmable 且非缺省发射 `Config { clkdiv: N, ..Default::default() }`（V203 adcClkDiv=5 真实 cargo build 通过）。
- X035：仅 CTLR3.CLK_DIV（SYSCLK 源）；0b11=÷8 系 HAL 注释假设（PAC 仅 4-bit raw）→ 沿用 + note。
- CH582：`SamplingClock` 枚举（CK32M 32MHz 域，独立于 HCLK）；**0b01 HAL 标 8MHz / PAC 标 2.67MHz 未裁决** → enumMhz 用 HAL 标签 + note；旋钮镜像外设参数 samplingClock（已生成）。
- H417：唯一有 `KernelMux` API（rcc/h4/mux.rs：i2s2/3src、usbfsdiv/src、rngsrc、ltdc、uhsif、eth1g、hsadcsrc）但 preset_only + 多数 mux 外设无驱动 → **本期不建模**（clock.json notes 说明）；adcpre 有 API 但 preset_only → 仅显示。

### 15.3 M15 UI 大修与验收（MX2 对齐）

- 树泛化：列式自动布局（10 列：sources/PLL/system/buses/TIM/USART/SPI/I2C/ADC/USB），删 posById 硬编码；走线正交且不穿节点卡（测试断言 6 组芯片布局）；分组框=成员包围盒。
- 节点：固定/派生/raw 徽标、issue marker+hover 全量消息、源选择 radio（≤4 选项）、分频 stepper、外设请求/实际双行（原生单位+误差两位小数）；连线按 issue 着色；点状背景+抓手/Space/方向键；表格 Value 可编辑（stepper/select 同路由）；Reset 确认对话框（可「不再询问」）；右键菜单（高亮源路径/全部路径 BFS、Configure 外设跨视图跳转 peripheralFocus 桥）；Shortcuts 浮层；Detail 元数据驱动。
- 写回路由：periParam → store.setPeripheral（外设参数单一真相源）；adcClkDiv → ClockConfig（全局单值作用于所有启用 ADC 实例；导入脏值钳位；不进求解空间）。
- **验收（2026-11-18，七芯片）**：H417/V203/V003/X035/V307/CH582M/V103 外设节点渲染；V203 SPI1 请求 8MHz@8MHz 总线 → warning+实际 4MHz(÷2)+Resolve(1)；ADC raw5 写回+codegen clkdiv:5（单测+快照+cargo）；CH582 SPI0 ÷60 线性/UART0 DIV13 DL5；V307 USB 144→÷3 auto；V103 80MHz 预设 → USB 非法警告；Reset 对话框确认→clock=null 且外设参数不受影响；路径高亮+Clear；右键 Configure SPI1 → 外设页 SPI1 标签打开。1456 测试/61 文件、vue-tsc/eslint/validate 7 芯片 0/0/build/verify 6/6+6/6+1/1 全绿。
- 诚实边界：外设节点不可锁（MX2 全节点锁的差异）；单位切换不做；USB 无代码生成；adcClkDiv 多实例同值；非预设 PLL 显式导出仍暂缓（M16 候选）。
- **dev 环境教训（M15 验收期）**：① 四子代理并行编辑后长驻 dev server 的 HMR 模块图可能陈旧/幽灵实例（store 数据旧、组件 handler 旧）——**验收前必须干净 reload**；② 浏览器自动化 evaluate 桥对 pinia reactive proxy 做 structured clone 得 `{}`（**读数伪影**）——store 取证用页内 `JSON.stringify` 或原始值字段，勿信对象克隆。

## 16. M16 时钟树逐芯片重画：RM 框图保真 + MX2 分离图元 + 缺失域仅显示（2026-11-18）

> 契约：M16_CLOCK_DIAGRAM_CONTRACT.md（D1–D10 + D4bis/D4ter 裁决）；RM 转录 docs/m16-rm/{v003,v103,x035,v203,v307,h417,ch582}.md（含文档版本/图号/印刷页/PDF 页/SHA-256）。
> 用户裁决：M15 树「太丑、配置项挤在一起」→ 参照 RM 时钟树框图 + CubeMX2 布局逐芯片重画；缺失域一并补（仅显示不生成）。

### 16.1 RM 获取与转录（本机原无 RM）

- 路径：openwch GitHub Pages 镜像 `ch32-riscv-ug.github.io/<chip>/datasheet_zh/*.PDF`（V003/V103/X035）；`file.wch.cn/download/file?id=371`（CH32FV2x_V3xRM V2.5）、`id=532`（CH32H417RM V1.8）、openwch/ch583 raw（CH583DS1 V1.9）。wch.cn/wch-ic.com 下载页为 Vue SPA 空壳不可抓；raw.githubusercontent.com 本机 :443 超时。
- 图页：V003 RM V1.9 图 3-2 p11；CH32xRM V2.0 图 3-2 p13；X035 RM V2.0 图 3-2 p10；FV2x_V3xRM 图 3-2(d8c) p25 / 图 3-3(d8) p26；H417 RM V1.8 图 3-2 p12；CH583DS1 图 6-1 p34（时钟章实为第 6 章）。

### 16.2 RM 裁决纠正（结案/冲突注记，数据层已落）

- **V003 ADCPRE 上游=HCLK**（非 APB2）、÷2..÷128、复位 ÷2 → **结案 ch32-hal v003.rs:20,125 FIXME**；clock.json.adc 改 AHB÷2（adcMhz 24→12，M15 显示偏高 2× 纠正）。**RM 图无 APB2 预分频器** → diagram APB2 kind=readout + note（HAL PPRE2 写入 undocumented，配置能力保留 Detail/表格）。MCO 枚举无 PLL÷2（inputs SYSCLK/HSI/HSE/PLL）。
- **V103 PLL 四源**（HSI/HSI÷2/HSE÷2/HSE；HSI÷2 走 EXTEN_CTR.HSIPRE 不在 RCC）→ 配置真相仍 HSI/HSE+prediv，不画假 mux 行（note）；RTC 三源含 HSE÷128；HSE RM 4~16 vs DS 8~25 冲突保留 DS + note；HCLK RM ÷512/HAL ÷16 边界 note。
- **X035 无 LSI**：IWDG/AWU=HSI÷1024≈46.875kHz（aux readout）；**ADC CTLR3.CLK_DIV 实为 9 位非自然编码**（[8:0]，复位 0x3 不在编码表）→ raw 旋钮 note 升级（位宽仍 4 档子集 + 强警告）；MCO 图行名 HSI/HCLK vs 寄存器 100=SYSCLK/101=HSI note。
- **H417 RM 仅 PPRE2 无 PPRE1** → APB1 kind=readout + note；定时器内核=PCLK 无 ×2（repo APB≡1 数值等价 note）；RTC 第三源 HSE÷512；双核 HPRE→V5F / FPRE→V3F 分叉以 readout 表达（不改 ahb 合成语义）；KernelMux 11 字段/AuxPlls 不建模（组 note 列名）。
- **V307** PLL2/PLL3（HAL todo!()）/USBHS HSPLL（API 存在外设未建模）仅显示簇；ETH125M/I2S2/3SRC/RNG 不画（无驱动 note）；AHB 硬件 9 档 repo 5 档 note。
- **CH582** 无 HSI/无 AHB/APB 分频；ClockSrc 三路（PLL/HSE/CK32K）→ CK32K 为 displayOnly 源 + `sysclkMuxInput:true` 画灰行；LSI/LSE 作 **aux osc 节点**（非 sources，避免污染 mux 输入）→ CK32KSEL mux → RTC readout（BLE 占用 note）；**ADC 图/寄存器歧义**：图 6-1 把 ADC_CLK_DIV 画到 Fsys 轨，寄存器明确 CK32M÷10/4/6/8 → repo 采信 CK32M + note 并列。
- **RM 保真 mux 输入裁决（主控）**：displayOnly 源**不再通用追加**进 SYSCLK/PLL mux 灰行——LSI/LSE 在 RM 中非 SW/PLLSRC 输入 → 无灰行、无灰边（仅 aux 引用）；仅 `sysclkMuxInput` 者（CH582 CK32K）画灰行+灰边（active=false）。aux mux 行标签取 `inputs[].label`（muxLabels，RM 文案如 PLL3÷2/HSE÷128）；同源多行边 id 加行序后缀防 Vue :key 重复。

### 16.3 图元语言与布局（MX2 照抄）

- kind ∈ osc/mux/div/readout/peri/pll；簇内分离块（mux 竖 radio 列/stepper「− ÷N +」/读数卡两行「N MHz」「max N MHz」/pll=mux+参数 stepper 链+读数/peri airy 四行）；PRIM 常量 layout.ts export 渲染共用；行距硬约束（读数 18/peri 20/标题-控件 14）；**白纸面板**取代点阵（MX2 实机为纯白纸）；分组框 11px 左上标题；长 note/hint/组标签按块宽截断+`<title>` 悬停全文（防横穿画布）。
- 逐芯片 `clock.json.diagram`（节点坐标+显式分组框+lanes 走廊 hint）镜像 RM 五区带；无 diagram 回退列式（宽簇按实际宽度扩张列距）；走线正交避障不穿簇（validate 5c 断言：全覆盖/坐标/分组互不重叠/簇互不重叠/走线不穿/aux 输入存在/displayOnly 不进 options）。
- 逻辑节点数组不变（表格/Detail/菜单/聚焦/高亮/锁定零改动）；aux/displayOnly 不进 ClockConfig/cube.json/solver/matchPreset/validateClock 配置语义；**codegen 零改动**（verify 6/6+6/6+1/1 快照逐字节同）。

### 16.4 验收（2026-11-18，七芯片截图对照 RM 转录）

V003/X035/V103/V203/V307/H417/CH582 逐芯片 fit 截图核：mux radio 列/stepper 链/读数两行/白纸/中文分组/aux 仅显示带/走线锚点入 radio 行/无文本溢出；V203 交互抽查（SPI 8MHz→实际 4MHz ÷2 BRG+Resolve(1)、Reset 对话框、右键高亮+Clear）通过。**1495 测试/61 文件**、vue-tsc/eslint/validate 7 芯片 0/0/build/verify 三路全绿。
- 诚实边界：I2S mux/KernelMux/AuxPlls 不画不建模；aux 不生成；V203 prediv/非预设 PLL 显式导出暂缓（M17 候选）；X035 raw 旋钮 4 档子集+9 位编码强警告；MCO/RTC div 显示固定档无旋钮。

### 16.5 收尾裁决（用户目检反馈，2026-11-18 晚）

- **接入线缓冲+垂直进入**：路由重写为「出锚点右行 STUB=14 缓冲 → 走廊/通道 → 入锚点左行 14 缓冲**水平垂直进入左缘**」；新增 `grazes()` 擦边拒绝（竖/横段与簇左/右或上/下边界重合且范围相交 → 拒绝该候选改走其他走廊）——消除旧 L 路由竖段贴 mux 左缘擦行。测试锁住：七芯片每边首末段水平 ≥10px + 全边不擦边（clockTree 99 用例）。
- **外设并联均衡列**：用户反馈「USART 出界」实测为画布过高（1076px）致常规缩放比视口外溢（坐标本身未越界）→ 七芯片 diagram 重排：外设每列 ≤2 卡均衡拆列（V203 USART 4→2×2 等）、所有外设列顶边对齐并联带、分组框/lanes 复算；画布高度 V203 1076→772 / V307→672 / H417→668 / V003→452 / X035→392 / CH582→492。validate 5c 与全量测试复绿（1496）。**已被 §16.6 D12 取代**（用户裁决「并联是上下并联不是左右」）。

### 16.6 D12 MX2 主干重构（2026-11-18 夜，用户参照 CubeMX2 时钟树截图裁决）

- **结构**：源列左竖排 → PLL → SYSCLK mux→System Clock→AHB Prescaler→HCLK 水平主干 → 右列**输出上下并联竖排**（CORE/SYSTICK/APB1/TIM1/APB2/TIM2/USB/ADC，读数卡右对齐 1400）→ 外设**单列上下并联竖排**（类别分组框上下堆叠）。MX2「To Power」WCH 无独立域不造假行；DMA/存储器并入 CORE 行标签。
- **SysTick 逐芯片 HAL 逐字事实**（delay 实现，SYSTICK aux 行 deriveDiv 据此）：
  | 芯片 | deriveDiv | 证据 |
  |---|---|---|
  | V003 | 1 | delay/impl_qingke_v2_v4.rs：`set_stclk(Stclk::HCLK)`、`P_US=hclk/1e6`（QingKe V2） |
  | V103/V203 | 8 | delay/impl_qingke_v3.rs：`P_US=sysclk/8/1e6`（QingKe V3） |
  | V307 | 1 | impl_qingke_v2_v4.rs（QingKe V4）`set_stclk(Stclk::HCLK)` |
  | X035 | 1 | delay/impl_systick_v4x7.rs：`set_stclk(Stclk::HCLK)` |
  | H417 | 1 | delay/impl_systick_v3f_v5f.rs：RM §4.6 两计数器均 **V3F HCLK** 域、`set_stclk(Stclk::HCLK)` |
  | CH582 | 8 | ch58x-hal systick.rs：`hclk_div8` |
- **aux schema 扩展**：`deriveDiv?: number`（readout 单输入且 fixedMhz=null → outMhz=输入 outMhz÷deriveDiv）、`group?: string`（缺省 g-aux；CORE/SYSTICK/V5F/V3F 入 g-out）。model 把 TIM1/TIM2/ADC 域/USB/APB1/APB2 归 g-out（g-tim/g-usb 退役）；validate 5c 守 deriveDiv 正数+group 同名框。仅显示不生成，codegen 零改动。
- **坐标基线实测偏离**（走线硬约束 STUB≥10/GRAZE3 所致，G 域实测）：1 参数 PLL 簇宽 284 → PLL x=290~292 或 SYSCLK x=620（V307/H417）保 pll-sys 缓冲；USBPRE x=600~620（PLL 右缘外）；lanes pll-usb 逐芯片 −6/−8/−10/11；外设组框 h=n×120+24、组间 24（跨组卡距 168）；H417/CH582 无 USB 行（peripheralClocks 无 usb，诚实）；X035 SYSCLK 单行 → AHB y=240。
- **验收**：1524 测试/61 文件（clockTree 127 含 28 D12 断言：peri 单列同 x/y 递增/类别连续、E 右缘 1400 行序、CORE=hclk、SYSTICK=hclk÷deriveDiv）；validate 7 芯片 0/0；verify 6/6+embassy 6/6+BLE(CH582) 1/1；七芯片 fit 截图（V203 48%/V003 84%/X035 66%/CH582 66%/V103 58%/V307 34%+77%/H417 29%+56%）结构核过；画布宽 1790、高 696(V003)~2376(H417 18 卡)。

## 17. M17 CH582 迁移 ch5xx-hal + BLE shim 移植（2026-11-19）

> 契约：[CH5XX_BACKEND_CONTRACT.md](CH5XX_BACKEND_CONTRACT.md)（D1–D8）。实测笔记：[m17-shim-notes.md](m17-shim-notes.md)（S1，含证明工程与逐条偏离）。本节记录**迁移证据链、API 差异、shim 移植面、工具链/vendor 裁决与验证状态**；legacy ch58x 证据仍以 §13/§14 为准。

### 17.1 真相源与上游状态

| 对象 | 锁定版本/事实 | 说明 |
|---|---|---|
| ch5xx-hal | `875651b693ef437e045d023171adaf052a07525c`（0.1.0，rust-version 1.95） | `../reference/ch5xx-hal` 为 tarball 解包（非 git 树）；BLE 支持如实为 **Not implemented** |
| ch5xx-metapac | `680e2e12`（由 ch5xx-hal Cargo.toml 锁定） | PAC 新 svd2rust 风格；提供 `memory-x`/`rt` |
| ch5xx-data | `42237c4d`（vendor 快照；即 metapac `680e2e12` 生成所用数据）；上游另核对 `fba766c1`（CH569/CH565 RAMX 默认 32K 修正） | **不是 crate 依赖**：HAL `build.rs` 读兄弟目录 `../ch5xx-data/data`。两版数据在 CH569/CH565/SPI/UART 寄存器定义上有差异，本次 vendor 仍锁 `42237c4d` 以与 metapac 对齐；见 §17.5 |
| legacy BLE 源 | ch58x-hal @ `611954e`（MIT/Apache-2.0，(c) 2023 Andelf） | `src/ble/{ffi,gap,gatt,gatt_uuid,gattservapp,linkdb}.rs` 逐字移植为 `vendor-src/ch5xx-ble` |
| WCH blob | `LIBCH58xBLE.a` 1,133,340 B / `libISP583.a` 5,374 B | 原样随 shim 分发，未修改；链接名用 `nm` 核对 |

上游 issue 现状（2026-11-19 只读核实）：ch32-rs/ch58x-hal **#13 OPEN**（维护者 andelf 评论指引转向 ch5xx-hal）、**#14 OPEN**（0 评论）；ch32-rs/ch5xx-hal **issues 为空**，README 能力表为 `USB host, BLE, NFC | Not implemented`。因此本里程碑的 BLE 能力全部由我方 shim 承载；三份英文草稿见 `/tmp/m17-issue-comments/`（§17.9）。

### 17.2 API 差异表（legacy ch58x-hal → ch5xx-hal）

| 维度 | legacy @611954e | ch5xx-hal @875651b6 | 生成器/shim 处置 |
|---|---|---|---|
| entry | `#[qingke_rt::entry]`，qingke-rt 0.5 直依赖，highcode | 同样不 re-export entry；qingke-rt **0.8.4** 直依赖，`features=["highcode"]` | Cargo 显式写 qingke-rt 0.8.4 |
| 时钟 | `Config{clock,low_power,enable_dcdc}`；sysctl 具名档 | `hal::rcc::Config`；预设是**关联常量** `Config::PLL_60MHZ` 等（`presets!` 宏在 `impl Config` 内，rcc.rs:264/277/525），**没有 `rcc::presets` 模块** | D4 旧文案已按 S1 §9 纠正；clock.rs 用 `hal::rcc::Config::PLL_*` |
| 频率类型 | `Hertz` | `time::Hertz(pub u32)`；无 `.Hz()`/U32Ext 扩展 | 生成 `Hertz(n)` / `Hertz::hz(n)` |
| 外设所有权 | 直接 `p.PAx` 单例 | `Peri<'d, T>`（`embassy_hal_internal` re-export，lib.rs:30）+ `Peripherals::take` | 模板统一 `Peri`；shim 温度通道用 `Peri::steal()` |
| UART | `new::<REMAP: bool>(peri, **tx, rx**, cfg)` | `new_blocking::<REMAP: u8>(peri, **rx, tx**, cfg) -> Result` | **参数顺序反转**；REMAP 由 bool 改 u8 |
| REMAP | `const REMAP: bool`（0/1 档） | `const REMAP: u8`（多档引脚集） | usart/spi/i2c 模板全部 `::<u8>` |
| GPIO | `Output::new(pin, Level, OutputDrive::{_5mA,_20mA})`；无 Speed | `Output::new(pin, Level, Speed::{Low(5mA),High(20mA)})`；`Input::new(pin, Pull)` | 生成映射 Low/High；旧字段名仅剩 UI 语义 |
| SPI | 仅 SPI0；polarity（无 phase），半双工路径 | `embedded_hal::spi::Mode` 支持 **MODE_0/MODE_3**；全双工 `new_blocking::<REMAP: u8>(spi, sck, mosi, miso, cfg)` | 只生成 mode 0/3；mode 1/2 与 txonly/rxonly 生成期报错 |
| I2C | 单实例；有上拉参数；`transaction()` todo!() | `Config{frequency, duty}`，**无上拉字段**；Fsys 必须 **2..=36 MHz**（i2c.rs:162） | ch5xx 档忽略上拉并警告；时钟范围生成期 `I2C_CLOCK_OUT_OF_RANGE` |
| ADC | `Config{clk, pga_gain}`；`read()` 返回 u16；通道号整数 | `Config{gain, sample_clock}`（`#[non_exhaustive]`）；`SampleClock::Divide1..4` **判别值 0..3 与旧枚举同序**；通道类型是 **GPIO `Peri`**（`impl_channel` 表，如 PA4=ch0；CH582 的完整 pin→channel 映射随各自芯片 cfg） | 模板按引脚传通道；`blocking_read(&mut ch) -> Result<u16,_>`；温度用 `unwrap_or(0)` |
| 寄存器风格 | `pac::SYS::PTR` 全局单例 | `pac::SYS` const 实例 + `.reg()`；触摸键拆成独立 **`pac::TOUCHKEY`**（原 `SYS.tkey_cfg`，同地址 0x57） | shim 改读 `TOUCHKEY.cfg()`；寄存器语义不变 |
| SysTick | 32 位 `CNT` 视图 | `pac::SYSTICK.cnt()` 为 64 位视图 | shim `srand()` 取低 32 位（CNTL） |
| 32K / 日志 | `ble::Config` 硬编码 `SelRTCClock=0/rcCB=None`；HAL 有 `println!`/`set_default_serial` | **rcc 无 32K API**（无 `enable_lse`/`Clock32KSrc`）；**无 `println!`/`set_default_serial`** | 由 shim 提供 `enable_lse()`/`set_clock32k_lsi()`/`set_default_serial()`/`println!`（§17.3） |
| embassy | executor 0.7 + SysTick tick | executor 0.10 / embassy-time 0.5.1；time driver 用 `time-driver-tmr0` 或 SysTick；SysTick init 置 `STCLK=1`（HCLK 全速）+ compare 中断 + 软件高 32 位（time_driver_systick.rs:161-174） | BLE 档不启用 embassy；embassy 档按 reference 例程锁定 git rev |

### 17.3 shim 移植面与偏离

`vendor-src/ch5xx-ble/`（package `ch5xx-ble` 0.1.0，edition 2021）：

- 逐字移植（仅改 crate 路径/依赖）：`ffi.rs` 727、`gap.rs` 616、`gatt.rs` 690、`gatt_uuid.rs` 283、`gattservapp.rs` 166、`linkdb.rs` 109 行。`#[link(name="CH58xBLE")]` 原样保留；`build.rs` 追加 link-search + `static=CH58xBLE`/`ISP583`。
- 新增门面 `src/lib.rs`：D3 冻结 API（`Config{mac_lsb, sel_rtc_clock, rc_cb}`、`init`、`EventSubscriber`、`TmosEvent`、`MacAddress`、`lib_version`、`temperature_raw`、`srand`、`systick_hz`、`enable_lse`、`set_clock32k_lsi`、`set_default_serial`/`println!`），以及 `LLE_IRQLibHandler`/`BB_IRQLibHandler` 外部声明（旧 ffi 未声明这两符号）。
- 偏离逐条（详证 m17-shim-notes §8）：①`SYS.tkey_cfg` → `TOUCHKEY.cfg`；②`adc::Config` 为 non_exhaustive，改 `default()` 后赋字段；③`srand` 64 位视图取低 32；④温度超时 `unwrap_or(0)` 而非 panic（协议栈内部回调不能死机）；⑤`enable_lse` 延用 `hal::delay::Delay` 的 µs 换算，寄存器序列与旧实现一致；⑥**PA 控制不移植**（不调 `BLE_PAControlInit`，用芯片默认功率，契约已声明）；⑦`set_default_serial` 为安全 fn、写 UART 错误忽略、未安装时 no-op；⑧新增两个 blob ISR 符号声明；⑨未移植 `use_factory_mac_address`、`isp`、`PaConfig`；⑩`TmosEvent` 4/2/2 pubsub、Drop 归还、单订阅者语义与旧版一致。
- 32K/ADC 实现事实：`enable_lse()` 在 SAM 窗口（0x57/0xA8/0x00 + `fence.i` + critical-section）内写 `CK32K_CONFIG`，延时按 Fsys 换算（60 MHz ≈25 ms + 60 µs）；`set_clock32k_lsi()` 写 `CLK_OSC32K_XT=0`/`CLK_INT32K_PON=1`；温度通道 15/电池 14，读前保存恢复 `TOUCHKEY.CFG`/`ADC.TEM_SENSOR`/`ADC.CHANNEL`/`ADC.CFG`。
- 链接结果（S1 证明工程）：`.highcode` 0x2000_0000 含向量表与 BLE IRQ；`.bss` 尾 COMMON 1116 B；`BLEB/BLEL` 中断号 **20/21**（metapac `Interrupt` 枚举），链接符号 `BLE_LibInit`/`TMOS_SystemProcess`/`BB_IRQLibHandler`/`LLE_IRQLibHandler` 均在。

### 17.4 三档 cargo 与工具链裁决

| 档位 | features / 依赖 | 工具链实测 |
|---|---|---|
| blocking | `["ch582","rt","memory-x"]` + qingke-rt 0.8.4 + embedded-hal 1.0 | **nightly + `[unstable] build-std=["core"]` + rust-src**（与 reference examples/ch582 一致） |
| embassy | `+["embassy","time-driver-tmr0"]` + embassy-executor 0.10 / embassy-time 0.5.1 + `[patch.crates-io]` embassy git `4e2fa2e3…` | 同上 |
| BLE | `["ch582","rt","memory-x"]`（**不启** hal embassy/time-driver）+ `ch5xx-ble` path + embassy-sync 0.8（crates.io）/ critical-section / portable-atomic | 同上；busy-poll，无 executor/WFI |

- **stable 可行性（S1 实测，两条自洽路线）**：stable 1.100.0 能编过，但 cargo **静默忽略 `[unstable] build-std`**（不编译 core），前提是主机已预装目标平台的 `rust-std`（S1 证明工程为 `rust-std-riscv32imac-unknown-none-elf`）。生成工程沿用 chip.json 的 `riscv32imc`，若降 stable 需预装 **该 target** 的 rust-std。默认仍选 **nightly + rust-src + build-std**（D2 原文不动）；`nightlyByBackend={"ch5xx-hal":true,"ch58x-hal":false}` 驱动 verify 选工具链。
- **BLE 档不启用 hal `embassy`**：协议栈由 `generated::ble::run()` 的 `loop { TMOS_SystemProcess(); … }` 推进，shim 自带 `embassy-sync 0.8` pubsub。这是对 §14.2bis 实机缺陷（WFI 停计/时间驱动饿死）的延续规避。
- **vendor 模式 patch**：shim 的 Cargo.toml 以 git rev 依赖 ch5xx-hal；工程 vendor 模式必须 `[patch."https://github.com/ch32-rs/ch5xx-hal"] ch5xx-hal = { path = "vendor/ch5xx-hal" }`，否则出现两份 HAL、`UartTx` 等类型不兼容。
- 注记：ch5xx-hal 自身 Cargo.toml 对 qingke 0.8.4 启用 `unsafe-trust-wch-atomics` + `critical-section-impl`；生成 target 仍沿用 M11 的 `riscv32imc`（无 target_has_atomic → embassy-sync 走 critical-section）。二者并存，本轮未改变 M11 决策，实机原子/中断行为随 BLE 复验一并观察。

### 17.5 git-mode 阻断裁决（强制 vendor）

- 根因：`ch5xx-hal/build.rs:610` 的 `data_root()` 硬编码 `CARGO_MANIFEST_DIR/../ch5xx-data/data`；`register_version_opt()` 等在 `chips/<CHIP>.yaml` 缺失时 `panic!`（build.rs:667:62）。
- 复现：纯 git rev 依赖（去掉全部 `[patch]`）→ cargo git checkout 只有一个仓库、无 submodule →
  `thread 'main' panicked at .../ch5xx-hal-be2dc8f8a6a22123/875651b/build.rs:667:62: reading .../875651b/../ch5xx-data/data/chips/CH582.yaml: No such file or directory`。原始日志 `/tmp/m17-shim-proof-git/build.log`，摘要归档 m17-shim-notes §9。
- 裁决：**ch5xx 档只支持 vendor 模式**。`selection.vendorHal=false` 时生成期报 `TARGET_FEATURE_UNSUPPORTED`（附原因），不产出必然 panic 的工程；vendor zip 同时内嵌 `vendor/ch5xx-hal` 与 `vendor/ch5xx-data`（目录形状正好是 `../ch5xx-data/data`）。非 BLE 档不嵌 shim zip；BLE 档额外内嵌 `vendor/ch5xx-ble`（shim 无 git 上游，Cargo 始终 path 依赖）。
- 上游建议与草稿：见 §17.9（`ch5xx-buildrs-data.md`）。

### 17.6 legacy 兼容规则

- `data/devices/ch582m/chip.json`：`halBackend="ch5xx-hal"`、`legacyHalBackend="ch58x-hal"`；新建工程默认 ch5xx。
- 历史 `cube.json` 缺 `halBackend` 且芯片为 CH582M → 导入时按 **legacy ch58x-hal** 解析（保护旧 main.rs/生成物）；设置页提供「HAL 后端」覆盖（仅当 chip 有 `legacyHalBackend`）。
- BLE + legacy → 旧 `ch58x-hal` 路径（§14 能力与实机结论继续有效）；BLE + ch5xx → shim。legacy 的 cargo 两档（blocking/BLE）本轮保持绿色，未改其模板语义。

### 17.7 验证状态（诚实分级）

- **五档 cargo 绿（2026-11-19，本机）**：ch5xx blocking / embassy / BLE 三档（nightly；三档 target 下均有 `build/core/*/out/libcore-*.rlib`，证明 `build-std` 实际执行）+ legacy blocking / BLE 两档（stable；无 build-std 产物）。产物均存在 `target/riscv32imc-unknown-none-elf/release/verify-build`（ELF，20136 / 27256 / 358500 / 21400 / 360272 B）；临时工程目录 `/tmp/m17ch5`、`/tmp/m17ch5e`、`/tmp/m17ch5b`、`/tmp/m17legacy`、`/tmp/m17legacyble`（vendor 树分别含 `ch5xx-hal`+`ch5xx-data`(+`ch5xx-ble`) 或 `ch58x-hal`）。
- **BLE 实机：已通过（2026-11-19，主控复验 ×2）**。ch5xx+shim 固件（`/tmp/m17ch5b` BLE 档 ELF，nightly 重建）经 MRS OpenOCD `program … verify reset exit` **Verified OK** 烧录（用户 pkexec 授权）；宿主 AX210（1M PHY 持久化）bluez D-Bus 复验：扫描命中出厂 MAC `0C:3D:5E:A6:62:94`（与 legacy/C 同源）→ Connect + ServicesResolved → FFE1/FFE2 发现 → 读 FFE1=00 → 写 FFE2=42 → 读 FFE1=42 → **notify 20 包/20s**（首轮间隔 0.99–1.03s，二轮 0.77–1.17s，`systick_hz()` 派生周期正确）。脚本 `/tmp/m17-ble-test/gatt-test.py`、日志 `result.log`。**ch5xx BLE 升级为实机验证级**；legacy 结论仍见 §14.2quater/quinquies。
- **测试**：**1621 用例 / 63 文件全绿**（ch5xxCodegen 59 / ch5xxBleCodegen 32 + 分流/导出/往返；ch58x 72+91 零 regress）；vue-tsc/eslint/validate 0/0/build 绿；verify 6/6 + embassy 6/6 + BLE(CH582) ch5xx 1/1 + legacy 1/1；浏览器抽查 ch5xx 默认 Cargo/build.rs/cube.json halBackend 与 legacy 切换联动。
- 已知边界：BLE shim 未做 PA 控制；`sel_rtc_clock=0` 依赖板上 32.768 kHz 晶振，无晶振板需 LSI 回退（校准未移植，连接稳定性未保证）；温度回调在 CH583 上上游自述“未上板测试”。

### 17.8 COMMON 未清零风险（既有问题，非 shim 引入）

- `qingke-rt` 0.8.4 的 `link-highcode.x` 中 `.bss` 通配只含 `*(.sbss .sbss.* .bss .bss.*)`，**不含 `*(COMMON)`**。WCH blob 使用 81 个 tentative definition（`gTmosPara`/`gBleLlPara`/`ble`/队列头等，共 0x45c=1116 B）；ld 将它们排在 `_ebss` 之后、`.bss` 段尾，而启动清零循环只清 `_sbss.._ebss`，故这段 COMMON **不会在启动时归零**。M17 的 ch5xx BLE 二进制实测 `gTmosPara = _ebss = 0x2000_3ac8`（`nm`），即 COMMON 起点正好落在清零区间之外。
- 旧 `ch58x-hal` 使用的 qingke-rt 0.5 `link-highcode.x` 通配完全相同——**legacy 路径同样存在**，且 legacy BLE 实机曾正常工作（§14.2ter/quinquies），说明该风险未必必然致命，但**不能据此宣称安全**：`cargo build` 无法暴露，只有实机长跑/连接路径能裁决。
- **实机裁决（2026-11-19）**：ch5xx+shim 固件两轮连接/GATT/notify 复验全过 → COMMON 未清零在本路径**未造成功能故障**（与 legacy 实机表现一致；推断 blob 自初始化或其初值容忍）。缓解（生成 `-T` 片段收 `*(COMMON)` 并在 init 前清零、或 fork link.x）保留为**可选加固候选**，非阻塞项；长跑/掉电重连压力测试未做，不宣称绝对安全。

### 17.9 上游沟通草稿（待主控审核后发布）

| 文件 | 目标 | 要点 |
|---|---|---|
| `/tmp/m17-issue-comments/13.md` | ch58x-hal#13 评论 | 感谢指引；ch5xx SysTick 驱动阅读结论（HCLK 全速 + compare 中断 + 软件高 32 位；未见 WFI 停计补偿）；我方 busy-poll 不受影响；已基于 875651b6 完成迁移 + shim；询问 WFI/停计是否在 roadmap |
| `/tmp/m17-issue-comments/14.md` | ch58x-hal#14 评论 | ch5xx-hal 无 ble 模块，#14 上游无承载点；shim 把 `sel_rtc_clock`/`rc_cb` 参数化并固化；邀请未来上游 BLE 包装采纳该参数化；附 shim 路径 |
| `/tmp/m17-issue-comments/ch5xx-buildrs-data.md` | ch5xx-hal 新 issue | build.rs 硬读兄弟 `../ch5xx-data/data` 致纯 git 消费者 panic（复现/日志见 m17-shim-notes §9）；建议 git 依赖 ch5xx-data 或把数据纳入 crate；附 vendor 内嵌 workaround |

三份草稿均为英文，未发布；#13/#14 保持 OPEN、ch5xx-hal issues 仍为空。

## 18. M18 EVT 对照矩阵与 shim 扩展（2026-11-19）

### 18.1 规格取真与版权边界

- CH583EVT.ZIP（`/home/teze/下载/`）解包于独立新目录 `/home/teze/CH32/EVT/CH583EVT/`；35 顶层 BLE 例程 + MESH 15 + LWNS 9。逐字规格落 `docs/m18-evt-specs.md`（918 行）。
- **版权清洗**：EVT `.c/.h` 为 WCH 版权代码（头部仅 field-of-use 限芯片句：`Copyright (c) 2021 Nanjing Qinheng…` / `Attention: This software (modified or not) and binary are used for microcontroller manufactured by Nanjing Qinheng Microelectronics.`，140 个文件重复；**无禁逆向条款**）；参考手册另有禁复制 clause。specs 初稿含 38 个逐字代码块 → 清洗为事实参数表（保留 4 个 ≤2 行 de minimis 引用），测试 bin 由规格**独立实现**（实现组不读 EVT `.c`）。
- 与同源推断（CH32V20xEVT）的关键差异：SimpleProfile 实为 FFE0–FFE5 五特征；Peripheral notify **1600ms**（非 1s）；HeartRate 2000ms 固定 2B；BLE_UART 名 `ch583_ble_uart`、UART3=PA5(TX)/PA4(RX)（QFN48 均引出）；BLE_SNV 默认 TRUE、CLK_OSC32K 默认 1（central 族 0）；HAL_SLEEP 全未启用；库串 V2.13 vs 头 V2.10 vs VER_FILE V2.1（EVT 自身不自洽，附录 G）。

### 18.2 shim M18 扩展（链接验证 25 符号 T）

- central：GAPRole_CentralStartDiscovery/CancelDiscovery/EstablishLink/UpdateLink/UpdatePHY；GATT client 16 符号；GATTServApp_ProcessCharCfg（7 参）；linkDB_NumConns/NumActive；GAP_NumActiveConnections；gapCreateSync_t+GAPRole_CreateSync。
- 签名以 CH58xBLE_LIB.h 逐字为准；头文件缺的 5 符号由 `LIBCH58xBLE.a` 反汇编恢复（只读分析，非派生实现）；`GATT_DiscPrimaryServiceByUUID` len=u8、`GAPRole_UpdatePHY` phy_options=u16、`GATT_WriteNoRsp` 无 taskId。
- `Options`/`init_with` 参数化 BufMaxLen/MEMLen/ConnectNumber/BufNumber/TxPower；`init()` 向后兼容（生成器产物逐字节不变）；SNV off/sleepCB None 保持。

### 18.3 测试矩阵与实机诊断（诚实分级）

- `ble-evt-tests/` 22 bin 全编译绿（nightly+build-std，riscv32imac）；宿主 harness `/tmp/m18-ble-host/`（test_peripheral/peer_peripheral/peer_advertiser/throughput/run_case）。
- **实机受阻待电源循环**：反复 OpenOCD halt/resume 后，已知良好的 M17 固件与 evt_peripheral/evt_speedtest_peripheral 均不广播；读证：PFIC IENR0=0（两固件同）、RAM 向量表 BLEB/BLEL 已接线（0x20000050/54 → 0x200000c0/d0）、mtvec=0x20000003、mstatus=0x1888（MIE=1）、SysTick CTLR=0x5 自由跑 CNT 递增、PC 在 TMOS 泵内移动（非死锁）。假设：软复位不复位 RF/32K 模拟域，halt/resume 累积致模拟态 stale；**需板级电源循环验证**，未证实前不宣称任何 bin 实机通过。
- 探针事故：被停后台任务遗留 root openocd 占 USB（`claim interface failed`/libusb IO）→ `pkexec kill <pid>` 清理；`pkill -f openocd` 匹配自身命令行自杀 → 用 `pkill -x openocd`；pkexec 改 cwd → OpenOCD program 必须绝对路径。
- 安全边界：OTA bin 擦/写/校验/结束命令 stub 为 ATT 错误（不写 flash）；SNV off；无 HAL_SLEEP。

### 18.4 上游裁决

- 用户裁决：**维持 blob 路线；上游 issue/PR 暂缓至 Rust 重写完成**。重写 spike（`docs/m18-cleanroom-spike.md`）：无禁逆向条款但手册禁复制；开源 LL 首选 NimBLE（Apache-2.0，移植面 1.5–3k 行）/备选 Zephyr；BTstack 许可禁商用排除；RF 黑盒代码量 9% 但关键路径 100% 阻塞（aes_soft.o 0 字节→硬件 AES 引擎未公开）；工作量方案 A 20–30 人月 / 方案 B 13–22 人月 + BQB 3–6 人月；建议 M19+ 独立里程碑 + 前置 2–4 周 G1 探针（RF 寄存器/校准布局合法获取可行性）。
