# M17 CH582 迁移 ch5xx-hal + BLE shim 移植契约

> 立项 2026-11-19：上游 ch58x-hal#13 维护者指引转向活跃开发的 ch32-rs/ch5xx-hal；侦察证实 ch5xx-hal 为重写且 **BLE Not implemented**。用户裁决：把 ch58x 的 BLE 模块移植给 ch5xx（自建 shim crate），CH582 默认切 ch5xx-hal，ch58x-hal 保留 legacy opt-in。
> 真相源：`../reference/ch5xx-hal` @ **875651b693ef437e045d023171adaf052a07525c**（tarball 解包，非 git 树）；ch5xx-metapac 锁 **680e2e12**；旧 BLE 源 `../reference/ch58x-hal/src/ble/` @ 611954e（MIT/Apache-2.0 (c) Andelf）。
> 前置：CH58X_BACKEND_CONTRACT / CH58X_BLE_CONTRACT（legacy 路径继续有效）。

## D1 分流与 legacy

- 后端 id：`ch5xx-hal`（新默认，CH582M）、`ch58x-hal`（legacy）、`ch32-hal`（不变）。
- `data/devices/ch582m/chip.json`：`halBackend: "ch5xx-hal"`；新增 `legacyHalBackend: "ch58x-hal"`。
- 项目级覆盖：`ProjectConfig.halBackend?: string`（cube.json 往返；缺省=chip.halBackend）。设置页 Runtime 区增「HAL 后端」select（仅当 chip 有 legacyHalBackend 时显示）；BLE 开启且选 ch5xx → 走 shim（合法）；BLE + legacy → 旧路径。
- `SUPPORTED_HAL_BACKENDS` += 'ch5xx-hal'；`codegen/index.ts` 三分流；`projectExport.backendVendorZip`：ch5xx-hal → `ch5xx-hal.zip` + `ch5xx-ble.zip`（BLE 档才内嵌 shim zip；非 BLE 不嵌）。
- 旧工程兼容：cube.json 无 halBackend 字段的历史 CH582 工程 → **导入时默认 legacy ch58x-hal**（保 main.rs 手写代码不破坏）；新建工程默认 ch5xx-hal。导入判定：cube.json 存在但缺 halBackend 且 chip=ch582m → legacy（诚实迁移注记入 README/发布说明）。

## D2 cargo / feature / 工具链 / build.rs 矩阵（ch5xx 档）

依赖（vendor 模式）：
```toml
ch5xx-hal = { path = "vendor/ch5xx-hal", default-features = false, features = [<档>] }
ch5xx-ble = { path = "vendor/ch5xx-ble" }          # 仅 BLE 档
qingke-rt = { version = "0.8.4", features = ["highcode"] }   # rt 已由 hal ch582 feature 带入；显式写保 entry 宏
panic-halt = "1.0"
```
- blocking 档 features：`["ch582", "rt", "memory-x"]`
- embassy 档 features：`["ch582", "rt", "memory-x", "embassy", "time-driver-tmr0"]` + deps `embassy-executor 0.10`(features platform-riscv32/executor-thread/portable-atomic)、`embassy-time 0.5.1`(tick-hz-1_000_000)、`portable-atomic 1.11`(critical-section) + **[patch.crates-io] embassy git rev 4e2fa2e3ae7c9fd62a32193f47af12f68df3df7d**（executor/executor-timer-queue/sync/time/time-driver/time-queue-utils/usb/usb-driver，逐字照抄 examples/ch582/Cargo.toml）
- BLE 档 features：`["ch582", "rt", "memory-x"]`（**不启 hal embassy/time-driver**，busy-poll）+ deps `embassy-sync = "0.8"`（crates.io，shim pubsub 同版本统一）、`critical-section = "1.2"`、`portable-atomic 1.11`(critical-section)；shim 自带 embassy-sync 0.8。
- 工具链：**nightly + rust-src**（examples/ch582 `.cargo/config.toml` 用 `[unstable] build-std=["core"]`；S1 实测 stable 是否可行，若可行降 stable 并更新本条）；`.cargo/config.toml`：target riscv32imac-unknown-none-elf + `[unstable] build-std=["core"]` + rustflags `-C link-arg=-Tlink.x`（或 build.rs 发 link-arg，二选一照 examples：**build.rs 发 `cargo:rustc-link-arg-bins=-Tlink.x`**，config 不放 link-arg）。
- **生成 build.rs**（ch58x 档没有；ch5xx HAL 不写 memory.x/link.x）：`fn main(){ println!("cargo:rustc-link-arg-bins=-Tlink.x"); }`；memory.x 由 `memory-x` feature 经 metapac 提供。
- git 模式（selection.vendorHal=false）：ch5xx-hal git rev 875651b6…；shim 仍 path（shim 是我方 crate，无 git 上游）。

