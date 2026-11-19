# M18-S1：CH583 EVT BLE 例程事实规格（clean-room，22 项 + IAP 面）

> 真相源（只读）：`/home/teze/CH32/EVT/CH583EVT/EVT/EXAM/BLE/`（下称 `$EVT`）。
> 本文所有事实参数/行为均给出来源路径（仅用于溯源，不复刻源码表达）；未标注来源的数字来自对应 `.c/.h` 宏取值。
> 此前基于 CH32V20xEVT 的同源推断一律以本文的 CH583 取值覆盖（差异清单见 §7）。
>
> 记号：adv=可连接/可扫描广播；rsp=scan response；CCCD=0x2902；WNR=Write Without Response。
> 时间换算：adv 间隔 ×0.625 ms；连接间隔 ×1.25 ms；supervision timeout ×10 ms；TMOS tick = 1 ms（`MS1_TO_SYSTEM_TIME`）。


## 版权与 clean-room 注记

- 本文档**仅含事实参数与行为规格**：UUID、属性、长度、初值、广播/连接间隔、tick→ms、payload 字节语义、引脚、宏取值、`.cproject` 配置、固定 MAC、设备名。这些是功能/接口事实，不包含 WCH 源码的表达（函数结构、注释原文、语句序列、变量命名风格）。
- 原文中所有 >5 行的源码摘录已删除并改写为参数表或行为描述。**唯一保留的连续文字引用**是 `CH58xBLE_LIB.h` 中 3 行版权/限芯片句（de minimis，合规判断必需，且 `docs/m18-cleanroom-spike.md` 已引用）；另有 4 处 ≤2 行的关键常量/构建配置/库元数据事实片段（`VER_FILE`、串口 FIFO 大小、`.cproject` 排除项、库版本串），均属不可替代的接口事实，不含函数体/注释表达。
- **未摘抄 WCH 手册段落**；手册只作主题级引用（见附录 D）。
- **clean-room 声明**：测试程序/驱动由本规格独立实现；实现组不阅读 `$EVT` 的 `.c` 源文件，也不以源码为蓝本做逐行对照；仅依据本文件的事实参数与公开的 GATT/蓝牙规范。
- 本注记为 M18 主控的合规裁决记录；若后续需要引用更多原文，必须重新做合规评审。

---

## 0. 公共基线（所有例程共享）

### 0.1 目录与构建模型

| 项 | 值 |
|---|---|
| HAL | `$EVT/HAL/{MCU.c,RTC.c,SLEEP.c,KEY.c,LED.c,include/config.h}` |
| BLE 库 | `$EVT/LIB/libCH58xBLE.a` + `CH58xBLE_LIB.h`；ROM 变体 `CH58xBLE_ROM.h` |
| 工程 | MounRiver/Eclipse `.cproject`，单 configuration，CPU `ISP583`，链接脚本 `Ld/Link.ld` |
| 公共默认 | 所有例程 `.cproject` **均未定义** `HAL_SLEEP` / `BLE_SNV` / `DCDC_ENABLE`，故取 `config.h` 默认：`HAL_SLEEP=FALSE`、`BLE_SNV=TRUE`、`DCDC_ENABLE=FALSE` |
| 时钟 | `main()` 固定调用 `SetSysClock(CLK_SOURCE_PLL_60MHz);`；`CLK_OSC32K` 默认 `1`（内部 RC 32000 Hz），中央角色例程显式覆盖为 `0`（外部 32768 Hz 晶振） |

`$EVT/HAL/include/config.h` 默认值（事实参数）：

| 宏 | 默认值 | 说明 |
|---|---|---|
| `HAL_SLEEP` | FALSE | 睡眠关闭 |
| `TEM_SAMPLE` | TRUE | 温度采样校准 |
| `BLE_CALIBRATION_ENABLE` | TRUE | 定时校准使能 |
| `BLE_CALIBRATION_PERIOD` | 120000 ms | 校准周期 |
| `BLE_SNV` | TRUE | 绑定信息落 DataFlash |
| `BLE_SNV_ADDR` | 0x77E00 − `FLASH_ROM_MAX_SIZE` | SNV 起始地址 |
| `BLE_SNV_BLOCK` | 256 B | 每块大小 |
| `BLE_SNV_NUM` | 1 | 块数 |
| `CLK_OSC32K` | 1 | 0=外部 32768 Hz；1=内部 32000 Hz；2=内部 32768 Hz |
| `BLE_MEMHEAP_SIZE` | 6 KiB（1024×6） | 协议栈 RAM |
| `BLE_BUFF_MAX_LEN` | 27 | 单连接最大包长，对应 ATT_MTU=23 |
| `BLE_BUFF_NUM` | 5 | 控制器缓存包数 |
| `BLE_TX_NUM_EVENT` | 1 | 每连接事件最多发包数 |
| `BLE_TX_POWER` | `LL_TX_POWEER_0_DBM` | 0 dBm |
| `PERIPHERAL_MAX_CONNECTION` | 1 | 从机连接数 |
| `CENTRAL_MAX_CONNECTION` | 3 | 主机连接数 |

`CLK_OSC32K` 取值含义：`0` = 外部 32768 Hz 晶振；`1` = 内部 RC 32000 Hz；`2` = 内部 RC 32768 Hz。
`BLE_BUFF_MAX_LEN` 的默认值为 27（对应 ATT_MTU=23），允许范围 27–516。

### 0.2 `$EVT/HAL/MCU.c` — `CH58X_BLEInit()` 行为

`CH58X_BLEInit()` 的行为顺序（全部为事实描述，无源码表达）：

1. **版本校验**：把库内 `VER_LIB` 与 `VER_FILE` 的前 `strlen(VER_FILE)` 字节比较；不等则打印 `head file error...` 并死循环。
2. **SysTick**：以 `SysTick_LOAD_RELOAD_Msk` 调 `SysTick_Config()`，随后立即 `PFIC_DisableIRQ(SysTick_IRQn)`——SysTick 只作自由计数器/随机种子，不进中断。
3. **内存与缓冲**：`bleConfig_t` 清零后填 `MEMAddr=MEM_BUF`、`MEMLen=BLE_MEMHEAP_SIZE`、`BufMaxLen=BLE_BUFF_MAX_LEN`、`BufNumber=BLE_BUFF_NUM`、`TxNumEvent=BLE_TX_NUM_EVENT`、`TxPower=BLE_TX_POWER`。
4. **SNV**（`BLE_SNV==TRUE`）：先检查 `BLE_SNV_ADDR + BLE_SNV_BLOCK*BLE_SNV_NUM ≤ 0x78000 − FLASH_ROM_MAX_SIZE`，越界则死循环；然后填 `SNVAddr/SNVBlock/SNVNum`，并挂 `readFlashCB=Lib_Read_Flash`、`writeFlashCB=Lib_Write_Flash`（底层为 `EEPROM_READ/ERASE/WRITE`）。
5. **RTC 时钟选择**：`CLK_OSC32K != 0` 时 `SelRTCClock=CLK_OSC32K`；`CLK_OSC32K == 0` 时字段保持 0。
6. **连接数**：`ConnectNumber = (PERIPHERAL_MAX_CONNECTION & 3) | (CENTRAL_MAX_CONNECTION << 2)`（低 2 bit 从机、次 2 bit 主机）。
7. **随机源与校准回调**：`srandCB=SYS_GetSysTickCnt`；`TEM_SAMPLE` 时 `tsCB=HAL_GetInterTempValue`；且 `CLK_OSC32K != 0` 时 `rcCB=Lib_Calibration_LSI`。
8. **睡眠回调**：`HAL_SLEEP==TRUE` 时 `WakeUpTime=WAKE_UP_RTC_MAX_TIME`、`sleepCB=CH58X_LowPower`。
9. **MAC**：`BLE_MAC==TRUE` 时把 `MacAddr[5..0]` **反序**写入 `cfg.MacAddr[0..5]`；否则 `GetMACAddress()` 按原序拷入芯片出厂 MAC。
10. **收尾**：校验 `cfg.MEMAddr != 0` 且 `cfg.MEMLen ≥ 4 KiB`；调用 `BLE_LibInit(&cfg)`，返回非 0 则打印错误码并死循环。


### 0.3 `$EVT/HAL/RTC.c` — 32K / TMOS 初始化行为

`HAL_TimeInit()` 的分支行为：

- **`CLK_OSC32K != 0`（内部 RC）**：关闭 `RB_CLK_OSC32K_XT`、`RB_CLK_XT32K_PON`；打开 `RB_CLK_INT32K_PON`；`LSECFG_Current(LSE_RCur_100)`；调用 `Lib_Calibration_LSI()` 自校准。
- **`CLK_OSC32K == 0`（外部晶振）**：同时打开 `RB_CLK_OSC32K_XT`、`RB_CLK_INT32K_PON`、`RB_CLK_XT32K_PON`。
- 之后 `RTC_InitTime(2020,1,1,0,0,0)` 初始化 RTC 时间，`TMOS_TimerInit(0)` 初始化 TMOS 时基。
- 所有 32K 配置寄存器写操作都包在 `sys_safe_access_enable()/disable()` 之间。

### 0.4 `$EVT/HAL/SLEEP.c` — 睡眠是否启用

**未启用**：在范围的全部工程（22 个例程 + `OnlyUpdateApp_IAP`）的 `.cproject` 均未定义 `HAL_SLEEP`，`config.h` 默认 `FALSE`。后果：
- `HAL_Init()` 不调用 `HAL_SleepInit()`（该调用受 `HAL_SLEEP` 条件编译控制）。
- `CH58X_BLEInit()` 不设置 `cfg.WakeUpTime` / `cfg.sleepCB`。
- `CH58X_LowPower()` 函数体被条件编译包住，直接返回 0；`HAL_SleepInit()` 为空。
- 因此所有例程都是 **WFI-free 连续 `TMOS_SystemProcess()` 忙等**（主循环行为见各节）。

睡眠路径（仅在 `HAL_SLEEP==TRUE` 时编译）：`HAL_SleepInit()` 打开 RTC 唤醒（`RB_SLP_RTC_WAKE`）、RTC 触发模式（`RB_RTC_TRIG_EN`）并使能 `RTC_IRQn`；`CH58X_LowPower()` 在睡眠窗口合法时调用 `LowPower_Sleep(RB_PWR_RAM2K | RB_PWR_RAM30K | RB_PWR_EXTEND)`。**在范围的全部工程均未定义 `HAL_SLEEP`，此路径不生效。**

### 0.5 `$EVT/LIB` 版本串与许可注记（附录素材）

```text
$ strings LIB/libCH58xBLE.a | grep BLE_LIB
CH58x_BLE_LIB_V2.13
```

`$EVT/LIB/CH58xBLE_LIB.h` 的版权/限芯片句（唯一保留引用）：

> Copyright (c) 2021 Nanjing Qinheng Microelectronics Co., Ltd.
> Attention: This software (modified or not) and binary are used for
> microcontroller manufactured by Nanjing Qinheng Microelectronics.

（以上为库头中唯一与授权范围相关的句子，属 de minimis 引用，仅用于合规判断；本文件不复制其文件头其余内容。）

版本校验定义：

```c
#define VER_FILE  "CH58x_BLE_LIB_V2.1"
```

库内另行导出 `VER_LIB[]` 供运行期比较。

说明：库内串为 `CH58x_BLE_LIB_V2.13`，头文件写 `V2.10`，`VER_FILE` 写 `V2.1`；`tmos_memcmp(VER_LIB, VER_FILE, strlen(VER_FILE))` 只比较 18 字节（`CH58x_BLE_LIB_V2.1`），故 V2.13 能通过校验——**不要把 "V2.13" 当编译期宏**。

