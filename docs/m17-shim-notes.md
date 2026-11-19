# M17-S1 BLE shim (`ch5xx-ble`) 实测笔记

> 契约：`docs/CH5XX_BACKEND_CONTRACT.md` D2/D3。来源：`ch58x-hal` @611954e（MIT/Apache-2.0, (c) 2023 Andelf）+ WCH blob；目标：`ch5xx-hal` @875651b693ef437e045d023171adaf052a07525c / `ch5xx-metapac` @680e2e12。
> 日期：2026-11-19。结论：**shim 编译并链接通过**，stable 与 nightly 均成功；证明工程见 `/tmp/m17-shim-proof/`。

## 1. 产出清单

```
vendor-src/ch5xx-ble/
  Cargo.toml          package ch5xx-ble 0.1.0 / edition 2021 / rust-version 1.95
  build.rs            复制 blob 到 OUT_DIR + link-search + static=CH58xBLE/ISP583
  src/lib.rs          shim 门面（D3 API）
  src/ffi.rs          ← ch58x-hal/src/ble/ffi.rs        逐字（727 行）
  src/gap.rs          ← ch58x-hal/src/ble/gap.rs        逐字（616 行）
  src/gatt.rs         ← ch58x-hal/src/ble/gatt.rs       逐字（690 行）
  src/gatt_uuid.rs    ← ch58x-hal/src/ble/gatt_uuid.rs  逐字（283 行）
  src/gattservapp.rs  ← ch58x-hal/src/ble/gattservapp.rs 逐字（166 行）
  src/linkdb.rs       ← ch58x-hal/src/ble/linkdb.rs     逐字（109 行）
  vendor/LIBCH58xBLE.a   WCH blob，1,133,340 B（未改）
  vendor/libISP583.a     WCH blob，5,374 B（未改）
  LICENSE-MIT / LICENSE-APACHE  ← ch58x-hal
  README.md           来源/署名/WCH blob 注记
```

`ffi.rs` 中的 `#[link(name = "CH58xBLE")]` 原样保留；`build.rs` 另外显式发出
`cargo:rustc-link-search=<OUT_DIR>`、`cargo:rustc-link-lib=static=CH58xBLE`、
`cargo:rustc-link-lib=static=ISP583`（库名用 `nm` 核对：`LIBCH58xBLE.a` 导出
`LLE_IRQLibHandler`/`BB_IRQLibHandler`/`BLE_LibInit`/`TMOS_*`，`libISP583.a` 导出
`FLASH_EEPROM_CMD`）。ISP583 仅供导出工程保持与旧路径相同的链接形状；本 shim 不暴露 ISP API，
未被引用的 archive member 不会进最终镜像。

## 2. 工具链裁决（D2 待更新）

| 工具链 | 结果 | build-std | 说明 |
|---|---|---|---|
| stable 1.100.0 | **通过** | 未生效（cargo 静默忽略 `[unstable] build-std`，未编译 core；38 个 crate） | 依赖已安装的 `rust-std-riscv32imac-unknown-none-elf` |
| nightly 1.102.0-nightly | **通过** | 生效（`Compiling core v0.0.0 …/library/core`；40 个 crate） | rust-src 已安装 |

```console
$ cd /tmp/m17-shim-proof
$ CARGO_HOME=/home/teze/.cargo RUSTUP_HOME=/home/teze/.rustup \
    rustup run stable cargo build --release
    Finished `release` profile [optimized] target(s) in 5.08s
$ CARGO_HOME=/home/teze/.cargo RUSTUP_HOME=/home/teze/.rustup \
    rustup run nightly cargo build --release
    Finished `release` profile [optimized] target(s) in 11.29s
```

**裁决**：stable 可行，但前提是主机已 `rustup target add riscv32imac-unknown-none-elf`；
stable 不会执行 `build-std = ["core"]`。因此 D2 有两条自洽路线：

1. **降 stable**：生成工程 `.cargo/config.toml` 去掉 `[unstable] build-std`，verify 前确保
   target std 已安装；工具链门槛与现状最小。
2. **保留 nightly + rust-src**：现有 D2 文案不动；S1 证明 nightly 路径也成立。

若契约选择 1，`chip.json.nightlyByBackend["ch5xx-hal"]` 需改为 `false`。S1 不改该文件（属 S2/S4 域）。

## 3. 证明工程

路径：`/tmp/m17-shim-proof/`（独立新目录）。结构与关键配置：

