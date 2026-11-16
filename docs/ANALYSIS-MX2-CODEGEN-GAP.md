# CubeMX 生成器与工程生态差距分析

> 主题：STM32CubeMX（CubeMX1 6.18.1 与 CubeMX2 1.1.1）的「代码生成器 + 工程管理生态」对照
> 我方：`ch32-rs-CubeMX`（Rust + ch32-hal 生成后端，导出可直接 `cargo build` 的工程）
> 本文只做分析，不改动任何 `src/` 代码。所有行号引用均为本次分析时的快照。

---

## 0. 信息来源与可信度说明

### 0.1 材料清单

| # | 来源 | 位置 | 提供了什么 | 可信度 |
|---|---|---|---|---|
| S1 | CubeMX1 生成工程（完整 .ioc） | `/home/teze/CLionProjects/model/model.ioc` | CubeMX1 配置快照字段全集（本样例仅 SYS/RCC/NVIC/GPIO，未用中间件） | 一手（真实生成） |
| S2 | CubeMX1 工程骨架与增量清单 | `/home/teze/CLionProjects/model/{CMakeLists.txt,.mxproject,cmake/,Core/}` | 生成一次 vs 每次重写、`[PreviousGenFiles]`/`[PreviousUsedCMakes]`、USER CODE 区 | 一手 |
| S3 | CubeMX1 实机生成日志 | `/home/teze/.stm32cubemx/STM32CubeMX.log`（2026-11-15 21:23–21:25） | 逐文件 `oldGeneratedFile` → `Generated code`、`_save` 临时备份、`mx.scratch`、工具链文件生成阶段、固件包版本迁移 | 实机资源 |
| S4 | CubeMX2 生成工程（MX2 风格） | `/home/teze/CLionProjects/TEST_cmake/` | 文件组约定、`user_code` 无标记、`generated/hal/mx_*.c` 按 IP 分文件、模块化 CMake、CMakePresets、`user_modifiable/`、packs 目录 | 一手 |
| S5 | CubeMX2 导出清单 | `/home/teze/CLionProjects/TEST_cmake/.settings/exported-files.json` | 每个文件的 `fileGroup`（project_file/generated/user_code/pack/RTE）+ sha256 + timestamp | 一手 |
| S6 | **CubeMX2 配置快照（.ioc2）** | `/home/teze/CLionProjects/TEST.ioc2`（99 KB，22 个内嵌文件） | MX2 的完整项目模型：pinout v10 / clock / nvic / dma / exti / peripherals / sw-composition / sw-configuration / envModelStore / pack-layout / export-settings / csolution+cproject YAML / project.cube | 实机资源（一手） |
| S7 | CubeMX2 应用本体 | `/home/teze/toolchains/st/STM32CubeMX2_1.1.1/resources/stm32cubemx-application/1.1.1/{dist/bin.js,bundles/codegen/9.1.4/bin/index.js}` | 文件组判定源码、`exported-files.json` 生成器、`VersionManager` 迁移脚本池、csolution schema、工具链描述 bundle、conflict 策略枚举 | 实机资源（一手，压缩包内实现） |
| S8 | CubeMX2 界面基准截图 | `/home/teze/CH32/CubeMX/reference/mx2-ui/01-home.png`、`04-peripheral-config-and-code-preview.png` | Home（MCU/Board/Project 新建、最近项目列表含路径/大小/时间/版本）、按 IP 的 Code Preview + “Show change(s)” 差异 | 一眼可证 |
| S9 | 我方代码与文档 | 见 0.3 表 | 现状边界 | 一手（本次逐文件读取） |
| S10 | **CubeMX2 前端 bundle** | `/home/teze/toolchains/st/STM32CubeMX2_1.1.1/resources/stm32cubemx-application/1.1.1/dist/resources/app/lib/frontend/bundle.js`（28 MB） | 冲突动作/类别枚举与 tooltip、`ProjectFormat`/`CompilerFamily` 枚举、导出设置页结构、生成警告对话框文案、各动作 displayName | **实机资源（CDP 同源前端 bundle）** |
| S11 | **CubeMX2 运行实例（CDP 9222）** | `http://127.0.0.1:9222`，page target `74EF757F1D10AC2CB311C8A063E58618`，URL `…#/home/teze/CLionProjects/TEST.ioc2` | 实机 UI 文本：`IDE Project Generation` 面板全字段、冲突规则当前值、`Generate IDE project` 按钮、Peripherals/Code preview 标签 | **CDP 实机** |

### 0.2 关键证据摘录（实机资源，逐字）

**CubeMX2 的文件组判定逻辑**（S7，`bundles/codegen/9.1.4/bin/index.js`）：

```js
KPt = ["project.cube",".csolution.yml",".cproject.yml",".ewp",".ewd",".eww","CMakeLists.txt"],
// 判定顺序：project_file → RTE → user_code → pack → 其余全部 generated
```
即：**只有显式列入 project_file 的文件才“生成一次且不再重写”**；`user_code` 来自应用工程文件列表（`main.c`/`main.h`）；`RTE` 来自组件 config/constructed 文件（落在 `user_modifiable/`）；`pack` 是 pack 目录前缀；其余一律 `generated`。

**CubeMX2 的冲突/覆盖策略**（S6，`.settings/export-settings.store.json`）：

```json
"conflict": {
  "generated": "DIFF",
  "all": "OVERWRITE_WITHOUT_BACKUP",
  "pack": "DIFF",
  "project_file": "DIFF",
  "RTE": "DIFF",
  "user_code": "DIFF"
},
"export": {
  "configurations": {
    "CMake": { "outputPath": "TEST_cmake", "toolchain": "GCC",
               "exportSource": "include-packs-from-local", "removeBoard": true }
  },
  "lastUsedFormat": "CMake"
}
```

**CubeMX2 的版本迁移机制**（S7）：存在 `VersionManager` 类，字段包括 `migrationScriptPool`、`storeKey`、`unversionedStoreDefaultVersion`，方法 `migrateModel()` / `run()`，会打印 *Store "…" migration success, store is now up to date with version "…"*。

**CubeMX1 的逐文件增量行为**（S3）：每写一个文件先 `oldGeneratedFile, …_save`（旧文件另存），再 `Generated code: …`；结束时 `mx.scratch is deleted!`；`Time for Generating toolchain IDE Files: 566mS`；`Project Generator version: 4.10.0-B28`；固件包迁移日志 `New firmware version: STM32Cube FW_F1 V1.8.7 Old firmware version: … H7FWmigrated= false`。

**CubeMX2 的多构建目标声明**（S6，`TEST.csolution.yml`）：`target-types: NUCLEO-C542RC (board + device)`；`build-types: debug_GCC / release_GCC / debug_IAR / release_IAR / debug_AC6 / release_AC6`；`generators: stm32c5xx_hal_mx2codegen → generated/hal`；`project/TEST.cproject.yml` 内有各编译器完整 flags（C/CPP/ASM/Link-C）与 `output.type: elf,bin,hex`。

**CubeMX2 的按 IP 生成与代码预览**（S8，`04-…png`）：TIM2 页右侧 “Code Preview” 可选文件 `mx_tim2.c`，带 `Show change(s)` 开关（差异视图）与 `Refresh`；左侧 “Resource initialization code generation…” 可选 `Callable` 等策略 → **代码生成粒度=每 IP 一文件，生成策略可按 IP 选择**。

**CubeMX2 的工程文件形态**（S8，`01-home.png`）：最近项目条目 `/home/teze/CLionProjects/CRC542RCEVB.ioc2`，列 “Nucleo Board / Mounted MCU / 大小 / 最后打开 / 最后修改 / Last modified with MX2 v1.1.1”；顶部 “MCU | Board | Project(Open from file system)” 三种入口 → **`.ioc2` 是独立于导出目录的项目快照文件**。

**CubeMX2 的冲突动作与文件类别（CDP 实机/前端 bundle，S10）**：

```js
// 文件类别（UI 下拉的每一行）
{category:"all",         displayName:"All",         tooltip:"Apply a rule to all files regardless of category"}
{category:"user_code",   displayName:"User files",  tooltip:'The files owned in one way or form by the user. e.g. "main.c", "main.h", "my_lib.cpp" etc.'}
{category:"project_file",displayName:"Project files",tooltip:"The project files (example: .csolution.yml, .cproject.yml, .eww, .ewp)"}
{category:"pack",        displayName:"Pack",        tooltip:"Files within embedded software packs"}
{category:"RTE",         displayName:"User modifiable files", tooltip:"User modifiable files from packs"}
{category:"generated",   displayName:"Generated",   tooltip:"Generated files from packs that has a generator that was run during project export. i.e. a tailored file based on the configuration in MX."}

// 每类文件的“类别级”动作（CategoryActions）
DIFF="Show conflicting files"（Launch the conflict resolution tool to handle case by case）
SKIP="Don't generate"（Keep existing files）
OVERWRITE_WITH_BACKUP="Backup"（Create backups of existing files and overwrite）
OVERWRITE_WITHOUT_BACKUP="Overwrite"（Overwriting existing files）

// “All”行只有两种：CUSTOM="Custom..."（Select action by category） | OVERWRITE_WITHOUT_BACKUP="Update files on change"

// 逐文件动作（FileDiffAction）
SKIP / REMOVE / OVERWRITE_WITH_BACKUP / OVERWRITE_WITHOUT_BACKUP /
MANUAL_MERGE="Create base file for later merge"（Keep existing file, write to "<existing-filename>_base"）
// FileDiffStatus: NEW / DIFFERENT / REMOVED
```

