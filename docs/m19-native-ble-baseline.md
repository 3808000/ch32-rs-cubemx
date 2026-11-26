# M19 历史基线：CH582 原生 BLE

> 归档于 2026-11-24。D1–D8 保留自研实现和实机证据，D9 保留首次接入 `wchble` 的评估。当前范围、顺序和发布门禁见 [M19 正式接入契约](M19_NATIVE_BLE_CONTRACT.md)。

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
- 文档/许可：`docs/m19-native-ble-baseline.md`（本文）、`ble-native/NOTICE`、`ble-native/LICENSE-ch32fun`。

## D3 实现要点（CH582/583 分支）

- 寄存器基址：BB `0x4000_c100`、LLE `0x4000_c200`、RF `0x4000_d000`；`BLEL` = IRQ 21（qingke-rt/metapac 向量表已接线，不需要 ch32fun 的 `VTFIDR` 方案）。
- 初始化（`rf::init`）：`LLINT_EN=0xf00f`、`RXBUF=LLE_BUF`、状态清除、RF10=0x480、BB13=0x1d0、TX 功率写入 `CTRL_TX`、BB8 PHY 配置；随后 `Tune()`：模式 `0xDD` → 2401/2480/2440 MHz 三点 TX 调谐（CO 插值 20 点、GA 插值 6 点）→ RX 滤波调谐 → 模式 `0x80`。
- 帧格式：TX 缓冲 = `[PDU header, payload len, payload...]`；基带自动加前导/接入地址/CRC；广播 CRC 初值为 `0x555555`。RX 缓冲同布局，`BB12.RSSI>>15` 取 RSSI。
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

## D5 Phase A 的边界（历史记录）

- **仅被动扫描**：未实现 active scan（收到 ADV_IND 后 150 µs T_IFS 内发 SCAN_REQ）。当前 SCAN_RSP 是「顺带听到别的扫描器触发的响应」，不是本栈主动请求。
- **无连接**：无 CONNECT_IND / 锚点 / CSA#1 跳频 / SN-ACK / 加密；GAP/GATT/SM 均未开始。
- **校准**：初始化时固定三频点调谐；无温度重校准（spike G5 的温补路径仍待做）、无 DTM/灵敏度指标。
- **平台与配置**：仅 CH582/583 1M PHY 验证；TX 功率固定 0 dBm；MAC 为常量（未读 InfoFlash）；必须 LSE；SNV/绑定未涉及（本阶段无 flash 写）。
- **扫描窗口**：以空闲轮询计数近似 100 ms；持续满负荷收包时窗口会延长（无硬件定时器兜底），后续用 LLE TMR 统一时基。
- **许可边界**：`ble-native` 为独立 MIT/Apache-2.0 实现，但寄存器事实来自 MIT 的 ch32fun；对外发布需保留 `NOTICE`/`LICENSE-ch32fun`。clean-room 的人员隔离与留痕（spike §5）尚未按正式流程建立，上游 PR 前必须补齐。

## D6 原始能力与验收门禁

以下判据仍用于比较 CH582 上的实现。当前开发顺序见 D9。

| Phase | 内容 | 退出门禁 |
|---|---|---|
| B | LL 连接：CONNECT_IND、锚点/窗口、CSA#1、SN/ACK、监督超时 | 与 BlueZ 稳定连接 ≥30 min、丢包可测 |
| C | L2CAP/ATT/GATT server：MTU 交换、服务发现、读写、CCCD/notify | BlueZ 完成发现 + 读写 + notify |
| D | SM：legacy pairing、LE Secure Connections、绑定（RAM-only 先行） | 与 BlueZ 配对/重连成功 |
| E | active scan + T_IFS 调度；扩展广播 | 主动扫描拿到 SCAN_RSP；EVT observer 对等 |
| F | RF 温补/DTM/灵敏度；与 blob 的 A/B 指标 | 指标达标 + 可重复 DTM |