```toml
# Cargo.toml（节选）
ch5xx-hal = { git = "https://github.com/ch32-rs/ch5xx-hal",
              rev = "875651b693ef437e045d023171adaf052a07525c",
              features = ["ch582", "rt", "memory-x"] }
ch5xx-ble = { path = "/home/teze/CH32/CubeMX/ch32-rs-cubemx/vendor-src/ch5xx-ble" }
embassy-sync = "0.8"
panic-halt = "1.0"
qingke-rt = { version = "0.8.4", features = ["highcode"] }
portable-atomic = { version = "1.11", features = ["critical-section"] }

[patch."https://github.com/ch32-rs/ch5xx-hal"]
ch5xx-hal = { path = "/tmp/m17-deps/hal-tree/ch5xx-hal" }
[patch."https://github.com/ch32-rs/ch5xx-metapac"]
ch5xx-metapac = { path = "/tmp/m17-deps/metapac" }
```

- `build.rs`：`cargo:rustc-link-arg-bins=-Tlink.x`（D2 规定）。
- `.cargo/config.toml`：`target = "riscv32imac-unknown-none-elf"` + `[unstable] build-std = ["core"]`。
- `main.rs`：`hal::init(Config { rcc: hal::rcc::Config::PLL_60MHZ })` → `ch5xx_ble::enable_lse()`
  → UART1/PA9 日志 → `ch5xx_ble::init(sel_rtc_clock = 0)` → `GAPRole_PeripheralInit` /
  广播参数 / `GGS_AddService` + `GATTServApp::add_service` + 自定义 FFE0/FFE1 服务
  → `GAPRole_PeripheralStartDevice` → 使能 `BLEB`/`BLEL` → `TMOS_SystemProcess()` busy-poll。
- **离线补丁原因**：`ch5xx-hal/build.rs` 第 611 行以
  `CARGO_MANIFEST_DIR/../ch5xx-data/data` 读取芯片 YAML。reference 的 tarball 与 cargo 的
  git checkout 都不带这个兄弟目录。证明工程因此把 reference 复制到
  `/tmp/m17-deps/hal-tree/ch5xx-hal`，并在旁边放
  `ch5xx-data`（`ch32-rs/ch5xx-data` @42237c4d，即 metapac 680e2e1 生成所用数据）。
  **这是导出/git 模式的风险项，见 §9。** 纯 git 模式已实测复现失败
  （`/tmp/m17-shim-proof-git`，去掉全部 `[patch]` 后）：

  ```
  cargo:rustc-cfg=ch582
  thread 'main' panicked at .../ch5xx-hal-be2dc8f8a6a22123/875651b/build.rs:667:62:
  reading .../875651b/../ch5xx-data/data/chips/CH582.yaml: No such file or directory
  ```

  git checkout 内没有 `ch5xx-data`，也没有 submodule；上游 CI 应是并列 checkout 两个仓库。

命令（最终成功）：

```console
cd /tmp/m17-shim-proof
CARGO_HOME=/home/teze/.cargo RUSTUP_HOME=/home/teze/.rustup \
  rustup run stable cargo build --release
# 或 rustup run nightly cargo build --release
```

产物：`target/riscv32imac-unknown-none-elf/release/m17-shim-proof`（346,632 B）。

## 4. 链接结果 / 段布局

`memory.x` 由 `ch5xx-metapac` 的 `memory-x` feature 生成（CH582）：

```
CODEFLASH 0x0000_0000 448K
DATAFLASH 0x0007_0000  32K
SRAM      0x2000_0000  32K
FLASH = CODEFLASH; RAM = SRAM
```

`qingke-rt` 的 `link-highcode.x` 把**向量表**与 `.highcode` 一起放到 RAM
（`.highcode : >RAM AT>FLASH`，启动时从 flash 拷贝）：

```
.highcode  0x2000_0000  0x1914   vector table + BLE IRQ + TMOS/highcode
.text      0x0000_1918  0x2127e  flash
.rodata    0x0002_2b98  0x0944   flash
.data      0x2000_1914  0x0190   RAM (LMA 0x0002_3698)
.bss       0x2000_1aa8  0x1dfc   RAM   （末 0x45c 为 C blob 的 COMMON）
_ebss = 0x2000_3448, _stack_start = 0x2000_8000, _hart_stack_size = 2K
```

