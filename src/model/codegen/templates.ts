// EJS 模板常量（浏览器与 Node 校验脚本共用同一份）。
// 约定：
// - 动态插值一律用 <%- %>（原始输出，不做 HTML 转义，Rust 泛型/引用符号必须原样保留）；
// - if/forEach 结束标签用 -%> 修剪空行，避免快照里出现大片空行；
// - 模板内容确定性：不含时间戳/随机值，重新导出结果逐字节一致。

// ---------- 工程骨架（ch32-hal-template 为唯一真相源） ----------

export const CARGO_TOML_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[package]
name = "<%- packageName %>"
version = "0.1.0"
edition = "2024"

[[bin]]
name = "<%- packageName %>"
harness = false

[dependencies]
<% if (vendorHal) { -%>
# 完整 HAL 源码由导出层内嵌到 vendor/ch32-hal，便于直接查阅/跳转
ch32-hal = { path = "vendor/ch32-hal", default-features = false, features = [<%- halFeatures %>] }
<% } else { -%>
# ch32-hal 未发布 crates.io：git 依赖并锁定 rev（升级 rev 前须重新核对 API）
ch32-hal = { git = "<%- halGit %>", rev = "<%- halRev %>", default-features = false, features = [<%- halFeatures %>] }
<% } -%>
<% if (embassy) { -%>
embassy-executor = { version = "0.10.0", features = ["platform-spin", "executor-thread"] }
embassy-time = { version = "0.5.1" }
<% } -%>
qingke-rt = "0.8.4"
# unsafe-trust-wch-atomics：WCH 内核无完整 CAS 实现，需信任其原子指令
qingke = { version = "0.8.4", features = ["unsafe-trust-wch-atomics"] }
embedded-hal = "1.0.0"
panic-halt = "1.0.0"

[profile.dev]
opt-level = 's'

[profile.release]
strip = false
codegen-units = 1
debug = 2
debug-assertions = false
incremental = false
lto = 'fat'
opt-level = 's'
overflow-checks = false
`

export const RUST_TOOLCHAIN_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[toolchain]
<% if (nightly) { -%>
# tier-3 目标（rv32ec）：需 nightly + rust-src + build-std
channel = "nightly"
components = ["rust-src"]
<% } else { -%>
channel = "stable"
targets = ["<%- target %>"]
<% } -%>
`

export const CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[build]
<% if (jsonTarget) { -%>
target = "<%- jsonTargetFile %>"
<% } else { -%>
target = "<%- target %>"
<% } -%>

[target."<%- target %>"]
runner = "wlink -v flash --enable-sdi-print --watch-serial"

<% if (jsonTarget) { -%>
[unstable]
build-std = ["core"]
json-target-spec = true
<% } -%>
`

export const BUILD_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// memory.x 由 ch32-hal 的 memory-x feature（metapac 自动渲染）提供，此处只需注入链接参数。
fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlink.x");
}
`

// 构建产物（target/ 由 cargo 生成，不入库）
export const GITIGNORE_TPL = `target/
`

// 照抄 reference/ch32-hal-template/riscv32ec-unknown-none-elf.json（JSON 不能带注释）
export const TARGET_RISCV32EC_TPL = `{
  "abi": "ilp32e",
  "arch": "riscv32",
  "atomic-cas": false,
  "cpu": "generic-rv32",
  "crt-objects-fallback": "false",
  "data-layout": "e-m:e-p:32:32-i64:64-n32-S32",
  "eh-frame-header": false,
  "emit-debug-gdb-scripts": false,
  "features": "+e,+c,+forced-atomics,+xwchc",
  "linker": "rust-lld",
  "linker-flavor": "gnu-lld",
  "llvm-target": "riscv32",
  "llvm-abiname": "ilp32e",
  "max-atomic-width": 32,
  "panic-strategy": "abort",
  "relocation-model": "static",
  "target-pointer-width": 32
}
`

export const README_TPL = `# <%- projectName %>

由 ch32-rs-CubeMX 生成的 Rust 工程：芯片 <%- chip %>（<%- chipPackage %>，target \`<%- target %>\`），基于 [ch32-hal](https://github.com/ch32-rs/ch32-hal)（rev \`<%- halRev %>\`）。

## 文件清单

<% files.forEach(function(f){ -%>
- \`<%- f.path %>\`：<%- f.desc %>
<% }) -%>
<% if (vendorHal) { -%>
- \`vendor/ch32-hal/\`：完整 HAL 源码（path 依赖），由导出层从内嵌资产写入
<% } -%>

## 配置回读（cube.json）

工程根目录的 \`cube.json\` 是本工程的配置快照（等价于 STM32CubeMX 的 \`.ioc\`）：在 ch32-rs-CubeMX 的 Home 页点击「导入工程配置」，或直接把文件拖入窗口，即可在此基础上继续编辑引脚/时钟/外设并重新导出。

## 构建

\`\`\`bash
cargo build --release
\`\`\`

目标 triple 已由 \`.cargo/config.toml\` 指定，无需额外 \`--target\` 参数。
<% if (nightly) { -%>
rv32ec 是 tier-3 目标：首次构建会经 \`rust-toolchain.toml\` 自动安装 nightly 并用 build-std 编译 core。
<% } -%>

## 烧录与串口

\`\`\`bash
# 方式一：cargo run（走 .cargo/config.toml 里的 runner）
cargo run --release

# 方式二：直接调用 wlink
wlink -v flash --enable-sdi-print --watch-serial target/<%- target %>/release/<%- packageName %>
\`\`\`

\`--enable-sdi-print\` 开启单线调试打印；代码里调用 \`hal::debug::SDIPrint::enable()\` 后即可用 \`hal::println!\` 输出，串口输出由 \`--watch-serial\` 转发。
<% if (embassy) { -%>

## 异步运行时

本工程启用 embassy：入口为 \`#[embassy_executor::main(entry = "qingke_rt::entry")]\`，时基由 \`time-driver-tim2\` 提供（\`embassy_time::Timer\`）。
<% } -%>

## 用户代码约定（重要）

- \`src/generated/**\` 是**生成区**：每次重新导出整体重写，请勿在其中写业务代码；
- \`src/main.rs\` 是**用户区**：只在首次导出时创建，之后重新导出**永不覆盖**，可放心修改；
- 用户代码**不受目录位置限制**：可自由新增任意 Rust 模块（例如 \`src/app/\`、\`src/board/\`），在 \`src/main.rs\` 中用 \`mod app;\` 等自行声明即可；生成器只重写 \`src/generated/**\`，不会触碰这些文件；
- 需要新的引脚/外设配置时，回到 ch32-rs-CubeMX 修改后重新导出，用户代码原样保留。
<% if (vendorHal) { -%>

## vendor/ch32-hal（内嵌 HAL 源码）

本工程通过 path 依赖引用 \`vendor/ch32-hal\`：完整 HAL 源码就在工程内，可直接跳转/阅读实现，无需联网即可构建。

升级方法：用对应 rev 的完整源码替换 \`vendor/ch32-hal\` 目录，并同步本工程记录的 HAL rev（见文首与 \`cube.json\` 的 \`hal.rev\`）；也可在 ch32-rs-CubeMX 中升级 HAL 版本后重新导出。
<% } -%>
`

