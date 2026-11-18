# M12 CH58x BLE 协议栈生成 + 调试链契约

> 真相源：`reference/ch58x-hal` @ `611954e`（src/ble/* 2909 行 + 5 个 BLE 示例逐字核实，2026-11-18 调研报告）。
> M11 基础契约见 CH58X_BACKEND_CONTRACT.md（D1–D16 继续有效：imc target / generic-queue / edition 2021 / qingke-rt 0.5 等）。
> 类型挂载点已预建：`ProjectConfig.features.ble?`、`ProjectConfig.ble?: BleConfig`、`DEFAULT_BLE_CONFIG`、
> 冲突码 BLE_REQUIRES_EMBASSY / BLE_LSE_PIN_IN_USE / BLE_ADC_SHARED / BLE_LOG_SERIAL_UNAVAILABLE / BLE_NAME_TOO_LONG / BLE_MAC_INVALID。

## 1. 核实事实（生成器必须遵守，证据行号见调研报告归档）

- **feature 耦合**：`ble` 必须与 `embassy` 同开（src/ble/mod.rs:5-6 无条件 use embassy_sync）；Cargo features = `["embassy","ble"]`（default-features=false）。vendor/LIBCH58xBLE.a 仅 ble feature 链接（build.rs:9-11，zip 已含）。
- **LSE 必须**：`cfg.SelRTCClock = 0` 硬编码（mod.rs:190），Config 无开关；时钟生成必须 `.enable_lse()`（5 示例一致）。LSI 不可用而不改 HAL。
- **init 顺序不可乱**：`hal::init` → `hal::embassy::init` → `ble::init(Config)` → `GAPRole::{peripheral,broadcaster,observer}_init` → `GGS_AddService(GATT_ALL_SERVICES)` + `GATTServApp::add_service(GATT_ALL_SERVICES)` → （peripheral）`register_service` → `*StartDevice`。
- **TMOS 泵**：独立 `#[embassy_executor::task] #[highcode] async fn tmos_mainloop()`，`Ticker::every(Duration::from_micros(300))` + `TMOS_SystemProcess()`（5 示例一致，不可省）。
- **TmosEvent 单订阅者**：`struct TmosEvent(pub *mut tmos_event_hdr_t)`，Clone+Drop 都调 tmos_msg_deallocate → **2 个订阅者消费同事件 = double free**。只用 init 返回的那一个 subscriber，不 clone 不转发；处理完即 drop。
- **imc 无原子**：示例 ble-blinky/ble-led-button 用 AtomicBool/AtomicU16（imac 目标）→ **生成模板禁用 core::sync::atomic**；共享状态用 `embassy_sync::channel::Channel<CriticalSectionRawMutex, AppEvent, N>` 或单任务内 Cell（embassy-sync 0.6.2 需直依赖）。
- **MAC**：`Config::default()` = 11:22:33:44:55:66；`mac_addr = [AA,BB,CC,DD,EE,FF].into()`（from_msb 人读序）；`use_factory_mac_address()`（ISP ROM，libISP583.a 已无条件链接）。
- **设备名三处同步**：`GGS_SetParameter(GGS_DEVICE_NAME_ATT, len, ptr)` + scan-rsp TLV `GAP_ADTYPE_LOCAL_NAME_COMPLETE` + adv TLV（SHORT/COMPLETE）。adv/rsp 各 ≤31 字节（含 TLV 头），GAP 名 ≤248。
- **单位**：广播间隔 `TGAP_DISC_ADV_INT_MIN/MAX` = 0.625ms/单位（u16）；连接间隔 `GAPROLE_MIN/MAX_CONN_INTERVAL` = 1.25ms/单位（u16）；扫描窗口 `TGAP_DISC_SCAN` = 0.625ms/单位。
- **广播参数走 raw param ID**（无类型化结构）：`GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED/ADVERT_DATA/SCAN_RSP_DATA/ADV_EVENT_TYPE, len, ptr)`；broadcaster 类型 `GAP_ADTYPE_ADV_NONCONN_IND=3`。
- **GATT 表**：`static mut [GattAttribute; N]`（句柄由 stack 注册后填写，**注册后才能读 handle**）；CCCD 表 `[gattCharCfg_t; 4]` zeroed + `init_char_cfg(INVALID_CONNHANDLE, …)`；写回调必须调 `GATTServApp::process_ccc_write_req`；notify 的 pValue 必须 `GATT_bm_alloc`（失败补 GATT_bm_free）；读回调 offset>0 → ATT_ERR_ATTR_NOT_LONG，未知 UUID → ATT_ERR_ATTR_NOT_FOUND。
- **回调 'static**：所有 *StartDevice 收 `&'static` 回调结构（函数内 static）。
- **断连恢复**：GAPROLE_WAITING + GAP_LINK_TERMINATED_EVENT → 重设 `GAPROLE_ADVERT_ENABLED=true`；CCCD 断连重初始化。
- **硬编码不可配**：ATT_MTU=23（BufMaxLen 27）、TX 6dBm、1 peripheral + 3 central 连接、无 SNV（绑定不落 flash）。
- **耦合警示**：BLE `temperature_raw` 会 steal ADC（与用户 ADC 冲突 → warning）；RTC 被 BLE 占用（不生成 RTC 写配置）；`hal_tmos_task` 吞未识别事件位（不注册自定义 TMOS 事件）；`gapbondmgr.rs` 是死文件（GAPBondMgr_* 从 ffi 导入）。
- **PA10/PA11 = X32KI/X32KO**：HAL 无映射证据（板级约定，chip.json 已标 special osc）；BLE 启用时这两脚被分配 → error。
- **角色覆盖**：peripheral/broadcaster/observer 有完整示例；**central 无示例 → 本期不开放**（UI 不列）。

## 2. 设计决策 D1–D12

- **D1 数据模型**：`features.ble` 开关 + `ble: BleConfig`（已预建）。缺省 DEFAULT_BLE_CONFIG（peripheral/factory MAC/100ms/FFE0-2）。cube.json 往返保留（parseProjectFile 未知字段保留机制已覆盖，需校验 ble 结构宽松解析）。
- **D2 运行时互锁**：BLE ⇒ embassy。UI：启用 BLE 自动 setFeatures({embassy:true})；BLE 开启时 blocking 单选禁用 + 说明。生成期：features.ble && !embassy → error BLE_REQUIRES_EMBASSY（导入不一致兜底）。
- **D3 时钟**：ble 开启 → clock.rs 生成 `.enable_lse()`（预设 builder 链追加）。PA10/PA11 被分配 → error BLE_LSE_PIN_IN_USE。
- **D4 生成结构**：`src/generated/ble.rs`（generated 组，每次重写）承载全部 BLE 脚手架：
  `pub fn config() -> ble::Config`（MAC/名称无关）、`pub async fn run(spawner: &Spawner)`（ble::init → role init → 服务注册 → spawn tmos 泵 + role 任务 → 事件循环 await）。
  main.rs（用户区）模板：ble 开启时末尾 `generated::ble::run(&spawner).await;`。**旧工程启用 BLE 需手动加该行或重建**（README 诚实标注，用户区永不覆盖原则不变）。
  peripheral GATT：1 primary service + notify/read 特征 + CCCD + write 特征（6 属性表，对齐 ble-blinky 结构）；读回调返回可配置初始值 0；写回调收 1 字节命令经 Channel 发 AppEvent；notify 任务周期 1s 发 1 字节状态（订阅后）。broadcaster：adv TLV（flags + manufacturer WCH 0x07D7 + 短名 + power）+ scan-rsp 完整名；observer：eventCB 打印设备地址/RSSI + 周期重扫。
- **D5 日志串口**：BLE 开启且 UART1/PA9 未被用户占用 → 生成 UartTx + set_default_serial（hal::println 生效）；被占用 → warning BLE_LOG_SERIAL_UNAVAILABLE，不生成日志 wiring（BLE 功能不受影响）。
- **D6 无原子**：模板状态全走 Channel/单任务 Cell；Cargo 增 `embassy-sync = "0.6.2"` 直依赖（ble 档）。
- **D7 冲突规则**（model/conflicts/rules/bleRules.ts，注册进规则链）：D2/D3 两 error + BLE_ADC_SHARED warning（ble && ADC enabled）+ BLE_NAME_TOO_LONG error（name UTF-8 >248 或 adv TLV 总长 >31）+ BLE_MAC_INVALID error（custom 格式非 6 段 hex）。
- **D8 Cargo**：ble → features ["embassy","ble"] + embassy-sync 直依赖；其余 M11 不变（imc/generic-queue 仅 blocking 档——**BLE 档恒 embassy，integrated queue 可用，__pender 由 main 宏提供**）。
- **D9 IDE 调试（ch58x，MRS OpenOCD 路径）**：launch.json = cppdbg attach localhost:3333（miDebuggerPath riscv-none-elf-gdb，program 同 M11 release-debug 约定）；tasks：`gdbserver (MRS OpenOCD)` = `openocd-wch -f ${env:MRS_OPENOCD_CFG}`（isBackground）、`烧录 (MRS OpenOCD)` = `openocd-wch -f ${env:MRS_OPENOCD_CFG} -c "program target/<triple>/release-debug/<pkg> verify reset exit"`（写操作仅用户发起）。README：`ln -s ~/mrs-openocd/bin/openocd ~/.local/bin/openocd-wch` + `export MRS_OPENOCD_CFG=~/mrs-openocd/bin/wch-riscv.cfg` 两条 setup + **两线调试需先开启（ISP/BOOT）诚实标注**。wchisp 任务保留为备用烧录路径。
- **D10 verify**：verify-build-entry 增 `--ble`（features.ble=true + embassy=true + ble 缺省配置）；门禁加 CH582M --ble（nightly，vendor BLE 库链接）。
- **D11 UI**：Project settings 新增 BLE 折叠节（仅 ch58x）：启用开关 / role 三选 / 设备名 / 广播间隔 ms / MAC 来源三选 + custom 输入 / peripheral UUID16 三输入 / observer scanMs + activeScan；Runtime 互锁标注；所有输入数据驱动写 store.ble。
- **D12 诚实边界（README/报告）**：MTU 23 / TX 6dBm / 无 SNV / central 不开放 / 配对策略留用户区（GAPBondMgr 仅生成缺省 pairing 参数：WAIT_FOR_REQ + bonding true + MITM false + IO_CAP_DISPLAY_ONLY，对齐 ble-blinky common_init）/ 复杂 GATT 表留用户区 / 旧工程 main.rs 手动一行。

## 3. 调试链现状（2026-11-18 实测，诚实标注）

- **MRS OpenOCD 已部署用户目录** `/home/teze/mrs-openocd/bin/openocd`（WCH fork 0.11.0+dev-snapshot 2026-10-21，v2.10；wlinke + sdi + wch_riscv；strings 含 CH58x；ldd 全系统库解析；udev 1a86:8010 已就绪）。来源：MRS V3.0.0 Linux tar.xz 只读解包（/home/teze/tmp/mrs-inspect/）。
- **只读 attach 实测失败**（6000 与 400 kHz 两档）：`WCH-Link failed to connect with riscv chip` + 官方提示「两线调试未开启需 ISP/BOOT 开启」或物理链路。探针层 OK（WCH-Link-CH549 mode:RV v2.12）。**未做任何写操作**。
- 最可能根因：CFG_DEBUG_EN=0（只读手段无法查询）。开启路径：① Windows WCHISPTool（官方最可靠）；② Linux：CH582 USB（PB10/PB11）接主机 + PB22 冷启动拉低进 BOOT → wchisp（`config set` unimplemented；`config reset` 写配置位、效果待硅片验证 → **需用户明确授权**）。
- ch32rv 0.31.4 仍无 CH58x（源码 0 命中）；probe-rs CH58x PR #4534 关闭未合并；开源 openocd fork 均无 sdi/wlinke。
- **结论**：调试/烧录链路工具已就绪且唯一可行路径明确；硅片侧两线调试开关待用户硬件操作。BLE 代码生成与编译验证不依赖此开关。

## 3bis. M13 实机修复决策（D17–D19，覆盖 D2/D3/D4 部分表述）

- **D17 busy-poll 运行时**：BLE 档 = `#[qingke_rt::entry]` blocking main + 入口 `csrs mstatus,8` + `generated::ble::run()` 全同步忙等泵（TMOS_SystemProcess + try_next_message_pure）；**stable 工具链**；无 embassy-executor/embassy-time/nightly feature；features 仍 ["embassy","ble"]（编译耦合）；features.embassy 被 ble 分支忽略。根因：SysTick WFI 停计 + qingke-rt MIE 启动缺陷（§14.2bis/ter）。**M14 更新（D21）：原 delay_us(300) 已移除——连续轮询对齐官方 C。**
- **D18 LSI 缺省**：BLE 档不追加 enable_lse()（板可能无 LSE）；PA10/PA11 保守保留不可分配。**M14 更新（D20）：原「C 库自动回退 LSI」系误判（C 为显式 CLK_OSC32K=1 配置）；「SelRTCClock=0 HAL 硬编码保留」已废止——该硬编码正是连接失败根因，生成器改自建 bleConfig_t（SelRTCClock=1）。**
- **D19 广播 flags 必带 discoverable**：`GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED`（0x06）；仅 0x04 会被 bluez 发现流程过滤（实机对照证实）。RF ISR 接线（BLEL/BLEB → LLE/BB_IRQLibHandler）保留生成（PFIC 未使能时不触发，与 C 一致）。
- 状态共享：busy-poll 单执行上下文 → `static mut + critical_section`（禁 atomic）；embassy-sync 仅 try API 类型依赖。

## 3ter. M14 连接路径修复决策（D20–D22，覆盖 D17/D18 部分表述；证据 HAL notes §14.2quater）

- **D20 stack_init 替代 ble::init + ble.clock32k 选项（32K 域一致）**：ch58x-hal ble::init 硬编码 SelRTCClock=0（LSE）+ rcCB=None（mod.rs:190/196），无法适配无 LSE 板；M13 移除 enable_lse 后硬件供 LSI、库仍按 LSE 定时 → 广播正常但连接建立必败（实机复现）。生成代码经公开 ffi 自建 bleConfig_t：**SelRTCClock 随新增 `ble.clock32k`（缺省 lse=0 / lsi 回退=1）**，clock.rs 同步生成/不生成 `config.clock.enable_lse()`；自有 6KB 堆、自有 PubSub 通道（CriticalSectionRawMutex/TmosEvent/4/2/2，与 HAL 同参）+ TMOS 任务（SYS_EVENT_MSG→publish_immediate；0x2000→BLE_RegInit+120s）、srandCB=SysTick CNT（自由运行，CTLR 只 STE）、tsCB=hal::ble::temperature_raw、rcCB=None（Calibration_LSI 在 StdPeriphDriver 非库导出，校准移植=后续增强；lsi 档连接稳定性未保证，UI 警告）。MAC 改 `mac_addr_lsb() -> [u8;6]`（MacAddress 字段私有）：factory=get_mac_address() / custom=MSB 反转 / default=[0x66,0x55,0x44,0x33,0x22,0x11]。`config()` 移除。cube.json 宽松解析 clock32k（缺省 lse）。
- **D21 连续轮询无 delay + SysTick notify 时基**：三角色主循环 `loop { TMOS_SystemProcess(); … }` 无 hal::delay_us——官方 C Main_Circulation 逐字对齐（peripheral_main.c:40）；M13 的 300µs 源自未跑通的 embassy 示例。peripheral notify 周期 = **SysTick CNT 差值 ≥ clocks().hclk（≈1s）**；不用 TMOS_GetSystemClock（非纯 getter，每圈含 __udivdi3，PC 采样占循环 5/6 时间）。连接期间 GAP/GATT 事件静默消费（阻塞 UART println 饿死 TMOS 泵）。
- **D22 烧录工具链**：CH58x 烧录一律 MRS OpenOCD `program <elf> verify reset exit`；wlink flash（无 verify）实测产出坏镜像（广播消失），不可信。wlink dump 外设读可靠性存疑（与运行态矛盾），寄存器证据以 OpenOCD+gdb 为准。WCH-Link 自发 USB 掉线重枚举时取证无效，先确认探针在线。
- **D23 notify 周期 = hclk/8（M14 中午实机裁决，覆盖 D21 的周期表述）**：stack_init SysTick STCLK=hclk_div8 → 计数率 HCLK/8（与 HAL SysTick 驱动一致；PAC ch58x-0.4.0 核实 CNT u64、STCLK_A HCLK_DIV8=0）。D21 的 `notify_period = clocks().hclk` 缺 /8 → 实机 8.00s 间隔（20s 窗口 3 包裁决）。**修正为 `clocks().hclk.to_Hz() / 8`**；fw-notify 实机复验 20 包/20s、间隔 0.97–1.19s。**M13「实测硅片 SysTick=HCLK」系误判**（§14.2ter/quater 相关表述以 §14.2quinquies 为准）。
- **验证状态（诚实，2026-11-18 中午更新）**：①LSE 全链 Rust 固件实机**连接建立成功 ×3**（bluez Connected=true；M13 固件从未连上）——根因 #5（32K 错配）坐实。②宿主 GATT 卡顿**根因实证闭环（btmon）**：AX210 在 **2M PHY 切换后首个 ACL 包 PB 标志损坏**（MTU 响应整包被标 continuation，start 丢失）→ ATT 超时；三版固件（2026-10/2025-01/2024-09）同症状排除版本回归；coex 参数在 iwlmvm 上 no-op（源码核实）。**修复 = 强制 LE 1M PHY**（btmgmt phy + ax210-phy-1m.service 开机持久化）→ GATT 发现 1.17s + 读写成功 + 零内核报错；延迟有波动（1.2–4.9s）诚实标注。③发货版 Rust 固件 stable/imc 编译通过、OpenOCD Verified OK 烧录；**手机读写成功（用户实测）+ 宿主 GATT 读写/notify 全通（1M PHY 修复后）——BLE 全链路双端闭环**；**notify 周期实机验证 ≈1s（D23 修复后 20 包/20s）**。④verify:build --ble 通过（修复模板）。

## 4. 文件域（排他）

- **A2**：`src/model/codegen/ch58x/**` 除 ide.ts/templates/ideConfig.ts（ble.ts 新 + templates/bleRs.ts 新 + mainRs/cargoToml/clockRs/index/derive 扩展）；`tests/ch58xBleCodegen.test.ts` 新（≥35 用例）。
- **B2**：`src/model/conflicts/rules/bleRules.ts` 新 + 规则链注册；`src/services/projectFile.ts` ble 宽松解析；`src/views/ProjectSettingsView.vue` BLE 节 + Runtime 互锁；`src/controllers/project.ts` ble state/setBle（最小挂载）；tests：bleRules 新 + projectFile ble 往返（新文件）。
- **C2**：`src/model/codegen/ch58x/ide.ts` + `templates/ideConfig.ts`（D9）；`scripts/verify-build-entry.ts` --ble；`scripts/verify-build.mjs` 如需；`tests/ideConfig.test.ts` ch58x 断言更新（授权，ch32 断言不动）。
- **主控**：类型/冲突码（已预建）、契约、集成、门禁、HAL notes §14、ROADMAP M12、硬件后续、推送。

## 5. 门禁

1077+ 测试全绿；tsc/eslint/validate/build；verify:build V003/V203/H417/CH582M + CH582M embassy + **CH582M --ble**；浏览器验收（BLE 节配置→生成→预览 ble.rs 逐字→ZIP）；ch32 生成物快照不变；推送。