---

## 1. Peripheral

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/Peripheral/`（`APP/peripheral.c`, `APP/peripheral_main.c`, `Profile/gattprofile.c`, `Profile/devinfoservice.c`） |
| 角色 | 仅 Peripheral（从机），`GAPRole_PeripheralInit()` + `GAPRole_PeripheralStartDevice()` |
| 设备名 | GAP 名 `"Simple Peripheral"`；rsp 完整名同值 |
| 服务 | **0xFFE0**（头文件 `SIMPLEPROFILE_SERV_UUID`；`gattprofile.c` 注释里的 0xFFF0 是陈旧注释，实际编译值以 `gattprofile.h` 为准） |
| 特征 | 0xFFE1 R/W len=1 init=1；0xFFE2 R len=1 init=2；0xFFE3 W len=1 init=3；0xFFE4 Notify len=1 init=4 + CCCD；0xFFE5 R len=5 init={1,2,3,4,5}；每个特征带 User Description |
| CCCD/indicate | 仅 0xFFE4 Has CCCD（`gattCharCfg_t simpleProfileChar4Config[PERIPHERAL_MAX_CONNECTION]`），无 indicate |
| adv interval | `DEFAULT_ADVERTISING_INTERVAL 80` → **50 ms**（`TGAP_DISC_ADV_INT_MIN/MAX`） |
| 连接参数 | min 6 / max 100 → **7.5–125 ms**；latency 0；timeout 100 → **1000 ms** |
| notify 周期 | `SBP_PERIODIC_EVT_PERIOD 1600` → **1600 ms**，payload **1 字节 0x88**（`notiData[SIMPLEPROFILE_CHAR4_LEN] = {0x88}`） |
| 其他周期 | RSSI 读取 3200 ms；连接后 6400 ms 发起连接参数更新；`SBP_PHY_UPDATE_EVT`/2400 ms 定义为 2M PHY 预留（本文件未启动该事件） |
| 配对 | passkey 0（"000000"）、`GAPBOND_PAIRING_MODE_WAIT_FOR_REQ`、MITM TRUE、bonding TRUE、`GAPBOND_IO_CAP_DISPLAY_ONLY` |
| `.cproject` define | `DEBUG=1`；链接库 `CH58xBLE`（libCH58xBLE.a）。**无** CLK_OSC32K/HAL_SLEEP/BLE_SNV/BLE_BUFF_MAX_LEN/BLE_MEMHEAP_SIZE/连接数覆盖 → 全默认 |
| 板内外设 | 仅 DEBUG 串口：UART1 TXD1=PA9（推挽输出），115200 8N1；无按键/LED/USB |

广播 TLV（`advertData`）：

TLV 语义：Flags（AD type 0x01，值 0x06 = General Discoverable 0x02 | BR/EDR Not Supported 0x04）；16-bit Service UUID list（AD type 0x02，UUID 0xFFE0）。

展开字节：`02 01 06 | 03 02 E0 FF`
（flags=0x06 = General Discoverable 0x02 | BR/EDR Not Supported 0x04；`GAP_ADTYPE_16BIT_MORE=0x02`）

scan-rsp（`scanRspData`）：

TLV 语义：Complete Local Name（AD 0x09，`Simple Peripheral`）；Slave Connection Interval Range（AD 0x12，min=6、max=100）；Tx Power Level（AD 0x0A，0 dBm）。

展开字节：`12 09 "Simple Peripheral" | 05 12 06 00 64 00 | 02 0A 00`

证据：`peripheral.c:33-64`（周期/连接参数宏）、`peripheral.c:88-142`（数组）、`gattprofile.h:31-53`（UUID/长度）、`gattprofile.c:85-135`（属性/初值）。

**BlueZ 判据**：`bluetoothctl scan on` 看到 `Simple Peripheral`；connect 后 `list-attributes` 有服务 `0000ffe0-0000-1000-8000-00805f9b34fb`，特征 `ffe1`(read,write)、`ffe2`(read)、`ffe3`(write)、`ffe4`(notify)、`ffe5`(read)。`select-attribute ffe4` + `notify on` 后每 ~1.6 s 收到 1 字节 `0x88`；写 `ffe1` 1 字节、写 `ffe3` 1 字节并在串口打印 `profile ChangeCB CHAR1/CHAR3`。

---

## 2. OnlyUpdateApp_Peripheral

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/OnlyUpdateApp_Peripheral/` |
| 角色 | Peripheral（应用区 App），写特征触发跳 OTA |
| 与 §1 的差异 | `peripheral.c` 删除 `SBP_PHY_UPDATE_EVT` 段；连接建立时**不再**重置 `peripheralMTU`；`simpleProfileChangeCB` 的 **CHAR3** 分支新增 `Jump_OTA()`；`peripheral_main.c` 增加 `Image_Flag` 段（`.ImageFlag`） |
| 服务/特征 | 与 §1 完全相同（0xFFE0 / 0xFFE1–0xFFE5；CHAR4 notify 1 字节 0x88 / 1600 ms） |
| 广播/rsp | 与 §1 完全相同（名 `Simple Peripheral`，adv 50 ms，conn 7.5–125 ms） |
| OTA 触发 | 写 CHAR3（0xFFE3）任意值 → 打印 `jump OTA` → `mDelaymS(5)` → `Jump_OTA()` |
| Jump_OTA 行为 | 见下 |
| 链接布局 | `Ld/Link.ld`：`FLASH (rx) : ORIGIN = 0x00001000, LENGTH = 44K`；`RAM (xrw) : ORIGIN = 0x20002000, LENGTH = 24K` |
| `.cproject` define | `DEBUG=1`、**`CH58xBLE_ROM=1`**（用 ROM 内 BLE 栈，不链接 libCH58xBLE.a），其余默认 |
| 板内外设 | 同 §1（仅 PA9 调试串口） |

`Jump_OTA()` 的行为：从 `OTA_DATAFLASH_ADD`（`0x00077000 − FLASH_ROM_MAX_SIZE`）读 4 字节 → 擦除 1 个 EEPROM 页 → 把首字节置为 `0x03`（OTA 标志，`IMAGE_OTA_FLAG`）→ 写回 4 字节 → 软件复位（`SYS_ResetExecute()`）。临时缓冲为 16 字节、8 字节对齐。

`peripheral_main.c` 的 Image 标记：

`.ImageFlag` 段放置一个 4 字节常量 `0xFFFFFFFF`（`Address`）作为 APP 有效性标记；链接脚本用 `KEEP` 保留该段。

**BlueZ 判据**：与 §1 相同；额外判据是向 `ffe3` 写 1 字节后设备立即断连并重启，`OTA_DATAFLASH_ADD` 首字节变为 `0x03`（随后由 OnlyUpdateApp_IAP/OTA 引导接管）。

---

## 3. HeartRate

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/HeartRate/`（`APP/heartrate.c`, `Profile/heartrateservice.c`, `Profile/battservice.c`） |
| 角色 | Peripheral |
| 设备名 | `"Heart Rate Sensor"`（adv 内 Complete Name；`scanRspData[]` 为空） |
| 服务 | `0x180D` Heart Rate + `0x180F` Battery + `0x180A` DevInfo |
| 特征 | `0x2A37` Notify（无 read；CCCD）；`0x2A38` Read init=0x00（Other）；`0x2A39` Write。Battery `0x2A19` Read+Notify init=100 |
| CCCD/indicate | HRM 0x2A37 有 CCCD；Battery 0x2A19 有 CCCD；无 indicate |
| adv interval | fast 32 → **20 ms**，持续 30000 → **18.75 s**；slow 1600 → **1000 ms**，duration 0 = 永久 |
| 连接参数 | min 20 / max 160 → **25–200 ms**；latency **1**；timeout 1000 → **10 s** |
| notify 周期 | HRM `DEFAULT_HEARTRATE_PERIOD 2000` → **2000 ms**；Battery `DEFAULT_BATT_PERIOD 24000` → **15000 ms** |
| HRM payload | 分配上限 `HEARTRATE_MEAS_LEN=9`，实际 **2 字节**：`flags=0x00`（`heartRateFlags[0]`，数组虽定义 6 项但 `heartRateFlagsIdx` 永不递增）+ `bpm`；`BPM_DEFAULT=73`，每次 +1 到 80 回 73；因 flags 恒 0，能量/RR 分支永不进入 |
| 配对 | passkey 0、WAIT_FOR_REQ、**MITM FALSE**、bonding TRUE、`GAPBOND_IO_CAP_DISPLAY_ONLY` |
| `.cproject` define | `DEBUG=1`、链接 `CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口；无传感器（数值为模拟） |

广播 TLV：

TLV 语义：Flags（0x06）；16-bit Service UUID list（AD 0x02）依次列 `0x180D`（Heart Rate）与 `0x180F`（Battery）；Complete Local Name（AD 0x09，`Heart Rate Sensor`）。scan-rsp 为空。

展开字节：`02 01 06 | 05 02 0D 18 0F 18 | 12 09 "Heart Rate Sensor"`
scan-rsp：空数组。

`heartRateMeasNotify()` 的 payload 构造：

notify 字节布局（实际固定 2 字节）：`[0]=flags`（恒 `0x00`，因为标志索引从不递增）`[1]=bpm`。协议上若 flags 的 bit0=16-bit 格式则追加 1B 0；bit3=能量则追加 2B 能量；bit4=RR 则追加 4B（2×u16 RR）。本示例永不进入后三个分支。

**BlueZ 判据**：看到 `Heart Rate Sensor`，adv 含 0x180D+0x180F；服务 `0000180d-…`，`2a37` notify（订阅后约 2 s 一包，固定 2 字节 `00 <bpm>`，第二字节 73→80 循环）；`2a38` read 返回 `00`；写 `2a39=01` 只清能量字段；battery `2a19` notify 约 15 s 一次，值 100。

---

## 4. CyclingSensor

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/CyclingSensor/`（`APP/cyclingsensor.c`, `Profile/cyclingservice.c`） |
| 角色 | Peripheral |
| 设备名 | `"CSC Sensor"`（adv 内 Complete Name；rsp 仅 Tx Power） |
| 服务 | `0x1816` CSC + `0x180F` Battery + `0x180A` DevInfo |
| 特征 | `0x2A5B` Notify；`0x2A5C` Read init=0x00（`CSC_NO_SUPPORT`）；`0x2A5D` Read init=0x01（`CSC_SENSOR_LOC_TOP_OF_SHOE`）；`0x2A55` Write+**Indicate**。Battery `0x2A19` Read+Notify init=100 |
| CCCD/indicate | 0x2A5B、0x2A19 有 CCCD；0x2A55 带 indicate |
| adv interval | fast 32 → **20 ms**，持续 20000 → **12.5 s**；slow 1704 → **1065 ms**，持续 20000 → **12.5 s** |
| 连接参数 | min 20 / max 200 → **25–250 ms**；latency **20**；timeout 1000 → **10 s** |
| notify 周期 | `DEFAULT_CSC_PERIOD 1000` → **1000 ms** |
| payload | 固定 **11 字节**：flags 恒 `0x03`（`sensorFlags[0]=SPEED_CADENCE`，`sensorFlagsIdx` 永不递增）+ 4B 累计轮圈数 + 2B 末次轮事件时间 + 2B 累计曲柄数 + 2B 末次曲柄事件时间 |
| 配对 | passkey 0、WAIT_FOR_REQ、**MITM FALSE**、bonding TRUE、`GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT`、`GAPBOND_AUTO_SYNC_WL=FALSE`（`USING_WHITE_LIST=FALSE`） |
| `.cproject` define | `DEBUG=1`、链接 `CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

广播/rsp TLV 语义：

