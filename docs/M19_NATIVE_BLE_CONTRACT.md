# M19 原生 BLE 协议栈（Rust、无 WCH blob）契约 — Phase A：LLE + 广播/扫描

> 立项 2026-11-23。用户裁决「接下来该用 RUST 重构蓝牙协议栈」后启动。
> 定位：M18 spike 的 M19+ 重写从「报告」转为「实现」。本文件是 Phase A 的契约与实机证据；后续 Phase 追加在文末。
> 上游 issue/PR 仍暂缓（M18 裁决），直到重写满足 C1–C4。

## D1 关键前置：G1/G5 解除（取代 spike §4.6 的阻塞结论）

M18 spike 判定「RF/BB/LLE 寄存器与校准布局无公开文档 → 重写无法上真机」。本期找到合法且已实测的公开基座：

- [cnlohr/ch32fun `examples_ch5xx/iSLER`](https://github.com/cnlohr/ch32fun/tree/master/examples_ch5xx/iSLER) / [`extralibs/iSLER.h`](https://raw.githubusercontent.com/cnlohr/ch32fun/master/extralibs/iSLER.h)：**MIT**，给出 CH582/583 的 BB/LLE/RF 寄存器地址、位域、三频点 TX 调谐与 RX 滤波调谐序列，并在 CH582 上实测 1M/2M/Coded 收发可用，全程不链接 WCH blob。
- 该文件是第三方独立实现（MIT），**不是 WCH 源码或反编译产物**；许可证全文随 crate 保存于 `ble-native/LICENSE-ch32fun`，来源与版权见 `ble-native/NOTICE`。
- 因此 G1（寄存器映射）与 G5（校准来源）以「公开 MIT 事实 + 实机复验」关闭；不需要 NDA，也不做 WCH 二进制逆向。G2（硬件 AES）仍留待 SM 阶段（可先软实现 AES-CCM）。

## D2 交付物

- 新 crate **`ble-native/`**（不依赖 `ch5xx-ble`，不链接 `LIBCH58xBLE.a`）：
  - `src/rf.rs`：BB/LLE/RF 寄存器驱动、初始化、TX/RX 三频点调谐、`BLEL` ISR、阻塞 TX / 轮询 RX。
  - `src/adv.rs`：legacy 广播 PDU 构造（ADV_NONCONN_IND）与扫描侧 PDU/AD 解析、地址与 hex 格式化。
  - `src/clock.rs`：LSE（CK32K）选择；`src/log.rs`：UART1/PA9 日志；`src/board.rs`：上电序列。
  - bins：`native_adv`（100 ms × 37/38/39 广播）、`native_scan`（100 ms/信道被动扫描 + 去重日志）、`diag_rx37`（锁信道原始帧 dump，诊断用）。
- 构建：nightly + `rust-src` + `build-std=["core"]`，目标 `riscv32imac-unknown-none-elf`（与 `ble-evt-tests/` 一致）。
- 文档/许可：`docs/M19_NATIVE_BLE_CONTRACT.md`（本文）、`ble-native/NOTICE`、`ble-native/LICENSE-ch32fun`。

## D3 实现要点（CH582/583 分支）

- 寄存器基址：BB `0x4000_c100`、LLE `0x4000_c200`、RF `0x4000_d000`；`BLEL` = IRQ 21（qingke-rt/metapac 向量表已接线，不需要 ch32fun 的 `VTFIDR` 方案）。
- 初始化（`rf::init`）：`LLINT_EN=0xf00f`、`RXBUF=LLE_BUF`、状态清除、RF10=0x480、BB13=0x1d0、TX 功率写入 `CTRL_TX`、BB8 PHY 配置；随后 `Tune()`：模式 `0xDD` → 2401/2480/2440 MHz 三点 TX 调谐（CO 插值 20 点、GA 插值 6 点）→ RX 滤波调谐 → 模式 `0x80`。
- 帧格式：TX 缓冲 = `[PDU header, payload len, payload...]`；基带自动加前导/接入地址/CRC；CRC init 写 `0x555555`（空口 `0xAAAAAA` 的位反转）。RX 缓冲同布局，`BB12.RSSI>>15` 取 RSSI。
- ISR：`LL_STATUS` 回写应答；TX 完成 → `TX_DONE`；RX 完成 → 回写 `CTRL_TX`、`stop()`、置 `RX_READY`。TX/RX/stop 均在 `.highcode`（RAM）。
- 时序：M19-A 不做连接，无需 625 µs 锚点；调度为主循环 + 100 ms 窗口。扫描器**整窗驻留**并在每帧后原地重臂（早期「首帧即跳信道」版本在密集环境下每信道驻留 < 1 ms，系统性漏掉稀疏广播——实机 A/B 定位，见 D4）。
- 平台：仅 CH582/583；CH570/571/584/585/591/592 的寄存器差异未移植（crate 编译特性固定 `ch582`）。

## D4 实机验证（CH582M + CH-Link + BlueZ 5.88，诚实分级）

- **构建 + 无 blob 证明**：`cargo build --release --bins` 绿；`nm` 在 `native_adv`/`native_scan`/`diag_rx37` 中 **0 命中** `BLE_LibInit`/`TMOS_SystemProcess`/`GAPRole_*`/`RF_Tx`/`*_IRQLibHandler`。
- **原生广播 PASS**：OpenOCD `program … verify reset exit` 后，宿主 `bluetoothctl scan on` 报
  `0C:3D:5E:A6:62:94` → `Name: M18-NATIVE`、`RSSI -50`、`Connectable: no`（ADV_NONCONN_IND 语义正确）；板端 UART 每 100 ms 一轮、每 10 轮一行计数稳定。
- **原生扫描 PASS（受控对端）**：宿主 `peer_advertiser_m19.py`（M18-ADV + 厂商数据 `FF FF "M18-ADV"`）注册成功后，板端 16 s 日志：
  - ADV_IND：`E0:3A:AA:B5:AD:73`，RSSI −28…−31，`mfg "FF FF 4D 31 38 2D 41 44 56"`（= `M18-ADV`），多轮命中；
  - SCAN_RSP（type 0x04）：同一地址，`name "M18-ADV"`；
  - 总量 3184 帧 / ~15 s（≈212 帧/s），覆盖 200+ 唯一地址，名字解析与 BlueZ 所见一致（如 `LAPTOP-U8O29UNU`）。
- **A/B 定位**：同刻 WCH blob 的 `evt_observer`（主动扫描）亦报 `E0:3A:AA:B5:AD:73 / M18-ADV / −33 dBm`，证明对端在空口；原生扫描初次漏收被定位为**驻留时间设计缺陷**（非 RX 解调问题），锁信道 `diag_rx37` 在同信道可稳定收到该对端（含厂商标记）后修正扫描器。
- **证据日志**：`/tmp/m19-uart-adv2.log`、`/tmp/m19-adv-scan2.txt`（广播）；`/tmp/m19-uart-scan7.log`（受控扫描，含 marker 与 `M18-ADV`）；`/tmp/m19-uart-observer.log`（blob A/B）；`/tmp/m19-uart-rx37.log`（锁信道原始帧）。

## D5 已知边界（不得夸大）

- **仅被动扫描**：未实现 active scan（收到 ADV_IND 后 150 µs T_IFS 内发 SCAN_REQ）。当前 SCAN_RSP 是「顺带听到别的扫描器触发的响应」，不是本栈主动请求。
- **无连接**：无 CONNECT_IND / 锚点 / CSA#1 跳频 / SN-ACK / 加密；GAP/GATT/SM 均未开始。
- **校准**：初始化时固定三频点调谐；无温度重校准（spike G5 的温补路径仍待做）、无 DTM/灵敏度指标。
- **平台与配置**：仅 CH582/583 1M PHY 验证；TX 功率固定 0 dBm；MAC 为常量（未读 InfoFlash）；必须 LSE；SNV/绑定未涉及（本阶段无 flash 写）。
- **扫描窗口**：以空闲轮询计数近似 100 ms；持续满负荷收包时窗口会延长（无硬件定时器兜底），后续用 LLE TMR 统一时基。
- **许可边界**：`ble-native` 为独立 MIT/Apache-2.0 实现，但寄存器事实来自 MIT 的 ch32fun；对外发布需保留 `NOTICE`/`LICENSE-ch32fun`。clean-room 的人员隔离与留痕（spike §5）尚未按正式流程建立，上游 PR 前必须补齐。

## D6 下一阶段（按依赖排序）

| Phase | 内容 | 退出门禁 |
|---|---|---|
| B | LL 连接：CONNECT_IND、锚点/窗口、CSA#1、SN/ACK、监督超时 | 与 BlueZ 稳定连接 ≥30 min、丢包可测 |
| C | L2CAP/ATT/GATT server：MTU 交换、服务发现、读写、CCCD/notify | BlueZ 完成发现 + 读写 + notify |
| D | SM：legacy pairing、LE Secure Connections、绑定（RAM-only 先行） | 与 BlueZ 配对/重连成功 |
| E | active scan + T_IFS 调度；扩展广播 | 主动扫描拿到 SCAN_RSP；EVT observer 对等 |
| F | RF 温补/DTM/灵敏度；与 blob 的 A/B 指标 | 指标达标 + 可重复 DTM |

> 说明：B 起需要把「主循环 + 阻塞延时」换成 **625 µs 时基的调度器**（LLE TMR0–2，2 MHz 计数），否则连接事件无法对齐；这是 M20（调度/内存）的实际入口。