// ---------- src/main.rs（用户区，仅首次生成） ----------

export const MAIN_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
#![no_std]
#![no_main]

use {ch32_hal as hal, panic_halt as _};

mod generated;

<% if (embassy) { -%>
#[embassy_executor::main(entry = "qingke_rt::entry")]
async fn main(_spawner: embassy_executor::Spawner) -> ! {
<% } else { -%>
#[qingke_rt::entry]
fn main() -> ! {
<% } -%>
<% if (debugPrint) { -%>
    hal::debug::SDIPrint::enable();
<% } -%>
    let mut config = hal::Config::default();
<% if (clockUsed) { -%>
    config.rcc = generated::clock::rcc_config();
<% } -%>
    let p = hal::init(config);

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    loop {
        // TODO: 你的逻辑
<% if (embassy) { -%>
        embassy_time::Timer::after_millis(1000).await; // 异步延时示例，可删
<% } -%>
    }
}
`

// ---------- src/generated/* ----------

export const MOD_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% modules.forEach(function(m){ -%>
pub mod <%- m %>;
<% }) -%>

<% if (irqs.length > 0) { -%>
// embassy 中断绑定（异步 USART/I2C 构造需要）
hal::bind_interrupts! {
    struct Irqs {
<% irqs.forEach(function(i){ -%>
        <%- i.irq %> => <%- i.handler %>;
<% }) -%>
    }
}

<% } -%>
/// 全部生成模块的聚合对象：main.rs 只需要拿这一个值
pub struct Generated {
<% fields.forEach(function(f){ -%>
    pub <%- f.name %>: <%- f.type %>,
<% }) -%>
}

pub fn init(p: hal::Peripherals) -> Generated {
<% if (inits.length === 0) { -%>
    let _ = p;
<% } -%>
    Generated {
<% inits.forEach(function(c){ -%>
        <%- c.field %>: <%- c.call %>,
<% }) -%>
    }
}
`

export const CLOCK_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// SYSCLK=<%- sysclk %> HCLK=<%- hclk %> PCLK1=<%- pclk1 %> PCLK2=<%- pclk2 %>

use ch32_hal as hal;

/// 时钟树推导出的 RCC 配置
pub fn rcc_config() -> hal::rcc::Config {
<% if (presetConst) { -%>
    // 命中 HAL 预设常量：<%- presetLabel %>
    <%- presetConst %>
<% } else { -%>
    // 无匹配预设：按 Config 字段显式构造（Config 为 non_exhaustive 思路一致：default 后逐字段赋值）
    let mut cfg = hal::rcc::Config::default();
<% assignments.forEach(function(a){ -%>
    <%- a %>
<% }) -%>
    cfg
<% } -%>
}
`

export const PINS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
<% if (pins.length > 0) { -%>

use ch32_hal as hal;
use hal::gpio::{<%- useList %>};

/// 已配置的 GPIO 引脚集合（INPUT/OUTPUT 模式；AF/ANALOG 引脚归各外设模块管理）
pub struct Pins<'d> {
<% pins.forEach(function(p){ -%>
    /// <%- p.pin %>（<%- p.comment %>）
    pub <%- p.ident %>: <%- p.kind %><'d>,
<% }) -%>
}

/// 逐引脚传入 hal::Peripherals 的引脚单例，返回 'static 借用期的引脚集合
pub fn init(<%- params %>) -> Pins<'static> {
    Pins {
<% pins.forEach(function(p){ -%>
        <%- p.ident %>: <%- p.expr %>,
<% }) -%>
    }
}
<% } else { -%>
/// 当前工程未配置 GPIO 引脚
pub struct Pins {}

pub fn init() -> Pins {
    Pins {}
}
<% } -%>
`

export const EXTI_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

/// EXTI 输入集合。
/// 注意：边沿不在构造函数里，由 wait_for_* 系列 async 方法在运行期设置（需 embassy）。
pub struct Exti {
<% items.forEach(function(e){ -%>
    // 边沿: <%- e.edge %>（<%- e.waitFn %> 时生效）
    pub <%- e.ident %>: hal::exti::ExtiInput<'static>,
<% }) -%>
}

pub fn init(<%- params %>) -> Exti {
    Exti {
<% items.forEach(function(e){ -%>
        <%- e.ident %>: hal::exti::ExtiInput::new(<%- e.pinParam %>, <%- e.chParam %>, hal::gpio::Pull::<%- e.pull %>),
<% }) -%>
    }
}
`

export const USART_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(u){ -%>
/// <%- u.id %> 驱动类型（<%- u.remapDesc %>）
pub type <%- u.typeName %> = hal::usart::Uart<'static, hal::peripherals::<%- u.id %>, hal::mode::<%- u.modeType %>>;

/// 初始化 <%- u.id %>（<%- u.paramDesc %>）
pub fn <%- u.initFn %>(<%- u.params %>) -> <%- u.typeName %> {
    let mut cfg = hal::usart::Config::default();
<% u.cfgLines.forEach(function(l){ -%>
    <%- l %>
<% }) -%>
<% if (u.asyncMode) { -%>
    // rx 在前、tx 在后；异步需中断绑定（super::Irqs）与 TX/RX DMA 通道
    hal::usart::Uart::new<%- u.remapSyntax %>(peri, rx, tx, irqs, tx_dma, rx_dma, cfg).unwrap()
<% } else { -%>
    // 注意参数顺序：rx 在前、tx 在后；返回 Result，用 unwrap 解包
    hal::usart::Uart::new_blocking<%- u.remapSyntax %>(peri, rx, tx, cfg).unwrap()
<% } -%>
}
<% }) -%>
`

export const SPI_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(s){ -%>
/// <%- s.id %> 驱动类型（<%- s.remapDesc %>）
pub type <%- s.typeName %> = hal::spi::Spi<'static, hal::peripherals::<%- s.id %>, hal::mode::<%- s.modeType %>>;

/// 初始化 <%- s.id %>（<%- s.paramDesc %>）
pub fn <%- s.initFn %>(<%- s.params %>) -> <%- s.typeName %> {
    let mut cfg = hal::spi::Config::default();
<% s.cfgLines.forEach(function(l){ -%>
    <%- l %>
<% }) -%>
<% if (s.asyncMode) { -%>
    // 签名已核对 ch32-hal src/spi.rs：非 v4x7 家族的异步构造无中断绑定参数（仅 TX/RX DMA）
    hal::spi::Spi::new<%- s.remapSyntax %>(peri, sck, mosi, miso, tx_dma, rx_dma, cfg)
<% } else { -%>
    // 阻塞构造直接返回 Self（无 Result）
    hal::spi::Spi::new_blocking<%- s.remapSyntax %>(peri, sck, mosi, miso, cfg)
<% } -%>
}
<% }) -%>
`

export const I2C_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(i){ -%>
/// <%- i.id %> 驱动类型（<%- i.remapDesc %>）
pub type <%- i.typeName %> = hal::i2c::I2c<'static, hal::peripherals::<%- i.id %>, hal::mode::<%- i.modeType %>>;

/// 初始化 <%- i.id %>（<%- i.paramDesc %>）
pub fn <%- i.initFn %>(<%- i.params %>) -> <%- i.typeName %> {
    let mut cfg = hal::i2c::Config::default();
<% i.cfgLines.forEach(function(l){ -%>
    <%- l %>
<% }) -%>
<% if (i.asyncMode) { -%>
    // 异步需双中断绑定（<%- i.id %>_EV/<%- i.id %>_ER，见 super::Irqs）与 TX/RX DMA 通道
    hal::i2c::I2c::new<%- i.remapSyntax %>(peri, scl, sda, irqs, tx_dma, rx_dma, hal::time::Hertz::hz(<%- i.freq %>), cfg)
<% } else { -%>
    // 阻塞构造直接返回 Self（无 Result）
    hal::i2c::I2c::new_blocking<%- i.remapSyntax %>(peri, scl, sda, hal::time::Hertz::hz(<%- i.freq %>), cfg)
<% } -%>
}
<% }) -%>
`

