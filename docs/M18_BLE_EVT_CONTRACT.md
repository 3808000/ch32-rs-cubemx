# M18 BLE EVT 对照测试矩阵 + clean-room 重写 spike 契约

> 立项 2026-11-19：用户要求参照 WCH EVT 全部蓝牙例程「每个搓一下测试程序」，并评估向 ch5xx-hal 提 BLE PR。经法律/工作量讨论后用户裁决：**先维持 vendored blob 路线；上游 issue/PR 一律暂缓，等 Rust 重写完成后再提**。本期交付 = EVT 对照测试矩阵 + 重写可行性 spike（仅报告）。
> 规格真相源：`docs/m18-evt-specs.md`（CH583EVT.ZIP 解包于 `/home/teze/CH32/EVT/CH583EVT/`，独立新目录；**仅事实参数表，不含 WCH 源码表达**——版权清洗见该文档头注）。
> 重写 spike：`docs/m18-cleanroom-spike.md`（条款原文/开源 LL 盘点/RF 黑盒占比/隔离流程/路线图）。

## D1 范围与裁决

- 测试 bin：`ble-evt-tests/`（22 个，ch5xx-hal @875651b6 + ch5xx-ble shim；path 依赖因 HAL build.rs 需兄弟 `../ch5xx-data`）。**独立实现**：实现组只读 specs 事实表与 shim API，不读 EVT `.c/.h`（clean-room 纪律，避免 WCH 源码表达派生）。
- 不适用清单（文档化理由，不做 bin）：MESH×15（需 Provisioner）、LWNS×9（私有栈需多板）、RF_PHY/RF_PHY_Hop（需第二块板）、Direct_Test_Mode（射频仪器/USB）、peripheral_ancs_client（需 iPhone）、BLE_USB（需 USB 栈）、BackupUpgrade_IAP/JumpIAP、OnlyUpdateApp_IAP/JumpIAP（无 BLE 应用）。
- **安全边界**：OTA bin 的擦/写/校验/结束命令（0x80/0x81/0x82/0x83）stub 为 ATT 错误，**绝不写 flash**；仅 INFO(0x84) 只读应答。SNV 保持 off（bonding 仅 RAM）；sleepCB None（EVT 亦未启用 HAL_SLEEP）。
- 上游：**本期不开 issue/PR/fork**。重启条件（spike C1–C4）：重写完成 + 实机矩阵 + 许可清理 + clean-room 证据链。

## D2 shim M18 扩展（vendor-src/ch5xx-ble）

- ffi 补 25 符号（链接验证 T）：GAPRole_CentralStartDiscovery/CancelDiscovery/EstablishLink/UpdateLink/UpdatePHY；GATT client 16（InitClient/RegisterForReq/RegisterForInd/ExchangeMTU/Disc*/Read*/Write*）；GATTServApp_ProcessCharCfg（**7 参**，第 7 为读回调）；linkDB_NumConns/NumActive；GAP_NumActiveConnections。签名以 CH58xBLE_LIB.h 逐字为准（头文件缺的 5 个由反汇编恢复，注记 m17-shim-notes §12）。
- 新 `client.rs`：gattMsgEvent_t 解码、发现/MTU/读/写封装、变长 notify/indicate（bm_alloc 尺寸正确、失败 free）。
- `gattservapp.rs`：register_services（多服务顺序注册）、process_char_cfg（按连接 CCCD 批量通知）。
- `gap.rs`：gapCreateSync_t + GAPRole_CreateSync + GAPRole::create_sync（周期广播同步）；常量已在 ffi.rs 不重复。
- `Options{buf_max_len,mem_len,connect_number,buf_number,tx_power}` + `init_with`；`init()`=默认 Options（**生成器产物逐字节不变**）；heap 固定 10KiB 静态、MEMLen 取 opts（>10KiB 返回 INVALID_MEM_SIZE）。

## D3 测试 bin 与宿主判据（22）

