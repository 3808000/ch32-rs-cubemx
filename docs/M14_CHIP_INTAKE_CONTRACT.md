# M14 契约：三芯片接入（CH32V103C8T6 / CH32X035C8T6 / CH32V307VCT6）

> 主控预建（2026-11-18）。真相源：R1 报告 `/tmp/m14-research/R1-hal-facts.md`（HAL 逐字核实，含文件:行号）+
> R2 报告 `/tmp/m14-research/R2-pinouts.md`（官方数据手册级引脚表）+ 数据手册文本
> `/tmp/m14-research/datasheets/<芯片>/{v103,v307,x035}.txt`。
> 本契约的决策（D1–D12）优先于两份报告中的「建议」；报告中的「待核实」项已由主控用数据手册裁决的见下。

## 0. 已裁决事实（数据手册级，取代 R1 §5 待核实项 1/2/3/4）

- **V103 sysclkMax = 80MHz**（CH32V103DS0 V1.2：「最高 80MHz 系统主频」「PLLCLK Max=80MHz」「APB1/APB2 Fmax=80MHz」；典型 72MHz）。ch32-data `_raw.Freq=80` 正确，`product_type` 72M 是典型值。
- **V103 HSE 范围 8–25MHz**（DS 表 3-10 `FHSE_ext 外部时钟频率 8..25 MHz`；晶体典型电路 8MHz）。
- **V307 HSE 范围 3–25MHz**（CH32V307DS0 V3.9：「外部支持 3～25MHz 高速振荡器」）；sysclkMax=144MHz（零等待）。
- **V103 APB1/APB2 max = 80MHz**（DS 明写）；但 HAL 72MHz 预设用 ÷2 → 预设照抄 HAL 配方。
- X035 ADC CLK_DIV 精确语义仍待核实（R1 §5.5）→ 按 HAL 注释「default 0b11=/8」建模 div:8 + notes 诚实标注。
- V307 ADCPRE+CLK_DIV 组合语义待核实（R1 §5.6）→ 只暴露 APB2_DIV2（HAL 实际生效路径）。

## D1 芯片与封装

| 芯片 | 封装 | halFeature | target | nightly | flash | sram | deviceId |
|---|---|---|---|---|---|---|---|
| CH32V103C8T6 | LQFP48 quad 12/边 | ch32v103c8t6 | riscv32imc-unknown-none-elf | false | 64K | 20K | 0x25004102 |
| CH32X035C8T6 | LQFP48 quad 12/边 | ch32x035c8t6 | riscv32imc-unknown-none-elf | false | 62K | 20K | 0x03510601 |
| CH32V307VCT6 | LQFP100 quad 25/边 | ch32v307vct6 | riscv32imfc-unknown-none-elf | **true** | 256K（默认 c256_r64；物理 480K，notes 注明） | 64K | 0x30700508 |

- 三芯片 remapModel 均 `afio_v1`（R1 §1.5/2.5/3.5）。
- core 字段：V103 "QingKe V3A (RV32IMAC)"、X035 "QingKe V4C (RV32IMAC)"、V307 "QingKe V4F (RV32IMAFC)"。
- family：CH32V103 / CH32X035 / CH32V307。docUrl：wch.cn 对应产品页。
- **unsupportedFeatures 不填**（现语义仅 'embassy' 被 UI 消费；三芯片 embassy 均可用）。驱动缺口写 README/notes，不建模无驱动外设。
- V307 chip.json 新增 `targetSpec`（完整 JSON 对象，逐字抄 R1 §3.2 的 19 行 spec：abi ilp32f / +m,+f,+c,+forced-atomics,+xwchc / atomic-cas false 等）。

## D2 引脚数据（chip.json pins）

逐字采用 R2 报告三张引脚表（官方数据手册级）：number/name/type/side/aliases/special/ft/adc。
- V103：48 脚（37 IO+11 POWER），ft 全 false（DS 无 FT 列），ADC IN0–9；PD0/PD1 special=osc；NRST/BOOT0 POWER+special。
- X035：48 脚（46 IO+2 POWER），RST=PA21 special=nrst，SWD=PC18/PC19 special=swd，PC17 加 BOOT alias（不标 special=boot，按 R2 裁决），ADC IN0–9，ft 全 false。
- V307：100 脚（82 IO+17 POWER+1 NC@73），12/13 独立 OSC_IN/OSC_OUT（special=osc，不合并 PD0/PD1@81/82），FT 按 R2 表，ADC IN0–15。
- source 字段：数据手册编号/版本/表号 + file.wch.cn id + ch32-data 交叉核对结论（照 R2 §x.1/1.3）。