> 说明：B 起需要把「主循环 + 阻塞延时」换成 **625 µs 时基的调度器**（LLE TMR0–2，2 MHz 计数），否则连接事件无法对齐；这是 M20（调度/内存）的实际入口。


## D7 Phase B 的 LLE 调度与单连接 Peripheral

- CH582/583 的 LLE `TMR0/1` 在 2 MHz 下交错倒数。上一只计时器到期后，从仍运行的计时器重装，减少 IRQ 延迟对时钟的影响。`TMR2` 负责单次截止唤醒，BLEL IRQ 锁存收发完成和时间戳。625 µs 对应 1250 个计数，射频应答保留 0.5 µs 分辨率。
- `native_adv` 的 100 ms 广播周期与 `native_scan` 的 100 ms 驻留窗口使用绝对截止时间。扫描窗口内收帧后在原信道重臂，满负载时依然按硬件截止时间换信道。三个 Phase A bin 的运行时收发都由 LLE 事件推进。
- `native_peripheral` 接受发给本机 public AdvA 的 legacy `CONNECT_IND`。连接使用请求中的接入地址、CRC 初值、时间参数和信道图。首个数据包确定锚点，后续窗口补偿时钟偏差。CSA#1 按连接事件推进，漏收事件仍计数。
- SN/NESN 对已确认的发送翻位，重复收到的 PDU 不重复进入控制处理。链路层处理 Feature、Version、Channel Map、Connection Update 和 Terminate。UART 上报事件数、未命中窗口、CRC 错误、有效接收、重复和重传。未命中窗口是接收观测值，中央未发包同样可能产生该计数。
- Phase B 的范围为单连接 LE 1M、legacy PDU、每个事件主动监听。L2CAP/ATT/GATT 和安全过程按 D6 留在后续阶段。Linux 验收工具在 LE 固定 CID `0x0004` 上保持空闲 ACL，避开 BlueZ 自动 GATT 发现的 ATT 超时。
- 协议依据为 Bluetooth Core 6.3，Vol 6 Part B §2.3.3.1、§3.1、§4.2 和 §4.5。CH582M 实测中，连接 CRC 初值按请求原值写入 BB 寄存器。TX 起发补偿由本板广播测得，625 µs 唤醒到 LL0 写入另留约 10 µs。[Bluetooth Core Link Layer Specification](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/low-energy-controller/link-layer-specification.html)

### D6 退出门禁实测

- **PASS，CH582M + AX210 + BlueZ 5.88**。WCH OpenOCD 校验烧录 `native_peripheral` 后，`tests/bluez_soak.py` 持续连接 **1800.03 s**。连接间隔 45 ms，收尾由对端主动结束。
- UART 收尾记录 40,047 个事件、891 次窗口未命中、1 次 CRC 错误、39,157 个有效接收，重复与重传各 1,085 次。迟发与 TX 超时计数均为 0。宿主日志 `/tmp/m19-b-accept-soak.log`，板端日志 `/tmp/m19-b-accept-uart.log`。
- Phase A 回归通过。BlueZ 识别到不可连接的 `M18-NATIVE`，`native_scan` 在 37/38/39 均收到受控对端的厂商标记 `FF FF 4D 31 38 2D 41 44 56`，并在约 3 s 内完成十轮三信道驻留。
- 8 项宿主端时序和状态测试通过。4 个固件通过 release 交叉编译，符号检查对 WCH BLE blob 的入口为 0 命中。
- 监督超时用临时测试固件注入 RX 静默验证。板端退出连接时报告 `peer=false`，继续广播并接受下一次连接。测试后重新烧录并校验正式 `native_peripheral`，BlueZ 建链复测通过。测试日志 `/tmp/m19-b-timeout-uart.log`。

## D8 Phase C 的 L2CAP、ATT 与 GATT 服务端

