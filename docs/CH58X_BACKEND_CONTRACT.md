# M11 CH58x 后端契约（子智能体施工依据）

> 真相源：`/home/teze/CH32/CubeMX/reference/ch58x-hal` @ `611954e40cc4a562f0c4756ab4c0a935af6158df`（ch58x-hal 0.0.2）。
> 本文所有 API 均经源码逐字核实（4 份调研报告，2026-11-17）。**禁止生成本文未列出的 HAL API。**
> 仓库：`/home/teze/CH32/CubeMX/ch32-rs-cubemx`。分层规则见 docs/ARCHITECTURE.md（model 不依赖上层）。
>
> **M11 集成修正（2026-11-17，以 rustc 1.98.1 实测为准）**：D6/D7/D8 原写的 `Config { …, ..Default::default() }`
> 对 `#[non_exhaustive]` 结构体在定义 crate 外是 **E0639**（禁止结构体字面量含 FRU）。SPI/I2C/ADC Config 一律用
> HAL 官方 examples 模式：`let mut config = Xxx::Config::default(); config.field = …;`。UART Config 非
> non_exhaustive，可完整字面量构造。另：debugPrint 等 warning 不进 CodegenResult.errors（导出层对 errors
> 任意条目阻断），由 featureWarnings() 渲染进 README/HTML 报告。
>
> **D15（集成期新增，真实编译阻塞修复）**：CH582M 编译 target 为 **riscv32imc-unknown-none-elf**（不含 A），
> 不是硬件实际的 IMAC。原因：WCH QingKe LR/SC 原子指令缺陷（ch32-rs/qingke#9、ch32-hal#59，embassy executor
> 错误状态，critical-section 回退后消失）；qingke 0.5.0 对 `target_has_atomic` target 强制 `compile_error!`。
> imc → 无原子标记 → embassy-sync 走 critical-section 回退（上游认可修复）。**禁止** `unsafe-trust-wch-atomics`；
> `-C target-feature=-a` 实测无效（rustc spec 静态）。数据层 chip.json.target 一处驱动全链路；README 模板含说明。
>
> **D16（集成期新增，第二个真实链接阻塞）**：HAL 非可选依赖 `embassy-time-queue-utils 0.1.0` 无条件依赖
> embassy-executor 0.7，默认 integrated queue 引用 `embassy_executor::raw::wake_task` → 链接需应用提供
> `__pender` 符号（embassy 档由 `#[embassy_executor::main]` 宏提供；blocking 档没有）。修复：blocking 档
> Cargo.toml 直依赖 `embassy-time-queue-utils = { version = "0.1.0", features = ["generic-queue-8"] }`
> （cargo feature 统一 → `_generic-queue` → queue_generic 不引用 executor 符号，src/lib.rs:6-13 cfg 核实）。
> embassy 档保持默认 integrated queue。上游 HAL 的非 embassy examples 同样缺 __pender（其仓库当前状态不可编译，与 D15 一致）。

## 0. 已预建的挂载点（控制器已完成，勿重复修改）

- `src/model/types/chip.ts`：`ChipPin.halUnsupported?: string`（HAL 未实现该引脚驱动能力的原因文本）。
- `src/model/types/conflict.ts`：新增冲突码 `HAL_PIN_UNSUPPORTED`。
- `src/model/codegen/halRev.ts`：`CH58X_HAL_REV = '611954e40cc4a562f0c4756ab4c0a935af6158df'`、`CH58X_HAL_GIT`。
- `src/model/codegen/index.ts`：`generateProject` 已按 `data.chip.halBackend` 分流 → `generateCh58xProject(config, data, sel)`（`./ch58x`）。
- `src/model/codegen/ch58x/index.ts`：占位 stub（返回 error），**A 用完整管线替换**。

## 1. 后端总体设计（决策 D1–D14）