`.bss` 段尾 0x2000_38a4；RAM 静态占用 14,500 B。含 2 KB hart stack 后仍有约 18 KB 余量。
BLE_HEAP 6 KB 在 `.bss` 内。
**注意**：`_ebss` 在 0x2000_3448，C blob 的 81 个 COMMON 符号
（`gTmosPara`/`gBleLlPara`/`ble`/队列头等，共 0x45c = 1116 B）被 ld 自动排在 `_ebss` 之后、
`.bss` 段尾。qingke-rt 的启动清零循环只清 `_sbss.._ebss`（`asm.rs`），因此这段 COMMON 不会在
启动时归零。见 §11「COMMON 未清零」。

链接符号（`nm`）：

```
0000402c T BLE_LibInit
0001bd60 T BLE_RegInit
20000644 T TMOS_SystemProcess
200011b6 T BB_IRQLibHandler
2000169c T LLE_IRQLibHandler
200000c0 T BLEB            # qingke-rt 向量/蹦床
200000d0 T BLEL
```

## 5. 中断名

`ch5xx-metapac` CH582 的 `Interrupt` 枚举：`BLEB = 20`、`BLEL = 21`（与旧 ch58x 的
`BLEB`/`BLEL` 同名）。证明工程用：

```rust
#[qingke_rt::interrupt]
unsafe fn BLEB() { ch5xx_ble::BB_IRQLibHandler(); }

#[qingke_rt::interrupt]
unsafe fn BLEL() { ch5xx_ble::LLE_IRQLibHandler(); }
```

并使能：`hal::interrupt::Interrupt::BLEB.enable()` / `BLEL.enable()`（`InterruptExt`）。
旧 `ffi.rs` 没有声明这两个 blob 符号，shim 在 `lib.rs` 根部补了
`extern "C" { pub fn LLE_IRQLibHandler(); pub fn BB_IRQLibHandler(); }`（仅新增，未改 ffi.rs）。

## 6. metapac 寄存器读法差异

| 旧 ch58x | ch5xx-metapac / ch5xx-hal | 备注 |
|---|---|---|
| `pac::SYS::PTR` + `&*PTR` | `pac::SYS`（const 实例，直接 `.reg()`） | svd2rust 新风格 |
| `sys.tkey_cfg()`（SYS 块 0x57） | **`pac::TOUCHKEY.cfg()`**（独立 block，同一寄存器 0x57） | metapac 把触摸键拆成独立外设；SYS 无 `tkey_cfg` |
| `systick.cnt().read().bits() as u32`（32 位） | `pac::SYSTICK.cnt().read()` 为 64 位视图 | 取 `as u32` 即 CNTL |
| `sys.ck32k_config().modify(|_,w| …)` | 字段式 `modify(|w| w.set_clk_xt32k_pon(true))` | 字段名逐字对应 |
| `with_safe_access`（hal 私有） | shim 自实现 SAM：`SYSTEM_CONTROL.safe_access_sig` 写 0x57/0xA8/0x00，`fence.i`，critical-section | 与 `ch5xx_hal::rcc` 私有实现同序 |
| `adc::Config::for_temperature()` | ch5xx `adc::Config` 是 `#[non_exhaustive]`，不能结构体字面量 | 先 `Config::default()` 再赋 `gain/sample_clock` |
| `adc.read()` → `u16` | `adc.blocking_read(&mut ch)` → `Result<u16, Error>` | shim 用 `unwrap_or(0)` |

`pac::SYSTICK.cnt()` 的 64 位读在 CNT 回卷时可能撕裂；只用于熵，无影响。

## 7. 32K / ADC 温度的实现事实

**`enable_lse()`**（旧 `sysctl.rs` 的 `Clock32KSrc::LSE` 分支逐字翻译）：

1. SAM 窗口内 `SYS.CK32K_CONFIG.CLK_XT32K_PON = 1`（bit0）
2. 延时 `Fsys / 10 / 4` 个周期（60 MHz → 1.5 M cycles ≈ 25 ms）
3. SAM 窗口内 `SYS.CK32K_CONFIG.CLK_OSC32K_XT = 1`（bit2）
4. 延时 `Fsys / 1000` 个周期（60 MHz → 60 µs）

延时经 `ch5xx_hal::delay::Delay`（`hal::init` 已校准）换算为 µs，物理时长与旧实现一致。

**`set_clock32k_lsi()`**：SAM 内 `CLK_OSC32K_XT = 0`、`CLK_INT32K_PON = 1`（bit1）。