export const ADC_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(a){ -%>
/// <%- a.id %>：ADC 通道是引脚的 trait 实现（非整数索引），每个使用的通道一个引脚字段
pub struct <%- a.typeName %> {
    pub adc: hal::adc::Adc<'static, hal::peripherals::<%- a.id %>>,
<% a.channels.forEach(function(c){ -%>
    /// <%- c.pin %>（<%- c.channel %>）
    pub <%- c.field %>: hal::Peri<'static, hal::peripherals::<%- c.pin %>>,
<% }) -%>
}

pub fn <%- a.initFn %>(<%- a.params %>) -> <%- a.typeName %> {
<% if (adcApi === 'v4x7') { -%>
    // H4/V4x7：Adc::new 返回 Result（时钟不可用/过快时失败）
    let adc = hal::adc::Adc::new(adc_peri, Default::default()).unwrap();
<% } else { -%>
    let adc = hal::adc::Adc::new(adc_peri, Default::default());
<% } -%>
    <%- a.typeName %> {
        adc,
<% a.channels.forEach(function(c){ -%>
        <%- c.field %>: <%- c.param %>,
<% }) -%>
    }
}
<% if (a.channels.length > 0) { -%>

// 读取示例（按需复制到用户代码区）：
<% a.channels.forEach(function(c){ -%>
<% if (adcApi === 'v4x7') { -%>
// let v = g.<%- a.fieldName %>.adc.blocking_read(&mut g.<%- a.fieldName %>.<%- c.field %>, hal::adc::SampleTime::<%- a.sampleTime %>).unwrap();
<% } else { -%>
// let v = g.<%- a.fieldName %>.adc.convert(&mut g.<%- a.fieldName %>.<%- c.field %>, hal::adc::SampleTime::<%- a.sampleTime %>);
<% } -%>
<% }) -%>
<% } -%>
<% }) -%>
`

// ---------- 双核 workspace（骨架来源：reference/ch32-hal-template/h417-dual） ----------

// 双核两个核各用一份自定义 target json：riscv32imafc（V3F，+xwchc）与 riscv32imafbc（V5F，+b +xwchc）。
export const TARGET_RISCV32IMAFC_TPL = `{
  "abi": "ilp32f",
  "arch": "riscv32",
  "atomic-cas": true,
  "cpu": "generic-rv32",
  "crt-objects-fallback": "false",
  "data-layout": "e-m:e-p:32:32-i64:64-n32-S128",
  "eh-frame-header": false,
  "emit-debug-gdb-scripts": false,
  "features": "+m,+a,+f,+c,+xwchc",
  "linker": "rust-lld",
  "linker-flavor": "gnu-lld",
  "llvm-abiname": "ilp32f",
  "llvm-target": "riscv32",
  "max-atomic-width": 32,
  "panic-strategy": "abort",
  "relocation-model": "static",
  "target-pointer-width": 32
}
`

export const TARGET_RISCV32IMAFCB_TPL = `{
  "abi": "ilp32f",
  "arch": "riscv32",
  "atomic-cas": true,
  "cpu": "generic-rv32",
  "crt-objects-fallback": "false",
  "data-layout": "e-m:e-p:32:32-i64:64-n32-S128",
  "eh-frame-header": false,
  "emit-debug-gdb-scripts": false,
  "features": "+m,+a,+f,+c,+b,+xwchc",
  "linker": "rust-lld",
  "linker-flavor": "gnu-lld",
  "llvm-abiname": "ilp32f",
  "llvm-target": "riscv32",
  "max-atomic-width": 32,
  "panic-strategy": "abort",
  "relocation-model": "static",
  "target-pointer-width": 32
}
`

export const DUAL_ROOT_CARGO_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[workspace]
members = [<%- members %>]
resolver = "2"

[workspace.dependencies]
# 双核共用同一份 HAL；每个核在自己的 Cargo.toml 里追加各自的 ch32-hal feature
ch32-hal = { <%- halDependency %> }

[profile.dev]
opt-level = "s"

[profile.release]
strip = false
codegen-units = 1
debug = 2
debug-assertions = false
incremental = false
lto = "fat"
opt-level = "s"
overflow-checks = false
`