- **D1 分流**：ch58x 后端是 `src/model/codegen/ch58x/` 独立模块树，产出与 ch32 相同的 `CodegenResult`（`GeneratedFile[]` + `withFileGroups`）。复用 backend-agnostic 模块：`cubefile.ts`（renderCubeFile）、`htmlReport.ts`、`fileGroup.ts`、`manifest.ts`、`util.ts`（sanitizePackageName/labelToIdent/identWithPrefix/pinIdent）、`render.ts`（EJS client:true）。**不得修改 ch32 管线任何文件的行为**（index.ts 分流出外）。
- **D2 运行时两档**：blocking（`#[qingke_rt::entry]`，stable 工具链）与 embassy（`#[embassy_executor::main(entry = "qingke_rt::entry")]`，nightly + `#![feature(impl_trait_in_assoc_type)]`）。**两档 HAL features 都是 `default-features = false, features = ["embassy"]`**——ch58x-hal 的 gpio.rs 无条件 use embassy_sync，关掉 embassy feature 编译不过（src/gpio.rs:14）；embassy feature 同时是 BLE 之外唯一合法组合。BLE 本期不生成（不启用 ble feature，不链接 LIBCH58xBLE.a）。
- **D3 时钟**：只支持 PLL 源（480MHz 固定 VCO ÷ div）。预设匹配 → `config.clock.use_pll_XXmhz()`（6 档：60/80/48/32/24/20）；非预设 → 显式 `config.clock.mux = hal::sysctl::ClockSrc::PLL(<div>);`（pub enum，sysctl.rs:34-43）。source ≠ PLL → error `CLOCK_PRESET_UNAVAILABLE`（HSE 直连 32MHz 需 div=1，HAL assert 拒绝；CK32K 未建模）。div 合法 2..=31（5 位寄存器，32 截断为 0，HAL 注释与实现不一致——数据层已改）。`enable_lse()` 本期不生成（无 LSE UI 建模，默认 LSI；README 说明）。
- **D4 GPIO**：OUTPUT → `Output::new(p.PXX, Level::{Low,High}, OutputDrive::{_5mA,_20mA})`；INPUT → `Input::new(p.PXX, Pull::{None,Up,Down})`。**speed→驱动电流约定**：`HIGH → _20mA`，其余 → `_5mA`（注释标明是 UI 约定映射，HAL 无 Speed 枚举）。**OpenDrain → error**（`TARGET_FEATURE_UNSUPPORTED`，HAL 无开漏）。**AF 模式引脚不生成 GPIO 代码**（ch58x 无通用 AF API，复用由外设构造器内部完成）。ANALOG 引脚 → 保留裸引脚单例字段供 `adc.read(&mut pin)`。RESERVED → 跳过。PB17 由 `halUnsupported` 数据 + 通用冲突规则拦截（B 实现），后端不重复检查。
- **D5 UART**：`Uart::new::<REMAP>(p.UARTx, p.TX, p.RX, config).unwrap()`（顺序 peri→tx→rx；REMAP 是 const 泛型 bool：remap 0→`::<false>`，1→`::<true>`）。Config 四字段逐字：`baudrate: u32, data_bits: DataBits::DataBitsN, stop_bits: StopBits::STOPN, parity: Parity::ParityXxx`（uart.rs:43-58，非 non_exhaustive，可完整构造）。TX/RX 缺任一 → error（沿用 ch32 规则语义）。**仅阻塞**，无 async/DMA。
- **D6 SPI**：仅 SPI0。`Spi::new::<REMAP>(p.SPI0, p.SCK, p.MOSI, p.MISO, config)`；缺 MISO → `new_txonly`（sck, mosi）；缺 MOSI → `new_rxonly`（sck, miso）；SCK 必须有。Config **non_exhaustive** → `hal::spi::Config { clock_polarity: Polarity::IdleLow/IdleHigh, bit_order: BitOrder::MsbFirst/LsbFirst, frequency: <Hz>.Hz(), ..Default::default() }`（Polarity 来自 `embedded_hal_02::spi`，HAL re-export；用 `hal::spi::Polarity` 若存在否则从 embedded-hal-02 引——**核实 src/spi.rs:8 的 re-export 再定**）。无 Phase（只 MODE_0/3 语义）。**NSS/CS 不由 HAL 消费**：若分配了 SPI0_NSS → 生成独立 `Output`（初始 High，注释「软件 CS，HAL 不管理」）。
- **D7 I2C**：单实例 `I2c::new::<REMAP>(p.I2C, p.SCL, p.SDA, config)`。Config non_exhaustive → `hal::i2c::Config { frequency: <Hz>.Hz(), duty: Duty::Duty2_1/Duty16_9, ..Default::default() }`（sda_pullup/scl_pullup 默认 false，不建模）。7-bit 地址（README 说明，HAL 内部左移）。
- **D8 ADC**：`Adc::new(p.ADC, hal::adc::Config { clk: SamplingClock::_3_2MHz/_5_33MHz/_4MHz/_8MHz, pga_gain: Gain::GAIN1_4/GAIN1_2/GAIN1/GAIN2, ..Default::default() })`（non_exhaustive）。14 外部通道 ch0-13（数据层已录）。ANALOG 引脚生成裸单例字段（如 `pub adc_in0: peripherals::PA4`），注释示例 `g.adc.read(&mut g.adc_in0)`。**不生成 Vbat**（enable_vbat 空操作且与温度共用 ch15）；Temperature 本期不建模（数据层无内部通道）。
- **D9 中断/DMA/Timer/PWM**：一律不生成（HAL 无 bind_interrupts、无 DMA 驱动、timer.rs 仅 10 行无驱动）。ch582m exti.json 为空、dma.json 为空，数据层天然不产生这些配置；若 config 携带 irq 配置 → 忽略 + README 说明。
- **D10 debugPrint**：ch58x 本期不支持 → **warning**（`TARGET_FEATURE_UNSUPPORTED`，level warning，message 说明忽略）并不生成相关代码。不得报 error（verify-build 默认 debugPrint:true）。
- **D11 IDE 配置**：ch58x **不生成 launch.json / gdbserver 任务**（ch32rv/wlink 0.1.3 不支持 CH58x，HAL_API_NOTES §12.6 已核实）。tasks.json 仅两项：`构建` = `cargo build --release`；`烧录 (wchisp)` = `wchisp flash target/riscv32imac-unknown-none-elf/release/<package>`（wchisp 0.3.0 本机已装，CH58x 走 USB ISP）。README 说明调试需 WCH MRS（未开源接入）。
- **D12 骨架**：edition **2021**（qingke-rt-macros 0.5 发裸 `#[export_name]`，2024 需 unsafe 包裹）；**无 build.rs**（link-arg 走 .cargo/config.toml rustflags）；**无 memory.x**（HAL build.rs 提供 448K/32K）；**无 target json**（标准 rustup target）；`[[bin]] harness = false`；`[profile.release] panic="abort", opt-level="z", lto=true, codegen-units=1`（与 HAL 一致）+ `[profile.release-debug] inherits="release", debug=2, strip=false`（预留）。直接依赖：`ch58x-hal`（path vendor/ch58x-hal 或 git+rev）、`qingke-rt = { version = "0.5.0", features = ["highcode"] }`（HAL 不 re-export entry，必须直依赖；**禁止 0.8.x**）、`panic-halt = "0.2.0"`；embassy 档追加 `embassy-executor = { version = "0.7.0", features = ["nightly","arch-riscv32","executor-thread"] }`、`embassy-time = "0.4.0"`。
- **D13 vendor**：`sel.vendorHal`（默认 true）→ path 依赖 `vendor/ch58x-hal`；false → git + CH58X_HAL_REV。浏览器 zip 资产 `public/vendor/ch58x-hal.zip`（B 产出，zip 内前缀 `ch58x-hal/`）。导出服务按 halBackend 选 zip（C）。
- **D14 生成区结构**（与 ch32 同构，main.rs 用户区永不覆盖）：
  ```
  src/main.rs                 # 用户区：hal::init(generated::clock::config()) → generated::init(p)
  src/generated/mod.rs        # pub struct Generated + pub fn init(p: Peripherals) -> Generated
  src/generated/clock.rs      # pub fn config() -> hal::Config
  src/generated/pins.rs       # OUTPUT/INPUT 驱动字段（AF 不在此）
  src/generated/usart.rs      # 按需
  src/generated/spi.rs        # 按需
  src/generated/i2c.rs        # 按需
  src/generated/adc.rs        # 按需（Adc + 裸通道引脚字段）
  ```
  引脚字段名走现有 `identWithPrefix/pinIdent/labelToIdent` 约定（读 ch32 pins.ts 对齐）。Generated 字段生命周期 `'static`（owned 单例 into_ref）。