**`temperature_raw()`**：

- 保存/恢复 4 个寄存器：`TOUCHKEY.CFG`、`ADC.TEM_SENSOR`、`ADC.CHANNEL`、`ADC.CFG`（`write_value` 原值回写）。
- `Adc::new(unsafe { peripherals::ADC::steal() }, cfg)`；`cfg` 设 `Gain::Unity` / `SampleClock::Divide3`。
  注意：`enable_temperature()` 返回的 `Temperature` 通道会在 `begin()` 时**覆盖**为
  `gain = X2`、`sample_clock = Divide1`、差分模式。旧 `Config::for_temperature()`
  （3.2 MHz / GAIN2 / diff_en）语义完全一致；外部通道配置不影响温度读。
- 温度通道号 = 15（`TEMPERATURE_CHANNEL`），电池 = 14。
- `blocking_read` 内部丢弃上电后第一次转换、返回第二次；超时 1 ms（按 `rcc::clocks()`）。
- 旧路径没有 `Result`，新路径 `unwrap_or(0)`：ADC 超时返回 0 而不是 panic（见 §8 偏离 4）。

## 8. API 与 D3 的偏离（逐条）

1. **`pac::SYS.tkey_cfg()` 不存在** → `pac::TOUCHKEY.cfg()`。同一地址/位域，纯粹是 metapac 的
   外设划分差异。
2. **`hal::adc::Config` 是 `#[non_exhaustive]`** → 不能用 `Config { gain, sample_clock }`
   字面量；改为 `Config::default()` 后逐字段赋值。最终寄存器配置不变。
3. **`srand()`**：metapac 的 `SYSTICK.cnt()` 是 64 位视图，取低 32 位。旧实现是 32 位 `CNT`；
   熵语义不变。
4. **`temperature_raw()` 的错误路径**：D3 写“Result unwrap→raw”，实现为 `unwrap_or(0)`。
   理由：温度回调由 BLE 库在协议栈内部调用，panic 会直接死机；返回 0 更接近旧实现“无错误”的行为。
5. **`enable_lse()` 的延时**：旧代码用 `riscv::asm::delay(hclk 周期)`；shim 用
   `hal::delay::Delay` + µs 换算（见 §7）。寄存器序列与顺序不变。
6. **PA 不移植**：`Config` 只有 D3 的三个字段，`init()` 不调用 `BLE_PAControlInit`；RF 使用
   芯片默认功率。这是契约已声明的诚实边界。
7. **`set_default_serial` 为安全 fn**（D3 签名），内部 `addr_of_mut!` 写 `static mut SERIAL`；
   `println!` 忽略 UART 写错误（旧实现 `unwrap()`）。未安装串口时仍为 no-op。
8. **新增（非破坏）**：`pub use` 级别的 `LLE_IRQLibHandler` / `BB_IRQLibHandler` 外部声明；
   旧 `ffi.rs` 未声明这两个符号。
9. **未移植**：`ch58x-hal` 的 `ble::Config::use_factory_mac_address`、`isp` 模块、
   `PaConfig`/`enbale_pa`。D3 冻结的 API 未要求；工厂 MAC 由生成器通过 `cfg.mac_lsb` 传入。
10. **`lib_version()`**、`MacAddress`（`from_raw`/`from_msb`/`Display`/`From<[u8;6]>`）、
    `TmosEvent`（4/2/2 pubsub、Drop 释放）、`EventSubscriber` 与 D3 一致。

## 9. 契约/后续待更新点

- **D4 错误**：`hal::rcc::presets::PLL_60MHZ` **不存在**。实际是关联常量
  **`hal::rcc::Config::PLL_60MHZ`**（`presets!` 宏展开在 `impl Config` 内，rcc.rs:406/525）。
  S2 生成器必须用这个路径，否则 CH582 ch5xx 档全部编译失败。
- **D2 工具链**：见 §2，stable 可用但 `build-std` 不生效；建议要么降 stable 并去掉
  `[unstable] build-std`，要么保留 nightly。