## D3 shim crate `ch5xx-ble`（vendor-src/ch5xx-ble/，导出内嵌 vendor/ch5xx-ble）

派生作品声明：src/ble 包装层源自 ch32-rs/ch58x-hal @611954e（MIT/Apache-2.0 (c) 2023 Andelf，随附 LICENSE-MIT/LICENSE-APACHE）；vendor/LIBCH58xBLE.a、libISP583.a 为 WCH 预编译 blob（来源 ch58x-hal vendor/，随附来源注记 README）。
Cargo：`ch5xx-hal { path/git 同 rev, default-features=false }`、`ch5xx-metapac { git, rev 680e2e12, features=["rt"] }`、`embassy-sync 0.8`；build.rs 链 vendor/*.a（link search + `cargo:rustc-link-lib=static=CH58xBLE`/`ISP583`，照旧 ch58x build.rs 逐字核对名字）。
公开 API（冻结形，bleRs.ts 只改 import 与委托）：
- `pub mod ffi/gap/gatt/gatt_uuid/gattservapp/linkdb`（旧源逐字移植，PAC 无关）
- `pub struct MacAddress` / `from_raw/from_msb/Display`、`pub fn lib_version() -> &'static str`
- `pub unsafe extern "C" fn temperature_raw() -> u16`：metapac `pac::ADC.tem_sensor()/channel()/cfg()` + `pac::SYS.tkey_cfg()` 保存恢复 + ch5xx `adc::Adc::new(unsafe Peri::steal(), Config{gain:Unity, sample_clock:Divide3})` + `enable_temperature()` + `blocking_read`（Result unwrap→raw；照旧语义恢复寄存器）
- `pub unsafe extern "C" fn srand() -> u32`：`pac::SYSTICK.cnt().read()`（metapac 风格，S1 核读法）
- `pub fn systick_hz() -> u32`：读 `pac::SYSTICK.ctlr().read().stclk()` → sysclk 或 sysclk/8（**notify/pacing 周期唯一真相**，取代旧 hclk/8 硬假设）
- `pub fn enable_lse()` / `pub fn set_clock32k_lsi()`：metapac 32K 域寄存器序列**逐字照抄旧 ch58x sysctl.rs enable_lse / clock32ksrc 路径**（ch5xx rcc 不提供 32K API；#14 修复面固化于此）
- `pub struct Config { pub mac_lsb: [u8;6], pub sel_rtc_clock: u8, pub rc_cb: Option<unsafe extern "C" fn()> }`
- `pub fn init(cfg: Config) -> Result<(u8, EventSubscriber), NonZeroU8>`：BLE_HEAP 6KB + bleConfig_t（BufMaxLen 27/BufNumber 5/TxNumEvent 1/TxPower LL_TX_POWEER_6_DBM/ConnectNumber (1&3)|(3<<2)/srandCB=srand/tsCB=temperature_raw/rcCB=cfg.rc_cb/SelRTCClock=cfg.sel_rtc_clock/MacAddr）→ BLE_LibInit → TMOS_TimerInit(null) → TMOS_ProcessEventRegister(hal_tmos_task) → tmos_start_task(REG_INIT 0x2000, 120s ticks)。**不触碰 SysTick ctlr**（hal::init 已自由跑 HCLK；srand 只取熵）。
- `pub type EventSubscriber` / `pub struct TmosEvent`（pubsub 4/2/2，Drop deallocate，照旧）
- 日志钩子：`pub fn set_default_serial(uart: hal::uart::UartTx<'static, hal::peripherals::UART1, hal::mode::Blocking>)` + `#[macro_export] macro_rules! println`（core::fmt::Write writeln 到静态 Option；未设置时 no-op）——ch5xx 无 hal::println/set_default_serial。
- PA 控制本期不移植（PaConfig=None 路径；注记诚实边界）。

## D4 外设模板 API 逐字（ch5xx 档，reference/ch5xx-hal 行号见侦察笔记）

- 顶层：`use ch5xx_hal as hal;` `let p = hal::init(hal::Config { rcc: generated::clock::config() });`（clock.rs 返回 `hal::rcc::Config`）；embassy 档 main 用 `#[embassy_executor::main(entry = "qingke_rt::entry")]`，**无 hal::embassy::init**（hal::init 内部自动）。
- clock.rs：预设命中 → `hal::rcc::presets::PLL_60MHZ` 等（CH582 xtal480 可用：HSE_16/8/6_4/4/2MHZ、PLL_80/60/48/32/24MHZ；**无 20MHZ 预设**→20MHz 走显式 `Config::new(Osc::Hse32, Sys::Pll(24))`）；显式 → `hal::rcc::Config::new(hal::rcc::Osc::Hse32, hal::rcc::Sys::Pll(div))`；BLE lse → 生成 `ch5xx_ble::enable_lse();`（在 hal::init **后**调用？旧序：init 前 config.clock.enable_lse；ch5xx 无 config 32K → shim enable_lse 须在 hal::init 后、BLE init 前；S1 实测寄存器序安全性）。
- pins.rs：`hal::gpio::{Output, Input, Level, Pull, Speed}`；`Output::new(p.PAx, Level::Low, Speed::Low|High)`、`Input::new(p.PAx, Pull::None|Up|Down)`；字段类型 `Output<'static, hal::peripherals::PAx>`；**模拟引脚不建 Input/Output**，Peri 留给 ADC。
- usart.rs：`hal::uart::{Uart, Config, DataBits, StopBits, Parity}`；`Config { baudrate, data_bits: DataBits::DataBits8, parity: Parity::None, stop_bits: StopBits::Stop1 }`；`Uart::new_blocking::<REMAP u8>(p.UARTn, rx, tx, config).unwrap()`（**先 rx 后 tx**）；日志/单发 `UartTx::new_blocking::<0>(p.UART1, p.PA9, Config::new(115200))`。
- spi.rs：`hal::spi::{Spi, Config, BitOrder}` + `embedded_hal::spi::{MODE_0, MODE_3}`（dep embedded-hal 1.0）；`Config { frequency: hal::time::Hertz(n), mode: MODE_0|MODE_3, bit_order }`；`Spi::new_blocking::<REMAP>(p.SPI0, sck, mosi, miso, config).unwrap()`；NSS 软件片选照旧 gpio Output（或 hal::spi::chip_select，选 gpio 照旧减差异）。
- i2c.rs：`hal::i2c::{I2c, Config, Duty}`；`Config { frequency: Hertz(n), duty: Duty::Ratio2to1|Ratio16to9 }`；`I2c::new_blocking::<REMAP>(p.I2C0, scl, sda, config).unwrap()`；**无上拉字段**。
- adc.rs：`hal::adc::{Adc, Config, Gain, SampleClock}`；`Config { gain: Gain::Div4|Div2|Unity|X2, sample_clock: SampleClock::Divide1|Divide2|Divide3|Divide4 }`（CH582 语义：Divide1=3.2M/Divide2=8M/Divide3=5.33M/Divide4=4M，**与旧枚举判别值同序**：旧 _3_2MHz=0→Divide1、_8MHz=1→Divide2、_5_33MHz=2→Divide3、_4MHz=3→Divide4）；`Adc::new(p.ADC, config)`；读 `adc.blocking_read(&mut ch).unwrap()`，**通道=GPIO 单例 Peri**（p.PA4=ch0…p.PA9=ch13，照 adc.rs impl_channel 表）；read_as_millivolts 不存在 → 生成换算注释或删该行（照旧 UI 期望：保留 raw + 注释公式）。
- 时间类型：`hal::time::Hertz(n)`（**无 .Hz()/U32Ext**）。

## D5 derive 校验（ch5xx 档新增生成期错误，诚实防 runtime panic）

- PLL div ∉ 6..=32 → error（HAL assert；旧 2..5 档在 ch5xx 非法）；Fsys ∉ 15..80MHz（PLL）/ 2..10 或 15..80（Divided）→ error。
- UART：DL=round(Fsys/(8*baud))，DL==0/>65535 或 |actual-baud|*100>baud*2 → error `BAUDRATE_UNREPRESENTABLE`（新 ConflictCode）。
- SPI：mode 1/2 → error `SPI_MODE_UNSUPPORTED`；freq==0/>Fsys/2/div>255 → error `SPI_FREQUENCY_UNREPRESENTABLE`；半双工 txonly/rxonly → error `SPI_HALFDUPLEX_UNSUPPORTED`。
- I2C：Fsys ∉ 2..=36MHz → error `I2C_CLOCK_OUT_OF_RANGE`；freq>400k → 既有警告升级 error（HAL Err）。
- 以上 code 入 types/conflict.ts + App/TabStrip/preflight 注册（照 CLOCK_DISPLAY_ONLY_SOURCE 先例）。
- peripheral.ts（时钟页派生频率/警告）ch5xx 语义同步：SPI div=Fsys/freq 向下取整+>255/>Fsys/2 警告；UART DL 公式+2% 警告；I2C Fsys 范围警告；ADC 枚举映射不变（判别值同序）。

## D6 数据

- clock.json ch582m：`codegen.backends = { "ch5xx-hal": { presetConstMap: {60/80/48/32/24 → hal::rcc::presets::PLL_*}, pllDivRange: [6,32] }, "ch58x-hal": { 现 presetConstMap 逐字保留 } }`；现 `codegen.presetConstMap` 保留为 legacy 缺省（不破坏旧测试）。
- peripherals.json ch582m：ADC 通道→pin 映射核对（14 通道 pin 名与 impl_channel 表一致）；i2c 上拉参数若存在 → ch5xx 档忽略+警告（S2 核）。
- chip.json：halBackend/legacyHalBackend/nightly 按后端（`nightlyByBackend: {"ch5xx-hal": true, "ch58x-hal": false}`，verify-build toolchainOf 消费）。

## D7 验证矩阵

- verify:build：CH582 ch5xx blocking / embassy(tmr0) / --ble(ch5xx+shim) 三路 cargo build；legacy --ble --chip CH582M 仍 1/1；ch32 6/6+6/6 不变。
- 实机（BLE 测试流授权内）：ch5xx+shim peripheral 烧录 → 宿主 gatt-test.py 连接/读 FFE1/写 FFE2/notify 20 包/20s（周期用 systick_hz 派生=1s）；未过前文档标 cargo-build 级。
- 测试：ch5xxCodegen/ch5xxBleCodegen 新套件；ch58x 旧套件零 regress；chipPicker/exportBackend/codegen 分流与 cube.json halBackend 往返用例。
- 门禁：vitest/vue-tsc/eslint/validate/build；浏览器 CH582 预览含 ch5xx import/new_blocking/shim 依赖；legacy 切换回 ch58x。

## D9 实测更正（S1/S2/S3 落地后主控回填，2026-11-19）

- **预设路径**：`hal::rcc::presets::*` 不存在；实为关联常量 **`hal::rcc::Config::PLL_60MHZ`** 等（D4 照此执行）。
- **ch5xx-data 兄弟依赖**：ch5xx-hal build.rs 硬读 `../ch5xx-data/data`；纯 git checkout panic（S1 notes §9）。裁决：**ch5xx 档强制 vendor 模式**（index.ts 守卫 error TARGET_FEATURE_UNSUPPORTED）；vendor zip 内嵌 `vendor/ch5xx-data`；reference/ch5xx-data 与 vendor 快照统一 pin **42237c4d**（编译验证快照；上游 HEAD fba766c1 另核未采用）。
- **工具链裁决**：默认 **nightly + rust-src + build-std=["core"]**（自包含）。stable 1.100 实测可过但 `[unstable] build-std` 被静默忽略、依赖预装 `rust-std-riscv32imac-unknown-none-elf`——不作默认（环境不可复现）。
- **BLE vendor 档 [patch]**：shim 的 git HAL 与本工程 path HAL 会形成两份类型 → 生成 `[patch."https://github.com/ch32-rs/ch5xx-hal"] ch5xx-hal = { path = "vendor/ch5xx-hal" }`（D2 补）。
- **metapac 外设拆分**：旧 `SYS.tkey_cfg()` → **`pac::TOUCHKEY.cfg()`**（同基址同寄存器）；shim temperature_raw 错误用 `unwrap_or(0)`（回调内不 panic）；adc Config non_exhaustive → Default 后逐字段赋值。
- **ADC 通道注入**：生成 mod.rs 以 `adc_in0: p.PA4` 等字段注入 Peri，adc.rs 用 `g.adc.blocking_read(&mut g.adc_in0)`（D4 「通道=GPIO 单例」语义不变）。
- **BLE 中断使能**：生成代码额外使能 `Interrupt::BLEB/BLEL`（否则 RF 中断不进入，S1 notes §5）；BLEB=20/BLEL=21。
- **SPI mode 同源**（S3 发现错码，主控修）：`spiModeVariant(params)` 委托 `spiModeNumber(params)`（显式 mode/clockPhase 优先），校验与渲染单一真相；回归用例 tests/ch5xxCodegen.test.ts「显式 mode3+缺省极性→MODE_3」。
- **target 保留 riscv32imc**（IMAC 子集，portable-atomic/critical-section 覆盖原子；五档 cargo 实测过）；上游推荐 imac 列后续候选（需 targetByBackend + rust-std 安装裁决）。
- **I2C 单例名**：HAL 为 `I2C0`（数据层 id 仍 `I2C`），生成器 halInstance 映射。
- **COMMON 未清零风险**：WCH blob COMMON 符号排 `_ebss` 后、启动清零不覆盖（旧 qingke-rt 0.5 同存在且 legacy 实机曾工作）；待 ch5xx 实机复验裁决，必要时生成器补清零片段。
- 历史 cube.json 缺 halBackend → resolveHalBackend 回 legacy（D1 兼容规则落地于 codegen 层；projectFile.ts 不规范化写入）。

## D8 文件域（排他）

- 主控：本契约、types/conflict.ts、集成/门禁/实机/上游评论/推送。
- S1：vendor-src/ch5xx-ble/**、reference 解包核对、最小 BLE 示例 cargo build 证明（/tmp 独立目录）、shim 实测笔记（docs/m17-shim-notes.md）。
- S2：src/model/codegen/ch5xx/**、ch58x/templates/bleRs.ts（委托 shim）、codegen/index.ts、types/chip.ts、types/project.ts(cube.json)、ChipPicker.vue、ProjectSettingsView.vue、projectExport.ts、scripts/build-hal5xx-vendor.mjs、scripts/verify-build*.mjs、clock/peripheral.ts、ch58x/derive.ts 或新 ch5xx/derive.ts、data/devices/ch582m/{chip,clock,peripherals}.json。
- S3：tests/ch5xx*.test.ts、tests/{chipPicker,exportBackend,codegen}.test.ts fallout。
- S4：HAL_API_NOTES §17、ROADMAP M17、README、MEMORY、#13/#14 评论草稿。