## 2. 黄金参照（逐字来自 HAL examples，生成骨架的基准）

blocking（examples/blinky.rs）：
```rust
#![no_std]
#![no_main]
use embedded_hal_1::delay::DelayNs;
use hal::delay::CycleDelay;
use hal::gpio::{Level, Output, OutputDrive};
use {ch58x_hal as hal, panic_halt as _};

#[qingke_rt::entry]
fn main() -> ! {
    let mut config = hal::Config::default();
    config.clock.use_pll_60mhz().enable_lse();
    let p = hal::init(config);
    let mut delay = CycleDelay;
    let mut led = Output::new(p.PB18, Level::Low, OutputDrive::_5mA);
    loop { led.toggle(); delay.delay_ms(1000); }
}
```
embassy（examples/embassy-blinky.rs:54-59）：
```rust
#![feature(impl_trait_in_assoc_type)]
#[embassy_executor::main(entry = "qingke_rt::entry")]
async fn main(spawner: Spawner) -> ! {
    let mut config = hal::Config::default();
    config.clock.use_pll_60mhz();
    let p = hal::init(config);
    hal::embassy::init();   // 必须在 hal::init 之后、任何 Timer/spawn 之前
    ...
}
```
关键事实：`hal::init(Config)` 内部完成时钟 freeze + Peripherals::take（lib.rs:135-167）；`hal::Config { clock: sysctl::Config, low_power: bool, enable_dcdc: bool }`；`hal::delay_ms(u16)`；`CycleDelay` 实现 eh1 DelayNs；embassy 档 async 仅 GPIO wait + Timer（UART/SPI/I2C/ADC 全阻塞，无 embedded_hal_async impl）。