## D3 时钟模型扩展（model 域，向后兼容；D 代理实施）

1. **prediv 除法语义**：`src/model/clock/index.ts` pllOutMhz —— 参数键 `prediv` 做除法、`mul` 做乘法（`in / prediv * mul`）；现有 `div`（fixedOutMhz 模型）不变。V003（仅 mul）/CH582（仅 div）行为逐字节不变。
2. **ClockData.pll 可选**（X035 无 PLL）：`defaultClock`/`mergeClockConfig`/`validateClock`/`solvePll`/`matchPreset`/`nearestPreset` 全部容忍 `spec.pll === undefined`（无 PLL 时 solvePll=[]、跳过 PLL 校验、defaultClock 不写 pllSource/pll）。UI（ClockCanvas/ClockDetail/树模型）若访问 pll 需空安全（D 代理检查并修）。
3. **ADC 源 SYSCLK**：computeClock adcMhz 分支增加 `source === 'SYSCLK'` → sysclkMhz/div（X035）。
4. **参数按源上限**：`ClockParamSpec.maxBySource?: Record<string, number>`（可选）；validateClock 对 pll 参数检查 `value <= maxBySource[pllSource]`（V307 prediv：HSI 源 max 2，HSE 源 16）。
5. 类型同步 `src/model/types/clock.ts`；validate-device-data.mjs 若假定 pll 存在需同步（D 代理）。

## D4 时钟数据（clock.json，各芯片代理实施；骨架见 R1 §1.7/2.7/3.7，按以下裁决修改）

**V103**：sysclkMaxMhz 80；sources HSI 8 / HSE hxtal{min:8,max:25,default:8} / PLL；**defaultSource:"PLL"**（新建工程必须落在可生成预设）；pll{outMaxMhz:80, sourceOptions:[HSI,HSE], params:[prediv{options:[1,2],default:1}, mul{options:[2..16],default:6}]}；ahb options **[1,2,4,8,16]**（÷64..512 因 HAL Div<Hpre> off-by-one 不开放，notes 注明硬件存在）；apb1/2 options[1,2,4,8,16] maxMhz 80；adc 仅 APB2_DIV2{source:APB2,div:2} maxMhz 14；timerClock apb_x2；presets：
- 48MHZ_HSI / 72MHZ_HSI / 48MHZ_HSE / 72MHZ_HSE（match 含 prediv:1；72 档 apb1/2=2，照 HAL 常量配方）→ presetConstMap 对应 SYSCLK_FREQ_* 四常量；
- **80MHZ_HSI / 80MHZ_HSE**（mul:10, prediv:1, apb1/2=2）→ presetConstMap 用**块表达式**（模板把 map 值作为表达式输出，已核实 templates/clockRs.ts）：`{ let mut c = hal::rcc::Config::SYSCLK_FREQ_72MHZ_HSI; c.pll = Some(hal::rcc::Pll { prediv: hal::rcc::PllPreDiv::DIV1, mul: hal::pac::rcc::vals::PllMul::MUL10 }); c }`（HSE 版基常量换 SYSCLK_FREQ_72MHZ_HSE；**类型路径必须编译核实**，PllMul 路径以 metapac rcc_v1 为准）。fallback **"explicit"**（80MHz 块表达式预设 + 48/72 常量覆盖主路径；explicit 兜底仍不写 cfg.pll——非预设 PLL 配置导出会丢 PLL，**冲突规则/preflight 无需新增**，notes + README 注明「非预设 PLL 配方待 M15」）。
  - ⚠ 若 80MHz 块表达式编译核实失败 → 降级：去掉 80 两档、fallback 改 preset_only、notes 记录原因（诚实失败，不臆造）。
- defaultClock 落点验证：PLL+HSI+prediv1+mul6+全 1 = 48MHZ_HSI ✓。

**X035**：sysclkMaxMhz 48；sources 仅 HSI 48（**无 pll 字段**，D3.2）；defaultSource 缺省（HSI）；ahb options[1,2,3,4,5,6,7,8,16,32,64,128,256] maxMhz 48 default 1；apb1/2 options[1]；adc {id:"SYS", source:"SYSCLK", div:8, label 注明 CTLR3 原始分频/HAL 缺省 0b11=/8/语义待核实} maxMhz 14；timerClock apb_x2（APB=1 时等价 HCLK，R1 §2.1.6）；presets 48/24/16/12MHZ_HSI（match source:HSI + ahb 1/2/3/4）→ 四常量；fallback **preset_only**（explicit 路径会写 X0 不存在的 cfg.sys/apb*_pre，M15 再做 ahb_pre-only 显式路径）。defaultClock：HSI+ahb1=48MHZ_HSI ✓。