- **D2 git 模式（阻断级）**：`ch5xx-hal` 的 `build.rs` 需要兄弟目录 `../ch5xx-data/data`。
  cargo 的 git checkout（`~/.cargo/git/checkouts/ch5xx-hal-*/875651b`）只有一个仓库、无
  submodule，因此**纯 git rev 模式直接 panic**（`/tmp/m17-shim-proof-git/build.log`）。
  `vendor/ch5xx-hal` 必须同时提供 `vendor/ch5xx-data`（路径正好是 `vendor/ch5xx-data/data`），
  或者 git 模式改为“下载 tarball + 并列放置数据”的 path 依赖。请 S2 在
  `scripts/build-hal5xx-vendor.mjs` / verify-build 里落实并补一条回归检查。
  本证明用 `/tmp/m17-deps/hal-tree/{ch5xx-hal,ch5xx-data}` 绕开。
- **D2 shim 依赖**：`embassy-sync 0.8.0` 由 crates.io 正常解析，无需 `[patch.crates-io]`
  （Cargo.lock 已确认 registry 源）。
- **D3 链接名**：`LIBCH58xBLE.a → -lCH58xBLE`、`libISP583.a → -lISP583`，已用 `nm` 核对。

## 10. build 日志尾部

stable（`/tmp/m17-shim-proof/build-stable.log`）：

```
warning: `ch5xx-hal` (lib) generated 10 warnings
    Finished `release` profile [optimized] target(s) in 5.08s
```

nightly（`/tmp/m17-shim-proof/build-nightly.log`）：

```
warning: `ch5xx-hal` (lib) generated 10 warnings
    Finished `release` profile [optimized] target(s) in 11.29s
```

`ch5xx-hal` 的 10 条 warning 均为未使用的 gpio 中断辅助函数（上游代码，与本 shim 无关）；
shim 与证明工程自身零 warning。

## 11. 遗留风险

- 未做实机验证：本里程碑只证明 cargo build/link，不证明 BLE 广播/连接/notify。
  `sel_rtc_clock = 0` 依赖板上 32.768 kHz 晶振；无晶振板需 `set_clock32k_lsi()` + `SelRTCClock=1/2`。
- `BLE_HEAP` 6 KB 与 `.highcode` 6.4 KB 同时驻留 SRAM；若后续加入大量 `#[highcode]`
  或更大 BLE heap，32 KB SRAM 余量需重新核算。
- 向量表位于 RAM（qingke-rt highcode 布局），启动拷贝失败会导致 HardFault；这是 HAL 既有行为，
  非 shim 引入。
- `ch5xx-hal` 的 `adc::Temperature` 在 CH583 上“未上板测试”（HAL 注释明示）；温度回调的
  硬件正确性待 BLE 实机流验证。
- 导出工程若省掉 `ch5xx-data`（见 §9），git/ vendor 两种模式都会在 build.rs 阶段失败。
- **COMMON 未清零（既有问题，非 shim 引入）**：`qingke-rt` 0.8.4 的 `link-highcode.x`
  `.bss` 通配只含 `*(.sbss .sbss.* .bss .bss.*)`，没有 `*(COMMON)`。WCH 的
  `LIBCH58xBLE.a` 大量使用 tentative definition（`nm`/map 显示 81 个 COMMON，0x2000_3448–
  0x2000_38a4），ld 把它们排在 `_ebss` 之后，启动代码不会清零。旧 `ch58x-hal` 用的
  `qingke-rt` 0.5 `link-highcode.x` 完全相同，所以 legacy 路径同样存在。缓解方向（需 S2/实机确认）：
  生成工程自带一个 `-T` 片段把 `*(COMMON)` 收进具名段，`main` 在 `ch5xx_ble::init` 前清零；
  或 fork `link.x` 把 `*(COMMON)` 并入 `.bss` 通配。仅 cargo build 无法暴露此问题。

## M18 扩展（2026-11-19，EVT 对照测试支撑）

排他域 `vendor-src/ch5xx-ble/**`；无生成器/测试/数据改动。目标：central、GATT client、
多服务、indicate、变长 notify、多连接、MTU。

### 12.1 新增 FFI 符号

`src/ffi.rs` 末尾新增（原有声明不动）。行号均为
`/home/teze/CH32/EVT/CH583EVT/EVT/EXAM/BLE/LIB/CH58xBLE_LIB.h`：