**CubeMX2 生成前的“用户改动检测”对话框（S10）**：

- 标题 `IDE Code generation`；正文 *“IDE project files have been changed outside of STM32CubeMX2”*、*“User changes have been detected in export destination.”*、*“Default resolution actions per file category can by configured in settings.”*
- 帮助路径字符串：`"Project Settings" → "IDE Project Generation" → "Advanced" → "Automatic Conflict Handling Rules".`
- 按钮：`Go to project settings` / `Show differences` / `Overwrite all`
- 内部实现：`diffOptions.fileDiffs.{modifiedFiles, addedFiles, deletedFiles}` + 每文件 `autoRun` 标记；`getManualReviewFiles()` 过滤出 `!autoRun` 的文件 → **有则进入“人工复核”流程，无则日志打印 “No files requiring manual review found, proceeding with export”**
- 输出通道名 `Code Generation Debug`，完成消息 `Code generation completed`（**没有落盘报告文件**，见 1.3）

**CDP 实机读取的导出设置面板（S11，逐字）**：

```
IDE Project Generation
  General Setup
    Format: CMake
    CMake toolchain: GCC
    Destination: <目录>
  Advanced
    User modifiable component files
    Generated Code Directories (2)
      Generator | Directory Path
      stm32c5xx_hal_mx2codegen |
      syscalls_mx2codegen |
    Packs
      External sources: Include packs from local
      Remove board packs: Remove board
    Installation Directories
      External sources: Use custom directories
      Pack | Directory Path
      STMicroelectronics.CMSIS.6.3.0 | …
      STMicroelectronics.stm32c5xx_dfp.2.1.0 | …
      …
    Automatic Conflict Handling Rules
      Category | Rule
      All | Update files on change
  [ Generate IDE project ]
```

以及 Peripherals 页签里每个已激活服务的 “Code Generation” 状态行（S11）：
`Services | Description | Status | Actions` → `HAL System Init | Code Generation for common System files | Configured`、`HAL common definitions | Code Generation for CORE files | Configured`。

**CubeMX2 的导出格式枚举（S10）**：`ProjectFormat = { CMake:"CMake", EWARM:"EWARM", OpenCMSIS:"Open-CMSIS" }`；`CompilerFamily = { GCC, AC6, IAR }`；默认编译器映射 `CMake→GCC`、`OpenCMSIS→AC6`、`EWARM→IAR`；导出源 `ExportSource = { include-fresh-packs, include-packs-from-local, reuse-local-with-external-refs }`；`lastExportDestinations` 按格式分别记忆。

### 0.3 我方现状（读码结论）

| 关注点 | 现状 | 证据 |
|---|---|---|
| 配置快照 | 单文件 `cube.json`，schema 见 `ProjectConfig`：`version:1, chip, projectName, pins[], groups[], naming.prefix, clock, peripherals, features{embassy,debugPrint}, hal.rev` | `src/model/types/project.ts:42-53` |
| 快照解析 | 只接受 `version === 1`（否则中文错误）；缺字段宽容补默认；**未知字段被重建对象丢弃** | `src/services/projectFile.ts:31-96` |
| 特殊引脚解锁 | `unlocked: string[]` 只在 Pinia 内存；`loadConfig()` 与 `switchDevice()` 都置空；**不写入 cube.json** | `src/controllers/project.ts:32,224-237,240-251` |
| 生成物分类 | 只有两类：`src/main.rs`（永不覆盖，导出时可排除）与“其它”（每次生成） | `src/services/projectExport.ts:30` |
| 目录/ZIP 导出 | 逐文件无条件写入；无清单、无校验和、无过期文件删除、无改动检测 | `src/services/projectExport.ts:136-167` |
| vendor HAL | 每次导出整体解压 `vendor/ch32-hal`（覆盖用户本地补丁） | `src/services/projectExport.ts:34-44` |
| 工程骨架文件 | `Cargo.toml` / `rust-toolchain.toml` / `.cargo/config.toml` / `build.rs` / `.gitignore` / 自定义 target json 均“每次生成并覆盖” | `src/model/codegen/cargo.ts:12-53` |
| 生成区粒度 | `src/generated/{mod,clock,pins,exti,usart,spi,i2c,adc}.rs`（按域，非按外设实例） | `src/model/codegen/core.ts`、`tests/codegen.test.ts:36-53` |
| 中断 | 无 NVIC/PFIC 优先级配置；仅 embassy 时生成 `bind_interrupts!` | `src/model/codegen/templates/modRs.ts:1-20` |
| DMA | 仅 `features.embassy` 隐式启用；无通道/请求号配置与冲突检查 | `src/model/types/project.ts:51`、`src/model/codegen/derive.ts` |
| 时钟快照 | `ClockConfig{source,hxtalMhz,pllSource,pll,ahb,apb1,apb2,adc}`，无节点锁定/时钟输出 | `src/model/types/clock.ts:4-13` |
| 报告 | 仅生成 `README.md`：文件清单 + 构建/烧录 + 用户区约定 + vendor HAL 说明。无引脚/时钟/外设/中断表，无内存预算，无生成元数据 | `src/model/codegen/templates/readme.ts`、`dualReadme.ts` |
| 工具链 | rustc 单一；nightly/stable 由 `chip.json.nightly` 决定；profile 固定 `opt-level='s'`（dev、release 同为 size）、`lto='fat'`、`debug=2` | `src/model/codegen/templates/{cargoToml,rustToolchain,cargoConfig}.ts` |
| 烧录 | `.cargo/config.toml` runner=`wlink -v flash --enable-sdi-print --watch-serial`；双核 `xtask flash/merge` | `templates/cargoConfig.ts`、`templates/xtaskMain.ts` |
| 调试 | 无 GDB/probe-rs/defmt、无 `.vscode`/`.idea` 产物、无调试配置生成 | 仓库无相关文件（grep 无命中） |
| 工程列表 | localStorage 单槽（`ch32-rs-cubemx:project`），无最近项目/多工程 | `src/services/projectStorage.ts`；`docs/PROJECT_MEMORY.md` §9 已列待办 |
| 视图状态 | 封装旋转角是 `PackageCanvas` 局部 `ref(0)`，刷新即丢 | `src/components/PackageCanvas.vue:102` |
| 内存预算 | `chip.json` 已有 `flash:'16K'|'64K'|'960K'`、`sram:'2K'|'20K'|'896K'`，但生成器完全未使用 | `data/devices/*/chip.json`；`src/model/codegen` 无引用 |
| 烧录验证 | `verify:build` 只做 `cargo build`（含双核 `xtask build`），**不验证烧录**；本机 `wlink` 未安装（`which wlink` 未找到） | `scripts/verify-build.mjs:71-86` |

### 0.4 标注约定

- 未标注 = 有一手材料（S1–S9）直接证据。
- **推测** = 由间接证据推断，未在实机复现。
- 「P0/P1/P2」：P0 = 会静默破坏用户工程/配置，必须在下个版本前解决；P1 = 明显影响真实工程可用性，排期解决；P2 = 体验/完备性增强。

---

## 1. 逐项差距表

