# ch32-rs-CubeMX 项目记忆

> 供编码 Agent 使用：修改代码前先读本文件。最后更新：2026-11-15。

## 1. 概述

纯本地 Web 配置器：点引脚、配外设、调时钟树 → 导出可 `cargo build` 的 ch32-hal Rust 工程。
技术栈：Vite + Vue3 + TS + Pinia + Element Plus + 原生 SVG + EJS(client:true) + JSZip + Vitest + Monaco。
首颗芯片：CH32V003F4P6（TSSOP20，QingKe V2A RV32EC，16K Flash / 2K SRAM）。

## 2. 架构地图（MVC 分层，2026-11-16 重构）

分层规则（详见 docs/ARCHITECTURE.md，eslint 强制）：**model 不依赖任何上层；services 只依赖 model；controllers 依赖 model+services；views/components 可用全部**。import 一律走 `@/` 别名。

- **model/**（领域层，纯函数、无 UI/Vue/Pinia 依赖）
  - `types/`：ProjectConfig / 数据层 schema / Conflict / CodegenSelection 全部类型。
  - `device.ts`：器件注册表 + Lookup（remapsOfPin/pinsOfSignal/remapValuesFor/extiOfPin…）。新增芯片在此 register。
  - `clock/`：`index.ts`（computeClock/validateClock/solvePll/mergeClockConfig/matchPreset…）+ `tree/`（节点模型 + SVG 布局）。
  - `conflicts/`：checkConflicts + 规则模块（pin/clock/peripheral/exti 分族）。
  - `pins/`：allocation（分配枚举）/ usage（使用归并）/ groups（分组单归属）/ pinOverwrite（覆盖确认，纯函数）。
  - `package.ts`：computePackageGeometry(chip,rotation) dual/quad + pinColors。
  - `peripherals/`：derivePeripheralUsage(config,data) → 外设实例启用/remap/引脚/参数归并。
  - `codegen/`：`index.ts`（generateProject 编排 + 各生成物模块）+ `templates/`（EJS 模板目录，34 文件）+ halRev.ts（锁定 rev）。
- **services/**（应用服务层，IO/平台能力）
  - `projectExport.ts`：生成→内嵌 vendor HAL→ZIP/目录落盘的完整编排（桌面/浏览器自动分流；两段式目录导出保证用户手势内选目录）。
  - `projectStorage.ts`：localStorage 持久化。
  - `projectFile.ts`：cube.json 解析/序列化/下载（桌面走原生另存为）。
  - `desktop.ts`：Tauri 桥（isDesktopApp/saveFileNative/pickFolderNative/writeFolderNative）。
  - `monaco.ts`：Monaco 异步加载 + 语言映射。
- **controllers/**：`project.ts`（Pinia）assignments/groups/clock/peripherals/features/unlocked/selectedPin/activeView/dirty/lastExportSnapshot；config getter 组装 ProjectConfig；conflicts getter 跑 checkConflicts；save/restore 委托 projectStorage。
- **views/**：HomeView / PinoutView / ClockView / PeripheralsView。
- **components/**：骨架（AppShell/TabStrip/IconRail/StatusBar）、Pinout（PackageCanvas/PinTable/PinConfigPanel/ConflictsPanel）、Clock（ClockCanvas + 子组件 / ClockDetail）、Peripherals（PeripheralList/PeripheralConfigCard + 参数子组件 + 分配面板）、CodePreviewPanel（Monaco 只读+diff）、CodegenDialog（导出，纯视图）。
- `data/devices/<chip>/`：chip/remap/exti/clock/peripherals/interrupts/dma 七份 JSON。
- `scripts/`：import-ch32data.mjs（ch32-data → remap/interrupts/dma/索引）、validate-device-data.mjs（CI 门禁，vite ssrLoadModule 复用时钟库）、verify-build.mjs + verify-build-entry.ts（vite-node 同源代码生成 → cargo build）。

## 3. 关键决策记录

1. **HAL feature 名是完整小写型号**（ch32v003f4p6），不是家族名。提示词 §2.2 有误，以 Cargo.toml 为准。
2. **V003 PLL 固定 ×2**，HSI=24MHz，无 APB1 分频（pclk1=hclk），AHB 支持 DIV1..8/16/32/64/128/256。clock.json 据此录入。
3. **remap 数据从 ch32-data family YAML 导入**（与 HAL 同源）；提示词"ch32-data 无引脚表"结论部分过时——信号/remap 有，物理引脚编号仍需数据手册（已交叉核对 pinout-overview SVG）。
4. **memory.x 由 ch32-hal 的 memory-x feature 提供**（metapac 渲染），生成器不手写 memory.x，与模板一致。
5. **ADC 通道真实映射**：PA2=IN0 PA1=IN1 PC4=IN2 PD2=IN3 PD3=IN4 PD5=IN5 PD6=IN6 PD4=IN7（提示词示例 PD4=IN4 错误）。
6. **枚举变体名逐字对应 HAL**：StopBits::STOP1（非 STOP_1）、SampleTime::CYCLES73（非 CYCLES_7_5）、Speed 仅 Low/Medium/High。
7. **USART 阻塞构造参数顺序 rx 在前 tx 在后**，返回 Result；Config 均 non_exhaustive → default+赋值。
8. **唯一性约束是 (pin,signal,remap) 三元组**（同引脚信号可跨 remap 档，如 SPI1_SCK@PC5）。
9. 特殊引脚：PD7=NRST（默认启用，选项字节 RST_MODE 控制）、PD1=SWDIO、PA1/PA2=OSC。默认锁定，显式解锁才可配置。
10. 生成区/用户区物理隔离：generated/** 每次重写，main.rs 永不覆盖（导出对话框可勾选排除）。
11. 预设匹配要求 HSE 频率精确相等（HAL 预设硬编码 24MHz HSE）；不匹配走显式 Config 兜底。
12. **导出工程内嵌完整 HAL 源码**（用户需求）：`vendor/ch32-hal/` + path 依赖，开箱可查阅/跳转 HAL 代码。浏览器端资产 `public/vendor/ch32-hal.zip` 由 `npm run vendor:hal` 从 reference/ch32-hal 打包（413 文件/0.73MB）；CodegenDialog 导出时合并进 ZIP。selection.vendorHal=false 时退回 git 锁 rev 依赖。verify:build 默认验证 vendor 模式（复制 HAL 源码到临时工程）。

## 4. 数据 schema 要点

见提示词 §4 与 src/types.ts。chip.json 不存 remap（只存 adc 通道），remap.json 为唯一信号源，校验器保证 peripherals.json 与 remap/chip 双向一致。

## 5. 验证

- `npm run validate:device`：引脚连续/每边数量、remap 三元组唯一、外设双向一致、EXTI 通道/IRQ、clock 预设可复现（ssrLoadModule 同源）、中断唯一、覆盖率报表。当前全绿（18/18 IO 有信号）。
- `npm run verify:build`：vite-node 生成 → cargo build --release（V003 nightly rv32ec）。CH32_HAL_DIR 默认指向 reference/ch32-hal（path 覆盖加速）。
- 单元测试目标 150+：clock/conflicts/packageSvg/deviceData/peripherals/allocation/groups/usage/codegen 快照。

## 6. 状态与路线图

- Phase 0（完成）：骨架 + 数据层 + 校验全绿。
- Phase 1（完成）：封装图/引脚配置/冲突/codegen/Monaco 预览/**端到端编译通过**（V003 阻塞+embassy、V203 阻塞+embassy）。
- Phase 2（完成）：时钟树画布（GLSP 风格、数据驱动布局）+ 频率链/校验/PLL 解算 + diff 预览 + 固定 VCO÷分频 PLL 模型。
- Phase 3（完成）：外设视图（列表/卡片/参数/remap 切换）+ EXTI/ADC/分组/使用汇总分配面板。
- Phase 4（进行中）：多芯片——CH32V203C8T6 已接入并通过编译验证；CH32H417QEU6（QFN128 双核 V3F+V5F）已接入，代码生成产出 Cargo workspace（ch32-hal-template h417-dual：`cargo xtask build` 逐核构建）并**端到端编译通过**；**CH582M ch58x-hal 后端已接入（M11）+ BLE 协议栈（M12）**：独立 codegen 管线（src/model/codegen/ch58x/）、blocking/embassy 双档、GPIO/UART0-3/SPI0/I2C/ADC 生成、6 档时钟预设（defaultSource=PLL）、BLE 三角色（generated/ble.rs）、vendor/ch58x-hal 内嵌（zip 入 git）、MRS OpenOCD 调试链 + wchisp 备用；编译 target 刻意 riscv32imc（WCH QingKe LR/SC 原子缺陷规避，qingke#9）+ blocking 档 generic-queue（__pender 链接修复）；实机：两线调试经 Windows WCHISPStudio 开启后 MRS OpenOCD examine + gdb attach 只读核实通过（2026-11-17 晚，HAL notes §14.2）；烧录待授权。M14 再接入 CH32V103C8T6（V3A/imc/stable，80MHz，6 预设含 80MHz 块表达式）/ CH32X035C8T6（V4C/imc/stable，无 PLL/HSE 仅 AHB 分频，48MHz）/ CH32V307VCT6（V4F 硬浮点 imfc 自定义 target + nightly/build-std，144MHz，targetSpec 数据驱动）；BLE 连接建立实机打通（clock32k 选项缺省 lse + stack_init + 连续轮询 + SysTick notify）；宿主 AX210 GATT 卡点 btmon 实证闭环（2M PHY 切换后首包 PB 损坏；三版固件同症排除版本回归；coex 参数 iwlmvm no-op）→ 强制 1M PHY + ax210-phy-1m.service 持久化，宿主 GATT 读写/notify 全通；notify 周期实机裁决（8s→hclk/8 修复→≈1s 复验 20 包/20s）。待办：多封装、EasyEDA 同步、central 角色、一键烧录、LSI 校准移植、AX210 2M 损坏上游报告。

## 7. 测试与门禁现状（2026-11-16 工程化重构后）

- 单元测试：**1495 个用例全绿**（61 文件；M16 clockTree 98（diagram/PRIM/锚点/aux/灰行保真）+ displayOnly 专项；M15 peripheralClock 51 + clockInlineEdit 47 + codegen adc/README 9；M14 三芯片数据测试 + cargoTargetSpec 9 + clock 扩展 + chipPicker 7 芯片更新；M13 ch58xBleCodegen 84；M12 新增 bleRules 23 / bleProjectFile 15 / ideConfig ch58x 13 / 默认时钟 3；M11 新增 ch58xCodegen 72 / ch58xData 10 / halUnsupportedPin 6 / exportBackend 6）。
- M15（v0.16）：时钟树页大修 MX2 对齐 + 外设时钟配置（契约 M15_CLOCK_OVERHAUL_CONTRACT D1–D9）：树泛化 10 列自动布局（删 posById）+ 每实例 USART/SPI/I2C 节点（固定源徽标+速率旋钮写回外设状态+HAL 公式派生实际频率+越界警告）+ ADC CTLR3.CLK_DIV raw 旋钮（V203/V307/X035，语义未核实带警告）+ codegen clkdiv 真实 API + USB 48M 显示域/非法 PLL 警告（V103 80MHz 首亮）+ 表格可编辑/Reset 确认/右键菜单/路径高亮 BFS/跨视图跳转/Shortcuts/抓手/点状背景/Detail 元数据驱动；硬件真相：WCH 无 I2C/SPI/USART 内核 mux（不发明）；H417 KernelMux 不建模；七芯片浏览器验收；HAL notes §15 公式逐字证据。dev 教训：并行编辑后 HMR 幽灵→验收前干净 reload；evaluate 桥克隆 pinia proxy 得 {}→页内 JSON.stringify 取证。
- M16（v0.17）：时钟树逐芯片重画（契约 M16_CLOCK_DIAGRAM_CONTRACT D1–D10+D4bis/ter）：7 份 RM/DS 框图下载转录（docs/m16-rm/，file.wch.cn id=371/532 + openwch 镜像）→ 逐芯片手写 diagram 坐标/分组/lanes 镜像 RM 五区带；MX2 分离图元簇（mux 竖 radio/stepper/两行读数/pll stepper 链/peri airy）+ 白纸面板 + note 截断 hover；缺失域仅显示补全（LSI/LSE/RTC/MCO/PLL2/3/USBHS/32K/H417 V5F/V3F 分叉）；RM 裁决：V003 ADCPRE=HCLK÷2 结案 FIXME（24→12）、V003 无 APB2 预分频、X035 无 LSI+CLK_DIV 9 位非自然编码、H417 仅 PPRE2、CH582 ADC 图/寄存器歧义；mux 输入 RM 保真（sysclkMuxInput 标志，LSI/LSE 无假灰行/灰边）；codegen 零改动（verify 快照逐字节同）；1495 测试/七芯片截图验收；HAL notes §16。收尾（用户目检反馈）：接入线 STUB=14 缓冲+水平垂直进入+grazes 擦边拒绝（七芯片断言）；外设并联均衡列（每列≤2卡顶边对齐）压缩画布高 1076→772 等（「USART 出界」真因=画布过高视口外溢）；1496 测试。
- M14（v0.15）：三芯片接入（V103/X035/V307，数据手册级引脚 + HAL 逐字时钟；契约 M14_CHIP_INTAKE_CONTRACT D1–D12）+ 时钟模型通用扩展（pll 可选/prediv 除法/SYSCLK ADC 源/maxBySource）+ targetSpec 数据驱动（V307 imfc nightly）+ verify 7 芯片（blocking 6/6 embassy 6/6 BLE 1/1）+ BLE 连接闭环（根因 #5 32K 错配：clock32k 缺省 lse=enable_lse+SelRTCClock=0 实机连接 ×3；stack_init 替代 ble::init；连续轮询无 delay；SysTick notify 时基；手机对照定位宿主 AX210 GATT 卡点→btmon 实证 2M PHY 首包 PB 损坏→1M PHY 修复持久化（systemd）→宿主 GATT 全通；notify 周期 8s 裁决→hclk/8 修复→≈1s 实机复验；契约 D20–D23、HAL notes §14.2quater/quinquies）。工具链教训：wlink flash 无 verify 产坏镜像→一律 OpenOCD program verify；btintel 版本比对触发固件重下载（无需断电）；内核固件 xz 须 -C crc32。上游 issue 已提交：qingke#42 / ch58x-hal#13 / ch58x-hal#14 / ch32-hal#283 / ch32-hal#284（#13 更正评论已提交：撤回 hclk/8 论点——HAL 假设与硅片一致，WFI 停计部分保留；comment-6968946706）。
- M13（v0.14）：CH58x BLE 实机化闭环——busy-poll 运行时（stable，绕 embassy SysTick/WFI 缺陷）+ main 入口 csrs mstatus,8 + LSI 缺省（不强制 LSE）+ 广播 flags GENERAL discoverable 位（bluez 过滤根因）+ BLEL/BLEB 接库 ISR；实机 bluez 扫到 CH582M（出厂 MAC）。官方 C hex 对照分离硬件/软件根因；证据 HAL notes §14.2bis/ter、契约 D17–D19。
- M12（v0.13）：CH58x BLE 协议栈生成（peripheral 含简单 GATT/broadcaster/observer；TMOS 泵 300µs、单订阅者防 double free、imc 无原子走 Channel、LSE 强制、名称三处同步、MTU23/TX6dBm/无SNV 诚实边界）；BLE⇒embassy 互锁；ClockData.defaultSource 数据驱动（CH582M 默认 PLL）；调试链=MRS OpenOCD（用户目录部署，wlinke+sdi；attach 待芯片两线调试开启，用户硬件操作）；launch.json+openocd-wch 任务链；verify 六路含 --ble。画布交互修复：光标锚定缩放+背景拖动平移（f17a3d7）、时钟卡片 safe center 居中（0eae042）。
- M11（v0.12）：CH58x 后端立项落地——halBackend 数据驱动分流（ch32-hal/ch58x-hal）；ch58x 独立管线（契约 docs/CH58X_BACKEND_CONTRACT.md，HAL @611954e 逐字核实）；两个真实编译阻塞修复：①qingke 0.5.0 原子 compile_error → imc target（上游 qingke#9 认可的回退路径，不信任坏原子指令）②blocking 档 __pender 缺符号 → embassy-time-queue-utils generic-queue-8 feature 统一；PB17 halUnsupported 数据驱动拦截；时钟 6 预设（补 20MHz）/div 2..31；设置页 rev/工具链/运行时文案后端感知；ChipPicker ch58x 可生成；vendor zip 双后端；verify:build 扩至 4 芯片 + CH582M embassy；工具链事故：rustup 自动更新致 stable 损坏→修复至 1.100.0（verify 用显式 RUSTUP_TOOLCHAIN）。
- M10（v0.11）：空态门禁（projectOpened + setView 守卫 + 左栏/标签栏仅 Home）；标签文档模型（openViews/activeView 可 null/浏览器式 ×/角标圆点/样式对照 MX2 特写：底板全宽+首标签缩进左栏宽）；桌面磁盘工程库（Tauri projects_root/read_text_file/remove_dir 路径守卫 + projects.json 索引 + 桌面 autosave 落盘 + 向导真实路径可编辑/Change + Home 磁盘库，podman 构建+smoke 通过）；launch.json（ch32rv gdb:3333 attach，wlink 无 gdbserver 源码核实；CH32V203C8T6 实机目标层只读核实通过：halt/regs/读 Flash/gdb attach，HAL notes §12.7；V203 无硬件断点槽，软件断点改写 flash page）。
- M9（v0.10）：芯片选择链路对齐 MX2 创建向导——ChipPicker 选中门禁/全列排序（容量列数值序）/逐列过滤/分页/Columns/Export CSV；两步 CreateProjectWizard（名称必填门禁+只读存储预览+MCU 回显+纯本地秒建）；设置页 General 名称/路径只读（创建时定，改名走工程库）。实机取证见 ANALYSIS-MX2-CHIPFLOW-GAP.md。
- M8（v0.09）：主题对齐 MX2（白左栏/藏青标签底板/白 raised 选中签，变量化+对比度采样）；类别级冲突策略（safe/update/custom 三档 + 逐组下拉，resolveGroupDefaults + inspect/write groupDefaults 管线，逐文件决议优先，user_code 硬保护，随 cube.json 保存）；M4.7 SignalsSelector（搜索/分组/多 remap 档/当前徽标）+ PinMode RESERVED 全链路（reserved 态/生成跳过/RESERVED_PIN_IN_USE）。
- M7（v0.08）：生成决议入页（对齐 CubeMX2 实机取证）——CodegenDialog/CheckDialog 删除，useGenerationFlow composable + PreflightPanel 页内检查 + Project settings 唯一决议中心（选项/门禁/预览决议/结果报告全页内），Pinout 导出按钮跳转 settings。
- M6（v0.07）：Runtime 一等公民（blocking/embassy 选择器，rtic 禁激活待核实）/ HTML 单文件报告（report.html，generated 组）/ 全局 Undo-Redo（Ctrl+Z/Y，快照栈合并窗口）/ 封装拖拽移动信号+90°+Bottom 镜像（文字可读性矩阵验证）/ 时钟节点 foreignObject 内联编辑 / 面板宽度持久化+拖拽调宽 / Home 芯片搜索对比表。板卡功能按用户决定取消（版权风险）。
- 类型检查 vue-tsc、ESLint（含分层边界规则）、vite build 全绿。
- validate:device：V003 / V203 / CH582M / H417 全部 0 错误 0 警告。
- verify:build：V003 ✓ / V203 ✓ / H417 双核 workspace ✓（CH582M 按设计被 halBackend 守卫拦截）。
- 工程化重构等价性验证：codegen 160 次全量差分逐字节一致；clock tree 4 芯片 ×198 配置深比较一致；templates 33 导出运行时逐字节比对一致；快照 0 改动。
- 网络受限推送：`scripts/git-api-push.mjs`（github.com 被断时经 api.github.com Git Data API 逐提交推送，树对齐断点续推，内容寻址保证远端 sha 与本地一致）。
- 集成期修复的真实 bug：EXTI Pull 变体名（UP→Up）、ADC 双实例共享通道引脚重复移动（改为单归属）、packageSvg 旋转双重平移、ADC 占用判定过严、matchPreset 缺省 pllSource。
## 8. 生成工程结构（对照 CubeMX1 / CubeMX2）

```
<projectName>/
├── Cargo.toml / rust-toolchain.toml / .cargo/config.toml / build.rs / rust-analyzer 目标 json
├── cube.json            # 配置快照，可导入本工具继续编辑（= CubeMX1 的 .ioc）
├── README.md / .gitignore
├── src/
│   ├── main.rs          # 用户代码区：生成器永不覆盖；用户可新增任意 Rust 模块（无位置限制）
│   └── generated/       # 每次导出整体重写：mod/clock/pins/exti/usart/spi/i2c/adc
└── vendor/ch32-hal/     # 完整 HAL 源码（path 依赖，可跳转阅读；可关开关退回 git 锁 rev）
```

对照结论：
- **配置存储**：cube.json ↔ CubeMX1 `.ioc`（导入/导出往返，见 src/lib/projectFile.ts）；
- **生成区隔离**：`src/generated/**` ↔ CubeMX2 `generated/`（用户代码零侵入）；
- **用户代码**：`main.rs` 永不覆盖 + Rust 模块任意位置 ↔ CubeMX2 的"无代码位置限制"；
- **厂商库**：`vendor/ch32-hal/` ↔ CubeMX1 `Drivers/` / CubeMX2 `stm32c5xx_drivers/`；
- **构建系统**：Cargo + rust-toolchain + .cargo ↔ CMake + Presets（各自生态等价）；
- 不采用 CubeMX1 的 `USER CODE BEGIN/END` 注释块（Rust 无预处理器，物理隔离更可靠）。

## 9. 交付形态与桌面化路线（已完成 v0.01）

- **已交付形态**：Tauri 2 桌面应用（`src-tauri/`）+ 浏览器模式共用同一份 `dist/`，前端代码未改。
- 桌面端已替换的能力（接口保持前端调用方式，按运行环境自动分流）：
  1. 目录导出：`showDirectoryPicker`（浏览器）→ 原生目录对话框 + `write_files` Rust 命令（桌面）。
  2. ZIP / cube.json：浏览器 `<a download>` → 原生“另存为”对话框 + `write_file`（桌面，WebKitGTK 不处理浏览器下载）。
  3. 构建产物：`npm run desktop:build`，Linux 便携包见 GitHub Releases `v0.01`。
- 仍待接入（不阻塞 v0.01）：
  1. 本地工程列表缓存（替代 localStorage）。
  2. 拉起 `cargo build` / `wlink` 烧录（本地进程能力）。
  3. 图表导出 PNG/SVG、应用内更新。
  4. Windows / macOS 产物（需对应平台构建）。

## 10. M16-D12 时钟树 MX2 主干重构（2026-11-18 夜）

- 用户参照 CubeMX2 截图裁决：输入左竖排 / SystemClock 水平主干 / 输出右列**上下并联竖排** / 外设**单列上下并联**（「并联是上下并联不是左右」，取代 D11b 左右均衡列）。
- CORE/SYSTICK 为 aux 派生仅显示行（`deriveDiv`/`group` schema 扩展）；SysTick 逐芯片 HAL 事实：QingKe V2/V4/X035/H417=HCLK、V3/CH582=HCLK÷8（HAL notes §16.6 表）。MX2「To Power」WCH 无独立域不造假行。
- TIM/USB/ADC/APB 归 g-out；E 列读数卡右对齐 1400；lanes 共享走廊=竖直干线观感；坐标基线实测偏离见契约 D12bis。
- 门禁：1524 测试（clockTree 127 含 28 D12 断言）/ validate 7 芯片 0/0 / tsc/eslint/build / verify 6/6+embassy 6/6+BLE(CH582) 1/1；七芯片浏览器 fit 截图验收；clock.png 刷新（V203 48%）。
- 教训：子代理后端瞬时故障（8 连 Model request failed）→ 主控直执 E 域小扩展后再重启子代理（用户切换 API 后恢复）；IAB 表格行/Continue 点击 actionability 失败 → evaluate dispatch MouseEvent；芯片表分页（X035/CH582 在第 2 页）→ wizard 搜索框过滤；cua drag 起点落在节点上会选中文本（截图蓝块伪影）→ 空白处起拖+removeAllRanges。

## 11. v0.1.0 发布与三平台自动构建（2026-11-18 夜）

- **MIT 许可** + README 重写；上游 ch32-hal/ch58x-hal/ch32-data 核实 MIT/Apache-2.0 双许可，vendor 全量 walk 随附许可证副本（再分发合规）。
- `.github/workflows/release.yml`：tag v* → draft → 矩阵（ubuntu-22.04 deb/rpm/AppImage+便携 tar.gz；macos universal dmg/app 未签名；windows nsis/msi）→ sha256 → publish；dispatch 仅构建。`ci.yml`：push/PR lint+build+test+validate。用户 Win 本地自动构建保留。
- 干跑 3/3 绿后推 tag v0.1.0@a9afa6a → run 44321903872 全绿自动转正式，15 assets（各附 sha256，app.tar.gz 除外）。发布说明 /tmp/release-notes-v0.1.0.md 套用。
- 版本号四处早已对齐 0.1.0（package.json/package-lock/tauri.conf.json/Cargo.toml+lock），无需 bump。
- 教训：workflow 注册秒级延迟（push 后立即 dispatch 404）；Git Data API 建 tag 可触发 push-tag 工作流；gh run watch 瞬时断网退出≠run 失败→容错轮询。