| 符号 | 头文件行 | 备注 |
|---|---:|---|
| `GAPRole_CentralStartDiscovery(u8,u8,u8)` | 4432 | |
| `GAPRole_CentralCancelDiscovery()` | 4441 | 实际 C 名含 `Central`；任务文案的 `CancelDiscovery` 非头文件符号 |
| `GAPRole_CentralEstablishLink(u8,u8,u8,*mut u8)` | 4473 | peer addr LSB first |
| `GAPRole_UpdateLink(u16,u16,u16,u16,u16)` | 4218 | |
| `GAPRole_UpdatePHY(u16,u8,u8,u8,u16)` | 4235 | `phy_options` 是 **u16** |
| `GATT_InitClient()` | 3006 | |
| `GATT_RegisterForInd(u8)` | 3016 | 返回 void |
| `GATT_ExchangeMTU(u16,*mut attExchangeMTUReq_t,u8)` | 3112 | |
| `GATT_DiscAllPrimaryServices(u16,u8)` | 3143 | |
| `GATT_DiscPrimaryServiceByUUID(u16,*mut u8,**u8 len**,u8)` | 3180 | len 是 **u8**，不是 u16 |
| `GATT_DiscAllChars(u16,u16,u16,u8)` | 3252 | |
| `GATT_DiscCharsByUUID(u16,*mut attReadByTypeReq_t,u8)` | 3288 | |
| `GATT_DiscAllCharDescs(u16,u16,u16,u8)` | 3324 | |
| `GATT_ReadCharValue(u16,*mut attReadReq_t,u8)` | 3361 | |
| `GATT_ReadUsingCharUUID(u16,*mut attReadByTypeReq_t,u8)` | 3396 | 无 start/end 独立参数 |
| `GATT_ReadLongCharValue(u16,*mut attReadBlobReq_t,u8)` | 3427 | |
| `GATT_WriteNoRsp(u16,*mut attWriteReq_t)` | 3493 | 无 taskId |
| `GATT_WriteCharValue(u16,*mut attWriteReq_t,u8)` | 3567 | |
| `GATT_ReadCharDesc(u16,*mut attReadReq_t,u8)` | 3684 | |
| `GATT_WriteCharDesc(u16,*mut attWriteReq_t,u8)` | 3752 | |

头文件缺失、但 `LIBCH58xBLE.a` 导出（`nm -g --defined-only` 已核）：

| 符号 | 恢复出的签名 | 依据 |
|---|---|---|
| `GATT_RegisterForReq(u8)` | `void`, 1 个 u8 | `gattservapp.o` 反汇编：`sb a0,0(a5); ret`（返回值未定义） |
| `linkDB_NumConns()` | `u8` | `linkdb.o`：单字节 load |
| `linkDB_NumActive()` | `u8` | `linkdb.o`：遍历连接表计数，返回 u8 |
| `GAP_NumActiveConnections()` | `u8` | `gap.o`：`R_RISCV_CALL linkDB_NumActive` 尾调用 |
| `GATTServApp_ProcessCharCfg` | `(gattCharCfg_t*, u8*, u8, gattAttribute_t*, u16, u8, pfnGATTReadAttrCB_t)` | 见 12.3 |

### 12.2 结构体核对

任务清单中的 `gattReadCharValue_t` / `gattWriteCharValue_t` / `gattDiscChars_t` /
`gattExchangeMTU_t` **在 CH58xBLE_LIB.h 中不存在**（全文件 grep 0 命中）。对应 API 直接使用
`gatt.rs` 已有的 `attReadReq_t`、`attWriteReq_t`、`attReadByTypeReq_t`、
`attExchangeMTUReq_t`、`attReadBlobReq_t`。因此没有新增“自造”结构体；如需新结构体，
WCH 的权威定义就是上述 ATT 结构。新增的只有两个消息 method 常量
（`gatt.rs`）：`ATT_FLOW_CTRL_VIOLATED_EVENT = 0x7E`、`ATT_MTU_UPDATED_EVENT = 0x7F`
（头文件 633-634）。

### 12.3 `GATTServApp_ProcessCharCfg` 的 7 参数

头文件未声明。反汇编 `gattservapp.o::GATTServApp_ProcessCharCfg`（0xdc 字节）显示实参
映射为 `a0=charCfgTbl, a1=pValue, a2=authenticated, a3=pAttr, a4=numAttrs, a5=taskId,
a6=readAttrCB`：

- 入口对 `a0/a1/a3/a6` 判空；
- `a4` 作为 `GATTServApp_FindAttr(pAttr, numAttrs, pValue)` 的 `numAttrs`，该函数按
  `pAttr[i].value == pValue` 指针同一性定位属性；
- `a5` 作为 `taskId` 传给内部 `gattServApp_SendNotiInd`；
- `a6` 被 `mv a5,s2; ... jalr s0` 当作第 6 个参数（读属性回调）调用。