## 3. 引脚/外设映射（已在数据层，生成时直接消费）

- UART0: TX PB7/RX PB4 (remap0), TX PA14/RX PA15 (remap1)；UART1: PA9/PA8, PB13/PB12；UART2: PA7/PA6, PB23/PB22；UART3: PA5/PA4, PB21/PB20。
- SPI0: SCK PA13/MOSI PA14/MISO PA15/NSS PA12 (remap0)；PB13/PB14/PB15/PB12 (remap1)。
- I2C: SCL PB13/SDA PB12 (remap0)；PB21/PB20 (remap1)。
- ADC：PA4=IN0 PA5=IN1 PA12=IN2 PA13=IN3 PA14=IN4 PA15=IN5 PA3=IN6 PA2=IN7 PA1=IN8 PA0=IN9 PA6=IN10 PA7=IN11 PA8=IN12 PA9=IN13。
- 跨外设复用冲突（PB12/13 = SPI0 remap1 + I2C remap0 + UART1 remap1 等）由现有 checkConflicts 处理。
- PB17：物理存在但 HAL 无 Pin impl → chip.json 标 `halUnsupported`（B）。PB23 标 nrst（默认锁定，解锁可用——HAL 示例确实用作 GPIO）。

## 4. 文件域（排他，越界即集成冲突）

### A — ch58x codegen 后端（最大域）
- `src/model/codegen/ch58x/**`（index/derive/cargo/pins/usart/spi/i2c/adc/clock/readme + templates/ 子目录，EJS 模板字符串文件风格对齐 ch32 templates/）
- `tests/ch58xCodegen.test.ts`（新文件，目标 ≥40 用例：blocking/embassy 骨架、6 预设映射、显式 PLL(div)、非 PLL 源 error、PB17 经 checkConflicts 拦截、OpenDrain error、debugPrint warning、UART/SPI/I2C/ADC 初始化逐字、NSS 软件 CS、txonly/rxonly、vendor/git 切换、fileGroup 归类、cube.json 回读、selection 开关）
- 可读：ch32 管线全部文件（只读参照）、reference/ch58x-hal 源码。
- **不改**：ch32 管线、types、data、services、scripts、components。