### 1.1 配置快照完备性

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 快照载体 | CubeMX1：工程内 `model.ioc`（`key=value`，`File.Version=6`、`MxCube.Version=6.18.1`、`MxDb.Version=DB.6.0.181`）。CubeMX2：独立 `<name>.ioc2`，内部打包 22 个文件（`.settings/*.store.json`、`project.cube`、`csolution.yml`、`cproject.yml`、hw 模型） | 工程内 `cube.json`（JSON v1，2 空格缩进） | 载体等价且更便携；但无 schema 声明、无生成器版本、无分域版本号 | P1（版本/来源）/ P2（分域拆分） | `cube.json` 顶部加 `"$schema"` + `"generator": {name, version}` + `"createdWith"`；保持单文件（便携性优于 .ioc2 的多文件打包） |
| MCU/封装身份 | `.ioc`：`Mcu.CPN/Name/Package/Family/UserName/UserConstants/PinsNb/ThirdPartyNb` + `ProjectManager.DeviceId`；`.ioc2`：target 里 `device` 与 `board` | `chip` 字符串 + `data/devices/<chip>/*.json` | 家族/封装/电气属性在数据层（可接受）；**无 board 概念**（例：NUCLEO 板载 LED/晶振自动带出） | P2 | 后续可加 `board` 字段（数据层 `data/boards/`），Rust 侧只影响默认引脚命名与 README，不影响生成逻辑 |
| 引脚分配与信号 | `.ioc`：`PA9.Mode/PA9.Signal/PA9.Locked/PA9.GPIO_Label/PA9.GPIO_Speed…`。`.ioc2` `pinout.store.json` v10：`userConfigurations[{pin{name,position,ioType,ioStructure,powerSource,index,port}, signal{instance,name,type:'alternate'|'user_gpio',alternateFunctionId:'AF7'}, pinned}]` + `needConfigurations(ownedByUser)` + `pinout-labels/groups/assignations/needs` | `pins[{pin,label,mode,function,remap,params}]` + `groups[{name,pins,color}]` | 缺：物理位号 `position`、引脚电气属性（FT/TT、供电域）、**“外设需求 (need) vs 用户占用”的二分模型**、每引脚 `pinned/locked` 标志 | P1（need/pinned 模型）/ P2（position/电气） | Rust 侧不必照抄 UUID 化的 need 模型；最小落点：`pins[].locked?: boolean` + `pins[].position?`，并把“外设请求的引脚”保留为派生值（现有 `derivePeripheralUsage` 已具备，导出快照时写入 `summary` 即可） |
| **特殊引脚解锁** | `.ioc` `Locked=true` / `FreePins=false`；`.ioc2` `pinout-excluded-pins` + `need.ownedByUser` | `store.unlocked`（仅内存） | **导入 cube.json 后解锁信息丢失**，NRST/SWD/OSC 重新变锁定 → 同一文件重新导入后冲突判定与可配置性改变，静默丢用户决策 | **P0** | 加 `pins[].locked` 或顶层 `unlockedPins: string[]`（可选字段，向后兼容）；`parseProjectFile`/`loadConfig`/`config` getter 三处同步；测试补“解锁状态往返” |
| GPIO 参数 | `.ioc`：`GPIO_Speed/PinState/GPIO_OutputLevel/GPIO_PuPd/GPIO_Mode…`。`.ioc2`：`basic{mode,pull,enable_exti,output_active_state,output_init_state,output_type,speed,label_name[]}` | `PinParams{outputType,speed,level,pull,exti{enabled,edge}}` | 基本对齐；缺 `active_state`（高有效/低有效）、每引脚多标签、`note` | P2 | `PinParams` 加 `activeState?: 'HIGH'|'LOW'` 与 `labels?: string[]`；生成 `pins.rs` 时只用于注释/常量名，不改变 HAL 调用 |
| 时钟配置 | `.ioc`：`RCC.IPParameters` 显式项 + 一批 `*Freq_Value` 派生项 + `RCC.SYSCLKSource/APB1CLKDivider/PLLMUL…`。`.ioc2` `clock.store.json`：`userSettings[{id,value,isLocked,outFrequency}]`，**全树每个节点都有值与锁定** | `ClockConfig` 8 字段（source/hxtalMhz/pllSource/pll/ahb/apb1/apb2/adc）+ `data/devices/<chip>/clock.json` 描述拓扑与预设 | 缺：**节点级 `isLocked`**（用户锁住某频点后重算不改变它）、MCO/时钟输出、LSE/LSI/RTC/IWDG 时钟域、HSE startup time、flash latency 显式值（现由 HAL 推导） | P1（锁定 + 时钟输出）/ P2（其余域） | 锁定的 Rust 对应物：`clock.locked: string[]`（节点 id），`mergeClockConfig` 与 `matchPreset` 跳过被锁节点；生成 `clock.rs` 时对锁定节点使用显式字段而非预设（已有 `fallback:'explicit'` 通路可复用） |
| **中断 / NVIC** | `.ioc`：`NVIC.<IRQn>=<enabled>:<preempt>:<sub>:…` + `NVIC.PriorityGroup=NVIC_PRIORITYGROUP_4` + `NVIC.ForceEnableDMAVector`。`.ioc2` `nvic.store.json` v1：`{core,context,instance,grouping,priority_values{priority[0..15],subpriority[0]},interrupts[{id,name,priority,subpriority,used}]}` | **无任何中断配置**；embassy 时自动 `bind_interrupts!`（无优先级） | 完全缺失：用户无法在工具里启用/配置 IRQ 优先级，生成工程也没有 `set_priority` 代码 | **P1** | ch32-hal 已提供 `qingke::pfic::set_priority(Interrupt as u8, Priority::Px)`（`reference/ch32-hal/src/awu.rs:252`、`embassy/time_driver_systick.rs:187`）与 `interrupt_ext::set_priority`。生成 `src/generated/irq.rs`：`pub fn init() { hal::pac::Interrupt::USART1.set_priority(Priority::P2); … }`；cube.json 加 `interrupts: [{irq, enabled, priority}]`，优先级档位沿用 CH32 P0–P15 |
| DMA | `.ioc`：`Dma.Request0=USART1_RX`、`Dma.RequestsNb`、`Dma.<req>.Signal=…`。`.ioc2` `dma.store.json` v2：`resourcesAllocations/Needs/Reservations` | 仅 `features.embassy` 隐式；生成期按固定通道建模 | 缺通道/请求号选择、DMA 与引脚/外设的冲突校验；`workspace.ts` 已明确注释“H4/DMAMUX 需按通道+请求号建模” | P1（embassy/H4 场景）/ P2 | cube.json 加 `dma: [{peripheral, channel, request}]`；`data/devices/<chip>/dma.json` 已有通道表可做合法性校验；生成 `usart.rs` 时用该表而非硬编码 |
| EXTI | `.ioc` 引脚 `Signal=GPIO_EXTI…`；`.ioc2` `exti.store.json` v2 `resourcesAllocations/Needs` | `params.exti{enabled,edge}` + `data/exti.json` 通道表 + 冲突检查 | 缺“线级”占用记录与 IRQ 映射快照（现由冲突规则推导） | P2 | 快照里补 `exti: [{pin, line, irq, edge}]`（派生写入），供报告与再生成一致性校验 |
| 外设参数 | `.ioc`：`USART1.IPParameters=VirtualMode,BaudRate,…`。`.ioc2`：`peripherals.store(instance→driverId+driverConfigurationId)` + `sw-configuration.settings.parameters` 按 `info/basic/additional/system` 分层，**单 IP 数十项**（如 RCC 的 `hse.startup_time/lse.drive_capability/flash_latency/clk_outputs`，GPIO 的 8 项） | `PeripheralState{enabled,params,remap}`，`params: Record<string,string|number|boolean>`，每外设 2–5 项 | 参数量级差距；无 `init_type`（called/callable）、无 per-IP `labels/note`、无 `_foreignKey` 交叉引用 | P1（关键 IP 参数补全）/ P2（分层结构） | Rust 侧不需要 UUID 图；建议把 `params` 从扁平 bag 升级为**带 spec 的强类型**（数据层 `peripherals.json.params[].key/kind/options` 已存在），并补 SPI 数据位宽/CPOL/CPHA、I2C 速率模式、USART 校验/停止位、ADC 采样时间/分辨率等真实可生成项 |
| 中间件 / RTOS | `.ioc` `Mcu.IPx=FREERTOS/USB_DEVICE/FATFS…`；`.ioc2` `middleware-utilities-resource-manager.store.json`（FreeRTOS/USBX/FileX/LevelX/STFCF/STCryptoLib/Open_Bootloader）+ utilities（Syscalls/Sequencer/EEPROM_Emulation/Basic_STDIO）+ `sw-composition` 组件树 | `features{embassy,debugPrint}` | 缺 RTOS/中间件选择与依赖图 | P2 | Rust 对应物是 `embassy-executor`/`embassy-time`/`embassy-net`/`rtic` 的 feature 组合；建议做成 `features.runtime: 'none'|'embassy'|'rtic'` + `features.stack`，而不是继续加布尔 |
| 低功耗 / PWR | `.ioc` `PWR.*`、`PCC.*`（功耗计算器 Vdd/Temperature/SequenceTime）；`.ioc2` `sw-configuration` 内 `pwr_feature` | 无 | 缺失 | P2 | CH32 有 PWR/睡眠模式 API；快照加 `power: {mode, ...}`，生成 `generated/power.rs`（若 HAL 支持） |
| 工程级选项 | `.ioc` `ProjectManager.*` 约 40 项：`TargetToolchain=CMake`、`CompilerLinker=GCC`、`CompilerOptimize=6`、`KeepUserCode=true`、`CoupleFile=true`、`DeletePrevious=true`、`BackupPrevious=false`、`HeapSize=0x200`、`StackSize=0x400`、`FreePins=false`、`UnderRoot=false`、`LibraryCopy=0`、`MainLocation=Core/Src`、`ProjectStructure`、`AskForMigrate=true` | 工具链/优化/目录布局几乎全部硬编码 | 用户不可调：优化档、是否备份、是否清理旧文件、工程布局 | P1（优化档/备份/清理）/ P2（其余） | Rust 侧可行子集：`project.optimize: 'size'|'speed'|'debug'`、`project.keepPrevious: boolean`、`project.layout`（生成区路径）；`HeapSize/StackSize` 在 `no_std` 下无意义（无堆），改为 README 里的 RAM 预算提示 |
| 视图/会话状态 | `.ioc` `PinOutPanel.RotationAngle=0`、`KeepUserPlacement=false`；`.ioc2` `pinout-user-settings.package.rotation: 90` | 旋转角是 `PackageCanvas` 局部 `ref(0)` | 每次启动/导入均回正 | P2 | `cube.json` 加 `ui: {packageRotation?: number, activeView?}`；属于“工程快照”而非纯 UI 偏好，CubeMX 就是这么做的 |
| 快照版本与来源 | `.ioc`：`File.Version`、`MxCube.Version`、`MxDb.Version`；`.ioc2`：每 store `version` + `$type` schema URL，Home 显示 “Last modified with MX2 v1.1.1” | `cube.json` 仅 `version:1`；README 有 `hal.rev` | 无生成器版本/生成时间/配置哈希；无法判断“这份 cube.json 是哪版工具写的” | P1 | `cube.json` 加 `generator:{name,version}`、`updatedAt`；导出清单里记录 `configHash`（sha256 of canonical JSON），用于“配置未变则无需重生成” |
| 回读容错 | CubeMX 有迁移（见 1.7） | 缺字段宽容；**未知字段被丢弃**；`version !== 1` 直接拒绝 | 旧文件可读，新文件（含未来字段）经旧工具“另存”后丢字段；版本升级即断档 | P1 | `parseProjectFile` 保留未知字段（`...raw` 展开后再覆盖已知键）；版本策略改为“≤ 当前版本可迁移，> 当前版本给出明确拒绝并保留原文件” |