TLV 语义：adv = Flags（0x06）+ 16-bit UUID list（AD 0x02，`0x1816`）+ Complete Local Name（AD 0x09，`CSC Sensor`）；rsp = Tx Power Level（AD 0x0A，0 dBm）。

展开字节：adv `02 01 06 | 03 02 16 18 | 0B 09 "CSC Sensor"`；rsp `02 0A 00`。

**BlueZ 判据**：看到 `CSC Sensor`，adv 含 `0x1816`；服务 `00001816-…`，`2a5b` notify 约 1 s/包（固定 flags=0x03，11 字节，轮圈/曲柄计数递增），`2a5c` read=`0000`，`2a5d` read=`01`，`2a55` write+indicate（写 `01` 复位累计值并收到 indication）；battery `2a19`。

---

## 5. RunningSensor

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/RunningSensor/`（`APP/runningsensor.c`, `Profile/runningservice.c`） |
| 角色 | Peripheral |
| 设备名 | `"RSC Sensor"`（rsp 内 Complete Name；adv 只带 UUID） |
| 服务 | `0x1814` RSC + `0x180F` Battery + `0x180A` DevInfo |
| 特征 | `0x2A53` Notify；`0x2A54` Read init=0x0000（`RSC_NO_SUPPORT`，2B）；`0x2A5D` Read init=0x00（`RSC_NO_SENSOR_LOC`）；`0x2A55` Write+Indicate。Battery `0x2A19`。 |
| CCCD/indicate | 0x2A53、0x2A19 CCCD；0x2A55 indicate |
| adv interval | fast 48 → **30 ms**，持续 20000 → **12.5 s**；slow 1600 → **1000 ms**，持续 12.5 s |
| 连接参数 | min 20 / max 160 → **25–200 ms**；latency 0；timeout 1000 → **10 s** |
| notify 周期 | `DEFAULT_RSC_PERIOD 2000` → **2000 ms** |
| payload | len 10：flags + instSpeed(2) + instCadence(1) + instStrideLength(2) + totalDistance(4)；`sensorFlagsIdx` 递增并在 4 处回绕 → flags 依次 `0x03,0x00,0x01,0x02`；跑步时 `flags \|= 0x04`（0x03→0x07），走/静止时清 0x04 |
| 配对 | passkey 0、WAIT_FOR_REQ、**MITM FALSE**、bonding TRUE、`NO_INPUT_NO_OUTPUT`、`GAPBOND_AUTO_SYNC_WL=FALSE` |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

广播/rsp TLV 语义：

TLV 语义：adv = Flags（0x06）+ 16-bit UUID list（AD 0x02，`0x1814`）；rsp = Complete Local Name（AD 0x09，`RSC Sensor`）。

展开字节：adv `02 01 06 | 03 02 14 18`；rsp `0B 09 "RSC Sensor"`。

**BlueZ 判据**：看到 `RSC Sensor`；服务 `00001814-…`，`2a53` notify 约 2 s/包（10 字节，速度/步频/步幅/总距离递增），`2a54` read=`0000`，`2a5d` read=`00`，`2a55` write+indicate；battery `2a19`。

---

## 6. HID_Keyboard

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/HID_Keyboard/`（`APP/hidkbd.c`, `Profile/hidkbdservice.c`, `Profile/hiddev.c`） |
| 角色 | Peripheral + HID Device（`HidDev_Init()`） |
| 设备名 | `"HID Keyboard"`（adv 完整名；GAP 名同值） |
| 服务 | `0x1812` HID + `0x180F` Battery + `0x1813` Scan Parameters + `0x180A` DevInfo |
| HID 特征 | `0x2A4A` HID Info R（值 `11 01 00 01`：bcdHID 0x0111、country 0、flags `HID_FLAGS_REMOTE_WAKE=0x01`）；`0x2A4B` Report Map R（63 字节）；`0x2A4C` Control Point WNR；`0x2A4E` Protocol Mode R/WNR；`0x2A4D` Input Report R+Notify（ID 0，8B）；`0x2A4D` Output Report R/W/WNR（ID 0，1B LED）；`0x2A22` Boot Keyboard Input R+Notify（8B）；`0x2A32` Boot Keyboard Output R/W/WNR（1B）；`0x2A4D` Feature Report R/W（ID 0） |
| CCCD | 0x2A4D input、0x2A22 boot input、battery 0x2A19 均有 CCCD |
| adv interval | 应用未设置 `TGAP_DISC_ADV_INT_*` → 库默认 `TGAP_DISC_ADV_INT_MIN/MAX = 160` → **100 ms** |
| 连接参数 | min 8 / max 8 → **10 ms**；latency 0；timeout 500 → **5000 ms**；连接后 12800 ms 发参数更新，1600 ms 发 PHY 更新（2M） |
| notify 周期 | HID notify 使能后 500 ms 首包，此后 **2000 ms**；每次先发按键码、再发释放 |
| payload | 8B：`modifier, reserved, keycode1..6`；`send_char` 从 4 起递增，到 29 回 4；释放包 keycode=0 |
| 配对 | passkey 0、WAIT_FOR_REQ、MITM **FALSE**、bonding TRUE、`NO_INPUT_NO_OUTPUT`；HID idle timeout 60000 ms |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口（按键为软件模拟，不读 GPIO） |

广播 TLV 语义：

TLV 语义：Flags（0x05 = Limited Discoverable 0x01 | BR/EDR Not Supported 0x04）；Appearance（AD 0x19，`0x03C1` = HID Keyboard）；Complete Local Name（AD 0x09，`HID Keyboard`）。

展开字节：`02 01 05 | 03 19 C1 03 | 0D 09 "HID Keyboard"`（flags=0x05：Limited Discoverable 0x01 | BR/EDR Not Supported 0x04）

scan-rsp：

TLV 语义：Slave Connection Interval Range（AD 0x12，min=max=8）；16-bit Service UUID list（AD 0x02，`0x1812` + `0x180F`）；Tx Power Level（AD 0x0A，0 dBm）。

展开字节：`05 12 08 00 08 00 | 05 02 12 18 0F 18 | 02 0A 00`

报告描述符（Report Map），63 字节：见 `$EVT/HID_Keyboard/Profile/hidkbdservice.c:88-134`（Keyboard，Usage Page Generic Desktop/Key Codes，8 位修饰键 + 1 保留字节 + 5 位 LED 输出 + 6 字节按键数组）。

**BlueZ 判据**：看到 `HID Keyboard`、appearance `0x03C1`；`bluetoothctl connect` 后 BlueZ hid 插件注册输入设备；GATT 侧 `2a4b` read 得到 63B 报告描述符，`2a4d`（input）订阅后约 2 s 一次 8B 通知：`[00 00 04..1C 00 00 00 00 00]` 交替 `00 00 00 …`；`2a4d`（output）写 1 字节 LED 状态。

---

---

## 7. HID_Mouse

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/HID_Mouse/`（`APP/hidmouse.c`, `Profile/hidmouseservice.c`） |
| 角色 | Peripheral + HID Device |
| 设备名 | `"HID Mouse"` |
| 服务 | `0x1812` + `0x180F` + `0x1813` + `0x180A` |
| HID 特征 | `0x2A4A` R（`11 01 00 01`）；`0x2A4B` R（报告描述符 46B）；`0x2A4C` WNR；`0x2A4E` R/WNR；`0x2A4D` Input R+Notify（ID 0，4B）；`0x2A4D` Feature R/W（ID 0） |
| CCCD | 0x2A4D input、battery 0x2A19 |
| adv interval | 未设置 → 库默认 160 → **100 ms** |
| 连接参数 | 8/8 → **10 ms**，latency 0，timeout 500 → **5 s**；12800 ms 参数更新 + 1600 ms PHY 更新 |
| notify 周期 | 使能后 500 ms 首包，此后 **800 ms** |
| payload | 4B：`buttons, X, Y, wheel`；实测内容 `00 02 02 00`（无按键、X=+2、Y=+2、wheel=0） |
| 配对 | 同 §6（MITM FALSE、bonding TRUE、NO_INPUT_NO_OUTPUT） |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

广播 TLV 语义：

TLV 语义：Flags（0x05 Limited|BR/EDR Not Supported）；Appearance（AD 0x19，`0x03C2` = HID Mouse）；Complete Local Name（AD 0x09，`HID Mouse`）。

展开字节：`02 01 05 | 03 19 C2 03 | 0A 09 "HID Mouse"`
scan-rsp：与 §6 同结构（conn range 10 ms、HID+Battery UUID、power 0）。

报告描述符（46 字节）：`05 01 09 02 A1 01 09 01 A1 00 05 09 19 01 29 03 15 00 25 01 75 01 95 08 81 02 05 01 09 30 09 31 09 38 15 81 25 7F 75 08 95 03 81 06 C0 C0`（`$EVT/HID_Mouse/Profile/hidmouseservice.c:80-107`）。

**BlueZ 判据**：看到 `HID Mouse`、appearance `0x03C2`；订阅 input report 后约 0.8 s 一包 4B `00 02 02 00`（光标持续右下移动）；写 feature report 可读回。

---

## 8. HID_Consumer

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/HID_Consumer/`（`APP/hidconsumer.c`, `Profile/hidconsumerservice.c`） |
| 角色 | Peripheral + HID Device |
| 设备名 | `"HID Consumer"` |
| 服务 | `0x1812` + `0x180F` + `0x1813` + `0x180A` |
| HID 特征 | `0x2A4A` R；`0x2A4B` R（报告描述符 25B）；`0x2A4C` WNR；`0x2A4E` R/WNR；`0x2A4D` Input R+Notify（ID 1，2B）；Feature R/W |
| adv interval | 未设置 → **100 ms** |
| 连接参数 | 8/8 → **10 ms**，latency 0，timeout 500 → **5 s** |
| notify 周期 | 使能后 500 ms 首包，此后 **1600 ms**；每周期发两包：按下 `00 01`（Volume Down），随后释放 `00 00` |
| 配对 | 同 §6 |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

广播 TLV 语义：

TLV 语义：Flags（0x05 Limited|BR/EDR Not Supported）；Appearance（AD 0x19，`0x03C0` = Generic HID）；Complete Local Name（AD 0x09，`HID Consumer`）。

展开字节：`02 01 05 | 03 19 C0 03 | 0D 09 "HID Consumer"`（appearance 0x03C0 Generic HID）
scan-rsp：同 §6 结构。

报告描述符（25B，Android 版；PC 版被注释）：

报告描述符（25 字节）语义：Usage Page = Consumer (0x0C)；Usage = Consumer Control (0x01)；Collection = Application；`REPORT_ID = 1`；Logical Min/Max = 0/1；Report Size = 8；Report Count = 1；两条 Input(Data,Var,Rel)：Usage `0xE9`（Volume Up）与 `0xEA`（Volume Down）；End Collection。PC 版描述符在源码中被注释、未编译。

发送函数把 `volume_up` 写入报告第 0 字节、`volume_dowm` 写入第 1 字节；事件处理器行为：

每个周期依次发两包：先 `Volume Down` 按下（`[0]=0,[1]=1`），再释放（`[0]=0,[1]=0`）；随后把报告事件重排到 **1600 tick** 之后。

**BlueZ 判据**：看到 `HID Consumer`、appearance `0x03C0`；订阅 input report 每 1.6 s 收到 `00 01` 紧接 `00 00`（音量减）；主机表现为音量键连发。

---