peripheral 族（宿主 bluez 连接+读写+notify）：evt_peripheral（FFE0/FFE1–FFE5，FFE4 1600ms 0x88）、evt_onlyupdate_peripheral、evt_heart_rate（180D/2A37 2000ms bpm73–80 +180F）、evt_cycling（1816/2A5B 1000ms 11B）、evt_running（1814/2A53 2000ms 10B）、evt_hid_keyboard/mouse/consumer/touch（1812+180F+1813，2000/800/1600/100ms 报告）、evt_speedtest_peripheral（MTU247 满包流）、evt_ble_uart（FFF0/FFF1/FFF2 + **BLE echo 回环** + UART3 PA5/PA4）、evt_ota_peripheral（FEE0/FEE1 发现+INFO 只读）、evt_iochub_16bit（FFF3/FFF4/FFF5 3000ms）。
广播/扫描：evt_broadcaster（100ms NONCONN，宿主被动扫）、evt_observer（3s 主动扫重扫，宿主 peer_advertiser 广播 M18-ADV）。
central 族（宿主 peer_peripheral 当 GATT 对端 M18-PEER）：evt_central、evt_centperi、evt_multicentral（3 槽）、evt_multicentperi（3P+3C）、evt_speedtest_central（吞吐计数）。
周期广播：evt_sync_adv / evt_sync_scan —— **build-only**（BlueZ 无周期同步 API、单板；需第二块板对跑）。
偏离统一注记：固定 nominal MAC（EVT 部分例程 BLE_MAC=1）、central 对端按名匹配（EVT 固定 MAC）、bonding RAM-only、UART 日志走 UART1 PA9。

## D4 宿主 harness（/tmp/m18-ble-host/，不入仓库）

test_peripheral.py（扫名→连接→服务/特征集+flags 核对→读/写/读回/notify 计数与间隔中位数→JSON）、peer_peripheral.py（GattApplication1+LEAdvertisement1，FFE1 写回显 notify）、peer_advertiser.py（broadcast M18-ADV）、throughput.py、run_case.sh（结果落 results/<case>.json+.log）。烧录由主控 pkexec OpenOCD `program <abs elf> verify reset exit`（**ELF 必须绝对路径**，pkexec 改 cwd）。

## D5 验证状态（诚实分级）

- 22+1 bin `cargo build --release --bins` 绿（nightly + build-std=core，riscv32imac；+evt_uart_dbg 诊断）。
- 仓库门禁 1631/63 绿、tsc/eslint/validate 0/0。
- **根因链（全部 UART/寄存器直证，取代此前 bisect 相关性；生成器产物无缺陷，M17 参照产物同板同时刻全通作 A/B 基准）**：
  1. **漏 `GAPRole_PeripheralInit()`** → `PeripheralStartDevice`=INVALIDPARAMETER(0x02)、gapRole state 永停 0、广播不上空口。其余角色 bin 各有 `<Role>Init()`，唯 peripheral 漏。
  2. **svc 属性编码错**：WCH blob 要求主服务声明的 `value` 指向 `GattAttrType{len,uuid*}`（M17 生成器编码），而非裸 UUID u16 指针；裸指针使 Read-By-Group-Type 遍历读到垃圾 UUID → bluez 发现 0 服务。修复：`svc(&UUID_x_T)` + 每服务 `_T` 静态。
  3. **初始化顺序**（M17 硬件验证序，A/B 实证必需）：role init → adv 参数 + `ADVERT_ENABLED=true` → GGS/GATTServApp → `init_char_cfg`+服务注册 → 设备名 → StartDevice。服务先于 role task 注册、或广播仅在 StartDevice 后使能 → GATT 发现无响应/不广播。
  4. **LSI 32K 时钟毁连接时序**：`SelRTCClock=1`（内部 RC）下连接事件与对端窗口 widening 失配 → ATT 全丢、发现挂起、监督超时断连（reason 0x08）；广播本身容忍 LSI。**改 LSE（外部晶振，M17 同源）后全通**——偏离 EVT `CLK_OSC32K=1`，注记为板级实测裁决。
  5. **blob ISR 踩 s1**：WCH blob 的 BB/LLE 处理路径破坏 callee-saved s1（主循环 SysTick 基址存于 s1）→ mcause=4 取指/ load 异常 → DefaultHandler 挂死（boot 后 18–84s 不定，连接/扫描负载下更早）。qingke-rt 默认 wrapper 仅存 ra。**修复：`ble_isr!` 宏全存 ra+s0–s11**（.trap RAM wrapper，直接 auipc/jalr 到 blob handler）。
  6. 配套：shim pubsub 订阅者必须存活并在主循环 drain（`TmosEvent::Drop`=`tmos_msg_deallocate`；M17 `tmos_poll` 同型）；StartDevice 传 shim hal_task_id（不另注册 app_task）；GAP 连接事件经 `pfnStateChange(newState,pEvent)` 分发（WCH peripheral 角色不向 app task 发 TMOS GAP 消息）；WAITING 态自动重开广播。