**V307**：sysclkMaxMhz 144；sources HSI 8 / HSE hxtal{min:3,max:25,default:8} / PLL；defaultSource:"PLL"；pll{outMaxMhz:144, sourceOptions:[HSI,HSE], params:[prediv{options:[1..16],default:1,**maxBySource:{HSI:2}**}, mul{options:[3,4,5,6,6.5,7,8,9,10,11,12,13,14,15,16,18],default:18}]}（**无 ×2**）；ahb [1,2,4,8,16]（同 V103 off-by-one 裁决）；apb1/2 [1,2,4,8,16] maxMhz 144；adc 仅 APB2_DIV2 maxMhz 14；timerClock apb_x2；presets：
- 144MHZ_HSI / 144MHZ_HSE（mul18 prediv1 全 1）/ 96MHZ_HSI（mul12 prediv1 apb1/2=4）→ 三常量；
- **48MHZ_HSE**（mul6 prediv1 全 1）→ 映射 `hal::rcc::Config::SYSCLK_FREQ_96MHZ_HSE`（**上游命名 bug：该常量字段实为 HSE8×6=48MHz**，notes 逐字记录，R1 §3.1.3）；
- fallback preset_only（V307 explicit 的 Pllsrc 路径不存在 + cfg.pll 缺失，M15）。defaultClock：PLL+HSI+mul18=144MHZ_HSI ✓。
- ⚠ mul 含 6.5（小数）：ClockParamSpec.options 是 number[]，computeClock 乘法天然支持；matchPreset 用 === 比较，6.5 精确匹配 OK。presetConstMap 块表达式不需要（48 用错名常量）。

## D5 remap/interrupts/dma（importer 生成）

`node scripts/import-ch32data.mjs --chip <NAME>`（脚本已支持任意芯片；remap 只收 usart/spi/i2c/timer/rcc kind）。
- **V307 USART1 特例**：ch32-data 把 remap 注释掉（complex RM）→ importer 产出可能缺 USART1 条目；数据代理必须按 R1 §3.5 手工补 USART1 四档（0..3，引脚来自 FV2x_V3x_USART1.yaml pins 的 remap 注释/手动核对），notes 注明 PCFR1.USART1_RM(bit0)+PCFR2.USART1_RM2(bit1) 拆分（HAL patches.rs:16-27）。
- 无 remap 外设（SPI2/I2C2/SDIO 等）只录 remap 0。
- interrupts.json：importer 生成；**X035 EXTI IRQ 名 EXTI7_0/EXTI15_8/EXTI25_16**（不是 EXTI0..15_10）。
- dma.json：importer 生成；V307 双 DMA（DMA1+DMA2）——importer 只取第一个，notes 注明 DMA2 未建模（HAL README TODO）。

## D6 peripherals.json / exti.json

- 结构照 V203 样板；params 默认值必须在 options 内（validate 门禁）。
- **X035 SPI1 bitOrder options 仅 ["MsbFirst"]**（HAL spi_v0 无 LsbFirst，R1 §2.4）。
- USART/SPI/I2C remaps 逐档来自 ch32-data（与 remap.json 双向一致，validate 门禁）。
- ADC 通道与 chip.json adc 双向一致（V103/X035 IN0–9；V307 IN0–15，ADC1/2 共用引脚——peripherals.adc 建模 ADC1+ADC2 两实例同通道表，照 V203 双 ADC 样板）。
- exti.json：每 IO 脚 channel=端口内引脚号；irq 按家族映射（V103/V307 照 V203 的 EXTI0..EXTI15_10；X035 按 D5 分组）。
- 不建模无 HAL 驱动的外设（V103 USBFS/RTC；X035 OPA；V307 OPA/DVP/ETH/RTC 等）——peripherals.json 只收 GPIO 相关 + usart/spi/i2c/adc/timer（现有 kind 集合）。

## D7 生成器 target 扩展（D 代理）

- cargo.ts：`jsonTarget` 泛化 = `nightly && (target==='riscv32ec-unknown-none-elf' || chip.targetSpec)`；有 targetSpec 时输出 `<target>.json`（JSON.stringify(spec,null,2)）、jsonTargetFile=`<target>.json`；**.cargo/config.toml 的 [target.X] 表名不带 .json，build target 带 .json**（逐字对齐 HAL examples/ch32v307/.cargo/config.toml）。V003 旧路径输出逐字节不变（快照测试守）。
- rust-toolchain：nightly+rust-src 现有模板复用；确认 target 字段写法与 V003 一致。
- chip.json 类型加 `targetSpec?: Record<string, unknown>`（types/chip.ts）。
- ideConfig/readme：V307 README 注明 ilp32f 硬浮点 / nightly+build-std / 不可换 stable / memory 默认 c256_r64（FLASH 链接区 480K=USR_1+USR_2 合并，WCHISPTool ROM/RAM 配置须一致）。