### 1.2 再生成策略

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 用户区保护机制 | CubeMX1：`/* USER CODE BEGIN X */ … /* USER CODE END X */`，重新生成时从旧文件抽取块并回填（`main.c`/`gpio.c`/`it.c` 均有）。CubeMX2：**彻底取消标记**，用户文件 `main.c/main.h` 归 `user_code` 组，生成物进 `generated/` + 库化 `mx_*()` | `src/main.rs` 永不覆盖；`src/generated/**` 每次重写 | 思路一致且更干净；**但只保护了 `main.rs` 一个文件** | **P0** | 见 P0-1：Rust 侧不是“加注释块”，而是“文件组 + 生成一次 + 标记区合并”三件套 |
| 文件分级 | CubeMX2 五组：`project_file`（`project.cube/.csolution.yml/.cproject.yml/.ewp/.ewd/.eww/CMakeLists.txt`，**生成一次**）、`generated`（每次重写）、`user_code`（`main.c/.h`，绝不写）、`RTE`（`user_modifiable/`，可改的生成副本）、`pack`（厂商包） | 两组：`src/main.rs` / 其它 | `Cargo.toml`、`.cargo/config.toml`、`rust-toolchain.toml`、`build.rs`、`.gitignore`、`README.md` 全是“每次覆盖”→ 用户加的依赖、rustflags、额外 target、自写 README **重新导出即消失**；`vendor/ch32-hal` 每次整包重解压→本地补丁消失 | **P0** | 直接映射：`generated`=`src/generated/**`；`user_code`=`src/main.rs` + 任意用户模块；`project_file`=`Cargo.toml/.cargo/rust-toolchain/build.rs/.gitignore/README.md`；`pack`=`vendor/ch32-hal`。`Cargo.toml` 无 include 机制，采用**标记区合并**：`# >>> ch32-cubemx generated >>>` … `# <<< ch32-cubemx generated <<<`（TOML 注释合法），只重写区间 |
| 冲突策略矩阵 | `.ioc2` 每组默认策略：`generated: DIFF`、`pack: DIFF`、`project_file: DIFF`、`RTE: DIFF`、`user_code: DIFF`，兜底 `all: OVERWRITE_WITHOUT_BACKUP`。语义已由前端 bundle 证实：`DIFF` 是**类别级动作**，等于“Show conflicting files → 启动逐文件冲突解决”（不是“内容相同不写”）；类别级可选 `SKIP`（Don't generate，保留旧文件）/ `OVERWRITE_WITH_BACKUP`（先备份再覆盖）/ `OVERWRITE_WITHOUT_BACKUP`；逐文件还有 `REMOVE` 与 `MANUAL_MERGE`（把新内容写到 `<name>_base` 供手工合并）；`all` 行只有 `Custom...` 与 `Update files on change` | 无策略；目录导出无条件 `write()` | 无“将覆盖哪些文件/哪些被你改过”的事前告知、无逐文件解决通道、无备份 | **P0** | Rust 侧 `plan` 的动作枚举对齐：`unchanged | create | update | delete | conflict`；导出对话框按类别展示，`conflict` 展开可逐文件选 `skip / overwrite / backup / base-merge`；默认策略写进工程快照（可改） |
| 生成前“用户改动检测 + 人工复核” | CubeMX2 检测导出目标里被外部改过的文件，弹 `IDE Code generation` 对话框（标题“IDE project files have been changed outside of STM32CubeMX2”），提供 `Go to project settings` / `Show differences` / `Overwrite all`；无改动时日志 “No files requiring manual review found, proceeding with export” | 无；只有导出成功后的 toast | 用户无法在覆盖前看到“我的哪些改动会丢” | **P0** | 目录导出前先读磁盘 → 与上次 manifest 的哈希比对 → 弹“检测到 N 个文件被外部修改”，列出文件 + 可看 diff + 三选一（去设置 / 看差异 / 全部覆盖）；dry-run 结果可保存为 `.ch32cube/last-plan.json` |
| 差异清单（机器可读） | CubeMX2 `exported-files.json`：`disclaimer + version + timestamp + files[{file, fileGroup, checksum{algo:sha256,digest}}]`（S5、S7 源码确认） | 无；`lastExportSnapshot` 仅内存（刷新即丢） | 无法跨会话判断“哪些文件是我上次导出的”“用户是否手改过生成文件” | **P0** | 生成 `.ch32cube/export-manifest.json`：`{generatorVersion, timestamp, configHash, files:[{path, group, sha256}]}`；跨会话可 diff；`.gitignore` 建议不忽略（可作为工程的一部分） |
| 增量写盘 vs 全量 | CubeMX2 的 `DIFF` 是“逐文件冲突解决”入口，**不是**“内容相同则跳过”；未在前端找到“unchanged 不写”的实现（推测：仍然写盘，或在写盘层比较）。CubeMX1 逐文件“旧文件 `_save` → 新文件 → 清理” | 目录导出全量重写；ZIP 天生全量 | 每次导出触碰所有 mtime → 触发 IDE/构建/rsync 全量刷新；无法做“只更新变化文件” | P1 | 目录导出：先算新内容哈希，相同则跳过写入（`unchanged`），不同才写；可选 `--force`（此项是我方改进，非 CubeMX 既有行为） |
| 过期文件清理 | CubeMX1 `.mxproject [PreviousGenFiles]`（HeaderFiles/SourceFiles 列表）+ `DeletePrevious=true`；CubeMX2 前端有 `FileDiffStatus.REMOVED` 与逐文件动作 `REMOVE="Remove existing file"`（S10）→ 生成器能识别“本次不再生成”的旧文件并纳入差异/删除流程 | 目录导出从不删除 | 关掉 SPI 后 `src/generated/spi.rs` 残留在目录里（`mod.rs` 已不再声明，不会编译，但会误导用户、被 git 记录、被 IDE 索引） | P1（可与 P0 清单同批实现） | 只删“上次清单里 `generated` 组、本次不再生成”的文件；**绝不删** user_code/project_file/pack 组的陌生文件；删除前写进 plan 并提示 |
| 按 IP 生成粒度 | CubeMX2：每 IP 一文件 `mx_rcc.c/.h`、`mx_gpio_default.c`、`mx_cortex_nvic.c`、`mx_tim2.c`…；IP 不变则文件字节不变 | 按域一文件 `generated/{clock,pins,usart,…}.rs` | 粒度接近（域 > 实例），变化传播范围略大（改 USART1 会重写整个 `usart.rs`，含 USART2 配置）——但 Rust 单文件编译成本远低于 C，收益有限 | P2 | 若要更细：`src/generated/usart/usart1.rs` + `usart/mod.rs` 聚合；只有当单文件超过 ~500 行或需多人并行时再拆 |
| 备份策略 | CubeMX1 `BackupPrevious=false`（默认关）+ 生成期 `_save` 临时文件（生成成功即删） | 无备份 | 误操作后无可回退副本（只有 git 兜底） | P2 | 目录导出时把 `generated` 组旧文件写入 `.ch32cube/backup/<timestamp>/`，保留最近 N 份 |
| 生成前预览/差异 | CubeMX2 每 IP 面板内 `Code Preview` + `Show change(s)`；CubeMX1 无（推测：仅生成后对话提示） | Monaco 只读预览 + 与 `lastExportSnapshot` 的 diff | 功能接近；缺“与磁盘现状”的 diff（只能比内存中的上次导出） | P2 | 目录导出时把磁盘现有文件内容读入做 diff（需 Tauri 读文件能力，已有 `write_folder` 可扩展 `read_file`） |
| 目录写入语义 | CubeMX2 固定 `outputPath`（`export.configurations.CMake.outputPath=TEST_cmake`），导出格式持久化 | 用户每次选目录；ZIP/文件夹两路 | 我们更灵活（优势）；缺“记住上次导出目录” | P2 | localStorage/工程文件里存 `lastExportDir`，下次预填 |

> 附注（我方文档口径）：README 宣称“用户代码不受目录位置限制”，但 `src/generated/**` 仍属生成器独占目录。建议文档明确“不要在 `src/generated/` 下新建文件”，并把该目录写进 `.gitattributes`/生成头注释，避免用户把生成区当普通目录。

