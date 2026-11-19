// ch5xx README（工程概览 / 文件清单 / 构建 / 诚实能力边界）。
export const README_TPL = `# <%- projectName %>

由 ch32-rs-CubeMX 生成的 Rust 工程：芯片 <%- chip %>（<%- chipPackage %>，target \`<%- target %>\`），基于 [ch5xx-hal](https://github.com/ch32-rs/ch5xx-hal)（rev \`<%- halRev %>\`）。

> **上游警示**：ch5xx-hal 仍在活跃开发；本工程用于评估与原型，量产请自行评估风险。
>
> 本工程使用 **nightly + rust-src** 与 \`[unstable] build-std = ["core"]\`（与上游 ch582 示例一致），并生成 \`build.rs\` 发出 \`-Tlink.x\`；\`memory.x\` 由 HAL 的 \`memory-x\` feature 经 metapac 提供。
<% if (ble) { -%>
>
> 本工程**启用 BLE**：WCH 的预编译协议栈由工程内嵌的 **ch5xx-ble** shim（\`vendor/ch5xx-ble\`）包装；ch5xx-hal 本身不提供 BLE。
<% } -%>

## 工程概览

| 项 | 值 |
|---|---|
| 芯片 | <%- chip %>（<%- chipPackage %>） |
| HAL 后端 | ch5xx-hal @ <%- halRev %> |
| 运行时 | <%- ble ? 'BLE busy-poll（shim TMOS 主循环；不启 hal embassy/time-driver）' : embassy ? 'embassy（time-driver-tmr0）' : 'blocking（阻塞）' %> |
| 工具链 | nightly + rust-src（build-std=core） |
| 目标 triple | <%- target %> |
| 时钟 | <%- clockSummary %> |
<% if (ble) { -%>
| BLE | 启用（ch5xx-ble shim，busy-poll；32K 低频域 <%- clock32k %>） |
<% } -%>
| HAL 源码 | <%- vendorHal ? 'vendor/ch5xx-hal（path 依赖，可跳转阅读）' : 'git + 锁定 rev' %> |

## 文件清单

<% files.forEach(function(f){ -%>
- \`<%- f.path %>\`：<%- f.desc %>
<% }) -%>
<% if (vendorHal) { -%>
- \`vendor/ch5xx-hal/\`：完整 HAL 源码（path 依赖），由导出层从内嵌资产写入
- \`vendor/ch5xx-data/\`：ch5xx-hal 的 build.rs 所需芯片 YAML（兄弟目录 \`../ch5xx-data\`，**不可删**）
<% } -%>
<% if (ble) { -%>
- \`vendor/ch5xx-ble/\`：BLE shim（含 \`vendor/*.a\` 预编译 blob），由导出层写入
<% } -%>

## 配置回读（cube.json）

工程根目录的 \`cube.json\` 是本工程的配置快照（等价于 STM32CubeMX 的 \`.ioc\`）：在 ch32-rs-CubeMX 的 Home 页点击「导入工程配置」，或直接把文件拖入窗口，即可继续编辑并重新导出。cube.json 中的 \`halBackend\` 决定重新生成时使用的 HAL 后端（ch5xx-hal / legacy ch58x-hal）。

## 构建

\`\`\`bash
cargo build --release
\`\`\`

目标 triple 与 \`build-std\` 已由 \`.cargo/config.toml\` 指定；\`rust-toolchain.toml\` 锁定 nightly 与 rust-src。\`build.rs\` 只发 \`cargo:rustc-link-arg-bins=-Tlink.x\`，\`memory.x\` 由 ch5xx-hal 的 \`memory-x\` feature 生成到 \`OUT_DIR\`。

## 时钟

ch5xx-hal 的时钟树为内部/外部振荡器 → PLL（CH582：固定 480MHz VCO）→ Fsys（无 AHB/APB 分频器）：

- 命中预设时生成 \`hal::rcc::Config::PLL_XXMHZ\`（60/80/48/32/24MHz；**CH582 无 20MHz 预设**，20MHz 生成显式 \`Config::new(Osc::Hse32, Sys::Pll(24))\`）；
- 非预设 PLL 分频生成 \`Config::new(Osc::Hse32, Sys::Pll(div))\`，div 合法 **6..=32**、Fsys **15..=80MHz**；
- HSE 32MHz 直连生成 \`Sys::Direct\`；CK32K 仅为显示源（无 SYSCLK 预设）→ 生成期报 \`CLOCK_PRESET_UNAVAILABLE\`。
<% if (ble) { -%>

BLE 32K 时钟源：\`clock32k=<%- clock32k %>\` → main.rs 在 \`hal::init\` 之后、\`generated::ble::run()\` 之前调用 \`ch5xx_ble::<%- clock32k === 'lse' ? 'enable_lse()' : 'set_clock32k_lsi()' %>\`（shim 逐字移植 legacy sysctl 的 32K 寄存器序列）。lsi 回退的 LSI 校准未移植，连接稳定性未保证。
<% } -%>

## 外设 API（ch5xx-hal）

- GPIO：\`Output::new(pin, Level, Speed)\`（Speed=5/20mA）、\`Input::new(pin, Pull)\`；句柄类型不携带 pin 泛型（\`Output<'static>\`）。
- UART：\`Uart::new_blocking::<REMAP u8>(peri, rx, tx, Config)\`（**先 rx 后 tx**）；\`Config::new(baud)\` + 逐字段赋值。
- SPI：只有全双工 \`Spi::new_blocking::<REMAP u8>(peri, sck, mosi, miso, Config)\`；只支持 \`MODE_0/MODE_3\`，MODE_1/2 与半双工在生成期报错；NSS 为软件 GPIO 片选。
- I2C：\`I2c::new_blocking::<REMAP u8>(peri, scl, sda, Config)\`；无上拉配置字段（HAL 构造时置内部上拉，外部上拉仍必需），SCL ≤400kHz，Fsys 必须 2..36MHz。
- ADC：\`Adc::new(peri, Config { gain, sample_clock })\`；通道是 **GPIO 单例**（\`p.PA4\`=ch0 … \`p.PA9\`=ch13），读取 \`adc.blocking_read(&mut g.adc_in0).unwrap()\`；无 \`read_as_millivolts\`，生成注释给出 \`raw*3300/4096\` 近似式。
- 时间类型：\`hal::time::Hertz(n)\`（无 \`.Hz()\`/\`U32Ext\`）。

## 运行时与能力边界

<% if (ble) { -%>
- BLE 档为 **busy-poll**：不启用 ch5xx-hal 的 \`embassy\`/\`time-driver-*\` feature，不初始化 embassy 执行器；协议栈由 \`generated::ble::run()\` 的 \`loop { TMOS_SystemProcess(); … }\` 推进（连续轮询、无 delay）。
- 事件单订阅者（\`ch5xx_ble::EventSubscriber\`），取到即 drop；共享状态用 \`static mut\` + \`critical_section\`（不用原子）。
- notify 周期以 \`ch5xx_ble::systick_hz()\` 为准（不再假设 hclk/8）。
- 无 SNV（绑定不落 flash）、MTU 23（单包 20 字节）、TX 6dBm；PA 控制本期未移植（RF 为芯片缺省）。
- **BLE 依赖 shim crate**：\`ch5xx-ble\` 链接 WCH 的 \`LIBCH58xBLE.a\` / \`libISP583.a\`；出厂 MAC 通过 ROM 命令直接读取（shim 未导出 ISP 包装）。
<% } else if (embassy) { -%>
- embassy 档：\`embassy-executor 0.10\` + \`embassy-time 0.5.1\`（tick 1MHz）+ \`time-driver-tmr0\`；main 使用 \`#[embassy_executor::main(entry = "qingke_rt::entry")]\`，\`hal::init\` 内部完成时间驱动初始化（**无** \`hal::embassy::init\`）。
- UART/SPI/I2C/ADC 仍有阻塞驱动；SPI/I2C/UART 提供 async 变体（HAL 支持），生成器本期只生成阻塞初始化。
<% } else { -%>
- blocking 档同样使用 nightly + build-std；UART/SPI/I2C/ADC 均为阻塞 API。
<% } -%>

## 本期未生成 / HAL 能力边界（诚实标注）

- **中断 / NVIC / EXTI**：ch5xx 的 GPIO 中断按端口聚合，数据层无 pin→EXTI 映射；工程不生成中断绑定，中断配置被忽略（引脚 EXTI 开关会被规则拦截）。
- **通用 DMA**：HAL 的 DMA 是 SPI0/ADC 外设本地引擎，无通用通道控制器；工程中的 DMA 配置被忽略。
- **开漏输出**：ch5xx 的 gpio 只有推挽驱动（Speed=5/20mA）；开漏配置生成期报错。
- **SPI 半双工 / MODE_1/2**：HAL 不支持 → 生成期 \`SPI_HALFDUPLEX_UNSUPPORTED\` / \`SPI_MODE_UNSUPPORTED\`。
- **UART 波特率**：DL=round(Fsys/(8·baud))；DL 为 0/超 65535 或误差 >2% → 生成期 \`BAUDRATE_UNREPRESENTABLE\`。
- **I2C 时钟**：Fsys 必须 2..36MHz、SCL ≤400kHz → \`I2C_CLOCK_OUT_OF_RANGE\`。
- **debugPrint / SDI 打印**：仅 CH32V 系，ch5xx 后端忽略该设置。
- **ADC 内部通道（Temperature/Vbat）**：本期不生成；BLE 的温度回调由 shim 内部使用。
<% if (warnings.length > 0) { -%>

### 本次生成的提示

<% warnings.forEach(function(w){ -%>
- <%- w %>
<% }) -%>
<% } -%>

## 生成区约定

- \`src/generated/**\` 每次导出整体重写；
- \`src/main.rs\` 是用户区，**生成器永不覆盖**（可自由增加模块/函数）。

生成器：ch32-rs-CubeMX。HAL 签名核对基准：ch5xx-hal commit \`<%- halRev %>\`。
`