### B — 数据修正 + 冲突规则 + vendor + verify
- `data/devices/ch582m/clock.json`：增 `20MHZ_PLL` 预设（480÷24）+ presetConstMap `config.clock.use_pll_20mhz()`；div options 去掉 32（2..31）；notes 同步（⑦改为已接入）。
- `data/devices/ch582m/chip.json`：PB17 加 `"halUnsupported": "ch58x-hal 未实现 PB17 的 Pin trait（peripherals 有声明但 gpio.rs 无 impl），无法生成 GPIO/外设代码"`。
- `src/model/conflicts/rules/pinRules.ts`：通用规则——引脚带 `halUnsupported` 且存在任何 assignment → error `HAL_PIN_UNSUPPORTED`（message 引用原因文本，pins 归属）。注册位置沿用现有规则链。
- `scripts/build-hal58x-vendor.mjs`（新，仿 build-hal-vendor.mjs，源 `../reference/ch58x-hal`，zip 前缀 `ch58x-hal/`，排除 .git/target）+ `package.json` 增 `"vendor:hal58x"` script + **运行产出 public/vendor/ch58x-hal.zip**。
- `scripts/verify-build-entry.ts`：ch58x 分支——CH58X_HAL_DIR env（默认 ../reference/ch58x-hal）；Cargo.toml git→path 替换正则适配 ch58x-hal；vendor 复制分支识别 `path = "vendor/ch58x-hal"`。ch32 路径行为逐字不变。
- `scripts/verify-build.mjs`：默认 chips 改 `CH32V003F4P6,CH32V203C8T6,CH582M`；CH58X_HAL_DIR 透传（存在即设 env）。
- `scripts/validate-device-data.mjs`：若校验器对 div options/预设有断言需适配（先读再改，保持 ch32 芯片校验不变）。
- 测试：`tests/halUnsupportedPin.test.ts`（新）+ clock 预设相关断言扩展（优先新文件 tests/ch58xData.test.ts，避免改共享测试文件；若 deviceData.test.ts 有 CH582M 预设数断言则授权更新）。
- **不改**：codegen/（A 域）、services/components（C 域）、types（控制器已建）。

### C — 导出服务 + 芯片选择器 + UI 标注
- `src/services/projectExport.ts`：prepareProject 按 `data.chip.halBackend` 选 vendor zip（ch58x-hal → `vendor/ch58x-hal.zip`，错误提示 `npm run vendor:hal58x`）；抽纯函数 `backendVendorZip(backend?: string): string` 导出供测试。其余导出逻辑不动。
- `src/components/home/ChipPicker.vue`：`SUPPORTED_HAL_BACKEND` → `SUPPORTED_HAL_BACKENDS = ['ch32-hal', 'ch58x-hal']`（保留旧常量名导出兼容或同步更新引用），`chipGenerationSupported` 改 includes；徽标文案如有硬编码同步。
- `tests/chipPicker.test.ts`：**授权更新** CH582M supported 相关断言（现在 supported=true）。
- `tests/exportBackend.test.ts`（新：backendVendorZip 纯函数）。
- UI 小标注（数据驱动，读 halBackend）：`src/views/ProjectSettingsView.vue` Runtime 节——ch58x 时显示「embassy 档：GPIO 异步等待 + Timer；UART/SPI/I2C/ADC 仍为阻塞（ch58x-hal 无异步外设驱动）」；`useGenerationFlow.ts` GENERATION_ITEMS 若硬编码 ch32-hal 文案则改后端感知。HomeView/向导无需改（创建链路已通）。
- **不改**：codegen/、data/、scripts/、conflicts/。

## 5. 门禁（集成后控制器统一跑）

1. `npx vue-tsc --noEmit` 0 错；`npx vitest run` 全绿（现有 986 + 新增）；`npm run lint` 0 错（分层边界）。
2. `npm run validate:device` 4 芯片 0 错 0 警。
3. `npm run build` 通过。
4. `npm run verify:build`（V003/V203/CH582M）+ `--chip CH32H417QEU6`：**CH582M 必须真实 cargo build 通过**（首次拉取 ch58x PAC 0.4.0 / qingke 0.5.x，代理自适应已在脚本内）。embassy 档另跑 `--chip CH582M --embassy`（需 nightly target：`rustup target add riscv32imac-unknown-none-elf --toolchain nightly`，控制器执行）。
5. 浏览器验收：CH582M 创建向导 → 配 GPIO/UART/SPI/I2C/ADC/时钟 → Project settings 生成 → 预览文件逐字核对 → 导出 ZIP 含 vendor/ch58x-hal。
6. ch32 三芯片生成物**逐字节不变**（差分快照，控制器跑）。

## 6. 诚实标注义务

- README 模板必须含：ch58x-hal 上游警示「DO NOT USE in production」（上游 README 原话）、BLE 未生成、调试需 MRS、烧录走 wchisp（WCH-Link 开源工具不支持 CH58x）、embassy 档异步能力边界。
- 不得宣称 HAL 有：async UART/SPI/I2C/ADC、DMA、Timer/PWM 驱动、SPI1、OpenDrain、Speed、通用 AF、PB17 GPIO、Vbat 采样、I2C transaction（todo!()）。
- 完成后 HAL_API_NOTES §13 由控制器汇总（A 在交付报告里列「生成物 ↔ HAL 源码行号」对照表）。