### 1.3 生成报告

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 生成后即时反馈 | CubeMX1：生成对话框 + 日志逐文件记录（S3：`oldGeneratedFile` / `Generated code` / `Time for Generating toolchain IDE Files: 566mS` / 生成器版本 4.10.0-B28）。CubeMX2：**IDE 内输出通道 `Code Generation Debug`**，结束打印 `Code generation completed`（S10 前端 bundle）；生成前有人工复核对话框（见 1.2） | toast：“已导出 N 个文件”（含 vendor）；无输出面板 | 无“哪些文件被新增/更新/跳过/删除”“耗时”“警告列表” | P1 | 桌面端加“Code Generation”输出面板（Tauri 事件流：plan → 逐文件写入 → 完成汇总）；浏览器端退化为导出结果对话框；同时写 `.ch32cube/last-generation.log` |
| 报告是否落盘 | CubeMX2：**未发现任何报告文件**（前端 bundle 无 HTML/PDF 报告模板；生成信息只在输出通道 + `.settings/exported-files.json` 清单 + 手动复核对话框）。CubeMX1：仅在日志与 `.mxproject` 留痕 | 无 | 我们若做“可交付文档”反而可差异化 | — | 见末行 HTML 报告 |
| 机器可读清单 | CubeMX2 `.settings/exported-files.json`（file+group+sha256+timestamp，disclaimer 声明“勿修改，用于决定如何更新工程”） | 无 | 见 1.2（同一缺口，报告与再生成共享同一份清单） | P1 | 同一份 `export-manifest.json` 同时充当“生成报告（机器可读）” |
| 外设摘要 | CubeMX2 侧栏 Peripherals（实例/模式/参数）+ GPIO groups；`.ioc` 由 IP 参数隐含；CubeMX1 生成后可在工程里看到各 IP 初始化函数 | README 仅“文件清单” | 缺：实例、remap、参数、占用引脚的表格 | P1 | README 增加 “外设与引脚” 表：`实例 | 信号 | 引脚 | remap | 关键参数`；数据源 = `derivePeripheralUsage()` 已有结果，纯渲染 |
| 引脚占用表 | CubeMX1：`.ioc` 的 `Mcu.Pin0..N` 全量列出；UI 封装图/引脚表；CubeMX2 `pinout-labels/groups`，且有 **“Export pinout” CSV**（`<project>-pinout.csv`，菜单可选 *With / Without Alternate Functions*，S10 前端 bundle + S8 截图工具栏） | UI 有引脚表；导出 README 无 | 工程交付后无法在文档中核对引脚分配；也无 CSV 导出 | P1 | README/GENERATED.md 输出 `引脚 | 模式/信号 | 标签 | remap | 冲突` 全表（按物理位号排序）；体积可控（≤128 行）；可另加“导出引脚表 CSV”（`pin,label,mode,signal,remap,conflict`），列对齐 CubeMX2 |
| 其它表格导出 | CubeMX2 有 EXTI 导出 `exti.csv`（S10）；**未发现时钟表导出** | 无 | 缺 CSV/表格导出 | P2 | 只做引脚表 + 中断表两项即可覆盖 CubeMX2 的同类能力 |
| 时钟摘要 | CubeMX1 时钟树 + `PCC.*`；CubeMX2 clock 视图 | 单核 README 无；双核 README 有 `clockSummary` | 单核缺 SYSCLK/HCLK/PCLK1/PCLK2/ADC 频率与预设名 | P1 | 复用 `computeClock()` 输出五元组；写进 README “时钟” 节；与 UI 顶栏同源 |
| 中断表 | `.ioc` NVIC 段落即中断表；`.ioc2` `nvic.store` | 无 | 依赖 1.1 的 NVIC 配置能力 | P1（随 NVIC 一起） | `irq.rs` 生成时同步输出 README 表（IRQ/优先级/用途） |
| 内存估算 | CubeMX1 无静态估算（`HeapSize/StackSize` 仅配置，实际体积由构建的 `size` 输出）；推测 CubeMX2 同样不估算 | `chip.json` 已有 `flash/sram`；生成器未用 | 无 Flash/RAM 预算表；`verify:build` 后可读 ELF 段大小却未回填 | P1 | README 写“容量预算：Flash 16K / SRAM 2K，本配置约 X 个外设；构建后用 `size`/`readelf` 回填”；`verify:build` 可解析 `target/.../elf` 段大小并写 `docs/size-report.txt`（仅验证侧，不进用户工程） |
| 生成元数据 | `.ioc` 内有 MxCube/MxDb/File 版本与目标工具链；CubeMX2 Home 显示 “Last modified with MX2 v1.1.1” | README 有芯片/封装/HAL rev；无工具版本、时间、配置哈希 | 出问题时无法定位“哪版工具/哪份配置” | P1 | README 头加 `generated by ch32-rs-CubeMX vX.Y.Z at <ISO8601>, cube.json sha256:…, hal rev`；同时写 `cube.json.generator` |
| HTML/PDF 报告 | CubeMX 未发现独立 HTML 报告产物（CubeMX2 已由 CDP 实机与前端 bundle 双向确认：只有输出通道/清单/复核对话框；CubeMX1 亦未见落盘报告） | 无 | 无差距（CubeMX 也不做） | P2（可选差异化） | 若做，用单文件 HTML（内联 CSS + 引脚表 + 时钟树 SVG），`docs/<project>-report.html`；成本低，作为“可交付文档”卖点 |

### 1.4 工具链选择

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 工具链集合 | CubeMX1 `ProjectManager.TargetToolchain` 可选 MDK-ARM/IAR/STM32CubeIDE/Makefile/CMake（实机 `=CMake`；日志 `using CMake generate project` / `generate project with GCC`）。CubeMX2：`ProjectFormat={CMake, EWARM, Open-CMSIS}` × `CompilerFamily={GCC, AC6, IAR}`，默认映射 `CMake→GCC / Open-CMSIS→AC6 / EWARM→IAR`；实装 3 套 toolchain bundle（GCC 14.3.1、arm-clang 6.22.0、IAR BXARM 9.20.4），UI 里以 `CMake toolchain: GCC` 呈现并按格式过滤可选项 | 唯一 rustc；`nightly` 由芯片数据决定（V003=nightly+build-std，V203/H417=stable） | “工具链选择”在 Rust 里退化为“channel + target + profile”，当前无任何用户可选项 | P1 | 暴露 `toolchain: 'auto'|'stable'|'nightly'`（默认 auto）；`nightly` 仅 tier-3 target 强制；写进 `rust-toolchain.toml` |
| 优化/调试档 | `.ioc` `CompilerOptimize=6`（-O? 映射）；CubeMX2 每 build-type 完整 flags（debug_GCC `-g3 -O0`，release_GCC `-Os`，release_IAR `-Ohz` 等） | `Cargo.toml` 固定：dev `opt-level='s'`、release `opt-level='s' + lto='fat' + debug=2 + strip=false` | 无“体积优先/速度优先/可调试”三档；用户改 Cargo.toml 又会被覆盖（P0） | P1 | Cargo 自定义 profile：`[profile.release-size] opt-level='z', lto='fat', strip='symbols'`；`[profile.release-speed] opt-level=3`；`[profile.release-debug] debug=2, opt-level='s'`；导出对话框选档；`.cargo/config.toml` 加 `[alias] build-size = "build --profile release-size"` |
| 目标 triple / 自定义 target | CubeMX：`-mcpu=cortex-m3` 等由 toolchain 文件与器件决定 | `chip.json.target` + `riscv32ec-unknown-none-elf.json` + build-std | 已覆盖；无用户可选项（正确，避免误配） | — | 保持“数据驱动、不给用户乱选 target”的策略；仅在 README 说明 tier-3 需 nightly |
| 工具链切换机制 | CubeMX1 `CMakePresets.json`（Debug/Release）+ `cmake/gcc-arm-none-eabi.cmake`/`cmake/starm-clang.cmake`；CubeMX2 `include(cmake/${TOOLCHAIN_FILE})` + per-compiler `setups`，`CMakeLists.txt` 为 project_file 仅生成一次 | 无（单一路径） | Rust 无等价“换编译器”需求；缺“换 profile/runtime（embassy vs 阻塞）”的一等公民开关 | P2 | 用 Cargo feature（`embassy`）+ profile 组合替代；导出对话框把 `features.embassy` 显式化为“运行时：阻塞 / 异步” |
| 版本锁定/最低版本 | CubeMX：`FirmwarePackage=STM32Cube FW_F1 V1.8.7` + `LastFirmware`；CubeMX2：packs 版本在 `csolution.packs` + `pack-layout` | `rust-toolchain.toml`（channel/targets）+ `hal.rev` 锁 + `hAL_REV` 常量 | 缺 `rust-version`（MSRV）声明与 `Cargo.lock` 策略（bin 项目应提交 lock；当前生成 `.gitignore` 只忽略 `target/`，未提 lock） | P2 | `Cargo.toml` 加 `rust-version`；README 说明“bin 工程保留 `Cargo.lock`”；生成 `.gitignore` 不变（lock 应入库） |
| 产物类型 | `.ioc2` `cproject.yml` `output.type: elf,bin,hex`；CubeMX1 由构建后处理（objcopy） | 单核仅 ELF（`cargo build` 产物）；双核 `xtask merge` 出 bin/hex | 单核缺 `bin`/`hex` 产物命令 | P2 | 单核 `xtask`（或 README 里 `rust-objcopy` 一行）生成 `.bin/.hex`；或 `cargo-binutils` (`cargo objcopy`)；不要引入额外依赖，给命令即可 |
| IDE 工程文件生成 | CubeMX1 生成 `.cproject/.uvprojx/.ewp/.launch` 等；CubeMX2 生成 `CMakeLists.txt/CMakePresets.json`（均视为 project_file） | `Cargo.toml` 本身就是工程文件，rust-analyzer 直接读取 | Rust 生态**不需要生成 IDE 工程**（优势）；但缺 `.vscode/settings.json`（rust-analyzer `target`/`build-std` 提示） | P2 | 生成可选 `.vscode/settings.json`：`rust-analyzer.cargo.target`、`rust-analyzer.check.allTargets=false`、`rust-analyzer.cargo.extraEnv`（nightly 时 `RUSTFLAGS`）；不生成 `launch.json` 则见 1.5 |
| 编译数据库 | CubeMX1 `CMAKE_EXPORT_COMPILE_COMMANDS TRUE`（便于 clangd） | Cargo 无 `compile_commands.json` | 对 Rust 无意义（rust-analyzer 直读 manifest） | — | 无需处理 |