## 9. HID_Touch

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/HID_Touch/`（`APP/hidtouch.c`, `Profile/hidtouchservice.c`） |
| 角色 | Peripheral + HID Device |
| 设备名 | `"HID Touch"` |
| 服务 | `0x1812` + `0x180F` + `0x1813` + `0x180A` |
| HID 特征 | `0x2A4A` R；`0x2A4B` R（报告描述符 72B，Digitizer/Touch Screen，REPORT_ID 1）；`0x2A4C` WNR；`0x2A4E` R/WNR；`0x2A4D` Input R+Notify（ID 1，6B）；Feature R/W |
| adv interval | 未设置 → **100 ms** |
| 连接参数 | 8/8 → **10 ms**，latency 0，timeout 500 → **5 s** |
| notify 周期 | 使能后 500 ms 首包，此后 **100 ms** |
| payload | 6B：`touch, contactID, X_lo, X_hi, Y_lo, Y_hi`；`send_char` 从 4 起每包 +4；X=378+send_char，Y=356；`send_char>=100` 当包先发 release（touch=0）并把 send_char 归 0；正常包 touch=1、contactID=0 |
| 配对 | 同 §6 |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

广播 TLV 语义：

TLV 语义：Flags（0x05 Limited|BR/EDR Not Supported）；Appearance（AD 0x19，`0x03C5` = HID Digitizer Tablet）；Complete Local Name（AD 0x09，`HID Touch`）。

展开字节：`02 01 05 | 03 19 C5 03 | 0A 09 "HID Touch"`（appearance 0x03C5 Digitizer Tablet）

报告描述符要点（`$EVT/HID_Touch/Profile/hidtouchservice.c:81-122`）：Usage Page Digitizer(0x0D)/Touch Screen(0x04)，REPORT_ID 1，Tip Switch 1 bit + 7 bit padding，Contact ID 8 bit，X/Y 各 16 bit（Logical Max `DEF_DESKTOP_X_MAX/Y_MAX`）。

**BlueZ 判据**：看到 `HID Touch`、appearance `0x03C5`；订阅后每 100 ms 一包 6B：按下包 X=378+send_char（382→474，+4/包），Y=356；当 send_char≥100 先发释放包（touch=0，X=478）再从 378 重来；主机识别为触摸 digitizer。

---

## 10. SpeedTest_Peripheral

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/SpeedTest_Peripheral/`（`APP/peripheral.c`, `Profile/gattprofile.c`） |
| 角色 | Peripheral；**多包吞吐测试** |
| 设备名 | `"Simple Peripheral"` |
| 服务/特征 | 与 §1 同：0xFFE0、0xFFE1 R/W、0xFFE2 R、0xFFE3 W、0xFFE4 Notify+CCCD、0xFFE5 R（长度 1/1/1/1/5，初值 1/2/3/4/{1,2,3,4,5}） |
| adv interval | 80 → **50 ms** |
| 连接参数 | min 6 / max 100 → **7.5–125 ms**；latency 0；timeout 100 → **1 s** |
| notify 周期 | 不是周期任务：连接后注册 `peripheralConnectEventCB`，**每个连接事件内循环连续发 CHAR4 notify，直到分配或发送失败**；每包 `peripheralMTU - 3` 字节，内容为 `speed_test_buf[244]` 全 0 |
| 统计 | `SBP_SPEED_TEST_EVT` 首 3200 ms 后置 `speed_test_enable=TRUE`，之后每 1600 ms 打印 `Tx: %dB/s`（无单位换算，实为字节/统计窗） |
| 配对 | passkey 0、WAIT_FOR_REQ、MITM TRUE、bonding TRUE、DISPLAY_ONLY |
| `.cproject` define | `DEBUG=1`、`BLE_MAC=1`、`BLE_TX_NUM_EVENT=8`、`BLE_BUFF_NUM=20`、**`BLE_BUFF_MAX_LEN=251`**（MTU 上限 247）、`CH58xBLE` |
| 板内外设 | 仅 PA9 调试串口 |

广播/rsp 与 §1 完全一致（`02 01 06 | 03 02 E0 FF`；rsp `12 09 "Simple Peripheral" | 05 12 06 00 64 00 | 02 0A 00`）。

`peripheralConnectEventCB` 的行为：

吞吐发送行为：连接事件回调中，若 `speed_test_enable` 为真，则循环以长度 `peripheralMTU − 3` 发送 CHAR4 notify；每次成功后把该长度累加到 `peripheralTxDataLen`；一旦发送/分配失败立即退出循环（不做重试，等下一个连接事件）。

**BlueZ 判据**：看到 `Simple Peripheral`；MTU 协商到 247（`btmgmt info`/`btmon` 可见 Exchange MTU 247）；订阅 `ffe4` 后瞬时高吞吐 244B/包（连接事件内背靠背），串口每 1.6 s 打印一次累计字节数。

---

## 11. SpeedTest_Central

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/SpeedTest_Central/`（`APP/central.c`, `APP/central_main.c`） |
| 角色 | 仅 Central（主机） |
| 主源 | `central.c`：扫描→按固定 MAC 过滤→连接→发现 0xFFE0→读 0xFFE1→读 CCCD→写 CCCD=1→收 notify 统计 |
| 广播 | 无（不做 adv） |
| 扫描 | `DEFAULT_SCAN_DURATION 2400` → **1500 ms**；active scan TRUE；`DEVDISC_MODE_ALL`；max 10 条 |
| 对端固定 MAC | 数组 `{0x02, 0x02, 0x03, 0xE4, 0xC2, 0x84}` → 人读序 **84:C2:E4:03:02:02** |
| 连接参数 | 建立 min 10 / max 10 → **12.5 ms**；timeout 100 → **1 s**；更新 10/10（12.5 ms），latency 0，timeout 600 → **6 s** |
| notify | 订阅 0xFFE4 CCCD（写 `01 00`）；`ATT_HANDLE_VALUE_NOTI` 累加 `centralRxDataLen`，连接后 1600 ms 启动 `START_SPEED_TEST_EVT`，此后每 **1600 ms** 打印 `Rx: %dB/s` 并清零；不解析内容 |
| 配对 | passkey 0、`GAPBOND_CENT_*` WAIT_FOR_REQ、MITM TRUE、bonding TRUE、`GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT`，并注册 `GAPBondMgr_PasscodeRsp(...SUCCESS, passcode)` 回调 |
| `.cproject` define | `DEBUG=1`、`CLK_OSC32K=0`（外部 32K 必需）、`BLE_TX_NUM_EVENT=8`、`BLE_BUFF_NUM=20`、`BLE_BUFF_MAX_LEN=251`、`CH58xBLE` |
| 板内外设 | 仅 PA9 调试串口 |

关键参数：

| 项 | 取值 |
|---|---|
| 扫描时长 | `2400` × 0.625 ms = **1500 ms** |
| 建立连接 min / max | `10` / `10` × 1.25 ms = **12.5 ms** |
| 建立连接 supervision timeout | `100` × 10 ms = **1 s** |
| 对端 MAC（数组） | `{0x02,0x02,0x03,0xE4,0xC2,0x84}` → 人读序 **84:C2:E4:03:02:02** |

**BlueZ 判据**：本机不做广播，bluez 扫不到它；它只会连 **84:C2:E4:03:02:02** 且该对端必须广播 0xFFE0 服务。若对端是 CH582M 芯片出厂 MAC（如 `0C:3D:5E:A6:62:94`），需把本数组改成该 MAC 的低字节序，否则串口打印 `Device not found...` 并反复重扫。

---

## 12. BLE_UART

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/BLE_UART/`（`APP/peripheral.c`, `APP/app_uart.c`, `APP/ble_uart_service/ble_uart_service_16bit.c`, `APP/app_drv_fifo/`） |
| 角色 | Peripheral + UART3 透传 |
| 设备名 | `"ch583_ble_uart"`（GAP 名与 rsp 完整名一致） |
| 服务 | **0xFFF0**；TX 特征 **0xFFF1**（Notify，`ble_uart_TxCharValue` 初值 0，CCCD `ble_uart_TxCCCD[4]`）；RX 特征 **0xFFF2**（Write \| WNR，长度 `BLE_UART_RX_BUFF_SIZE=1`，初值 0） |
| CCCD/indicate | 仅 TX 0xFFF1 有 CCCD；indicate 属性在源码中被注释、未启用（本变体仅 Notify） |
| adv interval | 160 → **100 ms** |
| 连接参数 | `GAPROLE_MIN/MAX_CONN_INTERVAL` 硬编码 **6 / 1000**（7.5 ms–1250 ms）；rsp 的 conn range 却写 `DEFAULT_DESIRED_MIN/MAX = 8 / 20`（10–25 ms）；latency 0；timeout 100 → **1 s** |
| notify 周期 | 事件驱动：UART3 收到数据 → `UART_TO_BLE_SEND_EVT`（2 tick 后）→ 若 FIFO 长度 ≥ `ATT_GetMTU()-3` 立即发；否则每 4 tick 重试，**累计 >10 次**后强制发短包；发送成功后再排 2 tick 继续 |
| payload 语义 | 上行：UART3 RX FIFO 原始字节 → `0xFFF1` notify，单包 `ATT_GetMTU()-3`（MTU 23 时 20B，MTU 247 时 244B）；下行：`0xFFF2` 写入 → 写入 UART3 TX FIFO；同时**回写自身 RX FIFO** 实现 notify-back 回显 |
| 配对 | passkey 0、WAIT_FOR_REQ、MITM TRUE、bonding TRUE、DISPLAY_ONLY |
| `.cproject` define | `DEBUG=1`、`CH583`、`CH58xBLE`；**无** BLE_BUFF_MAX_LEN 覆盖 → 默认 27（MTU 23）。说明书称可改到 251 |
| 板内外设 | UART3：**TXD3=PA5**（推挽输出）、**RXD3=PA4**（上拉输入）；UART3 速率 115200、8N1、FIFO 触发 4 字节；DEBUG：UART1 TXD1=PA9，115200 |

广播/rsp TLV 语义：

TLV 语义：rsp = Complete Local Name（AD 0x09，`ch583_ble_uart`）+ Slave Connection Interval Range（AD 0x12，min=8、max=20）+ Tx Power（AD 0x0A，0 dBm）；adv = Flags（0x06）+ 16-bit UUID list（AD 0x02，广播值 **0xFFE0**，与实际服务 0xFFF0 不一致）。

展开字节：adv `02 01 06 | 03 02 E0 FF`；rsp `0F 09 "ch583_ble_uart" | 05 12 08 00 14 00 | 02 0A 00`

**注意（EVT 自身缺陷）**：`advertData` 里用的是 `SIMPLEPROFILE_SERV_UUID`（在 `APP/include/peripheral.h:36` 被定义为 `0xFFE0`），而真实服务 UUID 是 `0xFFF0`——**广播服务 UUID 与实际 GATT 服务不一致**。BlueZ 以 `0xFFF0` 发现为准。

### 12.1 服务变体与 `.cproject` 排除

`.cproject` 排除项：

```xml
<entry excluding="ble_uart_service/ble_uart_service.c|ble_uart_service/ble_uart_service_same_char.c|ble_uart_service/ble_uart_service_same_16bit_char.c" flags="VALUE_WORKSPACE_PATH" kind="sourcePath" name="APP"/>
```

即**只编译 `ble_uart_service_16bit.c`**。四个变体：

| 变体 | Service UUID | TX / RX UUID | 说明 |
|---|---|---|---|
| `ble_uart_service_16bit.c`（选中） | `0xFFF0` | TX `0xFFF1`，RX `0xFFF2` | 16-bit 双 UUID |
| `ble_uart_service.c` | 128-bit `6e400001-b5a3-f393-e0a9-e50e24dcca9f`（字节 `9F CA DC 24 0E E5 A9 E0 93 F3 A3 B5 01 00 40 6E`） | RX `…0002`（`…02 00 40 6E`），TX `…0003` | 128-bit 双 UUID（Nordic UART 风格） |
| `ble_uart_service_same_char.c` | 128-bit `6e400001-b5a3-f393-e0a9-e50e24dcca9e`（首字节 `0x9E`） | TX/RX **同一特征 UUID `…0003`** | 128-bit 单特征双向 |
| `ble_uart_service_same_16bit_char.c` | `0xFFF0` | TX/RX **同一 `0xFFF1`** | 16-bit 单特征双向 |

