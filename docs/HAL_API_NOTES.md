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
3. **busy-poll 连续轮询无 delay**：官方 C Main_Circulation = `while(1){TMOS_SystemProcess();}`（peripheral_main.c:40）；M13 的 delay_us(300) 取自上游 embassy Rust 示例（该示例走 SysTick Timer，在本硅片从未跑通，§14.2bis）。notify 周期最终用 **SysTick CNT**（周期=`clocks().hclk`≈1s，单次 load）；曾试 TMOS_GetSystemClock 时基——它**非纯 getter**（调 pfnTimerCBs 累加 gTmosPara，反汇编核实），每圈含一次 __udivdi3（clockGetTickValve 内），PC 采样实测占主循环 5/6 时间，弃用。连接期间 GAP/GATT 事件静默消费（阻塞 UART println 会饿死 TMOS 泵）。

**烧录工具链事故（诚实记录）**：`wlink flash <elf>`（无 verify）烧 M14 首版后**广播消失**；wlink dump 读外设/RAM 出现与运行态矛盾的值（CLK_SYS_CFG/pfnTimerCBs 等，halted 与 running 读一致但和固件行为不符——wlink dump 外设读可靠性存疑，本节不以其为证据）。改 **MRS OpenOCD `program <elf> verify reset exit` → Verified OK 后广播立即恢复**。结论：CH58x 烧录一律走 OpenOCD program verify（M13 流程），wlink flash 产物不可信；寄存器证据以 OpenOCD+gdb 为准。另：WCH-Link 当日多次自发 USB 掉线重枚举（内核日志可查），掉线期间 OpenOCD 读全零/attach 失败——取证前先确认探针在线。

**闭环（2026-11-18 上午）**：
- **LSE 全链固件（enable_lse + SelRTCClock=0）实机连接建立成功 ×3**（bluez Device1.Connect → Connected=true；M13 固件从未连上）。根因 #5 坐实：32K 域错配（硬件 LSI vs 库 LSE）。
- **宿主适配器定位**：连上后 GATT 发现极慢（~30s）且链路 ~30s 掉（ATT 超时）；**官方 C Peripheral.hex 对照现象完全相同**；内核日志每次连接时刻报 `Bluetooth: Unexpected continuation frame (len 7)`（L2CAP 孤儿续帧=起始帧丢失）。**用户手机 nRF Connect 对照：C 固件秒级发现 FFE0+FFE1–FFE5、FFE1 读写成功** → 板子 RF/协议栈正常，**卡点在本机 Intel AX210 适配器 LE 数据通路**（WiFi/BT 共存或固件问题；适配器 D-Bus 断电重启无效）。宿主侧 GATT 验证改由手机承担。
- **发货配置**：`ble.clock32k` 缺省 **lse**（官方模组标配晶振，连接已验证）；lsi 回退保留（无晶振板，校准未移植、连接稳定性未保证，UI 有警告文案）。发货版 Rust 固件（LSE + stack_init + 连续轮询 + SysTick notify）已 OpenOCD Verified OK 烧录，广播 CH582M 正常；手机对 Rust 固件的 FFE1/FFE2 读写+notify 验证进行中。
- 生成服务语义（手机验证判据）：读 FFE1=00 → 写 FFE2=42 → 读 FFE1=42 + notify 订阅每秒收 42（write 落 notify_value，read/notify 返回它）。
- **上游 issue 已提交（2026-11-18）**：qingke#42（MIE 启动缺陷，含 0.8.4 v4 路径仍缺 MIE 的疑问）· ch58x-hal#13（SysTick WFI 停计 + hclk/8 速率假设错误）· ch58x-hal#14（ble::init SelRTCClock=0/rcCB=None 硬编码，建议暴露 32K 源 + 校准回调）。
- **手机对 Rust 发货固件读写成功（用户实测确认）**：CH582M 连接 → FFE0/FFE1/FFE2 发现 → FFE2 写 → FFE1 读回一致。**Rust 生成固件 BLE 全链路（广播→连接→GATT 发现→读写）实机闭环**。notify 订阅发送路径编译 verified，周期待实测确认（不宣称已验证）。

### 14.3 M12 验证状态

- 1222 测试全绿（+124：ch58xBleCodegen 70 / bleRules 23 / bleProjectFile 15 / ideConfig ch58x 13 / 默认时钟 3）；tsc/eslint/validate/build ✓。
- verify:build：V003/V203/H417/CH582M blocking/embassy/**--ble** 全过（stable 1.100 / nightly 1.102）。
- 浏览器验收：BLE 节（角色/名称字节计数/广播间隔/MAC 三来源/UUID16/observer 参数）+ 运行时互锁（BLE⇒embassy、blocking 禁用）+ 新建工程默认 PLL 直接生成 + ZIP 75 文件 0 冲突。
- **实机目标层核实闭环（2026-11-17 晚）**：Windows 官方工具开启两线调试 → CH-LINK 接回 Linux → MRS OpenOCD examine 通过 → gdb 3333 attach 读寄存器/Flash/flash info → detach。见 §14.2。烧录待用户授权。
- 开发期 HMR _artifact_ 记录：autosave 单例闭包绑定旧 store 实例，HMR 重置 store 后继续写旧工程快照——仅 dev 环境出现（生产 store 不重建），验收以干净 reload 为准；不视为产品缺陷，留观。