### 1.5 烧录与调试

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 烧录入口 | CubeMX 生成的 IDE 工程内配置下载器（ST-Link/J-Link、SWD/JTAG、复位方式、Trace/ITM/SWO）；CMake 工程本身无 runner，靠 IDE/命令行 | `.cargo/config.toml`：`runner = "wlink -v flash --enable-sdi-print --watch-serial"`；双核 `cargo xtask flash`（先 V3F `--no-run`，最后 V5F 复位） | 我们开箱即有 `cargo run` 烧录（优势）；缺探针选择（多 WCH-Link 时）、缺“仅复位/仅运行/擦除”等动作面 | P1 | 生成 `[target.'<triple>'.runner]` 的探针优先从环境变量 `WLINK_PROBE` 读取（xtask 已用此约定）；README 增“多探针”章节；`.cargo/config.toml` 保持单行 runner，复杂动作交给 `xtask` |
| 串口/打印重定向 | CubeMX1：`syscalls.c` + `__io_putchar`/`_write`（printf 重定向到 UART），`-DDEBUG` 时启用；CubeMX2：utilities `syscalls`（Standalone）+ `Basic_STDIO` | `hal::debug::SDIPrint::enable()` + `hal::println!`（单线调试打印），`wlink --enable-sdi-print --watch-serial` 转发 | 对齐良好；缺“把 println 接到 UART 指定实例”的选项，也缺 `defmt`/RTT | P1（defmt 可选）/ P2（UART 重定向） | 加 `features.log: 'sdi'|'uart'|'none'`（uart 需 `USARTx` + 波特率，已有外设配置可复用）；`defmt` 需 WCH 支持 RTT，`defmt-rtt` 依赖调试器通道，**推测** WCH-Link 不提供 RTT → 暂不引入，README 说明原因 |
| 调试器集成 | CubeMX1 生成 IDE 调试配置（断点、SWD 频率、Trace 选项）；CubeMX2 由 board pack + csolution 提供（推测：导出到 CMake 时不带调试配置） | **无**：无 `probe-rs`、无 `gdb` 脚本、无 `.vscode/launch.json`、无 CLion Run Configuration | 用户只能 `cargo run` 看打印，不能断点/单步/看寄存器 | P1 | 生成 `.vscode/launch.json`（`cortex-debug` 不适用 RISC-V）→ 用 **`probe-rs-debug`** 或 `gdb` + `wlink gdbserver`；**推测** wlink 提供 `gdbserver` 子命令（需实测），否则给 `riscv64-unknown-elf-gdb` + OpenOCD 配置模板并在 README 标注“实验性”。落地前先在本地跑通再写进模板（AGENTS 约束“禁止臆造”） |
| 多核烧录/合并 | CubeMX 无双核 | `xtask build/flash/merge`（V3F+V5F，输出 `firmware.bin/.hex`） | 我们领先（优势） | — | 保持；后续可把“合并镜像”也做进单核（1.4 产物类型） |
| 烧录链路验证 | CubeMX：无自动化烧录验证（实机日志只到“生成工具链文件”） | `verify:build` 只编译；本机无 `wlink` | 生成工程的烧录/Runner 配置从未被端到端验证（README 的 `cargo run` 承诺未测） | P1（文档/CI 层面） | 增加 `verify:runner-config`（解析 `.cargo/config.toml` 断言 runner 行存在且可执行路径可解析）+ 可选 `--flash` 门禁（需硬件，CI 跳过）；README 标注“烧录需硬件，CI 不覆盖” |
| 下载/复位细节 | IDE 决定 | xtask 区分 `--no-run`（halt）与复位运行；单核无选项 | 单核无法“仅烧录不复位/不运行” | P2 | 单核 README 给 `wlink flash --no-run` 备选；runner 保持“烧录后运行”的默认 |

### 1.6 多工具链产物

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 一份配置、多构建目标 | CubeMX2：`target-types`（board+device）与 `build-types`（debug/release × GCC/IAR/AC6，共 6 个）解耦；每个 build type 有独立 flags 与 RTE 目录 `user_modifiable/_<buildTarget>/`。CubeMX1：一次只生成一种 `TargetToolchain`（`PreviousToolchain` 记录上次） | 1 份 cube.json = 1 个工程 = 1 个 target + 1 套 profile（且 profile 固定） | 无“同一工程多档构建”（debug/release/embassy/size）概念 | P1（profile 档）/ P2（多 target） | 用 Cargo profiles + features 表达：`cargo build --profile release-size --features log-uart`；生成 `.cargo/config.toml` 的 `[alias]` 提供语义化命令；不需要生成多套工程 |
| 导出目标与格式持久化 | `.ioc2` `export.configurations` 记录 `outputPath`/`toolchain`/`exportSource`/`removeBoard`，`lastUsedFormat` 记录上次格式，`lastExportDestinations` **按格式分别记忆**；导出设置页在 Project Settings → `IDE Project Generation`，字段 = `Format`（CMake/EWARM/Open-CMSIS）、`CMake toolchain`（GCC/AC6/IAR，按格式过滤）、`Destination`、组件可改文件、`Generated Code Directories`（每个 generator 一个目录）、`Packs`（Include packs from local / Remove board packs）、`Installation Directories`（pack→目录）、冲突规则；动作按钮 = `Generate IDE project` | 每次手选目录/点 ZIP；不记忆 | 重复劳动；无“同一工程导出到固定目录”、无按格式记忆 | P2 | 工程级 `export: {lastFormat, lastDir, includeVendor, conflictRules}`（存 cube.json 或 localStorage）；桌面端“一键重新导出到上次目录” |
| 多工程/多部件 | CubeMX2：应用工程 + 多个 software/hw project（`project/TEST.cproject.yml`、`NUCLEO-C542RC_project/*.hw`）；`part-resource-manager` 管理板级部件 | 单工程；双核是 workspace 特例 | 超出当前定位 | P2 | 无需跟进；若将来做“多板卡/多子工程”，Rust 对应物是 Cargo workspace + 独立 crate，已有 H417 先例可复用 |
| 生成物目录布局 | CubeMX2 `pack-layout.store` 用正则把 pack 映射到目录：`arch/cmsis`、`stm32c5xx_dfp`、`stm32c5xx_drivers`、`utilities/`、`middleware/*`、`misc/*` | `vendor/ch32-hal/` + `src/generated/` + 根骨架 | 布局固定且更简单（优势）；缺“可配置 layout” | P2 | 不引入正则映射（过度设计）；保留 `vendor/` 与 `src/generated/` 两个固定根，文档化即可 |
| IDE 工作区产物 | CubeMX1 生成 `.cproject`/`.uvprojx`/`.ewp`；CubeMX2 生成 CMake 工程 + Presets | 无 `.vscode`/`.idea` | 用户需手工配置编辑器（rust-analyzer target、nightly、debug） | P1 | 生成 `codegenSelection.ideConfig: 'none'|'vscode'|'clion'`，产出：`.vscode/settings.json`（rust-analyzer）、`.vscode/tasks.json`（build/flash/xtask）、`.vscode/launch.json`（probe-rs/gdb，见 1.5）；CLion 可产出 `.idea/runConfigurations/*.xml`（Cargo 运行配置），**成本高、优先级低** |
| 工程文件“生成一次” | CubeMX2 `CMakeLists.txt` 与 csolution/cproject YAML 属 `project_file`：只生成一次，用户可自由加源文件/依赖；CMake 侧再通过 `cmake/files.cmake` 等模块化文件保持“生成区” | `Cargo.toml` 每次覆盖 | 同 1.2 P0：`Cargo.toml` 是用户最可能改的文件（加依赖、改 profile、加 bin） | **P0** | 标记区合并（见 1.2）；或“生成一次 + 提供 `ch32cube check` 校验漂移”；两者可并存 |