### 12.2 FIFO 与回显逻辑

```c
#define APP_UART_TX_BUFFER_LENGTH    512U
#define APP_UART_RX_BUFFER_LENGTH    2048U
```

收到 `BLE_UART_EVT_BLE_DATA_RECIEVED` 时：把 GATT 写入的字节原样写入 UART RX FIFO，并排 `UART_TO_BLE_SEND_EVT`（2 tick 后）——形成 notify-back 回显；同时把同一批字节推入 UART TX FIFO 从 UART3 发出。回显段落可整段删除而不影响 UART→BLE 方向。


**BlueZ 判据**：看到 `ch583_ble_uart`；`gatt` 服务 `0000fff0-…`，`fff1` notify（订阅 CCCD）、`fff2` write/WNR。向 `fff2` 写任意字节会从 `fff1` 原样回显（同长度，受 MTU 限制），并在 UART3 PA5/PA4（115200）收到同样字节；串口输入的数据从 `fff1` 通知主机。

---

## 13. Broadcaster

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/Broadcaster/`（`APP/broadcaster.c`） |
| 角色 | 仅 Broadcaster（不可连接） |
| 主源 | `broadcaster.c`：`GAPRole_BroadcasterInit/StartDevice`；**不注册任何 GATT 服务**（无 GGS/GATTServApp/DevInfo） |
| 设备名 | rsp 完整名 `"Broadcaster"`；adv 短名 `"abc"`；GAP 名特征不存在 |
| adv interval | 160 → **100 ms** |
| 广播类型 | 应用未显式设 `GAPROLE_ADV_EVENT_TYPE`，库默认非连接广播；无连接参数 |
| 广播 payload | flags `0x04`（BR/EDR Not Supported）+ Manufacturer Specific `'b','l','e'`（无 WCH 0x07D7 前缀）+ Short Name `'abc'` |
| notify/CCCD | 无 |
| 配对 | 无（不配对、不绑定） |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

广播 TLV：

TLV 语义：rsp = Complete Local Name（AD 0x09，`Broadcaster`）+ Tx Power（AD 0x0A，0 dBm）；adv = Flags（0x04，BR/EDR Not Supported）+ Manufacturer Specific（AD 0xFF，数据 ASCII `ble`，无 2 字节公司 ID）+ Shortened Local Name（AD 0x08，`abc`）。

展开字节：adv `02 01 04 | 04 FF 62 6C 65 | 04 08 61 62 63`；rsp `0C 09 "Broadcaster" | 02 0A 00`

**BlueZ 判据**：`bluetoothctl scan on`（主动扫描）可看到 `Broadcaster`/`abc`，无服务、不可连接；`connect` 失败。被动扫描时因名字在 rsp 中，可能只见 MAC。

---

## 14. Observer

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/Observer/`（`APP/observer.c`） |
| 角色 | 仅 Observer（扫描者） |
| 主源 | `observer.c`：`GAPRole_ObserverInit/StartDevice`；无 GATT 服务 |
| 广播 | 无 |
| 扫描 | `DEFAULT_SCAN_DURATION 4800` → **3000 ms**；active TRUE；`DEVDISC_MODE_ALL`；max 8 条；扫描结束后重扫 |
| 输出 | 每设备打印地址/RSSI/名字（`GAP_DEVICE_INFO_EVENT`） |
| 连接/配对 | 无 |
| `.cproject` define | `DEBUG=1`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

**BlueZ 判据**：本机不广播；用另一台设备广播即可在串口看到 `Device … Addr … RSSI …`；与 bluez 无交互。

---

## 15. Central

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/Central/`（`APP/central.c`） |
| 角色 | 仅 Central |
| 主源 | `central.c`：扫描→固定 MAC 过滤→连接→发现 0xFFE0→读 0xFFE1→查 CCCD→写 CCCD→循环写 0x5A/读 |
| 广播 | 无 |
| 扫描 | 2400 → **1500 ms**；active TRUE；ALL；max 10 |
| 对端固定 MAC | `{0x02, 0x02, 0x03, 0xE4, 0xC2, 0x84}` → **84:C2:E4:03:02:02** |
| 连接参数 | 建立 20/100 → **25–125 ms**，timeout 100 → **1 s**；更新 20/100，latency 0，timeout 600 → **6 s** |
| 读写 | `DEFAULT_READ_OR_WRITE_DELAY 1600` → **1600 ms**：写 `0xFFE1 = 0x5A`，下一次事件读 `0xFFE1`；CCCD 写入延迟 1600 ms |
| 配对 | passkey 0、`GAPBOND_CENT_*` WAIT_FOR_REQ、MITM TRUE、bonding TRUE、`GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT`，并注册 `GAPBondMgr_PasscodeRsp(...SUCCESS, passcode)` 回调 |
| `.cproject` define | `DEBUG=1`、`CLK_OSC32K=0`、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

**BlueZ 判据**：不广播；需对端为 **84:C2:E4:03:02:02** 且暴露 0xFFE0/0xFFE1。若对端是 bluez 主机，bluez 无法改变本机（本机是 central）；判据是本机串口打印 `Device found.../Connecting.../Write sent: 5a`。

---

## 16. CentPeri

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/CentPeri/`（`APP/central.c`, `APP/peripheral.c`, `APP/centPeri_main.c`） |
| 角色 | **Central + Peripheral 同时**（先 `GAPRole_PeripheralInit` + `GAPRole_CentralInit`） |
| Peripheral 面 | 与 §1 相同：名 `Simple Peripheral`、0xFFE0–0xFFE5、CHAR4 notify 0x88 / 1600 ms、adv 80 → **50 ms**、conn 20/100 → **25–125 ms**、latency 0、timeout 1 s |
| Central 面 | 扫描 1500 ms、active、ALL、固定 MAC **84:C2:E4:03:02:02**、建立 25–125 ms、更新 25–125 ms/timeout 6 s、写 0xFFE1=0x5A 每 1600 ms |
| 配对 | Peripheral 面 passkey 0 / WAIT_FOR_REQ / MITM TRUE / bonding TRUE / DISPLAY_ONLY；Central 面 `GAPBOND_CENT_*` passkey 0 / WAIT_FOR_REQ / **MITM TRUE** / bonding TRUE / NO_INPUT_NO_OUTPUT + `PasscodeRsp` 回调 |
| `.cproject` define | `DEBUG=1`、`CLK_OSC32K=0`、`CH58xBLE`；PERIPHERAL/CENTRAL 连接数用默认 1/3 |
| 板内外设 | 仅 PA9 调试串口 |

**BlueZ 判据**：主机能看到 `Simple Peripheral` 并可读写 §1 的服务；同时板子会主动去连 84:C2:E4:03:02:02。双向测试需两块板（一块 CentPeri + 一块 Peripheral，且 Peripheral 的 MAC 必须是 84:C2:E4:03:02:02，或改 `PeerAddrDef`）。

---

## 17. MultiCentral

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/MultiCentral/`（`APP/multiCentral.c`） |
| 角色 | 仅 Central，最多 3 条连接 |
| 广播 | 无 |
| 扫描 | 2400 → **1500 ms**；active TRUE；ALL |
| 对端固定 MAC（数组取值） | `{0x02,0x02,0x03,0xE4,0xC2,0x84}` / `{0x03,0x02,0x03,0xE4,0xC2,0x84}` / `{0x04,0x02,0x03,0xE4,0xC2,0x84}` → **84:C2:E4:03:02:02 / :03 / :04** |
| 连接参数 | 建立 20/100 → **25–125 ms**、timeout 1 s；更新 20/100、latency 0、timeout 6 s |
| 读写 | 每连接每 1600 ms 写 0xFFE1=0x5A 并读回 |
| 配对 | passkey 0、`GAPBOND_CENT_*` WAIT_FOR_REQ、MITM TRUE、bonding TRUE、`GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT`，并注册 `GAPBondMgr_PasscodeRsp(...SUCCESS, passcode)` 回调 |
| `.cproject` define | `DEBUG=1`、`CLK_OSC32K=0`、`CH58xBLE`；CENTRAL_MAX_CONNECTION 默认 3 |
| 板内外设 | 仅 PA9 调试串口 |

**BlueZ 判据**：不广播；需要 3 块对端板，MAC 分别为 `84:C2:E4:03:02:02/03/04`（或改 `PeerAddrDef` 三元素）。串口打印每条连接的 `Write sent: 5a`。

---

## 18. MultiCentPeri

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/MultiCentPeri/`（`APP/multiCentral.c`, `APP/multiPeripheral.c`） |
| 角色 | 3×Central + 3×Peripheral |
| Peripheral 面 | 名 `Simple Peripheral`、0xFFE0–0xFFE5、adv 80 → **50 ms**、conn 20/100 → **25–125 ms**、CHAR4 notify 0x88/1600 ms |
| Central 面 | 固定 MAC 同 §17 三个；扫描 1500 ms；建立/更新 25–125 ms；写 0xFFE1=0x5A/1600 ms |
| 配对 | Peripheral 面 passkey 0、WAIT_FOR_REQ、MITM TRUE、bonding TRUE、DISPLAY_ONLY；Central 面 `GAPBOND_CENT_*` MITM TRUE、NO_INPUT_NO_OUTPUT + `PasscodeRsp` |
| `.cproject` define | `DEBUG=1`、`CLK_OSC32K=0`、**`BLE_MEMHEAP_SIZE=10*1024`**、**`PERIPHERAL_MAX_CONNECTION=3`**、`CH58xBLE`（CENTRAL 默认 3） |
| 板内外设 | 仅 PA9 调试串口 |

**BlueZ 判据**：能扫到 `Simple Peripheral` 并看到 3 个可连接实例语义（同一 MAC 只能一个连接）；同时板子连 3 个固定 MAC 对端。

---