- 单连接 LE 1M Peripheral 以 `M19-GATT` 广播。L2CAP Basic Frame 使用 ATT 固定信道 `0x0004`。LL 继续使用 27 字节载荷，有界缓冲负责重组接收片段、分片发送和背压。未获 ACK 的载荷由 LL 保留，ATT 分发放在连接事件之间。
- ATT 默认 MTU 为 23，协商上限为 64。服务端支持主服务、特征和描述符发现，支持读、按偏移读取、Write Request 和 Write Command。协议依据为 Bluetooth Core 6.3 Vol 3。[L2CAP](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/host/logical-link-control-and-adaptation-protocol-specification.html) · [ATT](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/host/attribute-protocol--att-.html) · [GATT](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/host/generic-attribute-profile--gatt-.html)
- 属性表包含 GAP 设备名、Appearance 及测试服务 `d0f10000-98cb-4d61-be71-228c9171d719`。测试特征 `d0f10001-98cb-4d61-be71-228c9171d719` 初值为 `ready`。CCCD 启用后，成功写入会生成包含新值的通知。特征值和 CCCD 在每次连接时初始化，配对和绑定按 D6 归入 Phase D。
- **D6 Phase C 退出门禁 PASS，CH582M + AX210 + BlueZ 5.88**。WCH OpenOCD 校验烧录后，BlueZ D-Bus 两次完成服务、特征与 CCCD 发现。两轮均确认订阅前、订阅后、取消订阅后的 CCCD 分别为 `0x0000`、`0x0001`、`0x0000`，61 字节 Write Request 的回读与通知逐字节一致，13 字节 Write Command 得到同样结果。重连时初值和 CCCD 恢复。证据为 `/tmp/m19-c-gatt.log` 和 `/tmp/m19-c-gatt-reconnect.log`，复测入口为 `ble-native/tests/bluez_gatt.py`。
- 12 项宿主协议测试通过，涵盖 ATT 分页、错误响应、CCCD、L2CAP 重组与分片、LL 重传去重。4 个固件通过 release 交叉编译，WCH BLE blob 入口符号 0 命中。最终 Phase C 固件另通过 20.01 s 空闲 ACL 回归。

## D9 wchble 与 Trouble Host 接入

### 目标与分工

- **CH582M 与无 WCH BLE blob 目标继续适用。** CH582 板级初始化、射频调谐、BLEL 中断、DMA 和硬件时间戳复用 `ble-native/src/rf.rs` 与 `schedule.rs` 的实测成果。连接事件由接入后的 `wchble` 调度，保留 LLE 的 2 MHz 计数和 625 µs 时隙换算作为适配依据。
- `wchble` 承担 LL、链路加密与软 HCI，Trouble Host 经 `bt-hci` 承担 GAP、L2CAP、ATT/GATT、SMP 和主机侧绑定管理。现有 `native_*` 固件及 BlueZ 脚本用于 A/B 对照和问题定位。独立实现的新增工作收敛到 CH582 适配与验证。

### 已核实的上游基线

