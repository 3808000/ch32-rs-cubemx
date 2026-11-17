// 单核 README.md（ch58x 后端：工程概览 / 文件清单 / 构建烧录 / 诚实能力边界）
export const README_TPL = `# <%- projectName %>

由 ch32-rs-CubeMX 生成的 Rust 工程：芯片 <%- chip %>（<%- chipPackage %>，target \`<%- target %>\`），基于 [ch58x-hal](https://github.com/ch32-rs/ch58x-hal)（rev \`<%- halRev %>\`）。

> **上游警示（ch58x-hal README 原话）**：该 HAL “is under random and active development. **DO NOT USE in production.**” 本工程用于评估与原型；量产请自行评估风险。
>
<% if (!ble) { -%>
> 本期**不生成 BLE 代码**（不启用 \`ble\` feature，也不链接 \`LIBCH58xBLE.a\`）。
<% } else { -%>
> 本工程**启用 BLE 协议栈**（Cargo features \`["embassy", "ble"]\`，链接 \`LIBCH58xBLE.a\`）；能力边界见下方「BLE 协议栈」节。
<% } -%>

## 工程概览

| 项 | 值 |
|---|---|
| 芯片 | <%- chip %>（<%- chipPackage %>） |
| HAL 后端 | ch58x-hal @ <%- halRev %> |
| 运行时 | <%- embassy ? 'embassy（异步执行器 + Timer）' : 'blocking（阻塞）' %> |
| 工具链 | <%- embassy ? 'nightly（impl_trait_in_assoc_type）' : 'stable' %> |
| 目标 triple | <%- target %> |
| 时钟 | <%- clockSummary %> |
<% if (ble) { -%>
| BLE | 启用（\`features = ["embassy", "ble"]\`，LSE 32.768kHz 强制） |
<% } -%>
| HAL 源码 | <%- vendorHal ? 'vendor/ch58x-hal（path 依赖，可跳转阅读）' : 'git + 锁定 rev' %> |

## 文件清单

<% files.forEach(function(f){ -%>
- \`<%- f.path %>\`：<%- f.desc %>
<% }) -%>
<% if (vendorHal) { -%>
- \`vendor/ch58x-hal/\`：完整 HAL 源码（path 依赖），由导出层从内嵌资产写入
<% } -%>

## 配置回读（cube.json）

工程根目录的 \`cube.json\` 是本工程的配置快照（等价于 STM32CubeMX 的 \`.ioc\`）：在 ch32-rs-CubeMX 的 Home 页点击「导入工程配置」，或直接把文件拖入窗口，即可继续编辑引脚/时钟/外设并重新导出。

## 构建

\`\`\`bash
cargo build --release
\`\`\`

目标 triple 已由 \`.cargo/config.toml\` 指定，无需额外 \`--target\` 参数。工程**没有** \`build.rs\`、\`memory.x\` 或自定义 target json：链接参数走 \`.cargo/config.toml\` 的 \`rustflags\`（\`-Tlink.x\`），\`memory.x\`（448K Flash / 32K SRAM）由 ch58x-hal 自己的 \`build.rs\` 写入 \`OUT_DIR\` 并提供 link-search。

### 为什么 target 是 riscv32imc（不含 A 扩展）

CH582 硬件是 RV32IMAC，但本工程刻意用 **riscv32imc** 编译：WCH QingKe 的 LR/SC 原子指令有缺陷（[ch32-rs/qingke#9](https://github.com/ch32-rs/qingke/issues/9)、ch32-hal#59——embassy executor 会进入错误状态，改用 critical-section 回退后问题消失）。qingke 0.5.0 对带 \`target_has_atomic\` 的 target 直接 \`compile_error!\` 强制做出决策；imc target 无原子能力标记，embassy-sync 自动走 critical-section（关中断）回退，即上游认可的修复路径。IMC 代码生成是 IMAC 的严格子集，硬件正常执行。**不要**启用 \`unsafe-trust-wch-atomics\` feature（那等于信任已知有缺陷的原子指令）；\`-C target-feature=-a\` 无效（rustc 的 \`target_has_atomic\` 不随该 flag 改变）。
<% if (embassy) { -%>

embassy 档需要 nightly 工具链（\`rust-toolchain.toml\` 已指定）；首次构建会自动下载 \`<%- target %>\` target。已生成 \`embassy-executor\` 0.7 / \`embassy-time\` 0.4 依赖，并在 \`main.rs\` 的 \`hal::init\` 之后调用 \`hal::embassy::init()\`。
<% } -%>

## 调试与烧录（MRS OpenOCD / wchisp）

CH58x 不在 WCH-Link / wlink / ch32rv（ch32-hal 生态开源工具）支持范围内。调试/烧录使用 **MounRiver Studio 随附的 WCH fork OpenOCD**（\`openocd-wch\`，支持 wlinke + sdi）：勾选 VSCode 配置时生成 \`launch.json\`（cppdbg attach localhost:3333，\`riscv-none-elf-gdb\`）与任务 \`构建\` / \`gdbserver (MRS OpenOCD)\` / \`烧录 (MRS OpenOCD)\`，\`wchisp\` 任务保留为备用烧录路径（USB ISP）。

一次性环境准备：

\`\`\`bash
ln -s ~/mrs-openocd/bin/openocd ~/.local/bin/openocd-wch
export MRS_OPENOCD_CFG=~/mrs-openocd/bin/wch-riscv.cfg
\`\`\`

**两线调试前提**：芯片的 CFG_DEBUG_EN（两线调试）必须已开启（Windows WCHISPTool，或 BOOT 模式下 wchisp 配置）；否则 attach 报 \`WCH-Link failed to connect with riscv chip\`。代码生成与编译不依赖该开关。

\`\`\`bash
wchisp flash target/<%- target %>/release/<%- packageName %>
\`\`\`

## 时钟

ch58x-hal 只提供 PLL 时钟源（固定 **480MHz VCO ÷ div**，div 合法 2..=31）或 HSE/CK32K 直连：

- 命中 HAL 预设时生成 \`config.clock.use_pll_XXmhz()\`（60/80/48/32/24/20MHz）；
- 非预设 PLL 分频生成 \`config.clock.mux = hal::sysctl::ClockSrc::PLL(div);\`；
- HSE/CK32K 源本期**不生成**（HSE 直连 32MHz 需要 div=1，HAL 明确 assert 拒绝；CK32K 未建模），会在生成期报 \`CLOCK_PRESET_UNAVAILABLE\`。

\`enable_lse()\` <%- ble ? '已追加（BLE 强制 LSE 32.768kHz）' : '本期不生成（无 LSE UI 建模），32K 低频域默认 **LSI**' %>。
<% if (ble) { -%>

## BLE 协议栈（ch58x-hal + WCH BLE 库）

本工程生成 \`src/generated/ble.rs\`（\`config()\` + \`run(spawner)\`），\`src/main.rs\` 末尾调用 \`generated::ble::run(&spawner).await\`。

初始化顺序：\`hal::init\` → \`hal::embassy::init\` → \`ble::init\` → \`GAPRole::*_init\` → \`GGS_AddService\` + \`GATTServApp::add_service\` → （peripheral）\`register_service\` → \`*StartDevice\`。TMOS 泵是独立 \`#[highcode]\` 任务，每 **300µs** 调一次 \`TMOS_SystemProcess()\`（不可省）。

生成模板的硬约束：**TmosEvent 单订阅者**（多消费者/Clone 会 double free）；**不使用 \`core::sync::atomic\`**（imc target 无原子，跨任务状态走 \`embassy_sync::Channel\`）；notify 的 \`pValue\` 必须 \`GATT_bm_alloc\`。

### BLE 诚实边界（D12）

- **MTU 固定 23**（\`BufMaxLen=27\`，src/ble/mod.rs:171-183）：单包有效负载 20 字节，长特征值需自行分片。
- **TX 功率固定 6dBm**（\`LL_TX_POWEER_6_DBM\`，src/ble/mod.rs:174）。
- **无 SNV**：绑定信息不落 flash，复位后需重新配对（src/ble/mod.rs:188）。
- **central 角色不开放**：上游 HAL 无 central 示例，本生成器只提供 peripheral / broadcaster / observer。
- **配对参数为缺省值**：\`WAIT_FOR_REQ\` + bonding=true + MITM=false + \`IO_CAP_DISPLAY_ONLY\`、passkey 000000（对齐上游 ble-blinky 的 \`common_init\`）；复杂配对/GATT 表请写入用户区。
- **RTC 被 BLE 占用**：BLE 使用 LSE 与 RTC 时基，工程不生成 RTC 配置。
- **旧工程启用 BLE**：\`src/main.rs\` 是用户区、生成器永不覆盖；需手动在末尾加一行 \`generated::ble::run(&spawner).await;\`（并确保 \`features.embassy = true\`），或重新生成工程。
- **两线调试前提**：用 MRS OpenOCD \`cppdbg\` attach 调试 BLE 前，芯片的 CFG_DEBUG_EN（两线调试）必须已开启（Windows WCHISPTool，或 BOOT 模式下 wchisp 配置）；否则报 \`WCH-Link failed to connect with riscv chip\`。**代码生成与编译不依赖该开关**。
<% } -%>

## embassy 档的异步能力边界

<% if (embassy) { -%>
embassy 档只带来：**GPIO 异步等待**（\`Input::wait_for_rising_edge\` 等，基于 GPIOA/GPIOB 端口中断）与 **\`embassy_time::Timer\`**（SysTick 32KHz tick，约 7K Flash 开销）。

**UART / SPI / I2C / ADC 仍是纯阻塞 API**（ch58x-hal 没有 embedded-hal-async 外设实现），不要期待 \`await\` 收发。所有外设类型也不含 async 变体。
<% } else { -%>
blocking 档使用 stable 工具链；GPIO/UART/SPI/I2C/ADC 均为阻塞 API（ch58x-hal 无异步外设驱动）。
<% } -%>

## 本期未生成 / HAL 能力边界（诚实标注）

- **BLE**：<% if (ble) { %>已生成（\`src/generated/ble.rs\`，\`features = ["embassy", "ble"]\`，链接 \`LIBCH58xBLE.a\`）；能力边界见上方「BLE 协议栈」节<% } else { %>未生成，未启用 \`ble\` feature，未链接 \`LIBCH58xBLE.a\`<% } %>。
- **async UART/SPI/I2C/ADC**：不存在（HAL 无 embedded-hal-async 实现）。
- **DMA**：HAL 只有 \`dma::NoDma\` 占位类型，无 DMA 驱动；工程中的 DMA 配置被忽略。
- **定时器 / PWM 驱动**：\`timer.rs\` 仅是类型占位，无驱动 API。
- **SPI1**：CH582/CH581 无 SPI1（仅 CH583 有），HAL 也只实现 SPI0。
- **OpenDrain（开漏输出）**：HAL 无开漏 API；配置开漏会在生成期报错（请改为推挽）。
- **Speed 枚举**：HAL 没有速度档位；UI 的 LOW/MEDIUM/HIGH 映射为 \`OutputDrive::_5mA\` / \`_20mA\`（HIGH → 20mA，其余 → 5mA）。
- **通用 AF API**：无；复用由外设构造器内部的 \`set_remap()\` 完成（const 泛型 \`REMAP\`）。
- **PB17**：物理存在，但 ch58x-hal 未实现其 \`Pin\` trait，配置即被 \`HAL_PIN_UNSUPPORTED\` 拦截。
- **Vbat 采样**：\`enable_vbat()\` 为空操作且与温度传感器共用通道 15，本期不生成。
- **内部温度传感器**：数据层无内部通道，本期不生成。
- **I2C transaction**：HAL 的 \`embedded_hal_1::i2c::I2c::transaction\` 实现为 \`todo!()\`，请用 \`blocking_write\` / \`blocking_read\` / \`blocking_write_read\`。
- **I2C 地址**：7-bit 地址（HAL 内部 \`addr << 1\`），勿传 8-bit 地址。
- **EXTI / GPIO 中断 / NVIC 配置**：ch58x 的 GPIO 中断按端口聚合（GPIOA/GPIOB），数据层无 pin→EXTI 通道映射；本期不生成 EXTI/中断代码，工程中的中断配置被忽略（引脚上的 EXTI 开关会被共享冲突规则拦截，请关闭）。
- **debugPrint / SDI 打印**：ch32-hal 的 \`hal::debug::SDIPrint\` 仅 CH32V 系可用，ch58x 后端的 debugPrint 设置被忽略（不生成相关代码）。
<% if (warnings.length > 0) { -%>

### 本次生成的提示

<% warnings.forEach(function(w){ -%>
- <%- w %>
<% }) -%>
<% } -%>

## 生成区约定

- \`src/generated/**\` 每次导出整体重写；
- \`src/main.rs\` 是用户区，**生成器永不覆盖**（可自由增加模块/函数）。

生成器：ch32-rs-CubeMX。HAL 签名核对基准：ch58x-hal commit \`<%- halRev %>\`。
`