## 19. SYNC_ADV

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/SYNC_ADV/`（`APP/broadcaster.c`） |
| 角色 | 仅 Broadcaster，**LE Extended Advertising + Periodic Advertising**（蓝牙 5） |
| 主源 | `broadcaster.c`：`GAPRole_BroadcasterInit/StartDevice`；无 GATT 服务 |
| 设备名 | rsp 完整名 `"Broadcaster"`；adv 短名 `"abc"`；厂商数据 `'b','l','e'` |
| adv 事件类型 | `GAP_ADTYPE_EXT_NONCONN_NONSCAN_UNDIRECT`（不可连接、不可扫描的扩展广播） |
| 主 adv interval | 160 → **100 ms** |
| 周期广播 | `TGAP_PERIODIC_ADV_INT_MIN/MAX = 80` → **50 ms**；`TGAP_PERIODIC_ADV_PROPERTIES = GAP_PERI_PROPERTIES_INCLUDE_TXPOWER`；`TGAP_ADV_SECONDARY_PHY = GAP_PHY_VAL_LE_1M`；`TGAP_ADV_SECONDARY_MAX_SKIP = 0`；`TGAP_ADV_ADVERTISING_SID = 8` |
| 周期数据刷新 | `SBP_PERIODIC_EVT` 每 **160 tick (160 ms)** 重设 `GAPROLE_PERIODIC_ADVERT_DATA`（内容不变，44 字节） |
| 连接/配对 | 无（不可连接） |
| `.cproject` define | `DEBUG=1`、`BLE_MAC=1`（MAC `84:C2:E4:03:02:02`）、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

主广播 TLV 语义：

TLV 语义：主广播与 §13 相同（rsp `Broadcaster`；adv Flags 0x04 + 厂商数据 `ble` + 短名 `abc`），广播事件类型为扩展非连接非扫描。

展开：adv `02 01 04 | 04 FF 62 6C 65 | 04 08 61 62 63`；rsp `0C 09 "Broadcaster" | 02 0A 00`

周期广播 TLV 语义：

周期广播载荷语义：一条 Manufacturer Specific AD，长度字节 44（= 1 type + 3 ASCII `ble` + 40 数据）；40 字节为 `01..0A` 重复 4 次。总长 45 字节。

展开：`2C FF 62 6C 65 | 01..0A ×4`（长度 44 = type 1 + 'b','l','e' 3 + 40 数据；总 45 字节）

**BlueZ 判据**：需 LE 扩展扫描（`btmgmt`/新版 `bluetoothctl`）才能看到 `abc`/`Broadcaster`；不可连接。周期广播需配合 `SYNC_SCAN` 或支持 Periodic Advertising Sync 的工具；普通 `scan on` 只显示不可连接设备。

---

## 20. SYNC_SCAN

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/SYNC_SCAN/`（`APP/observer.c`） |
| 角色 | 仅 Observer，**扩展扫描 + 建立周期广播同步** |
| 主源 | `observer.c`：扫到固定 MAC 且 `periodicAdvInterval != 0` → `GAPRole_CreateSync` → 打印周期数据 |
| 扫描 | `DEFAULT_SCAN_DURATION 4800` → **3000 ms**；`DEFAULT_DISCOVERY_ACTIVE_SCAN FALSE`；`GAP_PHY_BIT_LE_1M`；max 58 |
| 同步超时 | `DEFAULT_CREAT_SYNC_TIMEOUT 4800` → **3000 ms**；`syncTimeout = (periodicAdvInterval * 6 + 7) / 8`（≈6 个周期） |
| 对端固定 MAC | 数组 `{0x02, 0x02, 0x03, 0xE4, 0xC2, 0x84}` → **84:C2:E4:03:02:02** |
| 过滤条件 | MAC 相等 **且** `pEvent->deviceExtAdvInfo.periodicAdvInterval != 0`；`sync.options = DUPLICATE_FILTERING_INITIALLY_ENABLED` |
| 输出 | 同步建立后打印 `sync handle`/`sync interval`；每个 `GAP_PERIODIC_ADV_DEVICE_INFO_EVENT` 打印 `periodic adv - len N ( 0x.. … )` |
| 配对/连接 | 无 |
| `.cproject` define | `DEBUG=1`、**`BLE_MEMHEAP_SIZE=1024*7`**、`CH58xBLE`；其余默认 |
| 板内外设 | 仅 PA9 调试串口 |

同步建立行为：收到扩展广播报告时，先比较 `PeerAddrDef` 与报告地址，且要求 `periodicAdvInterval != 0`；满足则用报告的 `addr/addrType/advertisingSID` 填充同步参数，`options=DUPLICATE_FILTERING_INITIALLY_ENABLED`，`syncTimeout=(periodicAdvInterval*6+7)/8`（约 6 个周期），调用 `GAPRole_CreateSync()`；成功后启动 3000 ms 同步超时定时器。

**BlueZ 判据**：本机不广播；需要 SYNC_ADV（或等价）在 **84:C2:E4:03:02:02** 上发周期广播，串口打印周期数据 45 字节 `2C FF 62 6C 65 01…0A`（重复 4 组）；若对端 MAC 不同则永不建同步。

---

## 21. BackupUpgrade_OTA

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/BackupUpgrade_OTA/`（`APP/peripheral.c`, `APP/peripheral_main.c`, `Profile/OTAprofile.c`, `APP/include/ota.h`） |
| 角色 | Peripheral（A/B 双区 App + OTA 服务） |
| 设备名 | GAP 名 `"Simple Peripheral"`；rsp 完整名 **`"simple Peripheral"`（首字母小写）** |
| 服务 | `0xFFE0` SimpleProfile（0xFFE1–0xFFE5，CHAR4 notify 8 字节）+ **`0xFEE0` OTA** |
| OTA 特征 | `0xFEE0` / `0xFEE1`：`GATT_PROP_READ \| GATT_PROP_WRITE \| GATT_PROP_WRITE_NO_RSP`；无 CCCD、无 notify/indicate；User Description `"OTA Channel"`；读写缓冲 `OTAProfileReadBuf/WriteBuf[IAP_LEN]`（`IAP_LEN=247`） |
| OTA 传输模型 | 主机 **write 0xFEE1** 下命令/数据；固件把响应放进 `OTAProfileReadBuf`，主机 **read 0xFEE1** 取回（`OTAProfile_SendData()` 限制单次 ≤20 字节，超出返回 0xFE） |
| CCCD | 仅 SimpleProfile CHAR4 有 CCCD（len 8，初值 `"01234567"`） |
| adv interval | 160 → **100 ms** |
| 连接参数 | rsp 声明 min 6 / max 12 → **7.5–15 ms**；latency 0；timeout 1000 → **10 s**；仅当实际初始 `connInterval > 12` 时主动 `GAPRole_PeripheralConnParamUpdateReq(6,12,0,1000)`；`DEFAULT_ENABLE_UPDATE_REQUEST`/`DEFAULT_CONN_PAUSE_PERIPHERAL` 有宏定义但未被引用 |
| notify 周期 | SimpleProfile CHAR4 每 `SBP_PERIODIC_EVT_PERIOD 1000` → **1000 ms**，内容为 CHAR4 自身 8 字节（`"01234567"`，读回再写回，非新数据） |
| 配对 | passkey 0、WAIT_FOR_REQ、MITM TRUE、bonding TRUE、DISPLAY_ONLY |
| `.cproject` define | `DEBUG=1`、**`BLE_BUFF_MAX_LEN=251`**、`CH58xBLE`；无 ROM 覆盖 |
| Flash 布局 | `Ld/Link.ld`：`FLASH ORIGIN=0x00001000 LENGTH=216K`；`ota.h`：`IMAGE_A_START_ADD=4*1024`、`IMAGE_SIZE=216*1024`、`IMAGE_B_START_ADD=0x1000+216K`、`IMAGE_IAP_START_ADD=IMAGE_B+216K`、`IMAGE_IAP_SIZE=12*1024`、`OTA_DATAFLASH_ADD=0x00077000-FLASH_ROM_MAX_SIZE` |
| 板内外设 | 仅 PA9 调试串口 |

广播（`advertData` 与 §1 相同；rsp 首字母小写）：

TLV 语义：rsp = Complete Local Name（AD 0x09，**`simple Peripheral`**，首字母小写）+ Slave Connection Interval Range（AD 0x12，min=6、max=12）+ Tx Power（AD 0x0A，0 dBm）。

展开：adv `02 01 06 | 03 02 E0 FF`；rsp `12 09 "simple Peripheral" | 05 12 06 00 0C 00 | 02 0A 00`

`ota.h` IAP 命令字（事实取值）：

| 命令 | 值 | 语义 |
|---|---|---|
| `CMD_IAP_PROM` | 0x80 | 编程 |
| `CMD_IAP_ERASE` | 0x81 | 擦除 |
| `CMD_IAP_VERIFY` | 0x82 | 校验 |
| `CMD_IAP_END` | 0x83 | 结束 |
| `CMD_IAP_INFO` | 0x84 | 读设备信息 |
| `IAP_LEN` | 247 | 命令帧最大长度 |

帧内地址字段为 16 bit、以 4 字节为单位偏移；`info` 帧无地址字段。

**BlueZ 判据**：看到 `simple Peripheral`（rsp）但 GAP 名为 `Simple Peripheral`；服务有 `0000ffe0-…` 与 **`0000fee0-…`**，`fee1` 属性 read+write+write-without-response。典型流程：写 `81 <len> <addr16> <blocknum16>` 擦除 → 写 `80 …` 编程 → 写 `82 …` 校验 → 写 `83 …` 结束；每次写后 read `fee1` 取 ≤20 字节响应（0x00 成功）。

---

## 22. IoCHub_NET

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/IoCHub_NET/`（`APP/peripheral.c`, `APP/peripheral_main.c`, `APP/ble_iochub_service/ble_iochub_service_16bit.c`, `readme.txt`） |
| 角色 | Peripheral + IoChub 数据点（DP）网关从机 |
| 设备名 | rsp 完整名 **`"ch583_ble_iochub"`**；GAP 名特征 **`"CH583_ble_iochub"`**（首字母大写 CH，**与 rsp 不一致**） |
| 服务 | **0xFFF3**；TX **0xFFF4**（Notify，CCCD `[4]`）；RX **0xFFF5**（Write \| WNR） |
| CCCD/indicate | 仅 0xFFF4 CCCD；无 indicate |
| adv interval | 160 → **100 ms** |
| 连接参数 | `GAPROLE_MIN/MAX` 硬编码 6/1000（7.5–1250 ms）；rsp conn range 8/20（10–25 ms）；latency 0；timeout 1 s |
| 上传周期 | 订阅通知后启动 `IOCHUB_ALL_DP_UPLOAD_EVT`：首包 1000 ms 后，此后每 **3000 ms** 上报 `DP_ID_LIGHT(0x01)` 与 `DP_ID_SWITCH(0x02)` 两个 bool DP；按键变化立即上报 `DP_ID_SWITCH` |
| 帧格式 | 上行 `33 CC \| id \| type \| len_hi \| len_lo \| data… \| checksum8`；下行 `BB 44 \| id \| type \| len_hi \| len_lo \| data… \| checksum8`；`BLE_HEAD_LEN=2`、`BLE_FOMRAT_LEN=4`、`BLE_TAIL_LEN=1`；`DP_TYPE_BOOL=0x01` |
| 服务实现 | 只编译 `ble_iochub_service_16bit.c`；`.cproject` 排除 `ble_iochub_service.c \| same_char \| same_16bit_char \| app_uart.c \| ble_uart_service*` |
| FIFO | `APP_BLE_TX_BUFFER_LENGTH 512U`、`APP_BLE_RX_BUFFER_LENGTH 2048U` |
| 配对 | passkey 0、`GAPBOND_PAIRING_MODE_WAIT_FOR_REQ`、MITM TRUE、bonding TRUE、`GAPBOND_IO_CAP_DISPLAY_ONLY`（与 §1 同）；readme 的网关会话密钥属应用层，不是 BLE 配对 |
| `.cproject` define | `DEBUG=1`、`CH583`、`CH58xBLE`；其余默认 |
| 板内外设 | **LED_LINK_PIN = GPIO_Pin_18**、**LED_LIGHT_PIN = GPIO_Pin_19**、`KEY_SWITCH_PIN = GPIO_Pin_4`（GPIOB，上拉，`FILTER_TIMES=50`）；无 UART 透传 |

`readme.txt` 事实摘要（已改写，不保留原文）：

- **硬件 IO**：连接状态指示灯 PB19、灯控 PB18、切换开关 PB4（注意：这与 `peripheral.h` 的宏定义相反，代码实际把灯控放在 PB19、连接灯放在 PB18）。
- **拓扑**：手机/主机端 App ↔ IoChub 网关 ↔ 开发板；网关软件（WCHIoCHubGateWay）负责会话 ID 与密钥，主机端 App（IoCHubNetApp）填同一 ID/密钥入会。
- **流程**：上电 → 网关枚举设备 → 连接名为 `ch583_ble_iochub` 的设备 → 主机端会话列表显示 MAC、灯状态、开关状态 → App 控灯；按板载键切换开关并上报。
- **BLE 层只承载 DP 帧**，会话密钥是应用层字段，不参与 BLE 配对。