export const DUAL_RUST_TOOLCHAIN_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
# 双核两套自定义 target json（+xwchc / +b）需要 nightly + rust-src + build-std=core
[toolchain]
channel = "nightly"
components = ["rust-src", "llvm-tools-preview"]
`

export const DUAL_CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
# 工程根只放 xtask 别名；每个核的 target/runner 在 <核>/.cargo/config.toml 中
[alias]
xtask = "run --package xtask --release --"
`

export const CORE_CARGO_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[package]
name = "<%- coreName %>"
version = "0.1.0"
edition = "2024"

[[bin]]
name = "<%- coreName %>"
path = "src/main.rs"
harness = false

[dependencies]
ch32-hal = { workspace = true, features = [<%- halFeatures %>] }
qingke-rt = { version = "0.8.4", features = [<%- rtFeatures %>] }
qingke = { version = "0.8.4", features = [<%- qingkeFeatures %>] }
<% if (mainCore) { -%>
embedded-hal = "1.0.0"
<% } -%>
panic-halt = "1.0.0"
`

export const CORE_BUILD_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
<% if (mainCore) { -%>
// 启动核（V3F）：随 crate 提供 memory.x 与 link.x。
// memory.x 覆盖 metapac 的 memory-x 版本（其中没有 qingke-rt link.x 需要的 RAM 区）；
// link.x 覆盖 qingke-rt 的版本，让整个程序从零等待共享 SRAM 执行（hart0 无 I-cache）。
fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlink.x");

    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("memory.x"), include_bytes!("memory.x")).unwrap();
    std::fs::write(out_dir.join("link.x"), include_bytes!("link.x")).unwrap();
    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rerun-if-changed=memory.x");
    println!("cargo:rerun-if-changed=link.x");
}
<% } else { -%>
// 从核（V5F）：只提供自己的 memory.x（FLASH/DTCM/共享 SRAM 分区）。
// device.x 由 metapac 的 rt feature 提供，此处不得遮蔽它。
fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlink.x");

    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("memory.x"), include_bytes!("memory.x")).unwrap();
    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rerun-if-changed=memory.x");
}
<% } -%>
`

export const CORE_CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[build]
target = "<%- target %>.json"

[unstable]
build-std = ["core"]
json-target-spec = true

[target."<%- target %>"]
runner = "wlink -v flash"
`

// CH32H417 双核分区（与 reference/ch32-hal-template/h417-dual 一致）：
// V3F flash 0x00000000+64K / V5F flash 0x00010000+896K；共享 SRAM 0x20178000+32K 作邮箱。
export const H417_V3F_MEMORY_X = `/*
 * CH32H417QEU6（QingKe V3F / 启动核）链接内存布局。
 *
 *   0x00000000 +  64K  V3F flash 加载槽
 *   0x00010000 + ...   V5F flash（单核模式下不使用）
 *   0x20100000 + 448K  零等待代码/数据/bss（V3F 经 highcode 从这里运行）
 *   0x20170000 +  32K  零等待栈
 *   0x20178000 +  32K  跨核邮箱区
 *
 * 覆盖 ch32-metapac 生成的 memory.x：后者没有 qingke-rt link.x 需要的 `+"`RAM`"+` 区。
 */