TI 原版是 6 参数（无回调），WCH 版本多一个显式读回调。shim 按 7 参数声明；
`pValue` 语义是“特征值存储指针”，不是新数据缓冲，wrapper 文档已注明。

### 12.4 `Options` 与 `init_with`

`lib.rs`：

```rust
pub struct Options {
    pub buf_max_len: u16,     // 27
    pub mem_len: u16,         // 6144
    pub connect_number: u8,   // 0x0D = 1P + 3C
    pub buf_number: u8,       // 5
    pub tx_power: u8,         // LL_TX_POWEER_6_DBM (0x3D)
}
```

- `Options::default()` 复刻 M17 数值；`init(cfg)` = `init_with(cfg, Options::default())`，
  旧三字段 `Config` 字面构造不受影响（生成器产物逐字节不变，32 个
  `ch5xxBleCodegen` 用例全绿）。
- heap：`HEAP_MAX_SIZE = 10 KiB` 固定静态数组；`BLE_LibInit` 只收到
  `opts.mem_len`（`MEMLen`）。`mem_len > 10 KiB` 在调用库前返回 `INVALID_MEM_SIZE(0x0B)`。
  **SRAM 上限**：即使用默认 6 KiB，`.bss` 仍占 10 KiB（静态数组尺寸不变）。
- `connect_number` 直接写 `bleConfig_t.ConnectNumber`；`buf_number`/`buf_max_len`/
  `tx_power` 同理。
- 诚实边界：SNV 仍 off（`SNVAddr/SNVBlock/SNVNum/readFlashCB/writeFlashCB` 为 0/None，
  bonding 仅 RAM）；`sleepCB`/`WakeUpTime`/`staCB` 仍未设置；`TxNumEvent` 固定 1。

### 12.5 Wrapper API

新模块 `src/client.rs`：

```rust
pub enum GattClientEvent<'a> {
    ReadRsp { conn_handle, value: &[u8] },
    ReadBlobRsp { conn_handle, value: &[u8] },
    WriteRsp { conn_handle },
    ExchangeMtuRsp { conn_handle, server_rx_mtu },
    FindInfoRsp { conn_handle, format, num_info, info },
    FindByTypeValueRsp { conn_handle, num_info, handles_info },
    ReadByTypeRsp { conn_handle, num_pairs, entry_len, data },
    ReadByGrpTypeRsp { conn_handle, num_grps, entry_len, data },
    HandleValueNoti { conn_handle, handle, value },
    HandleValueInd { conn_handle, handle, value },
    HandleValueCfm { conn_handle, status },
    MtuUpdated { conn_handle, mtu },
    FlowCtrlViolated { conn_handle, opcode, pending_opcode },
    ErrorRsp { conn_handle, req_opcode, handle, err_code },
    Other { conn_handle, method },
}

impl gattMsgEvent_t { pub fn decode(&self) -> GattClientEvent<'_> }

pub fn disc_all_primary_services(conn, task) -> bStatus_t
pub fn disc_primary_service_by_uuid(conn, uuid: &[u8], task) -> bStatus_t
pub fn disc_all_chars(conn, start, end, task) -> bStatus_t
pub fn disc_chars_by_uuid(conn, start, end, uuid, task) -> bStatus_t
pub fn disc_all_char_descs(conn, start, end, task) -> bStatus_t
pub fn exchange_mtu(conn, client_rx_mtu, task) -> bStatus_t
pub fn read_char_value(conn, handle, task) -> bStatus_t
pub fn read_long_char_value(conn, handle, offset, task) -> bStatus_t
pub fn read_using_char_uuid(conn, start, end, uuid, task) -> bStatus_t
pub fn read_char_desc(conn, handle, task) -> bStatus_t
pub fn write_char_value(conn, handle, value, task) -> bStatus_t
pub fn write_no_rsp(conn, handle, value) -> bStatus_t
pub fn write_char_desc(conn, handle, value, task) -> bStatus_t
pub fn send_notification(conn, attr_handle, value, authenticated) -> bStatus_t   // 变长
pub fn send_indication(conn, attr_handle, value, authenticated, task) -> bStatus_t
pub fn max_notify_payload(mtu) -> u16   // mtu - 3
```

