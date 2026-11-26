# M19 CH582M BLE 外设正式接入契约

更新于 2026-11-24。M19 从 CubeMX 的交付结果验收：用户在 **Peripherals → BLE** 启用和配置外设，保存工程，预览和导出 Rust，再在 CH582M 上运行生成的固件。新增 BLE 外设接入以 `wchble` Controller 与 Trouble Host 为实现路径，使用现有生成流程和配置模型。历史 WCH shim 工程继续按已有格式解析和导出。

## 1. 当前基线与剩余距离

| 层次 | 已有证据 | 剩余缺口 |
|---|---|---|
| CubeMX 产品 | Project Settings 有 BLE 开关、角色、设备名、间隔、MAC、UUID16 与 32K 时钟配置。`BleConfig`、工程往返、冲突规则、Rust 生成、ZIP/目录导出和 shim 打包均有实现。2026-11-24 定向回归 170 项通过，`npm run verify:build -- --chip CH582M --ble` 通过。M17 的生成固件曾通过 CH582M + BlueZ 的 GATT 发现、读写和通知。 | Peripherals 的列表、启用状态和单实例工作区缺少 BLE。时钟与 NVIC 有基础数据，BLE 资源的占用和诊断还要接入外设工作流。 |
| CH582M 自研归档 | `ble-native` 曾验证双向射频、1800.03 s 空闲连接及 ATT MTU 64 的读写和通知。Legacy 与 LE Secure Connections 各有原型实机记录。 | `ble-native/` 已退役，历史实现、许可和实机记录供查阅。验收运行 `wchble` 示例与其宿主工具。 |
| `wchble` | [上游 PR #34](https://github.com/ch32-rs/wchble/pull/34) 已提交，候选 `927bf9e` 的 CH582M 1M 轮询 RF 经 OpenOCD 校验烧录。BlueZ 发现广播，板端在 37/38/39 收到带标记且 CRC 正确的对端包 `4/2/6`，各信道 `175` 次 TX 完成。499 项主机测试、IMC/IMAC 交叉检查通过。 | CH582M `LinkRadio`、硬件时基、建链、Trouble GATT 及 CubeMX 生成集成待完成。CH583M 还待实机验证。 |

> M19 优先验收 19.2 和 19.3。`wchble` 实机连接与 GATT 通过后，19.1 和 19.4 共同完成 CubeMX 的正式外设入口及代码导出。默认切换按安全、兼容和 RAM 证据决定。

自研 D1–D9 的实现、许可及历史证据见 [CH582 原生 BLE 基线](m19-native-ble-baseline.md)。M18 关于全栈重写和厂商二进制分发的评估见 [M18 spike](m18-cleanroom-spike.md)。PR #34 的范围是基于公开 iSLER 的 RF 实现及示例，保留第三方 MIT 通知。

## 2. 交付范围与兼容契约

- **首版外设入口**覆盖 CH582M，复用已有配置字段，新增生成路径接入 `wchble`。外设列表、工作区、Project Settings 与代码预览读取同一份 `features.ble`、`BleConfig`。旧工程导入和导出的字段含义、旧 `halBackend` 缺省回落规则一并保留。启用和停用 BLE 要刷新工程状态、冲突和代码预览。
- **器件能力来自数据**。BLE 作为无 AF 分配的片上外设，CH582M 数据描述实例、可用后端及资源。`ANT`、32 MHz HSE 和 LSE 晶振按固定用途处理。BLEL、BLEB、LLE TMR 和 DMA scratch 按所选后端实际占用报告，避免用户重复配置或禁用必需资源。构建判据覆盖 32K 源、时钟冲突、MAC 地址类型、UTF-8 广播长度和 UUID 约束。
- **无 blob 首版**为 CH582M、外部 32.768 kHz、LE 1M legacy、单连接 Peripheral、生成的 GATT 示例服务。用 `ch5xx-hal` 初始化板级资源，`wchble` 负责 RF／LL／软 HCI，Trouble Host 负责 GAP／L2CAP／ATT／GATT／SMP。明确展示各后端可用的角色和参数，旧路径上的 Broadcaster、Observer 仍按原配置导出。
- **生成接口和版本**。复用现有 BLE 参数计划和生成流程，为 `wchble` 路径生成运行时与服务适配。首次导出包含启动接线。重复导出更新 `src/generated/**`，保留用户的 `src/main.rs`；从旧 shim 切换需要改动用户入口时，生成报告给出迁移接线并让用户显式应用。`BleConfig` 如新增后端选择字段，缺省解析为当前行为，已有工程显式迁移。
- **依赖可复现**。锁定经实测的 `wchble`、Trouble、HAL 与 metapac 修订。产品导出在干净路径按同一依赖清单构建。预览可以固定到 PR 或 fork 的已验证提交，正式默认发布使用已合入上游的修订或项目明确维护的固定版本。现有兼容路径继续单独验证；无 blob ELF 以依赖图、链接映射和符号检查证明其依赖边界。

## 3. 执行顺序与退出门禁

| 里程碑 | 交付与责任范围 | 退出门禁 |
|---|---|---|
| **19.0 射频贡献** | 已提交 [wchble #34](https://github.com/ch32-rs/wchble/pull/34)。提交含三点调谐、轮询 DMA、停止确认、校准超时及可复现 smoke。 | PR 等待上游评审。留存最终 ELF 哈希、UART、独立 BlueZ 发现与逐信道 RX；硬件异常路径与逐信道 TX 时间继续单列。 |
| **19.1 CubeMX 外设入口** | 在设备数据声明 BLE 实例和兼容路径。接入 Peripherals 列表、启用/停用、单实例工作区、状态、冲突和预览。复用设置页现有字段，与 19.4 的 `wchble` 生成链联调。 | CH582M 新旧工程往返；未支持的芯片不显示入口；停用后的导出移除 BLE；浏览器实际 ZIP 或目录导出、构建并烧录，用 BlueZ 验证 FFE0/FFE1/FFE2 发现、读写、通知与断连后恢复广播。 |
| **19.2 CH582M 连接控制器** | 将现有 2 MHz LLE 计数、TMR0/1 时基、TMR2 截止、RX 捕获和 BLEL 接入 `LinkRadio` 与单连接引擎。以 1250 个计数表达 625 µs，保持半微秒时间戳分辨率及跨回绕计算。 | BlueZ 复验 CONNECT_IND、首锚点、CSA#1、SN/ACK 与 30 分钟空闲连接。注入链路静默验证监督超时、广播恢复和再次连接，记录漏收、CRC、重传及迟发。 |
| **19.3 上层服务与资源** | 将单连接控制器接软 HCI 与 Trouble Host。先在 `wchble` 的 CH582M 固件跑通 GATT 回归，再固定导出所需的初始化、队列、设备地址和 GATT 接口。 | 实机服务发现、ATT MTU 64、61 字节 Write Request、13 字节 Write Command、回读与通知逐字节匹配；取消订阅与断连清理、重连正确。提交链接映射及高水位，合计静态区、`.highcode`、队列、DMA 及栈峰值并给出 CH582M 32 KiB 下的剩余空间。 |
| **19.4 无 blob 外设后端可用** | 加入可选后端、数据驱动能力校验、相应 UI 说明、生成模板、依赖打包及验证矩阵。生成物覆盖本地配置声明的地址、广播间隔、设备名和服务 UUID。 | Web ZIP、目录导出和同源 CLI 产物在与开发者 reference 无关的路径构建。按相同配置在 CH582M 实机复跑 19.2、19.3 的关键验收，检查 ELF 无 WCH BLE 库。旧 cube.json、原有 shim、BLE 关闭及非 BLE 芯片回归通过。此处是无 blob 正式可选的发布点。 |
| **19.5 评估默认切换** | 验证 Legacy 与 LE Secure Connections 的配对、加密 GATT、RAM 绑定和重连。核实板端随机来源、运行时延迟、内存余量及端侧兼容性。只评估已具备能力的 CH582M 新建配置。 | 至少 BlueZ 与一台移动端通过核心连接/GATT 行为；明文访问受保护特征失败，配对和绑定重连成功，掉电行为符合 RAM 绑定声明；复跑混合外设负载、较长连接及重连，并验证旧工程显式迁移和回退。 |

主线顺序为 19.2 → 19.3 → 19.1 与 19.4 联合验收。主动扫描、Central、多连接、2M/Coded、无外部 32K 晶振的运行、扩展广播、RF 温补／DTM及其他芯片按各自验证情况排期。

## 4. 代码落点与验收记录

| 领域 | 接入点与验证 |
|---|---|
| 器件和外设模型 | `data/devices/ch582m/`、`src/model/peripherals/`、`src/model/conflicts/rules/bleRules.ts`。以同一模型驱动用量、冲突、UI 能力和生成器；设备数据用 `npm run validate:device` 核验。 |
| 工程与 UI | `src/views/PeripheralsView.vue`、`src/views/PeripheralWorkspaceView.vue`、`src/views/ProjectSettingsView.vue`、`src/controllers/project.ts`、`src/services/projectFile.ts`。覆盖新旧 cube.json 往返、启用和停用、后端切换与预览。 |
| 生成与导出 | `src/model/codegen/ch5xx/`、`src/services/projectExport.ts`、`scripts/verify-build*`。沿用 `npm run verify:build -- --chip CH582M --ble` 覆盖 shim，并为无 blob 后端增加等价的显式矩阵。常规门禁为 Vitest、ESLint、Vite build、device validate 和实际 Rust 构建。 |
| 固件与证据 | 使用 `wchble` 同版本的 CH582M 示例与 BlueZ 工具，按固定配置记录版本、启动方式、最终 ELF SHA-256、烧录校验、UART、对端日志、通过范围和失败轮次。已验证的 smoke 与 CubeMX 导出固件分别记账。 |

### 19.3 内存测量起点

对 `b704af7` 的 `riscv32imc` 试编译，当前链路示例的 `.highcode`、`.data` 和 `.bss` 合计 13,392 B。独立类型探针测得 `SoftRunner` 为 17,424 B，其中每个 `ConnectionBridge` 为 6,912 B。按 19.3 的单连接配置，Trouble `HostResources` 类型为 1,488 B，另需计算包池、静态 HCI 队列和栈。进入 GATT 实机验收前应链接真实候选，检查单连接配置是否减少实际分配，再测峰值及余量。上述尺寸来自分开的产物，完整 GATT 固件以实际链接图和运行测量为准。