### 1.7 更新流程

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 版本字段 | `.ioc`：`File.Version=6`、`MxCube.Version=6.18.1`、`MxDb.Version=DB.6.0.181`；`.ioc2`：每 store `version`（pinout 10、dma/exti 2、nvic 1…）+ `$type` schema URL | `cube.json.version = 1` | 无工具版本、无 schema 标识 | P1 | `cube.json` 加 `generator:{name,version}`；可选 `$schema`（指向仓库内 JSON Schema，便于 IDE 校验与文档化） |
| 迁移 | CubeMX1 `ProjectManager.AskForMigrate=true`，打开旧 `.ioc` 提示升级；固件包升级日志 `New firmware version … Old firmware version …`。CubeMX2 `VersionManager`（`migrationScriptPool` + `migrateModel` + `unversionedStoreDefaultVersion`，S7） | 无迁移函数；`version !== 1` 直接报错拒绝 | 一旦引入 v2，老工程无法自动升级；只能靠用户手改 | P1 | 引入 `MIGRATIONS: Record<number, (cfg)=>cfg>` 链：`parseProjectFile` 读 `version` → 逐级迁移到当前 → 返回 `{config, migratedFrom, notes}`；UI 提示“已从 v1 升级，建议另存”；**先建基础设施，暂不升版本** |
| 库/固件包升级 | CubeMX1 `FirmwarePackage` + `LastFirmware` + `DefaultFWLocation`（自动提示新版本）；CubeMX2 packs 版本在 `csolution.packs` + `pack-layout` | `hal.rev` 锁定于 `cube.json` 与 `halRev.ts`；vendor 目录替换说明写进 README | 升级 HAL 需手工替换 vendor 或重新导出；工具不提示“有更新” | P2 | 保持“显式 rev、不自动升级”的安全策略；可在 App 内加“HAL 版本”提示（读取远端仓库最新 commit，仅提示，不自动改 cube.json） |
| 过期文件清理 | `.ioc` `DeletePrevious=true`（默认）+ `.mxproject [PreviousGenFiles]` | 无 | 同 1.2（残留生成文件） | P1 | 由导出清单驱动；默认 `DeletePrevious=true`，可选关闭 |
| 向后兼容 | CubeMX 老 `.ioc` 可打开（迁移） | 缺字段宽容；未知字段丢弃；未来版本硬拒绝 | 半兼容：老→新可，新→旧会丢字段 | P1 | parse 保留未知字段（`{...raw, ...known}`）；版本比较而不是全等 |
| 变更影响提示 | CubeMX 生成前告知将覆盖/删除的文件（推测：以“生成”确认对话框形式） | 无（只有冲突面板阻止导出） | 用户不知道重导出会改动哪些文件 | P1 | 复用 `plan`（1.2）在导出前展示“将更新 N / 新增 M / 删除 K / 跳过 J” |

### 1.8 工程管理会话（生态补充）

| 能力 | CubeMX 行为 | 我们的对应物 | 差距 | 优先级 | Rust 生态适配要点 |
|---|---|---|---|---|---|
| 项目列表/最近项目 | CubeMX2 Home：`MCU | Board | Project(Open from file system)` 三入口 + “Last Opened project” + “Recent projects”（缩略图、`.ioc2` 路径、大小、最后打开/修改、`Last modified with MX2 v1.1.1`、搜索框）；CubeMX1 打开 `.ioc` 的最近列表 | HomeView：导入 cube.json/拖拽 + “仅导出配置”；localStorage 单槽自动恢复 | 无多工程、无最近列表、无工程元信息（大小/修改时间/工具版本） | P1 | 桌面端（Tauri）落在磁盘：`~/.config/ch32-rs-cubemx/projects.json` + 每工程目录；条目展示 `projectName/chip/lastOpened/工具版本`；`docs/PROJECT_MEMORY.md` §9 已列为待办，与 CubeMX2 的 Home 对齐 |
| 项目文件与生成目录分离 | CubeMX2 `.ioc2` 独立于导出目录，可 “Open from file system” 重新打开；导出目录只是产物 | `cube.json` 在工程根（便携，优势）；有“仅导出配置”按钮 | 无“另存为工程文件（.cube）并集中管理”的入口（现有按钮已覆盖一半） | P2 | 可选：支持 `<name>.ch32cube`（仍为 JSON，扩展名区分）作为“工程文件”，与导出目录解耦；`cube.json` 继续嵌在导出工程里保证便携 |
| 自动保存/保存状态 | CubeMX2 状态栏 “Click to save / Saved”；CubeMX1 手动保存 `.ioc` | localStorage 手动保存 + `dirty` 标记 + 导出时保存 | 生态接近（我们更轻）；缺“自动保存到磁盘工程文件” | P2 | 桌面端自动保存到 `projects/<id>/project.cube.json`（debounce 2s），状态栏显示；浏览器端保持 localStorage |
| 导出格式选择持久化 | `.ioc2` `export.configurations` + `lastUsedFormat` | 无 | 同 1.6 | P2 | 见 1.6 |

### 1.9 我方相对优势（避免只列差距）

- **`.cargo/config.toml` runner + `xtask`**：CubeMX 的 CMake 工程不负责烧录，我们开箱即 `cargo run`；双核 `flash/merge` 是 CubeMX 没有的能力。
- **`cube.json` 便携**：单文件内嵌在导出工程里，比 `.ioc2` 的“项目文件与产物分离”更适合分享/归档。
- **物理隔离优于注释标记**：Rust 无预处理，`main.rs` 永不覆盖 + `generated/` 整体重写，比 `USER CODE BEGIN/END` 更不易被误改坏（CubeMX2 也转向同一思路）。
- **数据驱动 + 端到端编译验证**：`verify:build` 直接编译生成物（V003/V203/H417），CubeMX2 的导出正确性靠 csolution 工具链保证，我方在“生成器自身正确性”上有自动门禁。
- **内嵌 HAL 源码**：`vendor/ch32-hal` 可跳转阅读，接近 CubeMX2 packs 的“源码在工程内”，且更轻量。

---

## 2. P0 清单

> 定义：会**静默破坏用户已有工程或配置**，或不修就无法兑现“重新导出安全”的核心承诺。

### P0-1 建立“文件组 + 冲突策略”再生成模型（对齐 CubeMX2 fileGroup/conflict）

- **问题（证据）**：
  - `prepareExport` 只把 `src/main.rs` 当用户区（`src/services/projectExport.ts:30`）；
  - 目录导出对 `Cargo.toml`、`.cargo/config.toml`、`rust-toolchain.toml`、`build.rs`、`.gitignore`、`README.md`、`vendor/ch32-hal/**` 全部无条件写入（`flatten()` + `writeFolderNative`，`src/services/projectExport.ts:136-167`）；
  - 真实用户必然会在 `Cargo.toml` 加依赖、在 `README.md` 写项目说明、在 `vendor/ch32-hal` 打本地补丁——**重新导出即丢失**。
- **CubeMX 对照**：CubeMX2 把 `CMakeLists.txt` 列为 `project_file`（生成一次不重写），`main.c/.h` 为 `user_code`（绝不写），packs 为 `pack` 组，且每组有独立 `conflict` 策略（S5/S7）。类别级动作只有 4 种（`DIFF` 逐文件解决 / `SKIP` 保留 / `OVERWRITE_WITH_BACKUP` / `OVERWRITE_WITHOUT_BACKUP`），逐文件动作另有 `REMOVE` 与 `MANUAL_MERGE`（S10，CDP 实机/前端 bundle）。
- **建议实现**：
  1. 在 `model/types/codegen.ts` 增加 `FileGroup = 'generated'|'project_file'|'user_code'|'pack'`，`GeneratedFile.group`；
  2. 分组：`generated`=`src/generated/**`；`user_code`=`src/main.rs`、`<core>/src/main.rs`、用户新增模块；`project_file`=`Cargo.toml`、`.cargo/config.toml`、`rust-toolchain.toml`、`build.rs`、`.gitignore`、`README.md`、`cube.json`；`pack`=`vendor/ch32-hal/**`；
  3. 每组一个可配置策略（默认对齐 CubeMX2：`generated=DIFF`、`project_file=DIFF`、`user_code=SKIP`、`pack=DIFF`、`all=OVERWRITE_WITHOUT_BACKUP`）；
  4. `project_file` 默认“仅首次创建”；`Cargo.toml` 额外支持**标记区合并**（`# >>> ch32-cubemx generated`/`# <<<`），只替换区间，保留用户依赖/profile；
  5. `pack` 组：已存在则跳过并提示“检测到 vendor/ch32-hal 已存在，保留本地内容（`--refresh-vendor` 强制覆盖）”；
  6. 导出对话框显示“本次将新建 X / 更新 Y / 跳过 Z / 保留用户文件 W”，并提供“冲突规则”表（4 类别 × 4 动作），对应 CubeMX2 `Project Settings → IDE Project Generation → Advanced → Automatic Conflict Handling Rules`。
- **验收**：`tests/codegen.test.ts` 增加“二次导出到同一目录不改用户 Cargo.toml / README / vendor”；`verify:build` 增加“导出到已有工程目录，用户依赖仍保留”。

### P0-2 导出清单（manifest）与“差异安全网”