- `wchble` 以 `9acaff9008ce250a56f12fd735a5452167c5d92c` 为首轮评估基线。启用 `ch583,controller,phy` 的 499 项宿主测试通过，库通过 `riscv32imc-unknown-none-elf` 和 `riscv32imac-unknown-none-elf` 交叉检查。CH585 有独立的 GATT 与加密实机记录。CH582/583 对应的 `Ch583Radio` 仍由 `stub_radio!` 提供，初始化和收发返回 `Unsupported`。[固定版本 README](https://github.com/ch32-rs/wchble/blob/9acaff9008ce250a56f12fd735a5452167c5d92c/README.md) · [CH583 后端](https://github.com/ch32-rs/wchble/blob/9acaff9008ce250a56f12fd735a5452167c5d92c/src/rf/family/ch583.rs#L95)
- Trouble Host 先按上游 CH585 示例注明的 `3aa6fd27b89cd5fc35f5c9b4f0c7f66795a14f70` 评估。两边使用 `bt-hci 0.11`。该 Trouble 版本提供 `security` 和可选 `legacy-pairing`。示例使用相邻 checkout，接入试验应记录实际使用的依赖修订和锁文件。[CH585 示例依赖](https://github.com/ch32-rs/wchble/blob/9acaff9008ce250a56f12fd735a5452167c5d92c/examples/ch585-trouble-gatt/Cargo.toml) · [Trouble Host features](https://github.com/embassy-rs/trouble/blob/3aa6fd27b89cd5fc35f5c9b4f0c7f66795a14f70/host/Cargo.toml)
- 在独立探针工程中，用 `wchble::hci::new()` 构建启用 GATT 和 `legacy-pairing` 的 Trouble 栈，通过 `riscv32imc-unknown-none-elf` 的 `cargo check`。IMC 下为 `static_cell` 的原子操作启用 `portable-atomic/critical-section`，沿用 CH585 示例的依赖配置。此结果覆盖 Controller/Host 接口与 feature 兼容，目标固件链接、时序和空口行为由后续实机门禁验证。
- CH582 自研基线已通过 D7 的 30 分钟连接和 D8 的 GATT 读写与通知。Phase D 原型在 Legacy 与 LE Secure Connections 两种构建下各完成一次 BlueZ 配对、绑定重连和加密 GATT。原型后续改动待最终固件实机复验，接入版独立运行这些验收用例。

### 实施顺序与验收

| 顺序 | 交付 | 在 CH582M 上的判据 |
|---|---|---|
| 19.5 | 独立 RF 验证固件，从现有驱动接入 `Radio`、`LinkRadio`、`InstantUs`。落实 TX 起发期限、RX CRC 与捕获、DMA 缓冲所有权和停止确认。保留 iSLER 来源与许可记录。 | OpenOCD 校验烧录。1M legacy 广播由 BlueZ 在空口确认，板端在 37/38/39 收到受控对端标记。重复启停后收发可恢复。 |
| 19.6 | 用 `wchble` 的单连接事件引擎驱动 CH582，先跑通 legacy LE 1M、CSA#1 和监督超时。 | BlueZ 空闲 LE ACL 连续至少 30 分钟，记录连接事件、漏收、CRC、重传与迟发。注入链路静默后恢复广播并可重连。 |
| 19.7 | 接入软 HCI 和 Trouble Host。沿用 D8 测试服务与 BlueZ 验收，检查 HCI 流控与断连后的队列清理。 | BlueZ 完成发现、订阅和取消订阅。61 字节 Write Request、13 字节 Write Command、回读和通知逐字节一致，覆盖 ATT MTU 64 和 ACL 分片。 |
| 19.8 | 接入加密与 RAM 绑定。验证 CH582 上的 AES/P‑256 时序、随机种子来源和真实 RAM 峰值。 | 分别完成 Legacy 和 LE Secure Connections 配对及加密重连，保护特征在明文会话拒绝访问。确认断电丢弃 RAM 绑定，候选 ELF 的 RAM 峰值（含栈、队列和 DMA）满足 CH582M 32 KiB，且 BLE blob 符号为零。 |

CH582 适配从 19.5 开始。现有 `rf::stop` 发出停止命令，`LinkRadio::stop` 还需在限定时间内确认硬件空闲。实现 `InstantUs` 时先延展 LLE 的 32 位半微秒计数，再换算成微秒，验证跨回绕的截止时间。业务层的连接调度由 `wchble` 统一驱动。

安全联调可复用 Phase D 的宿主随机种子注入方式，独立运行的版本需验证板端随机来源。CH585 的 `Ch585Aes` 作为接口参考，软件 AES-CCM 和 P‑256 的调度预算取 CH582 实测。

19.5–19.8 的目标板证据齐备后，再评估生成器默认后端切换。拟对外提交的范围按 M18 评估报告 §7.2 核对。主动扫描、扩展广播及 RF 温补/DTM 继续沿 D6 能力表排期，先完成单连接基线的等价验收。[M18 评估报告](m18-cleanroom-spike.md)