MEMORY
{
    CODE   (rx)  : ORIGIN = 0x00000000, LENGTH =  64K
    USR    (rwx) : ORIGIN = 0x08000000, LENGTH =  64K
    SYS    (rwx) : ORIGIN = 0x1FFF0000, LENGTH =   56K
    VND    (r)   : ORIGIN = 0x1FFFF700, LENGTH =   256
    OPT    (rw)  : ORIGIN = 0x1FFFF800, LENGTH =   256
    RAM    (rwx) : ORIGIN = 0x20100000, LENGTH = 448K
    STACK  (rwx) : ORIGIN = 0x20170000, LENGTH =  32K
    ITCM   (rwx) : ORIGIN = 0x200A0000, LENGTH = 128K
    SRAM_SHARED (rwx) : ORIGIN = 0x20178000, LENGTH = 32K
}

REGION_ALIAS("FLASH", CODE);
REGION_ALIAS("REGION_TEXT", CODE);
REGION_ALIAS("REGION_RODATA", CODE);
REGION_ALIAS("REGION_DATA", RAM);
REGION_ALIAS("REGION_BSS", RAM);
REGION_ALIAS("REGION_HEAP", RAM);
REGION_ALIAS("REGION_STACK", STACK);
`

export const H417_V3F_LINK_X = `/*
 * V3F 启动核链接脚本：整个程序在零等待共享 SRAM 中运行。
 *
 * 取自 qingke-rt 的 link-highcode.x，唯一差异是 .text/.rodata 折进 .highcode：
 * hart0 没有指令 cache，从 Code FLASH 取指约 2.6 MIPS，而从共享 SRAM 执行约 1 IPC。
 * 留在 flash 的只有拷贝建立前就要运行的 .init 与 .handle_reset。
 */
INCLUDE memory.x
INCLUDE device.x

PROVIDE(_stext = ORIGIN(REGION_TEXT));
PROVIDE(_stack_start = ORIGIN(REGION_STACK) + LENGTH(REGION_STACK));
PROVIDE(_max_hart_id = 0);
PROVIDE(_hart_stack_size = 2K);
PROVIDE(_heap_size = 0);

/* 异常处理 */
PROVIDE(InstructionMisaligned = ExceptionHandler);
PROVIDE(InstructionFault = ExceptionHandler);
PROVIDE(IllegalInstruction = ExceptionHandler);
PROVIDE(Breakpoint = ExceptionHandler);
PROVIDE(LoadMisaligned = ExceptionHandler);
PROVIDE(LoadFault = ExceptionHandler);
PROVIDE(StoreMisaligned = ExceptionHandler);
PROVIDE(StoreFault = ExceptionHandler);
PROVIDE(UserEnvCall = ExceptionHandler);
PROVIDE(MachineEnvCall = ExceptionHandler);

/* 内核中断 */
PROVIDE(NonMaskableInt = DefaultHandler);
PROVIDE(SysTick = DefaultHandler);
PROVIDE(Software = DefaultHandler);

PROVIDE(Exception = _exception_handler);

PROVIDE(DefaultHandler = DefaultInterruptHandler);
PROVIDE(ExceptionHandler = DefaultExceptionHandler);

EXTERN(__CORE_INTERRUPTS);
EXTERN(__EXTERNAL_INTERRUPTS);

ENTRY(_start)

SECTIONS
{
    .init :
    {
        . = ALIGN(4);
        KEEP(*(SORT_NONE(.init)))
        . = ALIGN(4);
    } >FLASH AT>FLASH

    /* 启动时从 flash 拷到 RAM，之后在 RAM 执行 */
    .highcode : ALIGN(4)
    {
        _highcode_lma = LOADADDR(.highcode);
        PROVIDE(_highcode_vma_start = .);
        LONG(_start);
        KEEP(*(.vector_table.core_interrupts));
        KEEP(*(.vector_table.external_interrupts));
        KEEP(*(.vector_table.exceptions));
        *(.trap .trap.rust)
        *(.highcode);
        *(.highcode.*);
        *(.text .text.*)
        *(.gnu.linkonce.t.*)
        *(.rodata .rodata.*);
        *(.srodata .srodata.*);
        . = ALIGN(4);
        PROVIDE(_highcode_vma_end = .);
    } >RAM AT>FLASH

    /* 拷贝建立前运行的代码，留在 flash */
    .text : ALIGN(4)
    {
        . = ALIGN(4);
        KEEP(*(SORT_NONE(.handle_reset)))
        *(.init.rust)
    } >FLASH AT>FLASH

    .data : ALIGN(4)
    {
        _data_lma = LOADADDR(.data);
        PROVIDE(_data_vma = .);
        PROVIDE( __global_pointer$ = . + 0x800 );
        *(.sdata .sdata.* .sdata2 .sdata2.*);
        *(.data .data.*);
        . = ALIGN(4);
        PROVIDE( _edata = .);
    } >RAM AT>FLASH

    .bss (NOLOAD) : ALIGN(4)
    {
        PROVIDE( _sbss = .);
        *(.sbss .sbss.* .bss .bss.*);
        PROVIDE( _ebss = .);
    } >RAM

    .uninit (NOLOAD) : ALIGN(4)
    {
        *(.uninit .uninit.*);
    } >RAM

    . = ALIGN(4);

    PROVIDE(__sheap = .);
    PROVIDE(_stack_end = .);

    .got (INFO) :
    {
        KEEP(*(.got .got.*));
    }

    .eh_frame (INFO) : { KEEP(*(.eh_frame)) }
    .eh_frame_hdr (INFO) : { *(.eh_frame_hdr) }
}