## D8 verify:build 扩展（D 代理）

- 默认芯片列表 → V003,V203,H417,CH582M,**V103,X035,V307**（7 路）。
- V307 blocking 即需 nightly（chip.nightly）：verify-build.mjs 按芯片数据选 RUSTUP_TOOLCHAIN（读 chip.json nightly；embassy 档仍 nightly）。V103/X035 stable。
- verify-build-entry.ts：三芯片自适应配置已数据驱动（ioPins/usart/spi/i2c/adc 自动选）——确认 X035 无 pll 时 entry 不崩。
- **每个预设常量/块表达式必须真实 cargo 编译核实**（数据代理用临时工程逐预设生成+构建；至少 default 预设走 verify:build，80MHz 块表达式与 48MHZ_HSE 错名常量必须单独编译验证）。

## D9 测试要求

- 每芯片数据测试文件（tests/ch32v103Data.test.ts 等）：引脚数/编号连续/每边数量、ADC 双向一致、remap 三元组唯一、预设复现（computeClock sysclk=标称）、defaultClock 落预设、validate 0 error、X035 无 pll 不崩、V307 prediv HSI>2 报 error。
- D 代理：clock 模型扩展测试（prediv 除法、可选 pll、SYSCLK adc、maxBySource）+ cargo targetSpec 测试 + V003/V203/CH582 快照不变回归。
- 全量门禁：vue-tsc / eslint / vitest / validate:device（7 芯片）/ vite build / verify:build 7 路。

## D10 文件域（互斥）

- A：data/devices/ch32v103c8t6/** + tests/ch32v103Data.test.ts
- B：data/devices/ch32x035c8t6/** + tests/ch32x035Data.test.ts
- C：data/devices/ch32v307vct6/** + tests/ch32v307Data.test.ts
- D：src/model/clock/index.ts、src/model/types/{clock,chip}.ts、src/model/codegen/cargo.ts、src/model/codegen/templates/{cargoConfig,rustToolchain,clockRs}.ts（如需）、scripts/verify-build*.{mjs,ts}、scripts/validate-device-data.mjs（如需）、tests/clock.test.ts（追加）、tests/cargoTargetSpec.test.ts（新）、clock UI 空安全（components/clock/*、views 如需）
- 主控：契约/集成/README 模板能力边界文案（readme.ts 如需由 D 顺带）/浏览器验收/推送。
- importer 运行：各芯片代理自己跑（输出只落自己域）；chip-index.json 由 importer 全量重写——**A/B/C 并发跑 importer 会互踩 chip-index.json**：约定 importer 输出 chip-index 内容相同（全量索引与芯片无关），最后集成时主控重跑一次统一。

## D11 BLE M14 修复（主控已实施，单独轨道）

- busy-poll 连续轮询无 delay（对齐官方 C Main_Circulation；M13 的 300µs 来自未跑通的 embassy 示例）。
- stack_init 替代 ble::init：SelRTCClock=1（LSI）——HAL 硬编码 0=LSE 在无晶振板上连接失败（广播正常/连接 le-connection-abort-by-local）。rcCB=None 先行，LSI 校准移植为后续增强。
- 烧录用 MRS OpenOCD program verify（wlink flash 实测产出坏镜像：广播消失/寄存器乱值，OpenOCD Verified OK 后恢复）。
- 详见 HAL_API_NOTES §14.2quater（待补）与 BLE 契约 D20/D21（待补）。

## D12 诚实边界（README/notes 必写）

- V103：USBFS/RTC 无 HAL 驱动；AHB ÷64..512 硬件存在但 HAL clocks() off-by-one 不开放；非预设 PLL 显式导出待 M15（explicit 不写 cfg.pll）。
- X035：无 HSE/PLL；SPI 仅 MSB-first；I2C 上游未标已验证；PIOC 需 pioc feature+外部固件（不建模）；USBPD 仅 PHY（不建模）；OPA 无驱动；ADC CLK_DIV 语义待核实；AHB÷5..256 导出待 M15（preset_only）。
- V307：ETH 驱动存在但 MAC 未验证（不建模）；OPA/DVP 无驱动；PLL2/DMA2 TODO；LSE/LSI 配置路径 todo!()；memory 分割仅默认 c256_r64（HAL 无 feature 透传）；96MHZ_HSE 常量命名 bug 已按实际 48MHz 使用。