- 所有 slice→FFI 的写入都经 `GATT_bm_alloc(len)` + 拷贝；失败路径用正确的请求/通知结构
  （而非裸 payload 指针）调用 `GATT_bm_free`（`gattGetPayload` 按 opcode 取 `pValue`）。
- `decode` 的 payload slice 借用 TMOS 消息，`TmosEvent` drop 前必须拷贝。
- indicate 的确认以 `GattClientEvent::HandleValueCfm { status }` 到达 `task` 对应的
  `GATT_MSG_EVENT`。

`gap.rs` 新增 `GAPRole::{central_start_discovery, central_cancel_discovery,
central_establish_link, update_link, update_phy, num_active_connections}`；
`linkdb.rs` 新增 `LinkDB::{num_conns, num_active}`；
`gattservapp.rs` 新增：
`GATTServApp::register_services(&[&'static mut [GattAttribute]], enc_key_size, cbs)`
（顺序注册，handle 由协议栈顺延分配，`service_handle(attrs)` 读取首 handle）与
`GATTServApp::process_char_cfg(char_cfg_tbl, value, authenticated, attrs, task_id, read_cb)`
（按连接 CCCD 批量 notify/indicate）。

### 12.6 编译/链接/回归结果

```console
$ cd /tmp/m17-shim-proof
$ RUSTUP_TOOLCHAIN=nightly CARGO_HOME=/home/teze/.cargo RUSTUP_HOME=/home/teze/.rustup \
    cargo build --release
   Compiling ch5xx-ble v0.1.0 (.../vendor-src/ch5xx-ble)
    Finished `release` profile [optimized] target(s) in 0.64s
```

新 smoke 工程 `/tmp/m18-shim-central-smoke`（path 依赖 shim，同 M17 patch 布局）编译并链接
成功；main 按 `central.c` 顺序调用 CentralInit/InitClient/RegisterForInd/
RegisterForReq/CentralStartDevice/CentralStartDiscovery，并在回调里
EstablishLink→ExchangeMTU→DiscPrimaryServiceByUUID→ReadCharValue。
链接产物（374,472 B）`nm` 中 25 个新符号全部为 `T`（由 `LIBCH58xBLE.a` 解析），
另含 `client.rs` wrapper 的调用点：

```
T GAPRole_CentralStartDiscovery   T GAPRole_CentralCancelDiscovery
T GAPRole_CentralEstablishLink    T GAPRole_UpdateLink
T GAPRole_UpdatePHY               T GAP_NumActiveConnections
T GATT_InitClient                 T GATT_RegisterForReq
T GATT_RegisterForInd             T GATT_ExchangeMTU
T GATT_DiscAllPrimaryServices     T GATT_DiscPrimaryServiceByUUID
T GATT_DiscAllChars               T GATT_DiscCharsByUUID
T GATT_DiscAllCharDescs           T GATT_ReadCharValue
T GATT_ReadUsingCharUUID          T GATT_ReadLongCharValue
T GATT_WriteCharValue             T GATT_WriteNoRsp
T GATT_WriteCharDesc              T GATT_ReadCharDesc
T GATTServApp_ProcessCharCfg      T linkDB_NumConns
T linkDB_NumActive
```

仓库门禁：`npx vitest run` → 63 files / 1621 tests 全绿；`npx vitest run
tests/ch5xxBleCodegen.test.ts` → 32/32 绿（生成器产物未变）。

### 12.7 与头文件的差异/注意点

1. **`len` 类型**：`GATT_DiscPrimaryServiceByUUID` 的 UUID 长度是 `uint8_t`；
   `GAPRole_SetParameter` 的 `len` 在旧 shim 中声明为 `u16`，而头文件是 `uint16_t`
   （`gap.rs` 保持旧声明，未改）。
2. **实际符号名**：`GAPRole_CentralCancelDiscovery`（不是 `GAPRole_CancelDiscovery`）。
3. `GATT_ReadUsingCharUUID` 只有 `(connHandle, attReadByTypeReq_t*, taskId)`，start/end
   在请求结构内。
4. `GATT_WriteNoRsp` 没有 `taskId`。
5. 5 个符号头文件未声明（12.1 表），签名来自 blob 反汇编；若未来 WCH 更新头文件，
   应以新头文件复核 `GATTServApp_ProcessCharCfg` 的 7 参数。
6. `Options.mem_len` 默认 6144，但静态 `BLE_HEAP` 固定 10240 B；需要精确 SRAM 计量时
   以 10 KiB + `.highcode` 计。