INCLUDE assert-align.x
`

export const H417_V5F_MEMORY_X = `/*
 * CH32H417QEU6（QingKe V5F / 从核）链接内存布局。
 *
 * 与 WCH CSDK 的双核分区一致，两个镜像在 flash 上首尾相接：
 *   V3F : flash 0x00000000 + 64K，RAM = ITCM
 *   V5F : flash 0x00010000 + ...，RAM = DTCM
 *   两者: RAM_SHARED 0x20178000 + 32K 跨核邮箱
 *
 * FLASH ORIGIN 同时是唤醒入口：V3F 把它传给 qingke::pfic::wake_other_core()。
 * DTCM 前 512 字节留给 QingKe V5 的硬件压栈区（与 CSDK 一致）。
 */
MEMORY
{
    FLASH : ORIGIN = 0x00010000, LENGTH = 960K - 64K
    RAM   : ORIGIN = 0x200C0200, LENGTH = 256K - 512
    SRAM_SHARED (rwx) : ORIGIN = 0x20178000, LENGTH = 32K
}

REGION_ALIAS("REGION_TEXT", FLASH);
REGION_ALIAS("REGION_RODATA", FLASH);
REGION_ALIAS("REGION_DATA", RAM);
REGION_ALIAS("REGION_BSS", RAM);
REGION_ALIAS("REGION_HEAP", RAM);
REGION_ALIAS("REGION_STACK", RAM);
`

export const DUAL_V3F_MAIN_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
// 启动核（V3F）：reset 只启动本核；RCC/GPIO/EXTI 等共享外设由这里初始化，
// 随后唤醒 hart 1 上的 V5F 镜像。
#![no_std]
#![no_main]

use {ch32_hal as hal, panic_halt as _};

mod generated;

/// 必须与 v5f/memory.x 的 FLASH ORIGIN 一致（1KB 对齐）
const V5F_ENTRY: u32 = 0x0001_0000;

#[qingke_rt::entry]
fn main() -> ! {
<% if (debugPrint) { -%>
    hal::debug::SDIPrint::enable();
<% } -%>
    let mut config = hal::Config::default();
<% if (clockUsed) { -%>
    config.rcc = generated::clock::rcc_config();
<% } -%>
    let p = hal::init(config);

    // 唤醒 V5F（hart 1）到它自己的 flash 入口
    unsafe { qingke::pfic::wake_other_core(V5F_ENTRY) };

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    loop {
        // TODO: 你的逻辑（V3F 控制核）
        hal::delay::Delay.delay_ms(1000);
    }
}
`

export const DUAL_V5F_MAIN_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
// 从核（V5F）：由 V3F 的 wake_other_core() 唤醒。共享 RCC/GPIO 已由 V3F 初始化，
// 这里绝不能再调用 hal::init（会重配共享 PLL）。
#![no_std]
#![no_main]

use panic_halt as _;

mod generated;

#[qingke_rt::entry]
fn main() -> ! {
<% if (clockUsed) { -%>
    // 引用生成的时钟配置（只读构建，不应用）；V5F 的实际时钟来自共享 RCC
    let _shared_rcc = generated::clock::rcc_config();
<% } -%>
    let _g = generated::init();
    loop {
        // TODO: 你的逻辑（V5F 计算核）
        core::hint::spin_loop();
    }
}
`

export const V5F_GENERATED_MOD_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// V5F 从核骨架：当前数据模型只提供一份（V3F 侧的）引脚/外设配置，
// 因此从核只生成时钟快照与空 init；RCC/GPIO 由启动核统一初始化。

<% if (clockUsed) { -%>
pub mod clock;
<% } -%>

/// V5F 侧聚合对象（暂无外设字段）
pub struct Generated {}

pub fn init() -> Generated {
    Generated {}
}
`

export const XTASK_CARGO_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[package]
name = "xtask"
version = "0.0.0"
edition = "2021"
publish = false
`

export const XTASK_MAIN_TPL = `//! 双核工程构建 / 烧录 / 合并驱动（由 ch32-rs-CubeMX 生成）。
//!
//!
//! cargo xtask build                 构建两个核
//! cargo xtask flash [--no-build]    先烧 V3F（halt），最后烧 V5F 并复位运行
//! cargo xtask merge [--out DIR]     合并两个镜像为 .bin/.hex
//!
//!
//! reset 只启动 V3F；V5F 由 V3F 镜像调用 qingke::pfic::wake_other_core() 唤醒。

use std::path::{Path, PathBuf};
use std::process::{exit, Command};
use std::{env, fs};

/// 擦除态字节，用于填充合并镜像
const ERASED: u8 = 0xFF;

struct Core {
    /// crate 目录名（同时也是 Cargo 包名后缀）
    name: &'static str,
    target: &'static str,
    /// bin 目标名（= Cargo 包名）
    bin: &'static str,
    flash_base: u64,
    flash_limit: u64,
}

const CORES: [Core; <%- cores.length %>] = [
<% cores.forEach(function(c){ -%>
    Core {
        name: "<%- c.id %>",
        target: "<%- c.target %>",
        bin: "<%- c.bin %>",
        flash_base: <%- c.flashBase %>,
        flash_limit: <%- c.flashLimit %>,
    },
<% }) -%>
];

const USAGE: &str = "\\
usage: cargo xtask <command> [options]

commands:
  build                       构建两个核（release）
  flash [--no-build]          构建后依次烧录 V3F、V5F
  merge [--out DIR]           合并镜像到 out/<bin>.bin 与 .hex

