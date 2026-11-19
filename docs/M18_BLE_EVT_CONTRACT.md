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

- 22/22 bin `cargo build --release --bins` 绿（nightly + build-std=core，riscv32imac）。
- 仓库门禁 1621/63 绿、tsc/eslint/validate 0/0。
- 实机矩阵（部分，诚实分级）：
  - **PASS**：evt_broadcaster（btmgmt find dev_found 0C:3D:5E:A6:62:94 rssi -38 flags 0x04；bluez StartDiscovery 按规范过滤 flags 0x04，须用 btmgmt find）；peripheral 角色+完整 simple GATT+bond+连接参数广播（dbg15 对照 bin）；完整 GATT 读/写/notify（M17 上午 ×2，同 shim API）。
  - **BLOCKED（广播静默，根因未决）**：evt_peripheral 及 peripheral 族 bin。读证：gapRole_AdvEnabled=1、AdvEventType=0、向量表 BLEB/BLEL 已接线、mstatus MIE=1、SysTick 自由跑、PC 在 TMOS 泵内。bisect：name-only scan-rsp + no-op hooks + 无 CTX → 广播（dbg15）；换真实 hook  bodies/CTX（dbg16）→ 静默；scan-rsp 加 tx_power 或 conn_interval_range TLV → 静默（dbg13/14）；全局 InitCharCfg(0xFFFF) 相关性未证实；blob V1.90 与 EVT V2.13 表现相同。电源循环可恢复模拟态（软复位不复位 RF/32K 假设成立一次），但非本缺陷根因。
  - **BLOCKED（无观测通道）**：central 族（宿主 GattManager1.RegisterApplication 超时；bin 日志仅 UART1 PA9，无串口适配器）、observer（同）。
  - **build-only**：sync_adv/sync_scan（需第二块板对跑；BlueZ 无周期同步 API）。
  - 下一步解锁条件：UART USB-串口适配器接 PA9（读 bin 日志）或第二块 CH582 板；或 lib 反汇编级分析（另行授权）。
- 探针事故注记：被停后台任务遗留 root openocd 占用 USB（claim interface failed）→ pkexec kill 清理；`pkill -f openocd` 会匹配自身命令行自杀 → 用 `pkill -x openocd`。

## D6 文件域

主控：本契约、HAL §18、ROADMAP/MEMORY/README、实机矩阵、门禁、提交。子代理 S1 规格、S2 shim、S5 spike 已交付；S3/S4 被用户中断后由主控接手完成 bins 与 harness。