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

## 4. 文件域（排他）

- **A2**：`src/model/codegen/ch58x/**` 除 ide.ts/templates/ideConfig.ts（ble.ts 新 + templates/bleRs.ts 新 + mainRs/cargoToml/clockRs/index/derive 扩展）；`tests/ch58xBleCodegen.test.ts` 新（≥35 用例）。
- **B2**：`src/model/conflicts/rules/bleRules.ts` 新 + 规则链注册；`src/services/projectFile.ts` ble 宽松解析；`src/views/ProjectSettingsView.vue` BLE 节 + Runtime 互锁；`src/controllers/project.ts` ble state/setBle（最小挂载）；tests：bleRules 新 + projectFile ble 往返（新文件）。
- **C2**：`src/model/codegen/ch58x/ide.ts` + `templates/ideConfig.ts`（D9）；`scripts/verify-build-entry.ts` --ble；`scripts/verify-build.mjs` 如需；`tests/ideConfig.test.ts` ch58x 断言更新（授权，ch32 断言不动）。
- **主控**：类型/冲突码（已预建）、契约、集成、门禁、HAL notes §14、ROADMAP M12、硬件后续、推送。

## 5. 门禁

1077+ 测试全绿；tsc/eslint/validate/build；verify:build V003/V203/H417/CH582M + CH582M embassy + **CH582M --ble**；浏览器验收（BLE 节配置→生成→预览 ble.rs 逐字→ZIP）；ch32 生成物快照不变；推送。