WLINK_PROBE=VID:PID:SERIAL（或 wlink 索引）可固定探针。
";

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some((command, rest)) = args.split_first() else {
        fail(USAGE);
    };

    let opts = Options::parse(rest);
    match command.as_str() {
        "build" => build(&opts),
        "flash" => flash(&opts),
        "merge" => merge(&opts),
        "help" | "--help" | "-h" => println!("{USAGE}"),
        other => fail(&format!("unknown command '{other}'\\n\\n{USAGE}")),
    }
}

struct Options {
    no_build: bool,
    out: Option<PathBuf>,
}

impl Options {
    fn parse(args: &[String]) -> Options {
        let mut opts = Options { no_build: false, out: None };
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--out" => opts.out = args.next().map(PathBuf::from),
                "--no-build" => opts.no_build = true,
                other => fail(&format!("unknown option '{other}'\\n\\n{USAGE}")),
            }
        }
        opts
    }
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask 位于工程根下一层")
        .to_path_buf()
}

fn elf_path(core: &Core) -> PathBuf {
    // workspace 成员共用根 target/ 目录
    root()
        .join("target")
        .join(core.target)
        .join("release")
        .join(core.bin)
}

fn wlink_selector_args() -> Vec<String> {
    match env::var("WLINK_PROBE").or_else(|_| env::var("PROBE_RS_PROBE")) {
        Ok(selector) if !selector.is_empty() => vec!["-d".to_string(), selector],
        _ => Vec::new(),
    }
}

fn run(program: &str, args: &[&str], dir: &Path) {
    println!("  {} {}", program, args.join(" "));
    let status = Command::new(program)
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap_or_else(|e| fail(&format!("无法运行 '{program}'：{e}")));
    if !status.success() {
        fail(&format!("'{program}' 失败：{status}"));
    }
}

fn run_wlink(args: &[&str], dir: &Path) {
    let selector = wlink_selector_args();
    let mut all: Vec<&str> = selector.iter().map(String::as_str).collect();
    all.extend_from_slice(args);
    run("wlink", &all, dir);
}

fn build(_opts: &Options) {
    for core in &CORES {
        let dir = root().join(core.name);
        println!("构建 {}（{}）...", core.name, core.bin);
        run("cargo", &["build", "--release", "--bin", core.bin], &dir);
    }
    println!("构建完成：{} 个核", CORES.len());
}

fn flash(opts: &Options) {
    if !opts.no_build {
        build(opts);
    }
    // 先烧 V3F（--no-run 保持芯片 halt），最后烧 V5F 时复位运行；此时两个镜像都已就位。
    for (i, core) in CORES.iter().enumerate() {
        let elf = elf_path(core);
        let path = elf.to_str().expect("utf-8 path");
        println!("烧录 {}（{}）...", core.name, core.bin);
        if i + 1 == CORES.len() {
            run_wlink(&["flash", path], &root());
        } else {
            run_wlink(&["flash", "--no-run", path], &root());
        }
    }
}

struct Segment {
    core: &'static str,
    base: u64,
    bytes: Vec<u8>,
}

fn merge(opts: &Options) {
    let segments: Vec<Segment> = CORES
        .iter()
        .map(|core| Segment {
            core: core.name,
            base: core.flash_base,
            bytes: flatten(&elf_path(core), core),
        })
        .collect();

    let end = segments
        .iter()
        .map(|s| s.base + s.bytes.len() as u64)
        .max()
        .expect("至少一个段");
    let mut image = vec![ERASED; end as usize];
    for segment in &segments {
        let at = segment.base as usize;
        image[at..at + segment.bytes.len()].copy_from_slice(&segment.bytes);
    }

    let out_dir = opts.out.clone().unwrap_or_else(|| root().join("out"));
    fs::create_dir_all(&out_dir)
        .unwrap_or_else(|e| fail(&format!("无法创建 {}：{e}", out_dir.display())));
    let bin = out_dir.join("firmware.bin");
    let hex = out_dir.join("firmware.hex");
    fs::write(&bin, &image)
        .unwrap_or_else(|e| fail(&format!("无法写入 {}：{e}", bin.display())));
    fs::write(&hex, intel_hex(&segments))
        .unwrap_or_else(|e| fail(&format!("无法写入 {}：{e}", hex.display())));

    for segment in &segments {
        println!(
            "  {:<4} {:#010x}  {:>7} bytes",
            segment.core,
            segment.base,
            segment.bytes.len()
        );
    }
    println!("合并镜像：{}（{} bytes）", bin.display(), image.len());
    println!("Intel HEX：{}", hex.display());
}

fn flatten(elf: &Path, core: &Core) -> Vec<u8> {
    if !elf.exists() {
        fail(&format!("{} 未构建，先运行 'cargo xtask build'", elf.display()));
    }
    let tmp = env::temp_dir().join(format!("h417-{}-{}.bin", core.name, std::process::id()));
    let objcopy = objcopy();
    run(
        &objcopy,
        &[
            "-O",
            "binary",
            "--gap-fill",
            "0xFF",
            elf.to_str().unwrap(),
            tmp.to_str().unwrap(),
        ],
        &root(),
    );
    let bytes =
        fs::read(&tmp).unwrap_or_else(|e| fail(&format!("无法读取 {}：{e}", tmp.display())));
    let _ = fs::remove_file(&tmp);

    if bytes.len() as u64 > core.flash_limit {
        fail(&format!(
            "{}：{} bytes 超过其 {} bytes flash 区，会与另一个镜像重叠",
            core.name,
            bytes.len(),
            core.flash_limit
        ));
    }
    bytes
}