**注意（readme 与代码冲突）**：readme 写「状态灯 PB19、灯控 PB18」，`peripheral.h` 却写 `LED_LINK_PIN=Pin_18`、`LED_LIGHT_PIN=Pin_19`（灯控在 PB19）。以代码为准：**灯控 PB19、连接灯 PB18**。

广播 TLV（`advertData`）：

TLV 语义：Flags（0x06）+ 16-bit Service UUID list（AD 0x02，`0xFFF3`）。

展开：adv `02 01 06 | 03 02 F3 FF`；rsp `11 09 "ch583_ble_iochub" | 05 12 08 00 14 00 | 02 0A 00`

**BlueZ 判据**：看到 `ch583_ble_iochub`；服务 `0000fff3-…`，`fff4` notify、`fff5` write/WNR。订阅 `fff4` 后每 3 s 收到两帧 `33 CC 01 01 00 01 <val> <cs>`、`33 CC 02 01 00 01 <val> <cs>`；写 `fff5` 帧 `BB 44 01 01 00 01 <0/1> <cs>` 可开关 PB19 灯。

---

## 23. OnlyUpdateApp_IAP（仅 OTA 服务面）

| 项 | 事实参数与行为规格 |
|---|---|
| EVT 路径 | `$EVT/OnlyUpdateApp_IAP/`（`APP/peripheral.c`, `Profile/OTAprofile.c`, `APP/include/ota.h`） |
| 角色 | Peripheral，**仅 IAP 升级从机**（无应用服务） |
| 设备名 | `"OTAOTA_OTAOTA_OTA"`（GAP 名与 rsp 完整名一致） |
| 服务 | **仅 `0xFEE0` / `0xFEE1`**（Read \| Write \| WNR，`"OTA Channel"`，`IAP_LEN=247`）；**不添加** SimpleProfile/Battery/DevInfo |
| adv interval | **32 → 20 ms** |
| 连接参数 | min 6 / max 12 → **7.5–15 ms**；latency 0；timeout 1000 → **10 s** |
| 配对 | 无 `GAPBondMgr_*` 调用（`peripheral.c` 无配对段） |
| Flash 布局 | `Ld/Link.ld`：`FLASH ORIGIN=0x0000C000 LENGTH=16K`；`RAM ORIGIN=0x20002000 LENGTH=24K` |
| `.cproject` define | `DEBUG=1`、**`CH58xBLE_ROM=1`**、`BLE_BUFF_MAX_LEN=251` |
| 启动逻辑 | `ReadImageFlag()`；若复位非软复位且 `CurrImageFlag == IMAGE_OTA_FLAG` → 打印 `jump App`（`jumpApp()` 被注释） |
| 板内外设 | 仅 PA9 调试串口 |

广播 TLV 语义：

TLV 语义：rsp = Complete Local Name（AD 0x09，`OTAOTA_OTAOTA_OTA`）+ Slave Connection Interval Range（AD 0x12，min=6、max=12）+ Tx Power（AD 0x0A，0 dBm）；adv = Flags（0x06）+ 16-bit UUID list（AD 0x02，广播值 **0xFFE0**，与实际服务 0xFEE0 不一致）。

展开：adv `02 01 06 | 03 02 E0 FF`（广播的是 0xFFE0，实际服务 0xFEE0，**又一个 EVT 自身不一致**）；rsp `12 09 "OTAOTA_OTAOTA_OTA" | 05 12 06 00 0C 00 | 02 0A 00`

**BlueZ 判据**：扫描到 `OTAOTA_OTAOTA_OTA`；连上后 GATT 只有 `0000fee0-…` / `fee1`（read+write+WNR）。读 `fee1` 取响应（≤20B）；写 `fee1` 用 §21 的 0x80–0x84 命令帧升级。

---

---

# 附录

## A. 固定对端 MAC 汇总

| 例程 | 数组取值 | 人读序 | 用途 |
|---|---|---|---|
| Central | `{0x02, 0x02, 0x03, 0xE4, 0xC2, 0x84}` | `84:C2:E4:03:02:02` | 只连该 MAC |
| CentPeri | 同上 | `84:C2:E4:03:02:02` | 只连该 MAC |
| SpeedTest_Central | 同上 | `84:C2:E4:03:02:02` | 只连该 MAC |
| SYNC_SCAN | 同上 | `84:C2:E4:03:02:02` | 只与该 MAC 建周期同步 |
| MultiCentral | `{0x02,0x02,0x03,0xE4,0xC2,0x84}` / `{0x03,…}` / `{0x04,…}` | `84:C2:E4:03:02:02/03/04` | 三条连接 |
| MultiCentPeri | 同 MultiCentral | `84:C2:E4:03:02:02/03/04` | 三条连接 |
| （本机自定义 MAC） | `MacAddr[6] = {0x84,0xC2,0xE4,0x03,0x02,0x02}` | `84:C2:E4:03:02:02` | **仅 `SpeedTest_Peripheral` 与 `SYNC_ADV` 的 `.cproject` 定义 `BLE_MAC=1`**；其余例程（含 Central/CentPeri/BLE_UART/IoCHub/Peripheral）虽在 `*_main.c` 里有 `#if BLE_MAC` 的 MacAddr 定义，但未定义宏 → 不编译，使用芯片出厂 MAC |

> 注意：`cfg.MacAddr` 写库时按 `MacAddr[5-i]` **反序**；上面数组是人读顺序。除 `SpeedTest_Peripheral`、`SYNC_ADV` 外的所有例程均使用芯片出厂 MAC（含 Central 系列作为主机时），需在串口/`bluetoothctl` 中读取。

## B. CH582M QFN48 引脚核对（BLE_UART 的 UART3）

数据源：`/home/teze/CH32/CubeMX/ch32-rs-cubemx/data/devices/ch582m/chip.json`、`data/devices/ch582m/peripherals.json`、`remap.json`。

| 信号 | chip.json 引脚 | QFN48 是否引出 | 备注 |
|---|---|---|---|
| `UART3_TX` remap0 | `PA5`（pin 37，ADC_IN1） | **是** | BLE_UART 默认 TXD3 |
| `UART3_RX` remap0 | `PA4`（pin 36，ADC_IN0） | **是** | BLE_UART 默认 RXD3 |
| `UART3_TX` remap1 | `PB21`（pin 27） | **是** | 与 I2C remap1 SCL 复用 |
| `UART3_RX` remap1 | `PB20`（pin 28） | **是** | 与 I2C remap1 SDA 复用 |
| `UART1_TX` remap0 | `PA9`（pin 6） | **是** | 所有例程 DEBUG 口 |
| `UART1_RX` remap0 | `PA8`（pin 5） | **是** | — |

UART3 复用（`data/devices/ch582m/peripherals.json`，事实）：

| remap | TX | RX |
|---|---|---|
| 0 | PA5 | PA4 |
| 1 | PB21 | PB20 |

结论：**BLE_UART 的 UART3 PA5/PA4 在 CH582M QFN48 上已引出且完全可用**，不存在「板无引出」，也不需要替代引脚。若 PA4/PA5 被 ADC 占用，可改 remap1 到 PB20/PB21（同样已引出）。IoCHub 使用的 PB4（按键）在 QFN48 pin 20；LED PB18/PB19 在 pin 30/29，均无冲突。

## C. 不适用清单（每类一句话理由）

| 类别 | 数量 | 一句话理由 |
|---|---|---|
| `MESH/`（`adv_ali_light*` 5 项、`adv_proxy`、`adv_vendor*` 6 项、`provisioner_vendor*` 2 项、`MESH_LIB` 等共 15 项） | 15 | 需要 Provisioner/多节点组网、阿里 SIG 模型数据库或 Friend/LPN 角色，单板单机无法验证，且与 M18「单机 BLE 规格」目标不同。 |
| `LWNS/`（broadcast / mesh / multicast / multinetflood / netflood / ruc / rucft / unicast / uninetflood 9 个示例） | 9 | WCH 私有低功耗无线网络栈（`LIBWCHLWNS.a`），需要多节点与 `lwns_adapter_*_mac` 选型，不是标准 GATT 外设。 |
| `RF_PHY/` | 1 | 纯 2.4G 私有射频收发（无 BLE 协议栈/GATT），需配对板与射频仪器测 PER。 |
| `RF_PHY_Hop/` | 1 | 跳频私有射频，需多板同步与频谱/仪器环境。 |
| `Direct_Test_Mode/` | 1 | 射频直测（DTM）固件，靠 UART 命令由综测仪控制，无 BLE 应用层。 |
| `peripheral_ancs_client/` | 1 | 需要 iPhone 的 ANCS 服务与配对授权，无法在 Linux/bluez 复现。 |
| `BLE_USB/` | 1 | 复合 USB HID + BLE，依赖 USB 协议栈与主机枚举，超出单 BLE 规格。 |
| `BackupUpgrade_IAP/` | 1 | 仅 IAP 引导/固件搬运，无独立应用 GATT（OTA 服务面已由 §21/§23 覆盖）。 |
| `BackupUpgrade_JumpIAP/` | 1 | 仅跳转引导，不含 BLE 应用。 |
| `OnlyUpdateApp_JumpIAP/` | 1 | 仅跳转 App 的引导，不含 BLE 服务。 |
| `OnlyUpdateApp_IAP/` | 1 | **已按 OTA 服务面取证（§23）**；本身无应用层，故不列为可运行 BLE 应用。 |

## D. 两份 GBK 命名 PDF 的文件名解码与主题

解包工具把 GBK 字节按 CP866 误解码，需 `UTF-8 → CP866 → GBK` 还原（不是直接 `iconv -f GBK`）：

| 还原后文件名 | 主题一句话 |
|---|---|
| `WCH蓝牙空中升级（BLE OTA）.PDF` | WCH BLE OTA 空中升级方案/工具链说明。 |
| `沁恒低功耗蓝牙软件开发参考手册.PDF` | 沁恒低功耗蓝牙（CH58x BLE）软件开发参考手册。 |

（同法还原 `$EVT/MESH/` 下两份：`沁恒低功耗蓝牙MESH软件开发参考手册.pdf`、`沁恒低功耗MESH APP管理配网应用手册.pdf`；`$EVT/PUB/` 下：`CH583评估版说明书.pdf`、`蓝牙芯片的电路及PCB设计的重要注意事项.pdf`。）

## E. 全部例程速查表