- **实机矩阵（诚实分级，CH582M + CH-Link + bluez）**：
  - **完整判据 PASS ×9**：evt_peripheral（FFE0/FFE1–5 全特征+flags、初值读、写回读、FFE4 notify 0x88 中位 1560ms/标称 1600ms）、evt_heart_rate（180D/2A37 notify 中位 1950ms/2000ms + 2A38 读 + 2A39 写 + 180F/180A）、evt_cycling（1816/2A5B notify 1000ms）、evt_running（1814/2A53 notify 2000ms）、evt_speedtest_peripheral（满包 notify 流）、evt_onlyupdate_peripheral（FFE3 写=OTA-jump stub 主动断连，设计行为，判据排除该项）、evt_ota_peripheral（FEE0 发现 + FEE1 read/write + INFO 0x84 写；FEE1 实现无 notify CCCD——INFO 应答仅 UART，偏离 EVT notify 路径，注记）、**evt_iochub_16bit**（FFF3/FFF4 notify 中位 3119ms/标称 3000ms + FFF5 写；早前连接失败系 RF 模拟态污染残留，非 bin 缺陷）、**evt_ble_uart（无 UART3 变体 evt_ble_uart_nu）**——连接/FFF0/FFF1 notify/FFF2 写/**BLE 回显 notify 全过**。
  - **PA4/PA5（UART3）板级冲突（新发现，A/B 实证）**：`Uart::new_blocking::<0>(UART3, PA4, PA5)` 初始化后，广播正常但 **LL 不接受连接请求**（bluez 侧 `abort-by-local`，板端无 gap state 4）；移除 UART3 初始化（`evt_ble_uart_nu`）后连接立即恢复并全判据通过。规格忠实 bin `evt_ble_uart` 保留 EVT 的 UART3=PA5/PA4 用法，注释板级冲突；BLE 侧验收以 nu 变体为准。推测 PA4/PA5 在本板接 RF 前端（PA/LNA 控制）或该初始化扰动射频，待原理图确认。
  - **HID 族（keyboard/mouse/consumer/touch）部分 PASS**：发现+全特征集+读 PASS；**CCCD 写被 ATT 分发层在服务回调前拒（ATT 0x0e），服务写回调不被调用**（9600 无丢字节 UART 证实无 `wr` 打印）；新鲜 RF 态复测仍复现 → 非状态污染，为真实 blob 行为（simple/csc/uart/iochub 的 CCCD 同路径却成功）。反汇编证据：`GATTServApp_ProcessCCCWriteReq` 只返回 0x0d（len≠2）/0x80（cfg 位非法），`InitCharCfg` 不维护全局表链表 → 0x0e 源于 att_server/gatt 分发对 HID 表的校验路径，待续查。另已排除服务数量因素（hid-only 变体同表 2 个 CCCD 仍 0x0e）。
  - **RF 模拟态粘滞（操作要点）**：每次连接+断连后板子常停止广播（主循环正常、TMOS 在泵、非 panic；`halt; reg pc 0; resume` 软重启或全断电恢复）——**判据测试一律「新鲜烧录 reset exit → 立即测试」，一测一烧**；失败连接尝试也会污染后续测试，需先软重启。
  - **BLOCKED（无对端）**：central 族（宿主 GattManager1.RegisterApplication 超时待修）、observer（peer_advertiser 待重建）。
  - **build-only**：sync_adv/sync_scan（需第二块板；BlueZ 无周期同步 API）。
- **探针/宿主教训（本轮新增）**：
  - wch_riscv 目标 **`reset halt`/`reset run` 是空操作**（无 reset handler）——`program verify`+`reset halt`+`resume` 不会重启固件（RAM 名字符串取证证实旧固件继续跑）！可靠复位：`program <elf> verify reset exit`（多数有效）或 `halt; reg pc 0; resume`（软跳转复位，亦偶发失效）；**每次烧录后必须用 UART boot banner 或广播名验证固件身份**。
  - CH-Link 串口桥接 115200 突发丢字节（boot banner 残缺）；**诊断期降 9600 可全量捕获**；稳态逐行 115200 可用。
  - bluez 设备缓存跨固件切换残留（旧名/旧服务集）→ 换 bin 前 `Adapter1.RemoveDevice`（必要时先 StartDiscovery 使设备对象存在再删）。
  - **`SetDiscoveryFilter(Transport=le)` 会让本机 bluez 漏报该设备**（同刻无 filter 的裸 StartDiscovery 必命中，A/B 复现）→ harness 已移除该调用。
  - 旧事故：root openocd 占 USB → pkexec kill；`pkill -f openocd` 自杀 → `pkill -x`；pkexec 改 cwd → 绝对路径；休眠恢复 WCH-Link 掉线 → 重插/端口断电（`3-2-port2/disable`）；autosuspend 已关。

## D6 文件域

主控：本契约、HAL §18、ROADMAP/MEMORY/README、实机矩阵、门禁、提交。子代理 S1 规格、S2 shim、S5 spike 已交付；S3/S4 被用户中断后由主控接手完成 bins 与 harness。