fn objcopy() -> String {
    tool("llvm-objcopy")
}

fn tool(name: &str) -> String {
    let output = |args: &[&str]| {
        Command::new("rustc")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    if let (Some(sysroot), Some(host)) = (output(&["--print", "sysroot"]), output(&["-vV"])) {
        let host = host
            .lines()
            .find_map(|line| line.strip_prefix("host: ").map(str::to_string));
        if let Some(host) = host {
            let path = Path::new(&sysroot)
                .join("lib/rustlib")
                .join(host)
                .join("bin")
                .join(name);
            if path.exists() {
                return path.to_string_lossy().into_owned();
            }
        }
    }
    name.to_string()
}

fn intel_hex(segments: &[Segment]) -> String {
    let mut hex = String::new();
    let mut upper = u32::MAX;
    for segment in segments {
        for (i, chunk) in segment.bytes.chunks(16).enumerate() {
            let address = segment.base as u32 + (i * 16) as u32;
            if address >> 16 != upper {
                upper = address >> 16;
                hex.push_str(&record(0x04, 0, &[(upper >> 8) as u8, upper as u8]));
            }
            hex.push_str(&record(0x00, (address & 0xFFFF) as u16, chunk));
        }
    }
    hex.push_str(":00000001FF\\n");
    hex
}

fn record(record_type: u8, address: u16, data: &[u8]) -> String {
    let mut bytes = vec![data.len() as u8, (address >> 8) as u8, address as u8, record_type];
    bytes.extend_from_slice(data);
    let sum = bytes.iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
    let checksum = (!sum).wrapping_add(1);

    let mut line = format!(":{bytes:02X?}");
    line.retain(|c| !matches!(c, '[' | ']' | ' ' | ','));
    format!("{line}{checksum:02X}\\n")
}

fn fail(message: &str) -> ! {
    eprintln!("xtask: {message}");
    exit(1);
}
`

export const DUAL_README_TPL = `# <%- projectName %>（<%- chip %> 双核工程）

由 ch32-rs-CubeMX 生成：芯片 <%- chip %>（<%- chipPackage %>），QingKe <%- coreSummary %>。
工程是 Cargo workspace，V3F 启动核与 V5F 计算核各一个 crate，另有 \`xtask\` 负责双核构建/烧录/合并。

## 文件清单

<% files.forEach(function(f){ -%>
- \`<%- f.path %>\`：<%- f.desc %>
<% }) -%>
<% if (vendorHal) { -%>
- \`vendor/ch32-hal/\`：完整 HAL 源码（path 依赖），由导出层从内嵌资产写入工程根
<% } -%>

## 双核分工

| 核 | 目录 | ch32-hal feature | target | 职责 |
|---|---|---|---|---|
<% cores.forEach(function(c){ -%>
| <%- c.label %> | \`<%- c.id %>/\` | \`<%- c.halFeature %>\` | \`<%- c.target %>\` | <%- c.mainCore ? '启动核：RCC/GPIO/外设初始化，唤醒 V5F' : '从核：等待 V3F 唤醒，只跑自己的逻辑' %> |
<% }) -%>

- reset 只启动 V3F；V3F 在 \`main.rs\` 里调用 \`qingke::pfic::wake_other_core(0x0001_0000)\` 唤醒 V5F。
- **共享外设（RCC/GPIO/AFIO/EXTI）只能在 V3F 初始化**：V5F 的 \`main.rs\` 不调用 \`hal::init\`。
- 两核通过共享 SRAM \`0x20178000\`（32K）做邮箱；flash 分区见两个 \`memory.x\`。

## 构建

双核各自使用自定义 target json，工具链固定为 nightly（\`rust-toolchain.toml\`，含 rust-src）：

\`\`\`bash
cargo xtask build
\`\`\`

等价于在两个核目录分别执行 \`cargo build --release\`；根目录直接 \`cargo build\` 不会套用各核的
\`.cargo/config.toml\`，请不要用根构建代替 xtask。

## 烧录

需要安装 [wlink](https://github.com/ch32-rs/wlink)：

\`\`\`bash
cargo install --git https://github.com/ch32-rs/wlink
cargo xtask flash
\`\`\`

xtask 先烧 V3F（\`--no-run\` 保持 halt），最后烧 V5F 时复位运行，保证两个镜像同时就位。
可用 \`WLINK_PROBE=VID:PID:SERIAL\` 固定探针。

## 合并镜像

\`\`\`bash
cargo xtask merge          # 输出 out/firmware.bin / out/firmware.hex
\`\`\`

## 时钟

<%- clockSummary %>

时钟代码生成走 HAL 配方（\`hal::rcc::Config::with_*\`）：H4 的 Config 不是可逐字段拼装的平铺结构，
数据层标记 \`fallback: preset_only\`，无匹配预设时导出会被阻止。

## 配置回读与用户代码

- 工程根 \`cube.json\` 是本工程的配置快照（等价于 STM32CubeMX 的 \`.ioc\`），可拖回 ch32-rs-CubeMX 继续编辑；
- \`<核>/src/generated/**\` 是生成区：每次重新导出整体重写，请勿写业务代码；
- \`<核>/src/main.rs\` 是用户区：**永不覆盖**，可自由修改；需要新外设时回到工具重新导出。
<% if (vendorHal) { -%>

## vendor/ch32-hal

两个核都通过 workspace 依赖 \`ch32-hal = { path = "vendor/ch32-hal" }\` 引用同一份 HAL 源码。
升级时用对应 rev 的完整源码替换该目录，并同步 \`cube.json\` 的 \`hal.rev\`。
<% } -%>
`