- **问题（证据）**：无任何跨会话生成记录；用户手改 `src/generated/pins.rs` 会被静默覆盖；关掉 SPI 后 `spi.rs` 残留（生成器条件输出，见 `src/model/codegen/index.ts` 与快照测试的文件清单差异）；UI 只有内存态 `lastExportSnapshot`。
- **CubeMX 对照**：`.settings/exported-files.json`（file+group+sha256+timestamp，别声明“勿改，用于决定如何更新工程”）；`.mxproject [PreviousGenFiles]` + `DeletePrevious=true`。
- **建议实现**：
  1. 生成 `.ch32cube/export-manifest.json`（`src/model/codegen/manifest.ts`，纯字符串），字段：`version`、`generator{name,version}`、`timestamp`、`configHash`、`files[{path, group, sha256}]`；
  2. 目录导出入参带上“磁盘现状”（Tauri `read_folder` 或逐文件读取）：产出 `plan`；
  3. 规则：`generated` 组内容相同→`unchanged`（不写）；不同→`update`；上次清单有、本次无→`delete`；**用户手改过的 generated 文件**（磁盘哈希≠清单哈希）→ 默认 `skip-conflict` 并警告，用户可显式覆盖；
  4. `user_code`/`project_file`/`pack` 组永不 delete；
  5. ZIP 导出也写 manifest（便于用户解压后继续用目录模式）；
  6. 导出前若 `plan` 中存在 `conflict`：弹“检测到 N 个文件在导出目录内被外部修改”对话框（对齐 CubeMX2 `IDE Code generation`），提供“查看差异 / 全部覆盖 / 逐文件解决（跳过/覆盖/备份/写 `_base`）”；无冲突时正常继续（对应 CubeMX2 日志 “No files requiring manual review found, proceeding with export”）。
- **验收**：单测覆盖 create/update/unchanged/delete/skip-conflict 五种 action；手工场景“导出→改 pins.rs→再导出”必须弹人工复核且默认不覆盖；`.ch32cube/export-manifest.json` 与磁盘一致。

### P0-3 `unlocked`（特殊引脚解锁）写入配置快照并参与回读

- **问题（证据）**：`ProjectState.unlocked` 仅在内存（`src/controllers/project.ts:32`），`loadConfig()`/`switchDevice()` 清空（:224-250），`ProjectConfig` 无该字段（`src/model/types/project.ts:42-53`）；导入 cube.json 后 NRST/SWD/OSC 重新锁定，用户“已解锁并配置”的事实丢失，冲突判定随之改变。
- **CubeMX 对照**：`.ioc` 每引脚 `Locked=true`；`.ioc2` `pinout-excluded-pins` + `need.ownedByUser`——锁定/占用状态是**工程快照的一部分**。
- **建议实现**：
  1. `ProjectConfig` 加可选 `unlockedPins?: string[]`（不升 version，向后兼容）；
  2. `project.ts` 的 `config` getter 输出、`loadConfig()` 读入并去除已不存在/已不特殊的项；
  3. `parseProjectFile` 做类型校验（字符串数组）；
  4. 单测：解锁→导出→导入→`unlocked` 一致；旧 cube.json 缺字段→空数组。
- **验收**：`npm run test` 中 `projectFile` / `codegen` 新增用例通过；导出工程 `cube.json` 可见 `unlockedPins`。

---

## 3. P1 清单

1. **中断/NVIC 配置与生成**：cube.json 加 `interrupts[{irq, enabled, priority}]`；生成 `src/generated/irq.rs`（`qingke::pfic::set_priority`，HAL 已支持）；冲突检查（优先级重复告警、embassy 所需 IRQ 强制启用）；README 输出中断表。对应 CubeMX `.ioc NVIC.*` / `.ioc2 nvic.store`。
2. **DMA 通道/请求配置**（embassy 与 H417 必需）：cube.json 加 `dma[{peripheral, channel, request}]`，用 `data/devices/<chip>/dma.json` 校验；修掉 `workspace.ts` 里“DMA 固定通道建模”的已知限制；冲突检查（通道重复）。
3. **时钟节点锁定 + 时钟输出**：`clock.locked: string[]`；`mergeClockConfig`/`matchPreset` 尊重锁定；`clk_outputs`（MCO）作为可选生成项。对应 `.ioc2` `userSettings[].isLocked`、RCC `clk_outputs`。
4. **外设参数补全（可生成项）**：USART 校验/停止位/字长、SPI CPOL/CPHA/位宽/软件 NSS、I2C 速率模式/双地址、ADC 采样时间/分辨率/连续转换；参数 spec 已在 `data/devices/*/peripherals.json`，补齐后生成器即可输出（HAL 枚举名须按 `HAL_API_NOTES.md` 核对）。
5. **生成报告增强（README/REPORT）**：引脚占用全表（按物理位号）、时钟五元组、外设实例/remap/参数表、中断表、Flash/RAM 预算、生成元数据（工具版本/时间/配置哈希/HAL rev）；数据源全部已有（`derivePeripheralUsage`/`computeClock`/`chip.json`），纯模板工作；另提供“导出引脚表 CSV”（对齐 CubeMX2 `<project>-pinout.csv` 的 *With / Without Alternate Functions* 两种粒度）。
6. **工具链档位（profiles）**：`release-size` / `release-speed` / `release-debug` 三个 profile + `.cargo/config.toml` alias；导出对话框可选；`Cargo.toml` 的 `[profile.*]` 进入 P0-1 的标记区，避免被覆盖。
7. **调试集成（可选项）**：生成 `.vscode/{settings,tasks,launch}.json`（rust-analyzer target / build / flash / 调试）；调试后端先实测 `wlink gdbserver`（**推测**存在），否则用 `probe-rs-debug` 或 gdb+OpenOCD 模板，并明确标注支持程度；README 增加“断点调试”章节。
8. **cube.json 版本/迁移基础设施**：`generator` 字段、`$schema`（可选）、`MIGRATIONS` 链、未知字段保留、版本“≤当前可迁移 / >当前明确拒绝”；不升 version，先把通路建好。
9. **过期生成文件清理**：由 P0-2 manifest 驱动，默认开启，plan 中可见，可关闭。
10. **烧录链路验证与文档**：`verify:build` 之外加 runner 配置静态断言；README 明确“烧录需硬件、CI 不覆盖”；CI 可选 `--flash` 门禁。
11. **工程列表/最近项目**（桌面端）：磁盘工程库 + 最近列表（名称/芯片/路径/时间/工具版本/大小），与 CubeMX2 Home 对齐；`PROJECT_MEMORY.md` §9 已列。
12. **按需“生成前 plan 预览”**：导出对话框展示 create/update/delete/skip，支持展开查看 diff（复用 Monaco 面板）。

---

## 4. P2 清单

1. **HTML 报告**（单文件、内联 CSS + 引脚表 + 时钟树 SVG）作为可交付文档；CubeMX 无此能力，属差异化。
2. **备份策略**：目录导出把 generated 组旧文件写入 `.ch32cube/backup/<ts>/`，保留 N 份。
3. **视图状态入快照**：`cube.json.ui.packageRotation`、`activeView`（对齐 `.ioc PinOutPanel.RotationAngle` / `.ioc2 pinout-user-settings.package.rotation`）。
4. **每引脚增强**：`activeState`、多标签 `labels[]`、`note`、物理位号 `position`、电气属性（FT/TT、供电域）；生成代码只影响常量命名/注释，不改变 HAL 调用。
5. **板卡（board）模型**：`data/boards/<board>.json`（板载 LED/按键/晶振/探针），Home 提供 “从板卡新建”（对齐 CubeMX2 的 Board 入口）。
6. **运行时选择一等公民化**：`features.runtime: 'blocking'|'embassy'`，替代单布尔；后续可加 `rtic`（需 HAL 支持核对）。
7. **低功耗配置**：`power.mode`，生成 `generated/power.rs`（若 ch32-hal 有对应 API）。
8. **中间件/协议栈**：`embassy-net`/`usbd` 等的可选依赖注入（须 HAL/依赖成熟后再做，避免生成不可编译工程）。
9. **单核 bin/hex 产物**：`cargo objcopy`/`xtask bin` 命令与 README。
10. **`.cargo/config.toml` 可配置项**：额外 `rustflags`、`build.target-dir`、`net.git-fetch-with-cli`（企业网络）；进入 P0-1 标记区。
11. **导出偏好持久化**：`export{lastFormat,lastDir,includeVendor}`（对齐 `.ioc2 export.configurations`）。
12. **工程文件扩展名/工程库**：`<name>.ch32cube` 作为独立工程文件，与导出目录解耦（对齐 `.ioc2` 的“项目文件与产物分离”）。
13. **自动保存到磁盘工程文件**（桌面端，debounce 2s，状态栏显示）。
14. **多工程/多部件管理**：超出当前定位，如做则复用 Cargo workspace 模型。
15. **生成区更细粒度拆分**（`generated/usart/usartN.rs`）：仅当单文件规模显著增长或并行编辑需求出现时。
16. **额外 IDE 产物**：CLion `.idea/runConfigurations`、Makefile 包装（优先级最低）。
17. **MSRV 与依赖策略**：`Cargo.toml` 的 `rust-version`、README 说明 `Cargo.lock` 入库、`cargo vendor` 可选。
18. **打包布局可配置**（pack-layout 的正则映射）：不推荐跟进，保持 `vendor/` 固定布局。
19. **生成前/后本地日志文件**：`.ch32cube/last-generation.log`（耗时、文件计数、警告），便于用户反馈问题。
20. **`enabled` 外设的 init_type**：Rust 无需 `called/callable` 区分（函数天然可调用），但可生成 `pub fn init_x()` 供用户选择性调用（对齐 CubeMX2 “Resource initialization code generation: Callable”）。