| # | 例程 | 设备名（扫描可见） | 主服务 | adv/rsp 名 | adv 间隔 | 连接参数 | notify |
|---|---|---|---|---|---|---|---|
| 1 | Peripheral | Simple Peripheral | FFE0 | rsp | 50 ms | 7.5–125 ms / L0 / 1 s | FFE4 0x88, 1600 ms |
| 2 | OnlyUpdateApp_Peripheral | Simple Peripheral | FFE0 | rsp | 50 ms | 7.5–125 ms / L0 / 1 s | FFE4 0x88, 1600 ms；写 FFE3 跳 OTA |
| 3 | HeartRate | Heart Rate Sensor | 180D + 180F | adv | 20→1000 ms | 25–200 ms / L1 / 10 s | 2A37 2 s；2A19 15 s |
| 4 | CyclingSensor | CSC Sensor | 1816 + 180F | adv | 20→1065 ms | 25–250 ms / L20 / 10 s | 2A5B 1 s |
| 5 | RunningSensor | RSC Sensor | 1814 + 180F | rsp | 30→1000 ms | 25–200 ms / L0 / 10 s | 2A53 2 s |
| 6 | HID_Keyboard | HID Keyboard | 1812 (+180F/1813) | adv | 100 ms（默认） | 10 ms / L0 / 5 s | 2A4D 8B, 2 s |
| 7 | HID_Mouse | HID Mouse | 1812 | adv | 100 ms | 10 ms / L0 / 5 s | 2A4D 4B, 800 ms |
| 8 | HID_Consumer | HID Consumer | 1812 | adv | 100 ms | 10 ms / L0 / 5 s | 2A4D 2B, 1600 ms |
| 9 | HID_Touch | HID Touch | 1812 | adv | 100 ms | 10 ms / L0 / 5 s | 2A4D 6B, 100 ms |
| 10 | SpeedTest_Peripheral | Simple Peripheral | FFE0 | rsp | 50 ms | 7.5–125 ms / L0 / 1 s | FFE4 突发（MTU-3） |
| 11 | SpeedTest_Central | —（不广播） | 连 FFE0 | — | — | 12.5 ms / L0 / 1 s | 订阅 FFE4 |
| 12 | BLE_UART | ch583_ble_uart | FFF0 | rsp | 100 ms | 7.5–1250 ms / L0 / 1 s | FFF1 事件驱动 |
| 13 | Broadcaster | Broadcaster（rsp）/abc | 无 | rsp + adv | 100 ms | 不可连接 | — |
| 14 | Observer | — | 无 | — | — | — | — |
| 15 | Central | — | 连 FFE0 | — | — | 25–125 ms / L0 / 6 s | 写 0x5A/1.6 s |
| 16 | CentPeri | Simple Peripheral | FFE0 | rsp | 50 ms | 25–125 ms / L0 / 1 s | FFE4 0x88/1.6 s |
| 17 | MultiCentral | — | 连 FFE0 ×3 | — | — | 25–125 ms / L0 / 6 s | 写 0x5A/1.6 s |
| 18 | MultiCentPeri | Simple Peripheral | FFE0 | rsp | 50 ms | 25–125 ms / L0 / 1 s | FFE4 0x88/1.6 s |
| 19 | SYNC_ADV | Broadcaster（rsp）/abc | 无 | rsp + adv | 100 ms（周期 50 ms） | 不可连接 | 周期数据 50 ms |
| 20 | SYNC_SCAN | — | 无 | — | — | — | 打印周期数据 |
| 21 | BackupUpgrade_OTA | Simple Peripheral / rsp simple Peripheral | FFE0 + FEE0 | rsp | 100 ms | 7.5–15 ms / L0 / 10 s | CHAR4 8B/1 s；FEE1 读写 |
| 22 | IoCHub_NET | ch583_ble_iochub（rsp）/CH583_ble_iochub（GAP） | FFF3 | rsp | 100 ms | 7.5–1250 ms / L0 / 1 s | FFF4 DP/3 s |
| 23 | OnlyUpdateApp_IAP | OTAOTA_OTAOTA_OTA | FEE0 | rsp | 20 ms | 7.5–15 ms / L0 / 10 s | 无（FEE1 读写） |

## F. 与「CH32V20xEVT 同源推断」的关键差异清单

| 主题 | 同源推断/既有文档 | CH583 EVT 事实 | 影响 |
|---|---|---|---|
| 默认 GATT UUID 数量 | `DEFAULT_BLE_CONFIG` 只预设 3 个（FFE0/FFE1/FFE2），见 `docs/CH58X_BLE_CONTRACT.md` D1 | SimpleProfile 实际 **5 个特征 FFE0–FFE5**，长度 1/1/1/1/**5**，初值 1/2/3/4/{1,2,3,4,5} | 生成器模板需 6 属性表 → 至少 11 属性（含 User Description） |
| 默认广播间隔 | 100 ms | Peripheral/CentPeri 为 **80×0.625 = 50 ms**；HeartRate 20 ms 快广播；Cycling 20 ms；Running 30 ms；OnlyUpdateApp_IAP 20 ms | 不能统一写 100 ms |
| notify 周期与 payload | 「notify 任务周期 1 s 发 1 字节状态」 | Peripheral **1600 ms / 1B 0x88**；HID keyboard 2000 ms；mouse 800 ms；consumer 1600 ms；touch 100 ms；HeartRate 2000 ms；Cycling 1000 ms；Running 2000 ms；OTA CHAR4 1000 ms；IoCHub 3000 ms | 逐例程取值，不能全局 1 s |
| 设备名 | 缺省 `Simple Peripheral` | BLE_UART=`ch583_ble_uart`；IoCHub rsp=`ch583_ble_iochub` / GAP=`CH583_ble_iochub`；OTA IAP=`OTAOTA_OTAOTA_OTA`；OTA rsp=`simple Peripheral`（首字母小写，与 GAP 名不同） | 名称必须按例程取值，且注意 adv/GAP 名可不同 |
| UUID 分配 | FFE0–FFE2 三件套 | BLE_UART=`FFF0/FFF1/FFF2`；IoCHub=`FFF3/FFF4/FFF5`；OTA=`FEE0/FEE1` | 新增 UART/IoChub/OTA 服务不能复用 FFE0 |
| MTU | 硬编码 ATT_MTU=23 / BufMaxLen=27 | 默认仍为 27（MTU 23），但 **SpeedTest_* 与 BackupUpgrade_OTA / OnlyUpdateApp_IAP 设 `BLE_BUFF_MAX_LEN=251` → MTU 247**；BLE_UART 代码按 `ATT_GetMTU()-3` 自适应（文档建议 20–247） | 吞吐类例程需 251 缓冲；bluez 侧要显式 MTU 交换 |
| 广播服务 UUID | 广播 0xFFE0 且等于实际服务 | BLE_UART 广播 **0xFFE0 但实际服务 0xFFF0**；OnlyUpdateApp_IAP 广播 **0xFFE0 但实际服务 0xFEE0** | 扫描过滤不能只信 adv UUID，需连后 GATT 发现 |
| 引脚 | BLE_UART UART 引脚未定/推断 | **UART3 TXD3=PA5、RXD3=PA4**（remap0，QFN48 pin37/36）；UART1 调试 PA9；CH582M QFN48 全部引出 | 可直接用默认引脚；remap1=PB21/PB20 备选 |
| 32K 时钟 | 既有文档曾称 `SelRTCClock=0` 硬编码（D18）；后已改为 `SelRTCClock=1` | EVT：`CLK_OSC32K` 默认 **1**（内部 32000 Hz + LSI 校准）；**仅主机/多角色例程覆盖为 0**（外部 32768 Hz） | 从机可内部 RC；Central/CentPeri/Multi*/SpeedTest_Central 必须外部 32K |
| SNV | 既有边界「无 SNV（绑定不落 flash）」 | `config.h` 默认 **BLE_SNV=TRUE**（`0x77E00-FLASH_ROM_MAX_SIZE`，块 256，1 块） | 绑定信息默认落 DataFlash；如要「无 SNV」必须显式 `BLE_SNV=FALSE` |
| HAL_SLEEP | 未说明 | 在范围的全部 `.cproject` **均未定义** → `FALSE`，`sleepCB` 不挂、`CH58X_LowPower` 空实现 | 实机为连续 TMOS 忙等，不是低功耗例程 |
| 自定义 MAC | 出厂 MAC 0C:3D:5E:A6:62:94 | 仅 **SpeedTest_Peripheral / SYNC_ADV** 用 `BLE_MAC=1` 自定义 `84:C2:E4:03:02:02`（写库时反序）；Central 系列 **对端** 固定为该 MAC，但本机仍用出厂 MAC | 对端必须同 MAC 或改 `PeerAddrDef`；不要误以为 Central 本机改了 MAC |
| `GAP_ADTYPE_16BIT_MORE` | 常被误记 0x03 | 库定义 **0x02**（0x03 是 16-bit *complete* list，本库无该宏） | TLV 逐字节核对时注意 type 字节 |
| HID flags | 常写成 0x06（General） | HID 四例用 **Limited Discoverable 0x05**（0x01|0x04）；Peripheral 系列用 General 0x06 | 主机发现行为不同（limited 超时） |
| 连接参数 | 未细分 | Peripheral 7.5–125 ms/L0/1 s；HeartRate 25–200 ms/**L1**/10 s；Cycling 25–250 ms/**L20**/10 s；HID 10 ms/L0/5 s；OTA 7.5–15 ms/10 s | latency=20（Cycling）尤其异常，需逐例程 |
| OTA 传输面 | 未记录 | **0xFEE0/0xFEE1（read+write+WNR），无 CCCD/notify，read 取 ≤20B 响应**；IAP 命令 0x80–0x84，`IAP_LEN=247` | 生成器若要支持 OTA，需按「写命令 + 读响应」而非 notify |

## G. 出厂包自洽性缺陷清单（实现时以「真实行为/GATT 发现」为准）

| # | 现象 | 证据 | 建议 |
|---|---|---|---|
| 1 | `bTXD1`/`bRXD1`/`bTXD3`/`bRXD3` 在本解包的 `SRC/StdPeriphDriver/inc/*.h` 中**没有定义**，但被 `app_uart.c`/各 `main.c` 直接使用 | `grep -rn "define bTXD" $EVT` 无结果 | 引脚以 `CH583_BLE_UART_Description_EN.txt` 与 CH582M `peripherals.json` 为准：TXD3=PA5、RXD3=PA4、TXD1=PA9 |
| 2 | `DEF_DESKTOP_X_MAX`/`DEF_DESKTOP_Y_MAX` 在包内**没有定义**，但 HID_Touch 报告描述符使用 | `grep -rn "DEF_DESKTOP_X_MAX" $EVT` 无结果；注释标 `LOGIC_MAX (0X0800)` | 按 0x0800 处理（注释值），Touch 报告描述符共 72 字节 |
| 3 | `gattprofile.c` 注释写服务 0xFFF0/特征 0xFFF1…，`gattprofile.h` 实为 0xFFE0/0xFFE1… | `Peripheral/Profile/gattprofile.c:36-49` vs `gattprofile.h:31-45` | 以 `.h` 宏为准（0xFFE0 起） |
| 4 | BLE_UART 广播 0xFFE0，实际服务 0xFFF0 | `BLE_UART/APP/peripheral.c:120-134` vs `ble_uart_service_16bit.c:42-50` | 连后按 0xFFF0 发现 |
| 5 | OnlyUpdateApp_IAP 广播 0xFFE0，实际服务 0xFEE0 | `OnlyUpdateApp_IAP/APP/peripheral.c:117-124` vs `OTAprofile.h:31-36` | 连后按 0xFEE0 发现 |
| 6 | IoCHub `readme.txt` 说灯控 PB18/状态灯 PB19，`peripheral.h` 相反 | `readme.txt` vs `APP/include/peripheral.h:41-42` | 以代码为准：灯控 PB19、连接灯 PB18 |
| 7 | IoCHub rsp 名 `ch583_ble_iochub`，GAP 名 `CH583_ble_iochub` | `peripheral.c:163,198` | bluez 扫描显示 rsp 名；GATT 0x2A00 读到大写 CH |
| 8 | BackupUpgrade_OTA rsp 名 `simple Peripheral`，GAP 名 `Simple Peripheral` | `peripheral.c:91-99,128` | 扫描名首字母小写 |
| 9 | 库串 `CH58x_BLE_LIB_V2.13` vs 头文件 `V2.10` vs `VER_FILE "CH58x_BLE_LIB_V2.1"` | §0.5 | 版本比较被 `strlen` 截断，勿依赖精确串 |
| 10 | `GAP_ADTYPE_16BIT_MORE` 值是 **0x02**，而 TLV 长度字节是 0x03 | `CH58xBLE_LIB.h:1002` | 扩 TLV 时长度字节 ≠ AD type，勿混 |
